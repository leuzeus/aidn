import requestSchema from '../contracts/workflow-definition/standard-handoff-resource-request.v1.schema.json' with { type: 'json' };
import observationSchema from '../contracts/workflow-definition/standard-handoff-resource-observation.v1.schema.json' with { type: 'json' };
import resultSchema from '../contracts/workflow-definition/standard-handoff-resource-result.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import { assertProcessReconciliationInventory, RECONCILIATION_DISCOVERY_DOMAINS } from './process-reconciliation-inventory.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length) fail(code);
  return value;
};

// Provenance varies between independent captures. All material, including every
// retained UNKNOWN, source/owner identity, artifact and physical witness, stays.
export function handoffInventoryMaterialSha256(inventory) {
  assertProcessReconciliationInventory(inventory);
  const { authentication, key_id, observed_at_ms, ...material } = inventory;
  return shadowHash(material);
}
export function assertHandoffResourceRequest(value) {
  return valid(value, requestSchema, 'STANDARD_HANDOFF_RESOURCE_REQUEST_INVALID');
}
export function assertHandoffResourceObservation(value, request) {
  assertHandoffResourceRequest(request);
  valid(value, observationSchema, 'STANDARD_HANDOFF_RESOURCE_OBSERVATION_INVALID');
  if (value.request_sha256 !== shadowHash(request) || value.observed_at_ms < request.issued_at_ms
    || value.domains.length !== RECONCILIATION_DISCOVERY_DOMAINS.length
    || value.domains.some((row, index) => row.domain !== RECONCILIATION_DISCOVERY_DOMAINS[index])
    || value.evidence_refs.length !== new Set(value.evidence_refs.map(row => row.ref)).size)
    fail('STANDARD_HANDOFF_RESOURCE_OBSERVATION_UNBOUND');
  for (const row of value.domains) if (row.evidence_refs.length !== new Set(row.evidence_refs.map(ref => ref.ref)).size)
    fail('STANDARD_HANDOFF_RESOURCE_OBSERVATION_UNBOUND');
  return value;
}
export function assertHandoffResourceResult(value) {
  valid(value, resultSchema, 'STANDARD_HANDOFF_RESOURCE_RESULT_INVALID');
  if (value.unknown_business_operations.length !== new Set(value.unknown_business_operations).size)
    fail('STANDARD_HANDOFF_RESOURCE_RESULT_INVALID');
  return value;
}
