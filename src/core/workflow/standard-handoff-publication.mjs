import inputSchema from '../contracts/workflow-definition/standard-handoff-publication-input.v1.schema.json' with { type: 'json' };
import planSchema from '../contracts/workflow-definition/standard-handoff-publication-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-handoff-publication-output.v1.schema.json' with { type: 'json' };
import projectionSchema from '../contracts/cli-output/runtime-project-handoff-packet.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { assertHandoffContext } from './standard-handoff-context.mjs';
import { assertHandoffResourceRequest, assertHandoffResourceResult } from './standard-handoff-resources.mjs';
import { canAgentRolePerform } from '../agents/agent-role-model.mjs';
import { artifactContentHash } from './artifact-compare-swap.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
const fail = () => { throw Object.assign(Error('STANDARD_HANDOFF_PUBLICATION_INVALID'), { code: 'STANDARD_HANDOFF_PUBLICATION_INVALID', effect_status: 'no_effect' }); };
function valid(value, schema) { if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail(); return value; }
export function assertHandoffPublicationInput(value) {
  valid(value, inputSchema);
  if (!value.next_agent_goal.trim() || !canAgentRolePerform(value.next_agent_role, value.next_agent_action)
    || !canAgentRolePerform(value.from_agent_role, value.from_agent_action)) fail(); return value;
}
export function handoffPublicationResourceMaterial(value) {
  assertHandoffResourceResult(value);
  const { authentication, key_id, request_sha256, observation_sha256, observed_at_ms, ...material } = value;
  return shadowHash(material);
}
export function assertHandoffPublicationPlan(value) {
  valid(value, planSchema); assertHandoffPublicationInput(value.input); assertHandoffContext(value.context); assertHandoffResourceRequest(value.resource_request);
  if (validateJsonSchema(value.projection, projectionSchema, '$', { contractKind: 'cli-output' }).length
    || Buffer.byteLength(JSON.stringify(value)) > 700000 || artifactContentHash(value.content) !== value.after_sha256
    || value.projection.written !== false || value.projection.write !== false || value.projection.sync_relay !== false
    || value.resource_request.instance_sha256 !== value.context.instance_sha256 || value.resource_request.scope_id !== value.context.scope_id
    || value.resource_request.model_sha256 !== value.context.model_sha256 || value.resource_request.physical_root_sha256 !== value.context.physical_root_sha256
    || value.canonical_sources.length !== new Set(value.canonical_sources.map(row => row.path)).size
    || value.unknown_business_operations.length !== new Set(value.unknown_business_operations).size) fail();
  const packet = value.context.documents.find(row => row.path === value.path);
  if (!packet || packet.sha256 !== value.before_sha256 || packet.metadata_sha256 !== value.before_metadata_sha256) fail(); return value;
}
export function assertHandoffPublicationOutput(value) {
  valid(value, outputSchema);
  if (value.status === 'packet_written' ? value.effect_status !== 'confirmed' || !value.written || !value.write_attempted || !value.packet_sha256 || value.reason_code !== null || value.evidence_refs.length !== 1
    : value.written || value.evidence_refs.length || value.effect_status !== (value.status === 'reconciliation_required' ? 'unknown' : 'no_effect')) fail();
  return value;
}
