import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyStandardDataCallFixture } from './standard-composed-call-fixture-lib.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processFrameNode, processFrameModel } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessCallData } from '../../src/core/workflow/process-call-data.mjs';
import { resolveProcessFrameInput } from '../../src/core/workflow/process-frame-input.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

// The production reducer chooses each branch. Receipts below are synthetic
// driver-oracle data and supply no business, actor or authority qualification.
export function verifyStandardRecoveryCallFixture() {
  const published = JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json', import.meta.url)));
  const target = published.call_targets.find(row => row.model_id === 'aidn-standard-drift-recovery');
  const callSite = published.nodes.find(row => row.id === 'closure_drift_recovery_execution');
  const upstream = published.nodes.find(row => row.id === 'closure_drift_review');
  const model = { ...published, model_id: 'synthetic-recovery-call-fixture', roles: [], policies: [], entry: 'fixture',
    operation_pins: { [upstream.binding_ref]: published.operation_pins[upstream.binding_ref] }, call_targets: [target],
    nodes: [{ id: 'fixture', kind: 'sequence', participant_ref: 'project', children: [upstream.id, callSite.id] }, upstream, callSite],
    data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: [], inputs: [{ node_id: upstream.id, fields: {} },
      published.data_bindings.inputs.find(row => row.node_id === callSite.id)] } };
  const H = 'a'.repeat(64), observations = [];
  let checks = 0;
  for (const choice of ['record', 'new_cycle', 'rollback', 'pending']) {
    const journals = new Map(); let serial = 0;
    let record = createAgenticProcess({ instanceId: 'synthetic-' + choice, scopeId: 'synthetic-fixture', model, policyPins: agenticPolicyPins(model), facts: {}, parameters: {} });
    const emit = value => { record = advanceAgenticProcess(record, { event_id: 'synthetic-' + ++serial, ...value }); };
    const accepted = (id, binding) => {
      const journal = journals.get(id); assert.ok(journal, 'source-authored synthetic journal required');
      assert.equal(journal.intent.binding_ref, binding);
      assert.ok(record.events.some(event => event.kind === 'operation_result' && shadowHash(event.receipt) === shadowHash(journal.results[0].receipt)));
      return journal;
    };
    let returned;
    for (let i = 0; i < 40; i++) {
      const cursor = inspectAgenticProcess(record);
      if (cursor.status === 'COMPLETED') break;
      const call = cursor.occurrences.find(row => row.status === 'WAITING' && ['call_entry', 'call_return'].includes(row.wait_reason));
      if (call) {
        const entering = call.wait_reason === 'call_entry';
        const data = resolveProcessCallData({ instance: record, cursor, occurrenceId: call.occurrence_id, returning: !entering, readOperation: id => journals.get(id) });
        emit({ kind: entering ? 'call_enter' : 'call_return', occurrence_id: call.occurrence_id, ...data });
        const args = { call, model, parameters: {}, cursor, event: record.events.at(-1), entering, accepted, readOperation: id => journals.get(id) };
        verifyStandardDataCallFixture(args); checks++;
        if (!entering) returned = args;
        continue;
      }
      const frame = cursor.occurrences.find(row => row.status === 'READY'); assert.ok(frame, 'synthetic path must have a ready operation');
      const node = processFrameNode(model, frame);
      const resolution = resolveProcessFrameInput({ instance: record, cursor, occurrenceId: frame.occurrence_id, readOperation: id => journals.get(id) });
      const intent = { contract_version: 'process-operation-intent.v1', operation_id: 'synthetic-op-' + serial,
        binding_ref: node.binding_ref, binding_sha256: processFrameModel(model, frame).operation_pins[node.binding_ref], input_sha256: shadowHash(resolution.input), preconditions_sha256: H,
        authorization_sha256: null, authority_id: 'synthetic-host', scope_id: record.scope_id, instance_id: record.instance_id,
        instance_sha256: record.instance_sha256, model_sha256: record.model_sha256, occurrence_id: frame.occurrence_id, instance_revision: record.revision };
      emit({ kind: 'operation_intent', occurrence_id: frame.occurrence_id, intent });
      const facts = node.id === 'recovery_record' ? { drift_recovery_recorded: true, drift_recovery_requirements_delta: choice === 'record',
        drift_recovery_new_cycle: choice === 'new_cycle', drift_recovery_rollback: choice === 'rollback' } : {};
      const output = { observations: node.id === 'recovery_cycle_decide' ? { selected_cycle: { cycle_id: 'C002', cycle_type: 'feature', title: 'Synthetic recovery' } } : {} };
      const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'synthetic-receipt-' + serial, operation_id: intent.operation_id,
        intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome: 'completed', effect_status: 'no_effect', output_sha256: shadowHash(output), facts,
        evidence_refs: [{ ref: 'synthetic/driver-oracle', sha256: H }] };
      journals.set(intent.operation_id, { operation_id: intent.operation_id, phase: 'receipted', intent, preview: { input: resolution.input }, results: [{ receipt, output }] });
      emit({ kind: 'operation_result', occurrence_id: frame.occurrence_id, receipt });
    }
    assert.equal(inspectAgenticProcess(record).status, 'COMPLETED'); assert.ok(returned);
    const childOperations = returned.cursor.occurrences.filter(row => row.call_scope_id === returned.call.occurrence_id && row.operation?.intent);
    observations.push({ branch: choice, operations: childOperations.map(row => row.node_id), events: record.events.length });
    const missing = structuredClone(returned.cursor);
    const victim = childOperations.at(-1);
    missing.occurrences = missing.occurrences.filter(row => row.occurrence_id !== victim.occurrence_id);
    assert.throws(() => verifyStandardDataCallFixture({ ...returned, cursor: missing })); checks++;
    const foreign = structuredClone(returned.cursor);
    const skipped = target.model.nodes.find(row => row.kind === 'operation' && !childOperations.some(child => child.node_id === row.id));
    foreign.occurrences.push({ ...structuredClone(victim), node_id: skipped.id, occurrence_id: 'synthetic-foreign-operation' });
    assert.throws(() => verifyStandardDataCallFixture({ ...returned, cursor: foreign })); checks++;
  }
  return { status: 'PASS_SYNTHETIC_RECOVERY_CALL_ORACLE_ONLY', checks, observations,
    business_ports: 'NOT_RUN', authentication: 'SYNTHETIC_RECEIPTS_ONLY', Native_calls: 0, full_standard: false };
}
