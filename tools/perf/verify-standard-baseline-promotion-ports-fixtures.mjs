import { verifyBaselinePromotionHook } from "./baseline-promotion-hook-fixture-lib.mjs";
import assert from "node:assert/strict";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardBaselinePromotionReview } from "../../src/application/runtime/standard-baseline-promotion-review.mjs";
import { createStandardBaselinePromotion } from "../../src/application/runtime/standard-baseline-promotion.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { baselinePromotionPaths } from "../../src/core/workflow/standard-baseline-promotion.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { validateJsonSchemaDefinition, validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import outputSchema from "../../src/core/contracts/workflow-definition/standard-baseline-promotion-output.v1.schema.json" with { type: "json" };
const selected = process.argv.find(v => v.startsWith("--mode="))?.slice(7) ?? "files";
if (!["files", "dual", "db-only", "partial", "projection", "source", "instance", "revoked", "revoked-post"].includes(selected)) throw Error("PROMOTION_FIXTURE_MODE_INVALID");
const mode = selected === "partial" ? "db-only" : selected === "projection" ? "dual" : ["source", "instance", "revoked", "revoked-post"].includes(selected) ? "files" : selected;
const finalFault = process.argv.find(value => value.startsWith("--final-hook-fault="))?.slice("--final-hook-fault=".length);
if (finalFault !== undefined && (!process.argv.includes("--final-hook") || !["event", "suffix", "projection", "grant_after"].includes(finalFault))) throw Error("PROMOTION_FINAL_FAULT_INVALID");
if (process.argv.includes("--final-hook") && (!["files", "dual", "db-only"].includes(selected) || finalFault === "suffix" && mode === "files" || finalFault === "projection" && mode !== "dual")) throw Error("PROMOTION_FINAL_MODE_INVALID");
const promotionCheckpoint = process.argv.includes("--promotion-checkpoint"), keepCycleBranch = process.argv.includes("--keep-cycle-branch");
const objectiveCompletion = process.argv.includes("--objective-completion");
if (objectiveCompletion && (!promotionCheckpoint || !keepCycleBranch || finalFault !== undefined)) throw Error("PROMOTION_OBJECTIVE_COMPLETION_FLAGS_INVALID");
const agedCheckpoint = process.argv.includes("--aged-checkpoint");
const agedHook = process.argv.includes("--aged-hook");
if (agedHook && !process.argv.includes("--final-hook")) throw Error("PROMOTION_AGED_HOOK_ARGUMENT_INVALID");
if (agedCheckpoint && !promotionCheckpoint) throw Error("PROMOTION_AGED_CHECKPOINT_ARGUMENT_INVALID");
const checkpointFault = process.argv.find(value => value.startsWith("--promotion-checkpoint-fault="))?.slice("--promotion-checkpoint-fault=".length);
if (checkpointFault !== undefined && (!promotionCheckpoint || mode !== "files" || !["grant_after_git", "foreign_parent", "foreign_path"].includes(checkpointFault))) throw Error("PROMOTION_CHECKPOINT_FAULT_INVALID");
if (promotionCheckpoint && !process.argv.includes("--final-hook") || keepCycleBranch && !promotionCheckpoint) throw Error("PROMOTION_CHECKPOINT_FIXTURE_FLAGS_INVALID");
const owned = [], temp = fs.realpathSync(os.tmpdir()), H = "a".repeat(64), op = c => "op_" + c.repeat(40);
let completed = false;
let checks = 0; const pass = name => { checks++; if (!process.argv.includes("--json")) console.log("PASS " + name); };
try {
  const root = createFreshStandardWorkflowFixture(mode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), operations = createStandardWorkflowOperations({ targetRoot: root });
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  let plan = await operations.prepareSession({ session_id: "S001", session_branch: "S001-promotion", objective: "Qualify canonical baseline promotion" });
  assert.equal((await operations.initializeSession(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  plan = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" }); assert.equal((await operations.applyMode(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture selected session mode");
  plan = await operations.prepareCycleContext({ session_id: "S001" }); assert.equal((await operations.refreshCycleContext(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture cycle context"); assert.equal((await operations.admitCycle()).outcome, "completed");
  plan = await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "promotion", objective: objectiveCompletion ? "Qualify a separately scoped canonical baseline promotion" : "Qualify canonical baseline promotion", continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-promotion" });
  assert.equal(plan.can_apply, true, JSON.stringify(plan)); assert.equal((await operations.initializeCycle(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  const cyclePath = "cycles/C001-feature-promotion", product = path.join(root, "product/app.mjs"); fs.mkdirSync(path.dirname(product)); fs.writeFileSync(product, "export const value = 3;\n");
  if (objectiveCompletion) for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(root, "product", "fixture-mixed-signal-" + i + ".txt"), "Tracked clean fixture signal input.\n");
  // Explicit fixture terminal preconditions, not proof of the still separate
  // human decision/completed-cycle-close host chain or promotion final hook.
  await artifacts.withLocalEffectOwner(H, async () => {
    const status = artifacts.read(cyclePath + "/status.md"), current = artifacts.read("CURRENT-STATE.md"), trace = artifacts.read(cyclePath + "/traceability.md"), runtime = artifacts.read("RUNTIME-STATE.md");
    const values = [[status, status.content.replace(/^state:.*$/m, "state: DONE").replace(/^usage_matrix_state:.*$/m, "usage_matrix_state: VERIFIED")],
      [current, current.content.replace(/^active_cycle:.*$/m, "active_cycle: none").replace(/^cycle_branch:.*$/m, "cycle_branch: none").replace(/^branch_kind:.*$/m, "branch_kind: " + (keepCycleBranch ? "cycle" : "session"))],
      [trace, "# Traceability\n\n| REQ | TEST | Evidence |\n| REQ-001 | TEST-001 | fixture completion precondition |\n"],
      [runtime, runtime.content.replace(/^repair_layer_status:.*$/m, "repair_layer_status: ok").replace(/^current_state_freshness:.*$/m, "current_state_freshness: ok")]];
    for (const [row, after] of values) artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(row.path), after });
    artifacts.project(values.map(([row]) => row.path)); return { effect_status: "confirmed" };
  });
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture terminal and review preconditions");
  const retainedBranch = git("branch", "--show-current"); if (!keepCycleBranch) { git("switch", "S001-promotion"); git("merge", "--ff-only", retainedBranch); }
  const productHash = () => artifactContentHash(fs.readFileSync(product));
  const request = { contract_version: "standard-baseline-promotion-request.v1", decision_operation_id: op("b"), closure_operation_id: op("a"), instance_id: "fixture", scope_id: "fixture", cycle_id: "C001", cycle_path: cyclePath,
    product_sha256: productHash(), baseline_sha256: artifacts.read("baseline/current.md").sha256, history_sha256: artifacts.read("baseline/history.md").sha256, version: "v0.3", summary: "Explicit fixture promotion request", evidence_refs: [{ ref: "fixture:operator", sha256: H }] };
  const closure = { operation_id: op("a"), instance_id: "fixture", scope_id: "fixture", cycle_id: "C001", cycle_path: cyclePath, product_sha256: productHash(),
    output: { operation_ref: "cycle_close_finalize", outcome: "completed", effect_status: "confirmed", facts: { cycle_close_completed: true, cycle_retained: true }, observations: { target_state: "DONE" } } };
  const instance = { instance_id: "fixture", scope_id: "fixture", instance_sha256: H }, input = { decision_operation_id: op("b") };
  let instanceChanged = false;
  const agedPlan = process.argv.includes("--aged-plan"); let preparationClock = agedPlan ? Date.now() - 86400000 : null;
  const promotion = createStandardBaselinePromotion({ targetRoot: root, now: () => preparationClock ?? Date.now(), readRequest: async () => ({ request, closure }), observeProduct: productHash,
    readCurrent: () => instanceChanged ? { ...instance, instance_sha256: "b".repeat(64) } : instance });
  const review = createStandardBaselinePromotionReview({ readClosure: async () => ({ ...closure, session_id: "S001" }), promotion });
  const reviewInput = { contract_version: "standard-baseline-promotion-review-input.v1", closure_operation_id: closure.operation_id };
  const beforeReview = baselinePromotionPaths.map(name => artifacts.read(name).sha256), reviewed = await review.prepare(instance, reviewInput);
  assert.equal(reviewed.can_apply, true, JSON.stringify(reviewed)); await review.assertFresh(instance, reviewed.plan);
  assert.equal(reviewed.plan.review.current_version, artifacts.read("baseline/current.md").content.match(/^baseline:[ \t]*([^\r\n]+)$/m)[1].trim());
  assert.deepEqual(baselinePromotionPaths.map(name => artifacts.read(name).sha256), beforeReview);
  await artifacts.withLocalEffectOwner("9".repeat(64), async () => {
    assert.equal((await review.prepare(instance, reviewInput)).reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED"); return { effect_status: "no_effect" };
  });
  pass("actual canonical promotion review reads the baseline version without effects and respects an outstanding owner");
  const prewrite = await preWriteAdmit({ targetRoot: root, skill: "promote-baseline", promotionCycleId: request.cycle_id });
  assert.equal(prewrite.ok, true, JSON.stringify({ admission: prewrite.admission_status, blocking_reasons: prewrite.blocking_reasons, blocking_findings: prewrite.blocking_findings, checks: prewrite.checks }));
  const historyProjectionPath = path.join(root, "docs/audit/baseline/history.md");
  const historyProjection = fs.existsSync(historyProjectionPath) ? fs.readFileSync(historyProjectionPath) : null;
  const original = baselinePromotionPaths.map(name => artifacts.read(name)), preview = await promotion.prepare(instance, input);
  assert.equal(preview.can_apply, true, JSON.stringify(preview));
  if (agedPlan) { preparationClock = null; assert.ok(Date.now() - preview.plan.prepared_at_ms >= 86400000); }
  await assert.rejects(promotion.apply(instance, preview, { expectPlan: preview.plan_sha256 }), { code: "STANDARD_PROMOTION_EXPLICIT_EFFECT_REQUIRED" });
  await assert.rejects(promotion.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized: () => { throw Object.assign(Error("fixture denied"), { code: "FIXTURE_DENIED" }); } }), { code: "FIXTURE_DENIED" });
  for (const before of original) assert.equal(artifacts.read(before.path).sha256, before.sha256); assert.equal(artifacts.ownerPending(), false);
  pass("preview and denied or missing write intent preserve every canonical baseline document");
  if (selected === "partial") { const db = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot: root })); try { db.exec("CREATE TRIGGER fixture_abort_baseline_history BEFORE INSERT ON artifacts WHEN NEW.path='baseline/history.md' BEGIN SELECT RAISE(ABORT,'fixture partial baseline'); END"); } finally { db.close(); } }
  const write = fs.writeFileSync; let result, grantCalls = 0;
  try {
    if (selected === "projection") fs.writeFileSync = (file, ...args) => typeof file === "string" && path.resolve(file) === path.resolve(root, "docs/audit/baseline/history.md") ? undefined : write(file, ...args);
    const apply = () => promotion.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized: () => {
      grantCalls++; if (selected === "revoked" && grantCalls === 2 || selected === "revoked-post" && grantCalls === 3) throw Object.assign(Error("fixture grant revoked"), { code: "FIXTURE_REVOKED" });
      if (selected === "source") fs.writeFileSync(product, "export const value = 4;\n"); if (selected === "instance") instanceChanged = true;
    } });
    if (["source", "instance", "revoked"].includes(selected)) {
      await assert.rejects(apply(), { code: selected === "source" ? "STANDARD_PROMOTION_PRODUCT_CHANGED" : selected === "revoked" ? "FIXTURE_REVOKED" : "STANDARD_PROMOTION_SOURCE_STALE" });
      for (const before of original) assert.equal(artifacts.read(before.path).sha256, before.sha256); assert.equal(artifacts.ownerPending(), false);
      pass("a fresh grant cannot conceal changed product or process revision before canonical effects");
    } else result = await apply();
  } finally { fs.writeFileSync = write; }
  if (result) {
    assert.deepEqual(validateJsonSchemaDefinition(outputSchema, "#", { contractKind: "workflow-definition" }), []); assert.deepEqual(validateJsonSchema(result, outputSchema, "$", { contractKind: "workflow-definition" }), []);
    if (["partial", "projection", "revoked-post"].includes(selected)) {
      assert.equal(result.outcome, "reconciliation_required", JSON.stringify(result)); assert.equal(result.effect_status, "unknown"); assert.deepEqual(result.facts, {}); assert.equal(artifacts.ownerPending(), true);
      assert.equal(result.observations.committed.length, selected === "partial" ? 1 : 5); assert.equal((await promotion.prepare(instance, input)).reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
      pass("partial canonical effects or required projection loss retain ownership and no completion facts");
    } else {
      assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.effect_status, "confirmed"); assert.deepEqual(result.facts, { baseline_recorded: true, baseline_promotion_completed: false });
      assert.equal(result.observations.promotion_hook, "pending"); assert.equal(result.observations.committed.length, 5); assert.equal(artifacts.ownerPending(), false);
      assert.match(artifacts.read("baseline/current.md").content, /^baseline: v0.3$/m); assert.ok(artifacts.read("baseline/history.md").content.startsWith(original[1].content));
      if (mode === "db-only") {
        if (historyProjection === null) assert.equal(fs.existsSync(historyProjectionPath), false);
        else assert.deepEqual(fs.readFileSync(historyProjectionPath), historyProjection, "DB-only must preserve an existing bootstrap projection without rewriting it");
      }
      pass("five actual metadata-preserving canonical writes record the chosen baseline with final hook pending");
      if (agedPlan) pass("day-old promotion plan applies after current source, grant and preimage reconstruction");
      const after = baselinePromotionPaths.map(name => artifacts.read(name).sha256);
      await assert.rejects(promotion.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized: () => {} }));
      assert.deepEqual(baselinePromotionPaths.map(name => artifacts.read(name).sha256), after); assert.equal(artifacts.ownerPending(), false);
      pass("a repeated raw apply cannot append history or repeat confirmed effects");
    }
  }
  if (process.argv.includes("--final-hook")) {
    assert.equal(result?.outcome, "completed"); await verifyBaselinePromotionHook({ root, mode, artifacts, promotion, instance, preview, result, git, fault: finalFault, promotionCheckpoint, checkpointFault, agedCheckpoint, agedHook, objectiveCompletion });
    if (agedCheckpoint && !checkpointFault) pass("day-old baseline Git checkpoint applies with current accepted source, postimages and grant");
    if (agedHook && !checkpointFault && !finalFault) pass("day-old baseline finalization plan confirms the actual checkpoint and canonical completion");
    pass(checkpointFault ? "promotion checkpoint refusal or unknown effect cannot complete the promotion skill" : finalFault ? "actual checkpoint with lost confirmation retains unknown effects and prevents another checkpoint" : "actual selected promotion checkpoint and five completion writes preserve append-only history and cannot repeat");
  }
  completed = true;
  console.log(JSON.stringify({ status: "PASS", checks, mode: selected, proof: "canonical-baseline-promotion-component", human_and_closure_authority: "fixture", common_process_host: "NOT_RUN", objective_completion: objectiveCompletion ? "CONTROLLED_READER_COMPONENT_NOT_AUTHENTICATED_R05_SOURCE" : "NOT_RUN", promotion_checkpoint: promotionCheckpoint ? "actual-application-component" : "NOT_RUN", cycle_branch_retained: keepCycleBranch, promotion_checkpoint_fault: checkpointFault ?? null, final_hook_fault: finalFault ?? null, promotion_final_hook: process.argv.includes("--final-hook") && !checkpointFault ? "actual-application-component" : "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally { if (process.argv.includes("--retain-always") || !completed && process.argv.includes("--retain-on-failure")) { console.error(JSON.stringify({ proof_class: "offline-diagnostic-only", retained_business_roots: owned })); } else for (const folder of owned) { const resolved = fs.realpathSync(folder); assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith("aidn-standard-fresh-")); fs.rmSync(resolved, { recursive: true, force: true }); } }
