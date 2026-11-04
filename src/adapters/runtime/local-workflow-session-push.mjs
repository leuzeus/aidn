import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { agentRunPhysicalPath } from '../../application/runtime/agent-run-configuration-service.mjs';
import { createLocalWorkflowBranchIntegration } from './local-workflow-branch-integration.mjs';
import { shadowHash, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const oid = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value ?? '');
// Host-owned local bare remote, used for offline qualification. The IR cannot
// select a destination, protocol, executable, receive-pack or command. A separate
// authenticated production transport is required for a GitHub claim.
export function createLocalWorkflowSessionPush({ targetRoot, remoteRoot, environment = process.env }, { afterPush = null } = {}) {
  if (!path.isAbsolute(remoteRoot ?? '')) fail('WORKFLOW_PUSH_REMOTE_CONFIGURATION_REQUIRED');
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const remote = agentRunPhysicalPath(remoteRoot, { directory: true });
  if (root === remote) fail('WORKFLOW_PUSH_REMOTE_CONFIGURATION_REQUIRED');
  if (Object.keys(environment).some(name => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(name))) fail('WORKFLOW_PUSH_ENV_SCOPE_CONFLICT');
  const env = { ...Object.fromEntries(Object.entries(environment).filter(([name]) => !/^GIT_/i.test(name))),
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const fixed = ['--literal-pathspecs', '-C', root, '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
    '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', '-c', 'push.gpgSign=false'];
  const options = { env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000, maxBuffer: 1048576, stdio: 'pipe' };
  function git(args) {
    try { return execFileSync('git', [...fixed, ...args], options).trim(); }
    catch { fail('WORKFLOW_PUSH_GIT_UNAVAILABLE'); }
  }
  const remoteUrl = pathToFileURL(remote).href, remoteIdentity = shadowHash({ profile: 'local-bare-remote.v1', root: remote });
  const remoteGitDir = agentRunPhysicalPath(path.resolve(git(['--git-dir=' + remote, 'rev-parse', '--absolute-git-dir'])), { directory: true });
  if (remoteGitDir !== remote || git(['--git-dir=' + remote, 'rev-parse', '--is-bare-repository']) !== 'true') fail('WORKFLOW_PUSH_BARE_REMOTE_REQUIRED');
  function config() {
    // URL rewrites could change even an explicit URL. Disallow them rather than
    // claim that a displayed destination authenticates another transport.
    const result = spawnSync('git', [...fixed, 'config', '--null', '--get-regexp', '^url\\.'], options);
    if (result.status !== 1 || result.stdout) fail('WORKFLOW_PUSH_URL_REWRITE_UNSUPPORTED');
    if (agentRunPhysicalPath(remoteRoot, { directory: true }) !== remote || !fs.statSync(remote).isDirectory()) fail('WORKFLOW_PUSH_REMOTE_CHANGED');
  }
  function ref(branch) {
    if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(branch)) fail('WORKFLOW_PUSH_BRANCH_INVALID');
    const value = 'refs/heads/' + branch; git(['check-ref-format', value]); return value;
  }
  function remoteHead(branch) {
    config(); const target = ref(branch), output = git(['ls-remote', '--refs', '--', remoteUrl, target]);
    if (!output) return null;
    const rows = output.split(/\r?\n/);
    if (rows.length !== 1) fail('WORKFLOW_PUSH_REMOTE_REF_AMBIGUOUS');
    const [head, name] = rows[0].split('\t');
    if (!oid(head) || name !== target) fail('WORKFLOW_PUSH_REMOTE_REF_INVALID'); return head;
  }
  let localPort;
  const localIntegration = () => localPort ??= createLocalWorkflowBranchIntegration({ targetRoot: root, environment });
  function inspectLocal(branch) {
    for (const name of ['HEAD.lock', 'packed-refs.lock', 'config.lock'])
      if (fs.existsSync(agentRunPhysicalPath(path.resolve(root, git(['rev-parse', '--git-path', name])), { missing: true })))
        fail('WORKFLOW_PUSH_LOCAL_CONTEXT_BLOCKED');
    return localIntegration().inspect({ source_branch: branch, target_branch: branch });
  }
  function inspectInternal(branch, assertLocal = null) {
    config(); const local = assertLocal ? inspectLocal(branch) : localIntegration().inspect({ source_branch: branch, target_branch: branch });
    if ((!assertLocal && !local.clean) || local.current_ref !== ref(branch) || local.head !== local.source_head || local.source_symbolic || local.target_symbolic
      || local.lock_present || local.source_lock_present) fail('WORKFLOW_PUSH_LOCAL_CONTEXT_BLOCKED');
    if (assertLocal) assertLocal(structuredClone(local));
    const head = remoteHead(branch);
    // Reading objects directly is local qualification only; it changes no fetch
    // ref/FETCH_HEAD. An unrelated remote history is never force-pushed.
    let fastForward = head === null || head === local.head;
    if (!fastForward) {
      const known = spawnSync('git', [...fixed, 'cat-file', '-e', head + '^{commit}'], options);
      if (known.status !== 0) fail('WORKFLOW_PUSH_REMOTE_HISTORY_UNAVAILABLE');
      const ancestor = spawnSync('git', [...fixed, 'merge-base', '--is-ancestor', head, local.head], options);
      if (![0, 1].includes(ancestor.status)) fail('WORKFLOW_PUSH_ANCESTRY_UNAVAILABLE'); fastForward = ancestor.status === 0;
    }
    if (!fastForward) fail('WORKFLOW_PUSH_REMOTE_DIVERGED');
    if (assertLocal) {
      const after = inspectLocal(branch); assertLocal(structuredClone(after));
      if (shadowHash(after) !== shadowHash(local)) fail('WORKFLOW_PUSH_LOCAL_CONTEXT_CHANGED');
    }
    return { profile: 'local-bare-remote.v1', remote_identity_sha256: remoteIdentity, branch, ref: ref(branch), head: local.head,
      remote_head: head, local_sha256: shadowHash(local) };
  }
  const inspect = branch => inspectInternal(branch);
  // Host-only observation capability. A JSON boolean or path list cannot
  // replace the component's exact-plan, canonical postimage and owner proof.
  function observeOwned(branch, { assertLocal } = {}) {
    if (typeof assertLocal !== 'function') fail('WORKFLOW_PUSH_OWNED_OBSERVATION_REQUIRED');
    return inspectInternal(branch, assertLocal);
  }
  function observeRemote(branch, { assertLocal } = {}) {
    if (typeof assertLocal !== 'function') fail('WORKFLOW_PUSH_OWNED_OBSERVATION_REQUIRED');
    config(); const target = ref(branch); assertLocal(); const head = remoteHead(branch); assertLocal(); config();
    return { profile: 'local-bare-remote.v1', remote_identity_sha256: remoteIdentity, branch, ref: target, remote_head: head };
  }
  async function push(observed, { write = false, assertAuthorized } = {}) {
    let attempted = false;
    try {
      if (write !== true || typeof assertAuthorized !== 'function' || checkShadowJson(observed)) fail('WORKFLOW_PUSH_EXPLICIT_WRITE_REQUIRED');
      if (shadowHash(inspect(observed.branch)) !== shadowHash(observed)) fail('WORKFLOW_PUSH_PREVIEW_CHANGED');
      await assertAuthorized();
      if (shadowHash(inspect(observed.branch)) !== shadowHash(observed)) fail('WORKFLOW_PUSH_PREVIEW_CHANGED');
      if (observed.remote_head === observed.head) return { ...observed, remote_head: observed.head, changed: false, effect_status: 'no_effect' };
      // Exact remote CAS plus a proven ancestor above. No wildcard, deletion,
      // tags, upstream config, tracking ref or checked-out files are changed.
      attempted = true;
      git(['push', '--no-verify', '--porcelain', '--force-with-lease=' + observed.ref + ':' + (observed.remote_head ?? ''), '--', remoteUrl, observed.head + ':' + observed.ref]);
      await afterPush?.(); await assertAuthorized();
      if (remoteHead(observed.branch) !== observed.head) throw Error('WORKFLOW_PUSH_POSTCONDITION_UNCONFIRMED');
      const current = inspect(observed.branch);
      if (current.local_sha256 !== observed.local_sha256) throw Error('WORKFLOW_PUSH_LOCAL_CONTEXT_CHANGED');
      return { ...current, changed: true, effect_status: 'confirmed' };
    } catch (cause) {
      // A failed/timeout transport can have changed the remote; never replay it
      // or infer no_effect from its exit status or an absent PID.
      throw Object.assign(Error(attempted ? 'WORKFLOW_PUSH_RECONCILIATION_REQUIRED' : cause.code ?? 'WORKFLOW_PUSH_CONTEXT_UNAVAILABLE'),
        { code: attempted ? 'WORKFLOW_PUSH_RECONCILIATION_REQUIRED' : cause.code ?? 'WORKFLOW_PUSH_CONTEXT_UNAVAILABLE', effect_status: attempted ? 'unknown' : 'no_effect' });
    }
  }
  return Object.freeze({ inspect, observeOwned, observeRemote, push });
}
