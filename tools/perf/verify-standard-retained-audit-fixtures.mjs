import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { assertRetainedAuditEntry, assertRetainedAuditProof, retainedAuditContinuation } from '../../src/core/workflow/standard-retained-audit.mjs';
import { standardEntryPoint, selectStandardEntry } from '../../src/core/workflow/standard-workflow-entry-selection.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardOperationProvider } from '../../src/application/runtime/standard-operation-provider.mjs';
import { ownedResumeSourceContractFixture } from './standard-owned-cycle-resume-contract-fixture-lib.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessOperationInput } from '../../src/core/workflow/process-input-resolution.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';

const digest = 'a'.repeat(64), op = 'op_' + '1'.repeat(40), reportOccurrence = 'root/3/requested/4';
const entry = { kind: 'retained_audit', failed_evaluation_operation_id: op, original_configuration: { path: 'neutral-origin.json', sha256: digest } };
const proof = { original_instance_id: 'origin', original_instance_sha256: digest, original_configuration_sha256: digest,
  native_journal_sha256: digest, failed_evaluation_operation_id: op, failed_evaluation_journal_sha256: digest,
  audit_operation_id: op, audit_journal_sha256: digest, report_occurrence_id: reportOccurrence, report_sha256: digest,
  audit_context_sha256: digest, verification_proof_sha256: digest, product_sha256: digest,
  context: { session_id: 'S001', cycle_id: 'C001', cycle_path: 'cycles/C001-feature-fixture', branch: 'feature/C001-fixture',
    head: 'a'.repeat(40), mode: 'COMMITTING', cycle_state: 'VERIFYING', product_sha256: digest } };
const admission = ownedResumeSourceContractFixture('VERIFYING').source.output, parameters = { entry_point: entry,
  session: { session_id: 'S001', session_branch: 'S001-fixture', objective: 'Fixture' },
  cycle: { cycle_id: 'C001', cycle_type: 'feature', title: 'fixture', objective: 'Fixture' } };
let checks = 0;
async function check(name, run) { await run(); checks++; console.log('PASS ' + name); }
await check('bounded audit entry retains failed evaluation and native producer identities', () => {
  assertRetainedAuditEntry(entry); assertRetainedAuditProof(proof);
  assert.equal(standardEntryPoint(parameters), 'retained_audit');
  const selected = selectStandardEntry(parameters, admission, retainedAuditContinuation(proof)); assertStandardOperationOutput(selected);
  assert.equal(selected.facts.retained_audit_requested, true); assert.equal(selected.facts.retained_preparation_requested, true);
  assert.equal(selected.facts.retained_verification_requested, false); assert.equal(selected.facts.retained_validation_requested, false);
  assert.deepEqual(selected.observations.admission, admission);
});
for (const [name, mutate] of [
  ['unsupported phase', p => p.context.cycle_state = 'DONE'], ['wrong mode', p => p.context.mode = 'THINKING'],
  ['different product', p => p.product_sha256 = 'b'.repeat(64)], ['missing native evidence', p => delete p.native_journal_sha256],
  ['missing failed receipt', p => delete p.failed_evaluation_journal_sha256], ['missing report', p => delete p.report_sha256],
  ['missing original verification', p => delete p.verification_proof_sha256], ['authored permission', p => p.approved = true],
]) await check(name + ' refuses audit retention', () => { const changed = structuredClone(proof); mutate(changed); assert.throws(() => assertRetainedAuditProof(changed)); });
await check('entry cannot substitute a failure or embed an authorization', () => {
  assert.throws(() => assertRetainedAuditEntry({ ...entry, approved: true }));
  assert.throws(() => selectStandardEntry(parameters, admission, { ...retainedAuditContinuation(proof), failed_evaluation_operation_id: 'op_' + '2'.repeat(40) }));
  assertStandardOperationInput('cycle_audit_evaluate', {});
  assert.throws(() => assertStandardOperationInput('cycle_audit_evaluate', { report_occurrence_id: reportOccurrence }));
});
await check('entry provider uses the fixed historical audit reader and rechecks the current process', async () => {
  const record = { instance_id: 'current', instance_sha256: digest, initial_parameters: parameters };
  let revision = digest, calls = 0;
  const provider = createStandardOperationProvider({ current: () => ({ record: { ...record, instance_sha256: revision } }),
    operations: { admitCycleEntry: async () => admission }, reviewEffects: new Map(),
    processAuthority: { retainedAuditEntry: async () => { calls++; return retainedAuditContinuation(proof); } },
    entryContinuation: () => assert.fail('ordinary route must not run'), fail: code => { throw Object.assign(Error(code), { code }); } });
  const select = provider.operations.find(row => row.binding.id === 'workflow_entry_select');
  assert.equal((await select.prepare({ state: { record } })).facts.retained_audit_requested, true); assert.equal(calls, 1);
  revision = 'b'.repeat(64); await assert.rejects(select.prepare({ state: { record } }), { code: 'STANDARD_ENTRY_PROCESS_CHANGED' });
});
await check('closed audit retention and current input schemas are supported', () => {
  for (const name of ['standard-retained-audit-entry.v1', 'standard-retained-audit-proof.v1', 'standard-workflow-entry-selection-output.v4', 'standard-cycle-audit-evaluate-input.v2']) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
  }
});
await check('published entry reaches current audit evaluation without native, mode, work or validation replay', () => {
  const model = JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json', import.meta.url)));
  const binding = standardWorkflowOperationBindings().find(row => row.id === 'workflow_entry_select');
  let instance = createAgenticProcess({ instanceId: 'retained-audit-fixture', model, policyPins: agenticPolicyPins(model), scopeId: 'synthetic', parameters });
  const cursor = inspectAgenticProcess(instance), occurrence = cursor.ready[0], node = processFrameNode(model, cursor.occurrences.find(row => row.occurrence_id === occurrence));
  assert.equal(node.binding_ref, 'workflow_entry_select');
  const intent = { contract_version: 'process-operation-intent.v1', operation_id: op, binding_ref: binding.id, binding_sha256: H(binding), input_sha256: H({}),
    preconditions_sha256: digest, authorization_sha256: null, authority_id: 'synthetic', scope_id: instance.scope_id, instance_id: instance.instance_id,
    instance_sha256: instance.instance_sha256, model_sha256: instance.model_sha256, occurrence_id: occurrence, instance_revision: instance.revision };
  instance = advanceAgenticProcess(instance, { event_id: 'entry-intent', kind: 'operation_intent', occurrence_id: occurrence, intent });
  const output = selectStandardEntry(parameters, admission, retainedAuditContinuation(proof));
  instance = advanceAgenticProcess(instance, { event_id: 'entry-result', kind: 'operation_result', occurrence_id: occurrence,
    receipt: { contract_version: 'process-operation-receipt.v1', receipt_id: 'synthetic-entry', operation_id: op, intent_sha256: H(intent), authority_id: 'synthetic',
      outcome: 'completed', effect_status: 'no_effect', output_sha256: H(output), facts: output.facts, evidence_refs: [{ ref: 'fixture:entry', sha256: H(output) }] } });
  const next = inspectAgenticProcess(instance), frame = next.occurrences.find(row => row.occurrence_id === next.ready[0]);
  assert.equal(processFrameNode(model, frame).binding_ref, 'cycle_audit_evaluate');
  assert.deepEqual(resolveProcessOperationInput({ instance, occurrenceId: frame.occurrence_id, readOperation: () => assert.fail('input must not import a synthetic result') }).input, {});
  assert.equal(instance.events.some(row => row.kind === 'assign' || row.kind === 'result'), false);
});
console.log(JSON.stringify({ status: 'PASS', checks, proof: 'retained-audit-contract-and-routing-fixtures', historical_reader: 'NOT_EXERCISED_BY_PURE_FIXTURES', Native: 0, p0: false }));
