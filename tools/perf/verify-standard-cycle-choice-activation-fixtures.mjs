import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { assertCycleChoiceActivationOutput, cycleChoiceActivationSource } from "../../src/core/workflow/standard-cycle-entry-choice-activation.mjs";
import { createStandardCycleEntryChoiceActivation } from "../../src/application/runtime/standard-cycle-entry-choice-activation.mjs";
import { createLocalWorkflowCycleActivation } from "../../src/adapters/runtime/local-workflow-cycle-activation.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { verifyCanonicalCycleChoiceRecord, acceptRecordedChoice, openCycleChoiceFixtureHost } from "./standard-cycle-choice-record-fixture-lib.mjs";

let checks = 0;
const pass = name => { checks++; console.log("PASS " + name); }, script = fileURLToPath(import.meta.url);
function contracts() {
  for (const kind of ["input", "plan", "output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-cycle-entry-choice-activation-${kind}.v1.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const input = { contract_version: "standard-cycle-entry-choice-activation-input.v1", checkpoint_operation_id: "op_" + "a".repeat(40) };
  assertStandardOperationInput("cycle_entry_choice_activate", input);
  assert.throws(() => assertStandardOperationInput("cycle_entry_choice_activate", { ...input, selected_branch: "caller-selected" }));
  assert.throws(() => assertStandardOperationInput("cycle_entry_choice_activate", { ...input, approved: true }));
  pass("activation contracts accept only the checkpoint identity and never a caller-selected branch or permission");
}
export async function activationCase(f, { fault = null, selectCurrent = false, nextNode = null, afterActivation = null, pass: reportPass = pass } = {}) {
  const { root, mode, keyFile, sourcesFile, clock, artifacts, operations, git, heads, canonical } = f;
  let host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const next = async node => {
    const state = host.inspect("choice-record"), occurrenceId = state.cursor.ready[0];
    assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId).node_id, node);
    const preview = await host.preview({ instanceId: "choice-record", expectedSha256: state.record.instance_sha256, occurrenceId });
    assert.equal(preview.prepared.can_apply, true, JSON.stringify(preview.prepared)); return preview;
  };
  const checkpointPreview = await next("checkpoint"), checkpoint = await host.stage(checkpointPreview, { write: true, expectedPreviewSha256: shadowHash(checkpointPreview) });
  const checkpointResult = await host.dispatch(checkpoint.operation_id, { write: true });
  assert.equal(checkpointResult.receipt.outcome, "completed"); await host.accept(checkpoint.operation_id, { write: true });
  const checkpointJournal = host.readJournal(checkpoint.operation_id), recordJournal = host.readJournal(f.recordId),
    source = { checkpoint_operation_id: checkpoint.operation_id, checkpoint_sha256: shadowHash(checkpointJournal),
      checkpoint_plan: checkpointJournal.preview.prepared.plan, checkpoint_output: checkpointJournal.results.at(-1).output,
      record: { record_operation_id: f.recordId, record_sha256: shadowHash(recordJournal), plan: recordJournal.preview.prepared.plan,
        output: recordJournal.results.at(-1).output } },
    input = { contract_version: "standard-cycle-entry-choice-activation-input.v1", checkpoint_operation_id: checkpoint.operation_id },
    descriptor = cycleChoiceActivationSource(source, input), before = canonical(), beforeRefs = heads(),
    oldHead = git("rev-parse", "HEAD"), oldBranch = git("branch", "--show-current"), selectedHead = git("rev-parse", descriptor.selected_branch),
    protectedPaths = ["AGENTS.md", ".gitignore", ".aidn/config.json", ".codex/config.toml", ".codex/hooks.json", ".agents/skills/aidn/SKILL.md"],
    protectedHashes = () => protectedPaths.map(name => ({ path: name,
      sha256: fs.existsSync(path.join(root, name)) ? artifactContentHash(fs.readFileSync(path.join(root, name))) : null })),
    beforeProtected = protectedHashes(), indexFile = path.resolve(root, git("rev-parse", "--git-path", "index")),
    beforeIndex = artifactContentHash(fs.readFileSync(indexFile)), product = path.join(root, "fixture-product.txt");
  assert.equal(descriptor.source_head, oldHead); assert.equal(descriptor.selected_branch_head, selectedHead);
  if (!selectCurrent) assert.notEqual(oldHead, selectedHead);
  const preview = await next("activate");
  assert.equal(preview.prepared.plan.selected_branch, descriptor.selected_branch);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock, { allowed: false });
  await assert.rejects(host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
  assert.equal(git("rev-parse", "HEAD"), oldHead); assert.equal(heads(), beforeRefs); assert.deepEqual(canonical(), before);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), id = staged.operation_id,
    prepared = host.readJournal(id).preview.prepared;
  let grantLive = true, sourceReads = 0;
  const boundary = createStandardCycleEntryChoiceActivation({ targetRoot: root, scope: operations.observeScope,
    readCurrent: () => host.inspect("choice-record").record,
    readCheckpoint: async () => { sourceReads++; grantLive = false; return source; } });
  await assert.rejects(boundary.apply(host.inspect("choice-record").record, prepared, { write: true, expectPlan: prepared.plan_sha256,
    assertAuthorized: async () => { if (!grantLive) throw Object.assign(Error("FIXTURE_ACTIVATION_GRANT_REVOKED_LAST_SOURCE_AWAIT"),
      { code: "FIXTURE_ACTIVATION_GRANT_REVOKED_LAST_SOURCE_AWAIT" }); } }),
  { code: "FIXTURE_ACTIVATION_GRANT_REVOKED_LAST_SOURCE_AWAIT", effect_status: "no_effect" });
  assert.equal(sourceReads, 1); assert.equal(artifacts.ownerPending(), false); assert.equal(heads(), beforeRefs);
  assert.equal(artifactContentHash(fs.readFileSync(indexFile)), beforeIndex); assert.deepEqual(canonical(), before);
  reportPass(mode + ": missing exact grant and revocation during the last source await refuse before physical effects");
  grantLive = true;
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock + 86400000, { allowed: () => grantLive });
  const originalRename = fs.renameSync, originalUnlink = fs.unlinkSync;
  let injected = false, dispatched;
  if (fault === "index_ack" || fault === "grant_after_index") fs.renameSync = function (from, to) {
    const result = originalRename.apply(this, arguments);
    if (!injected && path.resolve(to) === indexFile) {
      injected = true;
      if (fault === "grant_after_index") grantLive = false;
      else throw Object.assign(Error("FIXTURE_ACTIVATION_INDEX_ACK_LOST"), { code: "FIXTURE_ACTIVATION_INDEX_ACK_LOST" });
    }
    return result;
  };
  if (fault === "product_ack") fs.unlinkSync = function (file) {
    const result = originalUnlink.apply(this, arguments);
    if (!injected && path.resolve(file) === product) { injected = true; throw Object.assign(Error("FIXTURE_ACTIVATION_PRODUCT_ACK_LOST"), { code: "FIXTURE_ACTIVATION_PRODUCT_ACK_LOST" }); }
    return result;
  };
  try { dispatched = await host.dispatch(id, { write: true }); }
  finally { fs.renameSync = originalRename; fs.unlinkSync = originalUnlink; }
  const journal = host.readJournal(id), output = assertCycleChoiceActivationOutput(journal.results.at(-1).output);
  createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
  assert.equal(heads(), beforeRefs); assert.deepEqual(protectedHashes(), beforeProtected); assert.deepEqual(canonical(), before);
  if (fault) {
    assert.equal(injected, true); assert.equal(dispatched.receipt.effect_status, "unknown"); assert.equal(output.outcome, "reconciliation_required");
    assert.deepEqual(output.facts, {}); assert.equal(artifacts.ownerPending(), true);
    const physical = createLocalWorkflowCycleActivation({ targetRoot: root }).inspectActivation({ operation_id: id, plan_sha256: prepared.plan_sha256, observed: prepared.plan.git.observed });
    assert.equal(physical.status, fault === "product_ack" ? "not_confirmed" : "confirmed");
    assert.equal(git("rev-parse", "HEAD"), fault === "product_ack" ? oldHead : selectedHead);
    const cold = JSON.parse(execFileSync(process.execPath, [script, "--inspect-activation", root, keyFile, sourcesFile, id, String(clock + 86400000)],
      { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
    assert.equal(cold.effect_status, "unknown"); assert.equal(cold.owner_pending, true); assert.equal(cold.journal_sha256, shadowHash(journal));
    assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
    console.log(JSON.stringify({ activation_scope: mode, root, private_root: f.privateRoot, operation_id: id, fault,
      signed_effect_status: "unknown", journal_sha256: shadowHash(journal), physical_status: physical.status,
      owner_retained: true, canonical_unchanged: true, native_calls: 0, canonical_adoption: "NOT_EXECUTED", phase_admission: "NOT_RUN" }));
    reportPass(mode + ": physical " + fault + " retains a signed UNKNOWN and owner across cold read without replay"); return;
  }
  assert.equal(dispatched.receipt.outcome, "completed", JSON.stringify(dispatched)); assert.equal(output.outcome, "completed");
  assert.equal(output.effect_status, selectCurrent ? "no_effect" : "confirmed");
  assert.deepEqual(output.facts, { cycle_entry_choice_activation_ready: true, cycle_entry_resume_allowed: false });
  assert.equal(output.observations.implementation_authorized, false); assert.equal(output.observations.canonical_adoption, false);
  assert.equal(git("branch", "--show-current"), descriptor.selected_branch); assert.equal(git("rev-parse", "HEAD"), selectedHead);
  if (!selectCurrent) assert.ok(prepared.plan.git.observed.changes.length > 0);
  const selectedProduct = git("ls-tree", "--name-only", selectedHead, "--", "fixture-product.txt");
  if (!selectedProduct) assert.equal(fs.existsSync(product), false);
  else assert.equal(git("hash-object", "--no-filters", "--", "fixture-product.txt"), git("rev-parse", selectedHead + ":fixture-product.txt"));
  const cold = JSON.parse(execFileSync(process.execPath, [script, "--accept-activation", root, keyFile, sourcesFile, id, String(clock + 86400000)],
    { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
  const final = host.inspect("choice-record"); assert.equal(final.cursor.status, nextNode ? "RUNNING" : "COMPLETED");
  if (nextNode) assert.deepEqual(final.cursor.ready.map(occ => final.cursor.occurrences.find(row => row.occurrence_id === occ).node_id), [nextNode]); assert.equal(final.record.instance_sha256, cold.instance_sha256);
  assert.equal(artifacts.ownerPending(), false); assert.equal((await host.dispatch(id, { write: true })).status, "retained_result");
  await host.accept(id, { write: true }); assert.equal(host.inspect("choice-record").record.instance_sha256, final.record.instance_sha256);
  let last, rows = 0;
  for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id, model: final.record.model,
    policyPins: final.record.policy_pins, events: final.record.events })) { last = row; rows++; }
  assert.equal(last.instance_sha256, final.record.instance_sha256); assert.equal(rows, final.record.events.length + 1);
  assert.deepEqual(canonical(), before); assert.deepEqual(protectedHashes(), beforeProtected); assert.equal(heads(), beforeRefs);
  console.log(JSON.stringify({ activation_scope: mode, root, private_root: f.privateRoot, operation_id: id, checkpoint_operation_id: checkpoint.operation_id,
    journal_sha256: shadowHash(journal), instance_sha256: final.record.instance_sha256, source_branch: oldBranch, source_head: oldHead,
    selected_branch: descriptor.selected_branch, selected_head: selectedHead, selected_current_branch: selectCurrent, signed_effect_status: output.effect_status,
    actual_different_HEAD_and_product: !selectCurrent, canonical_unchanged: true, protected_configuration_unchanged: true,
    exact_replay: true, cold_acceptance: true, host_preparation_age_ceiling: "NONE", native_calls: 0,
    canonical_adoption: "NOT_EXECUTED", phase_admission: "NOT_RUN", human_source: "CONTROLLED_FIXTURE", published_root: "NOT_CONNECTED" }));
  reportPass(mode + ": accepted H/record/checkpoint source drives actual physical activation or no-change with cold ACK and exact replay");
  if (afterActivation) await afterActivation({ ...f, host, clock: clock + 86400000, activationId: id,
    activationSource: { activation_operation_id: id, activation_sha256: shadowHash(journal), plan: prepared.plan, output, checkpoint: source } });
}
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
if (["--accept-record", "--accept-activation", "--inspect-activation"].includes(process.argv[2])) {
  const [, , , root, keyFile, sourcesFile, operationId, clock] = process.argv;
  console.log(JSON.stringify(await acceptRecordedChoice({ root, keyFile, sourcesFile, operationId, clock: Number(clock), inspectOnly: process.argv[2] === "--inspect-activation" })));
} else {
  const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7), selectCurrent = process.argv.includes("--select-current"),
    fault = process.argv.find(arg => arg.startsWith("--fault="))?.slice(8) ?? null;
  if (!process.argv.includes("--contracts-only") && !["files", "dual", "db-only"].includes(mode)
    || mode && process.argv.includes("--contracts-only") || fault && (mode !== "files" || selectCurrent || !["index_ack", "grant_after_index", "product_ack"].includes(fault)))
    throw Error("CHOICE_ACTIVATION_FIXTURE_SCOPE_INVALID");
  contracts();
  if (mode) await verifyCanonicalCycleChoiceRecord(mode, { childScript: script, pass, checkpoint: true, activation: true,
    selectedCycleId: selectCurrent ? "C002" : "C001", afterRecordedChoice: f => activationCase(f, { fault, selectCurrent }) });
  console.log(JSON.stringify({ status: "PASS", checks, scope: mode ? "actual-choice-activation-common-host-component" : "closed-activation-contracts",
    native_calls: 0, canonical_adoption: "NOT_EXECUTED", phase_admission: "NOT_RUN", continuity_R1_R2_R3: "NOT_RUN", full_standard: false }));
}
}
