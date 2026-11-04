import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPrSuccessorFixture } from './standard-session-pr-successor-fixture-lib.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createStandardSessionPrReviewAuthority } from '../../src/application/runtime/standard-session-pr-review-authority.mjs';
import { createStandardSessionPrReviewObservation, createStandardSessionPrReviewContentObservation } from '../../src/application/runtime/standard-session-pr-review-observe.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
const content = process.argv.includes('--content'), bindingRef = content ? 'session_pr_review_content_observe' : 'session_pr_review_observe';
const createObservation = content ? createStandardSessionPrReviewContentObservation : createStandardSessionPrReviewObservation;
const parent = fs.realpathSync(os.tmpdir()), owned = [], mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
let checks = 0; const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
const grant = ready => ({ write: true, expectPlan: ready.plan_sha256, assertAuthorized() {} });
const op = n => 'op_' + n.repeat(40);
try {
  await test('closed observation contracts distinguish collected evidence from acceptance and merge', () => {
    for (const kind of ['input', 'output']) {
      const name = content && kind === 'output' ? 'standard-session-pr-review-content-output' : 'standard-session-pr-review-observe-' + kind;
      const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/' + name + '.v1.schema.json', import.meta.url)));
      assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    }
    assertStandardOperationInput(bindingRef, { contract_version: 'standard-session-pr-review-observe-input.v1', update_operation_id: op('4') });
    assert.throws(() => assertStandardOperationInput(bindingRef, { update_operation_id: op('4') }));
  });
  const f = await createPrSuccessorFixture(mode, owned, parent);
  for (const [app, input, id, binding] of [[f.checkpoint, f.checkpointInput, f.checkpointId, 'session_pr_checkpoint'], [f.update(), f.updateInput, op('4'), 'session_pr_update_push']]) {
    const prepared = await app.prepare(f.instance, input, id), output = await app.apply(f.instance, prepared, grant(prepared));
    assert.equal(output.outcome, 'completed', JSON.stringify(output));
    f.records.set(id, { record: { operation_id: id, intent: { binding_ref: binding }, preview: { input, prepared } }, output });
  }
  const update = f.records.get(op('4')), link = update.output.observations.pull_request;
  const provider = createGithubReviewFixture({ workingDirectory: f.root, pullRequest: link });
  const authority = createStandardSessionPrReviewAuthority({ readAcceptedOperation(_instance, id, binding) {
    const selected = f.records.get(id); if (selected?.record.intent.binding_ref !== binding) throw Object.assign(Error('STANDARD_PR_REVIEW_UPDATE_REQUIRED'), { code: 'STANDARD_PR_REVIEW_UPDATE_REQUIRED' });
    return structuredClone(selected);
  }, readCheckpoint: f.authority.readCheckpoint, inspectPush: f.pushPort.inspect });
  const app = createObservation({ readConfirmedHead: authority.readConfirmedHead, readCurrent: () => f.instance, reviewPort: provider.port });
  const input = { contract_version: 'standard-session-pr-review-observe-input.v1', update_operation_id: op('4') };
  const beforeFiles = f.names.map(name => f.artifacts.read(name, { required: true })), beforeHead = git(f.root, 'rev-parse', 'HEAD');
  await test('preview authenticates actual canonical successor and live bare remote without a provider call', async () => {
    const ready = await app.prepare(f.instance, input); assert.equal(ready.can_apply, true); assert.equal(ready.request.expected_head_oid, beforeHead);
    assert.equal(provider.calls.length, 0); assert.equal(f.artifacts.ownerPending(), false);
  });
  let accepted;
  await test('actual observational ports retain complete head-bound review/check/thread snapshots and no success beyond observation', async () => {
    accepted = await app.observe(f.instance, input); assert.equal(accepted.outcome, 'completed', JSON.stringify(accepted)); assertStandardOperationOutput(accepted);
    assert.equal(accepted.effect_status, 'no_effect');
    if (content) { assert.equal(accepted.observations.evidence.reviews[0].body_chunks.join(''), 'Complete fixture review evidence.'); assert.equal(accepted.observations.threads.pull_request.base_oid, link.base_oid); } assert.equal(accepted.observations.evidence.reviews[0].author.node_id, 'U_fixture');
    assert.equal(accepted.observations.head_oid, beforeHead); assert.equal(accepted.observations.merge_authorization, 'not-established');
    assert.deepEqual(accepted.facts, { session_pr_review_evidence_available: true, session_pr_triage_required: true });
    assert.equal(provider.calls.length, 12); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('new request base/head, wrong repository and changed same-head check evidence are refused', async () => {
    for (const key of ['head_oid', 'base_oid', 'repository_id']) {
      const old = provider.state.pullRequest[key]; provider.state.pullRequest[key] = key === 'repository_id' ? 'R_other' : 'c'.repeat(40);
      const result = await app.observe(f.instance, input); assert.equal(result.outcome, 'blocked'); assert.deepEqual(result.facts, {}); provider.state.pullRequest[key] = old;
    }
    const start = provider.calls.length;
    provider.state.beforeCall = (body, count) => { if (count === start + 9) provider.state.checks[0].conclusion = 'FAILURE'; };
    const result = await app.observe(f.instance, input); assert.equal(result.outcome, 'blocked'); assert.equal(result.observations.reason_code, 'STANDARD_PR_REVIEW_COLLECTION_CHANGED');
    provider.state.beforeCall = null; provider.state.checks[0].conclusion = 'SUCCESS';
  });
  await test('unresolved outdated threads remain visible and never become implied triage', async () => {
    provider.state.threads = [{ id: 'THREAD_fixture', path: 'src/example.mjs', line: null, isResolved: false, isOutdated: true,
      comments: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } } }];
    const result = await app.observe(f.instance, input); assert.equal(result.outcome, 'completed'); assert.equal(result.observations.threads.threads[0].is_resolved, false);
    assert.equal(result.facts.session_pr_triage_required, true); provider.state.threads = [];
  });
  await test('changed accepted update or current process refuses without facts or canonical mutation', async () => {
    update.output.facts.session_pr_head_confirmed = false;
    const bad = await app.observe(f.instance, input); assert.equal(bad.outcome, 'blocked'); assert.deepEqual(bad.facts, {}); update.output.facts.session_pr_head_confirmed = true;
    const current = f.instance.instance_sha256;
    const changed = createObservation({ readConfirmedHead: authority.readConfirmedHead, readCurrent: () => ({ ...f.instance, instance_sha256: 'b'.repeat(64) }), reviewPort: provider.port });
    assert.equal((await changed.observe(f.instance, input)).outcome, 'blocked'); assert.equal(f.instance.instance_sha256, current);
  });
  await test('cached snapshots cannot pass as a new live observation', async () => {
    const replayed = createObservation({ readConfirmedHead: authority.readConfirmedHead, readCurrent: () => f.instance,
      reviewPort: { [content ? "observeReviewContent" : "observeReviewEvidence"]: () => accepted.observations.evidence, [content ? "observePrContent" : "observePullRequest"]: () => accepted.observations.threads },
      now: () => Date.parse(accepted.observations.evidence.observed_until) + 300001 });
    const result = await replayed.observe(f.instance, input); assert.equal(result.outcome, 'blocked'); assert.deepEqual(result.facts, {});
    assert.equal(result.observations.reason_code, 'STANDARD_PR_REVIEW_STALE_OBSERVATION');
  });
  await test('common reducer replay and simulation retain the actual observation receipt without provider re-execution', () => {
    const binding = standardWorkflowOperationBindings().find(row => row.id === bindingRef);
    const model = { contract_version: 'agentic-process-model.v2', model_id: 'review-observation-boundary', revision: 1,
      participants: [{ id: 'project' }], roles: [], policies: [], entry: 'observe', nodes: [{ id: 'observe', kind: 'operation', participant_ref: 'project', binding_ref: binding.id }],
      operation_pins: { [binding.id]: shadowHash(binding) } };
    const initial = { instanceId: 'review-boundary', model, scopeId: 'fixture-review-boundary', policyPins: agenticPolicyPins(model), facts: {} };
    let instance = createAgenticProcess(initial); const occurrence_id = inspectAgenticProcess(instance).ready[0], operation_id = op('7');
    const intent = { contract_version: 'process-operation-intent.v1', operation_id, binding_ref: binding.id, binding_sha256: shadowHash(binding),
      input_sha256: shadowHash(input), preconditions_sha256: 'a'.repeat(64), authorization_sha256: 'a'.repeat(64), authority_id: 'fixture-observation-boundary',
      scope_id: instance.scope_id, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256, model_sha256: instance.model_sha256,
      occurrence_id, instance_revision: instance.revision };
    const intentEvent = { event_id: 'intent-review', kind: 'operation_intent', occurrence_id, intent };
    instance = advanceAgenticProcess(instance, intentEvent);
    const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'fixture-review-receipt', operation_id,
      intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome: accepted.outcome, effect_status: accepted.effect_status,
      output_sha256: shadowHash(accepted), facts: accepted.facts, evidence_refs: accepted.evidence_refs };
    const event = { event_id: 'result-review', kind: 'operation_result', occurrence_id, receipt }, calls = provider.calls.length;
    instance = advanceAgenticProcess(instance, event);
    const simulation = simulateAgenticProcess({ ...initial, events: [intentEvent, event] });
    assert.equal(simulation.trace.at(-1).instance_sha256, instance.instance_sha256); assert.equal(provider.calls.length, calls);
    assert.deepEqual(instance.events.at(-1).receipt.facts, { session_pr_review_evidence_available: true, session_pr_triage_required: true });
  });
  await test('real remote head change invalidates observation before any provider call', async () => {
    const calls = provider.calls.length; assert.notEqual(link.base_oid, beforeHead);
    git(f.remote, 'update-ref', 'refs/heads/S001-record', link.base_oid);
    const result = await app.observe(f.instance, input); assert.equal(result.outcome, 'blocked'); assert.equal(provider.calls.length, calls);
    git(f.remote, 'update-ref', 'refs/heads/S001-record', beforeHead);
  });
  await test('observation leaves canonical postimages, Git state and ownership unchanged', async () => {
    assert.deepEqual(f.names.map(name => f.artifacts.read(name, { required: true })), beforeFiles); assert.equal(git(f.root, 'rev-parse', 'HEAD'), beforeHead);
    assert.equal(git(f.root, 'status', '--porcelain'), ''); assert.equal(f.artifacts.ownerPending(), false); assert.equal(shadowHash(accepted).length, 64);
  });
  console.log(JSON.stringify({ status: 'PASS', mode, content, checks, proof_class: 'real-canonical-CAS-Git-bare-and-observation-ports',
    accepted_history: 'fixture-lookup', provider_transport: 'fixture', authenticated_native_human: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned.reverse()) { const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), parent); assert.ok(/^aidn-/.test(path.basename(resolved))); fs.rmSync(resolved, { recursive: true, force: true }); }
  console.log(JSON.stringify({ cleanup: 'confirmed', owned_roots: owned.length }));
}
