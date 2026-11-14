import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { arrangeCanonicalResumeData } from "./standard-canonical-resume-fixture-lib.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyCanonicalCycleChoiceRecord, openCycleChoiceFixtureHost, acceptRecordedChoice } from "./standard-cycle-choice-record-fixture-lib.mjs";
import { activationCase } from "./verify-standard-cycle-choice-activation-fixtures.mjs";
import { selectedCase } from "./verify-standard-selected-context-checkpoint-fixtures.mjs";
import { focusCase } from "./verify-standard-selected-focus-fixtures.mjs";
import { taskProgressValidationProfile } from "./cycle-task-progress-fixture-lib.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { assertCanonicalResumeOutput, assertCanonicalResumeObserveOutput } from "../../src/core/workflow/standard-canonical-cycle-resume.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { artifactContentHash, artifactMetadataHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
const script = fileURLToPath(import.meta.url);
let checks = 0;
const pass = text => { checks++; console.log("PASS " + text); };

function contracts() {
  for (const name of ["input", "output", "observe-input", "observe-output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-canonical-cycle-resume-" + name + ".v1.schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const operationId = "op_" + "a".repeat(40);
  const readiness = { contract_version: "standard-cycle-readiness-output.v1", operation_ref: "cycle_readiness_evaluate", outcome: "completed", effect_status: "no_effect", facts: { cycle_readiness_satisfied: true }, observations: { record_operation_id: operationId, record_sha256: "b".repeat(64), planning_source: { kind: "canonical_progress", operation_id: operationId, output_sha256: "b".repeat(64) } }, evidence_refs: [] };
  for (const kind of ["canonical_plan", "canonical_progress"]) assertStandardOperationOutput({ ...readiness, observations: { ...readiness.observations, planning_source: { ...readiness.observations.planning_source, kind } } });
  for (const change of [{ kind: "authored" }, { kind: "native_work" }, { kind: null }, { operation_id: "op_" + "c".repeat(40) }, { output_sha256: "d".repeat(64) }, { approved: true }]) assert.throws(() => assertStandardOperationOutput({ ...readiness, observations: { ...readiness.observations, planning_source: { ...readiness.observations.planning_source, ...change } } }), error => error.code === "STANDARD_OPERATION_OUTPUT_INVALID");
  assert.throws(() => assertStandardOperationOutput({ ...readiness, operation_ref: "cycle_implementation_enter" }), error => error.code === "STANDARD_OPERATION_OUTPUT_INVALID");
  pass("readiness accepts only linked canonical plan or progress origins; foreign kind, identity, hash, permission and effect origins refuse");
  for (const [binding, key] of [["cycle_canonical_resume_admit", "focus_checkpoint_operation_id"], ["cycle_canonical_resume_observe", "implementation_operation_id"]]) {
    assertStandardOperationInput(binding, { [key]: operationId });
    for (const extra of [{ paths: ["product/app.mjs"] }, { phase: "VERIFYING" }, { approved: true }, { principal: "operator" },
      { observer: "authored" }, { continuity_action: "import_now" }, { work_intent: "continue_implementation" }])
      assert.throws(() => assertStandardOperationInput(binding, { [key]: operationId, ...extra }));
    assert.throws(() => assertStandardOperationInput(binding, { [key]: "not-an-operation" }));
  }
  pass("closed canonical resume contracts take accepted operation identities only; no authored path, phase, intent, observer or permission");
}

async function arrange(f, { withChecks }) {
  const { root, privateRoot, checkpoint } = f;
  await arrangeCanonicalResumeData(f);
  fs.mkdirSync(path.join(root, "product")); fs.writeFileSync(path.join(root, "product/app.mjs"), "export const value = 3;\n");
  const modelFile = path.join(privateRoot, "fixture-model.json"), model = JSON.parse(fs.readFileSync(modelFile));
  model.model_id = "canonical-resume-port-fixture";
  model.nodes[0].children.push("resume", "observe_product");
  model.nodes.push({ id: "resume", kind: "operation", participant_ref: "project", binding_ref: "cycle_canonical_resume_admit" },
    { id: "observe_product", kind: "operation", participant_ref: "project", binding_ref: "cycle_canonical_resume_observe" });
  model.data_bindings.inputs.push({ node_id: "resume", fields: { focus_checkpoint_operation_id: { source: "operation_id", node_id: "focus_checkpoint" } } },
    { node_id: "observe_product", fields: { implementation_operation_id: { source: "operation_id", node_id: "resume" } } });
  if (withChecks) {
    const extra = [["validate", "cycle_validation_execute", "work_operation_id", "observe_product"],
      ["validation_evaluate", "cycle_validation_evaluate", "validation_operation_id", "validate"],
      ["verification_enter", "cycle_verification_enter", "evaluation_operation_id", "validation_evaluate"],
      ["audit_select", "cycle_audit_select", "implementation_operation_id", "resume"]];
    for (const [id, binding_ref, field, source] of extra) {
      model.nodes[0].children.push(id); model.nodes.push({ id, kind: "operation", participant_ref: "project", binding_ref });
      model.data_bindings.inputs.push({ node_id: id, fields: { [field]: { source: "operation_id", node_id: source } } });
    }
  }
  model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(row => model.nodes.some(node => node.binding_ref === row.id)).map(row => [row.id, shadowHash(row)]));
  fs.writeFileSync(modelFile, JSON.stringify(model));
  const verifier = withChecks ? taskProgressValidationProfile(privateRoot, false) : null;
  fs.writeFileSync(path.join(privateRoot, "fixture-process.json"), JSON.stringify({ ...(verifier ? { validation_profile: verifier.profileRef } : {}), target_root: root, instance_id: "choice-record",
    product_root: path.join(root, "product"), product_files: ["app.mjs"], control_root: path.join(privateRoot, "control"),
    review_root: path.join(privateRoot, "review"), activity_outputs: {}, native: { home: path.join(privateRoot, "native"), protected_roots: [] } }));
  checkpoint("fixture canonical progress data and isolated approved product before selected branch");
}
async function resumedCase(f, { withChecks, withGuards }) {
  const { root, mode, keyFile, sourcesFile, clock, artifacts, canonical, git, heads } = f;
  const metadataFor = names => {
    const selected = artifacts.describe();
    if (!selected.database) return null;
    const store = createProjectArtifactStore({ targetRoot: root, readOnly: true, existingOnly: true });
    try {
      const rows = names.map(name => {
        const row = store.getArtifact(name); assert.ok(row, name);
        const metadata = Object.fromEntries(["kind", "family", "subtype", "gate_relevance", "classification_reason", "session_id", "cycle_id",
          "source_mode", "entity_confidence", "legacy_origin", "updated_at"].map(key => [key, row[key] ?? null]));
        assert.equal(artifactMetadataHash(metadata), artifacts.metadataHash(name));
        return { path: name, metadata, metadata_sha256: artifactMetadataHash(metadata) };
      });
      assert.equal(shadowHash(selected), shadowHash(artifacts.describe())); return rows;
    } finally { store.close(); }
  };
  let host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const coldAccept = (id, at = clock) => JSON.parse(execFileSync(process.execPath,
    [script, "--accept-record", root, keyFile, sourcesFile, id, String(at)], { encoding: "utf8", stdio: "pipe", windowsHide: true }));
  const next = async node => {
    const state = host.inspect("choice-record"), occurrenceId = state.cursor.ready[0];
    assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId).node_id, node);
    return host.preview({ instanceId: "choice-record", expectedSha256: state.record.instance_sha256, occurrenceId });
  };
  const execute = async preview => {
    const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), result = await host.dispatch(staged.operation_id, { write: true });
    assert.equal(result.receipt.outcome, "completed", JSON.stringify(result));
    const journal = host.readJournal(staged.operation_id); createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
    const cold = coldAccept(staged.operation_id); host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
    assert.equal(host.inspect("choice-record").record.instance_sha256, cold.instance_sha256);
    const hash = shadowHash(journal), instanceHash = cold.instance_sha256;
    assert.equal((await host.dispatch(staged.operation_id, { write: true })).status, "retained_result");
    await host.accept(staged.operation_id, { write: true });
    assert.equal(shadowHash(host.readJournal(staged.operation_id)), hash); assert.equal(host.inspect("choice-record").record.instance_sha256, instanceHash);
    return journal;
  };
  const canonicalBefore = canonical(), beforeRefs = heads(), checkpoint = await execute(await next("focus_checkpoint"));
  assert.equal(checkpoint.results.at(-1).output.facts.cycle_entry_focus_checkpoint_ready, true);
  assert.deepEqual(canonical(), canonicalBefore); assert.equal(artifacts.ownerPending(), false); assert.equal(git("status", "--porcelain"), "");
  const witness = () => ({ canonical: canonical(), refs: heads(), branch: git("branch", "--show-current"), head: git("rev-parse", "HEAD"),
    index: artifactContentHash(fs.readFileSync(path.resolve(root, git("rev-parse", "--git-path", "index")))),
    product: artifactContentHash(fs.readFileSync(path.join(root, "product/app.mjs"))) }), before = witness(),
    tracePath = "cycles/C001-feature-choice/traceability.md", traceBefore = artifacts.read(tracePath, { required: true });
  if (withGuards) {
    assert.equal(mode, "files");
    const refusals = [], journalDirectory = path.join(root, "docs/audit/workflows/operation-records"),
      journalNames = () => fs.readdirSync(journalDirectory).sort(),
      instanceBefore = host.inspect("choice-record").record.instance_sha256, journalsBefore = journalNames(),
      unchanged = () => { assert.deepEqual(witness(), before); assert.equal(host.inspect("choice-record").record.instance_sha256, instanceBefore); assert.deepEqual(journalNames(), journalsBefore); };
    const refuse = async (name, call, expected) => {
      let observed;
      await assert.rejects(call, error => {
        observed = error.code ?? error.message;
        return expected instanceof RegExp ? expected.test(observed) : observed === expected;
      });
      refusals.push({ case: name, reason_code: observed });
    };
    const sourceBytes = fs.readFileSync(sourcesFile), sources = JSON.parse(sourceBytes);
    sources[Object.keys(sources)[0]].fixture_source_tamper = true;
    try {
      fs.writeFileSync(sourcesFile, JSON.stringify(sources));
      await refuse("changed authenticated H source", () => next("resume"), /SOURCE|HUMAN|CHECKPOINT|FOCUS/);
    } finally { fs.writeFileSync(sourcesFile, sourceBytes); }
    unchanged();
    const currentFile = path.join(root, "docs/audit/CURRENT-STATE.md"), currentBytes = fs.readFileSync(currentFile);
    try {
      fs.writeFileSync(currentFile, Buffer.concat([currentBytes, Buffer.from("\nfixture_context_tamper: true\n")]));
      await refuse("changed canonical context", () => next("resume"), /SOURCE|CHECKPOINT|FOCUS|CONTEXT/);
    } finally { fs.writeFileSync(currentFile, currentBytes); }
    unchanged();
    await artifacts.withLocalEffectOwner(shadowHash({ fixture: "canonical-resume-foreign-owner" }), async () => {
      assert.equal(artifacts.ownerPending(), true);
      await refuse("foreign pending effect owner", () => next("resume"), "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
      unchanged();
      return { effect_status: "confirmed" };
    });
    assert.equal(artifacts.ownerPending(), false); unchanged();
    const state = host.inspect("choice-record"), occurrenceId = state.cursor.ready[0];
    await refuse("changed process revision", () => host.preview({ instanceId: "choice-record", expectedSha256: "0".repeat(64), occurrenceId }), "PROCESS_REVISION_CONFLICT");
    unchanged();
    fs.writeFileSync(path.join(f.privateRoot, "canonical-resume-guard-refusals.json"),
      JSON.stringify({ status: "PASS", refusals, canonical_Git_product_and_instance_unchanged: true, no_operation_staged: true, owner_pending: false, Native: 0 }, null, 2) + "\n", { flag: "wx" });
    pass("files: actual resume preview refuses changed H source, canonical context, foreign pending owner and process revision before staging or Native");
  }
  const preview = await next("resume");
  assert.equal(preview.prepared.observations.readiness_satisfied, true);
  host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock, { allowed: false });
  // Read-only phase admission has no effect grant; write permission stays false.
  assert.deepEqual(witness(), before); assert.equal(artifacts.ownerPending(), false);
  const resumed = await execute(preview), output = assertCanonicalResumeOutput(resumed.results.at(-1).output);
  assert.equal(resumed.grant, null);
  assert.equal(output.facts.cycle_resume_phase_admitted, true); assert.equal(output.observations.canonical_phase, "VERIFYING");
  assert.equal(output.observations.continuity_action, "import_now"); assert.equal(output.observations.work_intent, "continue_implementation");
  assert.deepEqual(output.observations.imported_completed_task_ids, ["TASK-001", "TASK-002"]);
  assert.equal(output.observations.retained_verification_history.current_validation_evidence, false);
  assert.equal(output.observations.retained_verification_history.raw_section, traceBefore.content.slice(traceBefore.content.indexOf("\n\n## Process verification evidence\n\n")));
  for (const key of ["implementation_authorized", "current_validation_evidence", "current_native_work_evidence"]) assert.equal(output.observations[key], false);
  assert.equal(output.effect_status, "no_effect"); assert.deepEqual(witness(), before);
  pass(mode + ": fresh real process authority admits actual selected VERIFYING phase and canonical ordered prefix without canonical/product writes or Native work claims");
  const observed = await execute(await next("observe_product")), observedOutput = assertCanonicalResumeObserveOutput(observed.results.at(-1).output);
  assert.deepEqual(observedOutput.observations.imported_completed_task_ids, ["TASK-001", "TASK-002"]);
  assert.deepEqual(observedOutput.observations.current_observed_task_ids, []); assert.equal(observedOutput.observations.work_complete, true);
  assert.equal(observedOutput.observations.current_native_work_evidence, false); assert.equal(observedOutput.facts.cycle_work_observed, undefined);
  assert.deepEqual(witness(), before); assert.deepEqual(artifacts.read(tracePath), traceBefore); assert.equal(artifacts.ownerPending(), false);
  let checksExecution = null, verificationEntry = null, auditSelection = null;
  if (withChecks) {
    const callsFile = path.join(f.privateRoot, "validation-control/calls.jsonl"), calls = () => fs.readFileSync(callsFile, "utf8").trim().split(/\r?\n/).filter(Boolean).length;
    assert.equal(calls(), 0);
    checksExecution = await execute(await next("validate"));
    const machine = checksExecution.results.at(-1).output;
    assert.equal(machine.observations.proof_class, "fixture"); assert.equal(machine.facts.cycle_validation_passed, true);
    assert.deepEqual(machine.observations.checks.map(row => ({ test_ref: row.test_ref, status: row.status })),
      [{ test_ref: "TEST-001", status: "passed" }, { test_ref: "TEST-002", status: "passed" }]);
    assert.equal(calls(), 2); assert.deepEqual(witness(), before); assert.equal(artifacts.ownerPending(), false);
    const evaluation = await execute(await next("validation_evaluate")), evaluated = evaluation.results.at(-1).output;
    assert.equal(evaluated.facts.cycle_work_complete, true); assert.equal(evaluated.facts.cycle_checks_passed, true);
    assert.deepEqual(evaluated.observations.observed_task_ids, []); assert.deepEqual(evaluated.observations.imported_task_ids, ["TASK-001", "TASK-002"]);
    assert.equal(evaluated.observations.canonical_resume_source.operation_id, resumed.operation_id);
    assert.equal(calls(), 2); assert.deepEqual(witness(), before);
    const verificationPreview = await next("verification_enter");
    assert.equal(verificationPreview.prepared.can_apply, true, JSON.stringify(verificationPreview.prepared));
    assert.equal(verificationPreview.prepared.plan.changes.length, 4);
    const changedNames = verificationPreview.prepared.plan.changes.map(row => row.path), metadataBefore = metadataFor(changedNames);
    assert.deepEqual(canonical(), before.canonical);
    if (metadataBefore) for (const row of metadataBefore) assert.equal(row.metadata_sha256, verificationPreview.prepared.plan.changes.find(change => change.path === row.path).before_metadata_sha256);
    fs.writeFileSync(path.join(f.privateRoot, "canonical-resume-verification-before.json"), JSON.stringify({ witness: before, metadata: metadataBefore, trace_path: tracePath, trace_content: traceBefore.content }, null, 2) + "\n", { flag: "wx" });
    verificationEntry = await execute(verificationPreview);
    assert.equal(verificationEntry.results.at(-1).output.effect_status, "confirmed"); assert.equal(artifacts.ownerPending(), false);
    const traceAfter = artifacts.read(tracePath, { required: true });
    assert.equal(traceAfter.content.startsWith(traceBefore.content), true);
    assert.equal(traceAfter.content.split("\n\n## Process verification evidence\n\n").length, 3);
    assert.equal(artifactContentHash(fs.readFileSync(path.join(root, "product/app.mjs"))), before.product);
    assert.equal(git("rev-parse", "HEAD"), before.head); assert.equal(heads(), before.refs); assert.equal(calls(), 2);
    const canonicalAfter = canonical(), oldCanonical = new Map(before.canonical.map(row => [row.path, row]));
    assert.deepEqual(canonicalAfter.map(row => row.path), before.canonical.map(row => row.path));
    assert.deepEqual(canonicalAfter.filter(row => shadowHash(row) !== shadowHash(oldCanonical.get(row.path))).map(row => row.path).sort(), [...changedNames].sort());
    const metadataAfter = metadataFor(changedNames);
    if (metadataBefore === null) assert.equal(metadataAfter, null);
    else {
      assert.equal(metadataAfter.length, metadataBefore.length);
      for (const [index, row] of metadataBefore.entries()) {
        const after = metadataAfter[index]; assert.equal(after.path, row.path);
        const { updated_at: oldUpdated, ...oldClassification } = row.metadata,
          { updated_at: newUpdated, ...newClassification } = after.metadata;
        assert.deepEqual(newClassification, oldClassification); assert.notEqual(newUpdated, oldUpdated);
        assert.equal(Number.isFinite(Date.parse(newUpdated)), true);
      }
    }
    fs.writeFileSync(path.join(f.privateRoot, "canonical-resume-verification-after.json"), JSON.stringify({ witness: witness(), metadata: metadataAfter,
      changed_paths: changedNames, verification_operation_id: verificationEntry.operation_id, exact_old_trace_prefix: true }, null, 2) + "\n", { flag: "wx" });
    auditSelection = await execute(await next("audit_select"));
    const audit = auditSelection.results.at(-1).output;
    assert.equal(audit.facts.cycle_audit_source_selected, true); assert.equal(audit.observations.verification_operation_id, verificationEntry.operation_id);
    assert.equal(audit.observations.validation.proof_class, "fixture"); assert.equal(audit.observations.validation.checks_passed, true);
    assert.equal(audit.observations.validation.validation_operation_id, checksExecution.operation_id);
    assert.equal(calls(), 2); assert.equal(artifacts.ownerPending(), false);
    pass(mode + ": two actual registered checks, separate imported IDs, owned verification CAS preserving exact historical trace prefix and authenticated audit bridge");
  }
  const final = host.inspect("choice-record"); assert.equal(final.cursor.status, "COMPLETED");
  let last, count = 0; for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id,
    model: final.record.model, policyPins: final.record.policy_pins, events: final.record.events })) { last = row; count++; }
  assert.equal(last.instance_sha256, final.record.instance_sha256); assert.equal(count, final.record.events.length + 1);
  assert.equal(final.record.events.some(row => ["assign", "result"].includes(row.kind)), false);
  pass(mode + ": distinct current product snapshot uses accepted typed resume, cold ACK and exact replay without converting canonical history to Native evidence");
  console.log(JSON.stringify({ canonical_resume_scope: mode, root, private_root: f.privateRoot, resume_operation_id: resumed.operation_id,
    product_observation_operation_id: observed.operation_id, instance_sha256: final.record.instance_sha256,
    canonical_phase: "VERIFYING", imported_completed_task_ids: output.observations.imported_completed_task_ids, current_observed_task_ids: [],
    original_H_and_current_grants: "CONTROLLED_FIXTURE", canonical_history: "STAGED_DATA_NOT_PRIOR_WORK_VALIDATION_PROOF",
    actual_current_host_phase_admission: true, actual_current_product_snapshot: true, current_checks: checksExecution ? "TWO_ACTUAL_REGISTERED_NODE_CHECKS_PROOF_CLASS_FIXTURE" : "NOT_EXECUTED",
    validation_operation_id: checksExecution?.operation_id ?? null, verification_operation_id: verificationEntry?.operation_id ?? null, audit_selection_operation_id: auditSelection?.operation_id ?? null, Native: 0,
    exact_replay: true, cold_acceptance: true, canonical_metadata_and_history_preserved_before_fresh_verification: true, historical_trace_exact_prefix_after_verification: withChecks, full_standard: false }));
}
if (path.resolve(process.argv[1] ?? "") === script) {
  if (process.argv[2] === "--accept-record") {
    const [, , , root, keyFile, sourcesFile, operationId, clock] = process.argv;
    console.log(JSON.stringify(await acceptRecordedChoice({ root, keyFile, sourcesFile, operationId, clock: Number(clock) })));
  } else {
    const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7), withChecks = process.argv.includes("--checks"), withGuards = process.argv.includes("--guards"), contractsOnly = process.argv.includes("--contracts-only");
    if (!contractsOnly && !["files", "dual", "db-only"].includes(mode) || contractsOnly && (mode || withChecks || withGuards) || withGuards && mode !== "files") throw Error("CANONICAL_RESUME_FIXTURE_SCOPE_INVALID");
    contracts();
    if (mode) await verifyCanonicalCycleChoiceRecord(mode, { childScript: script, pass, checkpoint: true, activation: true, selectedCheckpoint: true, selectedFocus: true,
      focusCheckpoint: true, selectedPhase: "VERIFYING", arrangeBeforeBranches: f => arrange(f, { withChecks }),
      afterRecordedChoice: f => activationCase(f, { pass, nextNode: "selected_checkpoint",
        afterActivation: f => selectedCase(f, { pass, nextNode: "selected_focus",
          afterSelected: f => focusCase(f, { pass, nextNode: "focus_checkpoint", afterFocus: f => resumedCase(f, { withChecks, withGuards }) }) }) }) });
    console.log(JSON.stringify({ status: "PASS", checks, scope: mode ? "FRESH_REAL_AUTHORITY_CANONICAL_RESUME_COMPONENT" : "CLOSED_CANONICAL_RESUME_CONTRACTS", Native: 0, full_standard: false }));
  }
}
