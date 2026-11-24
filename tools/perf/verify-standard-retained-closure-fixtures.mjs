import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertRetainedClosureEntry, assertRetainedClosureProof, retainedClosureContinuation } from '../../src/core/workflow/standard-retained-closure.mjs';
import { standardEntryPoint, selectStandardEntry } from '../../src/core/workflow/standard-workflow-entry-selection.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardOperationProvider } from '../../src/application/runtime/standard-operation-provider.mjs';
import { ownedResumeSourceContractFixture } from './standard-owned-cycle-resume-contract-fixture-lib.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessOperationInput } from '../../src/core/workflow/process-input-resolution.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const digest = 'a'.repeat(64), decisionId = 'op_' + '1'.repeat(40), entryId = 'op_' + '2'.repeat(40);
const entry = { kind: 'retained_closure', decision_operation_id: decisionId, original_configuration: { path: 'neutral-origin.json', sha256: digest } };
const context = { session_id: 'S001', cycle_id: 'C001', cycle_path: 'cycles/C001-feature-fixture', branch: 'feature/C001-fixture',
  head: 'a'.repeat(40), mode: 'COMMITTING', cycle_state: 'VERIFYING', product_sha256: digest };
const proof = { original_instance_id: 'origin', original_instance_sha256: digest, original_configuration_sha256: digest,
  decision_operation_id: decisionId, decision_journal_sha256: digest, question_sha256: digest, source_sha256: digest, inbox_sha256: digest,
  audit_operation_id: 'op_' + '3'.repeat(40), audit_journal_sha256: digest, retained_audit_proof_sha256: digest,
  context, product_sha256: digest, report_sha256: digest, choice: 'retain' };
const parameters = { entry_point: entry, session: { session_id: 'S001', session_branch: 'S001-fixture', objective: 'Fixture' },
  cycle: { cycle_id: 'C001', cycle_type: 'feature', title: 'fixture', objective: 'Fixture' } };
const admission = ownedResumeSourceContractFixture('VERIFYING').source.output;
let checks = 0; const check = async (name, run) => { await run(); checks++; console.log('PASS ' + name); };
await check('closed retained decision proof preserves the old question and current cycle identity', () => {
  assertRetainedClosureEntry(entry); assertRetainedClosureProof(proof); assert.equal(standardEntryPoint(parameters), 'retained_closure');
  const output = selectStandardEntry(parameters, admission, retainedClosureContinuation(proof)); assertStandardOperationOutput(output);
  assert.equal(output.facts.retained_closure_requested, true); assert.equal(output.facts.retained_audit_requested, true);
  assert.equal(output.facts.cycle_close_completed, undefined); assert.equal(output.observations.continuation.decision_operation_id, decisionId);
});
for (const [name, mutate] of [
  ['missing signed question', p => delete p.question_sha256], ['missing inbox', p => delete p.inbox_sha256],
  ['missing audit chain', p => delete p.retained_audit_proof_sha256], ['non-retained choice', p => p.choice = 'drop'],
  ['changed product', p => p.product_sha256 = 'b'.repeat(64)], ['terminal cycle', p => p.context.cycle_state = 'DONE'],
  ['wrong mode', p => p.context.mode = 'THINKING'], ['authored permission', p => p.authorized = true],
]) await check(name + ' refuses the bounded continuation', () => { const changed = structuredClone(proof); mutate(changed); assert.throws(() => assertRetainedClosureProof(changed)); });
await check('entry cannot select a different decision or supply a new response', () => {
  assert.throws(() => selectStandardEntry(parameters, admission, { ...retainedClosureContinuation(proof), decision_operation_id: entryId }));
  assert.throws(() => assertRetainedClosureEntry({ ...entry, choice: 'retain' }));
  assertStandardOperationInput('cycle_close_record', {});
  assert.throws(() => assertStandardOperationInput('cycle_close_record', { decision_operation_id: decisionId }));
});
await check('entry provider requires its fixed source and fences a changed process', async () => {
  const record = { instance_id: 'current', instance_sha256: digest, initial_parameters: parameters }; let revision = digest, called = 0;
  const provider = createStandardOperationProvider({ current: () => ({ record: { ...record, instance_sha256: revision } }),
    operations: { admitCycleEntry: async () => admission }, reviewEffects: new Map(), processAuthority: {},
    retainedClosureEntry: async () => { called++; return retainedClosureContinuation(proof); },
    fail: code => { throw Object.assign(Error(code), { code }); } });
  const select = provider.operations.find(row => row.binding.id === 'workflow_entry_select');
  assert.equal((await select.prepare({ state: { record } })).facts.retained_closure_requested, true); assert.equal(called, 1);
  revision = 'b'.repeat(64); await assert.rejects(select.prepare({ state: { record } }), { code: 'STANDARD_ENTRY_PROCESS_CHANGED' });
});
await check('published retained route reaches closure without replaying Human, audit or Native', () => {
  const model = JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json', import.meta.url)));
  const binding = standardWorkflowOperationBindings().find(row => row.id === 'workflow_entry_select');
  let instance = createAgenticProcess({ instanceId: 'closure-fixture', model, policyPins: agenticPolicyPins(model), scopeId: 'fixture', parameters });
  const occurrence = inspectAgenticProcess(instance).ready[0], intent = { contract_version: 'process-operation-intent.v1', operation_id: entryId,
    binding_ref: binding.id, binding_sha256: H(binding), input_sha256: H({}), preconditions_sha256: digest, authorization_sha256: null,
    authority_id: 'fixture', scope_id: instance.scope_id, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
    model_sha256: instance.model_sha256, occurrence_id: occurrence, instance_revision: instance.revision };
  instance = advanceAgenticProcess(instance, { event_id: 'entry', kind: 'operation_intent', occurrence_id: occurrence, intent });
  const output = selectStandardEntry(parameters, admission, retainedClosureContinuation(proof));
  instance = advanceAgenticProcess(instance, { event_id: 'accepted', kind: 'operation_result', occurrence_id: occurrence,
    receipt: { contract_version: 'process-operation-receipt.v1', receipt_id: 'fixture-receipt', operation_id: entryId, intent_sha256: H(intent),
      authority_id: 'fixture', outcome: 'completed', effect_status: 'no_effect', output_sha256: H(output), facts: output.facts, evidence_refs: [{ ref: 'fixture:entry', sha256: H(output) }] } });
  const cursor = inspectAgenticProcess(instance), frame = cursor.occurrences.find(row => row.occurrence_id === cursor.ready[0]);
  assert.equal(processFrameNode(model, frame).binding_ref, 'cycle_close_record');
  assert.deepEqual(resolveProcessOperationInput({ instance, occurrenceId: frame.occurrence_id }).input, {});
  assert.equal(instance.events.length, 2); assert.equal(model.nodes.length, 288);
});
await check('all new schemas use the closed supported vocabulary', () => {
  for (const name of ['standard-retained-closure-entry.v1', 'standard-retained-closure-proof.v1', 'standard-workflow-entry-selection-output.v5', 'standard-cycle-close-input.v2']) {
    const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/' + name + '.schema.json', import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
  }
});
console.log(JSON.stringify({ status: 'PASS', checks, proof: 'retained-closure-contract-provider-routing', historical_reader: 'NOT_RUN', actual_close: 'NOT_RUN', native_calls: 0, p0: false }));
