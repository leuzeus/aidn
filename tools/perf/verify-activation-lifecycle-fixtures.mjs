#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planInstallation, executeInstallation } from "../../src/application/install/installation-service.mjs";
import { planCodexAssets, executeCodexAssets } from "../../src/application/install/codex-assets-service.mjs";
import { readActivation, resolveActivationTarget } from "../../src/application/install/project-activation-service.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-activation-lifecycle-")), started = performance.now();
const checks = [], commands = [];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
const args = { pack: "core", initDefaults: true, projectName: "fixture", sourceBranch: "main", skipArtifactImport: true, artifactImportStore: "file", artifactImportStateMode: "files", verifyAfterInstall: true };
const put = (root, relative, value) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const json = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const stable = (value) => Array.isArray(value) ? "[" + value.map(stable).join(",") + "]"
  : value !== null && typeof value === "object" ? "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}" : JSON.stringify(value);
function sealed(value) { const { integrity_sha256, ...content } = value; return { ...content, integrity_sha256: crypto.createHash("sha256").update(stable(content)).digest("hex") }; }
function git(root, argv) {
  const child = spawnSync("git", ["-C", root, "-c", "user.name=aidn-fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "-c", "core.hooksPath=" + path.join(temp, "no-hooks"), ...argv], { env, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr); return child.stdout.trim();
}
function repository(name) {
  const root = path.join(temp, name); fs.mkdirSync(root);
  git(root, ["init", "--quiet", "--initial-branch=main"]); put(root, "neutral.txt", "neutral client fixture\n");
  git(root, ["add", "neutral.txt"]); git(root, ["commit", "--quiet", "-m", "fixture"]); return root;
}
function snapshot(root) {
  const entries = [];
  function visit(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, item.name), relative = path.relative(root, file);
    if (item.isSymbolicLink()) entries.push([relative, fs.readlinkSync(file)]);
    else if (item.isDirectory()) { entries.push([relative + "/", null]); visit(file); }
    else entries.push([relative, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
  } }
  visit(root); return entries;
}
const options = (root, action, extra = {}) => ({ repoRoot, targetRoot: root, action, args, ...extra });
async function install(root, action = "install", extra = {}) {
  const preview = await planInstallation(options(root, action)); assert.equal(preview.ok, true, preview.errors.join("; "));
  const before = performance.now();
  const result = await executeInstallation(options(root, action, { dryRun: false, expectedPlanId: preview.plan_id, ...extra }));
  commands.push({ scope: "installation", action, ok: result.ok, duration_ms: Math.round(performance.now() - before), errors: result.errors });
  return result;
}
function lifecycle(root, action, extra = {}) {
  const preview = planCodexAssets(options(root, action, extra)); assert.equal(preview.ok, true, preview.errors.join("; "));
  const result = executeCodexAssets(options(root, action, { dryRun: false, expectedPlanId: preview.plan_id, ...extra }));
  commands.push({ scope: "codex-integration", action, ok: result.ok, errors: result.errors }); return result;
}
function ok(result) { assert.equal(result.ok, true, result.errors.join("; ")); }
function state(root, expected) { const result = readActivation({ targetRoot: root }); assert.equal(result.state, expected, JSON.stringify(result.errors)); return result; }
async function check(name, run) { const start = performance.now(); try { await run(); checks.push({ name, status: "PASS", duration_ms: Math.round(performance.now() - start) }); } catch (error) { checks.push({ name, status: "FAIL", duration_ms: Math.round(performance.now() - start) }); throw error; } }

let failure = null, cleanup;
try {
  const root = repository("client"), identity = resolveActivationTarget({ targetRoot: root });
  await check("installation preview does not create repository authority or local files", async () => {
    const before = snapshot(temp); const preview = await planInstallation(options(root, "install")); ok(preview);
    state(root, "absent"); assert.deepEqual(snapshot(temp), before); assert(!fs.existsSync(identity.authority_path));
  });
  await check("first complete installation grants repository and prepares only this worktree", async () => {
    ok(await install(root)); const activated = state(root, "active"); assert.equal(activated.authorization.revision, 1);
    assert.equal(activated.receipt.activation.mode, "repository"); assert.equal(activated.receipt.activation.authority_id, identity.authority_id);
    assert.equal(json(root, ".aidn/config.json").install.aidnVersion, fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim());
  });
  const linked = path.join(temp, "linked-worktree"); git(root, ["worktree", "add", "--quiet", "--detach", linked, "HEAD"]);
  await check("new worktree remains unprepared until explicit local installation", async () => {
    const before = snapshot(temp); state(linked, "unprepared"); const preview = await planInstallation(options(linked, "install")); ok(preview);
    assert.deepEqual(snapshot(temp), before); ok(await install(linked)); state(linked, "active"); state(root, "active");
    assert.equal(readActivation({ targetRoot: linked }).authorization.revision, 1);
  });
  const clone = path.join(temp, "independent-clone"); git(temp, ["clone", "--quiet", "--no-local", root, clone]);
  await check("repository authorization is not inherited by an independent clone", () => {
    const separate = state(clone, "absent"); assert.notEqual(separate.identity.authority_id, identity.authority_id); assert(!fs.existsSync(separate.identity.authority_path));
  });
  await check("revocation in one worktree disables every prepared worktree", () => {
    const before = snapshot(temp), preview = planCodexAssets(options(linked, "revoke")); ok(preview); assert.deepEqual(snapshot(temp), before);
    ok(lifecycle(linked, "revoke")); state(root, "revoked"); state(linked, "revoked");
  });
  const revokedBytes = fs.readFileSync(identity.authority_path);
  await check("reinstall repair and rollback never grant an already revoked repository", async () => {
    ok(await install(root)); state(root, "revoked");
    fs.unlinkSync(path.join(root, ".codex/hooks/aidn-session-start.mjs"));
    ok(await install(root, "repair")); state(root, "revoked"); assert(fs.existsSync(path.join(root, ".codex/hooks/aidn-session-start.mjs")));
    ok(await install(root, "rollback")); state(root, "revoked");
    assert.deepEqual(fs.readFileSync(identity.authority_path), revokedBytes);
    ok(await install(root)); state(root, "revoked");
  });
  await check("only explicit authorize reactivates all correctly prepared worktrees", () => {
    ok(lifecycle(root, "authorize")); state(root, "active"); state(linked, "active");
    assert.equal(readActivation({ targetRoot: root }).authorization.revision, 3);
  });
  const interrupted = repository("interrupted"), interruptedIdentity = resolveActivationTarget({ targetRoot: interrupted });
  await check("interrupted initial installation publishes no grant and revoke preserves its journal", async () => {
    const result = await install(interrupted, "install", { failAfter: 3 }); assert.equal(result.ok, false); assert(result.errors.includes("INJECTED_INSTALL_INTERRUPTION"));
    assert(!fs.existsSync(interruptedIdentity.authority_path)); state(interrupted, "degraded");
    const pending = fs.readFileSync(path.join(interrupted, ".aidn/install/pending.json"));
    ok(lifecycle(interrupted, "revoke")); state(interrupted, "revoked");
    assert.deepEqual(fs.readFileSync(path.join(interrupted, ".aidn/install/pending.json")), pending);
  });
  await check("resume cannot overwrite a later revocation and failed CAS is read-only", async () => {
    const before = snapshot(temp);
    const preview = await planInstallation(options(interrupted, "resume")); assert.equal(preview.ok, false); assert(preview.errors.some((error) => error.includes("ACTIVATION_AUTHORIZATION_CAS_CONFLICT")));
    const result = await executeInstallation(options(interrupted, "resume", { dryRun: false })); assert.equal(result.ok, false);
    assert.deepEqual(snapshot(temp), before); state(interrupted, "revoked");
  });
  await check("rollback removes partial assets without restoring an older authorization", async () => {
    const authority = fs.readFileSync(interruptedIdentity.authority_path); ok(await install(interrupted, "rollback"));
    assert.deepEqual(fs.readFileSync(interruptedIdentity.authority_path), authority); state(interrupted, "revoked");
    assert.equal(fs.existsSync(path.join(interrupted, ".aidn/install/pending.json")), false);
    assert.equal(json(interrupted, ".aidn/install/receipt.json").activation.mode, "repository");
  });
  await check("migrated rollback receipt cannot fall back to legacy if authority disappears", async () => {
    fs.unlinkSync(interruptedIdentity.authority_path); const before = snapshot(temp);
    state(interrupted, "degraded"); const preview = await planInstallation(options(interrupted, "install")); assert.equal(preview.ok, false);
    assert(preview.errors.some((error) => error.includes("ACTIVATION_AUTHORITY_MISSING"))); assert.deepEqual(snapshot(temp), before);
  });
  await check("rollback refuses to restore a nonempty legacy receipt after activation migration", async () => {
    const legacy = repository("legacy-receipt-shape"); ok(await install(legacy));
    const identity = resolveActivationTarget({ targetRoot: legacy });
    const receipt = json(legacy, ".aidn/install/receipt.json"); delete receipt.activation;
    const transactionPath = ".aidn/install/transactions/" + receipt.last_transaction + ".json";
    const transaction = json(legacy, transactionPath); delete transaction.receipt_after.activation;
    put(legacy, transactionPath, JSON.stringify(sealed(transaction)));
    put(legacy, ".aidn/install/receipt.json", JSON.stringify(sealed(receipt))); fs.unlinkSync(identity.authority_path);
    state(legacy, "legacy-active"); ok(await install(legacy)); state(legacy, "active"); ok(lifecycle(legacy, "revoke"));
    const before = snapshot(temp), preview = await planInstallation(options(legacy, "rollback"));
    assert.equal(preview.ok, false); assert(preview.errors.some((error) => error.includes("ROLLBACK_TO_LEGACY_ACTIVATION_REQUIRES_UNINSTALL")));
    const applied = await executeInstallation(options(legacy, "rollback", { dryRun: false }));
    assert.equal(applied.ok, false); assert.deepEqual(snapshot(temp), before); state(legacy, "revoked");
  });
} catch (error) { failure = { message: error.message, stack: error.stack }; }
finally {
  const resolved = path.resolve(temp), allowed = path.resolve(os.tmpdir());
  assert(resolved.startsWith(allowed + path.sep) && path.basename(resolved).startsWith("aidn-activation-lifecycle-"));
  cleanup = removePathWithRetry(resolved);
}
const output = { ok: !failure && cleanup.ok, proof_class: "temporary-installed-clients", checks, commands, duration_ms: Math.round(performance.now() - started), failure,
  cleanup: { ok: cleanup.ok, attempts: cleanup.attempts }, database_calls: 0, llm_calls: 0 };
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
