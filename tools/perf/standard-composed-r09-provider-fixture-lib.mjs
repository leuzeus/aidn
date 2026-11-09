import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStandardGithubProviderHost } from '../../src/adapters/runtime/standard-github-provider-host.mjs';
import { createStandardHostAuthority, readStandardHostInstance } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { createGithubPrOpenTransportFixture } from './github-pr-open-fixture-lib.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';

const repository = { host: 'github.com', owner: 'fixture', name: 'repository', node_id: 'R_fixture' };
const actor = { login: 'fixture-operator', node_id: 'U_fixture_operator' };
const reviewer = { login: 'fixture-reviewer', node_id: 'U_fixture', type: 'User' };
const repoPath = 'repos/fixture/repository', origin = 'https://github.com/fixture/repository.git';
const ci = { name: 'Required CI', kind: 'check_run', producer_id: 'A_ci' };
const reviewRef = 'REVIEW_fixture';
const hooks = process.platform === 'win32' ? 'NUL' : '/dev/null';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const ok = value => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) });
const pin = executable => {
  const file = fs.realpathSync(executable);
  return { path: file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
};

// Only the subprocess transport is doubled. This fixture mutates the bare Git
// remote belonging to its own test arena. The product provider host still
// enforces its manifest, review evidence, exact mutation and local fetch plans.
export function createComposedGithubR09ProviderFixture({ targetRoot, controlRoot, remoteRoot, hostHome, instanceId, initialize = false }) {
  const arena = path.dirname(fs.realpathSync(controlRoot));
  assert.equal(fs.realpathSync(remoteRoot), fs.realpathSync(path.join(arena, 'session-push-remote.git')));
  assert.equal(path.dirname(fs.realpathSync(hostHome)), arena);
  const relativeTarget = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(targetRoot));
  assert.ok(relativeTarget && !path.isAbsolute(relativeTarget) && relativeTarget.split(path.sep)[0] !== '..');
  const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: hostHome };
  const { home, identity } = readStandardHostInstance({ targetRoot, instanceId, environment });
  const manifest = path.join(home, identity + '.github.json');
  const mergeFile = path.join(controlRoot, 'r09-provider-merge.json');
  const reviewFile = path.join(controlRoot, 'r09-provider-review.json');
  const sendsFile = path.join(controlRoot, 'r09-provider-sends.log');
  const open = createGithubPrOpenTransportFixture({ remoteRoot, controlRoot });
  if (initialize) {
    const locate = process.platform === 'win32' ? 'where.exe' : 'which';
    const gitPath = execFileSync(locate, ['git'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
    // Every GitHub command uses the injected transport. Keep the pin checks
    // against a small fixture file so the Node binary size is outside the test.
    const ghPin = path.join(home, identity + '.github-fixture-command');
    fs.writeFileSync(ghPin, 'GitHub transport fixture\n', { flag: 'wx' });
    const binding = { contract_version: 'standard-host-github.v1', instance_id: instanceId, target_root: targetRoot,
      repository, actor, reviewer, git: pin(gitPath), gh: pin(ghPin), merge_method: 'MERGE',
      required_checks: { contract_version: 'standard-github-required-checks.v1', base_ref: 'dev', entries: [ci] } };
    fs.mkdirSync(path.join(home, identity + '.github'));
    fs.writeFileSync(manifest, JSON.stringify(binding), { flag: 'wx' });
    execFileSync(binding.git.path, ['-C', targetRoot, 'config', '--local', '--replace-all', 'remote.origin.url', origin],
      { stdio: 'pipe', windowsHide: true, timeout: 10000 });
  }
  const binding = readJson(manifest);
  const git = args => execFileSync(binding.git.path, ['-c', 'core.hooksPath=' + hooks, ...args],
    { encoding: 'utf8', stdio: 'pipe', windowsHide: true, timeout: 10000 });
  const bare = (...args) => git(['--git-dir=' + remoteRoot, ...args]).trimEnd();
  const ref = branch => 'refs/heads/' + branch;
  const merge = () => fs.existsSync(mergeFile) ? readJson(mergeFile) : null;
  const send = kind => fs.appendFileSync(sendsFile, kind + '\n');

  function subject() {
    const rows = open.read().pulls;
    assert.equal(rows.length, 1);
    const [row] = rows;
    const merged = merge();
    const names = [ref(row.head.ref), ref(row.base.ref)];
    const tips = new Map(bare('show-ref', '--verify', '--', ...names).split(/\r?\n/).map(line => {
      const [oid, name] = line.split(' ');
      assert.match(oid, /^[a-f0-9]{40}$/);
      return [name, oid];
    }));
    assert.equal(tips.size, names.length);
    const [head, baseTip] = names.map(name => tips.get(name));
    assert.ok(head && baseTip);
    const parents = merged ? bare('show', '-s', '--format=%P', merged.oid).split(' ') : [];
    const pull = { repository_id: repository.node_id, node_id: row.node_id, number: row.number,
      head_oid: head, head_branch: row.head.ref, base_oid: merged ? parents[0] : baseTip, base_branch: row.base.ref,
      state: merged ? 'MERGED' : 'OPEN', draft: row.draft };
    return { pull, merged, baseTip, parents };
  }

  function publishReview() {
    const { pull } = subject();
    assert.equal(pull.state, 'OPEN');
    assert.equal(pull.draft, false);
    fs.writeFileSync(reviewFile, JSON.stringify({ pr: pull.node_id, head: pull.head_oid, base: pull.base_oid,
      at: new Date().toISOString() }), { flag: 'wx' });
    return reviewRef;
  }

  function githubRead(binary, args, options) {
    assert.equal(binary, binding.gh.path);
    if (args[0] === 'auth') return ok('composed-fixture-only-token');
    const endpoint = args.at(-1);
    if (endpoint === 'user') return ok(actor);
    if (endpoint === repoPath) return ok({ node_id: repository.node_id, full_name: 'fixture/repository' });
    const { pull, merged, baseTip, parents } = subject();
    const commit = repoPath + '/commits/' + pull.head_oid;
    if (endpoint === commit + '/check-runs?filter=all&per_page=100') return ok({ total_count: 1, check_runs: [
      { name: ci.name, node_id: 'CR_fixture', head_sha: pull.head_oid, app: { node_id: ci.producer_id },
        details_url: 'https://fixture.invalid/required-ci', status: 'completed', conclusion: 'success' },
    ] });
    if (endpoint === commit + '/status?per_page=100') return ok({ sha: pull.head_oid, total_count: 0, statuses: [] });
    if (endpoint === repoPath + '/pulls/' + pull.number) return ok({ node_id: pull.node_id, number: pull.number,
      state: merged ? 'closed' : 'open', draft: pull.draft, merged: Boolean(merged),
      head: { ref: pull.head_branch, sha: pull.head_oid, repo: { node_id: repository.node_id } },
      base: { ref: pull.base_branch, sha: pull.base_oid, repo: { node_id: repository.node_id } } });
    assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
    const { query, variables } = JSON.parse(options.input);
    const fixture = createGithubReviewFixture({ workingDirectory: controlRoot, pullRequest: pull });
    const published = fs.existsSync(reviewFile) ? readJson(reviewFile) : null;
    if (published?.pr === pull.node_id && published.head === pull.head_oid && published.base === pull.base_oid)
      Object.assign(fixture.state.reviews[0], { submittedAt: published.at, updatedAt: published.at });
    else fixture.state.reviews = [];
    const result = JSON.parse(fixture.run(binary, args, options).stdout);
    const observation = result.data.repository.pullRequest;
    observation.headRepository = observation.baseRepository = { id: repository.node_id };
    observation.baseRef = { target: { oid: baseTip } };
    Object.assign(observation, { mergeQueue: null, autoMergeRequest: null, mergedAt: merged?.at ?? null,
      mergedBy: merged ? { id: actor.node_id, login: actor.login } : null,
      mergeCommit: merged ? { oid: merged.oid, messageBody: bare('show', '-s', '--format=%b', merged.oid),
        parents: { totalCount: parents.length, nodes: parents.map(oid => ({ oid })), pageInfo: { hasNextPage: false } } } : null });
    assert.match(query, /^query /);
    if (query.startsWith('query AidnPrReviewEvent(')) {
      assert.deepEqual(variables, { id: reviewRef });
      const [review] = fixture.state.reviews;
      return ok({ data: { node: review ? { __typename: 'PullRequestReview', ...review, isMinimized: false,
        repository: { id: repository.node_id, nameWithOwner: 'fixture/repository' }, pullRequest: observation } : null } });
    }
    assert.equal(variables.number, pull.number);
    return ok(result);
  }

  function githubMerge(binary, args, options) {
    assert.equal(binary, binding.gh.path);
    assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
    const { query, variables: { input } } = JSON.parse(options.input);
    assert.match(query, /^mutation AidnMergePullRequest\(/);
    const { pull, merged } = subject();
    send('merge');
    assert.equal(merged, null);
    assert.deepEqual(input, { pullRequestId: pull.node_id, expectedHeadOid: pull.head_oid, mergeMethod: 'MERGE',
      commitBody: 'AIDN-Merge: ' + input.clientMutationId, clientMutationId: input.clientMutationId });
    assert.match(input.clientMutationId, /^[a-f0-9]{32}$/);
    const tree = bare('merge-tree', '--write-tree', pull.base_oid, pull.head_oid);
    const oid = bare('-c', 'user.name=Fixture Provider', '-c', 'user.email=fixture@example.invalid',
      'commit-tree', tree, '-p', pull.base_oid, '-p', pull.head_oid, '-m', 'Merge fixture PR', '-m', input.commitBody);
    bare('update-ref', ref(pull.base_branch), oid, pull.base_oid);
    fs.writeFileSync(mergeFile, JSON.stringify({ oid, at: new Date().toISOString() }), { flag: 'wx' });
    return ok({ data: { mergePullRequest: { clientMutationId: input.clientMutationId,
      pullRequest: { id: pull.node_id, merged: true, mergeCommit: { oid } } } } });
  }

  function remoteGit(binary, args) {
    assert.equal(binary, binding.git.path);
    assert.deepEqual(args.slice(0, 2), ['-C', targetRoot]);
    const separator = args.indexOf('--');
    assert.deepEqual(args.slice(separator + 1, -1), [origin]);
    const local = pathToFileURL(remoteRoot).href, value = args.at(-1);
    if (args.includes('ls-remote')) {
      assert.deepEqual(args.slice(args.indexOf('ls-remote'), separator), ['ls-remote', '--refs']);
      assert.equal(value, 'refs/heads/dev');
      return ok(git(['-C', targetRoot, 'ls-remote', '--refs', '--', local, value]));
    }
    assert.deepEqual(args.slice(args.indexOf('fetch'), separator), ['fetch', '--no-write-fetch-head', '--no-tags', '--no-prune',
      '--no-recurse-submodules', '--no-auto-maintenance', '--refmap=']);
    assert.equal(value, merge()?.oid);
    send('fetch');
    return ok(git(['-C', targetRoot, ...args.slice(args.indexOf('fetch'), separator), '--', local, value]));
  }

  const forbidden = () => assert.fail('Unexpected provider transport in the nominal R09 fixture');
  const providerTransport = { runGithub: forbidden, runGithubRead: githubRead, runGithubReply: forbidden, runGithubResolution: forbidden,
    runGithubMerge: githubMerge, runRemoteGit: remoteGit };
  const provider = createStandardGithubProviderHost({ configuration: { target_root: targetRoot, instance_id: instanceId },
    home, identity, environment }, providerTransport);
  return { provider, providerTransport, environment, publishReview,
    sends: () => fs.existsSync(sendsFile) ? fs.readFileSync(sendsFile, 'utf8').trimEnd().split('\n') : [] };
}

export function attachComposedR09Provider({ configuration, remoteRoot, initialize }) {
  const controlRoot = configuration.control_root;
  const privateHome = path.join(path.dirname(controlRoot), 'r09-authority');
  if (initialize) fs.mkdirSync(privateHome);
  const hostHome = fs.realpathSync(privateHome);
  const inbox = path.join(hostHome, 'inbox'), privateKeyFile = path.join(hostHome, 'fixture-operator.pem');
  if (initialize) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    fs.mkdirSync(inbox);
    fs.writeFileSync(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(hostHome, 'principals.json'), JSON.stringify({ contract_version: 'standard-host-principals.v1',
      principals: [{ authority_id: 'fixture_operator', kinds: ['human'], public_key: publicKey.export({ type: 'spki', format: 'pem' }) }] }),
    { flag: 'wx' });
    configuration.native.protected_roots = [...(configuration.native.protected_roots ?? []), hostHome];
  }
  const fixture = createComposedGithubR09ProviderFixture({ targetRoot: configuration.target_root, controlRoot,
    remoteRoot, hostHome, instanceId: configuration.instance_id, initialize });
  const authority = createStandardHostAuthority({ configuration, environment: fixture.environment },
    { providerTransport: fixture.providerTransport });
  function publishDecision(sourceRef, question, payload) {
    assert.match(sourceRef, /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/);
    const now = Date.now(), envelope = { contract_version: 'standard-host-source.v1', kind: 'human',
      authority_id: payload.authority_id, source_ref: sourceRef, subject_sha256: shadowHash(question), payload,
      issued_at_ms: now, expires_at_ms: question.expires_at_ms ?? now + 7200000 };
    const signature = sign(null, Buffer.from(shadowHash(envelope)), fs.readFileSync(privateKeyFile)).toString('base64');
    fs.writeFileSync(path.join(inbox, sourceRef + '.json'), JSON.stringify({ ...envelope, signature }), { flag: 'wx' });
  }
  return { ...fixture, authority, publishDecision };
}
