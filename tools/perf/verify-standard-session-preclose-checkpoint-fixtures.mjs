import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardSessionPrecloseCheckpoint } from "../../src/application/runtime/standard-session-preclose-checkpoint.mjs";
import { runGatingEvaluateUseCase } from "../../src/application/runtime/gating-evaluate-use-case.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7) ?? "files";
const fault = process.argv.includes("--grant-after-git");
const agedPlan = process.argv.includes("--aged-plan");
if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_MODE_INVALID");
const owned = [], temp = fs.realpathSync(os.tmpdir()), H = "a".repeat(64), id = n => "op_" + String(n).repeat(40);
const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
let checks = 0, complete = false;
const pass = name => { checks++; console.log("PASS " + name); };
try {
  for (const kind of ["input", "plan", "output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-session-preclose-checkpoint-${kind}.v1.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  } pass("three closed checkpoint schemas use supported vocabulary");
  const root = createFreshStandardWorkflowFixture(mode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const operations = createStandardWorkflowOperations({ targetRoot: root });
  let prepared = await operations.prepareSession({ session_id: "S001", session_branch: "S001-preclose", objective: "Checkpoint authenticated workflow postimages before session R05" });
  assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  prepared = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  git(root, "add", "."); git(root, "commit", "--allow-empty", "-m", "test: establish component session preconditions");
  // Source writer/closure authority is injected only in this component fixture.
  // Runtime CAS, canonical metadata, optional projections, Git and reload are real.
  const names = ["sessions/S001.md", "CURRENT-STATE.md", "snapshots/context-snapshot.md", "baseline/current.md", "baseline/history.md", "index.md"];
  await artifacts.withLocalEffectOwner(H, async () => {
    for (const name of names) {
      const before = artifacts.read(name, { required: true });
      artifacts.compareAndSwap({ path: name, before_sha256: before.sha256, after: before.content + "\n<!-- fixture final workflow postimage -->\n" });
    }
    artifacts.project(names); return { effect_status: "confirmed" };
  });
  const instance = { instance_id: "preclose_fixture", instance_sha256: H }, input = { closure_operation_id: id(1) };
  const parent = git(root, "rev-parse", "HEAD"), branch = git(root, "branch", "--show-current");
  let source = { closure_operation_id: input.closure_operation_id, session_id: "S001", branch, parent_head: parent, completion_cycle_id: null,
    material_sha256: H, postimages: names.map(name => ({ path: name, sha256: artifacts.read(name).sha256, metadata_sha256: artifacts.metadataHash(name) })) };
  let preparationClock = agedPlan ? Date.now() - 86400000 : null;
  const checkpoint = createStandardSessionPrecloseCheckpoint({ targetRoot: root, readCurrent: () => instance, readSource: async () => structuredClone(source), now: () => preparationClock ?? Date.now() });
  const cacheFile = path.join(root, ".aidn/runtime/cache/reload-state.json"), priorCache = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile) : null;
  const beforeDocuments = source.postimages.map(row => ({ ...row }));
  const before = await checkpoint.prepare(instance, input, id(2)); assert.equal(before.can_apply, true);
  if (agedPlan) { preparationClock = null; assert.ok(Date.now() - before.plan.prepared_at_ms >= 86400000); }
  assert.equal(git(root, "rev-parse", "HEAD"), parent); assert.equal(artifacts.ownerPending(), false);
  assert.equal(before.plan.git.files.length, mode === "db-only" ? 0 : names.length);
  pass("preview derives only the finite canonical postimage set and performs no Git effect");
  await assert.rejects(checkpoint.apply(instance, before, { write: true, expectPlan: H, assertAuthorized() {} }), { effect_status: "no_effect" });
  pass("wrong exact plan refuses before mutation");
  await assert.rejects(checkpoint.apply(instance, before, { expectPlan: before.plan_sha256, assertAuthorized() {} }), { code: "STANDARD_SESSION_PRECLOSE_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
  await assert.rejects(checkpoint.apply(instance, before, { write: true, expectPlan: before.plan_sha256, assertAuthorized() { throw Object.assign(Error("fixture denied"), { code: "FIXTURE_PRECLOSE_DENIED" }); } }), { code: "FIXTURE_PRECLOSE_DENIED", effect_status: "no_effect" });
  assert.equal(git(root, "rev-parse", "HEAD"), parent); assert.equal(artifacts.ownerPending(), false);
  pass("missing effect intent and denied live grant leave Git and ownership unchanged");
  const rogue = path.join(root, "foreign.txt"); fs.writeFileSync(rogue, "foreign\n");
  await assert.rejects(checkpoint.prepare(instance, input, id(2)), { code: "STANDARD_SESSION_PRECLOSE_CHECKPOINT_FOREIGN_CHANGE" });
  fs.unlinkSync(rogue); pass("foreign untracked paths cannot enter the checkpoint");
  source.postimages[0].sha256 = "b".repeat(64);
  await assert.rejects(checkpoint.prepare(instance, input, id(2)), { code: "STANDARD_SESSION_PRECLOSE_CHECKPOINT_POSTIMAGE_CHANGED" });
  source.postimages = beforeDocuments; pass("changed canonical postimage refuses");
  const result = await checkpoint.apply(instance, before, { write: true, expectPlan: before.plan_sha256, assertAuthorized() {
    if (fault && git(root, "rev-parse", "HEAD") !== parent) throw Object.assign(Error("FIXTURE_GRANT_LOST"), { code: "FIXTURE_GRANT_LOST" });
  } });
  if (fault) {
    assert.notEqual(mode, "db-only", "after-Git fault needs a physical commit");
    assert.equal(result.outcome, "reconciliation_required"); assert.equal(result.effect_status, "unknown"); assert.deepEqual(result.facts, {});
    assert.equal(artifacts.ownerPending(), true); assert.notEqual(git(root, "rev-parse", "HEAD"), parent);
    assert.deepEqual(fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile) : null, priorCache);
    pass("grant loss after real commit retains unknown ownership and does not refresh cache");
  } else {
    assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.facts.session_preclose_checkpoint_completed, true);
    assert.equal(result.facts.session_close_completed, false); assert.equal(artifacts.ownerPending(), false);
    if (agedPlan) pass("day-old session preclose checkpoint applies with current accepted source, canonical postimages and grant");
    assert.equal(git(root, "status", "--porcelain"), "");
    const nextHead = git(root, "rev-parse", "HEAD");
    if (mode === "db-only") { assert.equal(nextHead, parent); assert.equal(result.observations.git.status, "no_change"); }
    else { assert.notEqual(nextHead, parent); assert.deepEqual(git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split(/\r?\n/).sort(), names.map(n => "docs/audit/" + n).sort()); }
    assert.equal(result.observations.reload.head_commit, nextHead); pass("real finite checkpoint and reload confirm without closing the session or inventing a DB-only commit");
    const gate = await runGatingEvaluateUseCase({ targetRoot: root, runtimeDir: fileURLToPath(new URL("../../tools/perf/", import.meta.url)), args: {
      cache: ".aidn/runtime/cache/reload-state.json", eventFile: ".aidn/runtime/perf/workflow-events.ndjson", indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
      stateMode: mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", thresholdFiles: 3, thresholdMinutes: 45,
      mode: "COMMITTING", runId: "", reloadDecision: "", reloadFallback: "", reloadReasonCodes: "", emitEvent: false, completeDriftCheck: true } });
    assert.equal(gate.levels.level2.active_signals.includes("scope_growth"), false); pass("unchanged R05 policy observes no pending governance scope growth after checkpoint");
  }
  for (const row of beforeDocuments) { assert.equal(artifacts.read(row.path).sha256, row.sha256); assert.equal(artifacts.metadataHash(row.path), row.metadata_sha256); }
  assert.match(artifacts.read("sessions/S001.md").content, /state: OPEN/); pass("checkpoint preserves canonical bytes, metadata and open session lifecycle");
  complete = true; console.log(JSON.stringify({ ok: true, checks, mode, fault, source_authority: "injected-component-only", native: "NOT_RUN", composed_model: "NOT_RUN" }));
} finally {
  if (complete) { for (const root of owned) { const resolved = path.resolve(root); if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith("aidn-standard-fresh-")) throw Error("FIXTURE_CLEANUP_SCOPE"); fs.rmSync(resolved, { recursive: true, force: true }); }
    console.log(JSON.stringify({ cleanup: "completed", roots: owned.length })); }
  else console.error(JSON.stringify({ cleanup: "retained-after-failure", roots: owned }));
}
