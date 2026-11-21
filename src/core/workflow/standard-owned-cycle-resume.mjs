import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { assertCanonicalResumeOutput } from "./standard-canonical-cycle-resume.mjs";
import inputSchema from "../contracts/workflow-definition/standard-owned-cycle-resume-input.v1.schema.json" with { type: "json" };
import entryInputSchema from "../contracts/workflow-definition/standard-cycle-entry-input.v1.schema.json" with { type: "json" };
import entryOutputSchema from "../contracts/workflow-definition/standard-cycle-entry-output.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
const digest = value => /^[a-f0-9]{64}$/.test(value ?? "");
const operationId = value => /^op_[a-f0-9]{40}$/.test(value ?? "");
const active = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);
const valid = (value, schema, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(value)) > 1048576) fail(code);
  return value;
};

export const assertOwnedCanonicalResumeInput = value => valid(value, inputSchema, "STANDARD_OWNED_RESUME_INPUT_INVALID");
export function assertOwnedCanonicalResumeOutput(value) {
  if (value?.contract_version !== "standard-owned-cycle-resume-output.v1") fail("STANDARD_OWNED_RESUME_OUTPUT_INVALID");
  return assertCanonicalResumeOutput(value);
}

// These existing canonical sections are DATA, not an authenticated H capture.
// They may narrow work intent; they cannot provide a grant or a work receipt.
export function ownedCanonicalResumeIntent(status, { session_id, cycle_id }) {
  if (typeof status !== "string" || Buffer.byteLength(status) > 1048576
    || !/^S[0-9]{3,6}$/.test(session_id ?? "") || !/^C[0-9]{3,6}$/.test(cycle_id ?? "")) fail("STANDARD_OWNED_RESUME_INTENT_INVALID");
  const headers = [...status.matchAll(/^## Process cycle choice ([^\r\n]*)\r?$/gm)], records = [], seen = new Set();
  const keys = ["decision_operation_id", "decision_source_sha256", "choice_record_operation_id", "selected_cycle_id",
    "branch_activation", "implementation_authorized", "action", "rationale", "previous_session_owner", "session_owner",
    "previous_state", "state", "cycle_close_completed", "integration_completed"].sort();
  for (const header of headers) {
    if (!operationId(header[1]) || seen.has(header[1])) fail("STANDARD_OWNED_RESUME_INTENT_INVALID");
    seen.add(header[1]);
    const remaining = status.slice(header.index + header[0].length), next = /^## /m.exec(remaining),
      section = remaining.slice(0, next?.index ?? remaining.length).trim(), json = /^```json\r?\n([\s\S]*)\r?\n```$/u.exec(section);
    let row;
    try { row = json && JSON.parse(json[1]); } catch { fail("STANDARD_OWNED_RESUME_INTENT_INVALID"); }
    if (!row || checkShadowJson(row) || shadowHash(Object.keys(row).sort()) !== shadowHash(keys)
      || row.choice_record_operation_id !== header[1] || !operationId(row.decision_operation_id) || !digest(row.decision_source_sha256)
      || !/^C[0-9]{3,6}$/.test(row.selected_cycle_id ?? "") || row.branch_activation !== "pending"
      || row.implementation_authorized !== false || row.cycle_close_completed !== "NOT_CLAIMED" || row.integration_completed !== false
      || !["import_now", "integrate_now", "drop"].includes(row.action) || typeof row.rationale !== "string" || !row.rationale.trim()
      || typeof row.previous_session_owner !== "string" || !row.previous_session_owner || typeof row.session_owner !== "string" || !row.session_owner
      || !active.has(row.previous_state) || typeof row.state !== "string"
      || row.action !== "drop" && row.state !== row.previous_state) fail("STANDARD_OWNED_RESUME_INTENT_INVALID");
    // selected_cycle_id is the focus of the whole choice. This status can belong
    // to another reported cycle imported by that same canonical transaction.
    if (row.session_owner === session_id) records.push(row);
  }
  const latest = records.at(-1);
  if (latest?.action === "drop") fail("STANDARD_OWNED_RESUME_INTENT_REQUIRED");
  const action = latest?.action ?? "current_owned";
  return { continuity_action: action, work_intent: action === "integrate_now" ? "integration_only" : "continue_implementation" };
}

// The owning host authenticates the accepted entry journal. The final argument
// is a private fresh observation, never a caller-authored source or observer.
export function ownedCanonicalResumeEntry(source, input) {
  assertOwnedCanonicalResumeInput(input);
  if (!source || checkShadowJson(source) || source.entry_operation_id !== input.entry_operation_id
    || !digest(source.entry_sha256)) fail("STANDARD_OWNED_RESUME_ENTRY_REQUIRED");
  const entry = valid(source.input, entryInputSchema, "STANDARD_OWNED_RESUME_ENTRY_REQUIRED"),
    output = valid(source.output, entryOutputSchema, "STANDARD_OWNED_RESUME_ENTRY_REQUIRED"), observed = output.observations, selected = observed.selected_cycle;
  if (output.outcome !== "completed" || output.effect_status !== "no_effect" || output.facts.cycle_entry_resume_allowed !== true
    || output.facts.cycle_entry_creation_allowed !== false || output.facts.cycle_entry_choice_required !== false
    || observed.action !== "resume_cycle" || observed.reason_code !== null || observed.implementation_authorized !== false || !selected
    || entry.cycle_id !== null && entry.cycle_id !== selected.cycle_id
    || !selected.cycle_path.startsWith("cycles/" + selected.cycle_id + "-")) fail("STANDARD_OWNED_RESUME_ENTRY_REQUIRED");
  return { entry, output, observed, selected };
}

export function ownedCanonicalResumeSource(source, input, current) {
  const { entry, output, observed, selected } = ownedCanonicalResumeEntry(source, input);
  if (!current || checkShadowJson(current) || !current.scope || !current.git || !current.backend
    || observed.scope_sha256 !== shadowHash(current.scope) || current.scope.branch !== selected.branch
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(current.scope.head ?? "") || current.git.branch !== selected.branch || current.git.head !== current.scope.head
    || current.git.diff_scope !== "configured-product-files-only" || typeof current.git.diff !== "string"
    || current.git.diff_sha256 !== artifactContentHash(current.git.diff) || !digest(current.git.global_diff_sha256)
    || !digest(current.git.status_sha256) || !Number.isSafeInteger(current.git.other_changes?.count) || current.git.other_changes.count < 0
    || !digest(current.git.other_changes.sha256)) fail("STANDARD_OWNED_RESUME_CONTEXT_CHANGED");
  const canonical = observed.canonical, names = canonical.map(row => row.path), focus = ["docs/audit/CURRENT-STATE.md",
    "docs/audit/sessions/" + entry.session_id + ".md", "docs/audit/snapshots/context-snapshot.md"].sort(),
    // Entry attests CURRENT-STATE, its session and the five cycle documents.
    // The snapshot belongs only to the independent fresh physical observation.
    required = ["CURRENT-STATE.md", "sessions/" + entry.session_id + ".md",
      ...["status", "brief", "plan", "audit-spec", "traceability"].map(name => selected.cycle_path + "/" + name + ".md")];
  if (new Set(names).size !== names.length || required.some(name => !names.includes(name))
    || shadowHash(output.evidence_refs) !== shadowHash(canonical.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.sha256 })))
    || !Array.isArray(current.physical_focus) || shadowHash(current.physical_focus.map(row => row.path).sort()) !== shadowHash(focus)
    || current.physical_focus.some(row => row.sha256 !== null && !digest(row.sha256))) fail("STANDARD_OWNED_RESUME_CONTEXT_CHANGED");
  const status = canonical.find(row => row.path === selected.cycle_path + "/status.md");
  if (typeof current.status_content !== "string" || artifactContentHash(current.status_content) !== status.sha256) fail("STANDARD_OWNED_RESUME_CONTEXT_CHANGED");
  const fields = analyzeStructuredArtifact(current.status_content).key_values;
  if (fields.session_owner !== entry.session_id || fields.state !== selected.state || fields.branch_name !== selected.branch)
    fail("STANDARD_OWNED_RESUME_CONTEXT_CHANGED");
  const { head, ...scopeWithoutHead } = current.scope;
  return { ...ownedCanonicalResumeIntent(current.status_content, { session_id: entry.session_id, cycle_id: selected.cycle_id }),
    source_sha256: shadowHash(source), entry_operation_id: source.entry_operation_id, entry_sha256: source.entry_sha256,
    session_id: entry.session_id, cycle_id: selected.cycle_id, cycle_path: selected.cycle_path, phase: selected.state, branch: selected.branch, head,
    canonical, inventory_sha256: observed.inventory_sha256, backend_binding_sha256: shadowHash(current.backend),
    scope_without_head_sha256: shadowHash(scopeWithoutHead), git_sha256: shadowHash(current.git),
    physical_focus: structuredClone(current.physical_focus), checkpoint_created: false };
}
