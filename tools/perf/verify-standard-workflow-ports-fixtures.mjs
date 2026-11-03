#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";
import { buildCanonicalFromMarkdown } from "../../src/lib/workflow/markdown-render-lib.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const temporary = fs.realpathSync(os.tmpdir()), owned = [];
let passed = 0;
const input = { session_id: "S001", session_branch: "S001-standard", objective: "Verify standard workflow initialization" };
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
const client = mode => createStandardWorkflowFixture(mode, owned);
function check(name, body) { return Promise.resolve().then(body).then(() => { passed++; process.stdout.write(`PASS ${name}\n`); }); }
try {
  const root = client(), ops = createStandardWorkflowOperations({ targetRoot: root });
  const hookMarker = path.join(root, "unexpected-checkout-hook");
  fs.writeFileSync(path.join(root, ".git/hooks/post-checkout"), "#!/bin/sh\nprintf unexpected > unexpected-checkout-hook\n", { mode: 0o755 });
  await check("real reload and admissions are read-only", async () => {
    const status = git(root, "status", "--porcelain"), head = git(root, "rev-parse", "HEAD");
    const result = await ops.reload(); assert.equal(result.outcome, "completed"); assert.equal(result.observations.documents.length, 6);
    assert.ok(result.observations.documents.every(row => row.content && row.sha256));
    assert.equal((await ops.admitSession()).observations.lifecycle.action, "create_session_allowed");
    assert.equal(git(root, "status", "--porcelain"), status); assert.equal(git(root, "rev-parse", "HEAD"), head);
  });
  const preview = await ops.prepareSession(input);
  await check("objective data cannot inject normalized session metadata", async () => {
    const candidate = await ops.prepareSession({ ...input, objective: "Verify standard workflow  mode: COMMITTING  session_branch: S999-spoof" });
    assert.equal(candidate.can_apply, true);
    const canonical = buildCanonicalFromMarkdown(candidate.plan.changes[0].after, { relativePath: "sessions/S001.md", classification: { kind: "session", family: "normative" } });
    assert.equal(canonical.key_values.mode, "UNKNOWN");
    assert.equal(parseSessionMetadata(candidate.plan.changes[0].after).session_branch, input.session_branch);
  });
  await check("reviewable plan requires explicit effects", async () => {
    assert.equal(preview.can_apply, true); assert.equal(git(root, "branch", "--show-current"), "dev");
    assert.equal(fs.existsSync(path.join(root, "docs/audit/sessions/S001.md")), false);
    await assert.rejects(ops.initializeSession(preview), { code: "STANDARD_EXPLICIT_EFFECT_REQUIRED" });
    await assert.rejects(ops.initializeSession(preview, { write: true, expectPlan: "f".repeat(64) }), { code: "STANDARD_EXPLICIT_EFFECT_REQUIRED" });
    const altered = { ...preview, plan: { ...preview.plan, skip_admission: true } }; altered.plan_sha256 = shadowHash(altered.plan);
    await assert.rejects(ops.initializeSession(altered, { write: true, expectPlan: altered.plan_sha256 }), { code: "STANDARD_PLAN_INVALID" });
  });
  await check("real session effect and authoritative postconditions", async () => {
    const result = await ops.initializeSession(preview, { write: true, expectPlan: preview.plan_sha256 });
    assert.equal(result.outcome, "completed", JSON.stringify(result.observations)); assert.equal(result.effect_status, "confirmed");
    assert.equal(result.facts.session_mode_pending, true); assert.equal(git(root, "branch", "--show-current"), input.session_branch);
    assert.equal(fs.existsSync(hookMarker), false, "host operation must not execute project checkout hooks");
    const text = fs.readFileSync(path.join(root, "docs/audit/sessions/S001.md"), "utf8");
    assert.equal(parseSessionMetadata(text).session_branch, input.session_branch);
    assert.equal(buildCanonicalFromMarkdown(text, { relativePath: "sessions/S001.md", classification: { kind: "session", family: "normative", subtype: "session" } }).contract_status, "conformant");
    assert.equal((await ops.admitSession()).observations.lifecycle.action, "resume_current_session");
  });
  await check("reconciliation observes success without replaying effects", async () => {
    const status = git(root, "status", "--porcelain");
    assert.equal((await ops.reconcileSession(preview)).outcome, "completed");
    assert.equal(git(root, "status", "--porcelain"), status);
    await assert.rejects(ops.initializeSession(preview, { write: true, expectPlan: preview.plan_sha256 }), { code: "STANDARD_PREVIEW_CHANGED" });
    assert.equal((await ops.prepareSession({ ...input, session_id: "S002", session_branch: "S002-next" })).can_apply, false);
  });
  await check("closed typed operation bindings", () => {
    const bindings = standardWorkflowOperationBindings();
    assert.deepEqual(bindings.map(row => row.id), ["cycle_task_select", "cycle_task_work_evaluate", "cycle_task_advance", "cycle_validation_evaluate", "cycle_verification_enter", "cycle_validation_execute", "cycle_work_evaluate", "cycle_readiness_evaluate", "cycle_implementation_enter", "context_reload", "session_admit", "session_initialize", "mode_decision", "session_mode_apply", "session_start_finalize",
      "cycle_admit", "cycle_context_refresh", "cycle_initialize", "branch_cycle_audit", "cycle_checkpoint_finalize", "cycle_plan_evaluate", "cycle_plan_record", "drift_report_evaluate", "drift_check_finalize", "drift_recovery_decision", "drift_recovery_record", "drift_change_request_record", "drift_recovery_context_refresh", "drift_recovery_checkpoint_observe", "drift_recovery_cycle_initialize"]);
    for (const id of ["cycle_task_select", "cycle_task_work_evaluate", "cycle_task_advance"]) {
      const row = bindings.find(binding => binding.id === id);
      assert.equal(row.executor_kind, "deterministic"); assert.equal(row.skill_id, "start-session");
      assert.deepEqual(row.allowed_modes, ["COMMITTING"]); assert.equal(row.effect_class, id === "cycle_task_advance" ? "mutating" : "read-only");
    }
    assert.equal(bindings.find(row => row.id === "cycle_validation_evaluate").input_contract, "standard-cycle-validation-evaluate-input.v2");
    assert.equal(bindings.find(row => row.id === "cycle_validation_evaluate").revision, 2);
    const cr = bindings.find(row => row.id === "drift_change_request_record");
    assert.equal(cr.effect_class, "mutating"); assert.equal(cr.executor_kind, "deterministic"); assert.equal(cr.skill_id, "drift-check");
    assert.equal(bindings.find(binding => binding.id === "mode_decision").executor_kind, "human");
    assert.ok(bindings.every(binding => /^[a-f0-9]{64}$/.test(binding.implementation_sha256)));
  });
  await check("untrusted session input cannot select code or paths", async () => {
    for (const patch of [{ session_id: "../../escape" }, { session_branch: "-unsafe" }, { objective: "first\nsecond" }, { mode: "EXECUTE" }, { mode: "COMMITTING" }, { module: "dynamic.mjs" }])
      await assert.rejects(ops.prepareSession({ ...input, ...patch }), { code: "STANDARD_SESSION_INPUT_INVALID" });
    await assert.rejects(ops.reload({ command: "dynamic" }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
    await assert.rejects(ops.admitSession({ mode: "COMMITTING" }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
  });
  for (const mode of ["dual", "db-only"]) await check(`real ${mode} canonical session and projection policy`, async () => {
    const target = client(mode), bound = createStandardWorkflowOperations({ targetRoot: target });
    const visible = path.join(target, "docs/audit/CURRENT-STATE.md");
    fs.writeFileSync(visible, "# Stale projection\nactive_session: S999\n");
    const prepared = await bound.prepareSession(input); assert.equal(prepared.can_apply, true,
      JSON.stringify({ reason: prepared.reason_code, prewrite: prepared.admission?.prewrite?.blocking_reasons, lifecycle: prepared.admission?.lifecycle?.blocking_reasons }));
    assert.equal(prepared.plan.scope.persistence.database, true);
    const result = await bound.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 });
    assert.equal(result.outcome, "completed", JSON.stringify(result.observations));
    const canonical = createStandardWorkflowArtifacts({ targetRoot: target });
    assert.ok(canonical.read("CURRENT-STATE.md").content.includes("active_session: S001"));
    const sessionFile = path.join(target, "docs/audit/sessions/S001.md");
    assert.equal(fs.existsSync(sessionFile), mode === "dual");
    assert.equal(fs.readFileSync(visible, "utf8").includes("active_session: S999"), mode === "db-only");
    assert.equal((await bound.reconcileSession(prepared)).outcome, "completed");
  });
  await check("stale preview refuses branch and artifact effects", async () => {
    const target = client(), bound = createStandardWorkflowOperations({ targetRoot: target }), prepared = await bound.prepareSession(input);
    fs.appendFileSync(path.join(target, "docs/audit/CURRENT-STATE.md"), "\n<!-- concurrent revision -->\n");
    await assert.rejects(bound.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 }), { code: "STANDARD_PREVIEW_CHANGED" });
    assert.equal(git(target, "branch", "--show-current"), "dev");
    assert.equal(fs.existsSync(path.join(target, "docs/audit/sessions/S001.md")), false);
    assert.equal(createStandardWorkflowArtifacts({ targetRoot: target }).ownerPending(), false);
  });
  await check("missing canonical store never falls back to visible state", async () => {
    const target = client("dual"), database = resolveRuntimeSqliteFile({ targetRoot: target });
    fs.renameSync(database, database + ".retained");
    const bound = createStandardWorkflowOperations({ targetRoot: target });
    await assert.rejects(bound.admitSession(), { code: "STANDARD_CANONICAL_STORE_UNAVAILABLE" });
    assert.equal(fs.existsSync(database), false); assert.equal(git(target, "branch", "--show-current"), "dev");
  });
  await check("real partial SQLite failure retains uncertainty and blocks retry", async () => {
    const target = client("dual"), bound = createStandardWorkflowOperations({ targetRoot: target }), prepared = await bound.prepareSession(input);
    assert.equal(prepared.can_apply, true);
    const DatabaseSync = getDatabaseSync(), database = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: target }));
    try { database.exec("CREATE TRIGGER fixture_abort_state BEFORE INSERT ON artifacts WHEN NEW.path = 'CURRENT-STATE.md' BEGIN SELECT RAISE(ABORT, 'fixture state failure'); END"); }
    finally { database.close(); }
    const result = await bound.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 });
    assert.equal(result.outcome, "reconciliation_required"); assert.equal(result.effect_status, "unknown"); assert.deepEqual(result.facts, {});
    assert.deepEqual(result.observations.committed, ["sessions/S001.md"]);
    assert.equal(git(target, "branch", "--show-current"), input.session_branch);
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: target });
    assert.equal(artifacts.read("CURRENT-STATE.md").sha256, prepared.plan.changes[1].before_sha256);
    const retained = JSON.parse(fs.readFileSync(path.join(target, ".aidn/runtime/standard-workflow/effects.lock"), "utf8"));
    assert.equal(retained.contract_version, "process-local-effect-owner.v1"); assert.equal(retained.plan_sha256, prepared.plan_sha256);
    assert.equal((await bound.reconcileSession(prepared)).outcome, "reconciliation_required");
    assert.equal((await bound.admitSession()).outcome, "blocked");
    assert.equal((await bound.prepareSession({ ...input, session_id: "S002", session_branch: "S002-next" })).can_apply, false);
    await assert.rejects(bound.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 }), { code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" });
  });
  await check("concurrent local owners cannot duplicate session effects", async () => {
    const target = client(), first = createStandardWorkflowOperations({ targetRoot: target }), second = createStandardWorkflowOperations({ targetRoot: target });
    const prepared = await first.prepareSession(input), running = first.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 });
    await assert.rejects(second.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 }), { code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" });
    assert.equal((await running).outcome, "completed");
    assert.equal((await second.reconcileSession(prepared)).outcome, "completed");
  });
  await check("expired plans and redirected Git contexts refuse before effects", async () => {
    const target = client(); let clock = Date.now(); const bound = createStandardWorkflowOperations({ targetRoot: target, now: () => clock });
    const prepared = await bound.prepareSession(input); clock += 300001;
    await assert.rejects(bound.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 }), { code: "STANDARD_PLAN_EXPIRED" });
    const previous = process.env.GIT_DIR;
    try { process.env.GIT_DIR = path.join(root, ".git"); await assert.rejects(bound.reload(), { code: "STANDARD_GIT_ENV_SCOPE_CONFLICT" }); }
    finally { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous; }
    assert.equal(git(target, "branch", "--show-current"), "dev"); assert.equal(fs.existsSync(path.join(target, "docs/audit/sessions/S001.md")), false);
  });
  process.stdout.write(`PASS standard workflow ports: ${passed}; native: NOT_RUN; installed archive: NOT_RUN\n`);
} finally {
  for (const root of owned) {
    const physical = fs.realpathSync(root);
    if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith("aidn-standard-ports-")) throw new Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(physical, { recursive: true, force: true });
  }
}
