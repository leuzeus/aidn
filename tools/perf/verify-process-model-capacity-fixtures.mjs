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
console.log(JSON.stringify({ status: 'PASS', checks: 2, evidence: 'bounded-structural-model-capacity', native_calls: 0 }));
