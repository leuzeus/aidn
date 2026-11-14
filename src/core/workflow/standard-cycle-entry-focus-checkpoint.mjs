import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertSelectedFocusPlan, assertSelectedFocusOutput, selectedFocusSource } from "./standard-cycle-entry-selected-focus.mjs";
import inputSchema from "../contracts/workflow-definition/standard-cycle-entry-focus-checkpoint-input.v1.schema.json" with { type: "json" };
import planSchema from "../contracts/workflow-definition/standard-cycle-entry-focus-checkpoint-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-cycle-entry-focus-checkpoint-output.v1.schema.json" with { type: "json" };

export const cycleEntryFocusCheckpointOperation = "cycle_entry_focus_checkpoint";
const fail = code => { throw Object.assign(Error(code), { code }); };
const same = (a, b) => shadowHash(a) === shadowHash(b);
const unique = rows => new Set(rows).size === rows.length;
const focusPaths = sessionId => ["docs/audit/CURRENT-STATE.md", "docs/audit/sessions/" + sessionId + ".md", "docs/audit/snapshots/context-snapshot.md"].sort();
export function assertFocusCheckpointInput(input) {
  if (checkShadowJson(input) || validateJsonSchema(input, inputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_FOCUS_CHECKPOINT_INPUT_INVALID");
  return input;
}
// Data validation only. The host must authenticate the accepted focus and its
// original checkpoint/activation/record/H chain in the current process.
export function focusCheckpointSource(source, input) {
  assertFocusCheckpointInput(input);
  if (checkShadowJson(source) || !source || Object.keys(source).sort().join(",") !== "checkpoint,focus_operation_id,focus_sha256,output,plan"
    || source.focus_operation_id !== input.focus_operation_id || !/^[a-f0-9]{64}$/.test(source.focus_sha256 ?? ""))
    fail("STANDARD_FOCUS_CHECKPOINT_SOURCE_REQUIRED");
  const plan = assertSelectedFocusPlan(source.plan), output = assertSelectedFocusOutput(source.output);
  if (plan.operation_id !== input.focus_operation_id || output.outcome !== "completed")
    fail("STANDARD_FOCUS_CHECKPOINT_ACCEPTED_FOCUS_REQUIRED");
  const prior = selectedFocusSource(source.checkpoint, plan.input), view = output.observations;
  if (plan.source_sha256 !== shadowHash(source.checkpoint) || plan.source_sha256 !== prior.source_sha256
    || !same(plan.documents, prior.canonical) || view.source_sha256 !== plan.source_sha256
    || view.checkpoint_operation_id !== plan.input.checkpoint_operation_id
    || ["session_id", "selected_cycle_id", "selected_cycle_path", "selected_state", "selected_branch", "selected_branch_head"].some(key => view[key] !== plan[key] || plan[key] !== prior[key])
    || view.phase_route !== plan.phase_route || view.carry_over_pending !== plan.carry_over_pending
    || !same(view.deferred_cycles, plan.deferred_cycles) || !same(plan.deferred_cycles, prior.deferred_cycles)
    || plan.carry_over_pending !== prior.carry_over_pending
    || !same(view.committed.map(row => ({ path: row.path, sha256: row.sha256 })), plan.changes.map(row => ({ path: row.path, sha256: row.after_sha256 }))))
    fail("STANDARD_FOCUS_CHECKPOINT_SOURCE_CHANGED");
  const committed = new Map(view.committed.map(row => [row.path, row]));
  return { source_sha256: shadowHash(source), focus_operation_id: input.focus_operation_id,
    session_id: plan.session_id, selected_cycle_id: plan.selected_cycle_id, selected_cycle_path: plan.selected_cycle_path,
    selected_state: plan.selected_state, selected_branch: plan.selected_branch, selected_branch_head: plan.selected_branch_head,
    phase_route: plan.phase_route, inventory_sha256: plan.inventory_sha256, backend_binding_sha256: plan.backend_binding_sha256,
    deferred_cycles: plan.deferred_cycles, carry_over_pending: plan.carry_over_pending,
    canonical: plan.documents.map(row => committed.get(row.path) ?? row) };
}
export function assertFocusCheckpointPlan(plan) {
  if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length
    || !Number.isSafeInteger(plan.prepared_at_ms) || Buffer.byteLength(JSON.stringify(plan)) > 1048576)
    fail("STANDARD_FOCUS_CHECKPOINT_PLAN_INVALID");
  assertFocusCheckpointInput(plan.input);
  const context = plan.context, view = plan.git.observed, physical = new Map(plan.physical_focus.map(row => [row.path, row.sha256])),
    allowed = focusPaths(context.session_id);
  if (context.focus_operation_id !== plan.input.focus_operation_id || context.source_sha256 !== plan.source_sha256
    || shadowHash(context) !== plan.context_sha256 || view.branch !== context.selected_branch || view.head !== context.selected_branch_head
    || view.ref !== "refs/heads/" + context.selected_branch || !view.index_clean || view.lock_present
    || !unique(context.canonical.map(row => row.path)) || !same(plan.physical_focus.map(row => row.path).sort(), allowed)
    || !unique(plan.git.files.map(row => row.path)) || !same(plan.git.files.map(row => row.path).sort(), view.changes.map(row => row.path).sort())
    || plan.git.files.some(row => !allowed.includes(row.path) || row.sha256 === null || row.sha256 !== physical.get(row.path))
    || plan.state_mode === "db-only" && plan.git.files.length !== 0)
    fail("STANDARD_FOCUS_CHECKPOINT_PLAN_INVALID");
  return plan;
}
export function assertFocusCheckpointOutput(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, outputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_FOCUS_CHECKPOINT_OUTPUT_INVALID");
  if (value.outcome === "completed") {
    const view = value.observations, created = view.git.status === "confirmed";
    if (value.effect_status !== (created ? "confirmed" : "no_effect") || value.facts.cycle_entry_focus_checkpoint_created !== created
      || created !== (view.committed_paths.length > 0) || !unique(view.committed_paths)
      || view.committed_paths.some(name => !focusPaths(view.session_id).includes(name))
      || view.selected_branch_head !== (created ? view.git.commit_sha : view.git.head))
      fail("STANDARD_FOCUS_CHECKPOINT_OUTPUT_INVALID");
  }
  return value;
}
