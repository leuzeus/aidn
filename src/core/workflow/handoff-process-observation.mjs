import schema from '../contracts/workflow-definition/handoff-process-observation.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
const fail = () => { throw Object.assign(Error('HANDOFF_PROCESS_OBSERVATION_INVALID'), { code: 'HANDOFF_PROCESS_OBSERVATION_INVALID' }); };
const identity = row => row.platform === 'win32' ? /^[0-9]{18}$/.test(row.creation)
  : /^[a-f0-9-]{36}:[0-9]+$/.test(row.creation);
const material = sample => ({ processes: sample.processes, unavailable: sample.unavailable });
export function assertHandoffProcessObservation(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail();
  if (!identity(value.observer_identity) || new Set(value.scope_root_sha256).size !== value.scope_root_sha256.length
    || value.samples[0].captured_at_ms > value.samples[1].captured_at_ms) fail();
  for (const sample of value.samples) {
    const rows = [...sample.processes, ...sample.unavailable];
    if (rows.length > sample.scanned_processes || new Set(rows.map(row => row.pid)).size !== rows.length
      || rows.some(row => row.pid === value.observer_identity.pid)
      || sample.processes.some((row, i) => !identity({ ...value.observer_identity, creation: row.creation })
        || !value.scope_root_sha256.includes(row.scope_root_sha256)
        || row.scope_match === 'marker' && row.command_line_sha256 === null
        || i && row.pid <= sample.processes[i - 1].pid)
      || sample.unavailable.some((row, i) => row.scope_root_sha256 !== null && !value.scope_root_sha256.includes(row.scope_root_sha256)
        || i && row.pid <= sample.unavailable[i - 1].pid)) fail();
  }
  if (value.stable !== (H(material(value.samples[0])) === H(material(value.samples[1])))) fail();
  return value;
}
