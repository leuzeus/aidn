#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardHumanDecisions } from "../../src/application/runtime/standard-workflow-human-decisions.mjs";
import { recoveryBoundary } from "../../src/application/runtime/standard-drift-recovery.mjs";
import { createStandardDriftRecovery } from "../../src/application/runtime/standard-drift-recovery.mjs";
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
function humanFixture(operationId = id, withDelta = false) {
  const records = new Map(), sources = new Map();
  const inbox = { read: id => ({ record: records.get(id) ?? null, content_sha256: records.has(id) ? shadowHash(records.get(id)) : null }),
    compareAndSwap(record, before) { assertDecisionInbox(record); assert.equal(before, records.has(record.inbox_id) ? shadowHash(records.get(record.inbox_id)) : null);
      records.set(record.inbox_id, structuredClone(record)); return { projection: "not_requested" }; } };
  const human = createStandardHumanDecisions({ inbox, signer, projectionRequired: false, source: {
    read: ({ sourceRef }) => sources.get(sourceRef) ?? null,
    verify: ({ source, sourceRef }) => sources.has(sourceRef) && sourceRef !== "unverified"
      ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" },
  } });
  const p = structuredClone(plan); p.review_operation_id = operationId;
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
const f = humanFixture(); f.sources.set("wrong", { ...f.claim("new_cycle"), question_sha256: H });
await assert.rejects(f.human.reserve(f.record, "wrong"), /PROCESS_HUMAN_QUESTION_CHANGED/);
f.sources.set("wrong", f.claim("requirements_delta")); await assert.rejects(f.human.reserve(f.record, "wrong"), /PROCESS_HUMAN_CHOICE_NOT_OFFERED/);
f.sources.set("unverified", f.claim("new_cycle")); await assert.rejects(f.human.reserve(f.record, "unverified"), /PROCESS_HUMAN_NOT_AUTHENTICATED/);
const old = { ...f.claim("new_cycle"), contract_version: "human-mode-decision.v1", choice: "THINKING" };
f.sources.set("wrong", old); await assert.rejects(f.human.reserve(f.record, "wrong"), /PROCESS_HUMAN_SOURCE_INVALID/);
pass("wrong questions, mode sources, unoffered choices and unverified identities cannot authorize recovery");
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
try {
  const targetRoot = createFreshStandardWorkflowFixture("dual", owned), operations = createStandardWorkflowOperations({ targetRoot });
  const preparedSession = await operations.prepareSession({ session_id: "S001", session_branch: "S001-recovery", objective: "Verify authorized recovery documentation and exact effects" });
  assert.equal((await operations.initializeSession(preparedSession, { write: true, expectPlan: preparedSession.plan_sha256 })).outcome, "completed");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), productRoot = path.join(targetRoot, "product"); fs.mkdirSync(productRoot); fs.writeFileSync(path.join(productRoot, "app.mjs"), "// fixture\n");
  const git = args => execFileSync("git", ["-C", targetRoot, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
  git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture precondition"]);
  const observeContext = () => readStandardDriftContext({ targetRoot, productRoot, productFiles: ["app.mjs"], productSha256: artifactContentHash(fs.readFileSync(path.join(productRoot, "app.mjs"))) });
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
  const partial = await request(4), database = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot }));
  try { database.exec("CREATE TRIGGER fixture_abort_recovery BEFORE INSERT ON artifacts WHEN NEW.path = 'CURRENT-STATE.md' BEGIN SELECT RAISE(ABORT, 'fixture recovery abort'); END"); } finally { database.close(); }
  const unknown = await port.apply(instance, partial, { write: true, expectPlan: partial.plan_sha256, assertAuthorized() {} });
  assert.equal(unknown.outcome, "reconciliation_required"); assert.deepEqual(unknown.facts, {}); assert.deepEqual(unknown.observations.committed, ["parking-lot.md"]);
  assert.equal(artifacts.ownerPending(), true);
  pass("real partial SQLite writes retain uncertainty and local ownership without a success fact");

  // Independent project: an unobserved required projection is not reconciled by
  // resetting the previous project's retained effect owner.
  const projectedRoot = createFreshStandardWorkflowFixture("dual", owned), projectOps = createStandardWorkflowOperations({ targetRoot: projectedRoot });
  const session = await projectOps.prepareSession({ session_id: "S001", session_branch: "S001-projection", objective: "Verify exact required recovery projection observations" });
  await projectOps.initializeSession(session, { write: true, expectPlan: session.plan_sha256 });
  const projectedProduct = path.join(projectedRoot, "product"); fs.mkdirSync(projectedProduct); fs.writeFileSync(path.join(projectedProduct, "app.mjs"), "// fixture\n");
  execFileSync("git", ["-C", projectedRoot, "add", "."], { windowsHide: true, stdio: "pipe" });
  execFileSync("git", ["-C", projectedRoot, "-c", "core.hooksPath=NUL", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture projection precondition"], { windowsHide: true, stdio: "pipe" });
  const observe = () => readStandardDriftContext({ targetRoot: projectedRoot, productRoot: projectedProduct, productFiles: ["app.mjs"], productSha256: H });
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
} finally {
  for (const directory of owned) {
    const resolved = fs.realpathSync(directory); assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith("aidn-standard-")); fs.rmSync(resolved, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ status: "PASS", checks, skips, proof: "offline-synthetic-human-capture-real-git-and-canonical-ports", real_human_channel: "NOT_RUN", native: "NOT_RUN", full_standard_workflow: "NOT_YET_DELIVERED" }));
