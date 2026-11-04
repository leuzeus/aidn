import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createGithubReviewEvidenceAdapter, createGithubReviewEvidenceAsyncAdapter } from '../../src/adapters/git-provider/github-review-evidence.mjs';
import { createGithubWorkflowAdapter, createGithubWorkflowAsyncAdapter } from '../../src/adapters/git-provider/github-workflow-adapter.mjs';
import { runGithubObservationCommand } from '../../src/adapters/git-provider/github-observation-transport.mjs';
import { createStandardControlInbox } from '../../src/application/runtime/standard-workflow-control-inbox.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { agenticProcessImplementationPins } from '../../src/application/runtime/agentic-process-implementation-pins.mjs';

const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'aidn-async-observation-'));
const H = 'a'.repeat(64), head = 'a'.repeat(40), date = '2026-11-03T00:00:00Z';
const configuration = { executable: process.execPath, executableSha256: createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
  workingDirectory: root, repository: { owner: 'fixture', name: 'repository', node_id: 'R_fixture' } };
const reviewRequest = { contract_version: 'github-review-evidence-request.v1', pull_request_number: 7, expected_pull_request_id: 'PR_fixture',
  expected_head_oid: head, expected_base_oid: 'b'.repeat(40), expected_head_ref: 'S001-example', expected_base_ref: 'dev' };
const threadRequest = { contract_version: 'github-pr-observation-request.v1', pull_request_number: 7, expected_pull_request_id: 'PR_fixture', expected_head_oid: head };
const connection = nodes => ({ totalCount: nodes.length, nodes, pageInfo: { hasNextPage: false, endCursor: null } });
function response(input) {
  const { query } = JSON.parse(input.input), pr = { id: 'PR_fixture', number: 7, headRefOid: head, baseRefOid: 'b'.repeat(40),
    headRefName: 'S001-example', baseRefName: 'dev', state: 'OPEN', isDraft: false, merged: false, mergeCommit: null, updatedAt: date };
  if (query.includes('reviews(first:')) pr.reviews = connection([{ id: 'REV1', state: 'APPROVED', submittedAt: date, updatedAt: date,
    author: { id: 'U1', login: 'reviewer', __typename: 'User' }, commit: { oid: head } }]);
  else if (query.includes('statusCheckRollup')) pr.statusCheckRollup = { commit: { oid: head }, state: 'SUCCESS', contexts: connection([]) };
  else if (query.includes('reviewThreads(first:')) pr.reviewThreads = connection([]);
  return { status: 0, signal: null, stdout: JSON.stringify({ data: { repository: { id: 'R_fixture', nameWithOwner: 'fixture/repository', pullRequest: pr } } }) };
}
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
const checks = [], families = [
  [createGithubReviewEvidenceAdapter, createGithubReviewEvidenceAsyncAdapter, 'observeReviewEvidence', reviewRequest, 4],
  [createGithubWorkflowAdapter, createGithubWorkflowAsyncAdapter, 'observePullRequest', threadRequest, 2],
];
function command(code, options = {}) {
  return runGithubObservationCommand(process.execPath, ['-e', code], { cwd: root, env: process.env, timeout: 2000, maxBuffer: 4096, input: '', ...options });
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function pidFrom(file) {
  const until = Date.now() + 3000;
  while (!fs.existsSync(file)) { if (Date.now() >= until) throw Error('FIXTURE_CHILD_START_TIMEOUT'); await delay(10); }
  return Number(fs.readFileSync(file, 'utf8'));
}
try {
  await check('both async readers use the historical protocol and yield identical complete typed observations', async () => {
    for (const [sync, asynchronous, method, request, count] of families) {
      let calls = 0, yielded = false;
      const expected = sync(configuration, { run: (_exe, _args, input) => response(input), now: () => 1793664000000 })[method](request);
      const pending = asynchronous(configuration, { run: async (_exe, _args, input) => {
        calls++; assert.ok(input.signal === undefined || input.signal instanceof AbortSignal); await delay(1); yielded = true; return response(input);
      }, now: () => 1793664000000 })[method](request);
      assert.equal(yielded, false); assert.deepEqual(await pending, expected); assert.equal(calls, count);
    }
  });
  await check('aborted readers make no request and invalid signals never reach a transport', async () => {
    for (const [, asynchronous, method, request] of families) {
      let calls = 0; const adapter = asynchronous(configuration, { run: () => { calls++; } }), stop = new AbortController(); stop.abort();
      await assert.rejects(adapter[method](request, { signal: stop.signal }), { code: 'GITHUB_OBSERVATION_ABORTED' });
      await assert.rejects(adapter[method](request, { signal: {} }), { code: 'GITHUB_OBSERVATION_SIGNAL_INVALID' }); assert.equal(calls, 0);
    }
  });
  await check('cancellation during a provider response prevents every subsequent page and result', async () => {
    for (const [, asynchronous, method, request] of families) {
      let calls = 0; const stop = new AbortController(), adapter = asynchronous(configuration, { run: async (_exe, _args, input) => {
        calls++; assert.equal(input.signal, stop.signal); stop.abort(); return response(input);
      } });
      await assert.rejects(adapter[method](request, { signal: stop.signal }), { code: 'GITHUB_OBSERVATION_ABORTED' }); assert.equal(calls, 1);
    }
  });
  await check('async readers retain foreign head and partial-provider refusal semantics', async () => {
    for (const [sync, asynchronous, method, request] of families) for (const mutate of [
      v => { v.data.repository.pullRequest.headRefOid = 'c'.repeat(40); }, v => { v.errors = [{ message: 'fixture-private-text' }]; },
    ]) {
      const run = (_exe, _args, input) => { const result = response(input), value = JSON.parse(result.stdout); mutate(value); return { ...result, stdout: JSON.stringify(value) }; };
      let expected; try { sync(configuration, { run })[method](request); } catch (cause) { expected = cause.code; }
      assert.ok(expected); await assert.rejects(asynchronous(configuration, { run: async (...args) => run(...args) })[method](request), { code: expected });
    }
  });
  await check('real asynchronous child drains stdin and returns only after close', async () => {
    const result = await command("process.stdin.on('data', d => process.stdout.write(d));", { input: 'fixture-observation' });
    assert.equal(result.status, 0); assert.equal(result.stdout, 'fixture-observation');
  });
  await check('abort closes the actual direct subprocess before returning and discards its buffered output', async () => {
    const file = path.join(root, 'abort.pid'), stop = new AbortController();
    const result = command("require('fs').writeFileSync(process.argv[1],String(process.pid)); process.stdout.write('private'); setInterval(()=>{},1000);".replace('process.argv[1]', JSON.stringify(file)), { signal: stop.signal });
    const assertion = assert.rejects(result, { code: 'GITHUB_OBSERVATION_ABORTED' }), pid = await pidFrom(file); assert.equal(alive(pid), true); stop.abort();
    await assertion; assert.equal(alive(pid), false);
  });
  await check('deadline and output overflow terminate actual children and redact transport errors', async () => {
    for (const [name, body, code, options] of [
      ['timeout', 'setInterval(()=>{},1000);', 'GITHUB_OBSERVATION_TIMEOUT', { timeout: 500 }],
      ['overflow', "process.stdout.write('fixture-private-text'.repeat(10000)); setInterval(()=>{},1000);", 'GITHUB_OBSERVATION_BUFFER_LIMIT', {}],
    ]) {
      const file = path.join(root, name + '.pid');
      await assert.rejects(command("require('fs').writeFileSync(" + JSON.stringify(file) + ",String(process.pid));" + body, options), { code });
      assert.equal(alive(await pidFrom(file)), false);
    }
    await assert.rejects(runGithubObservationCommand(path.join(root, 'absent.exe'), [], { cwd: root, env: process.env, timeout: 200, maxBuffer: 1024, input: '' }), { code: 'GITHUB_OBSERVATION_UNAVAILABLE' });
  });
  await check('external inbox timeout aborts a real async reader without capture, verification or late success', async () => {
    const file = path.join(root, 'inbox.pid'); let writes = 0, calls = 0, closed = false, rejection;
    const reader = createGithubReviewEvidenceAsyncAdapter(configuration, { run: async (_exe, _args, input) => {
      calls++;
      try { return await command("require('fs').writeFileSync(" + JSON.stringify(file) + ",String(process.pid));setInterval(()=>{},1000);", { signal: input.signal, timeout: input.timeout }); }
      finally { closed = true; }
    } });
    const inbox = createStandardControlInbox({ store: { compareAndSwap() { writes++; } }, signer: {}, projectionRequired: false,
      source: { read: ({ signal }) => reader.observeReviewEvidence(reviewRequest, { signal }), verify() { throw Error('MUST_NOT_VERIFY'); } } });
    const request = { contract_version: 'process-control-request.v1', scope_id: 'fixture', instance_id: 'waiting', instance_sha256: H, model_sha256: H,
      instance_revision: 1, occurrence_id: 'root', correlation_id: 'fixture:root', event_keys: ['review_snapshot', 'checks_snapshot'], context_sha256: H, branch: 'S001-example', head };
    const pending = inbox.reserve(request, 'fixture-pr').catch(cause => { rejection = cause; });
    const pid = await pidFrom(file); await pending; assert.equal(rejection.code, 'PROCESS_CONTROL_AUTHORITY_TIMEOUT');
    const until = Date.now() + 2000; while (!closed && Date.now() < until) await delay(10);
    assert.equal(closed, true); assert.equal(alive(pid), false); assert.equal(calls, 1); assert.equal(writes, 0);
  });
  await check('caller cancellation propagates through capture and verification without a retained record', async () => {
    const request = { contract_version: 'process-control-request.v1', scope_id: 'fixture', instance_id: 'waiting', instance_sha256: H, model_sha256: H,
      instance_revision: 1, occurrence_id: 'root', correlation_id: 'fixture:root', event_keys: ['review_snapshot', 'checks_snapshot'], context_sha256: H, branch: 'S001-example', head };
    for (const phase of ['read', 'verify']) {
      const stop = new AbortController(); let writes = 0, received;
      const source = { read: async () => ({ contract_version: 'process-control-source.v1', source_kind: 'external', authority_id: 'fixture_provider', source_event_id: 'event1',
        subject_sha256: H, request_sha256: shadowHash(request), event_key: 'review_snapshot', payload_sha256: H, evidence_refs: [{ ref: 'fixture:pr', sha256: H }] }), verify: async () => null };
      source[phase] = ({ signal }) => { received = signal; return new Promise(() => {}); };
      const inbox = createStandardControlInbox({ store: { compareAndSwap() { writes++; } }, signer: {}, source, projectionRequired: false });
      const pending = inbox.reserve(request, 'fixture-pr', { signal: stop.signal }); await delay(5); stop.abort();
      await assert.rejects(pending, { code: 'PROCESS_CONTROL_AUTHORITY_ABORTED' }); assert.equal(received.aborted, true); assert.equal(writes, 0);
    }
  });
  await check('new transport is a direct native launch pin', async () => {
    assert.equal(agenticProcessImplementationPins().files.filter(row => row.path === 'src/adapters/git-provider/github-observation-transport.mjs').length, 1);
  });
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, proof_class: 'actual-async-transport-and-direct-subprocesses-with-fixture-GitHub-responses',
    actual_network: 'NOT_RUN', complete_standard_workflow: false, native_process_tree_reconciliation: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally {
  const actual = fs.realpathSync(root); assert.equal(path.dirname(actual), parent); assert.ok(path.basename(actual).startsWith('aidn-async-observation-'));
  fs.rmSync(actual, { recursive: true, force: true });
  console.log(JSON.stringify({ cleanup: 'PASS', fixture_removed: !fs.existsSync(root) }));
}
