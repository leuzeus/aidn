#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createActivationGitEnvironment, resolveActivationTarget, readActivation, planAuthorization, acquireAuthorizationLock, applyAuthorization } from "../../src/application/install/project-activation-service.mjs";
import { createActivationGitEnvironment as createHookGitEnvironment } from "../../scaffold/codex_hooks/scripts/aidn-hook-runtime.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const started = Date.now(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-project-activation-"));
const checks = [], hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const sealed = (value) => ({ ...value, integrity_sha256: hash(stable(value)) });
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
const put = (root, relative, value) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const json = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
function git(root, args) {
  const result = spawnSync("git", ["-C", root, "-c", "user.name=aidn-fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "-c", `core.hooksPath=${path.join(temp, "no-hooks")}`, ...args], { env: cleanEnv, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function directory(name) { const root = path.join(temp, name); fs.mkdirSync(root); return root; }
function repository(name) {
  const root = directory(name); git(root, ["init", "--quiet", "--initial-branch=main"]);
  put(root, "fixture.txt", "neutral fixture\n"); git(root, ["add", "fixture.txt"]); git(root, ["commit", "--quiet", "-m", "fixture"]);
  return root;
}
function snapshot(root) {
  const entries = [];
  function visit(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, item.name), relative = path.relative(root, file);
    if (item.isSymbolicLink()) entries.push([relative, fs.readlinkSync(file)]);
    else if (item.isDirectory()) { entries.push([`${relative}/`, null]); visit(file); }
    else entries.push([relative, hash(fs.readFileSync(file))]);
  } }
  visit(root); return entries;
}
const packageRoot = directory("neutral-package");
put(packageRoot, "VERSION", "0.8.0\n"); put(packageRoot, "bin/aidn.mjs", "// neutral fixture; never executed\n");
const binding = { root: packageRoot, version: "0.8.0", entry: "bin/aidn.mjs", entry_sha256: hash(fs.readFileSync(path.join(packageRoot, "bin/aidn.mjs"))), version_sha256: hash(fs.readFileSync(path.join(packageRoot, "VERSION"))) };
function installReceipt(root, { activation = false, renamedSkills = false, installation = false } = {}) {
  const identity = resolveActivationTarget({ targetRoot: root }), assets = {};
  const files = [".codex/hooks/aidn-hook-runtime.mjs", ".codex/hooks/aidn-session-start.mjs", ".codex/hooks/aidn-pre-tool-use.mjs",
    ...["context-reload", "start-session"].map((name) => `.agents/skills/${renamedSkills ? "aidn-" : ""}${name}/SKILL.md`)];
  for (const relative of files) { const text = `Neutral fixture ${relative}\n`; put(root, relative, text); assets[relative] = { kind: "file", current: Buffer.from(text).toString("base64") }; }
  const block = "<!-- CODEX-AUDIT-WORKFLOW START -->\nNeutral fixture\n<!-- CODEX-AUDIT-WORKFLOW END -->";
  put(root, "AGENTS.md", `Client text\n${block}\n`); assets["AGENTS.md"] = { kind: "agents-block", current: block };
  const owned = ["SessionStart", "PreToolUse"].map((event) => ({ event, group: { matcher: "fixture" }, hook: { type: "command", command: `echo fixture-${event}` } }));
  put(root, ".codex/hooks.json", JSON.stringify({ hooks: Object.fromEntries(owned.map((token) => [token.event, [{ ...token.group, hooks: [token.hook] }]])) }));
  assets[".codex/hooks.json"] = { kind: "hooks", current: owned };
  const id = crypto.randomBytes(16).toString("hex");
  const receipt = { schema_version: 1, scope: "codex-integration", root_id: identity.root_id, package: binding, assets, last_transaction: id, last_action: "install",
    ...(activation ? { activation: { mode: identity.scope, authority_id: identity.authority_id } } : {}),
    ...(installation ? { installation: { version: "0.8.0", assets: {} } } : {}),
  };
  const tx = { schema_version: 1, id, scope: installation ? "installation" : "codex-integration", root_id: identity.root_id, status: "complete", operations: [], receipt_after: receipt,
    ...(installation ? { external_status: "complete" } : {}) };
  put(root, `.aidn/install/transactions/${id}.json`, JSON.stringify(sealed(tx)));
  put(root, ".aidn/install/receipt.json", JSON.stringify(sealed(receipt)));
  return { identity, receipt, tx };
}
function check(name, action) { action(); checks.push({ name, status: "PASS" }); }
let failure = null, cleanup;
try {
  // Regressions first: the old native binding helper accepted both these receipts.
  const invalid = repository("invalid-receipt");
  put(invalid, ".aidn/install/receipt.json", JSON.stringify({ schema_version: 1, package: binding }));
  check("unsealed scope-less package receipt cannot activate", () => { const result = readActivation({ targetRoot: invalid }); assert.equal(result.state, "degraded"); assert.equal(result.active, false); });
  const root = repository("repository"), fixture = installReceipt(root);
  const sibling = path.join(temp, "worktree"); git(root, ["worktree", "add", "--quiet", "-b", "fixture-worktree", sibling]);
  put(sibling, ".aidn/install/receipt.json", fs.readFileSync(path.join(root, ".aidn/install/receipt.json")));
  check("copied sealed receipt cannot activate another real worktree", () => { const result = readActivation({ targetRoot: sibling }); assert.equal(result.active, false); assert(result.errors.some((error) => error.includes("INVALID_RECEIPT"))); });
  fs.unlinkSync(path.join(sibling, ".aidn/install/receipt.json"));
  check("valid legacy installation applies only to its own worktree", () => { assert.equal(readActivation({ targetRoot: root }).state, "legacy-active"); assert.equal(readActivation({ targetRoot: sibling }).state, "absent"); });
  check("resolver shares physical common-dir but distinguishes worktree and git-dir", () => {
    const other = resolveActivationTarget({ targetRoot: sibling }); assert.equal(other.common_dir, fixture.identity.common_dir); assert.equal(other.authority_id, fixture.identity.authority_id); assert.notEqual(other.root_id, fixture.identity.root_id); assert.notEqual(other.git_dir, fixture.identity.git_dir);
    fs.mkdirSync(path.join(root, "nested")); assert.deepEqual(resolveActivationTarget({ targetRoot: path.join(root, "nested") }), fixture.identity);
  });
  check("Git environment overrides cannot redirect target authority", () => {
    const names = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"];
    const previous = Object.fromEntries(names.map((key) => [key, process.env[key]]));
    try { Object.assign(process.env, { GIT_DIR: path.join(invalid, ".git"), GIT_WORK_TREE: invalid, GIT_COMMON_DIR: path.join(invalid, ".git"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.worktree", GIT_CONFIG_VALUE_0: invalid }); assert.deepEqual(resolveActivationTarget({ targetRoot: root }), fixture.identity); }
    finally { for (const key of names) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
  });
  check("Git sandbox exceptions are retained exactly while all other injected settings are discarded", () => {
    const supplied = { PATH: "neutral-path", GIT_DIR: invalid, GIT_WORK_TREE: invalid, GIT_COMMON_DIR: invalid, GIT_CONFIG_PARAMETERS: "'core.worktree=ignored'",
      GIT_CONFIG_COUNT: "5", GIT_CONFIG_KEY_0: "core.worktree", GIT_CONFIG_VALUE_0: invalid,
      GIT_CONFIG_KEY_1: "safe.directory", GIT_CONFIG_VALUE_1: "",
      GIT_CONFIG_KEY_2: "alias.rev-parse", GIT_CONFIG_VALUE_2: "!exit 1",
      GIT_CONFIG_KEY_3: "safe.directory", GIT_CONFIG_VALUE_3: root,
      GIT_CONFIG_KEY_4: "safe.directory", GIT_CONFIG_VALUE_4: path.join(root, "*") };
    const original = structuredClone(supplied), expected = { PATH: "neutral-path", GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "safe.directory", GIT_CONFIG_VALUE_1: root,
      GIT_CONFIG_KEY_2: "safe.directory", GIT_CONFIG_VALUE_2: path.join(root, "*") };
    assert.deepEqual(createActivationGitEnvironment(supplied), expected); assert.deepEqual(createHookGitEnvironment(supplied), expected);
    assert.deepEqual(supplied, original);
    for (const count of ["invalid", "-1", "1025", "1.5"]) {
      assert.deepEqual(createActivationGitEnvironment({ ...supplied, GIT_CONFIG_COUNT: count }), { PATH: "neutral-path" });
      assert.deepEqual(createHookGitEnvironment({ ...supplied, GIT_CONFIG_COUNT: count }), { PATH: "neutral-path" });
    }
    const previous = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^GIT_/i.test(key)));
    try {
      for (const key of Object.keys(previous)) delete process.env[key];
      Object.assign(process.env, Object.fromEntries(Object.entries(supplied).filter(([key]) => /^GIT_/i.test(key))));
      assert.deepEqual(resolveActivationTarget({ targetRoot: root }), fixture.identity);
    } finally {
      for (const key of Object.keys(process.env).filter((key) => /^GIT_/i.test(key))) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });
  check("authorization previews and activation reads create no files", () => {
    const before = snapshot(temp); const a = planAuthorization({ targetRoot: root, action: "authorize" }), b = planAuthorization({ targetRoot: root, action: "authorize" }); assert.deepEqual(a, b); readActivation({ targetRoot: root }); assert.deepEqual(snapshot(temp), before);
  });
  check("missing non-Git target plans without creation and Git subdirectory cannot be authorized", () => {
    const target = path.join(temp, "not-created", "client"); const before = snapshot(temp);
    const plan = planAuthorization({ targetRoot: target, action: "authorize" }); assert.equal(plan.identity.target_root, target); assert.equal(plan.identity.scope, "local");
    assert.equal(readActivation({ targetRoot: target }).state, "absent"); assert.deepEqual(snapshot(temp), before);
    assert.throws(() => planAuthorization({ targetRoot: path.join(root, "nested"), action: "authorize" }), /TARGET_NOT_ROOT/);
    assert.throws(() => planAuthorization({ targetRoot: path.join(root, "does-not-exist"), action: "authorize" }), /TARGET_NOT_ROOT/);
  });
  const grant = planAuthorization({ targetRoot: root, action: "authorize" }); applyAuthorization(grant);
  check("repository grant does not prepare legacy or new worktrees implicitly", () => { assert.equal(readActivation({ targetRoot: root }).state, "unprepared"); assert.equal(readActivation({ targetRoot: sibling }).state, "unprepared"); });
  installReceipt(root, { activation: true, installation: true }); installReceipt(sibling, { activation: true, renamedSkills: true });
  check("prepared worktrees become active with either supported skill identity", () => { assert.equal(readActivation({ targetRoot: root }).state, "active"); assert.equal(readActivation({ targetRoot: sibling }).state, "active"); });
  check("common lock prevents concurrent authorization from another worktree", () => { const release = acquireAuthorizationLock({ targetRoot: root }); try { assert.throws(() => acquireAuthorizationLock({ targetRoot: sibling }), /AUTHORIZATION_LOCKED/); } finally { release(); } });
  const revoke = planAuthorization({ targetRoot: sibling, action: "revoke" }); applyAuthorization(revoke);
  check("revocation covers all worktrees and stale grant cannot reactivate", () => { assert.equal(readActivation({ targetRoot: root }).state, "revoked"); assert.equal(readActivation({ targetRoot: sibling }).state, "revoked"); assert.throws(() => applyAuthorization(grant), /CAS_CONFLICT/); assert.equal(applyAuthorization(revoke).written, false); });
  const regrant = planAuthorization({ targetRoot: root, action: "authorize" }); applyAuthorization(regrant);
  check("explicit reauthorization advances revision with no worktree reinstallation", () => { assert.equal(readActivation({ targetRoot: root }).authorization.revision, 3); assert.equal(readActivation({ targetRoot: sibling }).state, "active"); });
  const authorityBytes = fs.readFileSync(fixture.identity.authority_path); fs.unlinkSync(fixture.identity.authority_path);
  check("migrated receipt missing its authority never falls back to legacy", () => { const result = readActivation({ targetRoot: root }); assert.equal(result.state, "degraded"); assert(result.errors.some((error) => error.includes("AUTHORITY_MISSING"))); });
  fs.writeFileSync(fixture.identity.authority_path, authorityBytes);
  check("pending install and incomplete transaction remain inactive", () => {
    put(root, ".aidn/install/pending.json", "{}\n"); assert.equal(readActivation({ targetRoot: root }).active, false); fs.unlinkSync(path.join(root, ".aidn/install/pending.json"));
    const receipt = json(root, ".aidn/install/receipt.json"), relative = `.aidn/install/transactions/${receipt.last_transaction}.json`, bytes = fs.readFileSync(path.join(root, relative));
    const tx = json(root, relative); delete tx.integrity_sha256; tx.external_status = "pending"; put(root, relative, JSON.stringify(sealed(tx))); assert.equal(readActivation({ targetRoot: root }).active, false); put(root, relative, bytes);
  });
  check("complete rollback and uninstall permit explicitly skipped external work", () => {
    const receipt = json(root, ".aidn/install/receipt.json"), relative = `.aidn/install/transactions/${receipt.last_transaction}.json`, original = fs.readFileSync(path.join(root, relative));
    for (const action of ["rollback", "uninstall"]) {
      const tx = JSON.parse(original); delete tx.integrity_sha256; tx.action = action; tx.external_status = "skipped";
      put(root, relative, JSON.stringify(sealed(tx))); assert.equal(readActivation({ targetRoot: root }).state, "active");
    }
    const invalidTx = JSON.parse(original); delete invalidTx.integrity_sha256; invalidTx.action = "install"; invalidTx.external_status = "skipped";
    put(root, relative, JSON.stringify(sealed(invalidTx))); assert.equal(readActivation({ targetRoot: root }).active, false); put(root, relative, original);
  });
  check("modified owned assets fail while client instructions and hook groups survive", () => {
    fs.appendFileSync(path.join(root, "AGENTS.md"), "\nAdditional client instructions\n");
    const hooks = json(root, ".codex/hooks.json"); hooks.hooks.Stop = [{ hooks: [{ type: "command", command: "echo third-party" }] }]; hooks.hooks.SessionStart[0].custom = true; put(root, ".codex/hooks.json", JSON.stringify(hooks)); assert.equal(readActivation({ targetRoot: root }).state, "active");
    const file = path.join(root, ".codex/hooks/aidn-session-start.mjs"), bytes = fs.readFileSync(file); fs.appendFileSync(file, "changed"); assert.equal(readActivation({ targetRoot: root }).active, false); fs.writeFileSync(file, bytes);
  });
  check("receipt paths root seal package and activation scope are validated", () => {
    const relative = ".aidn/install/receipt.json", original = fs.readFileSync(path.join(root, relative));
    for (const mutate of [r => { r.root_id = "0".repeat(64); }, r => { r.assets["../escape"] = { kind: "file", current: "" }; }, r => { r.package.entry_sha256 = "0".repeat(64); }, r => { r.activation.mode = "local"; }, r => { r.assets[".codex/hooks.json"].kind = "file"; }]) {
      const receipt = JSON.parse(original); delete receipt.integrity_sha256; mutate(receipt); put(root, relative, JSON.stringify(sealed(receipt))); assert.equal(readActivation({ targetRoot: root }).active, false);
    }
    put(root, relative, original);
  });
  const local = directory("non-git"), localFixture = installReceipt(local);
  check("non-Git authority is local and does not change other directories", () => { assert.equal(localFixture.identity.scope, "local"); assert.equal(localFixture.identity.authority_path, path.join(local, ".aidn/install/authorization.json")); applyAuthorization(planAuthorization({ targetRoot: local, action: "authorize" })); installReceipt(local, { activation: true }); assert.equal(readActivation({ targetRoot: local }).state, "active"); assert.equal(readActivation({ targetRoot: root }).state, "active"); });
  check("invalid or redirected authority cannot activate or overwrite another scope", () => {
    const bytes = fs.readFileSync(localFixture.identity.authority_path); fs.writeFileSync(localFixture.identity.authority_path, "{}"); assert.equal(readActivation({ targetRoot: local }).active, false); assert.throws(() => planAuthorization({ targetRoot: local, action: "authorize" }), /INVALID_RECORD_INTEGRITY/); fs.writeFileSync(localFixture.identity.authority_path, bytes);
    const redirected = directory("redirected"), outside = directory("outside"); fs.symlinkSync(outside, path.join(redirected, ".aidn"), process.platform === "win32" ? "junction" : "dir"); const before = snapshot(outside); assert.equal(readActivation({ targetRoot: redirected }).state, "degraded"); assert.deepEqual(snapshot(outside), before);
  });
  const concurrent = repository("concurrent"), plans = ["authorize", "revoke"].map((action) => planAuthorization({ targetRoot: concurrent, action }));
  const worker = path.join(temp, "apply.mjs"), moduleUrl = new URL("../../src/application/install/project-activation-service.mjs", import.meta.url).href;
  check("interrupted lock owner is reclaimed only after proven process death", () => {
    const lockWorker = path.join(temp, "leave-lock.mjs");
    fs.writeFileSync(lockWorker, `import {acquireAuthorizationLock} from ${JSON.stringify(moduleUrl)};acquireAuthorizationLock({targetRoot:process.argv[2]});process.exit(9);`);
    const child = spawnSync(process.execPath, [lockWorker, concurrent], { env: cleanEnv, encoding: "utf8", windowsHide: true, timeout: 10000 }); assert.equal(child.status, 9, child.stderr);
    const identity = resolveActivationTarget({ targetRoot: concurrent }), lock = `${identity.authority_path}.lock`;
    const abandoned = JSON.parse(fs.readFileSync(lock)); assert.equal(abandoned.pid, child.pid); assert.equal(abandoned.authority_id, identity.authority_id);
    const release = acquireAuthorizationLock({ targetRoot: concurrent }); assert.equal(JSON.parse(fs.readFileSync(lock)).pid, process.pid); release(); assert(!fs.existsSync(lock));
    put(path.dirname(lock), path.basename(lock), JSON.stringify({ schema_version: 1, authority_id: identity.authority_id, pid: -1, token: "invalid-owner" }));
    assert.throws(() => acquireAuthorizationLock({ targetRoot: concurrent }), /AUTHORIZATION_LOCKED/); fs.unlinkSync(lock);
  });
  fs.writeFileSync(worker, `import {applyAuthorization} from ${JSON.stringify(moduleUrl)};try{applyAuthorization(JSON.parse(Buffer.from(process.argv[2],'base64')));console.log('applied');}catch(error){console.log(error.code);process.exitCode=2;}`);
  // A process exit can precede the last stdout chunk; close waits for both pipes.
  const outcomes = await Promise.all(plans.map((plan) => new Promise((resolve, reject) => { const child = spawn(process.execPath, [worker, Buffer.from(JSON.stringify(plan)).toString("base64")], { env: cleanEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; }); child.on("error", reject); child.on("close", (code) => resolve({ code, output: output.trim() })); })));
  check("two real processes cannot commit conflicting authority plans", () => { assert.equal(outcomes.filter((result) => result.code === 0).length, 1, JSON.stringify(outcomes)); assert(outcomes.some((result) => /AUTHORIZATION_(CAS_CONFLICT|LOCKED)/.test(result.output)), JSON.stringify(outcomes)); assert.equal(readActivation({ targetRoot: concurrent }).authorization.revision, 1); });
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; }
finally {
  const resolved = path.resolve(temp), allowed = path.resolve(os.tmpdir());
  assert(resolved.startsWith(`${allowed}${path.sep}`) && path.basename(resolved).startsWith("aidn-project-activation-"));
  cleanup = removePathWithRetry(resolved);
}
const output = { ok: !failure && cleanup.ok, checks, assertions_passed: checks.length, duration_ms: Date.now() - started, failure, cleanup: { ok: cleanup.ok, attempts: cleanup.attempts, error: cleanup.error?.message ?? null } };
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
