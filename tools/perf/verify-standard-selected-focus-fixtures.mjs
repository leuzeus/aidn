import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { assertSelectedFocusOutput, selectedFocusSource } from "../../src/core/workflow/standard-cycle-entry-selected-focus.mjs";
import { createStandardCycleEntrySelectedFocus } from "../../src/application/runtime/standard-cycle-entry-selected-focus.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { analyzeStructuredArtifact } from "../../src/lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { activationCase } from "./verify-standard-cycle-choice-activation-fixtures.mjs";
import { selectedCase } from "./verify-standard-selected-context-checkpoint-fixtures.mjs";
import { verifyCanonicalCycleChoiceRecord, openCycleChoiceFixtureHost, acceptRecordedChoice } from "./standard-cycle-choice-record-fixture-lib.mjs";

const script = fileURLToPath(import.meta.url), fields = row => analyzeStructuredArtifact(row.content).key_values;
let checks = 0;
const pass = text => { checks++; console.log("PASS " + text); };
function contracts() {
  for (const name of ["input", "plan", "output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-cycle-entry-selected-focus-" + name + ".v1.schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const input = { contract_version: "standard-cycle-entry-selected-focus-input.v1", checkpoint_operation_id: "op_" + "a".repeat(40) };
  assertStandardOperationInput("cycle_entry_selected_focus", input);
  for (const extra of [{ approved: true }, { paths: ["CURRENT-STATE.md"] }, { phase: "VERIFYING" }, { cycle_id: "C001" }])
    assert.throws(() => assertStandardOperationInput("cycle_entry_selected_focus", { ...input, ...extra }));
  pass("focus contracts accept only a checkpoint identity, never phase, paths or permission");
}
async function focusCase(f, { fault, selectCurrent }) {
  const { root, mode, keyFile, sourcesFile, clock, artifacts, operations, git, heads, canonical, selectedCheckpointId, selectedCheckpointSource } = f;
  let host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  // Fixture-only perturbations precede the current focus preparation.
  const initial = host.inspect("choice-record"), input = { contract_version: "standard-cycle-entry-selected-focus-input.v1", checkpoint_operation_id: selectedCheckpointId },
    foreign = path.join(root, "fixture-foreign-focus-work.txt"), canonicalInitial = canonical();
  const dirtyBoundary = createStandardCycleEntrySelectedFocus({ targetRoot: root, scope: operations.observeScope,
    readCurrent: () => host.inspect("choice-record").record, readCheckpoint: async () => selectedCheckpointSource });
  fs.writeFileSync(foreign, "Foreign work must keep focus preparation blocked.\n", { flag: "wx" });
  let foreignBlocked = false;
  try { const dirty = await dirtyBoundary.prepare(initial.record, input, "op_" + "e".repeat(40)); foreignBlocked = dirty.can_apply === false; }
  catch (error) { if (error.code !== "STANDARD_SELECTED_FOCUS_CLEAN_CONTEXT_REQUIRED") throw error; foreignBlocked = true; }
  finally { fs.unlinkSync(foreign); }
  assert.equal(foreignBlocked, true); assert.deepEqual(canonical(), canonicalInitial); assert.equal(artifacts.ownerPending(), false);
  assert.equal(git("status", "--porcelain"), "");
  const noChangeSource = selectedCheckpointSource.output.observations.git.status === "no_change";
  if (noChangeSource) {
    const oldIndex = path.resolve(root, git("rev-parse", "--git-path", "index")), beforeBytes = fs.readFileSync(oldIndex), version = beforeBytes.readUInt32BE(4);
    git("update-index", "--index-version=" + (version === 4 ? 2 : 4));
    assert.notEqual(artifactContentHash(fs.readFileSync(oldIndex)), artifactContentHash(beforeBytes));
    assert.equal(git("diff", "--cached", "--name-only"), ""); assert.equal(git("status", "--porcelain"), "");
    if (artifactContentHash(fs.readFileSync(oldIndex)) === selectedCheckpointSource.plan.git.observed.index_sha256)
      git("update-index", "--index-version=" + (version === 4 ? 4 : 2));
    assert.notEqual(artifactContentHash(fs.readFileSync(oldIndex)), selectedCheckpointSource.plan.git.observed.index_sha256);
  }
  pass(mode + ": foreign product work refuses focus before effect ownership");
  if (noChangeSource) console.log(JSON.stringify({ arranged_focus_index_refresh: true, historical_index_sha256: selectedCheckpointSource.plan.git.observed.index_sha256,
    current_index_sha256: artifactContentHash(fs.readFileSync(path.resolve(root, git("rev-parse", "--git-path", "index")))) , semantic_Git_clean: true }));
  const state = host.inspect("choice-record"), occurrenceId = state.cursor.ready[0], before = canonical(), beforeRefs = heads(),
    beforeHead = git("rev-parse", "HEAD"), beforeBranch = git("branch", "--show-current"),
    index = path.resolve(root, git("rev-parse", "--git-path", "index")), beforeIndex = artifactContentHash(fs.readFileSync(index)),
    product = git("ls-tree", "-r", "HEAD", "--", "fixture-product.txt"),
    protectedPaths = ["AGENTS.md", ".gitignore", ".aidn/config.json", ".codex/config.toml", ".codex/hooks.json", ".agents/skills/aidn/SKILL.md"],
    protectedView = () => protectedPaths.map(name => ({ path: name, sha256: fs.existsSync(path.join(root, name)) ? artifactContentHash(fs.readFileSync(path.join(root, name))) : null })),
    protectedBefore = protectedView();
  assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId).node_id, "selected_focus");
  const preview = await host.preview({ instanceId: "choice-record", expectedSha256: state.record.instance_sha256, occurrenceId });
  assert.equal(preview.prepared.can_apply, true, JSON.stringify(preview.prepared)); assert.deepEqual(canonical(), before);
  assert.equal(preview.input.checkpoint_operation_id, selectedCheckpointId);
  const plan = preview.prepared.plan, descriptor = selectedFocusSource(selectedCheckpointSource, preview.input),
    selectedBefore = before.filter(row => row.path.startsWith(plan.selected_cycle_path + "/"));
  assert.equal(plan.phase_route, { OPEN: "plan_adoption", IMPLEMENTING: "implementation_resume", VERIFYING: "verification_resume" }[plan.selected_state]);
  assert.deepEqual(plan.changes.map(row => row.path).sort(), ["CURRENT-STATE.md", "sessions/S002.md", "snapshots/context-snapshot.md"]);
  const changedSource = structuredClone(selectedCheckpointSource); changedSource.output.observations.source_sha256 = "f".repeat(64);
  assert.throws(() => selectedFocusSource(changedSource, preview.input));
  const unknownSource = structuredClone(selectedCheckpointSource);
  unknownSource.output = { contract_version: "standard-cycle-entry-selected-checkpoint-output.v1", operation_ref: "cycle_entry_selected_checkpoint",
    outcome: "reconciliation_required", effect_status: "unknown", facts: {}, observations: { reason_code: "FIXTURE_UNCERTAIN_CHECKPOINT" }, evidence_refs: [] };
  assert.throws(() => selectedFocusSource(unknownSource, preview.input), { code: "STANDARD_SELECTED_FOCUS_ACCEPTED_CHECKPOINT_REQUIRED" });
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock, { allowed: false });
  await assert.rejects(host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
  assert.deepEqual(canonical(), before); assert.equal(artifacts.ownerPending(), false);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), id = staged.operation_id;
  let live = true, sourceReads = 0;
  const boundary = createStandardCycleEntrySelectedFocus({ targetRoot: root, scope: operations.observeScope,
    readCurrent: () => host.inspect("choice-record").record,
    readCheckpoint: async () => { sourceReads++; live = false; return selectedCheckpointSource; } });
  await assert.rejects(boundary.apply(host.inspect("choice-record").record, host.readJournal(id).preview.prepared,
    { write: true, expectPlan: preview.prepared.plan_sha256, assertAuthorized: async () => {
      if (!live) throw Object.assign(Error("FIXTURE_FOCUS_GRANT_REVOKED_LAST_SOURCE_AWAIT"), { code: "FIXTURE_FOCUS_GRANT_REVOKED_LAST_SOURCE_AWAIT" });
    } }), { code: "FIXTURE_FOCUS_GRANT_REVOKED_LAST_SOURCE_AWAIT", effect_status: "no_effect" });
  assert.equal(sourceReads, 1); assert.equal(artifacts.ownerPending(), false); assert.deepEqual(canonical(), before);
  assert.equal(git("rev-parse", "HEAD"), beforeHead); assert.equal(artifactContentHash(fs.readFileSync(index)), beforeIndex);
  pass(mode + ": unaccepted/changed checkpoint and missing or last-await revoked permission cannot write focus");
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock + 86400000);
  const destination = path.resolve(root, "docs/audit", plan.changes[0].path), originalRename = fs.renameSync;
  let injected = false, dispatched;
  if (fault) fs.renameSync = function (from, to) {
    const result = originalRename.apply(this, arguments);
    if (!injected && path.resolve(to) === destination) { injected = true; throw Object.assign(Error("FIXTURE_FOCUS_CAS_ACK_LOSS"), { code: "FIXTURE_FOCUS_CAS_ACK_LOSS" }); }
    return result;
  };
  try { dispatched = await host.dispatch(id, { write: true }); } finally { fs.renameSync = originalRename; }
  const journal = host.readJournal(id), output = assertSelectedFocusOutput(journal.results.at(-1).output), after = canonical();
  createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
  assert.equal(git("rev-parse", "HEAD"), beforeHead); assert.equal(git("branch", "--show-current"), beforeBranch);
  assert.equal(heads(), beforeRefs); assert.equal(artifactContentHash(fs.readFileSync(index)), beforeIndex);
  assert.equal(git("ls-tree", "-r", "HEAD", "--", "fixture-product.txt"), product); assert.deepEqual(protectedView(), protectedBefore);
  assert.deepEqual(after.filter(row => row.path.startsWith(plan.selected_cycle_path + "/")), selectedBefore);
  const changed = new Set(plan.changes.map(row => row.path));
  for (const row of before.filter(row => !changed.has(row.path))) assert.deepEqual(after.find(next => next.path === row.path), row, row.path);
  if (mode === "db-only") for (const name of ["sessions/S002.md", "cycles/C003-feature-choice/status.md"])
    assert.equal(fs.existsSync(path.join(root, "docs/audit", name)), false);
  if (fault) {
    assert.equal(injected, true); assert.equal(dispatched.receipt.effect_status, "unknown"); assert.deepEqual(output.facts, {});
    assert.equal(output.outcome, "reconciliation_required"); assert.equal(artifacts.ownerPending(), true);
    const actualChanged = after.filter(row => before.find(old => old.path === row.path)?.sha256 !== row.sha256);
    assert.deepEqual(actualChanged.map(row => row.path), [plan.changes[0].path]);
    const cold = JSON.parse(execFileSync(process.execPath, [script, "--inspect-focus", root, keyFile, sourcesFile, id, String(clock + 86400000)],
      { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
    assert.equal(cold.effect_status, "unknown"); assert.equal(cold.owner_pending, true); assert.equal(cold.journal_sha256, shadowHash(journal));
    assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
    assert.equal((await boundary.prepare(host.inspect("choice-record").record, preview.input, "op_" + "b".repeat(40))).reason_code,
      "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    console.log(JSON.stringify({ focus_scope: mode, root, private_root: f.privateRoot, operation_id: id, checkpoint_operation_id: selectedCheckpointId,
      journal_sha256: shadowHash(journal), fault, effect_status: "unknown", owner_retained: true, changed_paths: actualChanged.map(row => row.path),
      phase_preserved: true, product_and_Git_preserved: true, phase_admission: "NOT_RUN", native_calls: 0 }));
    pass("files: lost first-CAS ACK retains partial focus, signed UNKNOWN and owner across cold read without repeating a write"); return;
  }
  assert.equal(dispatched.receipt.outcome, "completed", JSON.stringify(dispatched)); assert.equal(output.outcome, "completed");
  assert.equal(output.facts.cycle_entry_focus_recorded, true); assert.equal(output.facts.cycle_entry_resume_allowed, false);
  assert.equal(output.observations.phase_admission, false); assert.equal(output.observations.progress_adoption, false); assert.equal(output.observations.implementation_authorized, false);
  assert.equal(fields(artifacts.read("CURRENT-STATE.md")).active_cycle, plan.selected_cycle_id);
  assert.equal(fields(artifacts.read("CURRENT-STATE.md")).cycle_branch, plan.selected_branch);
  const session = parseSessionMetadata(artifacts.read("sessions/S002.md").content);
  assert.equal(session.primary_focus_cycle, plan.selected_cycle_id); assert.equal(session.cycle_branch, plan.selected_branch);
  assert.deepEqual(session.reported_from_previous_session, descriptor.deferred_cycles); assert.equal(session.carry_over_pending, descriptor.carry_over_pending ? "yes" : "no");
  for (const change of plan.changes) assert.equal(artifacts.read(change.path).sha256, change.after_sha256);
  const entry = await operations.admitCycleEntry({ contract_version: "standard-cycle-entry-input.v1", session_id: "S002", cycle_id: plan.selected_cycle_id });
  assert.equal(entry.facts.cycle_entry_choice_required, true);
  const cold = JSON.parse(execFileSync(process.execPath, [script, "--accept-focus", root, keyFile, sourcesFile, id, String(clock + 86400000)],
    { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
  const final = host.inspect("choice-record"); assert.equal(final.cursor.status, "COMPLETED"); assert.equal(final.record.instance_sha256, cold.instance_sha256);
  assert.equal(artifacts.ownerPending(), false); assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
  await host.accept(id, { write: true }); assert.equal(host.inspect("choice-record").record.instance_sha256, final.record.instance_sha256); assert.deepEqual(canonical(), after);
  let last, count = 0; for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id,
    model: final.record.model, policyPins: final.record.policy_pins, events: final.record.events })) { last = row; count++; }
  assert.equal(last.instance_sha256, final.record.instance_sha256); assert.equal(count, final.record.events.length + 1);
  console.log(JSON.stringify({ focus_scope: mode, root, private_root: f.privateRoot, operation_id: id, checkpoint_operation_id: selectedCheckpointId,
    journal_sha256: shadowHash(journal), instance_sha256: final.record.instance_sha256, selected_cycle_id: plan.selected_cycle_id,
    selected_state: plan.selected_state, phase_route: plan.phase_route, selected_current: selectCurrent, prior_no_change_index_refreshed: noChangeSource,
    source_index_sha256: selectedCheckpointSource.plan.git.observed.index_sha256, current_plan_index_sha256: plan.git_observed.index_sha256, changed_paths: plan.changes.map(row => row.path),
    selected_phase_and_progress_metadata_unchanged: true, deferred_history_unchanged: true, product_and_Git_preserved: true,
    DBonly_no_detailed_export: mode === "db-only", canonical_focus: "ACTUAL_CAS", phase_admission: "NOT_RUN", progress_adoption: "NOT_RUN",
    implementation_authorized: false, exact_replay: true, cold_acceptance: true, H_and_grants: "CONTROLLED_FIXTURE",
    phase_setup: "STAGED_NOT_PRIOR_WORK_PROOF", native_calls: 0, published_root: "NOT_CONNECTED" }));
  pass(mode + ": exact three-document focus CAS retains phase/progress/deferred history, separate admission, cold ACK and exact SIM");
}
if (["--accept-record", "--accept-focus", "--inspect-focus"].includes(process.argv[2])) {
  const [, , , root, keyFile, sourcesFile, operationId, clock] = process.argv;
  console.log(JSON.stringify(await acceptRecordedChoice({ root, keyFile, sourcesFile, operationId, clock: Number(clock), inspectOnly: process.argv[2] === "--inspect-focus" })));
} else if (path.resolve(process.argv[1] ?? "") === script) {
  const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7), fault = process.argv.find(arg => arg.startsWith("--fault="))?.slice(8) ?? null,
    phase = process.argv.find(arg => arg.startsWith("--phase="))?.slice(8) ?? "VERIFYING", selectCurrent = process.argv.includes("--select-current");
  if (!process.argv.includes("--contracts-only") && !["files", "dual", "db-only"].includes(mode) || mode && process.argv.includes("--contracts-only")
    || !["OPEN", "IMPLEMENTING", "VERIFYING"].includes(phase) || fault && (fault !== "cas_ack" || mode !== "files" || selectCurrent)
    || selectCurrent && mode !== "files" || phase !== "VERIFYING" && mode !== "files") throw Error("FOCUS_FIXTURE_SCOPE_INVALID");
  contracts();
  if (mode) await verifyCanonicalCycleChoiceRecord(mode, { childScript: script, pass, checkpoint: true, activation: true, selectedCheckpoint: true, selectedFocus: true,
    selectedPhase: selectCurrent ? null : phase, selectedCycleId: selectCurrent ? "C002" : "C001",
    afterRecordedChoice: f => activationCase(f, { pass, selectCurrent, nextNode: "selected_checkpoint",
      afterActivation: f => selectedCase(f, { pass, selectCurrent, nextNode: "selected_focus", afterSelected: f => focusCase(f, { fault, selectCurrent }) }) }) });
  console.log(JSON.stringify({ status: "PASS", checks, scope: mode ? "ACTUAL_SELECTED_FOCUS_COMMON_HOST_COMPONENT" : "CLOSED_FOCUS_CONTRACTS",
    phase_setup: "STAGED_CANONICAL_METADATA", phase_work_admission: "NOT_RUN", genuine_native: "NOT_RUN", full_standard: false }));
}
