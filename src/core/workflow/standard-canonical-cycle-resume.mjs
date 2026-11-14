import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { assertStandardCyclePlan } from "./standard-cycle-planning.mjs";
import { assertWorkProductSnapshot } from "./standard-cycle-work.mjs";
import { assertFocusCheckpointInput, assertFocusCheckpointPlan, assertFocusCheckpointOutput, focusCheckpointSource } from "./standard-cycle-entry-focus-checkpoint.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import inputSchema from "../contracts/workflow-definition/standard-canonical-cycle-resume-input.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-canonical-cycle-resume-output.v1.schema.json" with { type: "json" };
import observeInputSchema from "../contracts/workflow-definition/standard-canonical-cycle-resume-observe-input.v1.schema.json" with { type: "json" };
import observeOutputSchema from "../contracts/workflow-definition/standard-canonical-cycle-resume-observe-output.v1.schema.json" with { type: "json" };

export const canonicalCycleResumeAdmitOperation = "cycle_canonical_resume_admit";
export const canonicalCycleResumeObserveOperation = "cycle_canonical_resume_observe";
const fail = code => { throw Object.assign(Error(code), { code }); };
const same = (a, b) => shadowHash(a) === shadowHash(b);
const unique = values => new Set(values).size === values.length;
const operationId = value => /^op_[a-f0-9]{40}$/.test(value ?? "");
const digest = value => /^[a-f0-9]{64}$/.test(value ?? "");
const valid = (value, schema, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(value)) > 1048576) fail(code);
  return value;
};
export const assertCanonicalResumeInput = value => valid(value, inputSchema, "STANDARD_CANONICAL_RESUME_INPUT_INVALID");
export const assertCanonicalResumeObserveInput = value => valid(value, observeInputSchema, "STANDARD_CANONICAL_RESUME_OBSERVE_INPUT_INVALID");

// Retain the selected original H intent. Integration can require fresh checking
// and audit, but is not an implicit request to edit the selected product.
export function canonicalResumeIntent(recordPlan, context) {
  const subject = recordPlan?.question?.subject, selected = subject?.candidate_cycles?.find(row => row.cycle_id === context.cycle_id),
    decision = recordPlan?.decision?.selection?.carryover_decisions?.find(row => row.cycle_id === context.cycle_id);
  if (!selected || recordPlan.selected_cycle_id !== context.cycle_id || subject.session_id !== context.session_id)
    fail("STANDARD_CANONICAL_RESUME_INTENT_REQUIRED");
  let action;
  if (subject.reported_cycles.includes(context.cycle_id)) {
    action = decision?.action;
    if (!["import_now", "integrate_now"].includes(action)) fail("STANDARD_CANONICAL_RESUME_INTENT_REQUIRED");
  } else {
    if (selected.session_owner !== context.session_id || decision) fail("STANDARD_CANONICAL_RESUME_INTENT_REQUIRED");
    action = "current_owned";
  }
  return { continuity_action: action, work_intent: action === "integrate_now" ? "integration_only" : "continue_implementation" };
}

// This describes accepted history supplied by the owning host. It is not a
// signature verifier, a renewed permission, or a current phase admission.
export function canonicalResumeSource(source, input) {
  assertCanonicalResumeInput(input);
  if (!source || checkShadowJson(source) || !operationId(source.checkpoint_operation_id) || !digest(source.checkpoint_sha256)
    || source.checkpoint_operation_id !== input.focus_checkpoint_operation_id) fail("STANDARD_CANONICAL_RESUME_CHECKPOINT_REQUIRED");
  const plan = assertFocusCheckpointPlan(source.plan), output = assertFocusCheckpointOutput(source.output);
  assertFocusCheckpointInput(plan.input);
  const context = focusCheckpointSource(source.focus, plan.input);
  if (plan.operation_id !== input.focus_checkpoint_operation_id || plan.source_sha256 !== shadowHash(source.focus)
    || !same(plan.context, context) || plan.context_sha256 !== shadowHash(context)
    || output.outcome !== "completed" || !["confirmed", "no_effect"].includes(output.effect_status)
    || output.facts.cycle_entry_focus_checkpoint_ready !== true || output.facts.cycle_entry_resume_allowed !== false
    || output.observations.source_sha256 !== plan.source_sha256 || output.observations.context_sha256 !== plan.context_sha256
    || !/^[a-f0-9]{40,64}$/.test(output.observations.selected_branch_head ?? "")) fail("STANDARD_CANONICAL_RESUME_CHECKPOINT_REQUIRED");
  const intent = canonicalResumeIntent(source.focus.checkpoint.activation.checkpoint.record.plan,
    { session_id: context.session_id, cycle_id: context.selected_cycle_id });
  return { ...intent, source_sha256: shadowHash(source), checkpoint_operation_id: source.checkpoint_operation_id, checkpoint_sha256: source.checkpoint_sha256,
    session_id: context.session_id, cycle_id: context.selected_cycle_id, cycle_path: context.selected_cycle_path, phase: context.selected_state,
    branch: context.selected_branch, head: output.observations.selected_branch_head, canonical: context.canonical,
    inventory_sha256: context.inventory_sha256, backend_binding_sha256: context.backend_binding_sha256,
    scope_without_head_sha256: plan.scope_without_head_sha256, filter_context_sha256: plan.git.observed.filter_context_sha256,
    physical_focus: plan.physical_focus, checkpoint_created: output.facts.cycle_entry_focus_checkpoint_created };
}

const readinessIds = ["committing_mode", "owned_active_cycle", "explicit_intent", "constraints_and_risks", "implementation_steps", "usage_matrix", "adaptive_depth", "approved_product_scope"];
// Fresh checks on the actual context. Canonical checked tasks and retained
// verification sections remain data; neither is current work/validation proof.
export function evaluateCanonicalResumeReadiness({ projection, context, branchAdmitted }) {
  const proposal = assertStandardCyclePlan(projection?.proposal);
  if (projection.source_kind !== "canonical_progress" || projection.current_phase_admission !== false
    || projection.current_validation_evidence !== false || projection.implementation_authorized !== false
    || proposal.context_sha256 !== shadowHash(context) || projection.phase !== context.cycle_state)
    fail("STANDARD_CANONICAL_RESUME_CONTEXT_REQUIRED");
  const checks = [], check = (id, satisfied) => checks.push({ id, satisfied: satisfied === true });
  check("committing_mode", context.mode === "COMMITTING");
  check("owned_active_cycle", branchAdmitted && context.context_use === "active_cycle" && ["OPEN", "IMPLEMENTING", "VERIFYING"].includes(context.cycle_state)
    && proposal.session_id === context.session_id && proposal.cycle_id === context.cycle_id);
  check("explicit_intent", proposal.objective === context.original_objective && proposal.scope.length > 0 && proposal.non_scope.length > 0);
  check("constraints_and_risks", proposal.constraints.length > 0 && proposal.risks.length > 0);
  check("implementation_steps", proposal.tasks.length > 0 && proposal.tasks.every(row => row.intent === "implementation"));
  check("usage_matrix", proposal.surface === "local" || ["nominal", "alternate", "context"].every(kind => proposal.usage_matrix.some(row => row.kind === kind)));
  check("adaptive_depth", proposal.cycle_type === context.cycle_type);
  check("approved_product_scope", Array.isArray(context.allowed_product_files) && proposal.tasks.every(task => task.paths.every(row => context.allowed_product_files.includes(row.path))));
  return { checks, satisfied: checks.every(row => row.satisfied) };
}
export function assertCanonicalResumeOutput(value) {
  valid(value, outputSchema, "STANDARD_CANONICAL_RESUME_OUTPUT_INVALID");
  const observed = value.observations, proposal = assertStandardCyclePlan(observed.proposal), imported = observed.imported_completed_task_ids;
  if (proposal.context_sha256 !== observed.context_sha256 || proposal.session_id !== observed.session_id || proposal.cycle_id !== observed.cycle_id
    || !same(imported, proposal.tasks.slice(0, imported.length).map(row => row.id))
    || !same(observed.readiness_checks.map(row => row.id), readinessIds)
    || observed.readiness_satisfied !== observed.readiness_checks.every(row => row.satisfied)
    || observed.phase_transition_required !== (observed.canonical_phase === "OPEN")
    || observed.scope_sha256 !== shadowHash(proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })))
    || !unique(observed.canonical.map(row => row.path))
    || observed.work_intent !== (observed.continuity_action === "integrate_now" ? "integration_only" : "continue_implementation")) fail("STANDARD_CANONICAL_RESUME_OUTPUT_INVALID");
  const history = observed.retained_verification_history;
  if (history && (history.section_sha256 !== artifactContentHash(history.raw_section)
    || history.sections.map(row => row.raw_section).join("") !== history.raw_section
    || history.sections.some(row => artifactContentHash(row.raw_section) !== row.section_sha256)
    || history.evaluation_operation_id !== history.sections[0].evaluation_operation_id
    || !observed.canonical.some(row => "audit:" + row.path === history.source_ref && row.sha256 === history.document_sha256)))
    fail("STANDARD_CANONICAL_RESUME_HISTORY_INVALID");
  if (value.outcome === "completed") {
    if (value.facts.canonical_cycle_resume_available !== true || value.facts.cycle_resume_phase_admitted !== (observed.canonical_phase !== "OPEN")
      || !observed.readiness_satisfied || observed.reason_code !== null) fail("STANDARD_CANONICAL_RESUME_OUTPUT_INVALID");
  } else if (Object.keys(value.facts).length || observed.reason_code === null) fail("STANDARD_CANONICAL_RESUME_OUTPUT_INVALID");
  return value;
}
export function assertCanonicalResumeObserveOutput(value) {
  valid(value, observeOutputSchema, "STANDARD_CANONICAL_RESUME_OBSERVE_OUTPUT_INVALID");
  const observed = value.observations;
  assertWorkProductSnapshot(observed.product_snapshot);
  if (value.outcome !== "completed" || value.facts.cycle_resume_product_observed !== true || value.facts.cycle_validation_required !== true
    || observed.product_sha256 !== shadowHash(observed.product_snapshot) || !unique(observed.imported_completed_task_ids)
    || !unique(observed.current_observed_task_ids)) fail("STANDARD_CANONICAL_RESUME_OBSERVE_OUTPUT_INVALID");
  return value;
}
