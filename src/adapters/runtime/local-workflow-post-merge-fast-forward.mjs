import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { agentRunPhysicalPath, readAgentRunFile } from '../../application/runtime/agent-run-configuration-service.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';

const prefix = 'WORKFLOW_POST_MERGE_FAST_FORWARD_';
const fail = suffix => { throw Object.assign(Error(prefix + suffix), { code: prefix + suffix, effect_status: 'no_effect' }); };
const exact = (a, b) => shadowHash(a) === shadowHash(b);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const indexLimit = 4 * 1024 * 1024;
const safeConfig = /^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|autocrlf|eol|safecrlf|symlinks|protectntfs|protecthfs|longpaths)|user\.(?:name|email)|branch\..+\.(?:remote|merge)|remote\..+\.(?:url|pushurl|fetch))$/;
const operationPaths = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply',
  'sequencer', 'BISECT_START', 'AUTO_MERGE', 'MERGE_AUTOSTASH', 'shallow', 'info/grafts', 'objects/info/alternates',
  'info/sparse-checkout', 'config.worktree', 'commondir', 'packed-refs.lock'];
const identity = stat => [String(stat.dev), String(stat.ino)];
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;

function physical(file, missing = false) {
  agentRunPhysicalPath(file, { missing });
  try {
    const row = fs.lstatSync(file, { bigint: true });
    if (!row.isFile() || row.nlink !== 1n) fail('FILE_UNSUPPORTED');
    return row;
  } catch (cause) {
    if (missing && cause.code === 'ENOENT') return null;
    throw cause;
  }
}

function reflog(file) {
  return physical(file, true) ? readAgentRunFile(file, { maxBytes: indexLimit, json: false }).value : Buffer.alloc(0);
}

function logSummary(bytes) { return { length: bytes.length, sha256: sha(bytes) }; }

function proveAppend(bytes, prior, oldHead, newHead, marker) {
  const added = bytes.subarray(prior.length).toString('utf8').split('\n');
  if (sha(bytes.subarray(0, prior.length)) !== prior.sha256 || added.length !== 2 || added[1] !== ''
    || !added[0].startsWith(oldHead + ' ' + newHead + ' ') || !added[0].endsWith('\t' + marker))
    fail('REFLOG_UNCONFIRMED');
}

// Keep the native ref transaction prepared across the checkout. On EOF Git
// aborts an uncommitted transaction. Its locks fence other cooperating Git
// writers while AIDN holds the real index lock.
async function withRefTransaction({ gitExecutable, fixed, env }, commands, body) {
  const child = spawn(gitExecutable, [...fixed, 'update-ref', '--create-reflog', '-m', commands.marker, '--stdin'],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let output = '', acknowledge;
  const prepared = new Promise(resolve => { acknowledge = resolve; });
  const lines = () => output.replaceAll('\r\n', '\n');
  child.stdout.setEncoding('utf8').on('data', chunk => {
    output += chunk;
    if (output.length > 256) child.kill();
    if (lines() === 'start: ok\nprepare: ok\n') acknowledge(true);
  });
  const closed = new Promise(resolve => {
    child.on('error', () => resolve(null));
    child.on('close', resolve);
  });
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => child.kill(), 60000);
  try {
    child.stdin.write(commands.prepare);
    if (!await Promise.race([prepared, closed.then(() => false)])) fail('REF_TRANSACTION_REFUSED');
    await body(async () => {
      child.stdin.end('commit\n');
      if (await closed !== 0 || lines() !== 'start: ok\nprepare: ok\ncommit: ok\n') fail('REF_TRANSACTION_UNCONFIRMED');
    });
  } finally {
    if (!child.stdin.writableEnded) child.stdin.end();
    await closed;
    clearTimeout(timer);
  }
}

export function createLocalWorkflowPostMergeFastForward(context) {
  const { root, git, localView, remoteTip, active, repository, requireWitness, divergence, proveHistory, gitPath,
    beforeRefCommit } = context;
  const gitDir = path.join(root, '.git');
  const index = path.join(gitDir, 'index'), indexLock = index + '.lock', configLock = path.join(gitDir, 'config.lock');

  function files(plan) {
    agentRunPhysicalPath(gitDir, { directory: true });
    if (gitPath('index') !== index || gitPath('HEAD') !== path.join(gitDir, 'HEAD'))
      fail('WORKTREE_UNSUPPORTED');
    const head = gitPath('HEAD'), ref = gitPath(plan.source_ref);
    return { head, ref, headLog: gitPath('logs/HEAD'), branchLog: gitPath('logs/' + plan.source_ref) };
  }

  function environment(files, { indexOwned = false, refsOwned = false, configOwned = false } = {}) {
    const { head, ref } = files;
    physical(head);
    physical(ref, true);
    physical(path.join(gitDir, 'packed-refs'), true);
    const config = readAgentRunFile(path.join(gitDir, 'config'), { maxBytes: 65536, json: false });
    const rows = git(['config', '--local', '--no-includes', '--null', '--list']).value.split('\0').filter(Boolean);
    if (rows.some(row => !safeConfig.test(row.split('\n', 1)[0]))) fail('CONFIG_UNSUPPORTED');
    const worktrees = git(['worktree', 'list', '--porcelain', '-z']).value.split('\0').filter(row => row.startsWith('worktree '));
    if (worktrees.length !== 1 || operationPaths.some(name => fs.existsSync(agentRunPhysicalPath(path.join(gitDir, name), { missing: true })))) fail('WORKTREE_UNSUPPORTED');
    if (Boolean(physical(configLock, true)) !== configOwned || Boolean(physical(indexLock, true)) !== indexOwned
      || physical(indexLock + '.lock', true)
      || (physical(head + '.lock', true) !== null) !== refsOwned || (physical(ref + '.lock', true) !== null) !== refsOwned)
      fail('LOCK_STATE_CHANGED');
    if (git(['for-each-ref', '--count=1', '--format=%(refname)', 'refs/replace/']).value) fail('REPLACEMENT_OBJECTS_UNSUPPORTED');
    if (git(['rev-parse', '--shared-index-path']).value) fail('INDEX_UNSUPPORTED');
    const rowsIndex = git(['ls-files', '-v', '-z']).value.split('\0').filter(Boolean);
    if (rowsIndex.some(row => !row.startsWith('H '))) fail('INDEX_UNSUPPORTED');
    return config.sha256;
  }

  function changedPaths(plan) {
    const entries = git(['diff-tree', '--raw', '--no-abbrev', '--no-renames', '--no-commit-id', '-r', '-z',
      plan.local_head, plan.remote_head]).value.split('\0');
    if (entries.pop() !== '' || entries.length % 2 || entries.length > 128) fail('PATH_BOUNDS');
    const changes = [], folded = new Map();
    for (let i = 0; i < entries.length; i += 2) {
      const match = /^:(000000|100644|100755) (000000|100644|100755) ([a-f0-9]{40,64}) ([a-f0-9]{40,64}) [AMD]$/.exec(entries[i]);
      const name = entries[i + 1], parts = name.split('/');
      if (!match || name.length > 200 || parts.some(part => !/^[A-Za-z0-9._-]{1,100}$/.test(part) || part.endsWith('.')
        || /^(?:\.git|\.gitmodules|\.gitattributes|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
        fail('PATH_UNSUPPORTED');
      let prefix = '';
      for (const part of parts) {
        prefix = prefix ? prefix + '/' + part : part;
        const key = prefix.toLowerCase();
        if (folded.has(key) && folded.get(key) !== prefix) fail('PATH_COLLISION');
        folded.set(key, prefix);
      }
      changes.push({ name, before: match[1] === '000000' ? null : match[3], after: match[2] === '000000' ? null : match[4] });
    }
    const blobs = [...new Set(changes.flatMap(change => [change.before, change.after]).filter(Boolean))];
    if (blobs.length) {
      const sizes = git(['cat-file', '--batch-check=%(objecttype) %(objectsize)'], [0], { input: blobs.join('\n') + '\n' }).value.split(/\r?\n/);
      const bytes = sizes.map(row => /^blob (\d+)$/.exec(row)?.[1]).map(Number);
      if (sizes.length !== blobs.length || bytes.some(size => !Number.isSafeInteger(size) || size > 16 * 1024 * 1024)
        || bytes.reduce((sum, size) => sum + size, 0) > 64 * 1024 * 1024) fail('BLOB_BOUNDS');
    }
    return changes;
  }

  function checkPaths(changes, side) {
    return shadowHash(changes.map(change => {
      const full = path.join(root, change.name);
      const parent = path.dirname(full);
      const physicalParent = agentRunPhysicalPath(parent, { missing: true });
      if (physicalParent !== parent) fail('PATH_COLLISION');
      const stat = physical(full, true), expected = change[side];
      if (!expected) {
        if (stat) fail('PATH_COLLISION');
        return [change.name, null];
      }
      if (!stat || stat.size > 16n * 1024n * 1024n || fs.realpathSync.native(full) !== full
        || git(['hash-object', '--path=' + change.name, '--', change.name]).value !== expected)
        fail('PATH_CONTENT_CHANGED');
      return [change.name, readAgentRunFile(full, { maxBytes: 16 * 1024 * 1024, json: false }).sha256];
    }));
  }

  function view(plan, fetchPlan, fetchSha, owned = {}) {
    const paths = files(plan), config = environment(paths, owned);
    if (repository() !== plan.repository_sha256) fail('REPOSITORY_CHANGED');
    requireWitness(fetchPlan, fetchSha);
    const status = localView(fetchPlan.branch, { indexOwned: owned.indexOwned, sourceLocked: owned.refsOwned });
    return { paths, config, status };
  }

  function preimage(plan, fetchPlan, fetchSha, owned = {}) {
    const { paths, config, status } = view(plan, fetchPlan, fetchSha, owned);
    if (status.ref !== plan.source_ref || status.head !== plan.local_head) fail('SOURCE_CHANGED');
    const { ahead, behind } = divergence(plan.local_head, plan.remote_head);
    if (ahead !== 0 || behind !== plan.behind || behind <= 0) fail('HISTORY_CHANGED');
    proveHistory(plan.local_head, plan.remote_head);
    proveHistory(fetchPlan.merge_oid, plan.remote_head);
    git(['diff-index', '--cached', '--quiet', plan.local_head, '--']);
    const changes = changedPaths(plan), filesSha = checkPaths(changes, 'before');
    const added = changes.filter(change => !change.before).map(change => change.name);
    // Git read-tree can overwrite ignored paths. Require additions to be
    // non-ignored so Git also protects a collision that appears at dispatch.
    if (added.length && git(['check-ignore', '-z', '--stdin'], [0, 1], { input: added.join('\0') + '\0' }).status === 0)
      fail('IGNORED_ADDITION_UNSUPPORTED');
    return { paths, changes, observed: { config_sha256: config, local_sha256: status.sha256,
      changes_sha256: shadowHash(changes), files_sha256: filesSha,
      head_reflog: logSummary(reflog(paths.headLog)), branch_reflog: logSummary(reflog(paths.branchLog)) } };
  }

  const markerFor = hash => 'AIDN post-merge fast-forward ' + hash;
  const checkout = plan => ['read-tree', '-m', '-u', '--no-sparse-checkout', plan.local_head, plan.remote_head];
  function postimage(plan, planSha, fetchPlan, fetchSha) {
    const { paths, config, status } = view(plan, fetchPlan, fetchSha);
    if (status.ref !== plan.source_ref || status.head !== plan.remote_head || config !== plan.before.config_sha256)
      fail('POSTIMAGE_CHANGED');
    proveAppend(reflog(paths.headLog), plan.before.head_reflog, plan.local_head, plan.remote_head, markerFor(planSha));
    proveAppend(reflog(paths.branchLog), plan.before.branch_reflog, plan.local_head, plan.remote_head, markerFor(planSha));
    const changes = changedPaths(plan);
    if (shadowHash(changes) !== plan.before.changes_sha256) fail('POSTIMAGE_CHANGED');
    const worktreeSha = checkPaths(changes, 'after');
    git(['diff-index', '--cached', '--quiet', plan.remote_head, '--']);
    const indexSha = readAgentRunFile(index, { maxBytes: indexLimit, json: false }).sha256;
    const last = view(plan, fetchPlan, fetchSha);
    if (last.config !== config || last.status.sha256 !== status.sha256) fail('POSTIMAGE_CHANGED');
    return { source_ref: plan.source_ref, local_head: plan.local_head, remote_head: plan.remote_head,
      index_sha256: indexSha, worktree_sha256: worktreeSha, plan_sha256: planSha };
  }

  return Object.freeze({
    async prepare(fetchPlan, fetchSha, alignment, operationId, signal) {
      active(signal);
      if (alignment.source_ref !== fetchPlan.source_ref || alignment.merge_oid !== fetchPlan.merge_oid
        || alignment.proof_ref !== fetchPlan.proof_ref || alignment.fetched_head !== fetchPlan.remote_head
        || alignment.ahead !== 0 || alignment.behind <= 0) fail('SUBJECT_INVALID');
      const { source_ref, local_head, remote_head, behind } = alignment;
      const plan = { operation_id: operationId, repository_sha256: repository(), fetch_plan_sha256: fetchSha,
        source_ref, local_head, remote_head, behind };
      if (await remoteTip(source_ref, signal) !== remote_head) fail('REMOTE_MOVED');
      const { observed } = preimage(plan, fetchPlan, fetchSha);
      if (await remoteTip(source_ref, signal) !== remote_head) fail('REMOTE_MOVED');
      if (!exact(preimage(plan, fetchPlan, fetchSha).observed, observed)) fail('PREIMAGE_CHANGED');
      return { ...plan, before: observed };
    },
    async apply(plan, planSha, fetchPlan, fetchSha, { signal, assertAuthorized }) {
      const current = owned => {
        active(signal);
        const state = preimage(plan, fetchPlan, fetchSha, owned);
        if (!exact(state.observed, plan.before)) fail('PREIMAGE_CHANGED');
        return state;
      };
      const refreshRemote = async () => {
        if (await remoteTip(plan.source_ref, signal) !== plan.remote_head) fail('REMOTE_MOVED');
      };
      let ownedIndex, ownedConfig, attempted = false;
      function releaseConfig() {
        if (!ownedConfig) return;
        const remaining = physical(configLock, true);
        if (!remaining || !sameIdentity(remaining, ownedConfig))
          throw Object.assign(Error(prefix + 'LOCK_STATE_CHANGED'), { code: prefix + 'LOCK_STATE_CHANGED', effect_status: 'unknown' });
        fs.unlinkSync(configLock);
        ownedConfig = null;
      }
      try {
        await refreshRemote();
        await assertAuthorized();
        current();
        const cfg = fs.openSync(configLock, 'wx');
        try { ownedConfig = fs.fstatSync(cfg, { bigint: true }); }
        finally { fs.closeSync(cfg); }
        const preIndex = readAgentRunFile(index, { maxBytes: indexLimit, json: false });
        const fd = fs.openSync(indexLock, 'wx');
        try {
          ownedIndex = fs.fstatSync(fd, { bigint: true });
          fs.writeFileSync(fd, preIndex.value);
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        const { paths } = current({ indexOwned: true, configOwned: true });
        const pinnedIndex = () => {
          if (!sameIdentity(physical(indexLock), ownedIndex)
            || readAgentRunFile(indexLock, { maxBytes: indexLimit, json: false }).sha256 !== preIndex.sha256
            || readAgentRunFile(index, { maxBytes: indexLimit, json: false }).sha256 !== preIndex.sha256)
            fail('INDEX_CHANGED');
        };
        const prepare = ['start', 'option no-deref', 'update ' + plan.source_ref + ' ' + plan.remote_head + ' ' + plan.local_head, 'prepare', ''].join('\n');
        await withRefTransaction(context, { marker: markerFor(planSha), prepare }, async commit => {
          const headLock = physical(paths.head + '.lock'), refLock = physical(paths.ref + '.lock');
          await refreshRemote();
          await assertAuthorized();
          const { changes } = current({ indexOwned: true, refsOwned: true, configOwned: true });
          pinnedIndex();
          if (!sameIdentity(ownedConfig, physical(configLock)) || !sameIdentity(headLock, physical(paths.head + '.lock'))
            || !sameIdentity(refLock, physical(paths.ref + '.lock')))
            fail('LOCK_STATE_CHANGED');
          attempted = true;
          const options = { indexFile: indexLock };
          git(checkout(plan), [0], options);
          git(['diff-index', '--cached', '--quiet', plan.remote_head, '--'], [0], options);
          git(['diff-files', '--quiet', '--'], [0], options);
          checkPaths(changes, 'after');
          const readyIndex = readAgentRunFile(indexLock, { maxBytes: indexLimit, json: false });
          beforeRefCommit?.();
          active(signal);
          await commit();
          readAgentRunFile(indexLock, { maxBytes: indexLimit, json: false, sha256: readyIndex.sha256 });
          fs.renameSync(indexLock, index);
        });
        releaseConfig();
        return postimage(plan, planSha, fetchPlan, fetchSha);
      } catch (cause) {
        releaseConfig();
        if (attempted) throw Object.assign(Error(prefix + 'RECONCILIATION_REQUIRED'), { code: prefix + 'RECONCILIATION_REQUIRED', effect_status: 'unknown', cause });
        if (ownedIndex) {
          const remaining = physical(indexLock, true);
          if (!remaining || !sameIdentity(remaining, ownedIndex))
            throw Object.assign(Error(prefix + 'LOCK_STATE_CHANGED'), { code: prefix + 'LOCK_STATE_CHANGED', effect_status: 'unknown' });
          fs.unlinkSync(indexLock);
        }
        throw Object.assign(cause, { effect_status: 'no_effect' });
      }
    },
    recover(plan, planSha, fetchPlan, fetchSha, signal) {
      active(signal);
      return postimage(plan, planSha, fetchPlan, fetchSha);
    },
  });
}
