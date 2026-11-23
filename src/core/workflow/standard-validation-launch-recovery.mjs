import { shadowHash as H, checkShadowJson } from "./shadow-json.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import requestSchema from "../contracts/workflow-definition/standard-validation-launch-recovery.v1.schema.json" with { type: "json" };
import recordSchema from "../contracts/workflow-definition/standard-validation-launch-recovery-record.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
const assert = (value, schema, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail(code);
  return value;
};
export const assertValidationLaunchRecoveryRequest = value => assert(value, requestSchema, "STANDARD_VALIDATION_RECOVERY_REQUEST_INVALID");
export function assertValidationLaunchRecoveryRecord(value) {
  assert(value, recordSchema, "STANDARD_VALIDATION_RECOVERY_RECORD_INVALID");
  const same = (a, b) => H(a) === H(b);
  for (const attempt of value.attempts) {
    const proposed = attempt.fence_intention.record;
    if (proposed.state !== "held" || !same(proposed.process_identity, attempt.process_identity)
      || attempt.lease && (!same(attempt.lease.record, proposed) || attempt.lease.previous_sha256 !== attempt.fence_intention.previous_sha256)
      || attempt.retirement && (!attempt.lease || attempt.retirement.lock_sha256 !== value.evidence.lock_sha256)
      || attempt.released_fence && (!attempt.retirement || !same(attempt.released_fence.record, releasedValidationRecoveryFence(proposed))))
      fail("STANDARD_VALIDATION_RECOVERY_RECORD_INVALID");
  }
  if (value.evidence.operation_id !== value.operation_id
    || new Set(value.attempts.map(attempt => attempt.fence_intention.record.token)).size !== value.attempts.length)
    fail("STANDARD_VALIDATION_RECOVERY_RECORD_INVALID");
  if (value.phase === "completed" && !value.attempts.at(-1).released_fence) fail("STANDARD_VALIDATION_RECOVERY_RECORD_INVALID");
  return value;
}
export const releasedValidationRecoveryFence = record => ({ ...record, revision: record.revision + 1, state: "released" });
export function validationRecoveryOwnsFence(recovery, current) {
  return recovery.attempts.some(attempt => H(attempt.fence_intention.record) === H(current)
    || attempt.retirement && H(releasedValidationRecoveryFence(attempt.fence_intention.record)) === H(current));
}
export function validationLaunchRecoveryEvidence(value) {
  return { instance_id: value.instance.instance_id, operation_id: value.record.operation_id,
    scope_id: value.instance.scope_id, model_sha256: value.instance.model_sha256, instance_sha256: value.instance.instance_sha256,
    journal_sha256: H(value.record), dispatch_sha256: H(value.capsule), native_sha256: H(value.native), work_sha256: H(value.work),
    profile_sha256: H(value.profile), snapshot_sha256: H(value.snapshot), startup_sha256: H(value.startup),
    authority_sha256: value.context.authority_sha256, context_sha256: value.context.context_sha256,
    original_fence_sha256: H(value.owner.lease.resource_fence), lock_sha256: value.owner.lock.sha256 };
}
