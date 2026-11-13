import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { assertCycleChoiceCheckpointOutput, cycleChoiceCheckpointDocuments } from "../../src/core/workflow/standard-cycle-entry-choice-checkpoint.mjs";
import { createStandardCycleEntryChoiceCheckpoint } from "../../src/application/runtime/standard-cycle-entry-choice-checkpoint.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../src/adapters/runtime/local-workflow-git-checkpoint.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { verifyCanonicalCycleChoiceRecord, acceptRecordedChoice, openCycleChoiceFixtureHost } from "./standard-cycle-choice-record-fixture-lib.mjs";

let checks = 0;
const pass = label => { checks++; console.log("PASS " + label); };
const childScript = fileURLToPath(import.meta.url), H = "a".repeat(64), G = "b".repeat(40), O = "op_" + "c".repeat(40);

function contracts() {
  for (const kind of ["input", "plan", "output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-cycle-entry-choice-checkpoint-${kind}.v1.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const input = { contract_version: "standard-cycle-entry-choice-checkpoint-input.v1", record_operation_id: O };
  assertStandardOperationInput("cycle_entry_choice_checkpoint", input);
  assert.throws(() => assertStandardOperationInput("cycle_entry_choice_checkpoint", { ...input, approved_paths: ["product.txt"] }));
  pass("checkpoint contracts expose only an accepted record identity and closed supported JSON");
  const output = { contract_version: "standard-cycle-entry-choice-checkpoint-output.v1", operation_ref: "cycle_entry_choice_checkpoint",
    outcome: "completed", effect_status: "no_effect", facts: { cycle_entry_choice_checkpoint_ready: true, cycle_entry_choice_checkpoint_created: false, cycle_entry_resume_allowed: false },
    observations: { record_operation_id: O, source_sha256: H, session_id: "S002", selected_cycle_id: "C001", selected_state: "VERIFYING",
      selected_branch: "feature/C001-choice", selected_branch_head: G, committed_paths: [], git: { status: "no_change", head: G, effect_status: "no_effect" },
      branch_activated: false, implementation_authorized: false }, evidence_refs: [] };
  assertCycleChoiceCheckpointOutput(output);
  assert.throws(() => assertCycleChoiceCheckpointOutput({ ...output, facts: { ...output.facts, cycle_entry_choice_checkpoint_created: true } }));
  assert.throws(() => assertCycleChoiceCheckpointOutput({ ...output, facts: { ...output.facts, cycle_entry_resume_allowed: true } }));
  assert.throws(() => assertCycleChoiceCheckpointOutput({ ...output, observations: { ...output.observations, branch_activated: true } }));
  assertCycleChoiceCheckpointOutput({ ...output, outcome: "reconciliation_required", effect_status: "unknown", facts: {}, observations: { reason_code: "FIXTURE_UNKNOWN" } });
  assert.throws(() => assertCycleChoiceCheckpointOutput({ ...output, outcome: "reconciliation_required", effect_status: "unknown" }));
  pass("a checkpoint distinguishes no-change and confirmed Git effects and never grants resume, activation or UNKNOWN facts");
}

async function checkpointCase(f, fault) {
  const { root, mode, artifacts, operations, recordId, keyFile, sourcesFile, clock, git, heads, canonical, beforeProduct } = f;
  let host = f.host;
  const sourceJournal = host.readJournal(recordId), source = { record_operation_id: recordId, record_sha256: shadowHash(sourceJournal),
    plan: sourceJournal.preview.prepared.plan, output: sourceJournal.results.at(-1).output };
  const allPaths = ["docs/audit/CURRENT-STATE.md", "docs/audit/sessions/S002.md", "docs/audit/snapshots/context-snapshot.md",
    ...Array.from({ length: 128 }, (_, i) => `docs/audit/cycles/C${String(i + 1).padStart(3, "0")}-feature-choice/status.md`)];
  assert.doesNotThrow(() => createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-choice", approvedPaths: allPaths }));
  assert.throws(() => createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-terminal", approvedPaths: allPaths }), { code: "WORKFLOW_GIT_SCOPE_PROFILE_INVALID" });
  assert.throws(() => createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-choice", approvedPaths: ["product.txt"] }), { code: "WORKFLOW_GIT_SCOPE_PROFILE_INVALID" });
  const forged = structuredClone(source.output); forged.observations.selected_state = source.plan.selected_state === "OPEN" ? "VERIFYING" : "OPEN";
  assert.throws(() => cycleChoiceCheckpointDocuments(source.plan, forged));
  const before = canonical(), oldHead = git("rev-parse", "HEAD"), oldBranch = git("branch", "--show-current"), oldRefs = heads(),
    product = path.join(root, "fixture-product.txt"), bytes = fs.readFileSync(product), selectedHead = git("rev-parse", source.plan.selected_branch),
    protectedPaths = ["AGENTS.md", ".aidn/config.json", ".codex/config.toml", ".codex/hooks.json"],
    protectedHashes = () => protectedPaths.map(name => ({ path: name, sha256: fs.existsSync(path.join(root, name)) ? artifactContentHash(fs.readFileSync(path.join(root, name))) : null })),
    beforeProtected = protectedHashes();
  const next = () => { const state = host.inspect("choice-record"); return host.preview({ instanceId: "choice-record", expectedSha256: state.record.instance_sha256, occurrenceId: state.cursor.ready[0] }); };
  fs.appendFileSync(product, "Foreign unadmitted product change must not be committed.\n");
  try { const blocked = await next(); assert.equal(blocked.prepared.can_apply, false); assert.deepEqual(canonical(), before); }
  finally { fs.writeFileSync(product, bytes); }
  const preview = await next(); assert.equal(preview.prepared.can_apply, true, JSON.stringify(preview.prepared));
  const expectedPaths = mode === "db-only" ? [] : source.output.observations.committed.map(row => "docs/audit/" + row.path).sort();
  assert.deepEqual(preview.prepared.plan.git.files.map(row => row.path).sort(), expectedPaths);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock, { allowed: false });
  await assert.rejects(host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
  assert.equal(git("rev-parse", "HEAD"), oldHead); assert.deepEqual(canonical(), before);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), id = staged.operation_id,
    prepared = host.readJournal(id).preview.prepared, beforeIndex = artifactContentHash(fs.readFileSync(path.resolve(root, git("rev-parse", "--git-path", "index"))));
  let reads = 0, grantLive = true;
  const boundary = createStandardCycleEntryChoiceCheckpoint({ targetRoot: root, scope: operations.observeScope,
    readCurrent: () => host.inspect("choice-record").record, readRecorded: async () => { if (++reads === 5) grantLive = false; return source; } });
  const refused = await boundary.apply(host.inspect("choice-record").record, prepared, { write: true, expectPlan: prepared.plan_sha256,
    assertAuthorized: async () => { if (!grantLive) throw Object.assign(Error("FIXTURE_CHOICE_CHECKPOINT_GRANT_REVOKED_LAST_SOURCE_AWAIT"),
      { code: "FIXTURE_CHOICE_CHECKPOINT_GRANT_REVOKED_LAST_SOURCE_AWAIT" }); } });
  assert.equal(reads, 5); assert.equal(refused.outcome, "blocked"); assert.equal(refused.effect_status, "no_effect"); assert.deepEqual(refused.facts, {});
  assert.equal(git("rev-parse", "HEAD"), oldHead); assert.equal(artifacts.ownerPending(), false); assert.deepEqual(canonical(), before);
  assert.equal(artifactContentHash(fs.readFileSync(path.resolve(root, git("rev-parse", "--git-path", "index")))), beforeIndex);
  pass(mode + ": approved canonical paths reject foreign work, fabricated phase, missing grant and last-await revocation before Git effects");
  const originalRename = fs.renameSync, indexFile = path.resolve(root, git("rev-parse", "--git-path", "index"));
  let injected = false, dispatched;
  if (fault) fs.renameSync = function (from, to) {
    const result = originalRename.apply(this, arguments);
    if (!injected && path.resolve(to) === indexFile) { injected = true; throw Object.assign(Error("FIXTURE_CHOICE_CHECKPOINT_INDEX_ACK_LOST"), { code: "FIXTURE_CHOICE_CHECKPOINT_INDEX_ACK_LOST" }); }
    return result;
  };
  try { dispatched = await host.dispatch(id, { write: true }); } finally { fs.renameSync = originalRename; }
  const journal = host.readJournal(id), output = journal.results.at(-1).output;
  createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal); assertCycleChoiceCheckpointOutput(output);
  assert.equal(git("branch", "--show-current"), oldBranch);
  assert.equal(artifactContentHash(fs.readFileSync(product)), beforeProduct); assert.deepEqual(protectedHashes(), beforeProtected); assert.deepEqual(canonical(), before);
  const newHead = git("rev-parse", "HEAD"), selected = source.plan.selected_branch,
    expectedSelectedHead = selected === oldBranch ? newHead : selectedHead;
  assert.equal(git("rev-parse", selected), expectedSelectedHead);
  if (mode === "db-only") assert.equal(newHead, oldHead);
  else {
    assert.notEqual(newHead, oldHead); assert.equal(git("rev-parse", "HEAD^"), oldHead);
    assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", newHead).split(/\r?\n/).sort(), expectedPaths);
    assert.equal(git("show", "-s", "--format=%B", newHead).includes("AIDN-Operation: " + id), true);
  }
  const beforeRows = new Map(oldRefs.split(/\r?\n/).map(row => row.split("\t"))), afterRows = new Map(heads().split(/\r?\n/).map(row => row.split("\t")));
  for (const [name, value] of beforeRows) if (name !== "refs/heads/" + oldBranch) assert.equal(afterRows.get(name), value);
  if (fault) {
    assert.equal(injected, true); assert.equal(dispatched.receipt.effect_status, "unknown"); assert.equal(output.outcome, "reconciliation_required");
    assert.deepEqual(output.facts, {}); assert.equal(artifacts.ownerPending(), true);
    const cold = JSON.parse(execFileSync(process.execPath, [childScript, "--inspect-checkpoint", root, keyFile, sourcesFile, id, String(clock)], { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
    assert.equal(cold.journal_sha256, shadowHash(journal)); assert.equal(cold.effect_status, "unknown"); assert.equal(cold.owner_pending, true);
    assert.equal((await host.dispatch(id, { write: true })).status, "retained_result"); assert.equal(git("rev-parse", "HEAD"), newHead);
    console.log(JSON.stringify({ checkpoint_scope: mode, root, private_root: f.privateRoot, operation_id: id, journal_sha256: shadowHash(journal),
      effect_status: "unknown", owner_retained: true, commit_observed: newHead, actual_committed_paths: expectedPaths, cold_read: true, native_calls: 0 }));
    pass("files: actual Git/index acknowledgement loss retains a signed UNKNOWN and owner without repeating the commit");
    return;
  }
  assert.equal(output.outcome, "completed", JSON.stringify(dispatched));
  assert.deepEqual(output.facts, { cycle_entry_choice_checkpoint_ready: true, cycle_entry_choice_checkpoint_created: mode !== "db-only", cycle_entry_resume_allowed: false });
  assert.equal(output.observations.branch_activated, false); assert.equal(output.observations.implementation_authorized, false);
  assert.equal(output.observations.selected_branch_head, expectedSelectedHead);
  assert.equal(output.observations.selected_branch, selected); assert.equal(git("status", "--porcelain"), "");
  const cold = JSON.parse(execFileSync(process.execPath, [childScript, "--accept-checkpoint", root, keyFile, sourcesFile, id, String(clock)], { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
  const final = host.inspect("choice-record"); assert.equal(final.cursor.status, "COMPLETED"); assert.equal(final.record.instance_sha256, cold.instance_sha256);
  assert.equal(artifacts.ownerPending(), false); assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
  await host.accept(id, { write: true }); assert.equal(host.inspect("choice-record").record.instance_sha256, final.record.instance_sha256);
  let last, rows = 0; for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id, model: final.record.model,
    policyPins: final.record.policy_pins, events: final.record.events })) { last = row; rows++; }
  assert.equal(last.instance_sha256, final.record.instance_sha256); assert.equal(rows, final.record.events.length + 1);
  assert.equal(git("rev-parse", "HEAD"), newHead); assert.deepEqual(canonical(), before);
  console.log(JSON.stringify({ checkpoint_scope: mode, root, private_root: f.privateRoot, operation_id: id, instance_sha256: final.record.instance_sha256,
    journal_sha256: shadowHash(journal), source_record_operation_id: recordId, source_parent: oldHead, head: newHead, selected_branch: selected,
    selected_branch_head: expectedSelectedHead, selected_current_branch: selected === oldBranch, committed_paths: expectedPaths, canonical_metadata_unchanged: true, branch_activation: "NOT_EXECUTED",
    imported_phase: "STAGED_METADATA_NOT_WORK_ACCEPTANCE", native_calls: 0, genuine_actors: "NOT_RUN", installed_archive: "NOT_RUN", postgres: "NOT_RUN" }));
  pass(mode + ": signed canonical-choice checkpoint commits only approved metadata or preserves DB-only no-export, with cold ACK and exact replay");
}

if (["--accept-record", "--accept-checkpoint", "--inspect-checkpoint"].includes(process.argv[2])) {
  const [, , , root, keyFile, sourcesFile, operationId, clock] = process.argv;
  console.log(JSON.stringify(await acceptRecordedChoice({ root, keyFile, sourcesFile, operationId, clock: Number(clock), inspectOnly: process.argv[2] === "--inspect-checkpoint" })));
} else {
  const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7), fault = process.argv.includes("--fault-after-index-ack"), selectCurrent = process.argv.includes("--select-current");
  if (!process.argv.includes("--contracts-only") && !["files", "dual", "db-only"].includes(mode)
    || mode && process.argv.includes("--contracts-only") || fault && mode !== "files" || selectCurrent && !mode) throw Error("CHOICE_CHECKPOINT_FIXTURE_SCOPE_INVALID");
  contracts();
  if (mode) await verifyCanonicalCycleChoiceRecord(mode, { childScript, pass, checkpoint: true, selectedCycleId: selectCurrent ? "C002" : "C001", afterRecordedChoice: f => checkpointCase(f, fault) });
  console.log(JSON.stringify({ status: "PASS", checks, scope: mode ? "actual-canonical-choice-checkpoint-port" : "closed-checkpoint-contracts", native_calls: 0,
    branch_activation: "NOT_EXECUTED", continuity_R1_R2_R3: "NOT_EXECUTED", full_standard: false }));
}
