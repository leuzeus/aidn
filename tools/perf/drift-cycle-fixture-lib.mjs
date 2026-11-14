import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardDriftCycle } from "../../src/application/runtime/standard-drift-cycle.mjs";
import { readStandardDriftContext } from "../../src/application/runtime/standard-drift-report.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { assertStandardOperationOutput, assertStandardOperationInput } from "../../src/core/workflow/standard-operation-contracts.mjs";

const H = "a".repeat(64), id = "op_" + "a".repeat(40), instance = { instance_id: "port_fixture", instance_sha256: H };
const classification = row => Object.fromEntries(["kind", "family", "subtype", "session_id", "cycle_id", "classification_reason", "gate_relevance", "source_mode", "legacy_origin"].map(key => [key, row[key]]));
export async function verifyDriftCyclePort({ mode, owned, pass, agedPlan = false }) {
  const selected = mode === "partial" ? "files" : mode === "projection" ? "dual" : mode;
  const targetRoot = createFreshStandardWorkflowFixture(selected, owned);
  let planClock = null;
  const operations = createStandardWorkflowOperations({ targetRoot, now: () => planClock ?? Date.now() });
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), productRoot = path.join(targetRoot, "product");
  fs.mkdirSync(productRoot); fs.writeFileSync(path.join(productRoot, "app.mjs"), "// deterministic cycle fixture\n");
  const git = args => execFileSync("git", ["-C", targetRoot, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
  const session = await operations.prepareSession({ session_id: "S001", session_branch: "S001-recovery-cycle", objective: "Recover a confirmed scope deviation" });
  assert.equal((await operations.initializeSession(session, { write: true, expectPlan: session.plan_sha256 })).outcome, "completed");
  const modePlan = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await operations.applyMode(modePlan, { write: true, expectPlan: modePlan.plan_sha256 })).outcome, "completed");
  git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture recovery cycle precondition"]);
  const names = ["sessions/S001.md", "CURRENT-STATE.md", "snapshots/context-snapshot.md", "RUNTIME-STATE.md"], expected = new Map();
  if (selected !== "files") {
    const store = createProjectArtifactStore({ targetRoot, existingOnly: true });
    try { for (const name of names) { const row = store.getArtifact(name); store.upsertArtifact({ ...row, classification_reason: "fixture-cycle-annotation", gate_relevance: 1 }); expected.set(name, classification(store.getArtifact(name))); } }
    finally { store.close(); }
  }
  const observe = () => readStandardDriftContext({ targetRoot, productRoot, productFiles: ["app.mjs"], productSha256: artifactContentHash(fs.readFileSync(path.join(productRoot, "app.mjs"))) });
  const original = await observe(); let refreshed, checkpointed;
  const selectedSource = { review: { session_id: "S001" }, report: { current_objective: "Recover the newly accepted goal with explicit cycle planning" },
    transition: { after_context_sha256: original.context_sha256 } };
  let fault = false;
  // Provenance alone is doubled here. The integrated mixed-host corpus checks
  // the retained MAC/native/human chain. All business observations/effects below
  // use actual application and canonical ports on the disposable client.
  const port = createStandardDriftCycle({ targetRoot, operations, readCurrent: () => instance, now: () => planClock ?? Date.now(),
    observeContext: async () => { const context = await observe(); if (fault && context.context.cycle_id === "C001") throw Error("fixture post-effect observation unavailable"); return context; },
    readSource: (_instance, operation) => operation === "drift_recovery_context_refresh" ? selectedSource
      : { ...selectedSource, source_operation_id: id, transition: (operation === "drift_recovery_checkpoint_observe" ? refreshed : checkpointed).observations.causal_transition } });
  const input = { recovery_operation_id: id }, cycleInput = { checkpoint_operation_id: id, cycle_id: "C001", cycle_type: "spike", title: "scoped-recovery" };
  const originalPrepare = port.prepare.bind(port, instance);
  const prepare = async (...args) => {
    planClock = agedPlan ? Date.now() - 86400000 : null;
    try { const prepared = await originalPrepare(...args);
      if (agedPlan && prepared.can_apply) assert.ok(Date.now() - prepared.plan.prepared_at_ms >= 86400000);
      return prepared;
    } finally { planClock = null; }
  };
  for (const bad of [{ ...cycleInput, objective: "unapproved" }, { ...cycleInput, session_id: "S999" }, { ...cycleInput, module: "untrusted.mjs" }])
    assert.throws(() => assertStandardOperationInput("drift_recovery_cycle_initialize", bad));
  const contextPlan = await prepare("drift_recovery_context_refresh", input);
  assert.equal(contextPlan.can_apply, true, JSON.stringify(contextPlan));
  await assert.rejects(port.apply(instance, contextPlan, { write: true, expectPlan: contextPlan.plan_sha256, assertAuthorized() { throw Error("DENIED"); } }), /DENIED/);
  assert.equal(artifacts.ownerPending(), false);
  refreshed = await port.apply(instance, contextPlan, { write: true, expectPlan: contextPlan.plan_sha256, assertAuthorized() {} });
  assertStandardOperationOutput(refreshed); assert.equal(refreshed.effect_status, "confirmed", JSON.stringify(refreshed));
  assert.equal(refreshed.facts.drift_recovery_context_refreshed, true); assert.equal(refreshed.facts.drift_check_completed, false);
  assert.equal(refreshed.observations.causal_transition.before_context_sha256, original.context_sha256);
  pass(`cycle recovery ${mode}: admitted runtime refresh requires authorization and retains a causal context transition`);
  if (agedPlan) pass(`cycle recovery ${mode}: original day-old context plan applies with current source and grant`);
  const checkpointInput = { context_operation_id: id };
  let checkpointPlan = await prepare("drift_recovery_checkpoint_observe", checkpointInput);
  if (selected !== "db-only") {
    assert.equal(checkpointPlan.can_apply, false); assert.equal(checkpointPlan.reason_code, "STANDARD_RECOVERY_GIT_CHECKPOINT_REQUIRED");
    if (mode === "files") {
      const previous = git(["rev-parse", "HEAD"]).trim(), outside = path.join(targetRoot, "outside-fixture.txt");
      fs.writeFileSync(outside, "unexpected external commit\n"); git(["add", "."]);
      git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture unexpected external checkpoint"]);
      await assert.rejects(prepare("drift_recovery_checkpoint_observe", checkpointInput), /STANDARD_RECOVERY_CHECKPOINT_SCOPE_CHANGED/);
      assert.ok(owned.includes(targetRoot)); assert.equal(fs.realpathSync(targetRoot), targetRoot);
      git(["reset", "--mixed", previous]); fs.unlinkSync(outside);
    }
    // Represents the external human Git action; the application only observes
    // this checkpoint and never runs an automatic add/commit on the project.
    git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture external recovery checkpoint"]);
    checkpointPlan = await prepare("drift_recovery_checkpoint_observe", checkpointInput);
  }
  assert.equal(checkpointPlan.can_apply, true, JSON.stringify(checkpointPlan));
  checkpointed = await port.apply(instance, checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256, assertAuthorized() {} });
  assertStandardOperationOutput(checkpointed); assert.equal(checkpointed.effect_status, "no_effect"); assert.equal(checkpointed.facts.drift_recovery_checkpoint_verified, true);
  if (agedPlan) pass(`cycle recovery ${mode}: original day-old checkpoint plan observes current Git without effects`);
  let cyclePlan = await prepare("drift_recovery_cycle_initialize", cycleInput);
  assert.equal(cyclePlan.can_apply, true, JSON.stringify(cyclePlan));
  assert.equal(cyclePlan.plan.inner.plan.contract_version, "standard-cycle-initialize-plan.v2");
  const branch = git(["branch", "--show-current"]).trim();
  await assert.rejects(port.apply(instance, cyclePlan, { write: true, expectPlan: cyclePlan.plan_sha256, assertAuthorized() { throw Error("CYCLE_DENIED"); } }), /CYCLE_DENIED/);
  assert.equal(git(["branch", "--show-current"]).trim(), branch); assert.equal(artifacts.ownerPending(), false);
  if (mode === "dual") {
    const store = createProjectArtifactStore({ targetRoot, existingOnly: true });
    try { const row = store.getArtifact("CURRENT-STATE.md"); store.upsertArtifact({ ...row, classification_reason: "intervening-cycle-metadata" }); } finally { store.close(); }
    await assert.rejects(port.apply(instance, cyclePlan, { write: true, expectPlan: cyclePlan.plan_sha256, assertAuthorized() {} }), /STANDARD_PREVIEW_CHANGED/);
    assert.equal(git(["branch", "--show-current"]).trim(), branch); assert.equal(artifacts.ownerPending(), false);
    const restored = createProjectArtifactStore({ targetRoot, existingOnly: true });
    try { const row = restored.getArtifact("CURRENT-STATE.md"); restored.upsertArtifact({ ...row, classification_reason: expected.get("CURRENT-STATE.md").classification_reason }); } finally { restored.close(); }
    cyclePlan = await prepare("drift_recovery_cycle_initialize", cycleInput);
  }
  if (mode === "partial") fault = true;
  const writeFile = fs.writeFileSync;
  let result;
  try {
    if (mode === "projection") fs.writeFileSync = (file, ...args) => String(file).replaceAll("\\", "/").endsWith("cycles/C001-spike-scoped-recovery/brief.md") ? undefined : writeFile(file, ...args);
    result = await port.apply(instance, cyclePlan, { write: true, expectPlan: cyclePlan.plan_sha256, assertAuthorized() {} });
  } finally { fs.writeFileSync = writeFile; }
  assertStandardOperationOutput(result);
  if (["partial", "projection"].includes(mode)) {
    assert.equal(result.outcome, "reconciliation_required", JSON.stringify(result)); assert.equal(result.effect_status, "unknown"); assert.deepEqual(result.facts, {});
    assert.equal(artifacts.ownerPending(), true); assert.equal(git(["branch", "--show-current"]).trim(), "spike/C001-scoped-recovery");
    const fence = artifacts.resourceFence().read(), ownerPath = path.join(targetRoot, ".aidn/runtime/standard-workflow/effects.lock");
    assert.equal(fence.record.state, "held");
    const owner = fs.readFileSync(ownerPath), head = git(["rev-parse", "HEAD"]);
    let grantChecks = 0;
    await assert.rejects(port.apply(instance, cyclePlan, {
      write: true, expectPlan: cyclePlan.plan_sha256, assertAuthorized() { grantChecks++; },
    }), { code: "STANDARD_RESOURCE_FENCE_RECONCILIATION_REQUIRED", effect_status: "no_effect" });
    assert.equal(grantChecks, 0);
    assert.deepEqual(artifacts.resourceFence().read(), fence);
    assert.deepEqual(fs.readFileSync(ownerPath), owner);
    assert.deepEqual(git(["rev-parse", "HEAD"]), head);
    assert.equal(git(["branch", "--show-current"]).trim(), "spike/C001-scoped-recovery");
    pass(`cycle recovery ${mode}: unconfirmed post-effects retain ownership and cannot publish success or repeat effects`); return;
  }
  assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.effect_status, "confirmed");
  assert.equal(result.facts.drift_recovery_cycle_initialized, true); assert.equal(result.facts.cycle_dor_ready, false); assert.equal(result.facts.drift_check_completed, false);
  if (agedPlan) pass(`cycle recovery ${mode}: original day-old initializer confirms canonical postimages under current source and grant`);
  assert.equal(result.observations.causal_transition.before_context_sha256, checkpointed.observations.causal_transition.after_context_sha256);
  assert.equal(artifacts.ownerPending(), false); assert.equal(git(["branch", "--show-current"]).trim(), "spike/C001-scoped-recovery");
  if (selected !== "files") {
    const store = createProjectArtifactStore({ targetRoot, existingOnly: true, readOnly: true });
    try { for (const [name, value] of expected) assert.deepEqual(classification(store.getArtifact(name)), value, name); } finally { store.close(); }
  }
  const after = await observe(); assert.equal(after.context.git.other_changes.count, 0);
  await assert.rejects(prepare("drift_recovery_cycle_initialize", cycleInput), /STANDARD_RECOVERY_CYCLE_SOURCE_STALE/);
  pass(`cycle recovery ${mode}: actual cycle creation preserves metadata/projections, leaves DoR and R05 pending and refuses stale reuse`);
}
