import schema from '../contracts/workflow-definition/standard-handoff-context.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { shadowHash, checkShadowJson } from './shadow-json.mjs';

export function assertHandoffContext(value) {
  const fail = () => { throw Object.assign(Error('STANDARD_HANDOFF_CONTEXT_INVALID'), { code: 'STANDARD_HANDOFF_CONTEXT_INVALID' }); };
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail();
  const { context_sha256, ...body } = value;
  if (shadowHash(body) !== context_sha256 || new Set(value.documents.map(row => row.path)).size !== value.documents.length
    || Object.values(value.selected).some(path => path !== null && !value.documents.some(row => row.path === path))
    || ['CURRENT-STATE.md', 'SPEC.md', 'WORKFLOW.md', 'WORKFLOW-KERNEL.md', 'snapshots/context-snapshot.md'].some(path =>
      !value.documents.some(row => row.path === path && row.sha256 !== null))
    || ['session_path', 'cycle_status_path'].some(key => value.selected[key] !== null
      && !value.documents.some(row => row.path === value.selected[key] && row.sha256 !== null))
    || value.state_mode !== 'files' && value.canonical_source === 'files'
    || value.state_mode === 'files' && value.canonical_source === 'sqlite') fail();
  return value;
}
