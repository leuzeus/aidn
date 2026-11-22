import schema from "../contracts/workflow-definition/operation-reliability.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const noOperationReliability = Object.freeze({ idempotent: false, wait_deadline: false });

export function assertOperationReliability(policy, capabilities) {
  if (checkShadowJson(policy) || validateJsonSchema(policy, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("PROCESS_OPERATION_RELIABILITY_INVALID");
  if (capabilities !== undefined) {
    if (Object.hasOwn(policy, "max_retries") && capabilities?.idempotent !== true) fail("PROCESS_OPERATION_RETRY_UNSUPPORTED");
    if (Object.hasOwn(policy, "wait_timeout_ms") && capabilities?.wait_deadline !== true) fail("PROCESS_OPERATION_DEADLINE_UNSUPPORTED");
  }
  return policy;
}

// Only canonical operation_intent events consume attempts. A pending dispatch
// keeps its operation id and uses its journal's existing ownership/recovery path.
export function assertRetryBudget(policy, attempts) {
  if (attempts > (policy.max_retries ?? 0)) fail("PROCESS_OPERATION_RETRY_EXHAUSTED");
}

export function assertWaitDeadline(policy, startedAt, now) {
  if (policy.wait_timeout_ms === undefined) return;
  if (!Number.isSafeInteger(startedAt) || startedAt < 0 || !Number.isSafeInteger(now) || now < startedAt)
    fail("PROCESS_OPERATION_WAIT_CLOCK_INVALID");
  if (now - startedAt >= policy.wait_timeout_ms) fail("PROCESS_OPERATION_WAIT_EXPIRED");
}
