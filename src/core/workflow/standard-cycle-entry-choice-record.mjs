import { assertCycleEntryChoiceQuestion, assertHumanCycleEntryChoice } from "./standard-cycle-entry-choice.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import planSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-record-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-record-output.v1.schema.json" with { type: "json" };

export const cycleEntryChoiceRecordOperation = "cycle_entry_choice_record";
const active = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);
const fail = code => { throw Object.assign(Error(code), { code }); };
const exactSet = (a, b) => new Set(a).size === a.length && new Set(b).size === b.length
  && shadowHash([...a].sort()) === shadowHash([...b].sort());
const pin = row => ({ path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 });
const textOf = row => row.text_chunks.join("");

function field(text, key, value) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("^([ \\t]*-?[ \\t]*)" + escaped + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
  if ([...text.matchAll(pattern)].length !== 1) fail("STANDARD_CYCLE_CHOICE_RECORD_FIELD_INVALID");
  return text.replace(pattern, (_all, prefix) => `${prefix}${key}: ${value}`);
}
function section(text, title, body) {
  const pattern = new RegExp("(^## " + title + "[^\\r\\n]*\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))", "gm");
  if ([...text.matchAll(pattern)].length !== 1) fail("STANDARD_CYCLE_CHOICE_RECORD_SECTION_INVALID");
  return text.replace(pattern, (_all, heading) => heading + "\n" + body + "\n\n");
}
function append(text, operationId, material) {
  const heading = "## Process cycle choice " + operationId;
  if (text.split(/\r?\n/).includes(heading)) fail("STANDARD_CYCLE_CHOICE_RECORD_EXISTS");
  return text.trimEnd() + "\n\n" + heading + "\n\n```json\n" + JSON.stringify(material, null, 2) + "\n```\n";
}
function chunks(text) {
  const result = []; let current = "";
  for (const character of text) {
    if (current.length + character.length > 8192) { result.push(current); current = ""; }
    current += character;
  }
  result.push(current); return result;
}
const list = values => values.length ? "\n" + values.map(id => "  - " + id).join("\n") : "\n  - none";

// Pure canonical postimages. This records all reported-cycle dispositions and
// suspends focus; it never checks out a branch, imports product work, completes
// a cycle-close hook or grants implementation. Physical activation is separate.
export function renderStandardCycleEntryChoiceRecord({ question, decision, operationId, documents, preparedAt }) {
  assertCycleEntryChoiceQuestion(question); assertHumanCycleEntryChoice(decision, question);
  if (decision.choice !== "select_cycle" || !/^op_[a-f0-9]{40}$/.test(operationId ?? "")
    || !Number.isSafeInteger(preparedAt) || preparedAt < 0) fail("STANDARD_CYCLE_CHOICE_RECORD_SOURCE_INVALID");
  const subject = question.subject, selection = decision.selection, at = new Date(preparedAt).toISOString();
  if (!Array.isArray(documents) || new Set(documents.map(row => row.path)).size !== documents.length
    || documents.some(row => typeof row.content !== "string" || Buffer.byteLength(row.content) > 1048576
      || artifactContentHash(row.content) !== row.sha256)) fail("STANDARD_CYCLE_CHOICE_RECORD_DOCUMENTS_INVALID");
  const byName = new Map(documents.map(row => [row.path, row]));
  const required = name => byName.get(name) ?? fail("STANDARD_CYCLE_CHOICE_RECORD_DOCUMENT_REQUIRED");
  const current = required("CURRENT-STATE.md"), session = required(subject.session_path), snapshot = required("snapshots/context-snapshot.md");
  const currentFields = analyzeStructuredArtifact(current.content).key_values, metadata = parseSessionMetadata(session.content);
  if (currentFields.active_session !== subject.session_id || currentFields.mode !== "COMMITTING" || metadata.mode !== "COMMITTING"
    || analyzeStructuredArtifact(session.content).key_values.state !== "OPEN"
    || !exactSet(metadata.reported_from_previous_session, subject.reported_cycles)) fail("STANDARD_CYCLE_CHOICE_RECORD_SESSION_CHANGED");
  const selected = subject.candidate_cycles.find(row => row.cycle_id === selection.cycle_id);
  const selectedStatus = required(selected.path), selectedFields = analyzeStructuredArtifact(selectedStatus.content).key_values;
  if (selectedStatus.sha256 !== selected.sha256 || selectedStatus.metadata_sha256 !== selected.metadata_sha256
    || !active.has(selectedFields.state) || selectedFields.state !== selected.state
    || selectedFields.branch_name !== selected.branch_name || selectedFields.session_owner !== selected.session_owner)
    fail("STANDARD_CYCLE_CHOICE_RECORD_SELECTED_CYCLE_CHANGED");
  const common = { decision_operation_id: question.operation_id, decision_source_sha256: shadowHash(decision),
    choice_record_operation_id: operationId, selected_cycle_id: selected.cycle_id, branch_activation: "pending",
    implementation_authorized: false };
  let attached = [...metadata.attached_cycles], targets = [...metadata.integration_target_cycles];
  const reported = new Set(metadata.reported_from_previous_session), results = [], changes = [];
  const change = (row, after) => changes.push({ ...pin(row), before_sha256: row.sha256,
    before_metadata_sha256: row.metadata_sha256, text_chunks: chunks(after), after_sha256: artifactContentHash(after) });
  for (const disposition of selection.carryover_decisions) {
    const candidate = subject.candidate_cycles.find(row => row.cycle_id === disposition.cycle_id);
    const row = required(candidate.path), before = analyzeStructuredArtifact(row.content).key_values;
    if (row.sha256 !== candidate.sha256 || row.metadata_sha256 !== candidate.metadata_sha256 || !active.has(before.state)
      || before.state !== candidate.state || before.session_owner !== candidate.session_owner || before.branch_name !== candidate.branch_name)
      fail("STANDARD_CYCLE_CHOICE_RECORD_REPORTED_CYCLE_CHANGED");
    let after = row.content;
    const importing = ["import_now", "integrate_now"].includes(disposition.action);
    if (importing) {
      after = field(after, "session_owner", subject.session_id);
      after = field(after, "reported_to_session", subject.session_id);
      attached = [...new Set([...attached, candidate.cycle_id])]; targets = [...new Set([...targets, candidate.cycle_id])];
      reported.delete(candidate.cycle_id);
    } else if (disposition.action === "drop") {
      after = field(field(after, "state", disposition.outcome), "outcome", disposition.outcome);
      after = field(after, "reported_to_session", subject.session_id);
      attached = attached.filter(id => id !== candidate.cycle_id); targets = targets.filter(id => id !== candidate.cycle_id);
      reported.delete(candidate.cycle_id);
    } else if (disposition.action !== "defer") fail("STANDARD_CYCLE_CHOICE_RECORD_ACTION_INVALID");
    // Deferred canonical cycle bytes and metadata remain untouched. Their
    // explicit decision is retained in the current session and this plan.
    if (disposition.action !== "defer") {
      after = field(field(after, "updated_at", at), "last updated", at);
      after = append(after, operationId, { ...common, action: disposition.action, rationale: disposition.rationale,
        previous_session_owner: before.session_owner, session_owner: importing ? subject.session_id : before.session_owner,
        previous_state: before.state, state: disposition.action === "drop" ? disposition.outcome : before.state,
        cycle_close_completed: "NOT_CLAIMED", integration_completed: false });
      change(row, after);
    }
    results.push({ cycle_id: candidate.cycle_id, path: row.path, action: disposition.action, rationale: disposition.rationale,
      previous_session_owner: before.session_owner, session_owner: importing ? subject.session_id : before.session_owner,
      previous_state: before.state, state: disposition.action === "drop" ? disposition.outcome : before.state,
      outcome: disposition.outcome, integration_completed: false });
  }
  let sessionAfter = session.content;
  for (const [key, value] of Object.entries({ attached_cycles: list(attached), integration_target_cycles: list(targets),
    integration_target_cycle: targets.length === 1 ? targets[0] : "none", primary_focus_cycle: "none",
    reported_from_previous_session: list([...reported]), carry_over_pending: reported.size ? "yes" : "no", updated_at: at }))
    sessionAfter = field(sessionAfter, key, value);
  sessionAfter = append(sessionAfter, operationId, { ...common, decisions: results,
    deferred_cycles: [...reported], carry_over_pending: reported.size > 0 });
  change(session, sessionAfter);
  let snapshotAfter = snapshot.content;
  const activeText = /^## Active cycles[^\r\n]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(snapshotAfter)?.[1];
  if (activeText === undefined) fail("STANDARD_CYCLE_CHOICE_RECORD_SECTION_INVALID");
  const dropped = new Set(results.filter(row => row.action === "drop").map(row => row.cycle_id));
  const activeRows = activeText.split(/\r?\n/).filter(line => line.trim() && !/^-\s*\(?none\)?\s*$/i.test(line.trim())
    && !dropped.has(/^\s*-\s*(C\d+)(?=[: \t]|$)/.exec(line)?.[1]));
  snapshotAfter = section(snapshotAfter, "Active cycles", activeRows.join("\n") || "- none");
  snapshotAfter = section(snapshotAfter, "Next entry point", `- Session active: ${subject.session_id}\n- Active cycle: none\n- Next action: activate ${selected.cycle_id} on ${selected.branch_name}, then obtain fresh entry, phase and DoR admission.`);
  change(snapshot, append(snapshotAfter, operationId, { ...common, decisions: results }));
  let currentAfter = current.content;
  for (const [key, value] of Object.entries({ active_cycle: "none", dor_state: "unknown", updated_at: at,
    first_plan_step: `Activate selected cycle ${selected.cycle_id}; no implementation before branch and phase admission.` }))
    currentAfter = field(currentAfter, key, value);
  change(current, currentAfter);
  const selectedPostimage = changes.find(row => row.path === selected.path);
  return { selected_cycle_id: selected.cycle_id, selected_cycle_path: selected.path.slice(0, -"/status.md".length),
    selected_state: selected.state, selected_branch: selected.branch_name, selected_branch_head: selected.branch_head,
    selected_status_sha256: selectedPostimage?.after_sha256 ?? selected.sha256,
    deferred_cycles: [...reported], carry_over_pending: reported.size > 0, decisions: results,
    documents: documents.map(pin), changes: changes.map(({ sha256, metadata_sha256, ...row }) => row) };
}

export function assertStandardCycleEntryChoiceRecordPlan(plan) {
  if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(plan)) > 1048576) fail("STANDARD_CYCLE_CHOICE_RECORD_PLAN_INVALID");
  assertHumanCycleEntryChoice(plan.decision, plan.question);
  if (plan.question.operation_id !== plan.input.decision_operation_id || plan.decision.choice !== "select_cycle"
    || plan.decision_source_sha256 !== shadowHash(plan.decision)
    || new Set(plan.documents.map(row => row.path)).size !== plan.documents.length
    || new Set(plan.changes.map(row => row.path)).size !== plan.changes.length
    || plan.changes.some(row => !plan.documents.some(doc => doc.path === row.path && doc.sha256 === row.before_sha256
      && doc.metadata_sha256 === row.before_metadata_sha256) || artifactContentHash(textOf(row)) !== row.after_sha256)
    || !exactSet(plan.decisions.map(row => row.cycle_id), plan.question.subject.reported_cycles)
    || !exactSet(plan.deferred_cycles, plan.decisions.filter(row => row.action === "defer").map(row => row.cycle_id))
    || plan.carry_over_pending !== (plan.deferred_cycles.length > 0)
    || plan.selected_cycle_id !== plan.decision.selection.cycle_id || plan.selected_state !== plan.question.subject.candidate_cycles.find(row => row.cycle_id === plan.selected_cycle_id)?.state)
    fail("STANDARD_CYCLE_CHOICE_RECORD_PLAN_INVALID");
  return plan;
}

export function assertStandardCycleEntryChoiceRecordOutput(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, outputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_CYCLE_CHOICE_RECORD_OUTPUT_INVALID");
  if (value.outcome === "completed" && (value.effect_status !== "confirmed"
    || shadowHash(value.facts) !== shadowHash({ cycle_entry_choice_recorded: true, cycle_entry_resume_allowed: false })
    || value.observations.implementation_authorized !== false || value.observations.branch_activated !== false
    || new Set(value.observations.deferred_cycles).size !== value.observations.deferred_cycles.length
    || value.observations.carry_over_pending !== (value.observations.deferred_cycles.length > 0)
    || new Set(value.observations.committed.map(row => row.path)).size !== value.observations.committed.length)
    || value.outcome !== "completed" && Object.keys(value.facts).length)
    fail("STANDARD_CYCLE_CHOICE_RECORD_OUTPUT_INVALID");
  return value;
}
