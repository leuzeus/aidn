import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { agentRunPhysicalPath, readAgentRunFile } from '../../application/runtime/agent-run-configuration-service.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { createLocalWorkflowPostMergeFastForward } from './local-workflow-post-merge-fast-forward.mjs';
import { createLocalWorkflowBranchIntegration } from './local-workflow-branch-integration.mjs';

const oid = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value ?? '');
const digest = value => /^[a-f0-9]{64}$/.test(value ?? '');
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
const fail = (code, effect_status = 'no_effect') => { throw Object.assign(Error(code), { code, effect_status }); };
const proofRef = nonce => 'refs/aidn/post-merge/' + nonce;
const marker = hash => 'AIDN post-merge fetch ' + hash;

// The host owns the remote identity and transfer. Transfer imports objects for
// the exact OID without writing FETCH_HEAD, tracking refs or worktree files.
export function createLocalWorkflowPostMergeFetch({ targetRoot, remote, environment = process.env, gitExecutable = 'git', beforeFastForwardRefCommit }) {
  if (!digest(remote?.context_sha256) || typeof remote.observeTip !== 'function' || typeof remote.transfer !== 'function')
    fail('WORKFLOW_POST_MERGE_REMOTE_REQUIRED');
  const remoteIdentity = remote.context_sha256;
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const local = createLocalWorkflowBranchIntegration({ targetRoot: root, environment }, { gitExecutable, isolatedConfig: true });
  const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const env = { ...Object.fromEntries(Object.entries(environment).filter(([name]) => !/^GIT_/i.test(name))),
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nullPath, GIT_TERMINAL_PROMPT: '0' };
  const fixed = ['-C', root, '-c', 'core.hooksPath=' + nullPath, '-c', 'core.fsmonitor=false', '-c', 'core.logAllRefUpdates=true'];
  function git(args, statuses = [0], { input, indexFile, raw = false } = {}) {
    const result = spawnSync(gitExecutable, [...fixed, ...args], { env: indexFile ? { ...env, GIT_INDEX_FILE: indexFile } : env, input, encoding: 'utf8', windowsHide: true,
      timeout: 10000, maxBuffer: raw ? 1048576 : 262144, stdio: 'pipe' });
    if (result.error || result.signal || !statuses.includes(result.status) || typeof result.stdout !== 'string')
      fail('WORKFLOW_POST_MERGE_GIT_UNAVAILABLE');
    return { status: result.status, value: raw ? result.stdout : result.stdout.trimEnd() };
  }
  function repository() {
    const [top, gitDir, commonDir, shallow, ...extra] = git(['rev-parse', '--path-format=absolute',
      '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--is-shallow-repository']).value.split(/\r?\n/);
    if (!top || !gitDir || !commonDir || extra.length || key(path.resolve(top)) !== key(root) || shallow !== 'false'
      || fs.existsSync(path.join(commonDir, 'info', 'grafts')))
      fail('WORKFLOW_POST_MERGE_REPOSITORY_UNSUPPORTED');
    return shadowHash([root, gitDir, commonDir].map(dir => {
      const physical = agentRunPhysicalPath(dir, { directory: true });
      const stat = fs.statSync(physical, { bigint: true });
      return [physical, String(stat.dev), String(stat.ino)];
    }));
  }
  const repoIdentity = repository();
  function localView(branch, { indexOwned = false, sourceLocked = false } = {}) {
    if (repository() !== repoIdentity) fail('WORKFLOW_POST_MERGE_REPOSITORY_CHANGED');
    const view = local.inspect({ source_branch: branch, target_branch: branch });
    if (view.current_ref !== view.source_ref || view.head !== view.source_head || view.source_symbolic
      || !view.clean || view.lock_present !== indexOwned || view.source_lock_present !== sourceLocked)
      fail('WORKFLOW_POST_MERGE_SOURCE_CHECKOUT_REQUIRED');
    return { ref: view.current_ref, head: view.head, sha256: shadowHash({ ...view, lock_present: false, source_lock_present: false }) };
  }
  function active(signal) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('WORKFLOW_POST_MERGE_SIGNAL_INVALID');
    if (signal?.aborted) fail('WORKFLOW_POST_MERGE_ABORTED');
  }
  async function remoteTip(ref, signal) {
    active(signal);
    if (remote.context_sha256 !== remoteIdentity) fail('WORKFLOW_POST_MERGE_REMOTE_CHANGED');
    const head = await remote.observeTip(ref, { signal });
    active(signal);
    if (!oid(head)) fail('WORKFLOW_POST_MERGE_REMOTE_REF_REQUIRED');
    return head;
  }
  function gitPath(name) {
    const file = git(['rev-parse', '--path-format=absolute', '--git-path', name]).value;
    return agentRunPhysicalPath(file, { missing: true });
  }
  function readRef(ref) {
    gitPath(ref);
    if (git(['symbolic-ref', '--quiet', ref], [0, 1]).status !== 1) fail('WORKFLOW_POST_MERGE_PROOF_REF_INVALID');
    return git(['rev-parse', '--verify', '--quiet', ref], [0, 1]).value;
  }
  function requireAbsent(ref) {
    if (readRef(ref) || fs.existsSync(gitPath('logs/' + ref))) fail('WORKFLOW_POST_MERGE_PROOF_REF_OCCUPIED');
  }
  function checked(prepared, expectPlan) {
    const plan = prepared?.plan;
    if (!plan || checkShadowJson(plan) || prepared.can_apply !== true || prepared.plan_sha256 !== expectPlan
      || shadowHash(plan) !== expectPlan || plan.repository_sha256 !== repoIdentity || plan.remote_sha256 !== remoteIdentity
      || !/^[a-f0-9]{32}$/.test(plan.nonce) || plan.proof_ref !== proofRef(plan.nonce)
      || !/^op_[a-f0-9]{40}$/.test(plan.operation_id)
      || ![plan.merge_oid, plan.remote_head, plan.local_head].every(oid))
      fail('WORKFLOW_POST_MERGE_PLAN_CHANGED');
    return structuredClone(plan);
  }
  function requireLocal(plan) {
    const view = localView(plan.branch);
    if (view.ref !== plan.source_ref || view.head !== plan.local_head || view.sha256 !== plan.local_sha256)
      fail('WORKFLOW_POST_MERGE_LOCAL_CHANGED');
  }
  function proveHistory(mergeOid, head) {
    const relation = git(['merge-base', '--is-ancestor', mergeOid, head], [0, 1]);
    if (relation.status !== 0) fail('WORKFLOW_POST_MERGE_REMOTE_EXCLUDES_MERGE');
  }
  function requireWitness(plan, planSha) {
    if (readRef(plan.proof_ref) !== plan.remote_head) fail('WORKFLOW_POST_MERGE_PROOF_MISSING');
    const log = gitPath('logs/' + plan.proof_ref);
    const rows = readAgentRunFile(log, { maxBytes: 8192, json: false }).value.toString('utf8').split(/\r?\n/);
    const prefix = '0'.repeat(plan.remote_head.length) + ' ' + plan.remote_head + ' ';
    if (rows.length !== 2 || rows[1] || !rows[0].startsWith(prefix) || !rows[0].endsWith('\t' + marker(planSha)))
      fail('WORKFLOW_POST_MERGE_PROOF_INVALID');
    proveHistory(plan.merge_oid, plan.remote_head);
  }
  function divergence(left, right) {
    const count = /^(\d+)\s+(\d+)$/.exec(git(['rev-list', '--left-right', '--count', left + '...' + right]).value);
    const [ahead, behind] = count ? count.slice(1).map(Number) : [];
    if (![ahead, behind].every(Number.isSafeInteger)) fail('WORKFLOW_POST_MERGE_DIVERGENCE_UNAVAILABLE');
    return { ahead, behind };
  }
  function postimage(plan, planSha) {
    requireLocal(plan);
    requireWitness(plan, planSha);
    const counts = divergence(plan.local_head, plan.remote_head);
    if (readRef(plan.proof_ref) !== plan.remote_head) fail('WORKFLOW_POST_MERGE_PROOF_MISSING');
    requireLocal(plan);
    return { source_ref: plan.source_ref, local_head: plan.local_head, fetched_head: plan.remote_head, merge_oid: plan.merge_oid,
      proof_ref: plan.proof_ref, ...counts, plan_sha256: planSha };
  }
  const ff = createLocalWorkflowPostMergeFastForward({ root, git, gitExecutable, fixed, env, localView, remoteTip,
    active, repository, requireWitness, divergence, proveHistory, gitPath, beforeRefCommit: beforeFastForwardRefCommit });
  function fastForwardSource(gitPlan, fetchPrepared) {
    const fetchSha = fetchPrepared?.plan_sha256, fetchPlan = checked(fetchPrepared, fetchSha);
    if (gitPlan.fetch_plan_sha256 !== fetchSha || gitPlan.source_ref !== fetchPlan.source_ref)
      fail('WORKFLOW_POST_MERGE_FAST_FORWARD_FETCH_CHANGED');
    return { fetchPlan, fetchSha };
  }
  return Object.freeze({
    prepareFastForward(fetchPrepared, { alignment, operationId, signal }) {
      const fetchSha = fetchPrepared?.plan_sha256;
      return ff.prepare(checked(fetchPrepared, fetchSha), fetchSha, alignment, operationId, signal);
    },
    applyFastForward(gitPlan, fetchPrepared, { write, expectPlan, signal, assertAuthorized }) {
      if (write !== true || typeof assertAuthorized !== 'function' || shadowHash(gitPlan) !== expectPlan)
        fail('WORKFLOW_POST_MERGE_FAST_FORWARD_EXPLICIT_WRITE_REQUIRED');
      const { fetchPlan, fetchSha } = fastForwardSource(gitPlan, fetchPrepared);
      return ff.apply(gitPlan, expectPlan, fetchPlan, fetchSha, { signal, assertAuthorized });
    },
    recoverFastForward(gitPlan, fetchPrepared, { expectPlan, signal }) {
      if (shadowHash(gitPlan) !== expectPlan) fail('WORKFLOW_POST_MERGE_FAST_FORWARD_PLAN_CHANGED');
      const { fetchPlan, fetchSha } = fastForwardSource(gitPlan, fetchPrepared);
      return ff.recover(gitPlan, expectPlan, fetchPlan, fetchSha, signal);
    },
    async prepare({ sourceBranch, mergeOid, operationId }, { signal } = {}) {
      if (!oid(mergeOid) || !/^op_[a-f0-9]{40}$/.test(operationId)) fail('WORKFLOW_POST_MERGE_SUBJECT_INVALID');
      const view = localView(sourceBranch), remoteHead = await remoteTip(view.ref, signal);
      const nonce = randomBytes(16).toString('hex'), ref = proofRef(nonce);
      requireAbsent(ref);
      const plan = { operation_id: operationId, repository_sha256: repoIdentity, remote_sha256: remoteIdentity,
        branch: sourceBranch, source_ref: view.ref, local_head: view.head, local_sha256: view.sha256, remote_head: remoteHead,
        merge_oid: mergeOid, nonce, proof_ref: ref };
      requireLocal(plan);
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async apply(prepared, { write = false, expectPlan, signal, assertAuthorized } = {}) {
      if (write !== true || typeof assertAuthorized !== 'function') fail('WORKFLOW_POST_MERGE_EXPLICIT_WRITE_REQUIRED');
      const plan = checked(prepared, expectPlan);
      let attempted = false;
      const assertTransferAuthorized = async () => {
        await assertAuthorized();
        requireLocal(plan);
        requireAbsent(plan.proof_ref);
        active(signal);
      };
      try {
        if (await remoteTip(plan.source_ref, signal) !== plan.remote_head) fail('WORKFLOW_POST_MERGE_REMOTE_MOVED');
        await assertTransferAuthorized();
        attempted = true;
        await remote.transfer(plan.remote_head, { signal, assertAuthorized: assertTransferAuthorized });
        if (await remoteTip(plan.source_ref, signal) !== plan.remote_head) fail('WORKFLOW_POST_MERGE_REMOTE_MOVED');
        proveHistory(plan.merge_oid, plan.remote_head);
        await assertAuthorized();
        active(signal);
        requireLocal(plan);
        requireAbsent(plan.proof_ref);
        git(['update-ref', '--no-deref', '--create-reflog', '-m', marker(expectPlan), plan.proof_ref, plan.remote_head, '']);
        return postimage(plan, expectPlan);
      } catch (cause) {
        if (attempted) fail('WORKFLOW_POST_MERGE_FETCH_RECONCILIATION_REQUIRED', 'unknown');
        throw cause;
      }
    },
    recover(prepared, { expectPlan, signal } = {}) {
      active(signal);
      const plan = checked(prepared, expectPlan);
      return postimage(plan, expectPlan);
    },
    verifyCompletedSource(prepared, { expectPlan, alignedHead, expectedHead } = {}) {
      const plan = checked(prepared, expectPlan);
      if (!oid(alignedHead)) fail('WORKFLOW_POST_MERGE_COMPLETION_HEAD_INVALID');
      requireWitness(plan, expectPlan);
      const current = readRef(plan.source_ref);
      if (!oid(current) || expectedHead && current !== expectedHead) fail('WORKFLOW_POST_MERGE_LOCAL_CHANGED');
      proveHistory(alignedHead, current);
      if (readRef(plan.source_ref) !== current || repository() !== repoIdentity) fail('WORKFLOW_POST_MERGE_LOCAL_CHANGED');
    },
    readMergedSession(prepared, { expectPlan, sessionId, alignment, signal } = {}) {
      active(signal);
      const plan = checked(prepared, expectPlan), before = localView(plan.branch);
      if (!/^S[0-9]{3,6}$/.test(sessionId ?? '') || alignment?.source_ref !== plan.source_ref
        || alignment.local_head !== before.head || alignment.merge_oid !== plan.merge_oid
        || alignment.fetched_head !== plan.remote_head || alignment.proof_ref !== plan.proof_ref
        || !Number.isSafeInteger(alignment.behind) || alignment.behind <= 0)
        fail('WORKFLOW_POST_MERGE_SESSION_SOURCE_CHANGED');
      requireWitness(plan, expectPlan);
      const name = 'docs/audit/sessions/' + sessionId + '.md';
      const entry = git(['ls-tree', '-z', '--full-tree', plan.merge_oid, '--', name]).value;
      const match = /^100(?:644|755) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(entry);
      if (!match || !oid(match[1]) || match[2] !== name) fail('WORKFLOW_POST_MERGE_SESSION_BLOB_REQUIRED');
      const content = git(['cat-file', 'blob', match[1]], [0], { raw: true }).value;
      requireWitness(plan, expectPlan);
      if (localView(plan.branch).sha256 !== before.sha256) fail('WORKFLOW_POST_MERGE_LOCAL_CHANGED');
      active(signal);
      return content;
    },
    async observeAlignment(prepared, { expectPlan, signal } = {}) {
      active(signal);
      const plan = checked(prepared, expectPlan), before = localView(plan.branch);
      if (before.ref !== plan.source_ref) fail('WORKFLOW_POST_MERGE_LOCAL_CHANGED');
      requireWitness(plan, expectPlan);
      const remoteHead = await remoteTip(plan.source_ref, signal);
      // An independently fetched new tip can be measured locally. Unknown
      // objects require an explicit fetch, never a lazy network transfer.
      if (git(['cat-file', '-e', remoteHead + '^{commit}'], [0, 1, 128]).status !== 0)
        fail('WORKFLOW_POST_MERGE_FRESH_FETCH_REQUIRED');
      proveHistory(plan.merge_oid, remoteHead);
      const counts = divergence(before.head, remoteHead);
      if (await remoteTip(plan.source_ref, signal) !== remoteHead) fail('WORKFLOW_POST_MERGE_REMOTE_MOVED');
      if (localView(plan.branch).sha256 !== before.sha256) fail('WORKFLOW_POST_MERGE_LOCAL_CHANGED');
      requireWitness(plan, expectPlan);
      return { source_ref: plan.source_ref, local_head: before.head, remote_head: remoteHead, fetched_head: plan.remote_head,
        merge_oid: plan.merge_oid, proof_ref: plan.proof_ref, ...counts };
    },
  });
}
