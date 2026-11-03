import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createGithubSessionPush } from '../../src/adapters/git-provider/github-session-push.mjs';
import { createStandardSessionPush } from '../../src/application/runtime/standard-session-push.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
const parent = fs.realpathSync(os.tmpdir()), owned = [], H = 'a'.repeat(64), op = n => 'op_' + n.repeat(40);
const preparations = new Set();
const gitExecutable = fs.realpathSync(execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (root, ...args) => execFileSync(gitExecutable, ['-C', root, '-c', 'core.hooksPath=NUL', ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
const token = 'fixture-secret-never-in-args', repository = { owner: 'fixture', name: 'repository', node_id: 'R_fixture' }, actor = { node_id: 'U_fixture', login: 'fixture-actor' };
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_|^GH_|^GITHUB_/i.test(name)));
let checks = 0; const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
function fixture() {
  const base = fs.mkdtempSync(path.join(parent, 'aidn-github-push-')); owned.push(base); const root = path.join(base, 'project'), remote = path.join(base, 'remote.git');
  fs.mkdirSync(root); fs.mkdirSync(remote); git(root, 'init', '-b', 'dev'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  fs.mkdirSync(path.join(root, '.aidn')); fs.writeFileSync(path.join(root, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'files' } }));
  fs.writeFileSync(path.join(root, '.gitignore'), '.aidn/runtime/\n'); fs.writeFileSync(path.join(root, 'app.txt'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture base');
  git(remote, 'init', '--bare'); git(root, 'push', remote, 'HEAD:refs/heads/dev'); const initial = git(root, 'rev-parse', 'HEAD');
  git(root, 'switch', '-c', 'S001-host'); fs.writeFileSync(path.join(root, 'app.txt'), 'delivery\n'); git(root, 'add', 'app.txt'); git(root, 'commit', '-m', 'fixture delivery');
  const head = git(root, 'rev-parse', 'HEAD'), state = { actor: structuredClone(actor), repository_id: repository.node_id, push_permission: true, pushes: 0, calls: 0,
    afterPush: null, beforePush: null, remoteFault: null, referenceFault: false };
  const configuration = { targetRoot: root, gitExecutable, gitSha256: sha(gitExecutable), githubExecutable: process.execPath, githubSha256: sha(process.execPath), repository, actor, environment };
  const ref = branch => { const r = spawnSync(gitExecutable, ['--git-dir=' + remote, 'rev-parse', '--verify', 'refs/heads/' + branch], { encoding: 'utf8', windowsHide: true }); return r.status === 0 ? r.stdout.trim() : null; };
  const seams = { runGithub(_binary, args, options) {
    state.calls++; assert.ok(!JSON.stringify(args).includes(token));
    if (args[0] === 'auth') return { status: 0, stdout: token + '\n' };
    assert.equal(options.env.GH_TOKEN, token); assert.equal(args[4], 'GET'); let value;
    if (args[5] === 'user') value = { node_id: state.actor.node_id, login: state.actor.login };
    else if (args[5] === 'repos/fixture/repository') value = { node_id: state.repository_id, full_name: 'fixture/repository', permissions: { push: state.push_permission } };
    else { const branch = decodeURIComponent(args[5].split('/git/ref/heads/')[1]); value = { ref: 'refs/heads/' + branch, object: { type: 'commit', sha: state.referenceFault ? 'b'.repeat(40) : ref(branch) } }; }
    return { status: 0, stdout: JSON.stringify(value) };
  }, runRemoteGit(binary, args, options) {
    assert.equal(binary, gitExecutable); assert.ok(!JSON.stringify(args).includes(token)); assert.equal(options.shell, false);
    assert.equal(options.env.AIDN_GITHUB_AUTH_HEADER, 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token).toString('base64'));
    assert.ok(args.includes('http.followRedirects=false')); assert.ok(args.includes('credential.helper='));
    assert.ok(args.includes('core.hooksPath=NUL') || args.includes('core.hooksPath=/dev/null'));
    const action = args.includes('push') ? 'push' : 'ls-remote';
    if (action === 'push') {
      const prepared = args.find(arg => arg.startsWith('--git-dir='))?.slice(10);
      assert.ok(prepared); assert.equal(path.dirname(prepared), parent); assert.notEqual(options.cwd, root); assert.ok(!args.includes(root)); preparations.add(prepared);
      const manifest = JSON.parse(fs.readFileSync(path.join(prepared, 'aidn-preparation.json')));
      assert.equal(manifest.head, head); assert.ok(!JSON.stringify(manifest).includes(token));
      state.pushes++; state.beforePush?.(); assert.ok(args.includes('--no-verify')); assert.ok(args.some(arg => arg.startsWith('--force-with-lease=refs/heads/S001-host:')));
    }
    // Only HTTPS transport is replaced. Git executes against actual bare refs
    // and retains its own force-with-lease and object/ref validation semantics.
    const translated = args.map(arg => arg === 'https://github.com/fixture/repository.git' ? pathToFileURL(remote).href : arg);
    const marker = translated.indexOf(action); translated.splice(marker, 0, '-c', 'protocol.file.allow=always');
    const result = spawnSync(binary, translated, options);
    if (action === 'push') { state.afterPush?.(); if (state.remoteFault) return { status: null, stdout: token, error: Error('synthetic timeout') }; }
    return result;
  } };
  return { base, root, remote, state, configuration, seams, head, initial, ref, port: extra => createGithubSessionPush(configuration, { ...seams, ...extra }) };
}
try {
  const f = fixture(); let ready;
  await test('authenticated host inspection pins repository/actor and observes Git without refs/index/checkout effects', () => {
    const before = git(f.root, 'show-ref'), status = git(f.root, 'status', '--porcelain'); ready = f.port().inspect('S001-host');
    assert.equal(ready.profile, 'github-https-git.v1'); assert.equal(ready.head, f.head); assert.equal(ready.remote_head, null);
    assert.equal(git(f.root, 'show-ref'), before); assert.equal(git(f.root, 'status', '--porcelain'), status); assert.equal(f.state.pushes, 0);
    assert.ok(!JSON.stringify(ready).includes(token));
  });
  await test('wrong executable pins or caller Git scope cannot reach a provider', () => {
    const calls = f.state.calls;
    for (const change of [{ gitSha256: '0'.repeat(64) }, { githubSha256: '0'.repeat(64) }, { environment: { ...environment, GIT_DIR: f.remote } }])
      assert.throws(() => createGithubSessionPush({ ...f.configuration, ...change }, f.seams));
    assert.equal(f.state.calls, calls);
  });
  await test('wrong authenticated actor/repository or missing push permission refuses before a remote mutation', () => {
    f.state.actor.node_id = 'U_other'; assert.throws(() => f.port().inspect('S001-host'), { code: 'GITHUB_PUSH_IDENTITY_CHANGED' }); f.state.actor = structuredClone(actor);
    f.state.repository_id = 'R_other'; assert.throws(() => f.port().inspect('S001-host'), { code: 'GITHUB_PUSH_IDENTITY_CHANGED' }); f.state.repository_id = repository.node_id;
    f.state.push_permission = false; assert.throws(() => f.port().inspect('S001-host'), { code: 'GITHUB_PUSH_IDENTITY_CHANGED' }); f.state.push_permission = true; assert.equal(f.state.pushes, 0);
  });
  await test('URL rewrites and scoped HTTP/credential commands refuse before network observation', () => {
    for (const [key, value] of [['url.https://other.invalid/.insteadOf', 'https://github.com/'], ['http.https://github.com/.extraHeader', 'fixture'], ['credential.helper', '!fixture-command']]) {
      git(f.root, 'config', key, value); const calls = f.state.calls;
      assert.throws(() => f.port().inspect('S001-host'), { code: 'GITHUB_PUSH_TRANSPORT_CONFIGURATION_UNSUPPORTED' }); assert.equal(f.state.calls, calls); git(f.root, 'config', '--unset-all', key);
    }
  });
  await test('explicit write and a fresh exact Git plan are required before HTTPS push', async () => {
    await assert.rejects(f.port().push(ready, { write: false, assertAuthorized() {} }), { effect_status: 'no_effect' });
    await assert.rejects(f.port().push({ ...ready, head: f.initial }, { write: true, assertAuthorized() {} }), { effect_status: 'no_effect' });
    await assert.rejects(f.port().push(ready, { write: true, assertAuthorized() { throw Error('grant denied'); } }), { effect_status: 'no_effect' }); assert.equal(f.state.pushes, 0);
  });
  await test('actual application accepts the production profile and confirms one Git push with transport-only doubles', async () => {
    const instance = { instance_id: 'github-push-fixture', instance_sha256: H };
    const source = { admission_operation_id: op('1'), output: { outcome: 'completed', effect_status: 'no_effect', facts: { session_pr_admitted: true, session_push_required: true, session_pr_open_required: false },
      observations: { session_id: 'S001', session_branch: 'S001-host', head: f.head } }, integration_source_sha256: H };
    const app = createStandardSessionPush({ targetRoot: f.root, readAdmission: async () => structuredClone(source), readCurrent: () => instance, pushPort: f.port() });
    const prepared = await app.prepare(instance, { contract_version: 'standard-session-push-input.v1', admission_operation_id: op('1') }, op('2'));
    const result = await app.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.effect_status, 'confirmed'); assertStandardOperationOutput(result);
    assert.equal(f.ref('S001-host'), f.head); assert.equal(f.state.pushes, 1); assert.equal(result.observations.git.profile, 'github-https-git.v1');
    assert.ok(!JSON.stringify(result).includes(token)); assert.equal(git(f.root, 'status', '--porcelain'), '');
    assert.ok([...preparations].every(directory => !fs.existsSync(directory)));
  });
  await test('an already equal tip observes no effect and an inconsistent API tip cannot confirm Git', async () => {
    const port = f.port(), observed = port.inspect('S001-host'), output = await port.push(observed, { write: true, assertAuthorized() {} });
    assert.equal(output.effect_status, 'no_effect'); assert.equal(output.changed, false); assert.equal(f.state.pushes, 1);
    f.state.referenceFault = true; assert.throws(() => port.inspect('S001-host'), { code: 'GITHUB_PUSH_REMOTE_REF_CHANGED' }); f.state.referenceFault = false;
  });
  await test('transport observation has a cumulative deadline and never exposes credentials in errors', () => {
    let clock = 1000000; const port = f.port({ now: () => clock, runGithub(binary, args, options) { const result = f.seams.runGithub(binary, args, options); clock += 60001; return result; } });
    assert.throws(() => port.inspect('S001-host'), error => error.code === 'GITHUB_PUSH_LIMIT' && !String(error).includes(token));
  });
  await test('lost grant after an actual remote effect is unknown without a retry', async () => {
    const u = fixture(); let allowed = true; u.state.afterPush = () => { allowed = false; };
    const port = u.port(), observed = port.inspect('S001-host');
    await assert.rejects(port.push(observed, { write: true, assertAuthorized() { if (!allowed) throw Error('denied'); } }), { effect_status: 'unknown', code: 'GITHUB_PUSH_RECONCILIATION_REQUIRED' });
    assert.equal(u.ref('S001-host'), u.head); assert.equal(u.state.pushes, 1);
    await assert.rejects(port.push(observed, { write: true, assertAuthorized() {} }), { effect_status: 'unknown' }); assert.equal(u.state.pushes, 1);
  });
  await test('a timeout after Git changed the ref stays unknown with a sanitized error and no retry', async () => {
    const u = fixture(); u.state.remoteFault = true; const port = u.port(), observed = port.inspect('S001-host');
    await assert.rejects(port.push(observed, { write: true, assertAuthorized() {} }), error => error.effect_status === 'unknown' && !String(error).includes(token));
    assert.equal(u.ref('S001-host'), u.head); assert.equal(u.state.pushes, 1);
  });
  await test('a concurrent remote creation defeats the exact lease and is never overwritten', async () => {
    const u = fixture(); u.state.beforePush = () => git(u.remote, 'update-ref', 'refs/heads/S001-host', u.initial); const port = u.port(), observed = port.inspect('S001-host');
    await assert.rejects(port.push(observed, { write: true, assertAuthorized() {} }), { effect_status: 'unknown' });
    assert.equal(u.ref('S001-host'), u.initial); assert.equal(u.state.pushes, 1);
  });
  await test('a checkout URL rewrite appearing at dispatch cannot redirect credentials or the isolated Git effect', async () => {
    const u = fixture(), port = u.port(), observed = port.inspect('S001-host');
    u.state.beforePush = () => git(u.root, 'config', 'url.https://other.invalid/.insteadOf', 'https://github.com/');
    // The intended bare ref changes through the isolated transport, while the
    // fresh postcondition rejects the concurrent checkout context. No success
    // fact or retry is inferred from that actual but unconfirmed effect.
    await assert.rejects(port.push(observed, { write: true, assertAuthorized() {} }), { effect_status: 'unknown' });
    assert.equal(u.ref('S001-host'), u.head); assert.equal(u.state.pushes, 1);
  });
  await test('nonancestor remote history and untracked local work refuse without a push', () => {
    const u = fixture(); fs.writeFileSync(path.join(u.root, 'unrelated.txt'), 'untracked');
    const calls = u.state.calls; assert.throws(() => u.port().inspect('S001-host')); assert.equal(u.state.calls, calls); fs.unlinkSync(path.join(u.root, 'unrelated.txt'));
    const other = git(u.root, 'commit-tree', git(u.root, 'rev-parse', u.initial + '^{tree}'), '-p', u.initial, '-m', 'fixture sibling');
    git(u.root, 'push', u.remote, other + ':refs/heads/S001-host');
    assert.throws(() => u.port().inspect('S001-host'), { code: 'GITHUB_PUSH_REMOTE_DIVERGED' }); assert.equal(u.state.pushes, 0); assert.equal(u.ref('S001-host'), other);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, git_local_ancestry_lease_remote_and_application: 'ACTUAL', http_and_https_transports: 'DOUBLED',
    authenticated_actor_repository_responses: 'FIXTURE', admission_source: 'INJECTED_FIXTURE', real_github_network: 'NOT_RUN', full_standard_chain: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally {
  for (const directory of preparations) if (fs.existsSync(directory)) {
    const real = fs.realpathSync(directory); assert.equal(real, directory); assert.equal(path.dirname(real), parent); assert.ok(/^aidn-github-push-transport-[a-f0-9]{64}$/.test(path.basename(real)));
    fs.rmSync(real, { recursive: true, force: false });
  }
  for (const base of owned.reverse()) { const real = fs.realpathSync(base); assert.equal(path.dirname(real), parent); assert.ok(path.basename(real).startsWith('aidn-github-push-')); fs.rmSync(real, { recursive: true, force: true }); }
  console.log(JSON.stringify({ cleanup_completed: true }));
}
