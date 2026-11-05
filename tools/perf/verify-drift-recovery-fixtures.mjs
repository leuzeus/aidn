#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardHumanDecisions } from "../../src/application/runtime/standard-workflow-human-decisions.mjs";
import { recoveryBoundary } from "../../src/application/runtime/standard-drift-recovery.mjs";
import { createStandardDriftRecovery } from "../../src/application/runtime/standard-drift-recovery.mjs";
import { createStandardDriftChangeRequest } from "../../src/application/runtime/standard-drift-change-request.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { runRequirementsDeltaAdmitUseCase } from "../../src/application/runtime/requirements-delta-admit-use-case.mjs";
import { verifyDriftCyclePort } from "./drift-cycle-fixture-lib.mjs";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { readStandardDriftContext } from "../../src/application/runtime/standard-drift-report.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { assertRecoveryPlan, assertDecisionInbox } from "../../src/core/workflow/process-decision-inbox.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createStandardObjectiveDisposition } from "../../src/application/runtime/standard-drift-objective-disposition.mjs";
import { verifyObjectiveCompletion } from "./objective-completion-fixture-lib.mjs";

const H = "a".repeat(64), id = "op_" + "a".repeat(40), key = Buffer.alloc(32, 7), signer = createOperationJournalSigner(() => key);
const context = { session_id: "S001", cycle_id: null, documents: [{ ref: "audit:CURRENT-STATE.md", sha256: H, content: "before" }], git: {} };
const plan = { contract_version: "standard-drift-recovery-plan.v1", review_operation_id: id, evaluation_operation_id: id, evaluation_sha256: H,
  context_sha256: shadowHash(context), boundary_sha256: H, prepared_at_ms: 1, session_id: "S001", cycle_id: null,
  options: ["new_cycle", "rollback"].map(choice => ({ choice, actions: ["Record findings.", "Execute admitted recovery.", "Re-evaluate drift."] })),
  changes: ["parking-lot.md", "CURRENT-STATE.md"].map((name, i) => ({ path: name, before_sha256: H, edit_kind: i === 0 ? "append" : "replace",
    before_metadata_sha256: H, text_chunks: ["After " + name], after_sha256: artifactContentHash("After " + name) })) };
let checks = 0;
const skips = [];
const pass = name => { checks++; console.log("PASS " + name); };
assertRecoveryPlan(plan);
for (const change of [p => p.changes.reverse(), p => p.changes[0].path = "baseline/current.md", p => p.changes[1].text_chunks[0] += "tampered",
  p => p.context = context, p => p.options.push(p.options[0]), p => p.module = "untrusted.mjs"]) {
  const bad = structuredClone(plan); change(bad); assert.throws(() => assertRecoveryPlan(bad));
}
pass("closed recovery plans bind replacement post-images and bounded append text under a context hash and fixed two-document footprint");
function humanFixture(operationId = id, withDelta = false, reviewPlan = plan) {
  const records = new Map(), sources = new Map();
  const inbox = { read: id => ({ record: records.get(id) ?? null, content_sha256: records.has(id) ? shadowHash(records.get(id)) : null }),
    compareAndSwap(record, before) { assertDecisionInbox(record); assert.equal(before, records.has(record.inbox_id) ? shadowHash(records.get(record.inbox_id)) : null);
      records.set(record.inbox_id, structuredClone(record)); return { projection: "not_requested" }; } };
  const human = createStandardHumanDecisions({ inbox, signer, projectionRequired: false, source: {
    read: ({ sourceRef }) => sources.get(sourceRef) ?? null,
    verify: ({ source, sourceRef }) => sources.has(sourceRef) && sourceRef !== "unverified"
      ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" },
  } });
  const p = structuredClone(reviewPlan); p.review_operation_id = operationId;
  if (withDelta) {
    p.cycle_id = "C001"; p.context_sha256 = shadowHash({ ...context, cycle_id: "C001" });
    p.options.unshift({ choice: "requirements_delta", actions: ["Record confirmed findings.", "Review the owning cycle's requirements delta.", "Re-evaluate drift."] });
  }
  const record = { operation_id: operationId, intent: { binding_ref: "drift_recovery_decision", instance_id: "fixture", scope_id: "fixture", occurrence_id: "root/decide" },
    preview: { prepared: { plan: p } }, results: [] };
  const question = human.question(record);
  const claim = choice => ({ contract_version: "human-drift-recovery-decision.v1", source_kind: "human", authority_id: "fixture_user", source_event_id: "event_" + choice,
    subject_sha256: H, question_sha256: shadowHash(question), choice, evidence_refs: [{ ref: "fixture:operator", sha256: H }] });
  return { human, record, question, claim, sources, records, inbox };
}
for (const choice of ["requirements_delta", "new_cycle", "rollback", "refused", "deferred", "cancelled"]) {
  const f = humanFixture(id, choice === "requirements_delta"); assert.equal(await f.human.reserve(f.record, "missing"), null);
  f.sources.set("choice", f.claim(choice)); const capture = await f.human.reserve(f.record, "choice"), output = f.human.output(f.record, capture);
  assert.equal(capture.contract_version, "process-decision-inbox.v2");
  assert.equal(output.outcome, choice === "refused" ? "rejected" : ["requirements_delta", "new_cycle", "rollback"].includes(choice) ? "completed" : choice);
  if (["requirements_delta", "new_cycle", "rollback"].includes(choice)) { assert.equal(output.facts.drift_recovery_required, true); assert.equal(output.facts.drift_check_completed, false); }
  else assert.deepEqual(output.facts, {});
  const receipt = { operation_id: id, output_sha256: shadowHash(output) }; f.record.results.push({ output, receipt });
  f.human.acknowledge(capture.inbox_id, receipt); f.sources.clear();
  assert.equal(f.human.captured(f.record).phase, "receipted"); assert.equal(f.human.readSource(output.evidence_refs[0].ref).choice, choice);
  await assert.rejects(f.human.verifyCaptured(f.record), /PROCESS_HUMAN_NOT_AUTHENTICATED/);
  pass(`typed ${choice} capture remains explicit and durable; MAC retention is distinct from live source verification`);
}
const objectivePlan = { contract_version: "standard-drift-recovery-plan.v2", review_kind: "objective_signal_disagreement", review_operation_id: id,
  evaluation_operation_id: id, evaluation_sha256: H, context_sha256: H, prepared_at_ms: 1, session_id: "S001", cycle_id: "C001",
  session_objective: "Learn through an explicitly admitted bounded SPIKE", cycle_objective: "Determine whether a bounded prototype is useful",
  report: { contract_version: "standard-drift-report.v1", context_sha256: H, original_objective: "Determine whether a bounded prototype is useful",
    current_objective: "Determine whether a bounded prototype is useful", drift_level: "none", objective_changed: false, changes: [], keep: [], discard: [],
    split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" }, recommendation: "continue", rationale: "Fixture diagnostic", evidence_refs: [{ ref: "fixture:context", sha256: H }] },
  gate_constraints: { level1: { decision: "incremental" }, level3: { required: false }, other_signals: ["objective_delta"] },
  choices: ["confirm_alignment", "request_diagnosis"] };
assertRecoveryPlan(objectivePlan);
for (const mutate of [p => p.gate_constraints.other_signals.push("scope_growth"), p => p.gate_constraints.level3.required = true,
  p => p.gate_constraints.level1.decision = "stop", p => p.report.drift_level = "mild", p => p.report.objective_changed = true,
  p => p.report.changes.push("real drift"), p => p.session_objective = p.cycle_objective, p => p.choices.push("rollback"), p => p.changes = []]) {
  const bad = structuredClone(objectivePlan); mutate(bad); assert.throws(() => assertRecoveryPlan(bad));
}
pass("objective review is closed to a clean complete diagnostic and its sole suspect objective signal; blockers and confirmed findings cannot use it");
for (const choice of ["confirm_alignment", "request_diagnosis", "refused", "deferred", "cancelled"]) {
  const f = humanFixture(id, false, objectivePlan);
  const claim = { ...f.claim(choice), contract_version: "human-drift-recovery-decision.v2", subject_sha256: shadowHash(f.question.review), rationale: "Fixture review of this exact disagreement" };
  f.sources.set("wrong", { ...claim, subject_sha256: H }); await assert.rejects(f.human.reserve(f.record, "wrong"), /PROCESS_HUMAN_QUESTION_CHANGED/);
  f.sources.set("unverified", claim); await assert.rejects(f.human.reserve(f.record, "unverified"), /PROCESS_HUMAN_NOT_AUTHENTICATED/);
  f.sources.set("choice", claim); const capture = await f.human.reserve(f.record, "choice"), output = f.human.output(f.record, capture);
  assert.equal(capture.contract_version, "process-decision-inbox.v12"); assert.equal(output.effect_status, "no_effect");
  assert.deepEqual(output.facts, ["confirm_alignment", "request_diagnosis"].includes(choice) ? { drift_check_completed: false } : {});
  assert.equal(output.outcome, choice === "refused" ? "rejected" : ["confirm_alignment", "request_diagnosis"].includes(choice) ? "completed" : choice);
  assert.equal(output.observations.signal_discharged, false); assert.equal(output.observations.review_resolution_pending, true);
  const receipt = { operation_id: id, output_sha256: shadowHash(output) }; f.record.results.push({ output, receipt });
  f.human.acknowledge(capture.inbox_id, receipt); assert.equal(f.human.captured(f.record).phase, "receipted");
  pass(`objective ${choice} is authenticated against the exact question and retained without findings, signal discharge or R05 completion`);
}
const f = humanFixture(); f.sources.set("wrong", { ...f.claim("new_cycle"), question_sha256: H });
await assert.rejects(f.human.reserve(f.record, "wrong"), /PROCESS_HUMAN_QUESTION_CHANGED/);
f.sources.set("wrong", f.claim("requirements_delta")); await assert.rejects(f.human.reserve(f.record, "wrong"), /PROCESS_HUMAN_CHOICE_NOT_OFFERED/);
f.sources.set("unverified", f.claim("new_cycle")); await assert.rejects(f.human.reserve(f.record, "unverified"), /PROCESS_HUMAN_NOT_AUTHENTICATED/);
const old = { ...f.claim("new_cycle"), contract_version: "human-mode-decision.v1", choice: "THINKING" };
f.sources.set("wrong", old); await assert.rejects(f.human.reserve(f.record, "wrong"), /PROCESS_HUMAN_SOURCE_INVALID/);
pass("wrong questions, mode sources, unoffered choices and unverified identities cannot authorize recovery");
async function dispositionFixture(choice = "confirm_alignment") {
  const f = humanFixture("op_" + "b".repeat(40), false, objectivePlan);
  f.record.preview.input = { evaluation_operation_id: id };
  const claim = { ...f.claim(choice), contract_version: "human-drift-recovery-decision.v2", subject_sha256: shadowHash(f.question.review), rationale: "Fixture exact-subject opinion" };
  f.sources.set("choice", claim);
  const capture = await f.human.reserve(f.record, "choice"), output = f.human.output(f.record, capture);
  const receipt = { operation_id: f.record.operation_id, outcome: "completed", output_sha256: shadowHash(output) };
  f.record.results.push({ output, receipt }); f.record.phase = "receipted";
  f.human.acknowledge(capture.inbox_id, receipt);
  const instance = { instance_id: "fixture", scope_id: "fixture", events: [
    { kind: "operation_intent", intent: { binding_ref: "drift_report_evaluate", operation_id: id } },
    { kind: "operation_intent", intent: { binding_ref: "drift_recovery_decision", operation_id: f.record.operation_id } },
    { kind: "operation_result", receipt }] };
  const review = f.record.preview.prepared.plan;
  const verified = { context_sha256: review.context_sha256, evaluation_sha256: review.evaluation_sha256, output: { observations: { report: review.report } } };
  let time = 1, fresh = true, freshCalls = 0;
  const reader = createStandardObjectiveDisposition({ readOperation: () => f.record, human: f.human, now: () => time,
    async assertFresh(_instance, selected) { freshCalls++; assert.equal(fresh, true, "fixture current canonical review changed"); assert.deepEqual(selected, review); } });
  return { ...f, instance, verified, review, reader, read: () => reader.read(instance, { evaluation_operation_id: id }, verified),
    time: value => { time = value; }, stale: () => { fresh = false; }, freshCalls: () => freshCalls };
}
{
  const f = await dispositionFixture(), value = await f.read();
  assert.equal(value.contract_version, "standard-drift-objective-disposition.v1");
  assert.equal(value.review_sha256, shadowHash(f.review)); assert.equal(value.authority_id, "fixture_user");
  assert.equal(f.freshCalls(), 1); assert.equal(value.rationale, "Fixture exact-subject opinion");
  assert.deepEqual(await f.reader.read(f.instance, { evaluation_operation_id: id }, f.verified), value);
  pass("accepted objective opinion is consumed from its durable inbox with exact receipt, question, evaluation and live source verification");
}
for (const [name, mutate, reason] of [
  ["unaccepted receipt", f => f.instance.events.pop(), /NOT_ACCEPTED/],
  ["wrong instance", f => f.instance.instance_id = "another", /NOT_ACCEPTED/],
  ["changed evaluation", f => f.verified.evaluation_sha256 = "b".repeat(64), /SUBJECT_CHANGED/],
  ["changed context", f => f.verified.context_sha256 = "b".repeat(64), /SUBJECT_CHANGED/],
  ["later evaluation", f => f.instance.events.push({ kind: "operation_intent", intent: { binding_ref: "drift_report_evaluate", operation_id: "op_" + "c".repeat(40) } }), /SUBJECT_CHANGED/],
  ["expired review", f => f.time(300002), /EXPIRED/],
  ["unverified retained source", f => f.sources.clear(), /NOT_AUTHENTICATED/],
  ["canonical CAS change", f => f.stale(), /canonical review changed/],
]) {
  const f = await dispositionFixture(); mutate(f); await assert.rejects(f.read(), reason);
  pass(`objective disposition refuses ${name} without granting an effect`);
}
{
  const f = await dispositionFixture("request_diagnosis"); await assert.rejects(f.read(), /ALIGNMENT_NOT_CONFIRMED/);
  const absent = { ...f.instance, events: [] }; assert.equal(await f.reader.read(absent, { evaluation_operation_id: id }, f.verified), null);
  pass("diagnosis request and absent opinion cannot become alignment confirmation or a Native allocation");
}
{
  const fence = execFileSync(process.execPath, [fileURLToPath(new URL("./verify-gating-objective-fence-fixtures.mjs", import.meta.url))],
    { encoding: "utf8", windowsHide: true, timeout: 70000, maxBuffer: 1048576 });
  process.stdout.write(fence);
}
await verifyObjectiveCompletion(pass);
if (process.argv.includes("--objective-disposition-only")) {
  console.log(JSON.stringify({ status: "PASS", checks, proof: "synthetic-authenticated-disposition-and-human-component-with-production-effect-fences",
    event_append: "actual-temporary-fixture", canonical_effects: "NOT_RUN", full_standard_workflow: "NOT_YET_DELIVERED" }));
  process.exit(0);
}
const temp = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temp, "aidn-recovery-boundary-"));
try {
  const git = args => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
  fs.mkdirSync(path.join(root, "docs/audit"), { recursive: true });
  for (const name of ["docs/audit/CURRENT-STATE.md", "docs/audit/parking-lot.md", "outside.txt"]) fs.writeFileSync(path.join(root, name), "before\n");
  git(["init", "-b", "dev"]); git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]);
  const input = { root, context }, before = recoveryBoundary(input);
  fs.writeFileSync(path.join(root, "docs/audit/CURRENT-STATE.md"), "own after\n"); fs.writeFileSync(path.join(root, "docs/audit/parking-lot.md"), "own after\n");
  assert.equal(recoveryBoundary(input), before);
  fs.writeFileSync(path.join(root, "outside.txt"), "external after\n"); assert.notEqual(recoveryBoundary(input), before);
  fs.writeFileSync(path.join(root, "outside.txt"), "before\n"); assert.equal(recoveryBoundary(input), before);
  git(["add", "docs/audit/CURRENT-STATE.md"]); assert.notEqual(recoveryBoundary(input), before);
  assert.throws(() => recoveryBoundary({ ...input, environment: { ...process.env, GIT_INDEX_FILE: "untrusted" } }), /SCOPE_CONFLICT/);
  pass("causal boundary discounts only known document effects, detects outside edits and own index changes, and refuses Git environment overrides");
} finally {
  const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith("aidn-recovery-boundary-"));
  fs.rmSync(resolved, { recursive: true, force: true });
}
const owned = [];
async function prepareFixtureMode(operations, label) {
  // Session initialization alone leaves mode undecided. Drift context requires
  // the same explicit canonical mode in the session and current state.
  const prepared = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal(prepared.can_apply, true, `${label}: mode precondition must be admitted`);
  assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome,
    "completed", `${label}: mode precondition must complete`);
}
const admissionMode = process.argv.find(arg => arg.startsWith("--cr-admission-mode="))?.slice("--cr-admission-mode=".length);
const cycleMode = process.argv.find(arg => arg.startsWith("--cycle-port-mode="))?.slice("--cycle-port-mode=".length);
if (cycleMode !== undefined && !["files", "dual", "db-only", "partial", "projection"].includes(cycleMode)) throw Error("RECOVERY_CYCLE_FIXTURE_MODE_INVALID");
if (admissionMode !== undefined && !["files", "dual", "db-only"].includes(admissionMode)) throw Error("CR_ADMISSION_FIXTURE_MODE_INVALID");
try {
  if (cycleMode) await verifyDriftCyclePort({ mode: cycleMode, owned, pass });
  else if (process.argv.includes("--cr-fault-only") || admissionMode) await verifyPartialChangeRequest(admissionMode ?? "files", Boolean(admissionMode));
  else {
  const targetRoot = createFreshStandardWorkflowFixture("dual", owned), operations = createStandardWorkflowOperations({ targetRoot });
  const preparedSession = await operations.prepareSession({ session_id: "S001", session_branch: "S001-recovery", objective: "Verify authorized recovery documentation and exact effects" });
  assert.equal((await operations.initializeSession(preparedSession, { write: true, expectPlan: preparedSession.plan_sha256 })).outcome, "completed");
  await prepareFixtureMode(operations, "canonical recovery");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), productRoot = path.join(targetRoot, "product"); fs.mkdirSync(productRoot); fs.writeFileSync(path.join(productRoot, "app.mjs"), "// fixture\n");
  const git = args => execFileSync("git", ["-C", targetRoot, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
  git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture precondition"]);
  const observeContext = () => readStandardDriftContext({ targetRoot, productRoot, productFiles: ["app.mjs"], productSha256: artifactContentHash(fs.readFileSync(path.join(productRoot, "app.mjs"))) });
  assert.equal((await observeContext()).context.mode, "COMMITTING");
  pass("canonical recovery fixture explicitly admits and applies its mode before its first drift-context read");
  const classification = row => Object.fromEntries(["kind", "family", "subtype", "gate_relevance", "classification_reason", "session_id", "cycle_id", "source_mode", "entity_confidence", "legacy_origin"].map(k => [k, row[k]]));
  const metadataStore = createProjectArtifactStore({ targetRoot, existingOnly: true });
  let expectedParkingMetadata;
  try {
    const row = metadataStore.getArtifact("parking-lot.md"); metadataStore.upsertArtifact({ ...row, gate_relevance: 1, classification_reason: "fixture-existing-annotation" });
    expectedParkingMetadata = classification(metadataStore.getArtifact("parking-lot.md"));
  } finally { metadataStore.close(); }
  const instance = { instance_id: "port_fixture", instance_sha256: H }, input = { evaluation_operation_id: id };
  // Only the evaluation authority is doubled here. Canonical CAS/projections,
  // context observations, authorization and ownership below are production ports.
  const port = createStandardDriftRecovery({ targetRoot, observeContext, readCurrent: () => instance,
    async readEvaluation() {
      const observed = await observeContext();
      return { ...observed, evaluation_sha256: H, output: { facts: { drift_present: true, drift_context_complete: true }, observations: {
        report: { contract_version: "standard-drift-report.v1", context_sha256: observed.context_sha256, rationale: "Fixture authority, not a live diagnostic.",
          changes: Array.from({ length: 20 }, (_, i) => `${i}: ` + "f".repeat(1500)) },
      } } };
    } });
  async function request(sequence) {
    const p = await port.prepare(instance, input, "op_" + String(sequence).padStart(40, "0"));
    const body = { review: p.plan, choice: "new_cycle", decision_operation_id: id, prepared_at_ms: Date.now() };
    return { ...body, can_apply: true, plan_sha256: shadowHash(body) };
  }
  const first = await request(1), beforeParking = artifacts.read("parking-lot.md").sha256;
  assert.ok(first.review.changes[0].text_chunks.length > 1); assert.equal(Object.hasOwn(first.review, "context"), false);
  await assert.rejects(port.apply(instance, first, { write: true, expectPlan: first.plan_sha256, assertAuthorized() { throw Error("DENIED"); } }), /DENIED/);
  assert.equal(artifacts.read("parking-lot.md").sha256, beforeParking); assert.equal(artifacts.ownerPending(), false);
  const result = await port.apply(instance, first, { write: true, expectPlan: first.plan_sha256, assertAuthorized() {} });
  assert.equal(result.outcome, "completed"); assert.equal(artifacts.ownerPending(), false); assert.equal(result.facts.drift_check_completed, false);
  assert.notEqual(result.observations.causal_transition.before_context_sha256, result.observations.causal_transition.after_context_sha256);
  const observedMetadata = createProjectArtifactStore({ targetRoot, existingOnly: true, readOnly: true });
  try { assert.deepEqual(classification(observedMetadata.getArtifact("parking-lot.md")), expectedParkingMetadata); } finally { observedMetadata.close(); }
  pass("real canonical recording supports bounded long append text, refuses missing authorization and preserves an explicit pending recovery");
  const changedMetadata = await request(2), alter = createProjectArtifactStore({ targetRoot, existingOnly: true });
  try { const row = alter.getArtifact("parking-lot.md"); alter.upsertArtifact({ ...row, classification_reason: "fixture-intervening-metadata" }); } finally { alter.close(); }
  await assert.rejects(port.apply(instance, changedMetadata, { write: true, expectPlan: changedMetadata.plan_sha256, assertAuthorized() {} }), /STANDARD_RECOVERY_REVIEW_STALE/);
  assert.equal(artifacts.ownerPending(), false);
  pass("canonical classification survives recording and a metadata-only edit after review refuses before effects");
  const second = await request(3), current = artifacts.read("CURRENT-STATE.md");
  await artifacts.withLocalEffectOwner(H, async () => { artifacts.compareAndSwap({ path: current.path, before_sha256: current.sha256, after: current.content + "\nexternal fixture edit\n" }); artifacts.project([current.path]); return { effect_status: "confirmed" }; });
  await assert.rejects(port.apply(instance, second, { write: true, expectPlan: second.plan_sha256, assertAuthorized() {} }), /STANDARD_RECOVERY_REVIEW_STALE/);
  assert.equal(artifacts.ownerPending(), false);
  pass("a changed canonical context after review refuses before effects and releases the local owner");
  // An admitted real cycle is a fixture precondition. Only recovery provenance
  // is doubled in these focused fault tests; the mixed suite authenticates it.
  git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture CR mode"]);
  const contextPlan = await operations.prepareCycleContext({ session_id: "S001" });
  assert.equal((await operations.refreshCycleContext(contextPlan, { write: true, expectPlan: contextPlan.plan_sha256 })).outcome, "completed");
  git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture CR context"]);
  const cyclePlan = await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "recovery-delta",
    objective: "Review an explicit scope delta", continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-recovery" });
  assert.equal(cyclePlan.can_apply, true); assert.equal((await operations.initializeCycle(cyclePlan, { write: true, expectPlan: cyclePlan.plan_sha256 })).outcome, "completed");
  const recoveredContext = await observeContext(), crPath = "cycles/C001-feature-recovery-delta/change-requests.md", crBefore = artifacts.read(crPath);
  const crMetadata = createProjectArtifactStore({ targetRoot, existingOnly: true });
  let expectedCrMetadata;
  try { const row = crMetadata.getArtifact(crPath); crMetadata.upsertArtifact({ ...row, classification_reason: "fixture-CR-annotation" }); expectedCrMetadata = classification(crMetadata.getArtifact(crPath)); } finally { crMetadata.close(); }
  let choice = "requirements_delta";
  const crInput = { recovery_record_operation_id: id }, crPort = createStandardDriftChangeRequest({ targetRoot, observeContext, readCurrent: () => instance,
    readRecovery: () => ({ record_operation_id: id, choice, review: { session_id: "S001", cycle_id: "C001", review_operation_id: id, evaluation_operation_id: id, evaluation_sha256: H },
      transition: { after_context_sha256: recoveredContext.context_sha256 }, report: { split_recommendation: { impact: "high" }, rationale: "Fixture recovery authority only." } }) });
  for (const bad of [{ ...crInput, path: "baseline/current.md" }, { ...crInput, module: "untrusted.mjs" }, { recovery_record_operation_id: "forged" }])
    assert.throws(() => assertStandardOperationInput("drift_change_request_record", bad), /STANDARD_OPERATION_INPUT_INVALID/);
  choice = "new_cycle"; await assert.rejects(crPort.prepare(instance, crInput), /STANDARD_CHANGE_REQUEST_RECOVERY_STALE/); choice = "requirements_delta";
  pass("CR activity refuses authored paths/code/identities and a recovery choice for another action");
  const crPrepared = await crPort.prepare(instance, crInput);
  assert.equal(crPrepared.plan.change_request_id, "CR-002"); assert.equal(artifacts.read(crPath).sha256, crBefore.sha256);
  await assert.rejects(crPort.apply(instance, crPrepared, { expectPlan: crPrepared.plan_sha256, assertAuthorized() {} }), cause => cause.code === "STANDARD_CHANGE_REQUEST_EXPLICIT_EFFECT_REQUIRED" && cause.effect_status === "no_effect");
  const substituted = structuredClone(crPrepared); substituted.plan.changes[0].path = "baseline/current.md";
  await assert.rejects(crPort.apply(instance, substituted, { write: true, expectPlan: substituted.plan_sha256, assertAuthorized() {} }), /STANDARD_CHANGE_REQUEST_EXPLICIT_EFFECT_REQUIRED/);
  assert.equal(artifacts.ownerPending(), false);
  await assert.rejects(crPort.apply(instance, crPrepared, { write: true, expectPlan: crPrepared.plan_sha256, assertAuthorized() { throw Error("CR_DENIED"); } }), /CR_DENIED/);
  assert.equal(artifacts.ownerPending(), false); assert.equal(artifacts.read(crPath).sha256, crBefore.sha256);
  const altered = createProjectArtifactStore({ targetRoot, existingOnly: true });
  try { const row = altered.getArtifact(crPath); altered.upsertArtifact({ ...row, classification_reason: "intervening-CR-metadata" }); } finally { altered.close(); }
  await assert.rejects(crPort.apply(instance, crPrepared, { write: true, expectPlan: crPrepared.plan_sha256, assertAuthorized() {} }), /STANDARD_CHANGE_REQUEST_PREVIEW_CHANGED/);
  assert.equal(artifacts.ownerPending(), false); assert.equal(artifacts.read(crPath).sha256, crBefore.sha256);
  pass("CR review is read-only; denied grants and metadata-only changes refuse before any effects");
  const restored = createProjectArtifactStore({ targetRoot, existingOnly: true });
  try { const row = restored.getArtifact(crPath); restored.upsertArtifact({ ...row, classification_reason: expectedCrMetadata.classification_reason }); } finally { restored.close(); }
  const freshCr = await crPort.prepare(instance, crInput), writtenCr = await crPort.apply(instance, freshCr, { write: true, expectPlan: freshCr.plan_sha256, assertAuthorized() {} });
  assertStandardOperationOutput(writtenCr); assert.equal(writtenCr.effect_status, "confirmed", JSON.stringify(writtenCr)); assert.equal(writtenCr.facts.drift_check_completed, false);
  assert.equal(writtenCr.observations.decision, "pending"); assert.equal(writtenCr.observations.new_cycle_required, true);
  assert.ok(artifacts.read(crPath).content.startsWith(crBefore.content));
  const retainedMetadata = createProjectArtifactStore({ targetRoot, existingOnly: true, readOnly: true });
  try { assert.deepEqual(classification(retainedMetadata.getArtifact(crPath)), expectedCrMetadata); } finally { retainedMetadata.close(); }
  await assert.rejects(crPort.prepare(instance, crInput), /STANDARD_CHANGE_REQUEST_RECOVERY_STALE/);
  assert.equal(artifacts.ownerPending(), false);
  pass("real CR CAS preserves old entries and metadata, leaves scope acceptance pending, and refuses reusing its consumed context");
  const partial = await request(4), database = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot }));
  try { database.exec("CREATE TRIGGER fixture_abort_recovery BEFORE INSERT ON artifacts WHEN NEW.path = 'CURRENT-STATE.md' BEGIN SELECT RAISE(ABORT, 'fixture recovery abort'); END"); } finally { database.close(); }
  const unknown = await port.apply(instance, partial, { write: true, expectPlan: partial.plan_sha256, assertAuthorized() {} });
  assert.equal(unknown.outcome, "reconciliation_required"); assert.deepEqual(unknown.facts, {}); assert.deepEqual(unknown.observations.committed, ["parking-lot.md"]);
  assert.equal(artifacts.ownerPending(), true);
  pass("real partial SQLite writes retain uncertainty and local ownership without a success fact");

  await verifyPartialChangeRequest();
  await verifyPartialChangeRequest("db-only", true);
  for (const mode of ["files", "dual", "db-only", "partial", "projection"]) await verifyDriftCyclePort({ mode, owned, pass });

  // Independent project: an unobserved required projection is not reconciled by
  // resetting the previous project's retained effect owner.
  const projectedRoot = createFreshStandardWorkflowFixture("dual", owned), projectOps = createStandardWorkflowOperations({ targetRoot: projectedRoot });
  const session = await projectOps.prepareSession({ session_id: "S001", session_branch: "S001-projection", objective: "Verify exact required recovery projection observations" });
  assert.equal((await projectOps.initializeSession(session, { write: true, expectPlan: session.plan_sha256 })).outcome, "completed");
  await prepareFixtureMode(projectOps, "required projection");
  const projectedProduct = path.join(projectedRoot, "product"); fs.mkdirSync(projectedProduct); fs.writeFileSync(path.join(projectedProduct, "app.mjs"), "// fixture\n");
  execFileSync("git", ["-C", projectedRoot, "add", "."], { windowsHide: true, stdio: "pipe" });
  execFileSync("git", ["-C", projectedRoot, "-c", "core.hooksPath=NUL", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture projection precondition"], { windowsHide: true, stdio: "pipe" });
  const observe = () => readStandardDriftContext({ targetRoot: projectedRoot, productRoot: projectedProduct, productFiles: ["app.mjs"], productSha256: H });
  assert.equal((await observe()).context.mode, "COMMITTING");
  pass("required projection fixture explicitly admits and applies its mode before its first drift-context read");
  const projected = createStandardDriftRecovery({ targetRoot: projectedRoot, observeContext: observe, readCurrent: () => instance,
    async readEvaluation() { const row = await observe(); return { ...row, evaluation_sha256: H, output: { facts: { drift_present: true, drift_context_complete: true },
      observations: { report: { changes: ["Projection fixture finding."] } } } }; } });
  const pp = await projected.prepare(instance, input, "op_" + "9".repeat(40));
  const body = { review: pp.plan, choice: "new_cycle", decision_operation_id: id, prepared_at_ms: Date.now() }, projectionPlan = { ...body, can_apply: true, plan_sha256: shadowHash(body) };
  const destination = path.join(projectedRoot, "docs/audit/parking-lot.md"), originalWrite = fs.writeFileSync;
  let lost;
  fs.writeFileSync = function(file, ...args) { if (typeof file === "string" && path.resolve(file) === destination) return; return originalWrite.call(this, file, ...args); };
  try { lost = await projected.apply(instance, projectionPlan, { write: true, expectPlan: projectionPlan.plan_sha256, assertAuthorized() {} }); }
  finally { fs.writeFileSync = originalWrite; }
  assert.equal(lost.outcome, "reconciliation_required"); assert.deepEqual(lost.facts, {});
  assert.equal(lost.observations.reason_code, "STANDARD_RECOVERY_PROJECTION_UNCONFIRMED");
  assert.equal(createStandardWorkflowArtifacts({ targetRoot: projectedRoot }).ownerPending(), true);
  pass("a silently lost required dual projection retains uncertainty after canonical effects instead of claiming confirmation");
  const audit = path.join(projectedRoot, "docs/audit"), backup = path.join(projectedRoot, "docs/recovery-projection-fixture");
  assert.equal(path.dirname(fs.realpathSync(audit)), path.join(projectedRoot, "docs"));
  assert.equal(path.dirname(path.resolve(backup)), path.join(projectedRoot, "docs")); assert.equal(fs.existsSync(backup), false);
  fs.renameSync(audit, backup);
  try {
    try { fs.symlinkSync(backup, audit, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (!["EPERM", "EACCES"].includes(error.code)) throw error; skips.push("projection link preflight: host link privilege unavailable"); }
    if (fs.lstatSync(audit, { throwIfNoEntry: false })?.isSymbolicLink()) {
      await assert.rejects(projected.prepare(instance, input, id), /AGENT_RUN_PATH_REDIRECT/);
      pass("required projections reject a redirected directory before reading the evaluation or writing canonical state");
    }
  } finally {
    if (fs.lstatSync(audit, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(audit);
    fs.renameSync(backup, audit);
  }
  }
} finally {
  for (const directory of owned) {
    const resolved = fs.realpathSync(directory); assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith("aidn-standard-")); fs.rmSync(resolved, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ status: "PASS", checks, skips, proof: "offline-synthetic-human-capture-real-git-and-canonical-ports", real_human_channel: "NOT_RUN", native: "NOT_RUN", full_standard_workflow: "NOT_YET_DELIVERED" }));

async function verifyPartialChangeRequest(mode = "files", admissionOnly = false) {
  const instance = { instance_id: "port_fixture", instance_sha256: H }, crInput = { recovery_record_operation_id: id };
  const faultRoot = createFreshStandardWorkflowFixture(mode, owned), faultOps = createStandardWorkflowOperations({ targetRoot: faultRoot });
  const faultArtifacts = createStandardWorkflowArtifacts({ targetRoot: faultRoot }), faultProduct = path.join(faultRoot, "product");
  fs.mkdirSync(faultProduct); fs.writeFileSync(path.join(faultProduct, "app.mjs"), "// fault fixture\n");
  const faultGit = args => execFileSync("git", ["-C", faultRoot, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
  const faultCommit = label => { faultGit(["add", "."]); faultGit(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", label]); };
  const faultSession = await faultOps.prepareSession({ session_id: "S001", session_branch: "S001-cr-fault", objective: "Check partial CR effects" });
  assert.equal((await faultOps.initializeSession(faultSession, { write: true, expectPlan: faultSession.plan_sha256 })).outcome, "completed");
  const faultMode = await faultOps.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await faultOps.applyMode(faultMode, { write: true, expectPlan: faultMode.plan_sha256 })).outcome, "completed"); faultCommit("fixture fault mode");
  const faultRefresh = await faultOps.prepareCycleContext({ session_id: "S001" });
  assert.equal((await faultOps.refreshCycleContext(faultRefresh, { write: true, expectPlan: faultRefresh.plan_sha256 })).outcome, "completed"); faultCommit("fixture fault context");
  const faultCycle = await faultOps.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "cr-fault", objective: "Check partial CR effects",
    continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-cr-fault" });
  assert.equal((await faultOps.initializeCycle(faultCycle, { write: true, expectPlan: faultCycle.plan_sha256 })).outcome, "completed");
  if (admissionOnly) {
    const row = faultArtifacts.read("cycles/C001-feature-cr-fault/change-requests.md");
    await faultArtifacts.withLocalEffectOwner(H, async () => {
      faultArtifacts.compareAndSwap({ path: row.path, before_sha256: row.sha256, after: row.content + "\n## CR-019\n- Impact: high\n" });
      faultArtifacts.project([row.path]); return { effect_status: "confirmed" };
    });
    if (mode === "db-only") fs.writeFileSync(path.join(faultRoot, "docs/audit/CURRENT-STATE.md"), "# Stale projection\nactive_session: S999\nactive_cycle: C999\n");
  }
  const faultObserve = () => readStandardDriftContext({ targetRoot: faultRoot, productRoot: faultProduct, productFiles: ["app.mjs"], productSha256: artifactContentHash(fs.readFileSync(path.join(faultProduct, "app.mjs"))) });
  const faultContext = await faultObserve(), faultPath = "cycles/C001-feature-cr-fault/change-requests.md";
  if (admissionOnly) {
    const admission = await runRequirementsDeltaAdmitUseCase({ targetRoot: faultRoot, mode: "COMMITTING" });
    const observed = { action: admission.action, reason_code: admission.reason_code, active_session: admission.active_session,
      active_cycle: admission.active_cycle, branch_kind: admission.branch_kind, mapped_cycle: admission.mapped_cycle };
    assert.equal(admission.active_cycle, faultContext.context.cycle_id, JSON.stringify(observed));
    assert.equal(admission.action, "proceed_requirements_delta", JSON.stringify(observed));
    assert.equal(admission.mapped_cycle.session_owner, "S001");
    assert.deepEqual(admission.detected_impacts, ["high"]);
    if (mode === "db-only") {
      const database = resolveRuntimeSqliteFile({ targetRoot: faultRoot }), retained = database + ".fixture-unavailable";
      assert.ok(path.resolve(database).startsWith(path.resolve(faultRoot) + path.sep)); assert.equal(path.dirname(retained), path.dirname(database));
      fs.renameSync(database, retained);
      try { const unavailable = await runRequirementsDeltaAdmitUseCase({ targetRoot: faultRoot, mode: "COMMITTING" });
        assert.equal(unavailable.action, "stop_canonical_runtime"); assert.equal(unavailable.ok, false); }
      finally { fs.renameSync(retained, database); }
    }
    pass(`requirements admission uses the actual canonical ${mode} cycle without a visible projection`); return;
  }
  const faultPort = createStandardDriftChangeRequest({ targetRoot: faultRoot, observeContext: faultObserve, readCurrent: () => instance,
    readRecovery: () => ({ choice: "requirements_delta", review: { session_id: "S001", cycle_id: "C001", review_operation_id: id, evaluation_operation_id: id, evaluation_sha256: H },
      transition: { after_context_sha256: faultContext.context_sha256 }, report: { split_recommendation: { impact: "low" } } }) });
  const faultPlan = await faultPort.prepare(instance, crInput), faultBefore = faultArtifacts.read(faultPath), faultCurrent = faultArtifacts.read("CURRENT-STATE.md");
  const renameFile = fs.renameSync;
  let partialCr;
  try {
    fs.renameSync = (from, to) => { if (path.resolve(to) === path.join(faultRoot, "docs/audit/CURRENT-STATE.md")) throw Error("fixture CR second write denied"); return renameFile(from, to); };
    partialCr = await faultPort.apply(instance, faultPlan, { write: true, expectPlan: faultPlan.plan_sha256, assertAuthorized() {} });
  } finally { fs.renameSync = renameFile; }
  assert.equal(partialCr.effect_status, "unknown"); assert.equal(partialCr.outcome, "reconciliation_required"); assert.deepEqual(partialCr.facts, {});
  assert.deepEqual(partialCr.observations.committed, [faultPath]); assert.notEqual(faultArtifacts.read(faultPath).sha256, faultBefore.sha256);
  assert.equal(faultArtifacts.read("CURRENT-STATE.md").sha256, faultCurrent.sha256); assert.equal(faultArtifacts.ownerPending(), true);
  await assert.rejects(faultPort.apply(instance, faultPlan, { write: true, expectPlan: faultPlan.plan_sha256, assertAuthorized() {} }), /STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED/);
  pass("a real partial CR write retains an unknown receipt and owner, publishes no success and blocks another effect");

}
