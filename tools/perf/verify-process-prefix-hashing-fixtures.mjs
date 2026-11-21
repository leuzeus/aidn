import assert from 'node:assert/strict';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess, assertAgenticProcessInstance, agenticProcessPrefixSha256 } from '../../src/core/workflow/agentic-process.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { iterateAgenticProcessSimulation } from '../../src/core/workflow/agentic-process-simulation.mjs';

const H = 'a'.repeat(64);
let checks = 0;
const test = (name, run) => { run(); checks++; console.log('PASS ' + name); };
const model = { contract_version: 'agentic-process-model.v2', model_id: 'prefix-hashing-fixture', revision: 1,
  participants: [{ id: 'project' }], roles: [], policies: [], operation_pins: { observe: H }, entry: 'loop',
  nodes: [{ id: 'loop', kind: 'loop', participant_ref: 'project', child: 'observe', until: 'done', max_iterations: 32 },
    { id: 'observe', kind: 'operation', participant_ref: 'project', binding_ref: 'observe' }],
  data_bindings: { contract_version: 'process-data-bindings.v1', parameter_keys: ['fixture'],
    inputs: [{ node_id: 'observe', fields: {} }] } };
const initial = { instanceId: 'prefix-fixture', model, policyPins: {}, scopeId: 'prefix-fixture', facts: {}, parameters: { fixture: { text: 'é中文\n"\\' } } };
let instance = createAgenticProcess(initial);
const content = ({ instance_sha256, ...body }) => body;
const cursors = [inspectAgenticProcess(instance)], hashes = [instance.instance_sha256];
test('each intent binds the independent canonical hash of its exact historical prefix', () => {
  for (let n = 0; n < 32; n++) {
    const occurrence_id = inspectAgenticProcess(instance).ready[0], intent = {
      contract_version: 'process-operation-intent.v1', operation_id: 'op-' + n, binding_ref: 'observe', binding_sha256: H,
      input_sha256: H, preconditions_sha256: H, authorization_sha256: null, authority_id: 'fixture',
      scope_id: instance.scope_id, instance_id: instance.instance_id, instance_sha256: shadowHash(content(instance)),
      model_sha256: instance.model_sha256, occurrence_id, instance_revision: instance.revision };
    instance = advanceAgenticProcess(instance, { kind: 'operation_intent', event_id: 'intent-' + n, occurrence_id, intent });
    cursors.push(inspectAgenticProcess(instance)); hashes.push(instance.instance_sha256);
    for (const outcome of ['reconciliation_required', 'completed']) {
      const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'receipt-' + n + '-' + outcome,
        operation_id: intent.operation_id, intent_sha256: shadowHash(intent), authority_id: intent.authority_id,
        outcome, effect_status: outcome === 'completed' ? 'no_effect' : 'unknown', output_sha256: H,
        facts: outcome === 'completed' ? { done: n === 31 } : {}, evidence_refs: [{ ref: 'fixture:output', sha256: H }] };
      instance = advanceAgenticProcess(instance, { kind: 'operation_result', event_id: 'result-' + n + '-' + outcome, occurrence_id, receipt });
      cursors.push(inspectAgenticProcess(instance)); hashes.push(instance.instance_sha256);
    }
  }
  assert.equal(instance.events.length, 96); assert.equal(inspectAgenticProcess(instance).status, 'COMPLETED');
  for (let n = 0; n <= instance.events.length; n++) {
    const expected = shadowHash({ ...content(instance), revision: n + 1, events: instance.events.slice(0, n) });
    assert.equal(agenticProcessPrefixSha256(instance, n), expected); assert.equal(hashes[n], expected);
  }
});
test('streamed simulation retains every exact cursor and fingerprint including unknown waits', () => {
  const rows = [...iterateAgenticProcessSimulation({ ...initial, events: instance.events })];
  assert.equal(rows.length, 97);
  for (const [n, row] of rows.entries()) { assert.equal(row.instance_sha256, hashes[n]); assert.deepEqual(row.cursor, cursors[n]); }
});
test('validation retains identity and inspection freezes its computed cursor', () => {
  assert.equal(assertAgenticProcessInstance(instance), instance);
  const cursor = inspectAgenticProcess(instance);
  assert.equal(Object.isFrozen(cursor), true); assert.equal(Object.isFrozen(cursor.occurrences[0]), true);
});
test('mutable instances are freshly checked after a prior successful inspection', () => {
  const changed = structuredClone(instance); inspectAgenticProcess(changed);
  // Cursor freezing also freezes referenced receipts/intents, as before.
  // The caller can still replace fields on its mutable outer instance.
  changed.events = structuredClone(changed.events);
  changed.events[0].intent.input_sha256 = 'b'.repeat(64);
  assert.throws(() => inspectAgenticProcess(changed), { code: 'PROCESS_INSTANCE_INVALID' });
  changed.instance_sha256 = shadowHash(content(changed));
  assert.throws(() => inspectAgenticProcess(changed), { code: 'PROCESS_OPERATION_RECEIPT_BINDING_CHANGED' });
});
test('a rehashed journal cannot replace the historical instance bound by a later intent', () => {
  const changed = structuredClone(instance); changed.events[48].intent.instance_sha256 = H;
  changed.instance_sha256 = shadowHash(content(changed));
  assert.throws(() => inspectAgenticProcess(changed), { code: 'PROCESS_OPERATION_INTENT_BINDING_CHANGED' });
});
test('duplicate accepted receipt IDs still refuse after the enclosing hash is recomputed', () => {
  const changed = structuredClone(instance); changed.events[4].receipt.receipt_id = changed.events[1].receipt.receipt_id;
  changed.instance_sha256 = shadowHash(content(changed));
  assert.throws(() => inspectAgenticProcess(changed), { code: 'PROCESS_OPERATION_RECEIPT_REUSED' });
});
console.log(JSON.stringify({ status: 'PASS', checks, proof_class: 'pure-reducer', native_calls: 0, public_effects: 0 }));
