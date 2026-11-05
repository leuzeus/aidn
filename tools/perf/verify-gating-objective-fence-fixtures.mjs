#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Isolate the delayed observation and artifact doubles in a separate loader
// realm/process. The evaluator, policies, finalizer and event append are real.
// This is effect-fence component evidence, not canonical/actor qualification.
if (!process.argv.includes("--child")) {
  const child = spawnSync(process.execPath, [import.meta.filename, "--child", ...process.argv.slice(2)],
    { encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 1048576 });
  process.stdout.write(child.stdout ?? ""); process.stderr.write(child.stderr ?? "");
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aidn-objective-fence-")));
const base = new URL("../../src/application/runtime/", import.meta.url);
const replacements = {
  [new URL("gating-observation-service.mjs", base).href]: "export const collectGatingObservations = options => globalThis.objectiveFenceFixture.observe(options);",
  [new URL("standard-workflow-artifacts.mjs", base).href]: "export const standardFail = code => { throw Object.assign(Error(code), { code }); }; export const createStandardWorkflowArtifacts = () => globalThis.objectiveFenceFixture.artifacts;",
  [new URL("workflow-runtime-service.mjs", base).href]: `export * from ${JSON.stringify(new URL("workflow-runtime-service.mjs?fence-original", base).href)};
    export const runWorkflowRuntimeJsonScript = () => ({ decision: "incremental", fallback: false, reason_codes: [] });`,
};
const loader = `const replacements = ${JSON.stringify(replacements)};
export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  return Object.hasOwn(replacements, result.url)
    ? { url: 'data:text/javascript,' + encodeURIComponent(replacements[result.url]), shortCircuit: true } : result;
}`;
register("data:text/javascript," + encodeURIComponent(loader), import.meta.url);
const { runGatingEvaluateUseCase } = await import(new URL("gating-evaluate-use-case.mjs", base));
const { createStandardDriftFinalization } = await import(new URL("standard-drift-finalization.mjs", base));
const { shadowHash } = await import("../../src/core/workflow/shadow-json.mjs");
const H = "a".repeat(64), op = "op_" + "a".repeat(40);
const objectives = { session_objective: "Learn through an explicitly admitted bounded SPIKE",
  cycle_objective: "Determine whether a bounded prototype is useful" };
const alignment = { contract_version: "standard-drift-objective-disposition.v1", decision_operation_id: op,
  evaluation_operation_id: op, evaluation_sha256: H, context_sha256: H, review_sha256: H, question_sha256: H,
  source_sha256: H, receipt_sha256: H, inbox_id: "decision_" + "a".repeat(40), authority_id: "fixture_user",
  source_event_id: "fixture_event", ...objectives, rationale: "Exact fixture opinion", prepared_at_ms: 100 };
const eventFile = path.join(root, "events.ndjson"), prefix = Buffer.from('{"event":"preserved_prefix"}\n');
const args = () => ({ cache: "cache.json", eventFile, indexSyncCheckFile: "sync.json", indexFile: "index.sqlite",
  indexBackend: "auto", stateMode: "files", stateModeExplicit: true, mode: "THINKING", thresholdFiles: 3,
  thresholdMinutes: 45, reloadDecision: "incremental", reloadFallback: "false", reloadReasonCodes: "",
  emitEvent: true, completeDriftCheck: true, runId: "fixture_fence" });
const observations = () => ({ sessionObjective: objectives.session_objective, cycleGoal: objectives.cycle_objective,
  changedFiles: [], latestDriftMs: null, noChangeFastPath: false, indexSyncCheckAbsolute: "fixture:sync",
  indexSyncCheckExists: false, indexSyncTargetMatch: false, indexSyncInSync: true, fallbackRecentCount: 0,
  indexSyncDriftLevel: null, repairLayerOpenCount: 0, repairLayerBlocking: false,
  repairLayerSeverityCounts: {}, repairLayerTopFindings: [], repairLayerObserved: true });
let checks = 0;
let completed = false;
const pass = name => { checks++; console.log("PASS " + name); };
try {
  const git = spawnSync("git", ["-C", root, "-c", "core.hooksPath=NUL", "init", "-b", "fixture"],
    { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(git.status, 0, git.stderr);
  if (!process.argv.includes("--report-only")) {
    for (const scenario of ["nominal", "revoked", "expired", "replaced", "goals", "scope", "stop", "l3", "preview", "json-only"]) {
      const selected = process.argv.find(value => value.startsWith("--case="))?.slice(7);
      if (selected && scenario !== selected) continue;
      fs.writeFileSync(eventFile, prefix);
      let reads = 0, verifications = 0, authorized = true, clock = 100;
      globalThis.objectiveFenceFixture = { async observe() {
        reads++;
        // A real asynchronous turn lets the observation settle after authority
        // was checked. Mutations represent external revocation/expiry/change.
        await new Promise(resolve => setImmediate(resolve));
        const value = observations();
        if (reads === 2) {
          if (scenario === "revoked") authorized = false;
          if (scenario === "expired") clock = 300101;
          if (scenario === "goals") value.cycleGoal = "A substituted independent goal";
          if (scenario === "scope") value.changedFiles = ["a", "b", "c", "d"];
          if (scenario === "stop") value.canonicalIntentFailureReason = "REQUIRED_ARTIFACT_MISSING";
          if (scenario === "l3") value.repairLayerBlocking = true;
        }
        return value;
      } };
      const verifyObjectiveAlignment = async () => {
        verifications++;
        assert.equal(authorized, true, "fixture authorization revoked");
        assert.ok(clock - alignment.prepared_at_ms <= 300000, "fixture disposition expired");
        return { ...alignment, ...(scenario === "replaced" && reads === 2 ? { source_event_id: "replacement" } : {}) };
      };
      const input = args();
      if (scenario === "preview") { input.emitEvent = false; input.completeDriftCheck = false; }
      if (scenario === "json-only") input.objectiveAlignment = alignment;
      const run = () => runGatingEvaluateUseCase({ targetRoot: root, runtimeDir: root, args: input,
        ...(scenario === "json-only" ? {} : { verifyObjectiveAlignment }) });
      if (scenario === "nominal") {
        const result = await run(); assert.equal(result.result, "ok"); assert.equal(reads, 2); assert.equal(verifications, 2);
        const bytes = fs.readFileSync(eventFile); assert.deepEqual(bytes.subarray(0, prefix.length), prefix);
        const event = JSON.parse(bytes.subarray(prefix.length));
        assert.equal(event.event, "drift_check_completed"); assert.equal(event.objective_alignment_sha256, shadowHash(alignment));
      } else if (scenario === "json-only") {
        const result = await run(); assert.equal(result.result, "warn"); assert.equal(verifications, 0);
        assert.equal(JSON.parse(fs.readFileSync(eventFile).subarray(prefix.length)).event, "drift_check_evaluated");
      } else {
        const reason = scenario === "revoked" ? /authorization revoked/ : scenario === "expired" ? /disposition expired/ : /STANDARD_OBJECTIVE_ALIGNMENT_GATE_CHANGED/;
        let failure;
        try { await run(); } catch (error) { failure = error; }
        console.log(JSON.stringify({ scenario, reads, verifications, event_bytes: fs.statSync(eventFile).size,
          prefix_bytes: prefix.length, refusal: failure?.message ?? null }));
        assert.ok(failure, `Missing rejection; event bytes=${fs.statSync(eventFile).size}`);
        assert.match(failure.message, reason); assert.deepEqual(fs.readFileSync(eventFile), prefix);
        if (["revoked", "expired", "replaced"].includes(scenario)) { assert.equal(reads, 2); assert.equal(verifications, 2); }
      }
      pass(`owned evaluator ${scenario}: event effect and preserved prefix verified`);
    }
  }
  for (const scenario of ["preview", "checkpoint", "missing", "revoked", "expired", "replaced", "goals", "scope", "stop", "l3", "json-only", "effect-revoked"]) {
    fs.writeFileSync(eventFile, prefix);
    let reads = 0, verifications = 0, authorized = true, clock = 100, effectChecks = 0;
    globalThis.objectiveFenceFixture = { async observe() {
      reads++; await new Promise(resolve => setImmediate(resolve));
      const value = observations(); value.latestDriftMs = Date.now();
      if (reads === 2) {
        if (scenario === "revoked") authorized = false;
        if (scenario === "expired") clock = 300101;
        if (scenario === "goals") value.cycleGoal = "Changed goal";
        if (scenario === "scope") value.changedFiles = ["a", "b", "c", "d"];
        if (scenario === "stop") value.canonicalIntentFailureReason = "REQUIRED_ARTIFACT_MISSING";
        if (scenario === "l3") value.repairLayerBlocking = true;
      }
      return value;
    } };
    const input = { ...args(), emitEvent: ["checkpoint", "effect-revoked"].includes(scenario), completeDriftCheck: false };
    if (scenario === "json-only") input.readObjectiveCompletion = alignment;
    const run = () => runGatingEvaluateUseCase({ targetRoot: root, runtimeDir: root, args: input,
      ...(scenario === "json-only" ? {} : { readObjectiveCompletion: async () => {
        verifications++; assert.equal(authorized, true, "fixture completion revoked");
        assert.ok(clock - alignment.prepared_at_ms <= 300000, "fixture completion expired");
        return scenario === "missing" ? null : { ...alignment, ...(scenario === "replaced" && reads === 2 ? { source_event_id: "replacement" } : {}) };
      } }), assertEventAuthorized: () => { effectChecks++; assert.notEqual(scenario, "effect-revoked", "fixture effect authorization revoked"); } });
    if (["preview", "checkpoint", "missing", "json-only"].includes(scenario)) {
      const result = await run(); assert.equal(result.result, ["missing", "json-only"].includes(scenario) ? "warn" : "ok");
      if (scenario === "checkpoint") {
        const event = JSON.parse(fs.readFileSync(eventFile).subarray(prefix.length));
        assert.equal(event.event, "gating_summary"); assert.equal(event.skill, "gating-evaluate"); assert.equal(effectChecks, 1);
      } else { assert.deepEqual(fs.readFileSync(eventFile), prefix); assert.equal(effectChecks, 0); }
    } else {
      await assert.rejects(run(), scenario === "revoked" ? /completion revoked/ : scenario === "expired" ? /completion expired/
        : scenario === "effect-revoked" ? /effect authorization revoked/ : /STANDARD_OBJECTIVE_COMPLETION_GATE_CHANGED/);
      assert.deepEqual(fs.readFileSync(eventFile), prefix);
    }
    if (scenario === "preview") { assert.equal(reads, 2); assert.equal(verifications, 2); }
    if (scenario === "checkpoint") assert.equal(verifications, 3);
    pass(`completion admission ${scenario}: independent reobservation, exact proof and no synthetic completion event`);
  }
  // Exercise the production finalizer with an artifact effect spy. Its exact
  // schema/plan/owner flow and real Git ignore check run; no canonical DB claim.
  fs.mkdirSync(path.join(root, "docs/audit"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), "docs/audit/workflows/drift-reports/\n");
  for (const scenario of ["context-revocation", "context-expiry"]) {
    let reads = 0, authorized = true, time = 100, effects = 0, owners = 0;
    globalThis.objectiveFenceFixture = { observe: async () => observations(), artifacts: {
      root, describe: () => ({ state_mode: "files" }), ownerPending: () => false,
      read: () => ({ sha256: null }), withLocalEffectOwner: async (_plan, callback) => { owners++; return callback(); },
      compareAndSwap: () => { effects++; }, project: () => { effects++; },
    } };
    const instance = { instance_id: "fixture", instance_sha256: H };
    const port = createStandardDriftFinalization({ targetRoot: root, now: () => time, readCurrent: () => instance,
      readObjectiveAlignment: async () => structuredClone(alignment),
      async readEvaluation() {
        reads++; await new Promise(resolve => setImmediate(resolve));
        if (reads === 3) { if (scenario === "context-revocation") authorized = false; else time = 300101; }
        return { context: { contract_version: "standard-drift-context.v2", mode: "THINKING", branch: "fixture", head: "a".repeat(40) },
          context_sha256: H, evaluation_sha256: H, output: { facts: { drift_present: false, drift_context_complete: true, drift_recovery_required: false },
            observations: { report: {}, producer: {} } } };
      } });
    const prepared = await port.prepare(instance, { evaluation_operation_id: op }, op);
    assert.equal(prepared.can_apply, true, JSON.stringify(prepared)); assert.equal(prepared.plan.contract_version, "standard-drift-finalize-plan.v3");
    let failure, output;
    try { output = await port.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256,
      assertAuthorized: () => { assert.equal(authorized, true, "fixture authorization revoked during context read"); } }); }
    catch (error) { failure = error; }
    console.log(JSON.stringify({ scenario, reads, effects, refusal: failure?.message ?? null, output }));
    assert.ok(failure, "finalizer must refuse before report effects"); assert.equal(failure.effect_status, "no_effect");
    assert.match(failure.message, scenario === "context-revocation" ? /authorization revoked/ : /STANDARD_DRIFT_PLAN_EXPIRED/);
    assert.equal(owners, 1); assert.equal(effects, 0); assert.equal(reads, 3);
    pass(`finalizer ${scenario}: no report CAS, projection or hook`);
  }
  console.log(JSON.stringify({ status: "PASS", checks, proof: "production-effect-fences-with-delayed-observation-and-artifact-doubles",
    canonical_storage: "NOT_RUN", human: "NOT_RUN", native: "NOT_RUN", complete_standard: false }));
  completed = true;
} finally {
  assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("aidn-objective-fence-"));
  if (completed) fs.rmSync(root, { recursive: true, force: true });
  else console.error(JSON.stringify({ retained_failed_component_root: root }));
}
