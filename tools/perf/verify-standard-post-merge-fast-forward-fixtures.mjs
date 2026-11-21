import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createLocalWorkflowPostMergeFetch } from '../../src/adapters/runtime/local-workflow-post-merge-fetch.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-r09-fast-forward-'));
const remoteDir = path.join(root, 'remote.git'), client = path.join(root, 'client');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
const env = { ...environment,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

function run(cwd, args, expected = 0) {
  const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, expected, result.stderr);
  return result.stdout.trimEnd();
}
const git = (...args) => run(client, args);
const bare = (...args) => run(remoteDir, args);
const remoteUrl = pathToFileURL(remoteDir).href;
const source = 'refs/heads/main', index = path.join(client, '.git', 'index');
const indexLock = index + '.lock', add = path.join(client, 'new.txt'), update = path.join(client, 'tracked.txt');
const foreign = path.join(client, 'untouched.tmp');
let transfers = 0, prepareId = 0;
const remote = {
  context_sha256: shadowHash(remoteUrl),
  observeTip(ref) { return git('ls-remote', '--refs', '--', remoteUrl, ref).split('\t')[0]; },
  transfer(oid) {
    ++transfers;
    git('fetch', '--no-write-fetch-head', '--no-tags', '--refmap=', '--', remoteUrl, oid);
  },
};
const port = () => createLocalWorkflowPostMergeFetch({ targetRoot: client, remote, environment });
const id = () => 'op_' + String(++prepareId).padStart(40, '0');
const permit = async () => {};
const opts = (plan, assertAuthorized = permit) => ({ write: true, expectPlan: shadowHash(plan), assertAuthorized });
const save = (file, value) => fs.writeFileSync(file, value);
console.log(JSON.stringify({ evidence: root }));
run(root, ['init', '-q', '--bare', remoteDir]);
run(root, ['init', '-q', '-b', 'main', client]);
git('config', 'user.name', 'Fixture');
git('config', 'user.email', 'fixture@example.invalid');
git('remote', 'add', 'origin', remoteUrl);
save(update, 'initial\n');
save(path.join(client, 'remove.txt'), 'remove\n');
git('add', '--', 'tracked.txt', 'remove.txt');
git('commit', '-qm', 'initial');
const initial = git('rev-parse', 'HEAD');
git('switch', '-qc', 'fixture-remote');
save(update, 'updated\n');
save(add, 'new\n');
git('rm', '-q', 'remove.txt');
git('add', '--', 'tracked.txt', 'new.txt');
git('commit', '-qm', 'remote commit');
const target = git('rev-parse', 'HEAD');
bare('fetch', '--no-write-fetch-head', '--', pathToFileURL(client).href, target);
bare('update-ref', source, target);
git('switch', '-q', 'main');
git('update-ref', 'refs/remotes/origin/main', initial);
git('branch', '--set-upstream-to=origin/main', 'main');
const exclude = path.join(client, '.git', 'info', 'exclude');
save(exclude, 'untouched.tmp\n');
save(foreign, 'preserve\n');
const adapter = port();
const fetch = await adapter.prepare({ sourceBranch: 'main', mergeOid: target, operationId: id() });
await adapter.apply(fetch, { write: true, expectPlan: fetch.plan_sha256, assertAuthorized: permit });
const aligned = await adapter.observeAlignment(fetch, { expectPlan: fetch.plan_sha256 });
const request = () => ({ alignment: aligned, operationId: id() });
const prepare = () => adapter.prepareFastForward(fetch, request());
const plan = await prepare();
const preimage = fs.readFileSync(index);
assert.equal(git('rev-parse', 'HEAD'), initial);
assert.deepEqual(fs.readFileSync(index), preimage);
assert.throws(() => adapter.applyFastForward(plan, fetch, { expectPlan: shadowHash(plan) }), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_EXPLICIT_WRITE_REQUIRED' });
await assert.rejects(adapter.applyFastForward(plan, fetch, opts(plan, async () => { throw Error('grant revoked'); })), /grant revoked/);
assert.equal(fs.existsSync(indexLock), false);
const stopped = new AbortController();
stopped.abort();
await assert.rejects(adapter.applyFastForward(plan, fetch, { ...opts(plan), signal: stopped.signal }),
  { code: 'WORKFLOW_POST_MERGE_ABORTED', effect_status: 'no_effect' });
assert.equal(git('rev-parse', 'HEAD'), initial);

bare('update-ref', source, initial, target);
await assert.rejects(adapter.applyFastForward(plan, fetch, opts(plan)), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_REMOTE_MOVED', effect_status: 'no_effect' });
bare('update-ref', source, target, initial);
save(indexLock, 'foreign owner');
await assert.rejects(adapter.applyFastForward(plan, fetch, opts(plan)), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_LOCK_STATE_CHANGED' });
assert.equal(fs.readFileSync(indexLock, 'utf8'), 'foreign owner');
fs.unlinkSync(indexLock);
git('switch', '-qc', 'foreign-head');
await assert.rejects(adapter.applyFastForward(plan, fetch, opts(plan)), { code: 'WORKFLOW_POST_MERGE_SOURCE_CHECKOUT_REQUIRED' });
git('switch', '-q', 'main');
save(update, 'dirty\n');
await assert.rejects(prepare(), { code: 'WORKFLOW_POST_MERGE_SOURCE_CHECKOUT_REQUIRED' });
git('restore', '--', 'tracked.txt');
save(exclude, 'untouched.tmp\nnew.txt\n');
save(add, 'ignored collision\n');
await assert.rejects(prepare(), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_PATH_COLLISION' });
assert.equal(fs.readFileSync(add, 'utf8'), 'ignored collision\n');
fs.unlinkSync(add);
await assert.rejects(prepare(), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_IGNORED_ADDITION_UNSUPPORTED' });
save(exclude, 'untouched.tmp\n');
git('config', 'filter.unsafe.clean', 'must-not-run');
await assert.rejects(prepare(), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_CONFIG_UNSUPPORTED' });
git('config', '--remove-section', 'filter.unsafe');
git('replace', initial, target);
await assert.rejects(prepare(), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_REPLACEMENT_OBJECTS_UNSUPPORTED' });
git('replace', '-d', initial);
save(path.join(client, '.git', 'MERGE_HEAD'), target + '\n');
await assert.rejects(prepare(), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_WORKTREE_UNSUPPORTED' });
fs.unlinkSync(path.join(client, '.git', 'MERGE_HEAD'));
git('update-index', '--assume-unchanged', 'tracked.txt');
await assert.rejects(prepare(), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_INDEX_UNSUPPORTED' });
git('update-index', '--no-assume-unchanged', 'tracked.txt');
console.log('PASS grant, remote movement, ref/index locks, wrong HEAD, dirty files, ignored collision, unsafe configuration and Git operation refusal');

const changedIndex = await prepare();
save(update, 'staged\n');
git('add', '--', 'tracked.txt');
await assert.rejects(adapter.applyFastForward(changedIndex, fetch, opts(changedIndex)), { code: 'WORKFLOW_POST_MERGE_SOURCE_CHECKOUT_REQUIRED' });
git('restore', '--staged', '--worktree', '--', 'tracked.txt');
const headOnly = await prepare();
git('merge', '--ff-only', target);
assert.throws(() => port().recoverFastForward(headOnly, fetch, opts(headOnly)), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_REFLOG_UNCONFIRMED' });
git('switch', '-q', 'foreign-head');
git('update-ref', source, initial, target);
git('switch', '-q', 'main');
const concurrent = await prepare();
let grants = 0;
const result = await adapter.applyFastForward(concurrent, fetch, opts(concurrent, async () => {
  if (++grants === 2) {
    const head = run(client, ['symbolic-ref', 'HEAD']);
    assert.equal(head, source);
    run(client, ['symbolic-ref', 'HEAD', 'refs/heads/foreign-head'], 1);
    run(client, ['update-ref', source, target, initial], 128);
    const configWrite = spawnSync('git', ['-C', client, 'config', 'filter.unsafe.clean', 'fixture-never-run'],
      { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.ok(Number.isInteger(configWrite.status) && configWrite.status !== 0, configWrite.stderr);
    await assert.rejects(port().applyFastForward(concurrent, fetch, opts(concurrent)), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_LOCK_STATE_CHANGED' });
  }
}));
assert.equal(grants, 2);
assert.equal(git('symbolic-ref', 'HEAD'), source);
assert.equal(git('rev-parse', 'HEAD'), target);
assert.equal(bare('rev-parse', source), target);
assert.equal(git('rev-parse', 'refs/remotes/origin/main'), initial);
assert.equal(git('rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/main');
assert.equal(git('status', '--porcelain'), '');
assert.equal(git('write-tree'), git('rev-parse', target + '^{tree}'));
assert.equal(fs.readFileSync(foreign, 'utf8'), 'preserve\n');
assert.equal(fs.readFileSync(add, 'utf8').trim(), 'new');
assert.equal(fs.readFileSync(update, 'utf8').trim(), 'updated');
assert.equal(fs.existsSync(path.join(client, 'remove.txt')), false);
assert.equal(fs.existsSync(indexLock), false);
assert.equal(transfers, 1);
const forbid = () => assert.fail('recovery must use local evidence alone');
const coldPort = createLocalWorkflowPostMergeFetch({ targetRoot: client,
  remote: { context_sha256: remote.context_sha256, observeTip: forbid, transfer: forbid }, environment });
assert.deepEqual(coldPort.recoverFastForward(concurrent, fetch, opts(concurrent)), result);
assert.equal(git('reflog', '--format=%gs', source).split(/\r?\n/).filter(message => message === 'AIDN post-merge fast-forward ' + shadowHash(concurrent)).length, 1);
console.log('PASS exact checkout and correlated postimage, competing Git writers refused, same-target foreign movement refused, one local advance');

git('switch', '-q', 'fixture-remote');
save(update, 'partial checkout\n');
git('add', '--', 'tracked.txt');
git('commit', '-qm', 'second remote commit');
const next = git('rev-parse', 'HEAD');
bare('fetch', '--no-write-fetch-head', '--', pathToFileURL(client).href, next);
bare('update-ref', source, next, target);
git('switch', '-q', 'main');
const nextAlignment = await adapter.observeAlignment(fetch, { expectPlan: fetch.plan_sha256 });
const partial = await adapter.prepareFastForward(fetch, { alignment: nextAlignment, operationId: id() });
const intactIndex = fs.readFileSync(index);
const interrupted = createLocalWorkflowPostMergeFetch({ targetRoot: client, remote, environment,
  beforeFastForwardRefCommit() { throw Error('fixture interrupted between checkout and ref commit'); } });
await assert.rejects(interrupted.applyFastForward(partial, fetch, opts(partial)),
  { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_RECONCILIATION_REQUIRED', effect_status: 'unknown' });
assert.equal(git('rev-parse', 'HEAD'), target);
assert.deepEqual(fs.readFileSync(index), intactIndex);
assert.equal(fs.readFileSync(update, 'utf8').trim(), 'partial checkout');
assert.equal(fs.existsSync(indexLock), true);
assert.throws(() => coldPort.recoverFastForward(partial, fetch, opts(partial)), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_LOCK_STATE_CHANGED' });
await assert.rejects(port().applyFastForward(partial, fetch, opts(partial)), { code: 'WORKFLOW_POST_MERGE_FAST_FORWARD_LOCK_STATE_CHANGED' });
assert.equal(transfers, 1);
console.log('PASS interruption after checkout retains UNKNOWN, the owned index lock and original branch tip');
