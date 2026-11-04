import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertAgenticProcessModel, agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { createAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
const standard = JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json', import.meta.url)));
function model(version, count) {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: 'node_' + i, kind: 'sequence', participant_ref: 'project', children: [] }));
  for (let i = 1; i < count; i++) nodes[Math.floor((i - 1) / 32)].children.push(nodes[i].id);
  for (const row of nodes) if (!row.children.length) { row.kind = 'activity'; delete row.children; row.role_ref = 'drift_auditor'; row.policy_ref = 'drift'; }
  return { contract_version: 'agentic-process-model.v' + version, model_id: 'capacity-fixture', revision: 1,
    participants: [{ id: 'project' }], roles: structuredClone(standard.roles), policies: structuredClone(standard.policies),
    entry: nodes[0].id, nodes, ...(version === 2 ? { operation_pins: {} } : {}) };
}
for (const [version, limit] of [[1, 128], [2, 256]]) {
  const accepted = model(version, limit); assertAgenticProcessModel(accepted);
  assert.throws(() => assertAgenticProcessModel(model(version, limit + 1)), { code: 'PROCESS_MODEL_INVALID' });
  const options = { instanceId: 'capacity-v' + version, model: accepted, policyPins: agenticPolicyPins(accepted), scopeId: 'fixture' };
  const state = createAgenticProcess(options);
  assert.equal(inspectAgenticProcess(state).ready.length, 1);
  const simulation = simulateAgenticProcess({ ...options, events: [] });
  assert.equal(simulation.trace.at(-1).instance_sha256, state.instance_sha256);
  console.log('PASS v' + version + ': limit ' + limit + ', next node refused, reducer and simulation agree');
}

// Exercise termination at the new bound, without any native activity or host.
const complete = model(2, 256);
for (const row of complete.nodes) if (row.kind === 'activity') {
  row.kind = 'sequence'; row.children = []; delete row.role_ref; delete row.policy_ref;
}
const options = { instanceId: 'capacity-complete', model: complete, policyPins: agenticPolicyPins(complete), scopeId: 'fixture' };
const state = createAgenticProcess(options), cursor = inspectAgenticProcess(structuredClone(state));
assert.equal(cursor.status, 'COMPLETED'); assert.equal(cursor.occurrences.length, 256);
assert.ok(cursor.occurrences.every(row => row.status === 'COMPLETED'));
assert.equal(state.events.length, 0);
const simulation = simulateAgenticProcess({ ...options, events: [] });
assert.equal(simulation.trace.at(-1).cursor.status, 'COMPLETED');
assert.equal(simulation.trace.at(-1).instance_sha256, state.instance_sha256);
console.log('PASS v2: all 256 structural nodes complete and cold replay/simulation agree, zero native calls');
console.log(JSON.stringify({ status: 'PASS', checks: 3, evidence: 'bounded-structural-model-capacity-and-complete-control-only-replay', native_calls: 0, business_journey: 'NOT_RUN' }));
