import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadStandardWorkflowAssets } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { resolveStandardProcessInput } from '../../src/application/runtime/standard-process-inputs.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import { assertProcessDataBindings } from '../../src/core/workflow/process-data-contracts.mjs';
import { assertStandardWorkflowComponentCatalog } from '../../src/core/workflow/standard-workflow-model-catalog.mjs';
const assets = loadStandardWorkflowAssets(), bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row]));
const H = 'a'.repeat(64); let serial = 0, checks = 0, covered = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
test('catalog versions retain their entry vocabulary, closed rows and original capacity bounds', () => {
  assertStandardWorkflowComponentCatalog(assets.catalog, assets.model);
  const flatRow = assets.catalog.bindings.find(row => !Object.hasOwn(row, 'model_ref'));
  for (const [v, counts] of [[1, [128, 129]], [2, [135, 256, 257]], [3, [135, 256, 257]], [4, [135, 256, 257]]]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-workflow-catalog.v${v}.schema.json`, import.meta.url)));
    const entry = v === 4 ? 'fresh_or_existing_session_admission' : 'fresh_session_admission';
    for (const count of counts) {
      const value = { ...assets.catalog, contract_version: `standard-workflow-catalog.v${v}`,
        scope: { ...assets.catalog.scope, entry_conditions: [entry, 'single_new_cycle'] },
        bindings: Array.from({ length: count }, (_, i) => ({ ...flatRow, node_id: 'op_' + i })) };
      const errors = validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' });
      assert.equal(errors.length === 0, count <= (v === 1 ? 128 : 256), `catalog v${v} count ${count}: ${errors}`);
    }
    const wrongEntry = { ...assets.catalog, contract_version: `standard-workflow-catalog.v${v}`, bindings: [flatRow],
      scope: { ...assets.catalog.scope, entry_conditions: [v === 4 ? 'fresh_session_admission' : 'fresh_or_existing_session_admission', 'single_new_cycle'] } };
    assert.ok(validateJsonSchema(wrongEntry, schema, '$', { contractKind: 'workflow-definition' }).length);
    if (v <= 2) {
      const embeddedRow = { ...wrongEntry, scope: { ...wrongEntry.scope, entry_conditions: [entry, 'single_new_cycle'] },
        bindings: [{ ...flatRow, model_ref: { model_id: assets.model.model_id, revision: assets.model.revision, model_sha256: shadowHash(assets.model) } }] };
      assert.ok(validateJsonSchema(embeddedRow, schema, '$', { contractKind: 'workflow-definition' }).length);
    }
  }
  assert.throws(() => assertStandardWorkflowComponentCatalog({ ...assets.catalog, activities: assets.catalog.activities.slice(1) }, assets.model), { code: 'STANDARD_ACTIVITY_COVERAGE_INVALID' });
});
test('versioned binding capacity preserves v1/v2 bounds and admits the larger standard graph only through v3', () => {
  const rows = length => Array.from({ length }, (_, i) => ({ node_id: 'op_' + i, fields: {} }));
  const nodes = length => rows(length).map(row => ({ id: row.node_id, kind: 'operation' }));
  for (const version of [1, 2]) {
    const value = { contract_version: `process-data-bindings.v${version}`, parameter_keys: [], inputs: rows(128) };
    assertProcessDataBindings(value, nodes(128));
    assert.throws(() => assertProcessDataBindings({ ...value, inputs: rows(129) }, nodes(129)), { code: 'PROCESS_DATA_BINDINGS_INVALID' });
    assert.equal(value.inputs.length, 128);
  }
  for (const count of [141, 256]) assertProcessDataBindings({ contract_version: 'process-data-bindings.v3', parameter_keys: [], inputs: rows(count) }, nodes(count));
  assert.throws(() => assertProcessDataBindings({ contract_version: 'process-data-bindings.v3', parameter_keys: [], inputs: rows(257) }, nodes(257)), { code: 'PROCESS_DATA_BINDINGS_INVALID' });
  const instance = createAgenticProcess({ instanceId: 'capacity-v3', scopeId: 'fixture', model: assets.model, policyPins: agenticPolicyPins(assets.model), facts: {}, parameters: { session: {}, cycle: {} } });
  const hash = instance.instance_sha256;
  const replay = inspectAgenticProcess(instance);
  assert.equal(replay.status, 'RUNNING'); assert.equal(instance.instance_sha256, hash);
});
// Use the published expressions and the real reducer/input resolver. Earlier
// operations receive explicitly synthetic pure receipts; no service/Git/provider
// is constructed. This is interpreter/contract evidence, not effect evidence.
function atBoundary(spec) {
  const node = structuredClone(assets.model.nodes.find(row => row.id === spec.node_id));
  const expressions = Object.values(spec.fields);
  const sources = [...new Set(expressions.filter(row => ['operation_id', 'operation_output'].includes(row.source)).map(row => row.node_id))];
  const sourceNodes = sources.map(id => structuredClone(assets.model.nodes.find(row => row.id === id)));
  const nodes = [{ id: 'fixture', kind: 'sequence', participant_ref: 'project', children: [...sources, node.id] }, ...sourceNodes, node];
  const model = { contract_version: 'agentic-process-model.v2', model_id: 'binding-input-boundary', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], entry: 'fixture', nodes,
    operation_pins: Object.fromEntries(nodes.filter(row => row.kind === 'operation').map(row => [row.binding_ref, shadowHash(bindings.get(row.binding_ref))])),
    data_bindings: { contract_version: 'process-data-bindings.v2', parameter_keys: [], inputs: [...sources.map(node_id => ({ node_id, fields: {} })), structuredClone(spec)] } };
  let instance = createAgenticProcess({ instanceId: 'binding-input-fixture', model, policyPins: agenticPolicyPins(model), scopeId: 'fixture-scope', parameters: {} });
  const operations = new Map();
  for (const source of sourceNodes) {
    const priorInput = {};
    const readsOutput = expressions.some(row => row.source === 'operation_output' && row.node_id === source.id);
    let output = {};
    if (readsOutput) {
      assert.equal(source.binding_ref, 'cycle_close_completed_select');
      output = { contract_version: 'standard-cycle-close-selection-output.v1', operation_ref: source.binding_ref,
        outcome: 'completed', effect_status: 'no_effect', facts: {}, evidence_refs: [],
        observations: { closure_operation_id: 'op_' + 'e'.repeat(40), receipt_sha256: H, output_sha256: H } };
    }
    const occurrence_id = inspectAgenticProcess(instance).ready[0];
    const intent = { contract_version: 'process-operation-intent.v1', operation_id: 'op_' + (++serial).toString(16).padStart(40, '0'),
      binding_ref: source.binding_ref, binding_sha256: shadowHash(bindings.get(source.binding_ref)), input_sha256: shadowHash(priorInput), preconditions_sha256: H,
      authorization_sha256: H, authority_id: 'synthetic-boundary-fixture', scope_id: instance.scope_id, instance_id: instance.instance_id,
      instance_sha256: instance.instance_sha256, model_sha256: instance.model_sha256, occurrence_id, instance_revision: instance.revision };
    instance = advanceAgenticProcess(instance, { event_id: 'intent-' + serial, kind: 'operation_intent', occurrence_id, intent });
    const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'receipt-' + serial, operation_id: intent.operation_id,
      intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome: 'completed', effect_status: 'no_effect', output_sha256: shadowHash(output), facts: {}, evidence_refs: [{ ref: 'fixture:synthetic-prior', sha256: H }] };
    instance = advanceAgenticProcess(instance, { event_id: 'result-' + serial, kind: 'operation_result', occurrence_id, receipt });
    operations.set(intent.operation_id, { phase: 'receipted', preview: { input: priorInput }, intent, results: [{ output, receipt }] });
  }
  return { instance, occurrenceId: inspectAgenticProcess(instance).ready[0], binding: bindings.get(node.binding_ref),
    readOperation: id => operations.get(id) };
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
test('the integration boundary consumes the exact accepted close selection and refuses a substituted receipt result', () => {
  const spec = assets.model.data_bindings.inputs.find(row => row.node_id === 'session_branch_integration_decide');
  const boundary = atBoundary(spec);
  const resolved = resolveStandardProcessInput(boundary);
  assert.equal(resolved.input.closure_operation_id, 'op_' + 'e'.repeat(40));
  assert.throws(() => resolveStandardProcessInput({ ...boundary, readOperation: id => {
    const retained = structuredClone(boundary.readOperation(id));
    retained.results[0].output.observations.closure_operation_id = 'op_' + 'f'.repeat(40);
    return retained;
  } }), { code: 'PROCESS_INPUT_RESULT_CHANGED' });
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
