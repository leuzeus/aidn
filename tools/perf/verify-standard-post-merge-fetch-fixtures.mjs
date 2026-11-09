import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createLocalWorkflowPostMergeFetch } from '../../src/adapters/runtime/local-workflow-post-merge-fetch.mjs';
import { createStandardGithubProviderHost } from '../../src/adapters/runtime/standard-github-provider-host.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const tmp = fs.realpathSync(os.tmpdir());
const root = fs.mkdtempSync(path.join(tmp, 'aidn-post-merge-fetch-'));
const bare = path.join(root, 'remote.git'), writer = path.join(root, 'writer'), client = path.join(root, 'client');
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
const env = { ...environment,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
function git(cwd, args, expected = 0) {
  const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, expected, String(result.stderr).slice(-1000));
  return result.stdout.trimEnd();
}
function setup(cwd) {
  git(cwd, ['config', 'user.email', 'test@example.invalid']);
  git(cwd, ['config', 'user.name', 'AIDN fixture']);
  git(cwd, ['config', 'commit.gpgSign', 'false']);
}
let transfers = 0, interruptTransfer = false;
const remoteUrl = pathToFileURL(bare).href;
const remote = {
  context_sha256: shadowHash({ remote: remoteUrl }),
  observeTip(ref) {
    const rows = git(client, ['ls-remote', '--refs', '--', remoteUrl, ref]).split(/\r?\n/);
    if (rows.length !== 1) return null;
    const [head, observed] = rows[0].split('\t');
    return observed === ref ? head : null;
  },
  transfer(oid) {
    ++transfers;
    git(client, ['fetch', '--no-write-fetch-head', '--no-tags', '--no-prune', '--no-recurse-submodules',
      '--no-auto-maintenance', '--refmap=', '--', remoteUrl, oid]);
    if (interruptTransfer) throw Error('fixture: loss after object transfer');
  },
};
const port = () => createLocalWorkflowPostMergeFetch({ targetRoot: client, remote, environment });
const input = (mergeOid, index) => ({ sourceBranch: 'main', mergeOid, operationId: 'op_' + index.toString(16).padStart(40, '0') });
const options = (prepared, assertAuthorized = async () => {}) => ({ write: true, expectPlan: prepared.plan_sha256, assertAuthorized });
function observation() {
  const fetchHead = path.join(client, '.git', 'FETCH_HEAD');
  return {
    head: git(client, ['rev-parse', 'HEAD']),
    tracking: git(client, ['rev-parse', 'refs/remotes/origin/main']),
    status: git(client, ['status', '--porcelain']),
    fetch_head: fs.existsSync(fetchHead) ? fs.readFileSync(fetchHead, 'utf8') : null,
  };
}
function advance(message) {
  git(writer, ['commit', '--allow-empty', '-m', message]);
  git(writer, ['push', 'origin', 'main']);
  return git(writer, ['rev-parse', 'HEAD']);
}
try {
  git(root, ['init', '--bare', '--initial-branch=main', bare]);
  git(root, ['init', '--initial-branch=main', writer]);
  setup(writer);
  git(writer, ['remote', 'add', 'origin', remoteUrl]);
  const initial = advance('initial');
  git(root, ['clone', '--', remoteUrl, client]);
  setup(client);
  git(writer, ['switch', '-c', 'session']);
  git(writer, ['commit', '--allow-empty', '-m', 'session work']);
  git(writer, ['switch', 'main']);
  git(writer, ['merge', '--no-ff', '-m', 'merge session', 'session']);
  git(writer, ['push', 'origin', 'main']);
  const merge = git(writer, ['rev-parse', 'HEAD']);
  const before = observation(), adapter = port();
  assert.equal(before.head, initial);
  assert.equal(before.tracking, initial);
  git(client, ['cat-file', '-e', merge + '^{commit}'], 128);
  const prepared = await adapter.prepare(input(merge, 1));
  assert.deepEqual(observation(), before);
  assert.equal(transfers, 0);
  await assert.rejects(adapter.apply(prepared, { expectPlan: prepared.plan_sha256 }),
    { code: 'WORKFLOW_POST_MERGE_EXPLICIT_WRITE_REQUIRED' });
  await assert.rejects(adapter.apply(prepared, options(prepared, async () => { throw Error('refused'); })), /refused/);
  assert.equal(transfers, 0);
  const fetched = await adapter.apply(prepared, options(prepared));
  assert.equal(fetched.fetched_head, merge);
  assert.equal(fetched.ahead, 0);
  assert.equal(fetched.behind, 2);
  assert.deepEqual(observation(), before);
  const retained = path.join(root, 'fetch-plan.json');
  fs.writeFileSync(retained, JSON.stringify({ prepared, targetRoot: client, remoteIdentity: remote.context_sha256 }));
  const adapterUrl = new URL('../../src/adapters/runtime/local-workflow-post-merge-fetch.mjs', import.meta.url).href;
  const recovered = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { createLocalWorkflowPostMergeFetch } from ${JSON.stringify(adapterUrl)};
    const { prepared, targetRoot, remoteIdentity } = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const forbidden = () => { throw Error('recovery may only read local Git'); };
    const remote = { context_sha256: remoteIdentity, observeTip: forbidden, transfer: forbidden };
    const port = createLocalWorkflowPostMergeFetch({ targetRoot, remote });
    console.log(JSON.stringify(port.recover(prepared, { expectPlan: prepared.plan_sha256 })));
  `, retained], { env: environment, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.deepEqual(JSON.parse(recovered), fetched);
  assert.equal(transfers, 1);
  console.log('PASS stale tracking ref remains unchanged, real fetch proves 0/2 and read-only recovery');

  const moving = await adapter.prepare(input(merge, 2));
  const next = advance('remote advances');
  await assert.rejects(adapter.apply(moving, options(moving)), { code: 'WORKFLOW_POST_MERGE_REMOTE_MOVED', effect_status: 'no_effect' });
  assert.equal(transfers, 1);
  git(client, ['switch', '-c', 'other']);
  await assert.rejects(adapter.prepare(input(merge, 3)), { code: 'WORKFLOW_POST_MERGE_SOURCE_CHECKOUT_REQUIRED' });
  git(client, ['switch', 'main']);
  fs.writeFileSync(path.join(client, 'dirty.txt'), 'fixture');
  await assert.rejects(adapter.prepare(input(merge, 3)), { code: 'WORKFLOW_POST_MERGE_SOURCE_CHECKOUT_REQUIRED' });
  fs.unlinkSync(path.join(client, 'dirty.txt'));
  console.log('PASS moved remote, wrong branch and dirty worktree fail before transfer');

  const lost = await adapter.prepare(input(merge, 4));
  interruptTransfer = true;
  await assert.rejects(adapter.apply(lost, options(lost)), { code: 'WORKFLOW_POST_MERGE_FETCH_RECONCILIATION_REQUIRED', effect_status: 'unknown' });
  assert.throws(() => port().recover(lost, { expectPlan: lost.plan_sha256 }), { code: 'WORKFLOW_POST_MERGE_PROOF_MISSING' });
  assert.equal(transfers, 2);
  git(client, ['update-ref', '--create-reflog', '-m', 'foreign write', lost.plan.proof_ref, next]);
  assert.throws(() => port().recover(lost, { expectPlan: lost.plan_sha256 }), { code: 'WORKFLOW_POST_MERGE_PROOF_INVALID' });
  assert.equal(transfers, 2);
  console.log('PASS interruption without a witness and a substituted ref cannot produce a result');

  git(client, ['merge', '--ff-only', next]);
  interruptTransfer = false;
  const aligned = await adapter.prepare(input(merge, 5));
  const exact = await adapter.apply(aligned, options(aligned));
  assert.equal(exact.ahead, 0);
  assert.equal(exact.behind, 0);
  assert.equal(exact.fetched_head, next);
  assert.equal(transfers, 3);
  console.log('PASS real post-merge descendant and current source agree at 0/0');

  const githubUrl = 'https://github.com/Fixture/repository.git';
  const advanced = advance('remote work');
  git(client, ['commit', '--allow-empty', '-m', 'local work']);
  const divergent = observation();
  git(client, ['remote', 'set-url', 'origin', githubUrl]);
  const home = path.join(root, 'host'), identity = 'post-merge', fixtureGh = path.join(home, 'gh');
  const configuration = { target_root: client, instance_id: 'fixture_post_merge' };
  const repository = { owner: 'Fixture', name: 'repository', node_id: 'R_fixture' };
  const actor = { login: 'fixture', node_id: 'U_fixture' };
  fs.mkdirSync(path.join(home, identity + '.github'), { recursive: true });
  fs.writeFileSync(fixtureGh, 'fixture-only binary pin');
  const gitExecutable = fs.realpathSync(execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'],
    { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean));
  const pin = name => ({ path: name, sha256: createHash('sha256').update(fs.readFileSync(name)).digest('hex') });
  fs.writeFileSync(path.join(home, identity + '.github.json'), JSON.stringify({
    ...configuration, contract_version: 'standard-host-github.v1', repository: { ...repository, host: 'github.com' },
    actor, gh: pin(fixtureGh), git: pin(gitExecutable),
  }));
  let protectedTransfers = 0, protectedReads = 0, protectedAuthorizations = 0;
  let changeAfter = null;
  const identityReads = [];
  const host = createStandardGithubProviderHost({ configuration, home, identity, environment }, {
    async runGithubRead(executable, args) {
      assert.equal(executable, fixtureGh);
      const endpoint = args.at(-1);
      const command = args[0] === 'auth' ? 'token' : endpoint;
      identityReads.push(command);
      if (changeAfter?.command === command) {
        await Promise.resolve();
        changeAfter.mutate();
      }
      const value = args[0] === 'auth' ? 'fixture-only-token' : JSON.stringify(endpoint === 'user' ? actor :
        { node_id: repository.node_id, full_name: 'Fixture/repository' });
      return { status: 0, stdout: value };
    },
    runRemoteGit(executable, args, gitOptions) {
      assert.equal(executable, gitExecutable);
      assert.equal(gitOptions.cwd, client);
      assert.match(gitOptions.env.AIDN_GITHUB_AUTH_HEADER, /^AUTHORIZATION: basic /);
      assert.equal(gitOptions.env.GH_TOKEN, undefined);
      const separator = args.indexOf('--');
      assert.equal(args[separator + 1], githubUrl);
      const remoteArgs = [args[separator - 2], args[separator - 1], '--', remoteUrl, args[separator + 2]];
      if (remoteArgs[0] === 'ls-remote') ++protectedReads;
      else {
        assert.equal(protectedAuthorizations, 2);
        assert.deepEqual(args.slice(args.indexOf('fetch'), separator), ['fetch', '--no-write-fetch-head', '--no-tags', '--no-prune',
          '--no-recurse-submodules', '--no-auto-maintenance', '--refmap=']);
        ++protectedTransfers;
        return { status: 0, stdout: git(client, ['fetch', '--no-write-fetch-head', '--refmap=', '--', remoteUrl, args.at(-1)]) };
      }
      return { status: 0, stdout: git(client, remoteArgs) };
    },
  });
  const credential = path.join(home, identity + '.github', 'hosts.yml');
  const fixtureGhBytes = fs.readFileSync(fixtureGh);
  for (const probe of [
    { command: 'token', mutate: () => fs.writeFileSync(credential, 'changed'), restore: () => fs.unlinkSync(credential),
      code: 'STANDARD_GITHUB_HOST_CREDENTIAL_CHANGED', reads: ['token'] },
    { command: 'user', mutate: () => git(client, ['remote', 'set-url', 'origin', 'https://example.invalid/wrong']),
      restore: () => git(client, ['remote', 'set-url', 'origin', githubUrl]),
      code: 'STANDARD_GITHUB_REPOSITORY_BINDING_INVALID', reads: ['token', 'user'] },
    { command: 'repos/Fixture/repository', mutate: () => fs.appendFileSync(fixtureGh, '!'),
      restore: () => fs.writeFileSync(fixtureGh, fixtureGhBytes),
      code: 'STANDARD_GITHUB_EXECUTABLE_PIN_CHANGED', reads: ['token', 'user', 'repos/Fixture/repository'] },
  ]) {
    identityReads.length = 0;
    changeAfter = probe;
    try {
      await assert.rejects(host.verifyIdentity(), { code: probe.code });
      assert.deepEqual(identityReads, probe.reads);
    } finally { changeAfter = null; probe.restore(); }
  }
  await host.verifyIdentity();
  console.log('PASS protected identity handshake refuses changed credentials, checkout and executable after transport');
  const protectedPort = host.sessionReviewPort.postMergeFetch;
  const protectedInput = { ...input(merge, 6), providerRepository: repository };
  assert.throws(() => protectedPort.prepare({ ...protectedInput, providerRepository: { ...repository, node_id: 'R_foreign' } }),
    { code: 'STANDARD_GITHUB_POST_MERGE_REPOSITORY_CHANGED' });
  git(client, ['config', 'http.proxy', 'https://example.invalid']);
  await assert.rejects(protectedPort.prepare(protectedInput), { code: 'STANDARD_GITHUB_POST_MERGE_CONFIG_UNSUPPORTED' });
  git(client, ['config', '--unset', 'http.proxy']);
  assert.equal(protectedReads, 0);
  assert.equal(protectedTransfers, 0);
  const protectedPlan = await protectedPort.prepare(protectedInput);
  const protectedResult = await protectedPort.apply(protectedPlan, options(protectedPlan, async () => { ++protectedAuthorizations; }));
  assert.equal(protectedResult.fetched_head, advanced);
  assert.equal(protectedResult.ahead, 1);
  assert.equal(protectedResult.behind, 1);
  assert.deepEqual(observation(), divergent);
  assert.equal(protectedTransfers, 1);
  assert.equal(protectedReads, 3);
  assert.equal(protectedAuthorizations, 3);
  assert.deepEqual(protectedPort.recover(protectedPlan, { expectPlan: protectedPlan.plan_sha256 }), protectedResult);
  assert.equal(protectedTransfers, 1);
  assert.equal(protectedReads, 3);
  const fresh = await protectedPort.observeAlignment(protectedPlan, { expectPlan: protectedPlan.plan_sha256 });
  assert.equal(fresh.ahead, 1);
  assert.equal(fresh.behind, 1);
  assert.equal(fresh.local_head, divergent.head);
  assert.equal(fresh.remote_head, advanced);
  assert.equal(fresh.proof_ref, protectedResult.proof_ref);
  assert.deepEqual(observation(), divergent);
  assert.equal(protectedTransfers, 1);
  assert.equal(protectedReads, 5);
  console.log('PASS protected host checks repository, rejects Git overrides and separates the authenticated fetch effect');
  console.log('PASS protected read-only alignment retains real 1/1 divergence and performs no transfer');
} finally {
  const verified = fs.realpathSync(root);
  assert.equal(path.dirname(verified), tmp);
  assert.match(path.basename(verified), /^aidn-post-merge-fetch-/);
  fs.rmSync(verified, { recursive: true, force: false });
}
