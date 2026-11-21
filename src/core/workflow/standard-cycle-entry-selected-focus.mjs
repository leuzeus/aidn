import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { assertSelectedContextCheckpointPlan, assertSelectedContextCheckpointOutput } from "./standard-cycle-entry-selected-checkpoint.mjs";
import { cycleEntrySelectedSource } from "./standard-cycle-entry-selected-source.mjs";
import inputSchema from "../contracts/workflow-definition/standard-cycle-entry-selected-focus-input.v1.schema.json" with { type: "json" };
import planSchema from "../contracts/workflow-definition/standard-cycle-entry-selected-focus-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-cycle-entry-selected-focus-output.v1.schema.json" with { type: "json" };

export const cycleEntrySelectedFocusOperation = "cycle_entry_selected_focus";
const fail = code => { throw Object.assign(Error(code), { code }); };
const fields = row => analyzeStructuredArtifact(row.content).key_values;
const routes = { OPEN: "plan_adoption", IMPLEMENTING: "implementation_resume", VERIFYING: "verification_resume" };
const same = (a, b) => shadowHash(a) === shadowHash(b);
const pins = rows => rows.map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
const unique = rows => new Set(rows).size === rows.length;
export function assertSelectedFocusInput(input) {
  if (checkShadowJson(input) || validateJsonSchema(input, inputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_SELECTED_FOCUS_INPUT_INVALID");
  return input;
}
// Data descriptor only. The host authenticates accepted journals and the original
// H capture. A completed checkpoint supplies no new canonical-write permission.
export function selectedFocusSource(source, input) {
  assertSelectedFocusInput(input);
  if (checkShadowJson(source) || !source || Object.keys(source).sort().join(",") !== "activation,checkpoint_operation_id,checkpoint_sha256,output,plan"
    || source.checkpoint_operation_id !== input.checkpoint_operation_id || !/^[a-f0-9]{64}$/.test(source.checkpoint_sha256 ?? ""))
    fail("STANDARD_SELECTED_FOCUS_SOURCE_REQUIRED");
  const plan = assertSelectedContextCheckpointPlan(source.plan), output = assertSelectedContextCheckpointOutput(source.output);
  if (plan.operation_id !== input.checkpoint_operation_id || output.outcome !== "completed")
    fail("STANDARD_SELECTED_FOCUS_ACCEPTED_CHECKPOINT_REQUIRED");
  const activation = cycleEntrySelectedSource(source.activation, plan.input), view = output.observations, context = plan.context;
  if (plan.source_sha256 !== shadowHash(source.activation) || context.source_sha256 !== activation.source_sha256
    || view.source_sha256 !== plan.source_sha256 || view.context_sha256 !== plan.context_sha256
    || view.activation_operation_id !== plan.input.activation_operation_id
    || !same(view.committed_paths, plan.git.files.map(row => row.path))
    || ["cycle_id", "cycle_path", "state", "branch"].some(key => context.selected_cycle[key] !== view["selected_" + key])
    || view.session_id !== context.session_id
    || (plan.git.files.length ? view.git.status !== "confirmed" || view.git.parent_sha !== plan.git.observed.head
      : view.git.status !== "no_change" || view.git.head !== plan.git.observed.head))
    fail("STANDARD_SELECTED_FOCUS_SOURCE_CHANGED");
  return { source_sha256: shadowHash(source), checkpoint_operation_id: input.checkpoint_operation_id,
    session_id: context.session_id, selected_cycle_id: context.selected_cycle.cycle_id, selected_cycle_path: context.selected_cycle.cycle_path,
    selected_state: context.selected_cycle.state, selected_branch: context.selected_cycle.branch, selected_branch_head: view.selected_branch_head,
    canonical: context.canonical, inventory_sha256: context.inventory_sha256, backend_binding_sha256: context.backend_binding_sha256,
    deferred_cycles: context.deferred_cycles, carry_over_pending: context.carry_over_pending };
}
function field(text, key, value) {
  // All keys are fixed below, never supplied by a request.
  const pattern = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
  if ([...text.matchAll(pattern)].length !== 1) fail("STANDARD_SELECTED_FOCUS_FIELD_INVALID");
  return text.replace(pattern, (_all, prefix) => prefix + key + ": " + value);
}
function section(text, title, body) {
  const pattern = new RegExp("(^## " + title + "[^\\r\\n]*\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))", "gm");
  if ([...text.matchAll(pattern)].length !== 1) fail("STANDARD_SELECTED_FOCUS_SECTION_INVALID");
  return text.replace(pattern, (_all, heading) => heading + "\n" + body + "\n\n");
}
function chunks(text) {
  const rows = []; let part = "";
  for (const character of text) { if (part.length + character.length > 8192) { rows.push(part); part = ""; } part += character; }
  rows.push(part); return rows;
}
// Restore focus and retain the canonical phase as data. The next phase route
// must obtain its current admission; no task marks, status or DoR is rewritten.
export function renderSelectedFocus({ descriptor, documents, operationId, preparedAt }) {
  if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "") || !Number.isSafeInteger(preparedAt) || preparedAt < 0
    || !unique(documents.map(row => row.path)) || documents.some(row => typeof row.content !== "string" || artifactContentHash(row.content) !== row.sha256))
    fail("STANDARD_SELECTED_FOCUS_MATERIAL_INVALID");
  const byName = new Map(documents.map(row => [row.path, row])), required = name => byName.get(name) ?? fail("STANDARD_SELECTED_FOCUS_DOCUMENT_REQUIRED"),
    session = required("sessions/" + descriptor.session_id + ".md"), current = required("CURRENT-STATE.md"), snapshot = required("snapshots/context-snapshot.md"),
    status = fields(required(descriptor.selected_cycle_path + "/status.md")), state = fields(current), metadata = parseSessionMetadata(session.content),
    route = routes[status.state], at = new Date(preparedAt).toISOString();
  if (state.active_session !== descriptor.session_id || state.active_cycle !== "none" || state.mode !== "COMMITTING"
    || fields(session).state !== "OPEN" || metadata.mode !== "COMMITTING" || metadata.primary_focus_cycle !== null
    || !metadata.attached_cycles.includes(descriptor.selected_cycle_id) || !metadata.integration_target_cycles.includes(descriptor.selected_cycle_id)
    || status.state !== descriptor.selected_state || status.session_owner !== descriptor.session_id || status.branch_name !== descriptor.selected_branch
    || !route || !["true", "false"].includes(status.scope_frozen) || !status.dor_state)
    fail("STANDARD_SELECTED_FOCUS_CONTEXT_CHANGED");
  const marker = "## Process selected focus " + operationId, fence = String.fromCharCode(96).repeat(3);
  const note = { checkpoint_operation_id: descriptor.checkpoint_operation_id, source_sha256: descriptor.source_sha256,
    selected_cycle_id: descriptor.selected_cycle_id, selected_state: status.state, phase_route: route,
    phase_admission: false, progress_adoption: false, implementation_authorized: false };
  const append = text => { if (text.split(/\r?\n/).includes(marker)) fail("STANDARD_SELECTED_FOCUS_EXISTS");
    return text.trimEnd() + "\n\n" + marker + "\n\n" + fence + "json\n" + JSON.stringify(note, null, 2) + "\n" + fence + "\n"; };
  let sessionAfter = session.content;
  for (const [key, value] of Object.entries({ primary_focus_cycle: descriptor.selected_cycle_id, cycle_branch: descriptor.selected_branch, updated_at: at }))
    sessionAfter = field(sessionAfter, key, value);
  const next = "- Session active: " + descriptor.session_id + "\n- Active cycle: " + descriptor.selected_cycle_id
    + "\n- Next action: " + route + "; obtain current phase and DoR admission before work.";
  let currentAfter = current.content;
  for (const [key, value] of Object.entries({ active_cycle: descriptor.selected_cycle_id, cycle_branch: descriptor.selected_branch, branch_kind: "cycle",
    dor_state: status.dor_state, first_plan_step: route + " for " + descriptor.selected_cycle_id + "; current admission required before work.", updated_at: at }))
    currentAfter = field(currentAfter, key, value);
  const changes = [[session, append(sessionAfter)], [snapshot, append(section(snapshot.content, "Next entry point", next))], [current, currentAfter]]
    .map(([row, after]) => ({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: row.metadata_sha256,
      text_chunks: chunks(after), after_sha256: artifactContentHash(after) }));
  return { phase_route: route, dor_state: status.dor_state, scope_frozen: status.scope_frozen, documents: pins(documents), changes };
}
export function assertSelectedFocusPlan(plan) {
  if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length
    || !Number.isSafeInteger(plan.prepared_at_ms) || Buffer.byteLength(JSON.stringify(plan)) > 1048576)
    fail("STANDARD_SELECTED_FOCUS_PLAN_INVALID");
  assertSelectedFocusInput(plan.input);
  const expected = ["sessions/" + plan.session_id + ".md", "snapshots/context-snapshot.md", "CURRENT-STATE.md"].sort();
  if (routes[plan.selected_state] !== plan.phase_route || !same(plan.changes.map(row => row.path).sort(), expected)
    || !unique(plan.documents.map(row => row.path)) || plan.changes.some(row => !plan.documents.some(doc => doc.path === row.path
      && doc.sha256 === row.before_sha256 && doc.metadata_sha256 === row.before_metadata_sha256) || artifactContentHash(row.text_chunks.join("")) !== row.after_sha256)
    || plan.git_observed.branch !== plan.selected_branch || plan.git_observed.head !== plan.selected_branch_head
    || plan.git_observed.changes.length || !plan.git_observed.index_clean || plan.git_observed.lock_present)
    fail("STANDARD_SELECTED_FOCUS_PLAN_INVALID");
  return plan;
}
export function assertSelectedFocusOutput(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, outputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_SELECTED_FOCUS_OUTPUT_INVALID");
  if (value.outcome === "completed" && (routes[value.observations.selected_state] !== value.observations.phase_route
    || !same(value.observations.committed.map(row => row.path).sort(),
      ["sessions/" + value.observations.session_id + ".md", "snapshots/context-snapshot.md", "CURRENT-STATE.md"].sort())))
    fail("STANDARD_SELECTED_FOCUS_OUTPUT_INVALID");
  return value;
}
