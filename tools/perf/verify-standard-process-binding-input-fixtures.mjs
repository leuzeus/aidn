import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadStandardWorkflowAssets } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { resolveStandardProcessInput } from '../../src/application/runtime/standard-process-inputs.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
const assets = loadStandardWorkflowAssets(), bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row]));
const H = 'a'.repeat(64); let serial = 0, checks = 0, covered = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
// Use the published expressions and the real reducer/input resolver. Earlier
// operations receive explicitly synthetic pure receipts; no service/Git/provider
// is constructed. This is interpreter/contract evidence, not effect evidence.
function atBoundary(spec) {
  const node = structuredClone(assets.model.nodes.find(row => row.id === spec.node_id));
  const sources = [...new Set(Object.values(spec.fields).filter(row => row.source === 'operation_id').map(row => row.node_id))];
  const sourceNodes = sources.map(id => structuredClone(assets.model.nodes.find(row => row.id === id)));
  const nodes = [{ id: 'fixture', kind: 'sequence', participant_ref: 'project', children: [...sources, node.id] }, ...sourceNodes, node];
  const model = { contract_version: 'agentic-process-model.v2', model_id: 'binding-input-boundary', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], entry: 'fixture', nodes,
    operation_pins: Object.fromEntries(nodes.filter(row => row.kind === 'operation').map(row => [row.binding_ref, shadowHash(bindings.get(row.binding_ref))])),
    data_bindings: { contract_version: 'process-data-bindings.v2', parameter_keys: [], inputs: [...sources.map(node_id => ({ node_id, fields: {} })), structuredClone(spec)] } };
  let instance = createAgenticProcess({ instanceId: 'binding-input-fixture', model, policyPins: agenticPolicyPins(model), scopeId: 'fixture-scope', parameters: {} });
  for (const source of sourceNodes) {
    const occurrence_id = inspectAgenticProcess(instance).ready[0];
    const intent = { contract_version: 'process-operation-intent.v1', operation_id: 'op_' + (++serial).toString(16).padStart(40, '0'),
      binding_ref: source.binding_ref, binding_sha256: shadowHash(bindings.get(source.binding_ref)), input_sha256: H, preconditions_sha256: H,
      authorization_sha256: H, authority_id: 'synthetic-boundary-fixture', scope_id: instance.scope_id, instance_id: instance.instance_id,
      instance_sha256: instance.instance_sha256, model_sha256: instance.model_sha256, occurrence_id, instance_revision: instance.revision };
    instance = advanceAgenticProcess(instance, { event_id: 'intent-' + serial, kind: 'operation_intent', occurrence_id, intent });
    const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'receipt-' + serial, operation_id: intent.operation_id,
      intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome: 'completed', effect_status: 'no_effect', output_sha256: H, facts: {}, evidence_refs: [{ ref: 'fixture:synthetic-prior', sha256: H }] };
    instance = advanceAgenticProcess(instance, { event_id: 'result-' + serial, kind: 'operation_result', occurrence_id, receipt });
  }
  return { instance, occurrenceId: inspectAgenticProcess(instance).ready[0], binding: bindings.get(node.binding_ref) };
}
const eligible = assets.model.data_bindings.inputs.filter(spec => assets.model.nodes.find(row => row.id === spec.node_id).kind === 'operation'
  && Object.values(spec.fields).every(row => ['literal', 'operation_id'].includes(row.source)));
test('actual interpreter resolves published literal and prior-operation expressions into registered closed inputs', () => {
  for (const spec of eligible) {
    const boundary = atBoundary(spec), resolved = resolveStandardProcessInput(boundary);
    const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/' + boundary.binding.input_contract + '.schema.json', import.meta.url)));
    assert.deepEqual(validateJsonSchema(resolved.input, schema, '$', { contractKind: 'workflow-definition' }), [], boundary.binding.id);
    if (schema.required?.includes('contract_version')) assert.equal(resolved.input.contract_version, schema.properties.contract_version.const);
    covered++;
  }
});
test('model37-shaped missing integration literal is refused at the real resolver before dispatch', () => {
  const spec = structuredClone(assets.model.data_bindings.inputs.find(row => row.node_id === 'session_branch_integration_decide'));
  delete spec.fields.contract_version;
  const boundary = atBoundary(spec), original = shadowHash(boundary.instance); let dispatches = 0;
  assert.throws(() => { resolveStandardProcessInput(boundary); dispatches++; }, { code: 'STANDARD_OPERATION_INPUT_INVALID' });
  assert.equal(dispatches, 0); assert.equal(shadowHash(boundary.instance), original);
  assert.equal(Object.hasOwn(boundary.instance.model.data_bindings.inputs.at(-1).fields, 'contract_version'), false);
});
test('an authored wrong literal cannot be repaired or promoted to the registered version during reading', () => {
  for (const node of ['session_branch_integration_decide', 'session_pr_open', 'session_pr_record', 'session_pr_update_push']) {
    const spec = structuredClone(assets.model.data_bindings.inputs.find(row => row.node_id === node));
    spec.fields.contract_version.value = 'unregistered-input.v99'; const boundary = atBoundary(spec);
    assert.throws(() => resolveStandardProcessInput(boundary), { code: 'STANDARD_OPERATION_INPUT_INVALID' });
    assert.equal(boundary.instance.model.data_bindings.inputs.at(-1).fields.contract_version.value, 'unregistered-input.v99');
  }
});
console.log(JSON.stringify({ status: 'PASS', checks, published_input_boundaries: covered, reducer_and_input_resolver: 'ACTUAL', prior_operation_receipts: 'SYNTHETIC_PURE_FIXTURE',
  service_git_provider: 'NOT_CONSTRUCTED', historical_read_repair: false, full_standard_composition: 'NOT_RUN' }));
