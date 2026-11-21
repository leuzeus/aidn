import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertCycleChoiceActivationPlan, assertCycleChoiceActivationOutput,
  cycleChoiceActivationSource } from "./standard-cycle-entry-choice-activation.mjs";
import inputSchema from "../contracts/workflow-definition/standard-cycle-entry-selected-input.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };

export function assertCycleEntrySelectedInput(input) {
  if (checkShadowJson(input) || validateJsonSchema(input, inputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_CYCLE_SELECTED_INPUT_INVALID");
  return input;
}

// The protected host must authenticate these accepted journals and the H source.
// This pure descriptor precedes phase admission; it grants no canonical write or implementation permission.
// An UNKNOWN activation stays ineligible even if its physical material exists.
export function cycleEntrySelectedSource(source, input) {
  assertCycleEntrySelectedInput(input);
  if (checkShadowJson(source) || !source || Object.keys(source).sort().join(",") !== "activation_operation_id,activation_sha256,checkpoint,output,plan"
    || source.activation_operation_id !== input.activation_operation_id || !/^[a-f0-9]{64}$/.test(source.activation_sha256 ?? ""))
    fail("STANDARD_CYCLE_SELECTED_SOURCE_REQUIRED");
  const plan = assertCycleChoiceActivationPlan(source.plan), output = assertCycleChoiceActivationOutput(source.output);
  if (plan.operation_id !== input.activation_operation_id || output.outcome !== "completed")
    fail("STANDARD_CYCLE_SELECTED_ACCEPTED_ACTIVATION_REQUIRED");
  const checkpoint = cycleChoiceActivationSource(source.checkpoint, plan.input), observation = output.observations;
  if (plan.source_sha256 !== checkpoint.source_sha256 || observation.source_sha256 !== plan.source_sha256
    || plan.record_operation_id !== source.checkpoint.record.record_operation_id
    || observation.record_operation_id !== plan.record_operation_id
    || observation.checkpoint_operation_id !== plan.input.checkpoint_operation_id
    || ["session_id", "selected_cycle_id", "selected_cycle_path", "selected_state", "selected_branch", "selected_branch_head"]
      .some(name => plan[name] !== checkpoint[name] || observation[name] !== plan[name])
    || plan.source_branch !== checkpoint.source_branch || plan.source_head !== checkpoint.source_head
    || shadowHash(plan.documents) !== shadowHash(checkpoint.documents))
    fail("STANDARD_CYCLE_SELECTED_SOURCE_CHANGED");
  const record = source.checkpoint.record.plan;
  return { source_sha256: shadowHash(source), activation_operation_id: input.activation_operation_id,
    decision_operation_id: record.input.decision_operation_id, record_operation_id: plan.record_operation_id,
    session_id: plan.session_id, selected_cycle_id: plan.selected_cycle_id, selected_cycle_path: plan.selected_cycle_path,
    selected_state: plan.selected_state, branch: plan.selected_branch, head: plan.selected_branch_head,
    documents: plan.documents, deferred_cycles: [...record.deferred_cycles], carry_over_pending: record.carry_over_pending,
    implementation_authorized: false };
}
