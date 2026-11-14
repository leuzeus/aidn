import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { openCycleChoiceFixtureHost } from "./standard-cycle-choice-record-fixture-lib.mjs";
import { arrangeCanonicalResumeData } from "./standard-canonical-resume-fixture-lib.mjs";
import { taskProgressValidationProfile } from "./cycle-task-progress-fixture-lib.mjs";
import { verifyOwnedResumeContracts } from "./standard-owned-cycle-resume-contract-fixture-lib.mjs";
import { assertOwnedCanonicalResumeOutput } from "../../src/core/workflow/standard-owned-cycle-resume.mjs";
import { assertCanonicalResumeObserveOutput } from "../../src/core/workflow/standard-canonical-cycle-resume.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { artifactContentHash, artifactMetadataHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { analyzeStructuredArtifact } from "../../src/lib/workflow/structured-artifact-parser-lib.mjs";

const script = fileURLToPath(import.meta.url), checks = [], pass = name => { checks.push(name); console.log("PASS " + name); };
const cyclePath = "cycles/C001-feature-choice", objective = "Resume current owned canonical progress without inventing prior work";
const field = (text, key, value) => {
  const pattern = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*$", "gm");
  assert.equal([...text.matchAll(pattern)].length, 1, key);
  return text.replace(pattern, (_line, prefix) => prefix + key + ": " + value);
};

async function contracts() {
  await verifyOwnedResumeContracts(async (name, fn) => { await fn(); pass(name); });
  for (const kind of ["input", "output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-owned-cycle-resume-" + kind + ".v1.schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const binding = standardWorkflowOperationBindings().find(row => row.id === "cycle_owned_resume_admit");
  assert.equal(binding.effect_class, "read-only"); assert.equal(binding.executor_kind, "deterministic"); assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  pass("owned source uses closed schemas and an existing-entry-only deterministic read-only binding");
}

export async function verifyOwnedCycleResume({ mode, phase, prefix, enter = false, withChecks = false }) {
  assert.ok(["files", "dual", "db-only"].includes(mode)); assert.ok(["OPEN", "IMPLEMENTING", "VERIFYING"].includes(phase));
  assert.ok(Number.isInteger(prefix) && prefix >= 0 && prefix <= 2);
  if (enter && (phase === "VERIFYING" || prefix === 2) || withChecks && (phase === "OPEN" || prefix !== 2 || enter)) throw Error("OWNED_RESUME_FIXTURE_SCOPE_INVALID");
  const owned = [], root = createFreshStandardWorkflowFixture(mode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root }),
    operations = createStandardWorkflowOperations({ targetRoot: root }), privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-owned-resume-")), clock = Date.now(),
    keyFile = path.join(privateRoot, "host.key"), sourcesFile = path.join(privateRoot, "sources.json");
  fs.writeFileSync(keyFile, randomBytes(32), { flag: "wx" }); fs.writeFileSync(sourcesFile, "{}", { flag: "wx" });
  const git = (...args) => execFileSync("git", ["--literal-pathspecs", "--no-optional-locks", "-C", root, "-c", "diff.autoRefreshIndex=false", "-c", "core.hooksPath=NUL", ...args],
    { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  const checkpoint = label => { git("add", "."); git("commit", "--allow-empty", "-m", label); };
  const apply = async (prepared, method) => {
    assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
    assert.equal((await operations[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  };
  const replace = async changes => {
    const rows = changes.map(([name, after]) => { const before = artifacts.read(name, { required: true });
      return { path: name, before_sha256: before.sha256, before_metadata_sha256: artifacts.metadataHash(name), after, after_sha256: artifactContentHash(after) }; });
    await artifacts.withLocalEffectOwner(shadowHash(rows), () => {
      for (const row of rows) artifacts.compareAndSwapPreservingMetadata(row);
      artifacts.project(rows.map(row => row.path)); return { effect_status: "confirmed" };
    });
  };
  // These lifecycle and checked-prefix preimages are fixture DATA. Their setup
  // is not a prior H capture, Native task or current validation receipt.
  await apply(await operations.prepareSession({ session_id: "S001", session_branch: "S001-owned", objective }), "initializeSession");
  await apply(await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode"); checkpoint("fixture owned mode");
  await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture owned context");
  await apply(await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "choice", objective,
    continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-owned" }), "initializeCycle");
  fs.mkdirSync(path.join(root, "product")); fs.writeFileSync(path.join(root, "product/app.mjs"), "export const value = 1;\n");
  checkpoint("fixture owned cycle baseline");
  const proposal = await arrangeCanonicalResumeData({ artifacts, replace, selectedCycleId: "C001", selectedPhase: phase, cycleObjective: objective },
    { completedTaskIds: ["TASK-001", "TASK-002"].slice(0, prefix) });
  let status = artifacts.read(cyclePath + "/status.md", { required: true }).content;
  const dor = phase === "OPEN" ? "NOT_READY" : "READY";
  for (const [key, value] of Object.entries({ state: phase, dor_state: dor, scope_frozen: phase === "OPEN" ? "false" : "true" })) status = field(status, key, value);
  const current = field(field(artifacts.read("CURRENT-STATE.md", { required: true }).content, "dor_state", dor),
    "first_plan_step", prefix < 2 ? proposal.tasks[prefix].id + ": " + proposal.tasks[prefix].task : "All planned tasks completed; verify current product");
  await replace([[cyclePath + "/status.md", status], ["CURRENT-STATE.md", current]]);
  fs.writeFileSync(path.join(root, "product/app.mjs"), `export const value = ${prefix + 1};\n`);
  // Derive the actual active-cycle digest. The earlier session-only refresh
  // cannot attest current-cycle consistency, and reload is intentionally read-only.
  await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext");
  await operations.reload();

  const nodes = [["entry", "cycle_entry_admit"], ["resume", "cycle_owned_resume_admit"]];
  if (enter) nodes.push(["ready", "cycle_readiness_evaluate"], ["enter", "cycle_implementation_enter"], ["select_task", "cycle_task_select"]);
  if (prefix === 2 && phase !== "OPEN") nodes.push(["observe_product", "cycle_canonical_resume_observe"]);
  if (withChecks) nodes.push(["validate", "cycle_validation_execute"], ["validation_evaluate", "cycle_validation_evaluate"],
    ["verification_enter", "cycle_verification_enter"], ["audit_select", "cycle_audit_select"]);
  const reference = (key, source) => ({ [key]: { source: "operation_id", node_id: source } }),
    fields = { entry: { contract_version: { source: "literal", value: "standard-cycle-entry-input.v1" },
      session_id: { source: "literal", value: "S001" }, cycle_id: { source: "literal", value: "C001" } },
      resume: reference("entry_operation_id", "entry"), ready: reference("record_operation_id", "resume"), enter: reference("evaluation_operation_id", "ready"),
      select_task: reference("implementation_operation_id", "enter"),
      observe_product: reference("implementation_operation_id", "resume"), validate: reference("work_operation_id", "observe_product"),
      validation_evaluate: reference("validation_operation_id", "validate"), verification_enter: reference("evaluation_operation_id", "validation_evaluate"),
      audit_select: reference("implementation_operation_id", "resume") };
  const bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row])),
    model = { contract_version: "agentic-process-model.v2", model_id: "owned-canonical-resume-port-fixture", revision: 1,
      participants: [{ id: "project" }], roles: [], policies: [], entry: "main",
      nodes: [{ id: "main", kind: "sequence", participant_ref: "project", children: nodes.map(([id]) => id) },
        ...nodes.map(([id, binding_ref]) => ({ id, kind: "operation", participant_ref: "project", binding_ref }))],
      operation_pins: Object.fromEntries(nodes.map(([, binding]) => [binding, shadowHash(bindings.get(binding))])),
      data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: [], inputs: nodes.map(([node_id]) => ({ node_id, fields: fields[node_id] })) } };
  fs.writeFileSync(path.join(privateRoot, "fixture-model.json"), JSON.stringify(model), { flag: "wx" });
  const verifier = withChecks ? taskProgressValidationProfile(privateRoot, false) : null;
  fs.writeFileSync(path.join(privateRoot, "fixture-process.json"), JSON.stringify({ ...(verifier ? { validation_profile: verifier.profileRef } : {}),
    target_root: root, instance_id: "choice-record", product_root: path.join(root, "product"), product_files: ["app.mjs"],
    control_root: path.join(privateRoot, "control"), review_root: path.join(privateRoot, "review"), activity_outputs: {},
    native: { home: path.join(privateRoot, "native"), protected_roots: [] } }), { flag: "wx" });
  let host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
  const initial = host.initialize({ instanceId: "choice-record" });
  host.initialize({ instanceId: "choice-record", write: true, expectedResultSha256: initial.record.instance_sha256 });
  const canonical = () => artifacts.observeInventory().rows.filter(row => !row.path.startsWith("workflows/")).map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
  const witness = () => ({ canonical: canonical(), head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"),
    refs: git("for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads"),
    index: artifactContentHash(fs.readFileSync(git("rev-parse", "--path-format=absolute", "--git-path", "index"))),
    product: artifactContentHash(fs.readFileSync(path.join(root, "product/app.mjs"))) });
  const before = witness(), traceBefore = artifacts.read(cyclePath + "/traceability.md", { required: true }).content, journals = [];
  assert.notEqual(git("status", "--porcelain"), "", "Actual owned progress stays uncommitted; no fixture checkpoint before admission");
  const execute = async node => {
    const state = host.inspect("choice-record"), occurrenceId = state.cursor.ready[0];
    assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId).node_id, node);
    const preview = await host.preview({ instanceId: "choice-record", expectedSha256: state.record.instance_sha256, occurrenceId }),
      staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), result = await host.dispatch(staged.operation_id, { write: true });
    assert.equal(result.receipt.outcome, "completed", JSON.stringify(result));
    const journal = host.readJournal(staged.operation_id); createOperationJournalSigner(() => fs.readFileSync(keyFile)).verify(journal);
    host = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, clock);
    await host.accept(staged.operation_id, { write: true });
    const retained = shadowHash(host.readJournal(staged.operation_id)), accepted = host.inspect("choice-record").record.instance_sha256;
    assert.equal((await host.dispatch(staged.operation_id, { write: true })).status, "retained_result");
    await host.accept(staged.operation_id, { write: true });
    assert.equal(shadowHash(host.readJournal(staged.operation_id)), retained); assert.equal(host.inspect("choice-record").record.instance_sha256, accepted);
    journals.push(journal); return journal;
  };
  const entry = await execute("entry"), resumed = await execute("resume"), output = assertOwnedCanonicalResumeOutput(resumed.results.at(-1).output);
  assert.equal(output.observations.entry_operation_id, entry.operation_id); assert.equal(output.observations.entry_sha256, shadowHash(entry));
  assert.equal(output.observations.canonical_phase, phase); assert.deepEqual(output.observations.imported_completed_task_ids, ["TASK-001", "TASK-002"].slice(0, prefix));
  for (const key of ["implementation_authorized", "current_validation_evidence", "current_native_work_evidence"]) assert.equal(output.observations[key], false);
  assert.equal(Object.hasOwn(output.observations, "focus_checkpoint_operation_id"), false); assert.equal(Object.hasOwn(output.observations, "checkpoint_sha256"), false);
  assert.deepEqual(witness(), before); assert.equal(artifacts.ownerPending(), false);
  pass(mode + "/" + phase + ": actual owned entry and read-only progress admission preserve dirty canonical/product/Git state without H, checkpoint or Native receipts");
  if (enter) {
    await execute("ready"); const entered = await execute("enter"), effect = entered.results.at(-1).output;
    assert.equal(effect.effect_status, "confirmed"); assert.equal(effect.observations.committed.length, 2);
    assert.equal(analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values.first_plan_step,
      output.observations.proposal.tasks[prefix].task);
    const selected = (await execute("select_task")).results.at(-1).output;
    assert.equal(selected.observations.task.id, proposal.tasks[prefix].id);
    assert.equal(selected.observations.ordinal, prefix + 1);
    assert.equal(analyzeStructuredArtifact(artifacts.read(cyclePath + "/status.md", { required: true }).content).key_values.state, "IMPLEMENTING");
    for (const key of ["head", "branch", "refs", "index", "product"]) assert.equal(witness()[key], before[key], key);
    assert.equal(artifacts.read(cyclePath + "/traceability.md", { required: true }).content, traceBefore);
    pass(mode + ": current readiness and separately granted implementation entry project the next task, without a Native response");
  }
  if (prefix === 2 && phase !== "OPEN") {
    const observed = assertCanonicalResumeObserveOutput((await execute("observe_product")).results.at(-1).output);
    assert.deepEqual(observed.observations.current_observed_task_ids, []); assert.equal(observed.observations.work_complete, true);
    assert.equal(observed.facts.cycle_work_observed, undefined); assert.deepEqual(witness(), before);
    pass(mode + ": complete owned DATA reaches the trusted current product observer without current work attestation");
  }
  if (withChecks) {
    const callsFile = path.join(privateRoot, "validation-control/calls.jsonl"), calls = () => fs.readFileSync(callsFile, "utf8").trim().split(/\r?\n/).filter(Boolean).length;
    assert.equal(calls(), 0);
    const machine = (await execute("validate")).results.at(-1).output;
    assert.equal(machine.facts.cycle_validation_passed, true); assert.equal(machine.observations.proof_class, "fixture"); assert.equal(calls(), 2);
    const evaluated = (await execute("validation_evaluate")).results.at(-1).output;
    assert.deepEqual(evaluated.observations.observed_task_ids, []); assert.deepEqual(evaluated.observations.imported_task_ids, ["TASK-001", "TASK-002"]);
    assert.equal(evaluated.observations.canonical_resume_source.entry_operation_id, entry.operation_id);
    assert.equal(Object.hasOwn(evaluated.observations.canonical_resume_source, "focus_checkpoint_operation_id"), false);
    const metadataFor = () => {
      if (!artifacts.describe().database) return null;
      const store = createProjectArtifactStore({ targetRoot: root, readOnly: true, existingOnly: true });
      try { return Object.fromEntries([cyclePath + "/status.md", cyclePath + "/traceability.md", "CURRENT-STATE.md", "snapshots/context-snapshot.md"].map(name => {
        const row = store.getArtifact(name); return [name, Object.fromEntries(["kind", "family", "subtype", "gate_relevance", "classification_reason", "session_id", "cycle_id",
          "source_mode", "entity_confidence", "legacy_origin", "updated_at"].map(key => [key, row[key] ?? null]))]; })); } finally { store.close(); }
    };
    const metadataBefore = metadataFor(), verification = await execute("verification_enter"), changes = verification.results.at(-1).output.observations.committed;
    assert.equal(changes.length, 4); assert.equal(artifacts.read(cyclePath + "/traceability.md", { required: true }).content.startsWith(traceBefore), true);
    const metadataAfter = metadataFor();
    if (metadataBefore) for (const name of Object.keys(metadataBefore)) {
      const { updated_at: oldAt, ...oldFields } = metadataBefore[name], { updated_at: newAt, ...newFields } = metadataAfter[name];
      assert.deepEqual(newFields, oldFields); assert.notEqual(newAt, oldAt); assert.equal(artifactMetadataHash(metadataAfter[name]), artifacts.metadataHash(name));
    }
    const audit = (await execute("audit_select")).results.at(-1).output;
    assert.equal(audit.facts.cycle_audit_source_selected, true); assert.equal(audit.observations.implementation_operation_id, resumed.operation_id);
    assert.equal(audit.observations.verification_operation_id, verification.operation_id); assert.equal(audit.observations.validation.checks_passed, true);
    for (const key of ["head", "branch", "refs", "index", "product"]) assert.equal(witness()[key], before[key], key);
    assert.equal(calls(), 2); pass(mode + ": two registered Node checks and four-document verification preserve imported history and classification before audit selection");
  }
  assert.equal(artifacts.ownerPending(), false); assert.equal(journals.some(row => row.intent.binding_ref.includes("choice") || row.intent.binding_ref.includes("checkpoint")), false);
  const report = { canonical_resume_scope: "OWNED_ENTRY_SOURCE_COMPONENT", root, private_root: privateRoot, mode, phase, prefix,
    entry_operation_id: entry.operation_id, resume_operation_id: resumed.operation_id, journals: journals.map(row => ({ operation_id: row.operation_id, binding: row.intent.binding_ref, sha256: shadowHash(row) })),
    before, after: witness(), current_checks: withChecks ? "TWO_ACTUAL_REGISTERED_NODE_CHECKS_FIXTURE" : "NOT_RUN", lifecycle_and_history: "STAGED_CANONICAL_DATA",
    H: "NO_H_CAPTURE_RECEIPT", Native: 0, current_native_work_receipts: 0, installed_archive: "NOT_RUN", full_standard: false };
  fs.writeFileSync(path.join(privateRoot, "owned-resume-proof.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report)); return report;
}

if (path.resolve(process.argv[1] ?? "") === script) {
  const args = process.argv.slice(2), mode = args.find(arg => arg.startsWith("--mode="))?.slice(7), phase = args.find(arg => arg.startsWith("--phase="))?.slice(8) ?? "VERIFYING",
    prefixText = args.find(arg => arg.startsWith("--prefix="))?.slice(9) ?? "2", enter = args.includes("--enter"), withChecks = args.includes("--checks"), contractsOnly = args.includes("--contracts-only");
  if (args.some(arg => !/^--(?:mode=(?:files|dual|db-only)|phase=(?:OPEN|IMPLEMENTING|VERIFYING)|prefix=[0-2]|enter|checks|contracts-only)$/.test(arg))
    || contractsOnly && (mode || enter || withChecks || args.length !== 1) || !contractsOnly && !mode) throw Error("OWNED_RESUME_FIXTURE_ARGUMENTS_INVALID");
  await contracts();
  if (!contractsOnly) await verifyOwnedCycleResume({ mode, phase, prefix: Number(prefixText), enter, withChecks });
  console.log(JSON.stringify({ status: "PASS", checks: checks.length, scope: contractsOnly ? "PURE_OWNED_SOURCE_CONTRACTS" : "OWNED_ENTRY_SOURCE_COMPONENT", Native: 0, full_standard: false }));
}
