#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { planCodexAssets, executeCodexAssets, diagnoseCodexAssets } from "../../src/application/install/codex-assets-service.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-codex-assets-"));
const checks = {};
let failure = null;
try {
  const targetRoot = path.join(tempRoot, "project");
  const stubRoot = path.join(tempRoot, "bin");
  fs.mkdirSync(path.join(targetRoot, ".codex"), { recursive: true });
  fs.mkdirSync(stubRoot);
  const stub = path.join(stubRoot, process.platform === "win32" ? "codex.cmd" : "codex");
  fs.writeFileSync(stub, process.platform === "win32"
    ? '@echo off\r\necho Logged in\r\nexit /b 0\r\n'
    : '#!/bin/sh\necho "Logged in"\n');
  if (process.platform !== "win32") fs.chmodSync(stub, 0o755);
  const thirdParty = { version: 1, note: "retained", hooks: {
    SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo third-party-start", timeout: 3 }] }],
    Stop: [{ hooks: [{ type: "command", command: "echo third-party-stop" }] }],
  } };
  fs.writeFileSync(path.join(targetRoot, ".codex/hooks.json"), JSON.stringify(thirdParty));
  fs.writeFileSync(path.join(targetRoot, "AGENTS.md"), "# Client policy\nKeep this instruction.\n");
  const child = spawnSync(process.execPath, [path.join(repoRoot, "tools/install.mjs"),
    "--target", targetRoot, "--pack", "core", "--init-defaults", "--project-name", "fixture",
    "--source-branch", "dev", "--skip-artifact-import", "--no-codex-migrate-custom"], {
    cwd: repoRoot, env: { ...process.env, PATH: `${stubRoot}${path.delimiter}${process.env.PATH ?? ""}` },
    encoding: "utf8", timeout: 120000, windowsHide: true,
  });
  assert.equal(child.status, 0, `install child failed: ${String(child.stderr).slice(-1600)}`);
  const installed = JSON.parse(fs.readFileSync(path.join(targetRoot, ".codex/hooks.json"), "utf8"));
  assert.deepEqual(installed.hooks.Stop, thirdParty.hooks.Stop, "installation must preserve third-party Stop hooks");
  assert.deepEqual(installed.hooks.SessionStart[0], thirdParty.hooks.SessionStart[0], "installation must preserve third-party hook order and matcher");
  assert.equal(installed.note, thirdParty.note, "installation must preserve third-party top-level fields");
  checks.installer_preserves_third_party_hooks = true;
  assert(fs.readFileSync(path.join(targetRoot, "AGENTS.md"), "utf8").startsWith("# Client policy\nKeep this instruction.\n"));
  assert.equal(fs.readFileSync(path.join(targetRoot, "AGENTS.md"), "utf8").split("<!-- CODEX-AUDIT-WORKFLOW START -->").length, 2);
  checks.installer_preserves_client_agents = true;
  function snapshot(root) {
    const files = {};
    function visit(current) {
      if (!fs.existsSync(current)) return;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        const relative = path.relative(root, full).replace(/\\/g, "/");
        if (entry.isSymbolicLink()) files[relative] = "symlink";
        else if (entry.isDirectory()) { files[relative + "/"] = "directory"; visit(full); }
        else files[relative] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      }
    }
    visit(root); return files;
  }
  function target(name) { const root = path.join(tempRoot, name); fs.mkdirSync(root); return root; }
  function preview(root, action = "install", extra = {}) { return planCodexAssets({ repoRoot, targetRoot: root, action, ...extra }); }
  function apply(root, action = "install", extra = {}) {
    const plan = preview(root, action, extra);
    assert.equal(plan.ok, true, plan.errors.join("; "));
    return executeCodexAssets({ repoRoot, targetRoot: root, action, dryRun: false, expectedPlanId: plan.plan_id, ...extra });
  }
  function ok(result) { assert.equal(result.ok, true, result.errors.join("; ")); }
  function put(root, relative, text) { const full = path.join(root, relative); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text); }
  const isolated = target("isolated");
  const pristine = snapshot(isolated);
  const planned = preview(isolated);
  ok(planned);
  assert(!JSON.stringify(planned).includes("preimage"));
  assert.deepEqual(snapshot(isolated), pristine);
  assert.equal(diagnoseCodexAssets({ repoRoot, targetRoot: isolated }).state, "not-installed");
  assert.deepEqual(snapshot(isolated), pristine);
  checks.preview_and_diagnose_read_only = true;
  const initialApply = apply(isolated);
  ok(initialApply); assert.equal(initialApply.installed, true);
  const installedSnapshot = snapshot(isolated);
  const noOp = apply(isolated);
  ok(noOp); assert.equal(noOp.written, false);
  assert.deepEqual(snapshot(isolated), installedSnapshot);
  checks.reinstall_byte_identical_including_receipt = true;
  const receipt = JSON.parse(fs.readFileSync(path.join(isolated, ".aidn/install/receipt.json"), "utf8"));
  assert.equal(receipt.scope, "codex-integration");
  assert.equal(receipt.package.root, repoRoot);
  assert.equal(receipt.package.entry, "bin/aidn.mjs");
  assert.match(receipt.package.entry_sha256, /^[a-f0-9]{64}$/);
  checks.launcher_bound_to_local_package = true;

  const collision = target("unknown-asset");
  put(collision, ".codex/agents/aidn-executor.toml", 'name="user customization"\n');
  const collisionBefore = snapshot(collision);
  const collisionPlan = preview(collision);
  assert.equal(collisionPlan.ok, false);
  assert(collisionPlan.errors.some((error) => error.includes("UNOWNED_ASSET_CONFLICT")));
  assert.equal(executeCodexAssets({ repoRoot, targetRoot: collision, dryRun: false }).ok, false);
  assert.deepEqual(snapshot(collision), collisionBefore);
  const collisionChild = spawnSync(process.execPath, [path.join(repoRoot, "tools/install.mjs"),
    "--target", collision, "--pack", "core", "--init-defaults", "--project-name", "fixture",
    "--source-branch", "dev", "--skip-artifact-import", "--no-codex-migrate-custom"], {
    cwd: repoRoot, env: { ...process.env, PATH: `${stubRoot}${path.delimiter}${process.env.PATH ?? ""}` },
    encoding: "utf8", timeout: 120000, windowsHide: true,
  });
  assert.notEqual(collisionChild.status, 0);
  assert.deepEqual(snapshot(collision), collisionBefore, "installer must stop before adapter/docs/runtime writes");
  checks.unknown_asset_stops_all_install_writes = true;

  const stale = preview(isolated, "uninstall");
  const hooksFile = path.join(isolated, ".codex/hooks.json");
  const hooksWithNeighbor = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
  hooksWithNeighbor.third_party_added_after_preview = true;
  fs.writeFileSync(hooksFile, JSON.stringify(hooksWithNeighbor));
  const staleBefore = snapshot(isolated);
  const staleApply = executeCodexAssets({ repoRoot, targetRoot: isolated, action: "uninstall", dryRun: false, expectedPlanId: stale.plan_id });
  assert.equal(staleApply.ok, false);
  assert(staleApply.errors.includes("STALE_INSTALL_PLAN"));
  assert.deepEqual(snapshot(isolated), staleBefore);
  checks.stale_plan_refused_without_write = true;
  const ownedPath = ".agents/skills/context-reload/SKILL.md";
  const ownedText = fs.readFileSync(path.join(isolated, ownedPath), "utf8");
  fs.appendFileSync(path.join(isolated, ownedPath), "\nuser change\n");
  const modifiedBefore = snapshot(isolated);
  assert.equal(preview(isolated, "repair").ok, false);
  assert.equal(preview(isolated, "uninstall").ok, false);
  assert.deepEqual(snapshot(isolated), modifiedBefore);
  fs.writeFileSync(path.join(isolated, ownedPath), ownedText);
  fs.unlinkSync(path.join(isolated, ownedPath));
  ok(apply(isolated, "repair"));
  assert.equal(fs.readFileSync(path.join(isolated, ownedPath), "utf8"), ownedText);
  checks.repair_missing_but_refuse_modified_asset = true;

  put(isolated, "docs/audit/sessions/S001.md", "retain workflow history\n");
  put(isolated, ".codex/config.toml", "# unrelated configuration\n");
  fs.appendFileSync(path.join(isolated, "AGENTS.md"), "\nclient policy added later\n");
  const uninstallApply = apply(isolated, "uninstall");
  ok(uninstallApply); assert.equal(uninstallApply.installed, false);
  assert(!fs.existsSync(path.join(isolated, ownedPath)));
  assert(fs.readFileSync(path.join(isolated, "AGENTS.md"), "utf8").includes("client policy added later"));
  assert(!fs.readFileSync(path.join(isolated, "AGENTS.md"), "utf8").includes("CODEX-AUDIT-WORKFLOW START"));
  assert.equal(JSON.parse(fs.readFileSync(hooksFile, "utf8")).third_party_added_after_preview, true);
  assert.equal(fs.readFileSync(path.join(isolated, "docs/audit/sessions/S001.md"), "utf8"), "retain workflow history\n");
  assert.equal(fs.readFileSync(path.join(isolated, ".codex/config.toml"), "utf8"), "# unrelated configuration\n");
  const uninstalled = snapshot(isolated);
  ok(apply(isolated, "uninstall")); assert.deepEqual(snapshot(isolated), uninstalled);
  checks.uninstall_preserves_neighbors_history_and_is_idempotent = true;

  for (const failAfter of [0, 1, 7]) {
    const interrupted = target(`interrupt-${failAfter}`);
    const result = executeCodexAssets({ repoRoot, targetRoot: interrupted, dryRun: false, failAfter });
    assert.equal(result.ok, false); assert.equal(result.written, true); assert(result.pending);
    assert.equal(preview(interrupted).ok, false);
    ok(apply(interrupted, "resume"));
    assert.equal(diagnoseCodexAssets({ repoRoot, targetRoot: interrupted }).state, "installed");
    assert(!fs.existsSync(path.join(interrupted, ".aidn/install/pending.json")));
    const completed = snapshot(interrupted);
    ok(apply(interrupted, "resume")); assert.deepEqual(snapshot(interrupted), completed);
  }
  checks.interruption_and_resume_idempotent = true;
  const interruptedRollback = target("interrupt-rollback");
  const failed = executeCodexAssets({ repoRoot, targetRoot: interruptedRollback, dryRun: false, failAfter: 4 });
  assert.equal(failed.ok, false);
  ok(apply(interruptedRollback, "rollback"));
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(interruptedRollback, ".aidn/install/receipt.json"), "utf8")).assets).length, 0);
  assert(!fs.existsSync(path.join(interruptedRollback, ownedPath)));
  const rolledBack = snapshot(interruptedRollback);
  ok(apply(interruptedRollback, "rollback")); assert.deepEqual(snapshot(interruptedRollback), rolledBack);
  checks.interrupted_rollback_and_duplicate_rollback = true;

  const rollback = target("rollback"); ok(apply(rollback));
  fs.appendFileSync(path.join(rollback, "AGENTS.md"), "\nsubsequent client policy\n");
  const rollbackHooks = JSON.parse(fs.readFileSync(path.join(rollback, ".codex/hooks.json"), "utf8"));
  rollbackHooks.third_party_after_install = "kept";
  fs.writeFileSync(path.join(rollback, ".codex/hooks.json"), JSON.stringify(rollbackHooks));
  ok(apply(rollback, "rollback"));
  assert(fs.readFileSync(path.join(rollback, "AGENTS.md"), "utf8").includes("subsequent client policy"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(rollback, ".codex/hooks.json"), "utf8")).third_party_after_install, "kept");
  checks.rollback_preserves_later_unmanaged_edits = true;
  const rollbackConflict = target("rollback-conflict"); ok(apply(rollbackConflict));
  fs.appendFileSync(path.join(rollbackConflict, ownedPath), "\nnew user edit\n");
  const rollbackConflictBefore = snapshot(rollbackConflict);
  assert.equal(preview(rollbackConflict, "rollback").ok, false);
  assert.deepEqual(snapshot(rollbackConflict), rollbackConflictBefore);
  checks.rollback_refuses_later_managed_edits = true;

  const locked = target("locked");
  put(locked, ".aidn/install/lock.json", JSON.stringify({ pid: process.pid, token: "active-owner" }));
  const lockBefore = snapshot(locked);
  const blocked = executeCodexAssets({ repoRoot, targetRoot: locked, dryRun: false });
  assert.equal(blocked.ok, false); assert(blocked.errors.some((error) => error.includes("INSTALL_LOCKED")));
  assert.deepEqual(snapshot(locked), lockBefore);
  const otherWorktree = target("independent-worktree"); ok(apply(otherWorktree));
  checks.worktree_scoped_lock_and_independent_target = true;

  const linked = target("symlink-target");
  const external = target("symlink-external");
  fs.symlinkSync(external, path.join(linked, ".codex"), process.platform === "win32" ? "junction" : "dir");
  const linkedBefore = snapshot(linked); const externalBefore = snapshot(external);
  assert.equal(preview(linked).ok, false);
  assert.equal(executeCodexAssets({ repoRoot, targetRoot: linked, dryRun: false }).ok, false);
  assert.deepEqual(snapshot(linked), linkedBefore); assert.deepEqual(snapshot(external), externalBefore);
  checks.symlink_escape_refused_without_writes = true;
  const groupsRoot = target("managed-groups");
  put(groupsRoot, ".codex/hooks.json", JSON.stringify(thirdParty));
  ok(apply(groupsRoot));
  ok(apply(groupsRoot, "uninstall"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(groupsRoot, ".codex/hooks.json"), "utf8")), thirdParty);
  checks.uninstall_removes_only_owned_empty_wrappers = true;

  const addedFields = target("wrapper-neighbor");
  ok(apply(addedFields));
  const addedHookFile = path.join(addedFields, ".codex/hooks.json");
  const addedHookConfig = JSON.parse(fs.readFileSync(addedHookFile, "utf8"));
  addedHookConfig.hooks.SessionStart[0].third_party_note = "keep me";
  fs.writeFileSync(addedHookFile, JSON.stringify(addedHookConfig));
  ok(apply(addedFields, "uninstall"));
  assert.equal(JSON.parse(fs.readFileSync(addedHookFile, "utf8")).hooks.SessionStart[0].third_party_note, "keep me");
  checks.uninstall_preserves_fields_added_to_owned_wrapper = true;

  const changedHooks = target("changed-owned-hook"); ok(apply(changedHooks));
  const changedHookFile = path.join(changedHooks, ".codex/hooks.json");
  const changedHookConfig = JSON.parse(fs.readFileSync(changedHookFile, "utf8"));
  changedHookConfig.hooks.SessionStart[0].hooks[0].timeout = 987;
  fs.writeFileSync(changedHookFile, JSON.stringify(changedHookConfig));
  const changedHookBefore = snapshot(changedHooks);
  assert.equal(preview(changedHooks, "repair").ok, false);
  assert.equal(preview(changedHooks, "uninstall").ok, false);
  assert.deepEqual(snapshot(changedHooks), changedHookBefore);
  checks.changed_owned_hook_refused = true;

  const badHookJson = target("invalid-hooks-json");
  put(badHookJson, ".codex/hooks.json", "{malformed");
  const badHookBefore = snapshot(badHookJson);
  assert.equal(executeCodexAssets({ repoRoot, targetRoot: badHookJson, dryRun: false }).ok, false);
  assert.deepEqual(snapshot(badHookJson), badHookBefore);
  checks.invalid_hook_json_refused_without_writes = true;

  const legacyRoot = target("legacy");
  const historical = spawnSync("git", ["show", "4e551db243d9e38908986f7fd56f283144ed1124:scaffold/codex_hooks/hooks.json"], { cwd: repoRoot, encoding: "utf8" });
  // The captured release fingerprints are packaged data; the test's baseline
  // hook literal keeps this test executable from source tarballs without Git history.
  const historicalHook = { version: 1, hooks: { SessionStart: [{ hooks: [{
    type: "command",
    command: 'node "$(git rev-parse --show-toplevel)/.codex/hooks/aidn-session-start.mjs"',
    commandWindows: 'powershell.exe -NoProfile -NonInteractive -Command "$root = git rev-parse --show-toplevel; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node (Join-Path $root \'.codex/hooks/aidn-session-start.mjs\')"',
    timeout: 10,
  }] }] } };
  if (historical.status === 0) assert.deepEqual(JSON.parse(historical.stdout), historicalHook);
  put(legacyRoot, ".codex/hooks.json", JSON.stringify({ ...historicalHook, hooks: { ...historicalHook.hooks, Stop: thirdParty.hooks.Stop } }));
  ok(apply(legacyRoot));
  const migratedHooks = JSON.parse(fs.readFileSync(path.join(legacyRoot, ".codex/hooks.json"), "utf8"));
  assert.deepEqual(migratedHooks.hooks.Stop, thirdParty.hooks.Stop);
  assert.equal(migratedHooks.hooks.SessionStart.flatMap((group) => group.hooks).length, 1);
  assert.notEqual(migratedHooks.hooks.SessionStart[0].hooks[0].command, historicalHook.hooks.SessionStart[0].hooks[0].command);
  checks.exact_legacy_hook_migration_without_duplicate = true;
  const ambiguousLegacy = target("ambiguous-legacy");
  historicalHook.hooks.SessionStart[0].hooks[0].timeout = 999;
  put(ambiguousLegacy, ".codex/hooks.json", JSON.stringify(historicalHook));
  assert.equal(preview(ambiguousLegacy).ok, false);
  checks.modified_legacy_fingerprint_not_adopted = true;

  const blockRoot = target("explicit-block");
  const clientAgents = "# Client instructions\nA private client rule.\n";
  put(blockRoot, "AGENTS.md", clientAgents);
  ok(apply(blockRoot, "install", { forceAgentsMerge: true }));
  assert(fs.readFileSync(path.join(blockRoot, "AGENTS.md"), "utf8").startsWith(clientAgents));
  const blockFile = path.join(blockRoot, "AGENTS.md");
  fs.writeFileSync(blockFile, fs.readFileSync(blockFile, "utf8").replace("<!-- CODEX-AUDIT-WORKFLOW START -->", "<!-- CODEX-AUDIT-WORKFLOW START -->\nchanged managed rule"));
  const blockBefore = snapshot(blockRoot);
  assert.equal(preview(blockRoot, "install", { forceAgentsMerge: true }).ok, false);
  assert.deepEqual(snapshot(blockRoot), blockBefore);
  checks.force_agents_merge_never_overwrites_modified_owned_block = true;

  const corrupt = target("corrupt-record"); ok(apply(corrupt));
  const receiptFile = path.join(corrupt, ".aidn/install/receipt.json");
  const corruptReceipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  corruptReceipt.assets["../../outside"] = { kind: "file", current: "YQ==" };
  fs.writeFileSync(receiptFile, JSON.stringify(corruptReceipt));
  const corruptBefore = snapshot(corrupt);
  assert.equal(preview(corrupt, "uninstall").ok, false);
  assert.deepEqual(snapshot(corrupt), corruptBefore);
  checks.corrupt_receipt_refused = true;
  const staleLockRoot = target("stale-lock-before-journal");
  const rootId = crypto.createHash("sha256").update(process.platform === "win32" ? staleLockRoot.toLowerCase() : staleLockRoot).digest("hex");
  put(staleLockRoot, ".aidn/install/lock.json", JSON.stringify({ schema_version: 1, pid: 2147483647, token: "interrupted-before-journal", root_id: rootId }));
  const lockRecoveryPreview = preview(staleLockRoot, "resume"); ok(lockRecoveryPreview);
  assert.equal(lockRecoveryPreview.lock_recovery.required, true);
  assert(fs.existsSync(path.join(staleLockRoot, ".aidn/install/lock.json")));
  const recoveredLock = apply(staleLockRoot, "resume"); ok(recoveredLock);
  assert.equal(recoveredLock.recovered_lock, true);
  assert.equal(recoveredLock.written, true);
  assert(!fs.existsSync(path.join(staleLockRoot, ".aidn/install/lock.json")));
  ok(apply(staleLockRoot));
  checks.resume_recovers_dead_owner_before_journal = true;
  const recoveryLockRoot = target("recovery-lock-interruption");
  put(recoveryLockRoot, ".aidn/install/recovery-lock.json", JSON.stringify({ pid: 2147483647, token: "interrupted-recovery" }));
  const recoveryLockBefore = snapshot(recoveryLockRoot);
  const recoveryBlocked = executeCodexAssets({ repoRoot, targetRoot: recoveryLockRoot, action: "resume", dryRun: false });
  assert.equal(recoveryBlocked.ok, false);
  assert(recoveryBlocked.errors.some((error) => error.includes("INTERRUPTED_LOCK_RECOVERY_REQUIRES_INSPECTION")));
  assert.deepEqual(snapshot(recoveryLockRoot), recoveryLockBefore);
  checks.interrupted_recovery_lock_diagnostic_is_not_success = true;
  const exactAgents = target("client-agents-round-trip");
  const originalClientAgents = "# Client AGENTS\nKeep exact trailing whitespace.  \n";
  put(exactAgents, "AGENTS.md", originalClientAgents);
  ok(apply(exactAgents));
  assert(fs.readFileSync(path.join(exactAgents, "AGENTS.md"), "utf8").startsWith(originalClientAgents));
  ok(apply(exactAgents, "uninstall"));
  assert.equal(fs.readFileSync(path.join(exactAgents, "AGENTS.md"), "utf8"), originalClientAgents);
  checks.default_agents_append_and_exact_uninstall = true;
  for (const [name, extraArgs] of [["missing-adapter-config", []], ["invalid-adapter-file", ["--adapter-file", path.join(tempRoot, "absent-adapter.json")]]]) {
    const invalidRoot = target(name);
    const beforeInvalid = snapshot(invalidRoot);
    const invalidChild = spawnSync(process.execPath, [path.join(repoRoot, "tools/install.mjs"), "--target", invalidRoot,
      "--pack", "core", "--source-branch", "dev", "--skip-artifact-import", "--no-codex-migrate-custom", ...extraArgs], {
      cwd: repoRoot, encoding: "utf8", timeout: 120000, windowsHide: true,
    });
    assert.notEqual(invalidChild.status, 0);
    assert.deepEqual(snapshot(invalidRoot), beforeInvalid, `${name} must fail before assets or receipt are written`);
  }
  checks.invalid_adapter_preconditions_do_not_write = true;
  const privacyRoot = target("interrupted-store-privacy");
  const interruptedPrivate = executeCodexAssets({ repoRoot, targetRoot: privacyRoot, dryRun: false, failAfter: 0 });
  assert.equal(interruptedPrivate.ok, false);
  assert.equal(fs.readFileSync(path.join(privacyRoot, ".aidn/install/.gitignore"), "utf8"), "*\n");
  assert(interruptedPrivate.write_targets.includes(".aidn/install/.gitignore"));
  assert.equal(fs.existsSync(path.join(privacyRoot, ".gitignore")), false);
  checks.recovery_preimages_ignored_before_root_install = true;
  const ignoreConflictRoot = target("store-ignore-conflict");
  put(ignoreConflictRoot, ".aidn/install/.gitignore", "!receipt.json\n");
  const ignoredBefore = snapshot(ignoreConflictRoot);
  assert.equal(executeCodexAssets({ repoRoot, targetRoot: ignoreConflictRoot, dryRun: false }).ok, false);
  assert.deepEqual(snapshot(ignoreConflictRoot), ignoredBefore);
  checks.conflicting_store_ignore_preserved = true;
} catch (error) {
  failure = error;
} finally {
  const resolved = path.resolve(tempRoot);
  const base = path.resolve(os.tmpdir());
  assert(resolved.startsWith(`${base}${path.sep}`) && path.basename(resolved).startsWith("aidn-codex-assets-"));
  fs.rmSync(resolved, { recursive: true, force: true });
  checks.temp_removed = !fs.existsSync(resolved);
}
console.log(JSON.stringify({ ok: !failure, checks, errors: failure ? [failure.message] : [] }, null, 2));
if (failure) process.exitCode = 1;
