import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash as H } from './shadow-json.mjs';
import entrySchema from '../contracts/workflow-definition/standard-retained-closure-entry.v1.schema.json' with { type: 'json' };
import proofSchema from '../contracts/workflow-definition/standard-retained-closure-proof.v1.schema.json' with { type: 'json' };

const validate = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length)
    throw Object.assign(Error('STANDARD_RETAINED_CLOSURE_CONTRACT_INVALID'), { code: 'STANDARD_RETAINED_CLOSURE_CONTRACT_INVALID' });
  return value;
};
export const assertRetainedClosureEntry = value => validate(value, entrySchema);
export function assertRetainedClosureProof(value) {
  validate(value, proofSchema);
  if (value.context.mode !== 'COMMITTING' || value.context.cycle_state !== 'VERIFYING' || value.product_sha256 !== value.context.product_sha256)
    throw Object.assign(Error('STANDARD_RETAINED_CLOSURE_CONTEXT_INVALID'), { code: 'STANDARD_RETAINED_CLOSURE_CONTEXT_INVALID' });
  return value;
}
export const retainedClosureContinuation = proof => ({ source_instance_id: proof.original_instance_id,
  source_instance_sha256: proof.original_instance_sha256, decision_operation_id: proof.decision_operation_id,
  proof_sha256: H(assertRetainedClosureProof(proof)) });

// Callers authenticate both sources first. This causal comparison grants no
// effect and never substitutes a historical context for current postimages.
export function assertRetainedClosureTerminalMaterial(plan, output, verified) {
  const { proof, question, decision, report, audit_output } = verified;
  assertRetainedClosureProof(proof);
  const transition = output?.observations?.causal_transition;
  if (plan.input.decision_operation_id !== proof.decision_operation_id || question.operation_id !== proof.decision_operation_id
    || plan.cycle_path !== proof.context.cycle_path || plan.target_state !== 'DONE' || decision.choice !== 'retain'
    || H({ question, decision, report }) !== plan.decision_material_sha256
    || question.review.audit_output_sha256 !== H(audit_output) || question.review.report_sha256 !== H(report)
    || output.operation_ref !== 'cycle_close_record' || output.outcome !== 'completed' || output.effect_status !== 'confirmed'
    || output.facts.cycle_terminal_recorded !== true || output.facts.cycle_close_completed !== false
    || output.observations.decision_operation_id !== proof.decision_operation_id || output.observations.target_state !== plan.target_state
    || transition?.before_context_sha256 !== plan.context_sha256 || transition?.decision_material_sha256 !== plan.decision_material_sha256)
    throw Object.assign(Error('STANDARD_CYCLE_CLOSE_RECORDED_PROVENANCE_CHANGED'), { code: 'STANDARD_CYCLE_CLOSE_RECORDED_PROVENANCE_CHANGED' });
}
