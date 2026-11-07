// Explicit source authoring, never a runtime pin repair or model generator.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { assertAgenticProcessModel } from "../../src/core/workflow/agentic-process-model.mjs";
import { processModelIdentity, processModels } from "../../src/core/workflow/process-call-model.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { standardAssetHash, verifyStandardWorkflowComponentAssets } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";

const root = new URL("../../", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root));
const json = name => JSON.parse(read(name));
const startup = json("package/catalogs/process-models/aidn-standard-startup.v1.json");
const cycle = json("package/catalogs/process-models/aidn-standard-cycle-create.v1.json");
const modelPath = "package/catalogs/process-models/aidn-standard.v1.json";
const existing = fs.existsSync(new URL(modelPath, root)) ? assertAgenticProcessModel(json(modelPath)) : null;
const bindings = standardWorkflowOperationBindings();
const pinsFor = nodes => Object.fromEntries(bindings.filter(binding => nodes.some(row => row.binding_ref === binding.id))
  .map(binding => [binding.id, shadowHash(binding)]));
const nodes = [], inputs = [], activities = [];
const node = (id, kind, body = {}) => (nodes.push({ id, kind, participant_ref: "project", ...body }), id);
const seq = (id, children) => node(id, "sequence", { children });
const op = (id, binding_ref, fields = {}) => {
  const binding = bindings.find(row => row.id === binding_ref);
  const schema = json(`src/core/contracts/workflow-definition/${binding.input_contract}.schema.json`);
  if (schema.required?.includes('contract_version')) fields = {
    contract_version: { source: 'literal', value: schema.properties.contract_version.const }, ...fields };
  node(id, "operation", { binding_ref }); inputs.push({ node_id: id, fields }); return id;
};
const operation = (node_id, field, source) => ({ [field]: { source: "operation_id", node_id: source } });
const occurrence = source => ({ report_occurrence_id: { source: "occurrence_id", node_id: source } });
const native = (id, role_ref, policy_ref, output_contract, skill_ids, rule_refs) => {
  node(id, "activity", { role_ref, policy_ref });
  activities.push({ node_id: id, output_contract, rule_refs, skill_sources: skill_ids.map(skill => {
    const path = `scaffold/codex/aidn-${skill}/SKILL.md`; return { path, sha256: standardAssetHash(read(path)) };
  }) });
  return id;
};
const xor = (id, choices) => node(id, "xor", { branches: choices.map(([flow_id, node_id, condition]) => ({ flow_id, node_id, condition })) });

seq("standard", ["startup", "mode_preflight", "session_start_finalize", "mode_route", "cycle_work_route"]);
xor("cycle_work_route", [["requested", "cycle_work", "cycle_work_requested"], ["analysis", "cycle_work_inapplicable", null]]);
seq("cycle_work_inapplicable", []);
nodes.push(...structuredClone(startup.nodes)); inputs.push(...structuredClone(startup.data_bindings.inputs));
nodes.find(row => row.id === "startup").children = startup.nodes.find(row => row.id === "startup").children.filter(id => id !== "session_start_finalize");
xor("mode_route", [["committing", "committing", "mode_committing"], ["thinking", "thinking_handoff", "mode_thinking"], ["exploring", "exploring_handoff", "mode_exploring"]]);
// Analysis reports retain their original outcomes. A received waiting report
// reaches a durable human operation; continuation creates a new loop occurrence.
// Retention still requires a separately admitted SPIKE conversion.
for (const [prefix, mode] of [["thinking", "THINKING"], ["exploring", "EXPLORING"]]) {
  seq(`${prefix}_handoff`, [...(prefix === "exploring" ? ["exploring_context_refresh", "exploring_git_checkpoint"] : []), `${prefix}_analysis_loop`, prefix === "exploring" ? "exploring_after_analysis" : `${prefix}_session_close`]);
  if (prefix === "exploring") op("exploring_git_checkpoint", "session_git_checkpoint", operation(null, "context_operation_id", "exploring_context_refresh"));
  node(`${prefix}_analysis_loop`, "loop", { child: `${prefix}_analysis_iteration`, until: "mode_analysis_completed", max_iterations: 32 });
  seq(`${prefix}_analysis_iteration`, [`${prefix}_analysis`, `${prefix}_observe`, ...(prefix === "exploring" ? ["spike_admit"] : []), `${prefix}_after_report`]);
  op(`${prefix}_observe`, "mode_work_observe", occurrence(`${prefix}_analysis`));
  xor(`${prefix}_after_report`, [["complete", `${prefix}_evaluate`, "mode_work_report_complete"], ...(prefix === "exploring" ? [["spike", "spike_conversion", "mode_work_spike_requested"]] : []), ["waiting", `${prefix}_continue_decide`, null]]);
  op(`${prefix}_continue_decide`, "mode_work_continue_decision", { review_operation_id: { source: "operation_id", node_id: `${prefix}_observe` } });
  native(`${prefix}_analysis`, "mode_analyst", `${prefix}_analysis_policy`, "standard-mode-work-report.v1", ["context-reload"], ["SPEC-R01", "SPEC-R02"]);
  op(`${prefix}_evaluate`, "mode_work_evaluate", occurrence(`${prefix}_analysis`));
}
xor("exploring_after_analysis", [["spike", "spike_work_pending", "mode_work_spike_requested"], ["analysis", "exploring_session_close", null]]);
seq("spike_work_pending", []);
op("spike_admit", "spike_conversion_admit", operation(null, "review_operation_id", "exploring_observe"));
seq("spike_conversion", ["spike_decide", "spike_initialize", "spike_finalize", "spike_experiment_admit", "spike_planning_route"]);
op("spike_decide", "spike_conversion_decision", operation(null, "review_operation_id", "exploring_observe"));
op("spike_initialize", "spike_cycle_initialize", operation(null, "decision_operation_id", "spike_decide"));
op("spike_finalize", "spike_conversion_finalize", operation(null, "initialize_operation_id", "spike_initialize"));
op("spike_experiment_admit", "spike_experiment_admit", operation(null, "initialize_operation_id", "spike_finalize"));
xor("spike_planning_route", [["committing", "spike_committing_planning", "spike_experiment_committing"], ["exploring", "spike_exploring_planning", null]]);
for (const prefix of ["spike_committing", "spike_exploring"]) {
  seq(`${prefix}_planning`, ["plan", "evaluate", "record", "execution_admit"].map(id => `${prefix}_${id}`));
  native(`${prefix}_plan`, "planner", prefix === "spike_committing" ? "planning" : "exploring_planning", "standard-cycle-plan-proposal.v1", ["cycle-create"], ["SPEC-R02", "SPEC-R04"]);
  op(`${prefix}_evaluate`, "cycle_plan_evaluate", occurrence(`${prefix}_plan`));
  op(`${prefix}_record`, "cycle_plan_record", operation(null, "evaluation_operation_id", `${prefix}_evaluate`));
  op(`${prefix}_execution_admit`, "spike_experiment_execution_admit", { ...operation(null, "conversion_operation_id", "spike_finalize"),
    ...operation(null, "record_operation_id", `${prefix}_record`) });
}
xor("mode_preflight", [["committing", "startup_drift", "mode_committing"], ["thinking", "thinking_preflight", "mode_thinking"], ["exploring", "exploring_preflight", "mode_exploring"]]);
for (const [prefix, mode] of [["thinking", "THINKING"], ["exploring", "EXPLORING"]]) {
  seq(`${prefix}_preflight`, [`${prefix}_admit`]);
  if (prefix === "exploring") op("exploring_context_refresh", "cycle_context_refresh", { session_id: { source: "operation_input", node_id: "session_initialize", path: ["session_id"] } });
  op(`${prefix}_admit`, "mode_work_preflight", { session_id: { source: "operation_input", node_id: "session_initialize", path: ["session_id"] }, mode: { source: "literal", value: mode } });
}
seq("committing", ["cycle_create", "plan", "plan_evaluate", "plan_record"]);
seq("cycle_work", ["plan_select", "readiness", "implementation_enter", "task_loop",
  "audit_select", "audit_review", "audit_evaluate", "closure_decide", "close_record", "cycle_terminal_checkpoint", "close_finalize", "promotion_eligibility", "session_preclose_checkpoint", "session_close_admit", "session_closure_drift", "session_closure_decide", "session_close_record", "session_close_checkpoint", "session_close_finalize", "session_delivery_checkpoint", "session_branch_integration_decide", "session_branch_integrate", "session_pr_delivery"]);
seq("session_pr_delivery", ["session_pr_admit", "session_push", "session_pr_open", "session_pr_record", "session_pr_checkpoint", "session_pr_update_push", "session_pr_review_observe", "session_pr_review_wait", "session_pr_review_receive", "session_pr_triage_select", "session_pr_triage", "session_pr_triage_evaluate", "session_pr_after_triage"]);
op("session_pr_review_observe", "session_pr_review_content_observe", operation("session_pr_review_observe", "update_operation_id", "session_pr_update_push"));
node("session_pr_review_wait", "event", { branches: [
  { flow_id: "review", node_id: "session_pr_review_arrived", event_key: "review_snapshot" },
  { flow_id: "checks", node_id: "session_pr_checks_arrived", event_key: "checks_snapshot" },
] });
seq("session_pr_review_arrived", []); seq("session_pr_checks_arrived", []);
op("session_pr_review_receive", "session_pr_review_receive", operation("session_pr_review_receive", "update_operation_id", "session_pr_update_push"));
op("session_pr_triage_select", "session_pr_triage_select", operation("session_pr_triage_select", "received_operation_id", "session_pr_review_receive"));
native("session_pr_triage", "pr_reviewer", "audit", "standard-pr-triage-report.v1", ["pr-orchestrate"], ["SPEC-R08", "SPEC-R11"]);
inputs.push({ node_id: "session_pr_triage", fields: operation("session_pr_triage", "selection_operation_id", "session_pr_triage_select") });
op("session_pr_triage_evaluate", "session_pr_triage_evaluate", occurrence("session_pr_triage"));
// A classified finding selects only the explicit canonical owner transition.
// Human continuation is bound to the accepted checkpoint. The subsequent
// admission and initial implementation entry are connected below; fresh
// physical work, promotion and fresh session closure/delivery use ordinary
// ports below. Causal redelivery and repeated correction choice remain due.
xor("session_pr_after_triage", [["corrections", "session_pr_correction", "session_pr_corrections_required"],
  ["effects_pending", "session_pr_effects_pending", null]]);
seq("session_pr_correction", ["session_pr_correction_reopen", "session_pr_correction_checkpoint", "session_pr_correction_decide", "session_pr_correction_requested"]);
xor("session_pr_correction_requested", [["requested", "correction_cycle", "session_pr_correction_cycle_requested"], ["not_requested", "correction_not_requested", null]]);
seq("correction_not_requested", []);
seq("correction_cycle", ["correction_initialize", "correction_branch_audit", "correction_cycle_checkpoint", "correction_plan", "correction_plan_evaluate", "correction_plan_record", "correction_readiness", "correction_implementation_enter"]);
// The first final hook consumed its start run. A new admitted occurrence must
// establish a fresh physical run; no old start receipt authorizes reclosure.
nodes.find(row => row.id === "correction_cycle").children.splice(3, 0, "correction_session_start_finalize");
op("correction_session_start_finalize", "session_start_finalize", {
  session_id: { source: "operation_input", node_id: "session_initialize", path: ["session_id"] } });
op("correction_initialize", "session_pr_correction_cycle_initialize", {
  ...operation("correction_initialize", "decision_operation_id", "session_pr_correction_decide"),
  ...Object.fromEntries(["cycle_id", "title", "objective"].map(key => [key, { source: "operation_output", node_id: "session_pr_correction_decide", path: ["observations", "candidate_cycle", key] }])) });
const correctionRef = { session_id: { source: "operation_input", node_id: "session_initialize", path: ["session_id"] },
  cycle_id: { source: "operation_input", node_id: "correction_initialize", path: ["cycle_id"] } };
op("correction_branch_audit", "branch_cycle_audit", correctionRef);
op("correction_cycle_checkpoint", "cycle_checkpoint_finalize", correctionRef);
native("correction_plan", "planner", "planning", "standard-cycle-plan-proposal.v1", ["cycle-create"], ["SPEC-R03", "SPEC-R04"]);
op("correction_plan_evaluate", "cycle_plan_evaluate", occurrence("correction_plan"));
op("correction_plan_record", "cycle_plan_record", operation("correction_plan_record", "evaluation_operation_id", "correction_plan_evaluate"));
op("correction_readiness", "cycle_readiness_evaluate", operation("correction_readiness", "record_operation_id", "correction_plan_record"));
op("correction_implementation_enter", "cycle_implementation_enter", operation("correction_implementation_enter", "evaluation_operation_id", "correction_readiness"));
op("session_pr_correction_decide", "session_pr_correction_decision", {
  ...operation("session_pr_correction_decide", "checkpoint_operation_id", "session_pr_correction_checkpoint") });
op("session_pr_correction_checkpoint", "session_pr_correction_checkpoint", operation("session_pr_correction_checkpoint", "reopen_operation_id", "session_pr_correction_reopen"));
op("session_pr_correction_reopen", "session_pr_correction_reopen", operation("session_pr_correction_reopen", "triage_operation_id", "session_pr_triage_evaluate"));
seq("session_pr_effects_pending", ["session_pr_review_effects_verify", "session_pr_merge_observe"]);
op("session_pr_review_effects_verify", "session_pr_review_effects_verify", operation(null, "triage_operation_id", "session_pr_triage_evaluate"));
op("session_pr_merge_observe", "session_pr_merge_observe", operation("session_pr_merge_observe", "triage_operation_id", "session_pr_triage_evaluate"));
op("session_pr_checkpoint", "session_pr_checkpoint", operation("session_pr_checkpoint", "record_operation_id", "session_pr_record"));
op("session_pr_update_push", "session_pr_update_push", operation("session_pr_update_push", "checkpoint_operation_id", "session_pr_checkpoint"));
op("session_pr_record", "session_pr_record", operation("session_pr_record", "open_operation_id", "session_pr_open"));
op("session_pr_open", "session_pr_open", operation("session_pr_open", "push_operation_id", "session_push"));
op("session_push", "session_push", operation("session_push", "admission_operation_id", "session_pr_admit"));
op("session_pr_admit", "session_pr_admit", operation("session_pr_admit", "integration_operation_id", "session_branch_integrate"));
op("session_branch_integration_decide", "session_branch_integration_decision", {
  ...operation("session_branch_integration_decide", "delivery_operation_id", "session_delivery_checkpoint"),
  ...operation("session_branch_integration_decide", "closure_operation_id", "close_finalize") });
op("session_branch_integrate", "session_branch_integrate", operation("session_branch_integrate", "decision_operation_id", "session_branch_integration_decide"));
op("session_delivery_checkpoint", "session_delivery_checkpoint", operation("session_delivery_checkpoint", "finalization_operation_id", "session_close_finalize"));
op("session_preclose_checkpoint", "session_preclose_checkpoint", operation("session_preclose_checkpoint", "closure_operation_id", "close_finalize"));
op("session_close_finalize", "session_close_finalize", { ...operation("session_close_finalize", "record_operation_id", "session_close_record"), ...operation("session_close_finalize", "checkpoint_operation_id", "session_close_checkpoint") });
op("session_close_checkpoint", "session_close_checkpoint", operation("session_close_checkpoint", "record_operation_id", "session_close_record"));
op("session_close_record", "session_close_record", operation("session_close_record", "decision_operation_id", "session_closure_decide"));
op("session_close_admit", "session_close_admit", { session_id: { source: "operation_input", node_id: "session_initialize", path: ["session_id"] } });
op("session_closure_decide", "session_closure_decision", { contract_version: { source: "literal", value: "standard-session-closure-review-input.v1" },
  ...operation("session_closure_decide", "admission_operation_id", "session_close_admit"),
  ...operation("session_closure_decide", "drift_evaluation_operation_id", "session_closure_drift_evaluate"),
  ...operation("session_closure_decide", "drift_finalization_operation_id", "session_closure_drift_finalize") });
const rename = id => `cycle_${id}`;
for (const original of cycle.nodes) {
  const copy = structuredClone(original);
  copy.id = copy.id === cycle.entry ? "cycle_create" : rename(copy.id);
  if (copy.children) copy.children = copy.children.map(rename);
  nodes.push(copy);
}
nodes.find(row => row.id === "cycle_create").children.splice(1, 0, "session_git_checkpoint");
op("session_git_checkpoint", "session_git_checkpoint", operation("session_git_checkpoint", "context_operation_id", "cycle_refresh_before"));
for (const original of cycle.data_bindings.inputs) {
  const copy = structuredClone(original); copy.node_id = rename(copy.node_id);
  for (const field of Object.values(copy.fields)) {
    if (field.node_id) field.node_id = rename(field.node_id);
    if (field.source === "parameter" && field.key === "cycle" && field.path.join(".") === "session_id") {
      Object.assign(field, { source: "operation_input", node_id: "session_initialize", path: ["session_id"] }); delete field.key;
    }
  }
  inputs.push(copy);
}
native("plan", "planner", "planning", "standard-cycle-plan-proposal.v1", ["cycle-create"], ["SPEC-R03", "SPEC-R04"]);
op("plan_evaluate", "cycle_plan_evaluate", occurrence("plan"));
op("plan_record", "cycle_plan_record", operation("plan_record", "evaluation_operation_id", "plan_evaluate"));
op("plan_select", "cycle_plan_select");
op("readiness", "cycle_readiness_evaluate", { record_operation_id: { source: "operation_output", node_id: "plan_select", path: ["observations", "record_operation_id"] } });
op("implementation_enter", "cycle_implementation_enter", operation("implementation_enter", "evaluation_operation_id", "readiness"));
node("task_loop", "loop", { child: "task_iteration", until: "cycle_tasks_finished", max_iterations: 32 });
seq("task_iteration", ["task_select", "implement", "work_evaluate", "validate", "task_validation", "task_advance", "task_route"]);
op("task_select", "cycle_task_select", operation("task_select", "implementation_operation_id", "implementation_enter"));
native("implement", "implementer", "implementation", "standard-cycle-task-work-report.v1", [], ["SPEC-R03", "SPEC-R04", "SPEC-R06"]);
inputs.push({ node_id: "implement", fields: operation("implement", "task_operation_id", "task_select") });
op("work_evaluate", "cycle_task_work_evaluate", occurrence("implement"));
op("validate", "cycle_validation_execute", operation("validate", "work_operation_id", "work_evaluate"));
op("task_validation", "cycle_validation_evaluate", operation("task_validation", "validation_operation_id", "validate"));
op("task_advance", "cycle_task_advance", operation("task_advance", "evaluation_operation_id", "task_validation"));
xor("task_route", [["finished", "final_verification", "cycle_tasks_finished"], ["continue", "task_continue", null]]);
seq("task_continue", []);
// Author the target once, before the correction graph clones the call site.
// The two cycle scopes provide their own validation and task progress IDs.
const firstTargetNode = nodes.length, firstTargetInput = inputs.length;
const verificationParameters = ["validation_operation_id", "progress_operation_id"];
seq("final_verification", ["final_validation", "verification_enter"]);
op("final_validation", "cycle_validation_evaluate", Object.fromEntries(verificationParameters.map(key => [key, { source: "parameter", key, path: [] }])));
op("verification_enter", "cycle_verification_enter", operation("verification_enter", "evaluation_operation_id", "final_validation"));
const verificationNodes = nodes.splice(firstTargetNode);
const verificationTarget = { contract_version: "agentic-process-model.v2", model_id: "aidn-standard-final-verification", revision: 1,
  participants: [{ id: "project" }], roles: [], policies: [], entry: "final_verification", nodes: verificationNodes,
  operation_pins: pinsFor(verificationNodes),
  call_interface: { parameters: Object.fromEntries(verificationParameters.map(key => [key, "string"])), returns: {} },
  data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: verificationParameters, inputs: inputs.splice(firstTargetInput) } };
const previousTarget = existing?.call_targets?.find(row => row.model_id === verificationTarget.model_id);
if (previousTarget) {
  verificationTarget.revision = previousTarget.revision;
  if (shadowHash(verificationTarget) !== previousTarget.model_sha256) verificationTarget.revision++;
}
const verificationRef = processModelIdentity(verificationTarget);
node("final_verification", "call", { target: verificationRef });
inputs.push({ node_id: "final_verification", fields: {
  ...operation(null, "validation_operation_id", "validate"), ...operation(null, "progress_operation_id", "task_advance"),
} });
op("audit_select", "cycle_audit_select", operation("audit_select", "implementation_operation_id", "implementation_enter"));
native("audit_review", "auditor", "audit", "standard-cycle-audit-report.v1", ["cycle-close"], ["SPEC-R04", "SPEC-R06"]);
inputs.push({ node_id: "audit_review", fields: operation("audit_review", "audit_operation_id", "audit_select") });
op("audit_evaluate", "cycle_audit_evaluate", occurrence("audit_review"));
op("closure_decide", "cycle_closure_decision", operation("closure_decide", "audit_operation_id", "audit_evaluate"));
op("close_record", "cycle_close_record", operation("close_record", "decision_operation_id", "closure_decide"));
op("cycle_terminal_checkpoint", "cycle_terminal_checkpoint", operation("cycle_terminal_checkpoint", "closure_operation_id", "close_record"));
op("close_finalize", "cycle_close_finalize", operation("close_finalize", "closure_operation_id", "close_record"));
xor("promotion_eligibility", [["retained", "promotion_choice", "cycle_retained"], ["not_retained", "promotion_inapplicable", null]]);
seq("promotion_choice", ["promotion_decide", "promotion_route"]);
seq("promotion_inapplicable", []);
op("promotion_decide", "baseline_promotion_decision", { contract_version: { source: "literal", value: "standard-baseline-promotion-review-input.v1" }, ...operation("promotion_decide", "closure_operation_id", "close_finalize") });
xor("promotion_route", [["requested", "promotion", "baseline_promotion_requested"], ["not_requested", "promotion_not_requested", "baseline_promotion_not_requested"]]);
seq("promotion", ["promotion_record", "promotion_checkpoint", "promotion_finalize"]);
seq("promotion_not_requested", []);
op("promotion_record", "baseline_promotion_record", operation("promotion_record", "decision_operation_id", "promotion_decide"));
op("promotion_checkpoint", "baseline_promotion_checkpoint", { ...operation("promotion_checkpoint", "record_operation_id", "promotion_record"),
  ...operation("promotion_checkpoint", "closure_operation_id", "close_finalize"), ...operation("promotion_checkpoint", "terminal_checkpoint_operation_id", "cycle_terminal_checkpoint") });
op("promotion_finalize", "baseline_promotion_finalize", operation("promotion_finalize", "record_operation_id", "promotion_record"));

// A diagnostic never acknowledges R05 by itself. The real finalizer checks the
// authenticated report and current scope before issuing the existing hook.
// Drift/incomplete context blocks here until its recovery route is integrated.
function checkpointDrift(id, parent, before) {
  if (parent !== null) {
    const sequence = nodes.find(row => row.id === parent);
    const index = sequence.children.indexOf(before);
    if (index < 0) throw Error("STANDARD_DRIFT_CHECKPOINT_POSITION_INVALID");
    sequence.children.splice(index, 0, id);
  }
  seq(id, [id + "_report", id + "_evaluate", id + "_finalize"]);
  native(id + "_report", "drift_auditor", "drift", "standard-drift-report.v1", ["drift-check"], ["SPEC-R05", "SPEC-R11"]);
  op(id + "_evaluate", "drift_report_evaluate", occurrence(id + "_report"));
  op(id + "_finalize", "drift_check_finalize", operation(id + "_finalize", "evaluation_operation_id", id + "_evaluate"));
}
checkpointDrift("startup_drift", null, null);
checkpointDrift("cycle_drift", "cycle_create", "cycle_checkpoint");
checkpointDrift("correction_cycle_drift", "correction_cycle", "correction_cycle_checkpoint");
checkpointDrift("closure_drift", "cycle_work", "close_finalize");
checkpointDrift("promotion_drift", "promotion", "promotion_finalize");
checkpointDrift("session_closure_drift", null, null);

// The correction is an ordinary new cycle. Reuse the governed task/validation
// and closure subgraph with distinct occurrences and the new implementation
// authority; never borrow the first cycle's accepted work or validation.
const correctionRoots = ["task_loop", "audit_select", "audit_review", "audit_evaluate", "closure_decide", "close_record",
  "cycle_terminal_checkpoint", "closure_drift", "close_finalize", "promotion_eligibility", "session_preclose_checkpoint", "session_close_admit",
  "session_closure_drift", "session_closure_decide", "session_close_record", "session_close_checkpoint", "session_close_finalize",
  "session_delivery_checkpoint", "session_branch_integration_decide", "session_branch_integrate"];
const correctionNodes = new Set();
function collectCorrection(id) {
  if (correctionNodes.has(id)) return;
  correctionNodes.add(id);
  const source = nodes.find(row => row.id === id);
  if (!source) throw Error("STANDARD_CORRECTION_SOURCE_NODE_MISSING");
  for (const child of [...(source.children ?? []), ...(source.child ? [source.child] : []), ...(source.branches ?? []).map(row => row.node_id)]) collectCorrection(child);
}
correctionRoots.forEach(collectCorrection);
const correctionName = id => correctionNodes.has(id) || id === "implementation_enter" ? "correction_" + id : id;
for (const id of correctionNodes) {
  const source = nodes.find(row => row.id === id), copy = structuredClone(source);
  copy.id = correctionName(id);
  if (copy.children) copy.children = copy.children.map(correctionName);
  if (copy.child) copy.child = correctionName(copy.child);
  if (copy.branches) copy.branches.forEach(row => { row.node_id = correctionName(row.node_id); });
  nodes.push(copy);
  const input = inputs.find(row => row.node_id === id);
  if (input) {
    const next = structuredClone(input); next.node_id = copy.id;
    for (const field of Object.values(next.fields)) if (field.node_id) field.node_id = correctionName(field.node_id);
    inputs.push(next);
  }
  const activity = activities.find(row => row.node_id === id);
  if (activity) activities.push({ ...structuredClone(activity), node_id: copy.id });
}
nodes.find(row => row.id === "correction_cycle").children.push(...correctionRoots.map(correctionName));

// Corrective delivery consumes the fresh integration and admitted cycle.
// Review/control/triage have their own occurrences and exact current HEAD.
op("correction_pr_redelivery_push", "session_pr_redelivery_push", {
  ...operation("correction_pr_redelivery_push", "integration_operation_id", "correction_session_branch_integrate"),
  ...operation("correction_pr_redelivery_push", "cycle_operation_id", "correction_initialize") });
const reviewRoots = ["session_pr_review_observe", "session_pr_review_wait", "session_pr_review_receive", "session_pr_triage_select", "session_pr_triage", "session_pr_triage_evaluate"];
const reviewNodes = new Set();
function collectReview(id) {
  if (reviewNodes.has(id)) return;
  reviewNodes.add(id); const source = nodes.find(row => row.id === id);
  for (const child of [...(source.children ?? []), ...(source.branches ?? []).map(row => row.node_id)]) collectReview(child);
}
reviewRoots.forEach(collectReview);
const reviewName = id => id === "session_pr_update_push" ? "correction_pr_redelivery_push" : reviewNodes.has(id) ? id.replace("session_pr_", "correction_pr_") : id;
for (const id of reviewNodes) {
  const copy = structuredClone(nodes.find(row => row.id === id)); copy.id = reviewName(id);
  if (copy.children) copy.children = copy.children.map(reviewName);
  if (copy.branches) copy.branches.forEach(row => { row.node_id = reviewName(row.node_id); });
  nodes.push(copy);
  const input = inputs.find(row => row.node_id === id);
  if (input) {
    const next = structuredClone(input); next.node_id = copy.id;
    for (const field of Object.values(next.fields)) if (field.node_id) field.node_id = reviewName(field.node_id);
    inputs.push(next);
  }
  const activity = activities.find(row => row.node_id === id);
  if (activity) activities.push({ ...structuredClone(activity), node_id: copy.id });
}
seq("correction_pr_effects_pending", ["correction_pr_review_effects_verify", "correction_pr_merge_observe"]);
op("correction_pr_review_effects_verify", "session_pr_review_effects_verify", operation(null, "triage_operation_id", "correction_pr_triage_evaluate"));
op("correction_pr_merge_observe", "session_pr_merge_observe", operation("correction_pr_merge_observe", "triage_operation_id", "correction_pr_triage_evaluate"));
seq("correction_pr_redelivery", ["correction_pr_redelivery_push", ...reviewRoots.map(reviewName), "correction_pr_effects_pending"]);
nodes.find(row => row.id === "correction_cycle").children.push("correction_pr_redelivery");

// Analysis completion is only an input to closure. These occurrences use the
// same R05, human decision, canonical record, checkpoint and final-hook ports
// as COMMITTING. No analysis receipt supplies a closure fact or permission.
for (const [prefix, mode] of [["thinking", "THINKING"], ["exploring", "EXPLORING"]]) {
  const name = suffix => `${prefix}_${suffix}`;
  seq(name("session_close"), ["session_close_admit", "session_closure_drift", "session_closure_decide",
    "session_close_record", "session_close_checkpoint", "session_close_finalize"].map(name));
  op(name("session_close_admit"), "session_close_admit", {
    session_id: { source: "operation_input", node_id: "session_initialize", path: ["session_id"] } });
  checkpointDrift(name("session_closure_drift"), null, null);
  nodes.find(row => row.id === name("session_closure_drift_report")).policy_ref = `${prefix}_drift_policy`;
  op(name("session_closure_decide"), "session_closure_decision", {
    ...operation(null, "admission_operation_id", name("session_close_admit")),
    ...operation(null, "drift_evaluation_operation_id", name("session_closure_drift_evaluate")),
    ...operation(null, "drift_finalization_operation_id", name("session_closure_drift_finalize")) });
  op(name("session_close_record"), "session_close_record", operation(null, "decision_operation_id", name("session_closure_decide")));
  op(name("session_close_checkpoint"), "session_close_checkpoint", operation(null, "record_operation_id", name("session_close_record")));
  op(name("session_close_finalize"), "session_close_finalize", {
    ...operation(null, "record_operation_id", name("session_close_record")),
    ...operation(null, "checkpoint_operation_id", name("session_close_checkpoint")) });
}

// First published objective review route: the terminal cycle diagnostic.
// Every retry is a new activity occurrence admitted before Native allocation.
// A true drift can record its authenticated findings, then stops at explicit
// recovery admission. It cannot loop into model work without recovery execution.
{
  const id = "closure_drift";
  Object.assign(nodes.find(row => row.id === id), { kind: "loop", child: id + "_checkpoint_iteration", until: "drift_completion_reviewed", max_iterations: 32 });
  delete nodes.find(row => row.id === id).children;
  seq(id + "_checkpoint_iteration", [id + "_completion_select", id + "_completion_route"]);
  node(id + "_loop", "loop", { child: id + "_iteration", until: "drift_check_completed", max_iterations: 32 });
  op(id + "_completion_select", "drift_completion_select");
  xor(id + "_completion_route", [["diagnose", id + "_loop", "drift_diagnosis_requested"], ["review", id + "_completion_review", "drift_completion_review_required"], ["nominal", id + "_completion_nominal", null]]);
  op(id + "_completion_review", "drift_completion_decision");
  seq(id + "_completion_nominal", []);
  seq(id + "_iteration", [id + "_report", id + "_evaluate", id + "_select", id + "_review_route", id + "_outcome_route"]);
  op(id + "_select", "drift_followup_select", operation(null, "evaluation_operation_id", id + "_evaluate"));
  xor(id + "_review_route", [["review", id + "_review_sequence", "drift_followup_review_required"], ["nominal", id + "_no_review", null]]);
  seq(id + "_review_sequence", [id + "_review", id + "_recovery_route"]);
  op(id + "_review", "drift_recovery_decision", operation(null, "evaluation_operation_id", id + "_evaluate"));
  xor(id + "_recovery_route", [["recovery", id + "_recovery_record", "drift_recovery_chosen"], ["opinion", id + "_opinion_only", null]]);
  seq(id + "_opinion_only", []);
  seq(id + "_no_review", []);
  xor(id + "_outcome_route", [["ready", id + "_finalize", "drift_route_ready"], ["diagnose", id + "_diagnosis_requested", null]]);
  op(id + "_recovery_record", "drift_recovery_record", operation(null, "decision_operation_id", id + "_review"));
  seq(id + "_diagnosis_requested", []);
}
// Expiry before any close effect completes only this attempt. The accepted R05
// completion remains in history and the next iteration enters its linked review.
// A separate authenticated selection projects the confirmed attempt identity
// across the loop boundary; data bindings never reach into a sibling/old scope.
{
  const parent = nodes.find(row => row.id === "cycle_work");
  const at = parent.children.indexOf("closure_drift");
  parent.children.splice(at, 2, "cycle_close_loop", "close_completed_select");
  node("cycle_close_loop", "loop", { child: "cycle_close_iteration", until: "cycle_close_completed", max_iterations: 32 });
  seq("cycle_close_iteration", ["closure_drift", "close_finalize"]);
  op("close_completed_select", "cycle_close_completed_select");
  for (const row of inputs) for (const expr of Object.values(row.fields)) {
    if (expr.node_id === "close_finalize") {
      if (expr.source !== "operation_id") throw Error("STANDARD_CLOSE_SELECTION_BINDING_REQUIRED");
      Object.assign(expr, { source: "operation_output", node_id: "close_completed_select", path: ["observations", "closure_operation_id"] });
    }
  }
}
// Eliminate two one-child control wrappers to retain the existing 256-node
// bound. This changes occurrence paths in this new revision, not past models.
for (const id of ["thinking_preflight", "exploring_preflight"]) {
  const wrapper = nodes.find(row => row.id === id);
  if (wrapper?.kind !== "sequence" || wrapper.children.length !== 1) throw Error("STANDARD_SINGLE_WRAPPER_REQUIRED");
  for (const parent of nodes) {
    if (parent.children) parent.children = parent.children.map(child => child === id ? wrapper.children[0] : child);
    for (const branch of parent.branches ?? []) if (branch.node_id === id) branch.node_id = wrapper.children[0];
  }
  nodes.splice(nodes.indexOf(wrapper), 1);
}

for (const id of ["cycle_drift", "promotion_drift", "correction_promotion_drift", "session_closure_drift", "thinking_session_closure_drift", "exploring_session_closure_drift"]) {
  const wrapper = nodes.find(row => row.id === id);
  const parent = nodes.find(row => row.kind === "sequence" && row.children.includes(id));
  if (wrapper?.kind !== "sequence" || !parent) throw Error("STANDARD_INLINE_SEQUENCE_REQUIRED");
  parent.children.splice(parent.children.indexOf(id), 1, ...wrapper.children);
  nodes.splice(nodes.indexOf(wrapper), 1);
}
// Inline three purely sequential groups in this new revision. No leaf, scope,
// admission or ordering changes; the model validator keeps fanout/depth limits.
for (const id of ["startup", "cycle_create", "thinking_session_close"]) {
  const wrapper = nodes.find(row => row.id === id);
  const parent = nodes.find(row => row.kind === "sequence" && row.children.includes(id));
  if (wrapper?.kind !== "sequence" || !parent) throw Error("STANDARD_INLINE_SEQUENCE_REQUIRED");
  parent.children.splice(parent.children.indexOf(id), 1, ...wrapper.children);
  nodes.splice(nodes.indexOf(wrapper), 1);
}

const policy = (id, assurance_profile, allowed_permissions, independent_review = false) => ({ id, version: 1, assurance_profile, mode: "COMMITTING",
  independent_review, context_isolation_required: independent_review, required_permissions: ["read:product"], allowed_permissions });
const model = { contract_version: "agentic-process-model.v2", model_id: "aidn-standard", revision: 1,
  participants: [{ id: "project" }], roles: [
    { id: "mode_analyst", role: "auditor", action: "analyze", skills: ["context-reload"] },
    { id: "drift_auditor", role: "auditor", action: "analyze", skills: ["drift-check"] },
    { id: "planner", role: "auditor", action: "analyze", skills: ["cycle-create"] },
    { id: "implementer", role: "executor", action: "implement", skills: [] },
    { id: "auditor", role: "auditor", action: "audit", skills: ["cycle-close"] },
    { id: "pr_reviewer", role: "auditor", action: "audit", skills: ["pr-orchestrate"] }],
  policies: [{ ...policy("thinking_analysis_policy", "compatible-work.v1", ["read:product"]), mode: "THINKING" },
    { ...policy("thinking_drift_policy", "compatible-work.v1", ["read:product"]), mode: "THINKING" },
    { ...policy("exploring_drift_policy", "compatible-work.v1", ["read:product"]), mode: "EXPLORING" },
    { ...policy("exploring_analysis_policy", "compatible-work.v1", ["read:product"]), mode: "EXPLORING" },
    { ...policy("exploring_planning", "compatible-work.v1", ["read:product"]), mode: "EXPLORING" }, policy("drift", "compatible-work.v1", ["read:product"]), policy("planning", "compatible-work.v1", ["read:product"]), policy("implementation", "compatible-work.v1", ["read:product", "write:product"]),
    policy("audit", "independent-review.v1", ["read:product"], true)], entry: "standard", nodes,
  operation_pins: pinsFor(nodes), call_targets: [{ ...verificationRef, model: verificationTarget }],
  data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: ["session", "cycle"], inputs } };
if (existing) {
  model.revision = existing.revision;
}
assertAgenticProcessModel(model);
const components = processModels(model);
const specification = read("docs/SPEC.md");
const skillSource = path => ({ path, sha256: standardAssetHash(read(path)) });
const catalog = { contract_version: components.length > 1 ? "standard-workflow-catalog.v3" : "standard-workflow-catalog.v2",
  component_id: "aidn-standard", revision: model.revision,
  scope: { kind: "composed_committing_cycle_component", complete_standard_workflow: false,
    entry_conditions: ["fresh_session_admission", "single_new_cycle"], remaining_activities: ["existing_session_resume", "thinking_session_closure", "exploring_experiments_and_spike_conversion",
      "cycle_choice_and_carryover", "governed_git_checkpoints", "startup_and_work_drift_routes", "incidents_and_recovery", "session_close", "pr_review_and_merge", "post_merge_sync", "full_mixed_resume"] },
  model: { path: modelPath, sha256: shadowHash(model), model_id: model.model_id, revision: model.revision },
  specification: { path: "docs/SPEC.md", sha256: standardAssetHash(specification) },
  bindings: components.flatMap(component => {
    const identity = component === model ? {} : { model_ref: processModelIdentity(component) };
    return component.nodes.filter(row => row.kind === "operation").map(row => {
      const binding = bindings.find(binding => binding.id === row.binding_ref);
      if (!binding) throw Error("STANDARD_AUTHORING_BINDING_MISSING");
      return { node_id: row.id, ...identity, binding, skill_source: skillSource(`scaffold/codex/aidn-${binding.skill_id}/SKILL.md`) };
    });
  }), activities };
const catalogPath = "package/catalogs/standard-workflow.v1.json";
const existingCatalog = fs.existsSync(new URL(catalogPath, root)) ? json(catalogPath) : null;
if (existing && (shadowHash(model) !== shadowHash(existing) || shadowHash(catalog) !== shadowHash(existingCatalog))) {
  model.revision++; catalog.revision = model.revision; catalog.model.revision = model.revision; catalog.model.sha256 = shadowHash(model);
}
const skillPaths = new Set([...catalog.bindings.map(row => row.skill_source.path),
  ...catalog.activities.flatMap(row => row.skill_sources.map(source => source.path))]);
verifyStandardWorkflowComponentAssets({ catalog, model, specification, bindings,
  skills: Object.fromEntries([...skillPaths].map(path => [path, read(path)])) });
if (process.argv.some(arg => arg.startsWith("--") && arg !== "--write")) throw Error("STANDARD_AUTHORING_ARGUMENT_INVALID");
if (process.argv.includes("--write")) {
  for (const [name, value] of [[modelPath, model], ["package/catalogs/standard-workflow.v1.json", catalog]])
    fs.writeFileSync(new URL(name, root), JSON.stringify(value, null, 2) + "\n");
}
console.log(JSON.stringify({ source_authoring_only: true, write: process.argv.includes("--write"), model: modelPath, model_sha256: shadowHash(model), nodes: nodes.length, operations: catalog.bindings.length,
  standard_workflow_complete: false, author: fileURLToPath(import.meta.url) }));
