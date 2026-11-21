import assert from 'node:assert/strict';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { prIncidentCloseOperation, prIncidentCloseReconciliationPrefix } from '../../src/core/workflow/standard-pr-incident-close.mjs';
import { assertIncidentContinuationPlan, assertIncidentContinuationDisposition, operationDispositionResultLimit, operationControlHistoryExtends } from '../../src/core/workflow/process-operation-disposition.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import requestV2 from '../../src/core/contracts/workflow-definition/process-disposition-authorization-request.v2.schema.json' with { type: 'json' };
import v1Plan from '../../src/core/contracts/workflow-definition/process-operation-disposition-plan.v1.schema.json' with { type: 'json' };
import v1Record from '../../src/core/contracts/workflow-definition/process-operation-disposition.v1.schema.json' with { type: 'json' };

const H = 'a'.repeat(64), B = 'b'.repeat(64), id = 'op_' + '1'.repeat(40);
const paths = ['incidents/INC-TMP-20261115-120000-fixture.md', 'sessions/S001.md', 'snapshots/context-snapshot.md'];
const success = { contract_version: 'standard-pr-incident-close-output.v1', operation_ref: prIncidentCloseOperation,
  outcome: 'completed', effect_status: 'confirmed', facts: { session_pr_incident_cleanup_completed: true },
  observations: { incident_id: 'INC-TMP-20261115-120000-fixture', plan_sha256: H, reason_code: null },
  evidence_refs: paths.slice(1).map(ref => ({ ref: 'docs/audit/' + ref, sha256: H })) };
const unknown = { ...success, outcome: 'reconciliation_required', effect_status: 'unknown', facts: {},
  observations: { ...success.observations, reason_code: 'FIXTURE_PARTIAL' }, evidence_refs: [] };
const plan = { contract_version: 'process-operation-disposition-plan.v2', operation_id: id,
  instance_id: 'continuation', instance_sha256: H, instance_revision: 3, scope_id: 'fixture', model_sha256: H,
  authority_sha256: H, runtime_sha256: H, physical_root_sha256: H, journal_sha256: H, dispatch_sha256: H,
  inventory_sha256: H, fence_sha256: H, assessment: 'known_partial_incident_close', output_sha256: shadowHash(unknown),
  prepared_at_ms: 0, nonce: '11111111-1111-4111-8111-111111111111', key_id: H, authentication: H,
  continuation: { profile: 'standard-pr-incident-close-known-partial.v1', original_receipt_sha256: H,
    closure_plan_sha256: H, source_sha256: H, boundary_sha256: H, state_sha256: H,
    owned_paths: paths, expected_output_sha256: shadowHash(success), expected_output: success } };
const receipt = (index, output, intentSha = H) => ({ contract_version: 'process-operation-receipt.v1',
  receipt_id: 'receipt_' + id.slice(3) + (index ? '_' + index : ''), operation_id: id,
  intent_sha256: intentSha, authority_id: 'fixture', outcome: output.outcome, effect_status: output.effect_status,
  output_sha256: shadowHash(output), facts: output.facts,
  evidence_refs: [{ ref: 'aidn:operation-output/' + id + '/' + index, sha256: shadowHash(output) }] });
const row = (index, output, knowledge = 'known_prefix') => ({ plan: structuredClone(plan), grant: {}, receipt: receipt(index, output),
  output: structuredClone(output), effect_knowledge: knowledge, resource_fence: {} });
const first = row(1, unknown), second = row(2, success);
second.plan.instance_revision++; second.plan.instance_sha256 = B; second.plan.continuation.state_sha256 = B;
const record = resultRows => ({ contract_version: 'process-operation-disposition.v2', operation_id: id,
  revision: resultRows.length, ...structuredClone(resultRows.at(-1)), attempts: [], results: structuredClone(resultRows),
  admissions: [], acceptance_reservations: [], key_id: H, authentication: H });
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS ' + name); }
function rejects(base, mutate, validator) { const candidate = structuredClone(base); mutate(candidate); assert.throws(() => validator(candidate)); }

test('v2 separates original captured UNKNOWN from the expected new confirmation', () => {
  assert.equal(assertIncidentContinuationPlan(plan), plan);
  assert.notEqual(plan.output_sha256, plan.continuation.expected_output_sha256);
  rejects(plan, p => { p.output_sha256 = p.continuation.expected_output_sha256; }, assertIncidentContinuationPlan);
  rejects(plan, p => { p.continuation.expected_output.facts.session_pr_incident_cleanup_completed = false; }, assertIncidentContinuationPlan);
  rejects(plan, p => { p.continuation.expected_output_sha256 = B; }, assertIncidentContinuationPlan);
});
test('the closed v2 current-authorization request validates its embedded plan', () => {
  const request = { contract_version: 'process-disposition-authorization-request.v2', action: 'operation_disposition',
    nonce: plan.nonce, requested_at_ms: 0, plan_sha256: shadowHash(plan), plan };
  assert.deepEqual(validateJsonSchema(request, requestV2, '$', { contractKind: 'workflow-definition' }), []);
  const forged = structuredClone(request); forged.plan.continuation.permits_resume = true;
  assert.notEqual(validateJsonSchema(forged, requestV2, '$', { contractKind: 'workflow-definition' }).length, 0);
  const confused = structuredClone(request); confused.contract_version = 'process-disposition-authorization-request.v1';
  assert.notEqual(validateJsonSchema(confused, requestV2, '$', { contractKind: 'workflow-definition' }).length, 0);
});
test('v2 refuses foreign paths, new permission fields and version confusion', () => {
  for (const changed of ['../foreign.md', 'workflows/operation-records/foreign.json', 'C:/foreign.md', 'sessions/../foreign.md'])
    rejects(plan, p => { p.continuation.owned_paths[1] = changed; }, assertIncidentContinuationPlan);
  rejects(plan, p => { p.continuation.owned_paths[2] = p.continuation.owned_paths[1]; }, assertIncidentContinuationPlan);
  rejects(plan, p => { p.permits_effects = true; }, assertIncidentContinuationPlan);
  rejects(plan, p => { p.continuation.permits_resume = true; }, assertIncidentContinuationPlan);
  rejects(plan, p => { p.contract_version = 'process-operation-disposition-plan.v1'; }, assertIncidentContinuationPlan);
});
test('v2 captures a new UNKNOWN or completed result while retaining earlier UNKNOWN bytes', () => {
  const before = JSON.stringify(first), pending = record([first]), complete = record([first, second]);
  assert.equal(assertIncidentContinuationDisposition(pending), pending);
  assert.equal(assertIncidentContinuationDisposition(complete), complete);
  assert.equal(JSON.stringify(complete.results[0]), before);
  rejects(complete, r => { r.results[0].output.facts = { session_pr_incident_cleanup_completed: true }; }, assertIncidentContinuationDisposition);
  rejects(complete, r => { r.output = structuredClone(unknown); }, assertIncidentContinuationDisposition);
  rejects(complete, r => { r.effect_knowledge = 'unknown'; r.results.at(-1).effect_knowledge = 'unknown'; }, assertIncidentContinuationDisposition);
  rejects(complete, r => { r.results[0].plan.continuation.source_sha256 = B; }, assertIncidentContinuationDisposition);
});
test('v2 never turns a refused continuation into original no-effect or reuses a result ID', () => {
  const pending = record([first]);
  rejects(pending, r => { const output = { ...unknown, outcome: 'blocked', effect_status: 'no_effect' };
    r.output = output; r.receipt = receipt(1, output); r.results = [{ ...r.results[0], output, receipt: r.receipt }]; }, assertIncidentContinuationDisposition);
  rejects(record([first, second]), r => { r.results[1].receipt.receipt_id = r.results[0].receipt.receipt_id;
    r.receipt.receipt_id = r.results[0].receipt.receipt_id; }, assertIncidentContinuationDisposition);
});
test('the original32 journal results allow at most31 follow-on disposition results', () => {
  assert.equal(operationDispositionResultLimit, 31);
  const rows = Array.from({ length: 31 }, (_, i) => row(i + 1, unknown));
  assertIncidentContinuationDisposition(record(rows));
  assert.throws(() => assertIncidentContinuationDisposition(record([...rows, row(32, unknown)])));
});
test('v1 closed definitions remain separate and unchanged', () => {
  const originalPlan = { ...plan, contract_version: 'process-operation-disposition-plan.v1', assessment: 'confirmed_original' };
  delete originalPlan.continuation;
  assert.deepEqual(validateJsonSchema(originalPlan, v1Plan, '$', { contractKind: 'workflow-definition' }), []);
  const original = { contract_version: 'process-operation-disposition.v1', operation_id: id, revision: 1,
    plan: originalPlan, grant: {}, receipt: receipt(0, unknown), resource_fence: {}, attempts: [], admissions: [],
    acceptance_reservations: [], key_id: H, authentication: H };
  assert.deepEqual(validateJsonSchema(original, v1Record, '$', { contractKind: 'workflow-definition' }), []);
  assert.throws(() => assertIncidentContinuationPlan(originalPlan));
  assert.throws(() => assertIncidentContinuationDisposition(original));
});

function history(parallel = false) {
  const operation = { id: 'close', kind: 'operation', participant_ref: 'project', binding_ref: prIncidentCloseOperation };
  const model = { contract_version: 'agentic-process-model.v2', model_id: 'continuation-prefix', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], operation_pins: { [prIncidentCloseOperation]: H, context_reload: B },
    entry: parallel ? 'both' : 'close', nodes: parallel ? [{ id: 'both', kind: 'and', branches: [{ flow_id: 'close_flow', node_id: 'close' },
      { flow_id: 'other_flow', node_id: 'other' }], participant_ref: 'project' }, operation,
      { id: 'other', kind: 'operation', participant_ref: 'project', binding_ref: 'context_reload' }] : [operation] };
  if (!parallel) delete model.operation_pins.context_reload;
  const initial = createAgenticProcess({ instanceId: 'continuation', model, policyPins: {}, scopeId: 'fixture' });
  const occurrence = inspectAgenticProcess(initial).occurrences.find(frame => frame.node_id === 'close').occurrence_id;
  const intent = { contract_version: 'process-operation-intent.v1', operation_id: id, binding_ref: prIncidentCloseOperation,
    binding_sha256: H, input_sha256: H, preconditions_sha256: H, authorization_sha256: H, authority_id: 'fixture',
    scope_id: initial.scope_id, instance_id: initial.instance_id, instance_sha256: initial.instance_sha256,
    model_sha256: initial.model_sha256, occurrence_id: occurrence, instance_revision: initial.revision };
  const staged = advanceAgenticProcess(initial, { event_id: 'intent', kind: 'operation_intent', occurrence_id: occurrence, intent });
  const results = [{ output: unknown, receipt: receipt(0, unknown, shadowHash(intent)) }];
  const current = advanceAgenticProcess(staged, { event_id: 'unknown0', kind: 'operation_result', occurrence_id: occurrence, receipt: results[0].receipt });
  return { initial, staged, current, intent, occurrence, record: { operation_id: id, phase: 'receipted', intent,
    preview: { instance_sha256: initial.instance_sha256, binding: { id: prIncidentCloseOperation } }, results } };
}
test('accepted original UNKNOWN reconstructs only the original pre-intent view without mutation', () => {
  const f = history(), before = JSON.stringify(f);
  assert.deepEqual(prIncidentCloseReconciliationPrefix(f.current, f.record), f.initial);
  assert.equal(JSON.stringify(f), before);
  assert.throws(() => prIncidentCloseReconciliationPrefix(f.staged, f.record), { code: 'STANDARD_PR_INCIDENT_CLOSE_OWN_RESULT_REQUIRED' });
});
test('journaled intermediate UNKNOWN survives a later accepted confirmation without fabricated history', () => {
  const f = history();
  f.record.results.push({ output: unknown, receipt: receipt(1, unknown, shadowHash(f.intent)) },
    { output: success, receipt: receipt(2, success, shadowHash(f.intent)) });
  const complete = advanceAgenticProcess(f.current, { event_id: 'complete', kind: 'operation_result', occurrence_id: f.occurrence,
    receipt: f.record.results.at(-1).receipt });
  assert.deepEqual(prIncidentCloseReconciliationPrefix(complete, f.record), f.initial);
  assert.equal(f.record.results.length, 3);
  rejects(f.record, r => { r.results[0].receipt.output_sha256 = B; }, r => prIncidentCloseReconciliationPrefix(complete, r));
});
test('foreign progress and substituted accepted results refuse structural reconstruction', () => {
  const f = history(true), other = inspectAgenticProcess(f.current).occurrences.find(frame => frame.node_id === 'other');
  const intent = { ...f.intent, operation_id: 'op_' + '2'.repeat(40), binding_ref: 'context_reload', binding_sha256: B,
    instance_sha256: f.current.instance_sha256, instance_revision: f.current.revision, occurrence_id: other.occurrence_id };
  const changed = advanceAgenticProcess(f.current, { event_id: 'foreign', kind: 'operation_intent', occurrence_id: other.occurrence_id, intent });
  assert.throws(() => prIncidentCloseReconciliationPrefix(changed, f.record), { code: 'STANDARD_PR_INCIDENT_CLOSE_OWN_RESULT_REQUIRED' });
  const single = history();
  rejects(single.record, r => { r.preview.instance_sha256 = B; }, r => prIncidentCloseReconciliationPrefix(single.current, r));
  rejects(single.record, r => { r.results[0].receipt = receipt(1, unknown, shadowHash(single.intent)); },
    r => prIncidentCloseReconciliationPrefix(single.current, r));
});
// Deliberately structural examples: these are not authenticated grants or plans.
const controlAttempt = ordinal => ({ action: 'acceptance', plan: { ordinal }, grant: null, inventory: {},
  instance_sha256: H, journal_sha256: H, receipt_sha256: H, audit_sha256: H,
  resource_fence: { record: { ordinal }, previous_sha256: null } });
const controlHistory = ordinals => ({ contract_version: 'process-operation-control-intent.v1', operation_id: id,
  revision: ordinals.length, attempts: ordinals.map(controlAttempt), key_id: H, authentication: H });
test('control history permits unchanged data and append-only growth without mutating either input', () => {
  const previous = controlHistory([1]), current = controlHistory([1, 2]), before = JSON.stringify({ previous, current });
  current.authentication = B;
  const frozen = JSON.stringify({ previous, current });
  assert.equal(operationControlHistoryExtends(previous, previous), true);
  assert.equal(operationControlHistoryExtends(previous, current), true);
  assert.equal(operationControlHistoryExtends(current, controlHistory([1, 2, 3])), true);
  assert.equal(JSON.stringify({ previous, current }), frozen);
  assert.notEqual(before, frozen, 'outer MAC data differs; the reader does not authenticate it');
});
test('rewritten, reordered or removed known attempts refuse even with structurally valid outer data', () => {
  const previous = controlHistory([1, 2]);
  for (const current of [controlHistory([9, 2, 3]), controlHistory([2, 1, 3]), controlHistory([1])])
    assert.equal(operationControlHistoryExtends(previous, current), false);
  const revised = controlHistory([1, 2, 3]); revised.attempts[1].inventory = { substituted: true };
  assert.equal(operationControlHistoryExtends(previous, revised), false);
});
test('every appended attempt consumes one existing revision without rewind or skipped counters', () => {
  const previous = controlHistory([1]), current = controlHistory([1, 2]);
  for (const revision of [0, 1, 3, 10]) {
    assert.equal(operationControlHistoryExtends(previous, { ...current, revision }), false);
  }
  assert.equal(operationControlHistoryExtends(previous, { ...previous, revision: 2 }), false);
});
test('foreign operations, key identities and undeclared versions cannot extend a control history', () => {
  const previous = controlHistory([1]), current = controlHistory([1, 2]);
  for (const replacement of [{ operation_id: 'op_' + '2'.repeat(40) }, { key_id: B },
    { contract_version: 'process-operation-control-intent.v2' }])
    assert.equal(operationControlHistoryExtends(previous, { ...current, ...replacement }), false);
});
test('the existing 32-attempt bound remains closed and cannot be refunded by truncation', () => {
  const full = controlHistory(Array.from({ length: 32 }, (_, i) => i + 1));
  assert.equal(operationControlHistoryExtends(controlHistory([1]), full), true);
  assert.equal(operationControlHistoryExtends(full, controlHistory(Array.from({ length: 33 }, (_, i) => i + 1))), false);
  assert.equal(operationControlHistoryExtends(full, controlHistory([1])), false);
});
test('unknown permission fields and malformed records never supply control continuity', () => {
  const previous = controlHistory([1]);
  for (const current of [null, [], {}, { ...previous, permits_effects: true },
    { ...previous, attempts: [] }, { ...previous, authentication: 'not-a-mac' }])
    assert.equal(operationControlHistoryExtends(previous, current), false);
  assert.equal(operationControlHistoryExtends(null, previous), false);
});
console.log(JSON.stringify({ status: 'PASS', checks, scope: 'pure-v2-contracts-structural-prefix-and-control-history-data',
  source_authentication: 'NOT_PROVEN_BY_PURE_CONTRACTS', continuation_execution: 'NOT_PROVEN_BY_PURE_CONTRACTS',
  Native_calls: 0, full_standard_workflow: false }));
