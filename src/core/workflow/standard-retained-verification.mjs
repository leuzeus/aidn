import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { shadowHash as H, checkShadowJson } from "./shadow-json.mjs";
import entry from "../contracts/workflow-definition/standard-retained-verification-entry.v1.schema.json" with { type: "json" };
import proofSchema from "../contracts/workflow-definition/standard-retained-verification-proof.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-retained-verification-admission-output.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_RETAINED_VERIFICATION_CONTRACT_INVALID");
  return value;
};
export const retainedVerificationAdmit = "cycle_retained_verification_admit";
export const assertRetainedVerificationEntry = value => valid(value, entry);
export function assertRetainedVerificationProof(value) {
  valid(value, proofSchema);
  if (value.context.cycle_state !== "VERIFYING" || value.context.mode !== "COMMITTING"
    || value.context.product_sha256 !== value.product_sha256 || !value.contributors.length
    || new Set(value.contributors.map(row => row.agent_id + "/" + row.lineage_id)).size !== value.contributors.length)
    fail("STANDARD_RETAINED_VERIFICATION_PROOF_INVALID");
  return value;
}
export function assertRetainedVerificationInput(value) {
  if (checkShadowJson(value) || !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length)
    fail("STANDARD_RETAINED_VERIFICATION_CONTRACT_INVALID");
  return value;
}
export function assertRetainedVerificationOutput(value) {
  valid(value, outputSchema); assertRetainedVerificationProof(value.observations.proof);
  if (value.observations.proof_sha256 !== H(value.observations.proof)) fail("STANDARD_RETAINED_VERIFICATION_PROOF_INVALID");
  return value;
}
export const retainedVerificationContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, audit_operation_id: proof.audit_operation_id, proof_sha256: H(proof) });
