// Explicit source authoring, never a runtime pin repair or model generator.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { assertAgenticProcessModel } from "../../src/core/workflow/agentic-process-model.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { standardAssetHash } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";

const root = new URL("../../", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root));
const json = name => JSON.parse(read(name));
const startup = json("package/catalogs/process-models/aidn-standard-startup.v1.json");
const cycle = json("package/catalogs/process-models/aidn-standard-cycle-create.v1.json");
const bindings = standardWorkflowOperationBindings();
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

seq("standard", ["startup", "mode_preflight", "session_start_finalize", "mode_route"]);
nodes.push(...structuredClone(startup.nodes)); inputs.push(...structuredClone(startup.data_bindings.inputs));
nodes.find(row => row.id === "startup").children = startup.nodes.find(row => row.id === "startup").children.filter(id => id !== "session_start_finalize");
xor("mode_route", [["committing", "committing", "mode_committing"], ["thinking", "thinking_handoff", "mode_thinking"], ["exploring", "exploring_handoff", "mode_exploring"]]);
// These are component boundaries, not successful completion of either mode's
// standard workflow. The catalog keeps both work routes explicitly outstanding.
seq("thinking_handoff", []); seq("exploring_handoff", []);
xor("mode_preflight", [["committing", "startup_drift", "mode_committing"], ["thinking", "thinking_preflight", "mode_thinking"], ["exploring", "exploring_preflight", "mode_exploring"]]);
seq("thinking_preflight", []); seq("exploring_preflight", []);
seq("committing", ["cycle_create", "plan", "plan_evaluate", "plan_record", "readiness", "implementation_enter", "task_loop",
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
// The following admitted correction cycle and fresh delivery remain outstanding.
xor("session_pr_after_triage", [["corrections", "session_pr_correction", "session_pr_corrections_required"],
  ["effects_pending", "session_pr_effects_pending", null]]);
seq("session_pr_correction", ["session_pr_correction_reopen", "session_pr_correction_checkpoint"]);
op("session_pr_correction_checkpoint", "session_pr_correction_checkpoint", operation("session_pr_correction_checkpoint", "reopen_operation_id", "session_pr_correction_reopen"));
op("session_pr_correction_reopen", "session_pr_correction_reopen", operation("session_pr_correction_reopen", "triage_operation_id", "session_pr_triage_evaluate"));
seq("session_pr_effects_pending", []);
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
op("readiness", "cycle_readiness_evaluate", operation("readiness", "record_operation_id", "plan_record"));
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
seq("final_verification", ["final_validation", "verification_enter"]);
op("final_validation", "cycle_validation_evaluate", { ...operation("final_validation", "validation_operation_id", "validate"), ...operation("final_validation", "progress_operation_id", "task_advance") });
op("verification_enter", "cycle_verification_enter", operation("verification_enter", "evaluation_operation_id", "final_validation"));
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
checkpointDrift("closure_drift", "committing", "close_finalize");
checkpointDrift("promotion_drift", "promotion", "promotion_finalize");
checkpointDrift("session_closure_drift", null, null);

const policy = (id, assurance_profile, allowed_permissions, independent_review = false) => ({ id, version: 1, assurance_profile, mode: "COMMITTING",
  independent_review, context_isolation_required: independent_review, required_permissions: ["read:product"], allowed_permissions });
const model = { contract_version: "agentic-process-model.v2", model_id: "aidn-standard", revision: 1,
  participants: [{ id: "project" }], roles: [
    { id: "drift_auditor", role: "auditor", action: "analyze", skills: ["drift-check"] },
    { id: "planner", role: "auditor", action: "analyze", skills: ["cycle-create"] },
    { id: "implementer", role: "executor", action: "implement", skills: [] },
    { id: "auditor", role: "auditor", action: "audit", skills: ["cycle-close"] },
    { id: "pr_reviewer", role: "auditor", action: "audit", skills: ["pr-orchestrate"] }],
  policies: [policy("drift", "compatible-work.v1", ["read:product"]), policy("planning", "compatible-work.v1", ["read:product"]), policy("implementation", "compatible-work.v1", ["read:product", "write:product"]),
    policy("audit", "independent-review.v1", ["read:product"], true)], entry: "standard", nodes,
  operation_pins: Object.fromEntries(bindings.filter(binding => nodes.some(row => row.binding_ref === binding.id)).map(binding => [binding.id, shadowHash(binding)])),
  data_bindings: { contract_version: "process-data-bindings.v2", parameter_keys: ["session", "cycle"], inputs } };
const modelPath = "package/catalogs/process-models/aidn-standard.v1.json";
const existing = fs.existsSync(new URL(modelPath, root)) ? json(modelPath) : null;
if (existing) {
  model.revision = existing.revision;
}
assertAgenticProcessModel(model);
const catalog = { contract_version: "standard-workflow-catalog.v1", component_id: "aidn-standard", revision: model.revision,
  scope: { kind: "composed_committing_cycle_component", complete_standard_workflow: false,
    entry_conditions: ["fresh_session_admission", "single_new_cycle"], remaining_activities: ["existing_session_resume", "thinking_work", "exploring_work_and_spike_conversion",
      "cycle_choice_and_carryover", "governed_git_checkpoints", "startup_and_work_drift_routes", "incidents_and_recovery", "session_close", "pr_review_and_merge", "post_merge_sync", "full_mixed_resume"] },
  model: { path: modelPath, sha256: shadowHash(model), model_id: model.model_id, revision: model.revision },
  specification: { path: "docs/SPEC.md", sha256: standardAssetHash(read("docs/SPEC.md")) },
  bindings: nodes.filter(row => row.kind === "operation").map(row => {
    const binding = bindings.find(binding => binding.id === row.binding_ref), path = `scaffold/codex/aidn-${binding.skill_id}/SKILL.md`;
    return { node_id: row.id, binding, skill_source: { path, sha256: standardAssetHash(read(path)) } };
  }), activities };
const catalogPath = "package/catalogs/standard-workflow.v1.json";
const existingCatalog = fs.existsSync(new URL(catalogPath, root)) ? json(catalogPath) : null;
if (existing && (shadowHash(model) !== shadowHash(existing) || shadowHash(catalog) !== shadowHash(existingCatalog))) {
  model.revision++; catalog.revision = model.revision; catalog.model.revision = model.revision; catalog.model.sha256 = shadowHash(model);
}
if (process.argv.some(arg => arg.startsWith("--") && arg !== "--write")) throw Error("STANDARD_AUTHORING_ARGUMENT_INVALID");
if (process.argv.includes("--write")) {
  for (const [name, value] of [[modelPath, model], ["package/catalogs/standard-workflow.v1.json", catalog]])
    fs.writeFileSync(new URL(name, root), JSON.stringify(value, null, 2) + "\n");
}
console.log(JSON.stringify({ source_authoring_only: true, write: process.argv.includes("--write"), model: modelPath, model_sha256: shadowHash(model), nodes: nodes.length, operations: catalog.bindings.length,
  standard_workflow_complete: false, author: fileURLToPath(import.meta.url) }));
