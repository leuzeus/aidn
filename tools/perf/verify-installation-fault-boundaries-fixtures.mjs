#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { planInstallation, executeInstallation } from "../../src/application/install/installation-service.mjs";
import { planCodexAssets, executeCodexAssets } from "../../src/application/install/codex-assets-service.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-installation-fault-boundaries-"));
const version = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();
const installArgs = {
  pack: "core", initDefaults: true, projectName: "neutral-fault-boundary",
  sourceBranch: "dev", skipArtifactImport: true, artifactImportStore: "file", verifyAfterInstall: true,
};
const checks = [];
const failures = [];
const target = (name) => { const root = path.join(temp, name); fs.mkdirSync(root); return root; };
function put(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const read = (root, relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (root, relative) => JSON.parse(read(root, relative));
function snapshot(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name), relative = path.relative(root, file).replace(/\\/g, "/");
      if (entry.isDirectory()) { result[relative] = "directory"; visit(file); }
      else result[relative] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
  }
  visit(root);
  return result;
}
async function install(root, extra = {}) {
  const options = { repoRoot, targetRoot: root, args: installArgs, ...extra };
  const preview = await planInstallation(options);
  assert(preview.ok, preview.errors?.join("; "));
  return executeInstallation({ ...options, dryRun: false, expectedPlanId: preview.plan_id });
}
async function check(name, run) {
  try { await run(); checks.push({ name, status: "PASS" }); }
  catch (error) { failures.push({ name, error: error.message }); checks.push({ name, status: "FAIL" }); }
}
function launchWorker(script, args, timeoutMs) {
  const child = spawn(process.execPath, [script, ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", spawnError = null, timedOut = false;
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { spawnError = error; });
  const completed = new Promise((resolve) => {
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, spawnError, timedOut, stdout, stderr });
    });
  });
  return { child, completed };
}
function workerOutput(result) {
  assert.equal(result.spawnError, null, result.spawnError?.message);
  assert.equal(result.timedOut, false, "fixture process exceeded its deadline");
  assert.equal(result.signal, null, "fixture process was terminated");
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}
let cleanup = { ok: false };
try {
  await check("default_codex_rollback_keeps_local_ownership_and_explicit_recovery", async () => {
    const root = target("default-scope");
    const originalInstructions = "# Neutral client instructions\nPreserve this project policy.\n";
    put(root, "AGENTS.md", originalInstructions);
    const installed = await install(root);
    assert(installed.ok, installed.errors?.join("; "));
    const receiptBefore = readJson(root, ".aidn/install/receipt.json");
    const localBefore = Object.fromEntries(Object.keys(receiptBefore.installation.assets)
      .map((relative) => [relative, read(root, relative)]));
    const preview = planCodexAssets({ repoRoot, targetRoot: root, action: "rollback" });
    assert(preview.ok, preview.errors?.join("; "));
    assert.equal(preview.scope, "codex-integration");
    const rolledBack = executeCodexAssets({ repoRoot, targetRoot: root, action: "rollback", dryRun: false, expectedPlanId: preview.plan_id });
    assert(rolledBack.ok, rolledBack.errors?.join("; "));
    assert.equal(read(root, "AGENTS.md"), originalInstructions);
    assert.equal(fs.existsSync(path.join(root, ".agents/skills/pr-orchestrate/SKILL.md")), false);
    for (const [relative, content] of Object.entries(localBefore)) assert.equal(read(root, relative), content, `default rollback changed local asset ${relative}`);
    const receiptAfter = readJson(root, ".aidn/install/receipt.json");
    assert.deepEqual(receiptAfter.installation, receiptBefore.installation, "default rollback must preserve local ownership and recovery lineage");
    assert.equal(readJson(root, ".aidn/config.json").install.aidnVersion, version);

    const fullPreview = await planInstallation({ repoRoot, targetRoot: root, action: "rollback" });
    assert(fullPreview.ok, fullPreview.errors?.join("; "));
    const fullRollback = await executeInstallation({ repoRoot, targetRoot: root, action: "rollback", dryRun: false, expectedPlanId: fullPreview.plan_id });
    assert(fullRollback.ok, fullRollback.errors?.join("; "));
    assert.equal(fs.existsSync(path.join(root, "docs/audit/WORKFLOW.md")), false);
    assert.equal(fs.existsSync(path.join(root, ".aidn/config.json")), false);
    assert.equal(read(root, "AGENTS.md"), originalInstructions);
  });

  await check("resume_refuses_a_different_package_before_any_effect", async () => {
    const root = target("bound-package");
    const args = { ...installArgs, skipArtifactImport: false };
    const interrupted = await executeInstallation({ repoRoot, targetRoot: root, args, dryRun: false, failAfterStaging: true });
    assert.equal(interrupted.ok, false);
    assert(interrupted.errors.includes("INJECTED_INSTALLATION_AFTER_STAGING"));
    const alternate = target("different-package");
    put(alternate, "VERSION", "999.0.0\n");
    put(alternate, "bin/aidn.mjs", "// Deliberately different package entrypoint.\n");
    // This alternative importer exposes an unintended dispatch through a harmless
    // marker. It is not a substitute implementation or a native-client oracle.
    put(alternate, "tools/perf/index-sync.mjs", [
      'import fs from "node:fs"; import path from "node:path";',
      'const root = process.argv[process.argv.indexOf("--target") + 1];',
      'fs.mkdirSync(path.join(root, ".aidn/runtime/index"), { recursive: true });',
      'fs.writeFileSync(path.join(root, ".aidn/runtime/index/workflow-index.json"), "{}");',
      'fs.writeFileSync(path.join(root, "wrong-package-ran.txt"), "unexpected importer");',
      'console.log("{}");', "",
    ].join("\n"));
    const before = snapshot(root);
    const result = await executeInstallation({ repoRoot: alternate, targetRoot: root, action: "resume", dryRun: false });
    assert.equal(result.ok, false, "resume must not execute the caller's different package");
    assert(result.conflicts.some((item) => item.code === "PACKAGE_CHANGED_SINCE_TRANSACTION"));
    assert.deepEqual(snapshot(root), before, "package mismatch must fail before any target write");
    assert.equal(fs.existsSync(path.join(root, "wrong-package-ran.txt")), false);
    const rolledBack = await install(root, { action: "rollback" });
    assert(rolledBack.ok, rolledBack.errors?.join("; "));
    assert.equal(fs.existsSync(path.join(root, ".aidn/install/pending.json")), false);
  });

  await check("staged_rollback_preserves_unrelated_fields_and_previous_version", async () => {
    const root = target("staged-fields");
    const baseline = { version: 1, install: { aidnVersion: "0.7.2" }, runtime: { stateMode: "files" }, clientExisting: "keep" };
    put(root, ".aidn/config.json", JSON.stringify(baseline) + "\n");
    const interrupted = await executeInstallation({ repoRoot, targetRoot: root, args: installArgs, dryRun: false, failAfterStaging: true });
    assert.equal(interrupted.ok, false);
    assert(interrupted.errors.includes("INJECTED_INSTALLATION_AFTER_STAGING"));
    const staged = readJson(root, ".aidn/config.json");
    staged.clientAdded = { keep: true };
    put(root, ".aidn/config.json", JSON.stringify(staged) + "\n");
    const before = snapshot(root);
    const defaultResume = executeCodexAssets({ repoRoot, targetRoot: root, action: "resume", dryRun: false });
    assert.equal(defaultResume.ok, false, "an interrupted installation needs explicit installation scope");
    assert(defaultResume.conflicts.some((item) => item.code === "INSTALLATION_SCOPE_REQUIRED"));
    assert.deepEqual(snapshot(root), before);
    const preview = await planInstallation({ repoRoot, targetRoot: root, action: "rollback" });
    assert(preview.ok, preview.errors?.join("; "));
    assert.deepEqual(snapshot(root), before, "rollback preview must remain read-only");
    const result = await executeInstallation({ repoRoot, targetRoot: root, action: "rollback", dryRun: false, expectedPlanId: preview.plan_id });
    assert(result.ok, result.errors?.join("; "));
    assert.deepEqual(readJson(root, ".aidn/config.json"), { ...baseline, clientAdded: { keep: true } });
    assert.equal(fs.existsSync(path.join(root, ".aidn/install/pending.json")), false);
  });

  await check("receipt_commit_failure_cannot_be_reported_as_completed_cleanup", async () => {
    const seed = target("receipt-config-seed");
    const seedResult = await install(seed);
    assert(seedResult.ok, seedResult.errors?.join("; "));
    const root = target("receipt-failure");
    // Same-version pre-existing metadata is not evidence of a durable receipt.
    put(root, ".aidn/config.json", read(seed, ".aidn/config.json"));
    const preview = await planInstallation({ repoRoot, targetRoot: root, args: installArgs });
    assert(preview.ok, preview.errors?.join("; "));
    assert.equal(preview.operations.find((item) => item.path === ".aidn/config.json").effect, "unchanged");
    const receiptPath = path.resolve(root, ".aidn/install/receipt.json");
    const renameSync = fs.renameSync;
    let injected = false, result;
    try {
      fs.renameSync = (from, to) => {
        if (path.resolve(String(to)) === receiptPath) {
          injected = true;
          const error = new Error("Fixture: receipt atomic commit denied"); error.code = "EACCES"; throw error;
        }
        return renameSync(from, to);
      };
      result = await executeInstallation({ repoRoot, targetRoot: root, args: installArgs, dryRun: false, expectedPlanId: preview.plan_id });
    } finally { fs.renameSync = renameSync; }
    assert.equal(fs.renameSync, renameSync, "filesystem fault injection must always be restored");
    assert(injected, "receipt commit fault must actually occur");
    assert.equal(result.ok, false, "failed receipt persistence is not completed installation");
    assert.notEqual(result.completion_status, "complete-cleanup-pending");
    assert(result.errors.some((item) => item.includes("EACCES")));
    assert.equal(fs.existsSync(receiptPath), false);
    assert.equal(fs.existsSync(path.join(root, ".aidn/install/lock.json")), false);
    assert.equal(fs.existsSync(path.join(root, ".aidn/install/pending.json")), true);
    const resumed = await install(root, { action: "resume" });
    assert(resumed.ok, resumed.errors?.join("; "));
    assert.equal(readJson(root, ".aidn/install/receipt.json").package.version, version);
    assert.equal(fs.existsSync(path.join(root, ".aidn/install/pending.json")), false);
  });

  await check("stale_plan_refuses_before_any_target_write", async () => {
    const root = target("stale-plan");
    const initial = snapshot(root);
    const preview = await planInstallation({ repoRoot, targetRoot: root, args: installArgs });
    assert(preview.ok, preview.errors?.join("; "));
    assert.deepEqual(snapshot(root), initial);
    put(root, ".gitignore", "client-added-line\n");
    const changed = snapshot(root);
    const result = await executeInstallation({ repoRoot, targetRoot: root, args: installArgs, dryRun: false, expectedPlanId: preview.plan_id });
    assert.equal(result.ok, false);
    assert(result.conflicts.some((item) => item.code === "STALE_INSTALL_PLAN"));
    assert.deepEqual(snapshot(root), changed, "a stale plan cannot create even installer metadata");
  });
  await check("two_processes_contend_on_the_real_installation_lock_without_duplicate_transaction", async () => {
    const root = target("concurrent-client");
    const control = target("concurrent-control");
    const held = path.join(control, "lock-held"), release = path.join(control, "release");
    const workerPath = path.join(control, "worker.mjs");
    const serviceUrl = pathToFileURL(path.join(repoRoot, "src/application/install/installation-service.mjs")).href;
    // Pause the real first transaction immediately after its pending record is
    // committed. The second OS process exercises the normal service unchanged.
    // The barrier lives outside the client and has a hard ten-second deadline.
    fs.writeFileSync(workerPath, [
      'import fs from "node:fs"; import path from "node:path";',
      `import { executeInstallation } from ${JSON.stringify(serviceUrl)};`,
      'const [repoRoot, targetRoot, control, role, serializedArgs] = process.argv.slice(2);',
      'const originalRename = fs.renameSync;',
      'const pending = path.resolve(targetRoot, ".aidn/install/pending.json");',
      'let paused = false;',
      'if (role === "holder") fs.renameSync = (from, to) => {',
      '  const result = originalRename(from, to);',
      '  if (!paused && path.resolve(String(to)) === pending) {',
      '    paused = true; fs.writeFileSync(path.join(control, "lock-held"), "ready");',
      '    const deadline = Date.now() + 10000;',
      '    while (!fs.existsSync(path.join(control, "release"))) {',
      '      if (Date.now() >= deadline) throw new Error("FIXTURE_BARRIER_TIMEOUT");',
      '      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);',
      '    }',
      '  }',
      '  return result;',
      '};',
      'try { console.log(JSON.stringify(await executeInstallation({ repoRoot, targetRoot, args: JSON.parse(serializedArgs), dryRun: false }))); }',
      'finally { fs.renameSync = originalRename; }', "",
    ].join("\n"));
    const workerArgs = [repoRoot, root, control];
    const holder = launchWorker(workerPath, [...workerArgs, "holder", JSON.stringify(installArgs)], 18000);
    let holderFinished;
    try {
      const readyDeadline = Date.now() + 5000;
      while (!fs.existsSync(held)) {
        assert(holder.child.exitCode === null && holder.child.signalCode === null, "lock holder exited before its barrier");
        assert(Date.now() < readyDeadline, "lock holder did not reach its barrier");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(readJson(root, ".aidn/install/lock.json").pid, holder.child.pid, "lock must belong to the real holding process");
      const lockedState = snapshot(root);
      const contender = launchWorker(workerPath, [...workerArgs, "contender", JSON.stringify(installArgs)], 5000);
      const rejected = workerOutput(await contender.completed);
      assert.equal(rejected.ok, false);
      assert(rejected.conflicts.some((item) => item.code === "INSTALL_LOCKED"));
      assert.equal(rejected.written, false);
      assert.deepEqual(snapshot(root), lockedState, "contender must not write any client file or installer metadata");
      fs.writeFileSync(release, "continue");
      holderFinished = await holder.completed;
      const completed = workerOutput(holderFinished);
      assert(completed.ok, completed.errors?.join("; "));
      assert.equal(fs.existsSync(path.join(root, ".aidn/install/lock.json")), false);
      assert.equal(fs.existsSync(path.join(root, ".aidn/install/pending.json")), false);
      const transactions = fs.readdirSync(path.join(root, ".aidn/install/transactions"));
      assert.equal(transactions.length, 1, "the rejected contender must not create a second transaction");
      const after = snapshot(root);
      const repeated = await install(root);
      assert(repeated.ok, repeated.errors?.join("; "));
      assert.deepEqual(snapshot(root), after, "reinstall after contention must not duplicate a transaction or an asset");
    } finally {
      // Unblock and join the child even when an assertion fails; never remove a
      // corpus while its installer is still running.
      fs.writeFileSync(release, "continue");
      holderFinished ??= await holder.completed;
      assert.equal(holder.child.exitCode === null && holder.child.signalCode === null, false, "holder must be reaped before cleanup");
    }
  });
} finally {
  // The suite owns this unique mkdtemp root; validate its resolved boundary before
  // recursive cleanup. No target path or record value controls the deletion.
  const resolved = fs.realpathSync(temp);
  const temporaryParent = fs.realpathSync(os.tmpdir());
  assert(resolved.startsWith(temporaryParent + path.sep));
  assert(path.basename(resolved).startsWith("aidn-installation-fault-boundaries-"));
  cleanup = removePathWithRetry(resolved);
  if (!cleanup.ok || fs.existsSync(resolved)) failures.push({ name: "temporary_cleanup", error: cleanup.error?.message ?? "Temporary corpus remains" });
}
console.log(JSON.stringify({
  ok: failures.length === 0, status: failures.length ? "FAIL" : "PASS",
  proof_class: "installation-service-fault-fixture", checks, failures,
  temp_removed: cleanup.ok, filesystem_injection_scope: "receipt-atomic-rename-fault-and-child-pending-commit-barrier",
  native_client_execution: "NOT_EXECUTED", multiprocess_concurrency: checks.find((item) => item.name.startsWith("two_processes_"))?.status ?? "NOT_EXECUTED", llm_calls: 0,
}, null, 2));
if (failures.length) process.exitCode = 1;
