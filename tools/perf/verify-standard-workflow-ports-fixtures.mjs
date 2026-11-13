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
import { checkShadowJson, shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { assertProcessDispatchRecord } from "../../src/core/workflow/process-dispatch-record.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { runReloadCheckUseCase } from "../../src/application/runtime/reload-check-use-case.mjs";
import { verifyStandardSessionGitPlanValidity } from "./standard-session-git-plan-validity-fixture-lib.mjs";
import { verifyStandardExistingCycleEntry } from "./verify-standard-existing-cycle-entry-fixtures.mjs";

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
  await check("long canonical SPEC produces a valid signed returned dispatch without writing", async () => {
    const target = client(), audit = path.join(target, "docs/audit");
    const spec = path.join(audit, "SPEC.md");
    fs.appendFileSync(spec, "\n" + "<!-- synthetic specification padding -->\n".repeat(420));
    assert.equal(checkShadowJson(fs.readFileSync(spec, "utf8")), "JSON_LIMIT");
    const before = git(target, "status", "--porcelain"), head = git(target, "rev-parse", "HEAD");
    const cache = ".aidn/runtime/cache/reload-state.json", cacheFile = path.join(target, cache);
    const output = await createStandardWorkflowOperations({ targetRoot: target }).reload();
    const signer = createOperationJournalSigner(() => Buffer.alloc(32, 1)), digest = "a".repeat(64);
    const returned = signer.seal({
      contract_version: "process-dispatch-record.v2", operation_id: "op_" + "a".repeat(40), revision: 3, phase: "returned",
      instance_id: "reload-fixture", scope_id: "reload-fixture", model_sha256: digest, intent_sha256: digest, preview_sha256: digest,
      authority_sha256: digest, runtime_sha256: digest, physical_root_sha256: digest, operation_owner_sha256: digest,
      process_identity: { platform: "win32", host: "fixture", pid: 1, creation: "fixture" },
      context_before_sha256: digest, context_after_sha256: digest, leases: [], local_owner_intentions: [],
      output, output_sha256: shadowHash(output),
    });
    assertProcessDispatchRecord(signer.verify(returned));
    assertStandardOperationOutput(output);
    const paths = ["baseline/current.md", "snapshots/context-snapshot.md", "CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md"];
    const documents = paths.map(name => ({ path: name, sha256: artifactContentHash(fs.readFileSync(path.join(audit, name), "utf8")) }));
    assert.deepEqual(output.observations.documents, documents);
    assert.deepEqual(output.evidence_refs, documents.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.sha256 })));
    assert.equal(output.outcome, "completed");
    assert.equal(output.effect_status, "no_effect");
    assert.deepEqual(output.facts, { context_loaded: true });
    const expected = await runReloadCheckUseCase({ targetRoot: target, args: { cache, stateMode: "files", stateModeExplicit: true,
      indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: false } });
    const observed = output.observations.reload;
    assert.deepEqual(observed, { ...expected, ts: observed.ts });
    assert.equal(observed.cache_written, false);
    assert.equal(fs.existsSync(cacheFile), false);
    assert.equal(git(target, "status", "--porcelain"), before);
    assert.equal(git(target, "rev-parse", "HEAD"), head);
  });
  await check("real reload and admissions are read-only", async () => {
    const status = git(root, "status", "--porcelain"), head = git(root, "rev-parse", "HEAD");
    const result = await ops.reload(); assert.equal(result.outcome, "completed"); assert.equal(result.observations.documents.length, 6);
    assert.ok(result.observations.documents.every(row => row.path && /^[a-f0-9]{64}$/.test(row.sha256)));
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
    const registered = new Map(bindings.map(binding => [binding.id, binding]));
    assert.equal(registered.size, bindings.length);
    const published = new Set();
    for (const name of ["standard-workflow.v1", "standard-workflow-startup.v1", "standard-workflow-cycle-create.v1"]) {
      const catalog = JSON.parse(fs.readFileSync(new URL(`../../package/catalogs/${name}.json`, import.meta.url), "utf8"));
      for (const { binding } of catalog.bindings) {
        assert.deepEqual(registered.get(binding.id), binding, name + ": " + binding.id);
        published.add(binding.id);
      }
    }
    // Standalone components and compatibility bindings have their own fixtures.
    assert.deepEqual([...registered.keys()].filter(id => !published.has(id)).sort(),
      ["cycle_entry_choice_activate", "cycle_entry_choice_checkpoint", "cycle_entry_choice_decision", "cycle_entry_choice_record", "cycle_entry_focus_checkpoint", "cycle_entry_selected_checkpoint", "cycle_entry_selected_focus",
        "cycle_work_evaluate", "session_admit", "session_pr_merge_observe", "session_pr_post_merge_wait", "session_pr_review_observe"]);
    for (const id of ["cycle_entry_observe", "cycle_entry_admit", "cycle_plan_adopt"]) {
      assert.equal(published.has(id), true); assert.equal(registered.get(id).effect_class, "read-only");
    }
    const legacyAdmission = registered.get("session_admit"), entryAdmission = registered.get("session_entry_admit");
    assert.equal(legacyAdmission.revision, 1); assert.equal(legacyAdmission.input_contract, "standard-empty-input.v1");
    assert.equal(legacyAdmission.output_contract, "standard-operation-output.v1");
    assert.equal(entryAdmission.input_contract, "standard-session-entry-input.v1");
    assert.equal(entryAdmission.output_contract, "standard-session-entry-output.v1");
    assert.equal(entryAdmission.effect_class, "read-only"); assert.equal(entryAdmission.executor_kind, "deterministic");
    const closeAdmission = bindings.find(row => row.id === "session_close_admit");
    assert.equal(closeAdmission.executor_kind, "deterministic"); assert.equal(closeAdmission.effect_class, "read-only");
    assert.equal(closeAdmission.skill_id, "close-session"); assert.deepEqual(closeAdmission.allowed_modes, ["THINKING", "EXPLORING", "COMMITTING"]);
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
    const fence = artifacts.resourceFence().read();
    assert.equal(fence.record.state, "held");
    await assert.rejects(bound.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 }),
      { code: "STANDARD_RESOURCE_FENCE_RECONCILIATION_REQUIRED", effect_status: "no_effect" });
    assert.deepEqual(artifacts.resourceFence().read(), fence);
  });
  await check("concurrent local owners cannot duplicate session effects", async () => {
    const target = client(), first = createStandardWorkflowOperations({ targetRoot: target }), second = createStandardWorkflowOperations({ targetRoot: target });
    const prepared = await first.prepareSession(input), running = first.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 });
    await assert.rejects(second.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 }),
      { code: "STANDARD_RESOURCE_FENCE_RECONCILIATION_REQUIRED", effect_status: "no_effect" });
    assert.equal((await running).outcome, "completed");
    assert.equal((await second.reconcileSession(prepared)).outcome, "completed");
  });
  await check("elapsed valid session plan applies while redirected Git context still refuses", async () => {
    const target = client(); let clock = Date.now(); const bound = createStandardWorkflowOperations({ targetRoot: target, now: () => clock });
    const prepared = await bound.prepareSession(input); clock += 86400000;
    assert.equal((await bound.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).effect_status, "confirmed");
    const previous = process.env.GIT_DIR;
    try { process.env.GIT_DIR = path.join(target, ".git"); await assert.rejects(bound.reload(), { code: "STANDARD_GIT_ENV_SCOPE_CONFLICT" }); }
    finally { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous; }
    assert.equal(git(target, "branch", "--show-current"), input.session_branch); assert.equal(fs.existsSync(path.join(target, "docs/audit/sessions/S001.md")), true);
  });
  if (!process.argv.includes("--base-ports-only")) await verifyStandardSessionGitPlanValidity(name => { passed++; process.stdout.write(`PASS ${name}\n`); });
  if (!process.argv.includes("--base-ports-only")) passed += await verifyStandardExistingCycleEntry();
  process.stdout.write(JSON.stringify({ status: "PASS", checks: passed, native: "NOT_RUN", installed_archive: "NOT_RUN" }) + "\n");
} finally {
  for (const root of owned) {
    const physical = fs.realpathSync(root);
    if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith("aidn-standard-ports-")) throw new Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(physical, { recursive: true, force: true });
  }
}
