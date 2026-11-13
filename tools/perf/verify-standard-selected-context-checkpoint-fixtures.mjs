import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { assertSelectedContextCheckpointOutput } from "../../src/core/workflow/standard-cycle-entry-selected-checkpoint.mjs";
import { createStandardCycleEntrySelectedCheckpoint } from "../../src/application/runtime/standard-cycle-entry-selected-checkpoint.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../src/adapters/runtime/local-workflow-git-checkpoint.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { activationCase } from "./verify-standard-cycle-choice-activation-fixtures.mjs";
import { verifyCanonicalCycleChoiceRecord, openCycleChoiceFixtureHost, acceptRecordedChoice } from "./standard-cycle-choice-record-fixture-lib.mjs";

const script = fileURLToPath(import.meta.url);
let checks = 0;
const pass = text => { checks++; console.log("PASS " + text); };
function contracts() {
  for (const name of ["standard-cycle-entry-selected-input", "standard-cycle-entry-selected-checkpoint-plan", "standard-cycle-entry-selected-checkpoint-output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/" + name + ".v1.schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const input = { contract_version: "standard-cycle-entry-selected-input.v1", activation_operation_id: "op_" + "a".repeat(40) };
  assertStandardOperationInput("cycle_entry_selected_checkpoint", input);
  for (const extra of [{ approved: true }, { paths: ["src/product.mjs"] }, { profile: "cycle-context" }])
    assert.throws(() => assertStandardOperationInput("cycle_entry_selected_checkpoint", { ...input, ...extra }));
  pass("selected context contracts accept only an activation ID, never paths, a profile or approval");
}
async function selectedCase(f, { fault, selectCurrent }) {
  const { root, mode, keyFile, sourcesFile, clock, artifacts, operations, git, canonical, activationId, activationSource } = f;
  let host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const state = host.inspect("choice-record"), occurrenceId = state.cursor.ready[0];
  assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId).node_id, "selected_checkpoint");
  const preview = await host.preview({ instanceId: "choice-record", expectedSha256: state.record.instance_sha256, occurrenceId });
  assert.equal(preview.prepared.can_apply, true, JSON.stringify(preview.prepared));
  assert.equal(preview.input.activation_operation_id, activationId);
  assert.deepEqual(preview.prepared.plan.overlay_paths, activationSource.plan.git.observed.canonical_overlay_paths);
  assert.equal(preview.prepared.plan.context.phase_admission, "not_evaluated");
  const canonicalBefore = canonical(), beforeHead = git("rev-parse", "HEAD"), selectedBranch = git("branch", "--show-current"),
    index = path.resolve(root, git("rev-parse", "--git-path", "index")), indexBefore = artifactContentHash(fs.readFileSync(index)),
    refs = () => new Map(git("for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/").split(/\r?\n/).filter(Boolean).map(row => row.split(" "))),
    beforeRefs = refs(), protectedFiles = ["AGENTS.md", ".gitignore", ".aidn/config.json", ".codex/config.toml", ".codex/hooks.json", ".agents/skills/aidn/SKILL.md"],
    protectedView = () => protectedFiles.map(name => ({ path: name, sha256: fs.existsSync(path.join(root, name)) ? artifactContentHash(fs.readFileSync(path.join(root, name))) : null })),
    configurationBefore = protectedView(), productBefore = git("ls-tree", "-r", "HEAD", "--", "fixture-product.txt");
  const checkpointExpected = preview.prepared.plan.git.files.length > 0;
  if (selectCurrent) assert.equal(checkpointExpected, false);
  else if (mode !== "db-only") assert.equal(checkpointExpected, true);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock, { allowed: false });
  await assert.rejects(host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
  assert.equal(git("rev-parse", "HEAD"), beforeHead); assert.equal(artifactContentHash(fs.readFileSync(index)), indexBefore); assert.deepEqual(canonical(), canonicalBefore);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), id = staged.operation_id,
    prepared = host.readJournal(id).preview.prepared;
  let grantLive = true, sourceReads = 0;
  const boundary = createStandardCycleEntrySelectedCheckpoint({ targetRoot: root, scope: operations.observeScope,
    readCurrent: () => host.inspect("choice-record").record,
    readActivation: async () => { sourceReads++; grantLive = false; return activationSource; } });
  await assert.rejects(boundary.apply(host.inspect("choice-record").record, prepared, { write: true, expectPlan: prepared.plan_sha256,
    assertAuthorized: async () => { if (!grantLive) throw Object.assign(Error("FIXTURE_SELECTED_GRANT_REVOKED_LAST_SOURCE_AWAIT"), { code: "FIXTURE_SELECTED_GRANT_REVOKED_LAST_SOURCE_AWAIT" }); } }),
  { code: "FIXTURE_SELECTED_GRANT_REVOKED_LAST_SOURCE_AWAIT", effect_status: "no_effect" });
  assert.equal(sourceReads, 1); assert.equal(artifacts.ownerPending(), false); assert.equal(git("rev-parse", "HEAD"), beforeHead);
  assert.equal(artifactContentHash(fs.readFileSync(index)), indexBefore); assert.deepEqual(canonical(), canonicalBefore);
  pass(mode + ": missing grant and revocation in the last source await refuse without Git effect and release the unused owner");
  grantLive = true;
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock + 86400000,
    { allowed: () => fault !== "grant_after_ref" || git("rev-parse", "HEAD") === beforeHead });
  const originalRename = fs.renameSync; let injected = false, dispatched;
  if (fault === "index_ack") fs.renameSync = function (from, to) {
    const result = originalRename.apply(this, arguments);
    if (!injected && path.resolve(to) === index) { injected = true; throw Object.assign(Error("FIXTURE_SELECTED_INDEX_ACK_LOST"), { code: "FIXTURE_SELECTED_INDEX_ACK_LOST" }); }
    return result;
  };
  try { dispatched = await host.dispatch(id, { write: true }); }
  finally { fs.renameSync = originalRename; }
  const journal = host.readJournal(id), output = assertSelectedContextCheckpointOutput(journal.results.at(-1).output),
    raw = { ...prepared.plan.git, operation_id: id, prepared_at_ms: prepared.plan.prepared_at_ms, plan_sha256: prepared.plan_sha256 };
  createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
  assert.deepEqual(canonical(), canonicalBefore); assert.deepEqual(protectedView(), configurationBefore);
  assert.equal(git("ls-tree", "-r", "HEAD", "--", "fixture-product.txt"), productBefore);
  for (const [ref, head] of beforeRefs) if (ref !== "refs/heads/" + selectedBranch) assert.equal(refs().get(ref), head);
  if (mode === "db-only") for (const name of ["sessions/S002.md", "cycles/C003-feature-choice/status.md"])
    assert.equal(fs.existsSync(path.join(root, "docs/audit", name)), false);
  if (fault) {
    if (fault === "index_ack") assert.equal(injected, true);
    assert.equal(dispatched.receipt.effect_status, "unknown"); assert.equal(output.outcome, "reconciliation_required");
    assert.deepEqual(output.facts, {}); assert.equal(artifacts.ownerPending(), true); assert.notEqual(git("rev-parse", "HEAD"), beforeHead);
    const physical = createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-context", approvedPaths: prepared.plan.overlay_paths }).inspectCommit(raw);
    assert.equal(physical.status, fault === "grant_after_ref" ? "commit_observed" : "confirmed");
    if (fault === "grant_after_ref") { assert.equal(artifactContentHash(fs.readFileSync(index)), indexBefore); assert.equal(physical.index_reconciled, false); }
    const cold = JSON.parse(execFileSync(process.execPath, [script, "--inspect-selected", root, keyFile, sourcesFile, id, String(clock + 86400000)], { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
    assert.equal(cold.effect_status, "unknown"); assert.equal(cold.owner_pending, true); assert.equal(cold.journal_sha256, shadowHash(journal));
    assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
    const blocked = await boundary.prepare(host.inspect("choice-record").record, prepared.plan.input, "op_" + "b".repeat(40));
    assert.equal(blocked.can_apply, false); assert.equal(blocked.reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    console.log(JSON.stringify({ selected_checkpoint_scope: mode, root, private_root: f.privateRoot, operation_id: id, activation_operation_id: activationId,
      fault, signed_effect_status: "unknown", journal_sha256: shadowHash(journal), physical_status: physical.status, owner_retained: true,
      canonical_unchanged: true, product_preserved: true, phase_admission: "NOT_RUN", native_calls: 0 }));
    pass(mode + ": " + fault + " keeps signed UNKNOWN, owner and cold physical evidence without repeating the effect"); return;
  }
  assert.equal(dispatched.receipt.outcome, "completed", JSON.stringify(dispatched)); assert.equal(output.outcome, "completed");
  assert.equal(output.effect_status, checkpointExpected ? "confirmed" : "no_effect");
  assert.equal(output.facts.cycle_entry_selected_checkpoint_ready, true); assert.equal(output.facts.cycle_entry_resume_allowed, false);
  assert.equal(output.observations.canonical_adoption, false); assert.equal(output.observations.phase_admission, false); assert.equal(output.observations.implementation_authorized, false);
  assert.equal(git("rev-parse", "HEAD"), output.observations.selected_branch_head); assert.equal(git("status", "--porcelain"), "");
  const cold = JSON.parse(execFileSync(process.execPath, [script, "--accept-selected", root, keyFile, sourcesFile, id, String(clock + 86400000)], { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
  const final = host.inspect("choice-record"); assert.equal(final.cursor.status, "COMPLETED"); assert.equal(final.record.instance_sha256, cold.instance_sha256);
  assert.equal(artifacts.ownerPending(), false); assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
  await host.accept(id, { write: true }); assert.equal(host.inspect("choice-record").record.instance_sha256, final.record.instance_sha256);
  let last, rows = 0; for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id, model: final.record.model,
    policyPins: final.record.policy_pins, events: final.record.events })) { last = row; rows++; }
  assert.equal(last.instance_sha256, final.record.instance_sha256); assert.equal(rows, final.record.events.length + 1); assert.deepEqual(canonical(), canonicalBefore);
  console.log(JSON.stringify({ selected_checkpoint_scope: mode, root, private_root: f.privateRoot, operation_id: id, activation_operation_id: activationId,
    journal_sha256: shadowHash(journal), instance_sha256: final.record.instance_sha256, selected_branch: selectedBranch,
    previous_head: beforeHead, selected_head: output.observations.selected_branch_head, selected_current: selectCurrent,
    committed_paths: output.observations.committed_paths, canonical_unchanged: true, product_preserved: true, protected_configuration_unchanged: true,
    DBonly_no_detailed_export: mode === "db-only", exact_replay: true, cold_acceptance: true, host_preparation_age_ceiling: "NONE",
    H_and_grants: "CONTROLLED_FIXTURE", phase_setup: "STAGED_METADATA_NOT_PRIOR_WORK_PROOF", phase_admission: "NOT_RUN", native_calls: 0, published_root: "NOT_CONNECTED" }));
  pass(mode + ": accepted activation drives an exact context checkpoint/no-change with canonical preservation, cold ACK and exact replay");
}
if (["--accept-record", "--accept-selected", "--inspect-selected"].includes(process.argv[2])) {
  const [, , , root, keyFile, sourcesFile, operationId, clock] = process.argv;
  console.log(JSON.stringify(await acceptRecordedChoice({ root, keyFile, sourcesFile, operationId, clock: Number(clock), inspectOnly: process.argv[2] === "--inspect-selected" })));
} else {
  const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7), selectCurrent = process.argv.includes("--select-current"),
    fault = process.argv.find(arg => arg.startsWith("--fault="))?.slice(8) ?? null;
  if (!process.argv.includes("--contracts-only") && !["files", "dual", "db-only"].includes(mode)
    || mode && process.argv.includes("--contracts-only") || selectCurrent && mode !== "files"
    || fault && (mode !== "files" || selectCurrent || !["grant_after_ref", "index_ack"].includes(fault))) throw Error("SELECTED_CONTEXT_FIXTURE_SCOPE_INVALID");
  contracts();
  if (mode) await verifyCanonicalCycleChoiceRecord(mode, { childScript: script, pass, checkpoint: true, activation: true, selectedCheckpoint: true,
    selectedCycleId: selectCurrent ? "C002" : "C001", afterRecordedChoice: f => activationCase(f, { pass, selectCurrent, nextNode: "selected_checkpoint",
      afterActivation: f => selectedCase(f, { fault, selectCurrent }) }) });
  console.log(JSON.stringify({ status: "PASS", checks, scope: mode ? "ACTUAL_SELECTED_CONTEXT_COMMON_HOST_COMPONENT" : "CLOSED_SELECTED_CONTEXT_CONTRACTS",
    native_calls: 0, canonical_focus: "NOT_EXECUTED", phase_admission: "NOT_RUN", full_standard: false }));
}
