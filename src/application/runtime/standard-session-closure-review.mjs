import { assertSessionClosureReview, sessionClosureChoices } from "../../core/workflow/standard-session-closure-decision.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-session-closure-review-input.v1.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-session-closure-review-plan.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
// readSource is a fixed host capability, not a model-selectable implementation.
// It must authenticate accepted admission/evaluation/finalization records from
// this instance and their physical proofs, then observe canonical current state.
export function createStandardSessionClosureReview({ readSource }) {
  if (typeof readSource !== "function") fail("STANDARD_SESSION_CLOSURE_AUTHORITY_REQUIRED");
  async function observe(instance, input) {
    if (!valid(input, inputSchema)) fail("STANDARD_SESSION_CLOSURE_INPUT_INVALID");
    const source = await readSource(instance, input), { admission, evaluation, finalization, current } = source;
    if (admission.operation_id !== input.admission_operation_id || evaluation.operation_id !== input.drift_evaluation_operation_id
      || finalization.operation_id !== input.drift_finalization_operation_id || admission.output.facts.session_close_admission_satisfied !== true
      || evaluation.output.facts.drift_present !== false || evaluation.output.facts.drift_context_complete !== true
      || evaluation.output.facts.drift_recovery_required !== false || finalization.output.facts.drift_check_completed !== true
      || finalization.output.observations.evaluation_operation_id !== input.drift_evaluation_operation_id
      || current.session_id !== admission.session_id || current.admission_allowed !== true) fail("STANDARD_SESSION_CLOSURE_ACCEPTED_SOURCE_REQUIRED");
    const review = assertSessionClosureReview({ session_id: current.session_id, session_path: current.session_path, mode: current.mode,
      branch: current.branch, session_branch: current.session_branch, head: current.head,
      admission_operation_id: admission.operation_id, admission_output_sha256: shadowHash(admission.output),
      drift_evaluation_operation_id: evaluation.operation_id, drift_evaluation_output_sha256: shadowHash(evaluation.output),
      drift_finalization_operation_id: finalization.operation_id, drift_finalization_output_sha256: shadowHash(finalization.output),
      context_sha256: current.context_sha256, scope_sha256: current.scope_sha256, documents: structuredClone(current.documents),
      open_cycles: [...current.open_cycles], session_close_gate_satisfied: current.session_close_gate_satisfied });
    return { can_apply: true, review };
  }
  return Object.freeze({
    async prepare(instance, input) {
      const observed = await observe(instance, input);
      const plan = { contract_version: "standard-session-closure-review-plan.v1", operation_ref: "session_closure_decision", input: structuredClone(input),
        review: observed.review, choices: sessionClosureChoices(observed.review) };
      if (!valid(plan, planSchema)) fail("STANDARD_SESSION_CLOSURE_PLAN_INVALID");
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async assertFresh(instance, plan) {
      if (!valid(plan, planSchema)) fail("STANDARD_SESSION_CLOSURE_PLAN_INVALID");
      const observed = await observe(instance, plan.input);
      if (shadowHash(observed.review) !== shadowHash(plan.review) || shadowHash(plan.choices) !== shadowHash(sessionClosureChoices(observed.review)))
        fail("STANDARD_SESSION_CLOSURE_REVIEW_CHANGED");
      return observed;
    },
  });
}
