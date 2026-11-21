import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { focusCheckpointSource, assertFocusCheckpointOutput } from "../../src/core/workflow/standard-cycle-entry-focus-checkpoint.mjs";
import { createStandardCycleEntryFocusCheckpoint } from "../../src/application/runtime/standard-cycle-entry-focus-checkpoint.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../src/adapters/runtime/local-workflow-git-checkpoint.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { activationCase } from "./verify-standard-cycle-choice-activation-fixtures.mjs";
import { selectedCase } from "./verify-standard-selected-context-checkpoint-fixtures.mjs";
import { focusCase } from "./verify-standard-selected-focus-fixtures.mjs";
import { verifyCanonicalCycleChoiceRecord, openCycleChoiceFixtureHost, acceptRecordedChoice } from "./standard-cycle-choice-record-fixture-lib.mjs";
const script = fileURLToPath(import.meta.url);
let checks = 0;
const pass = text => { checks++; console.log("PASS " + text); };
function contracts() {
  for (const kind of ["input", "plan", "output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-cycle-entry-focus-checkpoint-" + kind + ".v1.schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const input = { contract_version: "standard-cycle-entry-focus-checkpoint-input.v1", focus_operation_id: "op_" + "a".repeat(40) };
  assertStandardOperationInput("cycle_entry_focus_checkpoint", input);
  for (const extra of [{ approved: true }, { paths: ["docs/audit/CURRENT-STATE.md"] }, { phase: "VERIFYING" }, { cycle_id: "C001" }])
    assert.throws(() => assertStandardOperationInput("cycle_entry_focus_checkpoint", { ...input, ...extra }));
  pass("focus checkpoint contracts accept only a focus identity, never paths, phase or permission");
}
async function checkpointCase(f, { fault }) {
  const { root, mode, keyFile, sourcesFile, clock, artifacts, operations, git, heads, canonical, focusId, focusSource } = f;
  let host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const input = { contract_version: "standard-cycle-entry-focus-checkpoint-input.v1", focus_operation_id: focusId },
    initial = host.inspect("choice-record"), canonicalBefore = canonical(), foreign = path.join(root, "fixture-foreign-checkpoint-work.txt"),
    boundary = createStandardCycleEntryFocusCheckpoint({ targetRoot: root, scope: operations.observeScope,
      readCurrent: () => host.inspect("choice-record").record, readFocus: async () => focusSource });
  fs.writeFileSync(foreign, "Foreign product work must not enter the focus checkpoint.\n", { flag: "wx" });
  try { const refused = await boundary.prepare(initial.record, input, "op_" + "e".repeat(40)); assert.equal(refused.can_apply, false); }
  finally { fs.unlinkSync(foreign); }
  assert.deepEqual(canonical(), canonicalBefore); assert.equal(artifacts.ownerPending(), false);
  git("status", "--porcelain");
  const state = host.inspect("choice-record"), occurrenceId = state.cursor.ready[0],
    beforeHead = git("rev-parse", "HEAD"), beforeBranch = git("branch", "--show-current"), beforeRefs = heads(),
    index = path.resolve(root, git("rev-parse", "--git-path", "index")), indexBefore = artifactContentHash(fs.readFileSync(index)),
    productBefore = git("ls-tree", "-r", "HEAD", "--", "fixture-product.txt"),
    protectedPaths = ["AGENTS.md", ".gitignore", ".aidn/config.json", ".codex/config.toml", ".codex/hooks.json", ".agents/skills/aidn/SKILL.md"],
    protectedView = () => protectedPaths.map(name => ({ path: name, sha256: fs.existsSync(path.join(root, name)) ? artifactContentHash(fs.readFileSync(path.join(root, name))) : null })),
    protectedBefore = protectedView();
  assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId).node_id, "focus_checkpoint");
  const preview = await host.preview({ instanceId: "choice-record", expectedSha256: state.record.instance_sha256, occurrenceId });
  assert.equal(preview.prepared.can_apply, true, JSON.stringify(preview.prepared)); assert.deepEqual(canonical(), canonicalBefore);
  const plan = preview.prepared.plan, allowed = plan.physical_focus.map(row => row.path), checkpointExpected = mode !== "db-only";
  assert.deepEqual(allowed, ["docs/audit/CURRENT-STATE.md", "docs/audit/sessions/S002.md", "docs/audit/snapshots/context-snapshot.md"]);
  assert.deepEqual(plan.git.files.map(row => row.path).sort(), checkpointExpected ? allowed : []);
  assert.deepEqual(focusCheckpointSource(focusSource, input), plan.context);
  const changed = structuredClone(focusSource); changed.output.observations.source_sha256 = "f".repeat(64);
  assert.throws(() => focusCheckpointSource(changed, input));
  const unknown = structuredClone(focusSource);
  unknown.output = { contract_version: "standard-cycle-entry-selected-focus-output.v1", operation_ref: "cycle_entry_selected_focus",
    outcome: "reconciliation_required", effect_status: "unknown", facts: {}, observations: { reason_code: "FIXTURE_UNKNOWN_FOCUS" }, evidence_refs: [] };
  assert.throws(() => focusCheckpointSource(unknown, input), { code: "STANDARD_FOCUS_CHECKPOINT_ACCEPTED_FOCUS_REQUIRED" });
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock, { allowed: false });
  await assert.rejects(host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
  assert.equal(artifacts.ownerPending(), false); assert.deepEqual(canonical(), canonicalBefore);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), id = staged.operation_id,
    prepared = host.readJournal(id).preview.prepared;
  let grantLive = true, sourceReads = 0;
  const lateBoundary = createStandardCycleEntryFocusCheckpoint({ targetRoot: root, scope: operations.observeScope,
    readCurrent: () => host.inspect("choice-record").record,
    readFocus: async () => { sourceReads++; grantLive = false; return focusSource; } });
  await assert.rejects(lateBoundary.apply(host.inspect("choice-record").record, prepared, { write: true, expectPlan: prepared.plan_sha256,
    assertAuthorized: async () => { if (!grantLive) throw Object.assign(Error("FIXTURE_FOCUS_CP_GRANT_REVOKED_LAST_SOURCE_AWAIT"), { code: "FIXTURE_FOCUS_CP_GRANT_REVOKED_LAST_SOURCE_AWAIT" }); } }),
    { code: "FIXTURE_FOCUS_CP_GRANT_REVOKED_LAST_SOURCE_AWAIT", effect_status: "no_effect" });
  assert.equal(sourceReads, 1); assert.equal(artifacts.ownerPending(), false); assert.deepEqual(canonical(), canonicalBefore);
  assert.equal(git("rev-parse", "HEAD"), beforeHead); assert.equal(artifactContentHash(fs.readFileSync(index)), indexBefore);
  pass(mode + ": foreign work, unaccepted focus, missing grant and final-source-await revocation refuse before Git effects");
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock + 86400000,
    { allowed: () => fault !== "grant_after_ref" || git("rev-parse", "HEAD") === beforeHead });
  const originalRename = fs.renameSync; let injected = false, dispatched;
  if (fault === "index_ack") fs.renameSync = function (from, to) {
    const result = originalRename.apply(this, arguments);
    if (!injected && path.resolve(to) === index) { injected = true; throw Object.assign(Error("FIXTURE_FOCUS_CP_INDEX_ACK_LOST"), { code: "FIXTURE_FOCUS_CP_INDEX_ACK_LOST" }); }
    return result;
  };
  try { dispatched = await host.dispatch(id, { write: true }); } finally { fs.renameSync = originalRename; }
  const journal = host.readJournal(id), output = assertFocusCheckpointOutput(journal.results.at(-1).output),
    raw = { ...plan.git, operation_id: id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: prepared.plan_sha256 };
  createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
  assert.deepEqual(canonical(), canonicalBefore); assert.deepEqual(protectedView(), protectedBefore);
  assert.equal(git("branch", "--show-current"), beforeBranch); assert.equal(git("ls-tree", "-r", "HEAD", "--", "fixture-product.txt"), productBefore);
  const refs = () => new Map(heads().split(/\r?\n/).filter(Boolean).map(row => row.split("\t")));
  for (const [ref, value] of new Map(beforeRefs.split(/\r?\n/).filter(Boolean).map(row => row.split("\t"))))
    if (ref !== "refs/heads/" + beforeBranch) assert.equal(refs().get(ref), value);
  if (mode === "db-only") for (const name of ["sessions/S002.md", "cycles/C003-feature-choice/status.md"])
    assert.equal(fs.existsSync(path.join(root, "docs/audit", name)), false);
  if (fault) {
    if (fault === "index_ack") assert.equal(injected, true);
    assert.equal(dispatched.receipt.effect_status, "unknown"); assert.equal(output.outcome, "reconciliation_required"); assert.deepEqual(output.facts, {});
    assert.equal(artifacts.ownerPending(), true); assert.notEqual(git("rev-parse", "HEAD"), beforeHead);
    const physical = createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-context", approvedPaths: allowed }).inspectCommit(raw);
    assert.equal(physical.status, fault === "grant_after_ref" ? "commit_observed" : "confirmed");
    if (fault === "grant_after_ref") { assert.equal(artifactContentHash(fs.readFileSync(index)), indexBefore); assert.equal(physical.index_reconciled, false); }
    const cold = JSON.parse(execFileSync(process.execPath, [script, "--inspect-focus-cp", root, keyFile, sourcesFile, id, String(clock + 86400000)], { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
    assert.equal(cold.effect_status, "unknown"); assert.equal(cold.owner_pending, true); assert.equal(cold.journal_sha256, shadowHash(journal));
    assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
    assert.equal((await boundary.prepare(host.inspect("choice-record").record, input, "op_" + "b".repeat(40))).reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    console.log(JSON.stringify({ focus_checkpoint_scope: mode, root, private_root: f.privateRoot, operation_id: id, focus_operation_id: focusId,
      journal_sha256: shadowHash(journal), fault, signed_effect_status: "unknown", physical_status: physical.status, owner_retained: true,
      canonical_focus_and_phase_unchanged: true, product_preserved: true, phase_admission: "NOT_RUN", native_calls: 0 }));
    pass(mode + ": " + fault + " retains signed UNKNOWN and owner; cold physical evidence cannot repeat or promote the effect"); return;
  }
  assert.equal(dispatched.receipt.outcome, "completed", JSON.stringify(dispatched)); assert.equal(output.outcome, "completed");
  assert.equal(output.effect_status, checkpointExpected ? "confirmed" : "no_effect");
  assert.equal(output.facts.cycle_entry_focus_checkpoint_ready, true); assert.equal(output.facts.cycle_entry_resume_allowed, false);
  assert.equal(output.observations.phase_admission, false); assert.equal(output.observations.progress_adoption, false);
  assert.equal(output.observations.selected_branch_head, git("rev-parse", "HEAD")); assert.equal(git("status", "--porcelain"), "");
  const cold = JSON.parse(execFileSync(process.execPath, [script, "--accept-focus-cp", root, keyFile, sourcesFile, id, String(clock + 86400000)], { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
  const final = host.inspect("choice-record"); assert.equal(final.cursor.status, "COMPLETED"); assert.equal(final.record.instance_sha256, cold.instance_sha256);
  assert.equal(artifacts.ownerPending(), false); assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
  await host.accept(id, { write: true }); assert.equal(host.inspect("choice-record").record.instance_sha256, final.record.instance_sha256); assert.deepEqual(canonical(), canonicalBefore);
  let last, rows = 0; for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id, model: final.record.model,
    policyPins: final.record.policy_pins, events: final.record.events })) { last = row; rows++; }
  assert.equal(last.instance_sha256, final.record.instance_sha256); assert.equal(rows, final.record.events.length + 1);
  console.log(JSON.stringify({ focus_checkpoint_scope: mode, root, private_root: f.privateRoot, operation_id: id, focus_operation_id: focusId,
    journal_sha256: shadowHash(journal), instance_sha256: final.record.instance_sha256, previous_head: beforeHead, selected_head: output.observations.selected_branch_head,
    committed_paths: output.observations.committed_paths, canonical_focus_phase_progress_unchanged: true, exact_replay: true, cold_acceptance: true,
    DBonly_no_detailed_export: mode === "db-only", H_and_grants: "CONTROLLED_FIXTURE", phase_setup: "STAGED_NOT_PRIOR_WORK_PROOF",
    phase_admission: "NOT_RUN", implementation_authorized: false, native_calls: 0, published_root: "NOT_CONNECTED" }));
  pass(mode + ": accepted focus drives its exact Git checkpoint/no-change with unchanged canonical data, cold ACK and exact replay");
}
if (path.resolve(process.argv[1] ?? "") === script) {
  if (["--accept-record", "--accept-focus-cp", "--inspect-focus-cp"].includes(process.argv[2])) {
    const [, , , root, keyFile, sourcesFile, operationId, clock] = process.argv;
    console.log(JSON.stringify(await acceptRecordedChoice({ root, keyFile, sourcesFile, operationId, clock: Number(clock), inspectOnly: process.argv[2] === "--inspect-focus-cp" })));
  } else {
    const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7), fault = process.argv.find(arg => arg.startsWith("--fault="))?.slice(8) ?? null,
      selectCurrent = process.argv.includes("--select-current");
    if (!process.argv.includes("--contracts-only") && !["files", "dual", "db-only"].includes(mode) || mode && process.argv.includes("--contracts-only")
      || selectCurrent && mode !== "files" || fault && (mode !== "files" || selectCurrent || !["grant_after_ref", "index_ack"].includes(fault))) throw Error("FOCUS_CHECKPOINT_FIXTURE_SCOPE_INVALID");
    contracts();
    if (mode) await verifyCanonicalCycleChoiceRecord(mode, { childScript: script, pass, checkpoint: true, activation: true, selectedCheckpoint: true, selectedFocus: true, focusCheckpoint: true,
      selectedPhase: selectCurrent ? null : "VERIFYING", selectedCycleId: selectCurrent ? "C002" : "C001",
      afterRecordedChoice: f => activationCase(f, { pass, selectCurrent, nextNode: "selected_checkpoint",
        afterActivation: f => selectedCase(f, { pass, selectCurrent, nextNode: "selected_focus",
          afterSelected: f => focusCase(f, { pass, selectCurrent, nextNode: "focus_checkpoint", afterFocus: f => checkpointCase(f, { fault }) }) }) }) });
    console.log(JSON.stringify({ status: "PASS", checks, scope: mode ? "ACTUAL_FOCUS_CHECKPOINT_COMMON_HOST_COMPONENT" : "CLOSED_FOCUS_CHECKPOINT_CONTRACTS",
      phase_setup: "STAGED_CANONICAL_DATA", phase_admission: "NOT_RUN", native_calls: 0, full_standard: false }));
  }
}
