import planSchemaV2 from '../contracts/workflow-definition/native-owner-disposition-plan.v2.schema.json' with { type: 'json' };
import recordSchemaV2 from '../contracts/workflow-definition/native-owner-disposition-record.v2.schema.json' with { type: 'json' };
import requestSchemaV2 from '../contracts/workflow-definition/native-owner-disposition-authorization-request.v2.schema.json' with { type: 'json' };
import receiptSchemaV2 from '../contracts/workflow-definition/native-owner-disposition-receipt.v2.schema.json' with { type: 'json' };
import planSchema from '../contracts/workflow-definition/native-owner-disposition-plan.v1.schema.json' with { type: 'json' };
import recordSchema from '../contracts/workflow-definition/native-owner-disposition-record.v1.schema.json' with { type: 'json' };
import requestSchema from '../contracts/workflow-definition/native-owner-disposition-authorization-request.v1.schema.json' with { type: 'json' };
import receiptSchema from '../contracts/workflow-definition/native-owner-disposition-receipt.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import { nativeDispatchPath } from './native-dispatch-record.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
function checked(value, schema) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
  return value;
}
const postVersion = (value, kind) => value?.contract_version === 'native-owner-disposition-' + kind + '.v2';
export function assertNativeOwnerDispositionPlan(value) {
  checked(value, postVersion(value, 'plan') ? planSchemaV2 : planSchema);
  if (postVersion(value, 'plan') && (value.initial_instance_sha256 === value.checkpoint_instance_sha256
    || value.initial_instance_sha256 === value.instance_sha256)) fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
  return value;
}
export const assertNativeOwnerDispositionRequest = value => checked(value, postVersion(value, 'authorization-request') ? requestSchemaV2 : requestSchema);
export const assertNativeOwnerDispositionReceipt = value => checked(value, postVersion(value, 'receipt') ? receiptSchemaV2 : receiptSchema);
export function nativeOwnerDispositionPath(id) {
  nativeDispatchPath(id);
  return 'workflows/native-owner-dispositions/' + id + '.json';
}
export function assertNativeOwnerDispositionRecord(value) {
  const post = postVersion(value, 'record');
  checked(value, post ? recordSchemaV2 : recordSchema); const { plan, attempts, receipt, phase } = value, last = attempts.at(-1);
  assertNativeOwnerDispositionPlan(plan);
  if (post !== postVersion(plan, 'plan') || post && value.profile !== plan.profile) fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
  if (['dispatch_id', 'journal_id', 'instance_id', 'scope_id', 'model_sha256'].some(key => value[key] !== plan[key])
    || new Set(attempts.map(row => row.attempt_id)).size !== attempts.length)
    fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
  for (const row of attempts) {
    const request = assertNativeOwnerDispositionRequest(row.request);
    if (post !== postVersion(request, 'authorization-request')
      || post && (request.profile !== plan.profile || request.post_assignment_sha256 !== plan.post_assignment_sha256))
      fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
    if (request.plan_sha256 !== H(plan) || ['dispatch_id', 'journal_id', 'generation', 'instance_id', 'instance_sha256', 'scope_id', 'model_sha256', 'configuration_sha256']
      .some(key => request[key] !== plan[key]) || row.grant.request_sha256 !== H(request)
      || row.verification.request_sha256 !== H(request) || row.verification.grant_sha256 !== H(row.grant)
      || row.verification.authority_id !== row.grant.authority_id
      || H(row.fence_intention.record.process_identity) !== H(row.process_identity)
      || row.fence_intention.record.physical_root_sha256 !== plan.physical_root_sha256
      || row.fence_intention.record.state !== 'held'
      || row.lease !== null && (H(row.lease.record) !== H(row.fence_intention.record)
        || row.lease.previous_sha256 !== row.fence_intention.previous_sha256)
      || row.retirement !== null && (row.lease === null || row.retirement.lock_sha256 !== plan.lock_sha256)
      || row.released_fence !== null && (row.retirement === null
        || H(row.released_fence.record) !== H({ ...row.lease.record, state: 'released', revision: row.lease.record.revision + 1 })))
      fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
  }
  if (receipt !== null) {
    assertNativeOwnerDispositionReceipt(receipt);
    if (post !== postVersion(receipt, 'receipt') || post && (receipt.profile !== plan.profile
      || receipt.post_assignment_sha256 !== plan.post_assignment_sha256)) fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
  }
  const producer = receipt === null ? null : attempts.find(row => row.attempt_id === receipt.attempt_id);
  if ((phase === 'intent') !== (last.lease === null) || ['retired', 'confirmed'].includes(phase) !== (last.retirement !== null)
    || phase === 'confirmed' && (last.released_fence === null || receipt === null)
    || phase === 'retired' && receipt === null
    || receipt !== null && (!producer?.retirement || receipt.dispatch_id !== plan.dispatch_id
      || receipt.plan_sha256 !== H(plan) || receipt.original_lease_sha256 !== plan.original_lease_sha256
      || receipt.lock_sha256 !== plan.lock_sha256 || receipt.retirement_sha256 !== H(producer.retirement)))
    fail('NATIVE_OWNER_DISPOSITION_CONTRACT_INVALID');
  return value;
}
