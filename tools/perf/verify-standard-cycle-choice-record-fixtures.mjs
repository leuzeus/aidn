#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { cycleEntryChoiceQuestion } from "../../src/core/workflow/standard-cycle-entry-choice.mjs";
import { renderStandardCycleEntryChoiceRecord, assertStandardCycleEntryChoiceRecordPlan,
  assertStandardCycleEntryChoiceRecordOutput } from "../../src/core/workflow/standard-cycle-entry-choice-record.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { analyzeStructuredArtifact } from "../../src/lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";

const H = "a".repeat(64), J = "b".repeat(40), op = value => "op_" + value.repeat(40);
let checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };
const fields = text => analyzeStructuredArtifact(text).key_values;
const makeDocument = (path, content) => ({ path, content, sha256: artifactContentHash(content), metadata_sha256: null });
const pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });

function renderFixture() {
  const reported = ["C001", "C003", "C004", "C005", "C006"];
  const statuses = ["C001", "C002", "C003", "C004", "C005", "C006"].map(id => {
    const state = id === "C001" ? "VERIFYING" : id === "C002" ? "IMPLEMENTING" : "OPEN", owner = id === "C002" ? "S002" : "S001";
    return makeDocument(`cycles/${id}-feature-choice/status.md`, `# ${id}\ncontract_version: critical-markdown-v1\ncycle_id: ${id}\nowner: fixture\nsource_of_truth: cycle_state\nlifecycle_status: active\nstate: ${state}\noutcome: ACTIVE\nsession_owner: ${owner}\nbranch_name: feature/${id}-choice\nreported_to_session: S002\ndor_state: READY\nscope_frozen: true\naccepted_work_marker: keep-original-${id}\nupdated_at: 2026-01-01T00:00:00.000Z\nlast updated: 2026-01-01T00:00:00.000Z\n`);
  });
  const current = makeDocument("CURRENT-STATE.md", "# Current\nactive_session: S002\nactive_cycle: C002\nmode: COMMITTING\ncycle_branch: feature/C002-choice\ndor_state: READY\nfirst_plan_step: keep old work\nupdated_at: 2026-01-01T00:00:00.000Z\n");
  const session = makeDocument("sessions/S002.md", `# Session\nsession_id: S002\nstate: OPEN\nmode: COMMITTING\n[x] COMMITTING\nsession_branch: S002-choice\ncycle_branch: feature/C002-choice\nprimary_focus_cycle: C002\nintegration_target_cycles:\n  - C002\nintegration_target_cycle: C002\nattached_cycles:\n  - C002\nreported_from_previous_session:\n${reported.map(id => "  - " + id).join("\n")}\ncarry_over_pending: yes\nupdated_at: 2026-01-01T00:00:00.000Z\n`);
  const snapshot = makeDocument("snapshots/context-snapshot.md", "# Snapshot\n\n## Active cycles\n\n" + statuses.map(row => "- " + fields(row.content).cycle_id + ": open fixture work").join("\n") + "\n\n## Next entry point\n\n- Continue old work\n");
  const selectedFiles = ["brief", "plan", "audit-spec", "traceability"].map(name => makeDocument(`cycles/C001-feature-choice/${name}.md`, `# ${name}\n\nRetained accepted work and validation provenance; no new acceptance is inferred.\n`));
  const documents = [current, session, snapshot, ...statuses, ...selectedFiles];
  const subject = { contract_version: "standard-cycle-entry-choice-subject.v1", entry_operation_id: op("1"), entry_output_sha256: H,
    session_id: "S002", session_path: session.path, scope_sha256: H, inventory_sha256: H,
    current_cycle_id: "C002", current_branch: "feature/C002-choice", head: J,
    reason_code: "STANDARD_CYCLE_ENTRY_CARRYOVER_DECISION_REQUIRED", canonical: [current, session].map(pin),
    candidate_cycles: statuses.map(row => { const data = fields(row.content); return { cycle_id: data.cycle_id, ...pin(row), state: data.state,
      session_owner: data.session_owner, branch_name: data.branch_name, branch_head: J, dor_state: "READY", scope_frozen: "true" }; }),
    reported_cycles: reported, missing_reported_cycles: [], carry_over_pending: true };
  const question = cycleEntryChoiceQuestion({ operation_id: op("2"), intent: { fixture: "canonical-choice-render" }, preview: { prepared: { subject } } });
  const selection = { cycle_id: "C001", carryover_decisions: [
    { cycle_id: "C001", action: "import_now", outcome: null, rationale: "Import the selected verifying cycle and preserve its work." },
    { cycle_id: "C003", action: "defer", outcome: null, rationale: "Leave this reported cycle with its original owner." },
    { cycle_id: "C004", action: "drop", outcome: "NO_GO", rationale: "Explicit non-retained outcome with original evidence kept." },
    { cycle_id: "C005", action: "drop", outcome: "DROPPED", rationale: "Explicit cancellation with original evidence kept." },
    { cycle_id: "C006", action: "integrate_now", outcome: null, rationale: "Attach now and integrate only when ready." },
  ] };
  const decision = { contract_version: "human-cycle-entry-choice.v1", source_kind: "human", authority_id: "fixture_operator",
    source_event_id: "fixture-current-carryover", subject_sha256: shadowHash(subject), question_sha256: shadowHash(question),
    choice: "select_cycle", selection, rationale: "Explicit controlled per-cycle decisions", evidence_refs: [{ ref: "fixture:carryover", sha256: H }] };
  return { question, decision, operationId: op("3"), documents, preparedAt: 1794528000000 };
}

function coreContracts() {
  for (const name of ["standard-cycle-entry-choice-record-input.v1", "standard-cycle-entry-choice-record-plan.v1", "standard-cycle-entry-choice-record-output.v1"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/" + name + ".schema.json", import.meta.url), "utf8"));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const fixture = renderFixture(), before = shadowHash(fixture.documents), rendered = renderStandardCycleEntryChoiceRecord(fixture);
  const plan = { contract_version: "standard-cycle-entry-choice-record-plan.v1", operation_ref: "cycle_entry_choice_record",
    operation_id: fixture.operationId, input: { contract_version: "standard-cycle-entry-choice-record-input.v1", decision_operation_id: fixture.question.operation_id },
    prepared_at_ms: fixture.preparedAt, scope_sha256: H, backend_binding_sha256: H, unchanged_cycle_inventory_sha256: H,
    question: fixture.question, decision: fixture.decision, decision_source_sha256: shadowHash(fixture.decision), ...rendered };
  assertStandardCycleEntryChoiceRecordPlan(plan);
  assert.equal(Object.hasOwn(plan, "expires_at_ms"), false);
  assert.equal(shadowHash(fixture.documents), before);
  assert.throws(() => assertStandardCycleEntryChoiceRecordPlan({ ...plan, approved: true }));
  pass("closed record contracts render canonical postimages without mutation or an age ceiling");

  const after = new Map(rendered.changes.map(row => [row.path, row.text_chunks.join("")]));
  const selected = fields(after.get("cycles/C001-feature-choice/status.md"));
  assert.equal(selected.state, "VERIFYING"); assert.equal(selected.session_owner, "S002");
  assert.equal(selected.dor_state, "READY"); assert.equal(selected.scope_frozen, "true");
  assert.equal(selected.accepted_work_marker, "keep-original-C001");
  for (const name of ["brief", "plan", "audit-spec", "traceability"]) assert.equal(after.has(`cycles/C001-feature-choice/${name}.md`), false);
  assert.match(after.get("cycles/C001-feature-choice/status.md"), /"previous_session_owner": "S001"/);
  assert.equal(fields(after.get("cycles/C006-feature-choice/status.md")).state, "OPEN");
  assert.equal(fields(after.get("cycles/C006-feature-choice/status.md")).session_owner, "S002");
  assert.equal(rendered.decisions.find(row => row.cycle_id === "C006").integration_completed, false);
  pass("import preserves VERIFYING work and DoR; integrate-now attaches without claiming a Git integration");

  assert.equal(after.has("cycles/C003-feature-choice/status.md"), false);
  const session = parseSessionMetadata(after.get("sessions/S002.md"));
  assert.deepEqual(session.reported_from_previous_session, ["C003"]); assert.equal(session.carry_over_pending, "yes");
  assert.deepEqual([...session.attached_cycles].sort(), ["C001", "C002", "C006"]);
  assert.equal(fields(after.get("cycles/C004-feature-choice/status.md")).state, "NO_GO");
  assert.equal(fields(after.get("cycles/C005-feature-choice/status.md")).state, "DROPPED");
  for (const id of ["C004", "C005"]) assert.equal(fields(after.get(`cycles/${id}-feature-choice/status.md`)).session_owner, "S001");
  assert.match(after.get("snapshots/context-snapshot.md"), /C003: open fixture work/);
  assert.doesNotMatch(after.get("snapshots/context-snapshot.md").split("## Next entry point")[0], /C00[45]: open fixture work/);
  assert.equal(fields(after.get("CURRENT-STATE.md")).active_cycle, "none");
  assert.equal(session.primary_focus_cycle, null);
  assert.match(after.get("snapshots/context-snapshot.md"), /activate C001 on feature\/C001-choice/);
  pass("defer keeps reported bytes and pending state; explicit drops retain original owners while focus awaits activation");

  const missing = structuredClone(fixture); missing.decision.selection.carryover_decisions.pop();
  assert.throws(() => renderStandardCycleEntryChoiceRecord(missing));
  const stale = structuredClone(fixture); stale.documents.find(row => row.path.startsWith("cycles/C001") && row.path.endsWith("status.md")).content += "changed";
  assert.throws(() => renderStandardCycleEntryChoiceRecord(stale));
  const edited = structuredClone(plan); edited.changes[0].text_chunks[0] += "changed";
  assert.throws(() => assertStandardCycleEntryChoiceRecordPlan(edited));
  assert.throws(() => assertStandardCycleEntryChoiceRecordPlan({ ...plan, selected_state: "OPEN" }));
  pass("incomplete decisions, stale canonical bytes and forged phase/postimages are refused");

  const output = { contract_version: "standard-cycle-entry-choice-record-output.v1", operation_ref: "cycle_entry_choice_record",
    outcome: "completed", effect_status: "confirmed", facts: { cycle_entry_choice_recorded: true, cycle_entry_resume_allowed: false },
    observations: { decision_operation_id: plan.input.decision_operation_id, decision_source_sha256: plan.decision_source_sha256,
      selected_cycle_id: plan.selected_cycle_id, selected_cycle_path: plan.selected_cycle_path, selected_state: plan.selected_state,
      selected_branch: plan.selected_branch, selected_branch_head: plan.selected_branch_head, selected_status_sha256: plan.selected_status_sha256,
      deferred_cycles: plan.deferred_cycles, carry_over_pending: true, branch_activated: false, implementation_authorized: false,
      committed: plan.changes.map(row => ({ path: row.path, sha256: row.after_sha256, metadata_sha256: null })) }, evidence_refs: [] };
  assertStandardCycleEntryChoiceRecordOutput(output);
  assert.throws(() => assertStandardCycleEntryChoiceRecordOutput({ ...output, observations: { ...output.observations, implementation_authorized: true } }));
  assert.throws(() => assertStandardCycleEntryChoiceRecordOutput({ ...output, facts: { ...output.facts, cycle_entry_resume_allowed: true } }));
  assertStandardCycleEntryChoiceRecordOutput({ ...output, outcome: "reconciliation_required", effect_status: "unknown", facts: {}, observations: { reason_code: "FIXTURE_PARTIAL_EFFECT" } });
  assert.throws(() => assertStandardCycleEntryChoiceRecordOutput({ ...output, outcome: "reconciliation_required", effect_status: "unknown" }));
  pass("recorded canonical decisions and UNKNOWN results never grant branch activation or implementation");
}

if (["--accept-record", "--inspect-record"].includes(process.argv[2])) {
  const { acceptRecordedChoice } = await import("./standard-cycle-choice-record-fixture-lib.mjs");
  const [, , , root, keyFile, sourcesFile, operationId, clock] = process.argv;
  console.log(JSON.stringify(await acceptRecordedChoice({ root, keyFile, sourcesFile, operationId, clock: Number(clock), inspectOnly: process.argv[2] === "--inspect-record" })));
} else {
  const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7);
  if (!process.argv.includes("--contracts-only") && !["files", "dual", "db-only"].includes(mode)) throw Error("CHOICE_RECORD_FIXTURE_SCOPE_REQUIRED");
  if (mode && process.argv.includes("--contracts-only")) throw Error("CHOICE_RECORD_FIXTURE_SCOPE_CONFLICT");
  const faultAfterFirstCas = process.argv.includes("--fault-after-first-cas");
  if (faultAfterFirstCas && mode !== "files") throw Error("CHOICE_RECORD_PARTIAL_EFFECT_FILES_REQUIRED");
  coreContracts();
  if (mode) {
    const { verifyCanonicalCycleChoiceRecord } = await import("./standard-cycle-choice-record-fixture-lib.mjs");
    await verifyCanonicalCycleChoiceRecord(mode, { childScript: fileURLToPath(import.meta.url), pass, faultAfterFirstCas });
  }
  console.log(JSON.stringify({ status: "PASS", checks, scope: mode ? "canonical-record-port-with-controlled-human" : "pure-closed-contracts-and-canonical-rendering", native_calls: 0,
    canonical_writes: mode ? "SCOPED_COMPONENT" : "NOT_EXECUTED", branch_activation: "NOT_EXECUTED", installed_archive: "NOT_RUN", full_standard: false }));
}
