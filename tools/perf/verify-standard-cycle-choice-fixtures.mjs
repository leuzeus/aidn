#!/usr/bin/env node
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
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { createStandardHumanDecisions } from "../../src/application/runtime/standard-workflow-human-decisions.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { assertDecisionInbox } from "../../src/core/workflow/process-decision-inbox.mjs";
import { assertCycleEntryChoiceSubject, assertCycleEntryChoiceQuestion, assertHumanCycleEntryChoice,
  assertCycleEntryChoiceOutput, cycleEntryChoiceQuestion, cycleEntryChoiceOutput } from "../../src/core/workflow/standard-cycle-entry-choice.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { verifyRecoveryCycleSelectionBoundaries } from "./recovery-cycle-selection-fixture-lib.mjs";

const H = "a".repeat(64), J = "b".repeat(40), here = fileURLToPath(import.meta.url);
let checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };
const candidate = (id, owner = "S001") => ({ cycle_id: id, path: "cycles/" + id + "-feature-choice/status.md",
  sha256: H, metadata_sha256: null, state: "OPEN", session_owner: owner,
  branch_name: "feature/" + id + "-choice", branch_head: J, dor_state: "NOT_READY", scope_frozen: "false" });
function subject() {
  return { contract_version: "standard-cycle-entry-choice-subject.v1", entry_operation_id: "op_" + "1".repeat(40),
    entry_output_sha256: H, session_id: "S001", session_path: "sessions/S001.md", scope_sha256: H, inventory_sha256: H,
    current_cycle_id: "C001", current_branch: "feature/C001-choice", head: J,
    reason_code: "STANDARD_CYCLE_ENTRY_CHOICE_REQUIRED",
    canonical: ["CURRENT-STATE.md", "sessions/S001.md"].map(name => ({ path: name, sha256: H, metadata_sha256: null })),
    candidate_cycles: [candidate("C001"), candidate("C002")], reported_cycles: [], missing_reported_cycles: [], carry_over_pending: false };
}
function question(review = subject()) {
  return cycleEntryChoiceQuestion({ operation_id: "op_" + "2".repeat(40), intent: { fixture: "question-only" }, preview: { prepared: { subject: review } } });
}
function claim(q, choice = "select_cycle", selection = { cycle_id: "C001", carryover_decisions: [] }) {
  return { contract_version: "human-cycle-entry-choice.v1", source_kind: "human", authority_id: "fixture_operator",
    source_event_id: "choice-" + choice, question_sha256: shadowHash(q), subject_sha256: shadowHash(q.subject),
    choice, selection: choice === "select_cycle" ? selection : null, rationale: "Explicit bounded fixture decision",
    evidence_refs: [{ ref: "fixture:cycle-choice", sha256: H }] };
}
function capture(source) { return { inbox_id: "decision_" + "3".repeat(40), source_ref: "fixture:source", source }; }

async function contracts() {
  for (const name of ["standard-cycle-entry-choice-subject.v1", "standard-cycle-entry-choice-question.v1", "human-cycle-entry-choice.v1",
    "standard-cycle-entry-choice-output.v1", "standard-cycle-entry-choice-input.v1", "process-decision-inbox.v19"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/" + name + ".schema.json", import.meta.url), "utf8"));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const q = question(); assert.equal(Object.hasOwn(q, "expires_at_ms"), false);
  assert.equal(Object.hasOwn(q.subject, "prepared_at_ms"), false);
  const output = cycleEntryChoiceOutput(q, capture(claim(q)));
  assert.equal(output.effect_status, "no_effect"); assert.equal(output.observations.implementation_authorized, false);
  assert.deepEqual(output.facts, { cycle_entry_selection_requested: true });
  for (const [assertion, value] of [[assertCycleEntryChoiceSubject, q.subject], [assertCycleEntryChoiceQuestion, q],
    [assertHumanCycleEntryChoice, claim(q)], [assertCycleEntryChoiceOutput, output]])
    assert.throws(() => assertion({ ...value, approved: true }));
  assert.throws(() => assertCycleEntryChoiceSubject({ ...q.subject, session_path: "sessions/S0010.md" }));
  assert.throws(() => assertCycleEntryChoiceOutput({ ...output, observations: { ...output.observations, implementation_authorized: true } }));
  pass("closed cycle choice contracts bind canonical identity; intent grants no implementation and adds no preparation expiry");

  const report = subject(); report.reported_cycles = ["C002"]; report.carry_over_pending = true;
  const rq = question(report);
  for (const action of ["integrate_now", "import_now", "defer", "drop"]) {
    for (const outcome of action === "drop" ? ["NO_GO", "DROPPED"] : [null]) {
      const selection = { cycle_id: "C001", carryover_decisions: [{ cycle_id: "C002", action, outcome, rationale: "Explicit per-cycle fixture disposition" }] };
      assertHumanCycleEntryChoice(claim(rq, "select_cycle", selection), rq);
      assert.equal(cycleEntryChoiceOutput(rq, capture(claim(rq, "select_cycle", selection))).effect_status, "no_effect");
    }
  }
  assert.throws(() => assertHumanCycleEntryChoice(claim(rq), rq));
  const deferred = { cycle_id: "C002", action: "defer", outcome: null, rationale: "Keep reported, no implementation" };
  assert.throws(() => assertHumanCycleEntryChoice(claim(rq, "select_cycle", { cycle_id: "C002", carryover_decisions: [deferred] }), rq));
  assert.throws(() => assertHumanCycleEntryChoice(claim(rq, "select_cycle", { cycle_id: "C001", carryover_decisions: [deferred, deferred] }), rq));
  const incomplete = subject(); incomplete.reported_cycles = ["C099"]; incomplete.missing_reported_cycles = ["C099"];
  assert.deepEqual(question(incomplete).choices, ["refused", "deferred", "cancelled"]);
  const absentBranches = subject(); for (const row of absentBranches.candidate_cycles) row.branch_head = null;
  assert.deepEqual(question(absentBranches).choices, ["refused", "deferred", "cancelled"]);
  const foreign = subject(); foreign.candidate_cycles.push(candidate("C003", "S999")); const fq = question(foreign);
  assert.throws(() => assertHumanCycleEntryChoice(claim(fq, "select_cycle", { cycle_id: "C003", carryover_decisions: [] }), fq));
  pass("all reported cycles require explicit import/integrate/defer/drop intent; missing, foreign and deferred selected cycles cannot authorize continuation");

  for (const choice of ["refused", "deferred", "cancelled"]) {
    const result = cycleEntryChoiceOutput(q, capture(claim(q, choice)));
    assert.equal(result.outcome, choice === "refused" ? "rejected" : choice); assert.deepEqual(result.facts, {});
  }
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 73)), inboxRows = new Map(), sources = new Map();
  let verified = true;
  const inbox = { read(id) { const record = inboxRows.get(id); return { record: record ? structuredClone(record) : null, content_sha256: record ? shadowHash(record) : null }; },
    compareAndSwap(record, expected) { assertDecisionInbox(record); const before = inboxRows.get(record.inbox_id);
      assert.equal(expected, before ? shadowHash(before) : null); inboxRows.set(record.inbox_id, structuredClone(record)); return { projection: "not_requested" }; },
    materialize() { throw Error("FIXTURE_PROJECTION_NOT_REQUESTED"); } };
  const human = createStandardHumanDecisions({ inbox, signer, projectionRequired: false, source: {
    read: ({ sourceRef }) => sources.get(sourceRef) ?? null,
    verify: ({ source, sourceRef }) => verified && shadowHash(sources.get(sourceRef) ?? null) === shadowHash(source)
      ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" } } });
  const record = { operation_id: "op_" + "4".repeat(40), intent: { binding_ref: "cycle_entry_choice_decision" },
    preview: { prepared: { subject: subject() } }, results: [] }, hq = human.question(record);
  assert.equal(await human.reserve(record, "absent"), null); assert.equal(inboxRows.size, 0);
  sources.set("choice", claim(hq)); verified = false;
  await assert.rejects(human.reserve(record, "choice"), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" }); assert.equal(inboxRows.size, 0);
  verified = true; const saved = await human.reserve(record, "choice"); assert.equal(saved.contract_version, "process-decision-inbox.v19");
  const result = human.output(record, saved), receipt = { fixture_receipt: true, outcome: result.outcome, effect_status: "no_effect" };
  record.results.push({ output: result, receipt }); human.acknowledge(saved.inbox_id, receipt);
  assert.equal(human.captured(record).phase, "receipted"); await human.verifyCaptured(record, undefined, { acknowledged: true });
  assert.equal((await human.reserve(record, "choice")).inbox_id, saved.inbox_id); assert.equal(inboxRows.size, 1);
  const other = structuredClone(record); other.operation_id = "op_" + "5".repeat(40);
  await assert.rejects(human.reserve(other, "choice"), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
  const reused = claim(human.question(other)); sources.set("reused", reused);
  await assert.rejects(human.reserve(other, "reused"), { code: "PROCESS_HUMAN_SOURCE_ALREADY_USED" });
  pass("absence waits, unauthenticated source is refused and v19 retains a single acknowledged human event with distinct non-success outcomes");
  await verifyRecoveryCycleSelectionBoundaries(pass);
}

function model() {
  const ids = ["cycle_entry_observe", "cycle_entry_choice_decision"], bindings = standardWorkflowOperationBindings().filter(row => ids.includes(row.id));
  return { contract_version: "agentic-process-model.v2", model_id: "cycle-choice-port-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], entry: "start",
    nodes: [{ id: "start", kind: "sequence", participant_ref: "project", children: ["observe", "choose"] },
      { id: "observe", kind: "operation", participant_ref: "project", binding_ref: "cycle_entry_observe" },
      { id: "choose", kind: "operation", participant_ref: "project", binding_ref: "cycle_entry_choice_decision" }],
    operation_pins: Object.fromEntries(bindings.map(row => [row.id, shadowHash(row)])),
    data_bindings: { contract_version: "process-data-bindings.v2", parameter_keys: [], inputs: [
      { node_id: "observe", fields: Object.fromEntries(Object.entries({ contract_version: "standard-cycle-entry-input.v1", session_id: "S001", cycle_id: "C001" })
        .map(([name, value]) => [name, { source: "literal", value }])) },
      { node_id: "choose", fields: { contract_version: { source: "literal", value: "standard-cycle-entry-choice-input.v1" },
        entry_operation_id: { source: "operation_id", node_id: "observe" } } } ] } };
}
function open(root, keyFile, sourcesFile, clock, onVerify = () => {}) {
  return createStandardWorkflowOperationHost({ targetRoot: root, model: model(), readSigningKey: () => fs.readFileSync(keyFile), now: () => clock,
    authorize: async request => { assert.equal(request.binding.effect_class, "read-only");
      return { authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H }; },
    humanSource: { read: ({ sourceRef }) => JSON.parse(fs.readFileSync(sourcesFile, "utf8"))[sourceRef] ?? null,
      async verify({ source, sourceRef, question: q }) { await onVerify(); const value = JSON.parse(fs.readFileSync(sourcesFile, "utf8"))[sourceRef];
        return sourceRef !== "unverified" && value && shadowHash(value) === shadowHash(source) && source.question_sha256 === shadowHash(q)
          ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" }; } } });
}
if (process.argv[2] === "--accept") {
  const [, , , root, key, sources, id, clock] = process.argv;
  const state = await open(root, key, sources, Number(clock)).accept(id, { write: true });
  console.log(JSON.stringify({ instance_sha256: state.record.instance_sha256, status: state.cursor.status }));
} else {
  const owned = [], temporary = fs.realpathSync(os.tmpdir()), selectedMode = process.argv.find(value => value.startsWith("--mode="))?.slice(7);
  if (selectedMode && !["files", "dual", "db-only"].includes(selectedMode)) throw Error("CYCLE_CHOICE_FIXTURE_MODE_INVALID");
  let success = false;
  try {
    await contracts();
    for (const persistence of process.argv.includes("--contracts-only") ? [] : selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) {
      const targetRoot = createFreshStandardWorkflowFixture(persistence, owned), operations = createStandardWorkflowOperations({ targetRoot }), artifacts = createStandardWorkflowArtifacts({ targetRoot });
      const privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-cycle-choice-")); owned.push(privateRoot);
      const keyFile = path.join(privateRoot, "host.key"), sourcesFile = path.join(privateRoot, "sources.json");
      fs.writeFileSync(keyFile, randomBytes(32)); fs.writeFileSync(sourcesFile, "{}");
      const git = (...args) => execFileSync("git", ["-C", targetRoot, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true }).trim();
      const checkpoint = message => { git("add", "."); git("commit", "--allow-empty", "-m", message); };
      const apply = async (prepared, method) => { assert.equal(prepared.can_apply, true); assert.equal((await operations[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed"); };
      await apply(await operations.prepareSession({ session_id: "S001", session_branch: "S001-choice", objective: "Authenticate a cycle choice without granting implementation or changing canonical work" }), "initializeSession");
      await apply(await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode"); checkpoint("fixture mode");
      await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture context");
      await apply(await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "choice", objective: "Authenticate a cycle choice without granting implementation or changing canonical work",
        continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-choice" }), "initializeCycle"); checkpoint("fixture cycle");
      // The second cycle is a fixture preimage, not a claim that its productive initializer ran.
      const status = artifacts.read("cycles/C001-feature-choice/status.md").content,
        text = status.replaceAll("C001", "C002").replaceAll("feature/C002-choice", "feature/C002-competing"), relative = "cycles/C002-feature-competing/status.md";
      const change = { path: relative, before_sha256: null, before_metadata_sha256: null, after: text, after_sha256: artifactContentHash(text) };
      await artifacts.withLocalEffectOwner(shadowHash(change), () => { artifacts.compareAndSwapPreservingMetadata(change); artifacts.project([relative]); return { effect_status: "confirmed" }; });
      git("branch", "feature/C002-competing", "HEAD"); checkpoint("fixture competing cycle preimage");
      const pins = () => { const names = artifacts.inventory().paths.filter(name => !name.startsWith("workflows/"));
        return { rows: artifacts.readMany(names, { required: names, includeMetadata: true }), head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), status: git("status", "--porcelain") }; };
      const before = pins(), clock = Date.now(); let host = open(targetRoot, keyFile, sourcesFile, clock);
      const initial = host.initialize({ instanceId: "choice" }); host.initialize({ instanceId: "choice", write: true, expectedResultSha256: initial.record.instance_sha256 });
      const previewNext = async () => { const state = host.inspect("choice"); return host.preview({ instanceId: "choice", expectedSha256: state.record.instance_sha256, occurrenceId: state.cursor.ready[0] }); };
      let preview = await previewNext(), staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      assert.equal((await host.dispatch(staged.operation_id, { write: true })).receipt.outcome, "completed"); await host.accept(staged.operation_id, { write: true });
      preview = await previewNext(); staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      const id = staged.operation_id, waiting = await host.dispatch(id, { write: true }); assert.equal(waiting.status, "waiting_for_human");
      const q = waiting.question, waitingHash = host.inspect("choice").record.instance_sha256;
      assert.equal((await host.receiveDecision(id, { sourceRef: "absent", write: true })).status, "waiting_for_human");
      assert.equal(host.inspect("choice").record.instance_sha256, waitingHash); assert.deepEqual(pins(), before);
      host = open(targetRoot, keyFile, sourcesFile, clock + 86400000);
      assert.equal(shadowHash((await host.dispatch(id, { write: true })).question), shadowHash(q));
      const accepted = claim(q), publish = (ref, value) => fs.writeFileSync(sourcesFile, JSON.stringify({ [ref]: value }));
      publish("unverified", accepted); await assert.rejects(host.receiveDecision(id, { sourceRef: "unverified", write: true }), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
      publish("wrong-question", { ...accepted, question_sha256: "0".repeat(64) });
      await assert.rejects(host.receiveDecision(id, { sourceRef: "wrong-question", write: true }), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
      const oldRef = git("rev-parse", "refs/heads/feature/C002-competing"), otherRef = git("rev-parse", "HEAD~2");
      assert.notEqual(oldRef, otherRef, "staleness control must move the actual branch tip");
      publish("choice", accepted); git("update-ref", "refs/heads/feature/C002-competing", otherRef, oldRef);
      await assert.rejects(host.receiveDecision(id, { sourceRef: "choice", write: true }), { code: "STANDARD_CYCLE_ENTRY_CHOICE_SOURCE_CHANGED" });
      git("update-ref", "refs/heads/feature/C002-competing", oldRef, otherRef);
      let changed = false;
      host = open(targetRoot, keyFile, sourcesFile, clock + 86400000, () => { if (!changed) { changed = true; git("update-ref", "refs/heads/feature/C002-competing", otherRef, oldRef); } });
      await assert.rejects(host.receiveDecision(id, { sourceRef: "choice", write: true }), { code: "STANDARD_CYCLE_ENTRY_CHOICE_SOURCE_CHANGED" });
      assert.equal(changed, true); git("update-ref", "refs/heads/feature/C002-competing", oldRef, otherRef);
      host = open(targetRoot, keyFile, sourcesFile, clock + 86400000);
      assert.equal((await host.receiveDecision(id, { sourceRef: "choice", write: true })).receipt.outcome, "completed");
      const cold = JSON.parse(execFileSync(process.execPath, [here, "--accept", targetRoot, keyFile, sourcesFile, id, String(clock + 86400000)],
        { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
      const state = host.inspect("choice"); assert.equal(state.cursor.status, "COMPLETED"); assert.equal(state.record.instance_sha256, cold.instance_sha256);
      const journal = host.readJournal(id), output = journal.results.at(-1).output;
      assert.equal(output.observations.implementation_authorized, false); assert.deepEqual(output.facts, { cycle_entry_selection_requested: true });
      const savedHash = state.record.instance_sha256;
      assert.equal((await host.receiveDecision(id, { sourceRef: "choice", write: true })).status, "retained_result");
      assert.equal(host.inspect("choice").record.instance_sha256, savedHash);
      const stillUnadmitted = await operations.admitCycleEntry({ contract_version: "standard-cycle-entry-input.v1", session_id: "S001", cycle_id: "C001" });
      assert.equal(stillUnadmitted.facts.cycle_entry_choice_required, true); assert.equal(stillUnadmitted.facts.cycle_entry_resume_allowed, false);
      assert.deepEqual(pins(), before);
      const replay = simulateAgenticProcess({ instanceId: state.record.instance_id, scopeId: state.record.scope_id,
        model: state.record.model, policyPins: state.record.policy_pins, events: state.record.events });
      assert.equal(replay.trace.at(-1).instance_sha256, state.record.instance_sha256);
      console.log(JSON.stringify({ persistence, fixture_root: targetRoot, host_key: keyFile, sources_file: sourcesFile,
        instance_sha256: savedHash, operation_id: id, native_calls: 0, canonical_unchanged: true, replay_exact: true,
        human_source: "CONTROLLED_FIXTURE_PORT", published_standard_model: "NOT_CONNECTED", selected_cycle_realization: "NOT_RUN" }));
      pass(persistence + ": actual canonical choice observation, durable H wait, changed branch/last-await refusal, cold acceptance and exact replay grant no implementation");
    }
    success = true;
    console.log(JSON.stringify({ status: "PASS", checks, proof_class: "cycle-choice-human-port-component", native_calls: 0,
      genuine_human_native_provider: "NOT_RUN", published_standard_routing: "NOT_CONNECTED", canonical_selection_realization: "NOT_RUN", installed_archive: "NOT_RUN" }));
  } finally {
    if (success && !process.argv.includes("--retain-always")) for (const root of owned) {
      const real = fs.realpathSync(root);
      if (path.dirname(real) !== temporary || !["aidn-standard-fresh-", "aidn-cycle-choice-"].some(prefix => path.basename(real).startsWith(prefix))) throw Error("CYCLE_CHOICE_FIXTURE_CLEANUP_SCOPE_INVALID");
      fs.rmSync(real, { recursive: true, force: true });
    }
    else if (owned.length) console.error(JSON.stringify({ retained_cycle_choice_fixture_roots: owned }));
  }
}
