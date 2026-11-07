import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGithubPrReviewResolution, githubPrReviewResolutionBasis, assertGithubPrReviewResolutionResult } from '../../src/adapters/git-provider/github-pr-review-resolution.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const operationId = 'op_' + 'a'.repeat(40);
const repository = { owner: 'fixture', name: 'project', node_id: 'R_fixture' }, actor = { node_id: 'U_actor', login: 'fixture-actor' };
const hostContextSha256 = 'a'.repeat(64);
const threadId = 'T_exact';
const pullRequest = { node_id: 'PR_exact', number: 2, state: 'OPEN', is_draft: false, merged: false, merge_oid: null,
  head_oid: 'a'.repeat(40), base_oid: 'b'.repeat(40), head_ref: 'session', base_ref: 'dev' };
const subject = { contract_version: 'github-pr-observation-request.v2', pull_request_number: pullRequest.number,
  expected_pull_request_id: pullRequest.node_id, expected_head_oid: pullRequest.head_oid, expected_base_oid: pullRequest.base_oid,
  expected_head_ref: pullRequest.head_ref, expected_base_ref: pullRequest.base_ref };
const prefix = '../../src/core/contracts/workflow-definition/';
for (const schema of ['github-pr-review-resolution-request', 'github-pr-review-resolution-plan', 'github-pr-review-resolution-result',
  'standard-pr-review-resolution-select-input', 'standard-pr-review-resolution-select-output',
  'standard-pr-review-thread-resolve-input', 'standard-pr-review-thread-resolve-output']) {
  const value = JSON.parse(fs.readFileSync(new URL(prefix + schema + '.v1.schema.json', import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(value, '#', { contractKind: 'workflow-definition' }), []);
}

function fixture() {
  let time = Date.parse('2026-11-07T00:00:00Z');
  const state = { resolved: false, sends: 0, reads: 0, persist: true, ack: 'exact', alter() {} };
  function observation() {
    const stamp = new Date(time).toISOString();
    const content = { repository: { host: 'github.com', ...repository }, pull_request: { ...pullRequest, updated_at: stamp },
      threads: [{ node_id: threadId, path: 'product.mjs', line: 1, is_resolved: state.resolved, is_outdated: false, comments: [] }] };
    state.alter(content);
    return { ...content, contract_version: 'github-pr-observation.v3', observed_from: stamp, observed_until: stamp,
      pagination: { requests: 2, thread_pages: 1, comment_pages: 0, complete: true },
      consistency: 'head-and-pr-metadata-rechecked', observation_sha256: shadowHash(content) };
  }
  const request = { contract_version: 'github-pr-review-resolution-request.v1', pull_request: subject,
    thread_id: threadId, basis_sha256: githubPrReviewResolutionBasis(observation(), threadId), not_before_ms: time };
  const open = () => createGithubPrReviewResolution({ repository, actor, hostContextSha256, now: () => time,
    async observe(actual) { assert.deepEqual(actual, subject); state.reads++; return observation(); },
    async runMutation(payload, { assertAuthorized }) {
      await assertAuthorized();
      assert.equal(payload.query, 'mutation AidnPrReviewResolution($input:ResolveReviewThreadInput!) { resolveReviewThread(input:$input) { clientMutationId thread { id isResolved } } }');
      assert.deepEqual(payload.variables, { input: { threadId, clientMutationId: operationId } });
      state.sends++;
      state.resolved = state.persist;
      if (state.ack === 'lost') throw Error('lost acknowledgement');
      return { data: { resolveReviewThread: { clientMutationId: operationId, thread: {
        id: state.ack === 'exact' ? threadId : 'T_other', isResolved: true,
      } } } };
    },
  });
  return { open, request, state, advance: ms => { time += ms; } };
}
const options = prepared => ({ write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} });

{
  const { open, state, request, advance } = fixture(), port = open(), plan = await port.prepare(request, operationId);
  const apply = overrides => port.apply(plan, { ...options(plan), ...overrides });
  await assert.rejects(apply({ write: false }), { code: 'GITHUB_PR_RESOLUTION_EXPLICIT_EFFECT_REQUIRED' });
  await assert.rejects(apply({ expectPlan: 'f'.repeat(64) }), { code: 'GITHUB_PR_RESOLUTION_PLAN_INVALID' });
  const original = structuredClone(plan);
  plan.plan.actor.node_id = 'U_other';
  plan.plan_sha256 = shadowHash(plan.plan);
  await assert.rejects(port.apply(plan, options(plan)), { code: 'GITHUB_PR_RESOLUTION_PLAN_INVALID' });
  Object.assign(plan, original);
  const refused = Object.assign(Error('grant revoked'), { effect_status: 'no_effect' });
  await assert.rejects(apply({ assertAuthorized: async phase => { if (phase === 'before-transport') throw refused; } }), refused);
  advance(300001);
  await assert.rejects(apply({}), { code: 'GITHUB_PR_RESOLUTION_PLAN_EXPIRED' });
  advance(-300001);
  for (const field of ['head_oid', 'base_oid', 'head_ref', 'base_ref']) {
    state.alter = row => { row.pull_request[field] = field.endsWith('oid') ? 'c'.repeat(40) : 'foreign'; };
    await assert.rejects(apply({}), { code: 'GITHUB_PR_RESOLUTION_SUBJECT_CHANGED', effect_status: 'no_effect' });
  }
  state.alter = row => { row.threads[0].line++; };
  await assert.rejects(apply({}), { code: 'GITHUB_PR_RESOLUTION_OBSERVATION_CHANGED' });
  state.alter = () => {};
  assert.equal(state.sends, 0);
  const before = state.reads, resolved = assertGithubPrReviewResolutionResult(await apply({}));
  assert.equal(state.reads, before + 2); // preimage and independent postimage
  assert.equal(resolved.effect_status, 'confirmed');
  assert.equal(resolved.thread_id, threadId);
  assert.equal(resolved.actor_id, actor.node_id);
  assert.throws(() => assertGithubPrReviewResolutionResult({ ...resolved, effect_status: 'no_effect' }),
    { code: 'GITHUB_PR_RESOLUTION_RESULT_INVALID' });
  await assert.rejects(apply({}), { code: 'GITHUB_PR_RESOLUTION_ALREADY_RESOLVED' });
  assert.equal(state.sends, 1);
  const input = { contract_version: 'standard-pr-review-thread-resolve-input.v1', triage_operation_id: operationId, selection_operation_id: operationId };
  assertStandardOperationInput('session_pr_review_thread_resolve', input);
  assert.throws(() => assertStandardOperationInput('session_pr_review_thread_resolve', { ...input, thread_id: threadId }),
    { code: 'STANDARD_OPERATION_INPUT_INVALID' });
  const output = { contract_version: 'standard-pr-review-thread-resolve-output.v1', operation_ref: 'session_pr_review_thread_resolve',
    outcome: 'completed', effect_status: 'confirmed', facts: {}, observations: { resolution: resolved },
    evidence_refs: [{ ref: 'github:pr-review-thread/' + threadId, sha256: shadowHash(resolved) }] };
  assertStandardOperationOutput(output);
  assert.throws(() => assertStandardOperationOutput({ ...output, effect_status: 'unknown' }), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  console.log('PASS closed schemas, exact grant, repository/PR subject, actor, response binding and independent postimage');
}

for (const [ack, persist] of [['lost', true], ['wrong', true], ['exact', false]]) {
  const { open, state, request, advance } = fixture(), port = open(), plan = await port.prepare(request, operationId);
  Object.assign(state, { ack, persist });
  await assert.rejects(port.apply(plan, options(plan)), { code: 'GITHUB_PR_RESOLUTION_RECONCILIATION_REQUIRED', effect_status: 'unknown' });
  advance(300001);
  const recovered = await open().recover(plan, { expectPlan: plan.plan_sha256 });
  if (persist) {
    assert.equal(recovered.action, 'recovered');
    assert.equal(recovered.thread_id, threadId);
  } else assert.equal(recovered, null);
  assert.equal(state.sends, 1);
  console.log('PASS read-only resolution recovery for acknowledgement=' + ack + ', postimage=' + persist);
}
