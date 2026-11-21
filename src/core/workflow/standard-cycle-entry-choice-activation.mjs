import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertCycleChoiceCheckpointPlan, assertCycleChoiceCheckpointOutput,
  cycleChoiceCheckpointDocuments } from "./standard-cycle-entry-choice-checkpoint.mjs";
import inputSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-activation-input.v1.schema.json" with { type: "json" };
import planSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-activation-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-activation-output.v1.schema.json" with { type: "json" };

export const cycleEntryChoiceActivationOperation = "cycle_entry_choice_activate";
const fail = code => { throw Object.assign(Error(code), { code }); };
const hash = value => /^[a-f0-9]{64}$/.test(value ?? "");
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === keys;

export function assertCycleChoiceActivationInput(input) {
  if (checkShadowJson(input) || validateJsonSchema(input, inputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_CHOICE_ACTIVATION_INPUT_INVALID");
  return input;
}

// This pure check binds already accepted materials. The application host must
// authenticate their original H source and journal receipts in the current
// process. Neither a digest nor this derived descriptor grants an effect.
export function cycleChoiceActivationSource(source, input) {
  assertCycleChoiceActivationInput(input);
  if (checkShadowJson(source)
    || !exactKeys(source, "checkpoint_operation_id,checkpoint_output,checkpoint_plan,checkpoint_sha256,record")
    || source.checkpoint_operation_id !== input.checkpoint_operation_id || !hash(source.checkpoint_sha256)
    || !exactKeys(source.record, "output,plan,record_operation_id,record_sha256") || !hash(source.record.record_sha256))
    fail("STANDARD_CHOICE_ACTIVATION_SOURCE_REQUIRED");
  const plan = assertCycleChoiceCheckpointPlan(source.checkpoint_plan), output = assertCycleChoiceCheckpointOutput(source.checkpoint_output),
    record = source.record, selected = record.plan, documents = cycleChoiceCheckpointDocuments(selected, record.output, plan.context?.runtime_document ?? null),
    view = plan.git.observed, observation = output.observations, git = observation.git;
  if (output.outcome !== "completed" || plan.operation_id !== input.checkpoint_operation_id
    || plan.input.record_operation_id !== record.record_operation_id
    || plan.source_sha256 !== shadowHash(record) || observation.source_sha256 !== plan.source_sha256
    || observation.record_operation_id !== record.record_operation_id
    || shadowHash(plan.documents) !== shadowHash(documents)
    || plan.session_id !== selected.question.subject.session_id || observation.session_id !== plan.session_id
    || ["selected_cycle_id", "selected_state", "selected_branch", "selected_branch_head"].some(name => plan[name] !== selected[name])
    || ["selected_cycle_id", "selected_state", "selected_branch"].some(name => observation[name] !== plan[name])
    || shadowHash([...observation.committed_paths].sort()) !== shadowHash(plan.git.files.map(row => row.path).sort()))
    fail("STANDARD_CHOICE_ACTIVATION_SOURCE_REQUIRED");
  const committed = git.status === "confirmed", sourceHead = committed ? git.commit_sha : git.head;
  if (committed ? git.parent_sha !== view.head || git.index_reconciled !== true || git.working_tree_clean !== true || git.lock_present !== false
    : git.status !== "no_change" || git.head !== view.head)
    fail("STANDARD_CHOICE_ACTIVATION_CHECKPOINT_REQUIRED");
  const targetHead = plan.selected_branch === view.branch ? sourceHead : plan.selected_branch_head;
  if (observation.selected_branch_head !== targetHead) fail("STANDARD_CHOICE_ACTIVATION_CHECKPOINT_REQUIRED");
  return { source_sha256: shadowHash(source), documents, session_id: plan.session_id,
    selected_cycle_id: plan.selected_cycle_id, selected_cycle_path: selected.selected_cycle_path, selected_state: plan.selected_state,
    source_branch: view.branch, source_head: sourceHead, selected_branch: plan.selected_branch, selected_branch_head: targetHead,
    implementation_authorized: false };
}

export function assertCycleChoiceActivationPlan(plan) {
  if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length
    || !Number.isSafeInteger(plan.prepared_at_ms) || Buffer.byteLength(JSON.stringify(plan)) > 1048576)
    fail("STANDARD_CHOICE_ACTIVATION_PLAN_INVALID");
  const view = plan.git.observed.base, observed = plan.git.observed;
  if (view.source_branch !== plan.source_branch || view.source_head !== plan.source_head
    || view.target_branch !== plan.selected_branch || view.target_head !== plan.selected_branch_head
    || view.source_ref !== "refs/heads/" + plan.source_branch || view.target_ref !== "refs/heads/" + plan.selected_branch
    || view.current_ref !== view.source_ref || view.head !== plan.source_head || !view.clean
    || view.lock_present || view.source_lock_present || view.source_symbolic || view.target_symbolic || view.target_checked_out_elsewhere
    || new Set(plan.documents.map(row => row.path)).size !== plan.documents.length
    || new Set(observed.canonical.map(row => row.path)).size !== observed.canonical.length
    || new Set(observed.changes.map(row => row.path)).size !== observed.changes.length
    || new Set(observed.canonical_overlay_paths).size !== observed.canonical_overlay_paths.length)
    fail("STANDARD_CHOICE_ACTIVATION_PLAN_INVALID");
  return plan;
}

export function assertCycleChoiceActivationOutput(output) {
  if (checkShadowJson(output) || validateJsonSchema(output, outputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_CHOICE_ACTIVATION_OUTPUT_INVALID");
  if (output.outcome === "completed") {
    const { git, selected_branch, selected_branch_head } = output.observations;
    if (git.head !== selected_branch_head || git.effect_status !== output.effect_status
      || git.status === "confirmed" && git.branch !== selected_branch)
      fail("STANDARD_CHOICE_ACTIVATION_OUTPUT_INVALID");
  }
  return output;
}
