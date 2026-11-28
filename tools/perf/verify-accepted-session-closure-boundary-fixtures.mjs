import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processModelIdentity } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessCallData } from '../../src/core/workflow/process-call-data.mjs';
import { assertAcceptedSessionClosureBoundary } from '../../src/core/workflow/standard-retained-session-closure-boundary.mjs';
import { assertRetainedSessionClosureEntry, assertRetainedSessionClosureProof } from '../../src/core/workflow/standard-retained-session-closure.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Synthetic operation receipts, real reducer/call scoping. Authentication,
// canonical documents and physical Native closures belong to the host tests.
const sequence = ['workflow_entry_select', 'cycle_close_completed_select', 'drift_report_evaluate', 'drift_followup_select',
  'drift_check_finalize', 'baseline_promotion_finalize', 'session_preclose_checkpoint', 'session_close_admit',
  'drift_report_evaluate', 'drift_check_finalize', 'session_closure_decision'];
const target = { contract_version: 'agentic-process-model.v2', model_id: 'fixture-delivery', revision: 1,
  participants: [{ id: 'project' }], roles: [], policies: [], entry: 'old_preparation',
  nodes: [{ id: 'old_preparation', kind: 'sequence', participant_ref: 'project', children: ['session_close_preparation_route'] },
    { id: 'session_close_preparation_route', kind: 'xor', participant_ref: 'project', branches: [
      { flow_id: 'delivered', node_id: 'delivered', condition: 'retained_session_delivery_requested' },
      { flow_id: 'ordinary', node_id: 'ordinary', condition: null }] },
    { id: 'delivered', kind: 'sequence', participant_ref: 'project', children: [] },
    { id: 'ordinary', kind: 'sequence', participant_ref: 'project', children: [] }],
  operation_pins: {}, call_interface: { parameters: {}, returns: {} },
  data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: [], inputs: [] } };
const bindings = standardWorkflowOperationBindings(), identity = processModelIdentity(target);
const ops = sequence.map((binding_ref, i) => ({ id: 'step_' + i, kind: 'operation', participant_ref: 'project', binding_ref }));
const call = { id: 'session_integration_prepare', kind: 'call', participant_ref: 'project', target: identity };
const model = { contract_version: 'agentic-process-model.v2', model_id: 'fixture-accepted-close', revision: 1,
  participants: [{ id: 'project' }], roles: [], policies: [], entry: 'steps',
  nodes: [{ id: 'steps', kind: 'sequence', participant_ref: 'project', children: [...ops.map(row => row.id), call.id] }, ...ops, call],
  operation_pins: Object.fromEntries(sequence.map(id => [id, H(bindings.find(row => row.id === id))])),
  call_targets: [{ ...identity, model: target }],
  data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: ['entry_point'], inputs: [...ops, call].map(row => ({ node_id: row.id, fields: {} })) } };
let instance = createAgenticProcess({ instanceId: 'fixture-accepted-close', model, policyPins: agenticPolicyPins(model), scopeId: 'fixture',
  parameters: { entry_point: { kind: 'retained_promotion', version: 2 } } });
const records = [];
for (const [index, node] of ops.entries()) {
  const frame = inspectAgenticProcess(instance).occurrences.find(row => row.status === 'READY'); assert.equal(frame.node_id, node.id);
  const id = 'op_' + H({ index }).slice(0, 40), binding = bindings.find(row => row.id === node.binding_ref);
  const intent = { contract_version: 'process-operation-intent.v1', operation_id: id, binding_ref: binding.id, binding_sha256: H(binding),
    input_sha256: H({}), preconditions_sha256: 'a'.repeat(64), authorization_sha256: null, authority_id: 'fixture', scope_id: instance.scope_id,
    instance_id: instance.instance_id, instance_sha256: instance.instance_sha256, model_sha256: instance.model_sha256,
    occurrence_id: frame.occurrence_id, instance_revision: instance.revision };
  instance = advanceAgenticProcess(instance, { event_id: 'intent_' + index, kind: 'operation_intent', occurrence_id: frame.occurrence_id, intent });
  const facts = index === 0 ? { retained_session_delivery_requested: false } : index === ops.length - 1 ? { session_closure_requested: true } : {};
  const output = { outcome: 'completed', effect_status: 'no_effect', facts, observations: {} };
  const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'fixture_' + index, operation_id: id, intent_sha256: H(intent),
    authority_id: 'fixture', outcome: 'completed', effect_status: 'no_effect', output_sha256: H(output), facts,
    evidence_refs: [{ ref: 'fixture:synthetic', sha256: H(output) }] };
  instance = advanceAgenticProcess(instance, { event_id: 'result_' + index, kind: 'operation_result', occurrence_id: frame.occurrence_id, receipt });
  records.push({ operation_id: id, phase: 'receipted', intent, results: [{ receipt, output }] });
}
const waiting = inspectAgenticProcess(instance).occurrences.find(row => row.wait_reason === 'call_entry');
const data = resolveProcessCallData({ instance, cursor: inspectAgenticProcess(instance), occurrenceId: waiting.occurrence_id, readOperation: () => { throw Error('UNEXPECTED_READ'); } });
instance = advanceAgenticProcess(instance, { event_id: 'call_entry', kind: 'call_enter', occurrence_id: waiting.occurrence_id, ...data });
const entry = { kind: 'retained_session_closure', version: 2, boundary: 'accepted_close_route_wait', original_instance_sha256: instance.instance_sha256,
  decision_operation_id: records.at(-1).operation_id, original_configuration: { path: 'origin.json', sha256: 'b'.repeat(64) },
  start_configuration: { path: 'start.json', sha256: 'c'.repeat(64) } };
const before = H({ instance, records, entry }), result = assertAcceptedSessionClosureBoundary(entry, instance, records);
assert.equal(result.version, 2); assert.equal(result.post_decision_events_sha256, H(instance.events.slice(-1)));
assert.equal(inspectAgenticProcess(instance).ready.length, 0);
let checks = 1;
for (const mutate of [
  (e) => { e.original_instance_sha256 = 'd'.repeat(64); },
  (e) => { e.decision_operation_id = 'op_' + 'e'.repeat(40); },
  (_e, _i, rows) => { rows[2].results[0].receipt.effect_status = 'unknown'; },
  (_e, _i, rows) => { rows[3].results[0].output.outcome = 'blocked'; },
  (_e, _i, rows) => { rows[0].phase = 'dispatched'; },
  (_e, _i, rows) => { rows.at(-1).results.push(rows.at(-1).results[0]); },
  (_e, _i, rows) => { rows.splice(3, 1); },
  (_e, _i, rows) => { rows.push(rows[0]); },
  (_e, i) => { i.events.splice(i.events.findIndex(row => row.event_id === 'result_10'), 1); },
  (e) => { e.boundary = 'arbitrary_resume'; },
  (e) => { e.choice = 'close'; },
]) {
  const changed = structuredClone({ entry, instance, records }); mutate(changed.entry, changed.instance, changed.records);
  assert.throws(() => assertAcceptedSessionClosureBoundary(changed.entry, changed.instance, changed.records)); checks++;
}
const later = advanceAgenticProcess(instance, { event_id: 'later_root_fact', kind: 'facts', facts: { retained_session_delivery_requested: false } });
assert.equal(inspectAgenticProcess(later).occurrences.find(row => row.node_id === 'session_close_preparation_route').wait_reason, 'routing_fact');
assert.throws(() => assertAcceptedSessionClosureBoundary({ ...entry, original_instance_sha256: later.instance_sha256 }, later, records)); checks++;
for (const kind of ['entry', 'proof']) {
  const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/standard-retained-session-closure-' + kind + '.v2.schema.json', import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []); checks++;
}
assertRetainedSessionClosureEntry(entry);
assert.throws(() => assertRetainedSessionClosureProof({ version: 2, boundary: entry.boundary }));
assert.equal(H({ instance, records, entry }), before);
console.log(JSON.stringify({ status: 'PASS', checks, scope: 'accepted-close-boundary-and-real-call-scoping-with-synthetic-receipts',
  authentication: 'NOT_RUN', business_effects: 0, native_calls: 0 }));
