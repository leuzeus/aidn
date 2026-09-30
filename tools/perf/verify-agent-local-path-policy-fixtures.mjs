import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { inventoryRuntime, resolveGlobalRuntime, resolveGlobalRecoveryRuntime, GLOBAL_INTEGRATION_REVISION } from "../../src/application/install/global-runtime-store.mjs";
import { resolveGlobalProjectBinding } from "../../src/application/install/global-project-integration.mjs";
import { readActivation } from "../../src/application/install/project-activation-service.mjs";
import { syncBuiltinESMExports } from "node:module";
import { inspectAgentWorktreeLocalPointers, createAgentWorktreeInspector } from "../../src/application/runtime/agent-worktree-inspection-service.mjs";
import { isExcludedAgentPath, assertAgentLocalPath } from "../../src/core/agents/agent-local-path-policy.mjs";
import { isExactExecutionPath, isAbsoluteExecutionCwd, validateAgentExecutionContract, fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "../../src/application/runtime/agent-run-configuration-service.mjs";
import { loadCodexNativePinnedJson } from "../../src/application/runtime/codex-agent-attempt-service.mjs";
import { resolveNativeAdmissionPath, evaluateNativeWriteAdmission } from "../../src/application/runtime/native-write-admission-service.mjs";
const fixture = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url), "utf8"));
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, status: "PASS" }); }
  catch (e) { checks.push({ name, status: "FAIL", detail: String(e.stack).slice(0, 1500) }); } }
const blocked = ["C:\\Users\\fixture\\OneDrive\\project", "c:/users/fixture/ONEDRIVE/project", "/home/fixture/OneDrive/project",
  "C:\\Users\\fixture\\OneDrive - Example Company\\project", "docs/OneDrive/private.txt", "OneDrive", "OneDrive - Example", "C:\\Users\\fixture\\OneDrive.\\file", "C:\\Users\\fixture\\OneDrive \\file", "C:\\Users\\fixture\\ONEDRI~1\\file", "C:\\Users\\fixture\\OneDrive:stream"];
for (const input of blocked) check("OneDrive excluded without filesystem access: " + input, () => {
  assert.equal(isExcludedAgentPath(input), true);
  assert.throws(() => assertAgentLocalPath(input), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
});
check("ordinary names and project paths remain accepted", () => {
  for (const input of ["G:\\projects\\client", "/work/project", "docs/onedrive.md", "src/OneDriveConnector.mjs", "C:\\OneDriveBackup\\project"])
    assert.equal(isExcludedAgentPath(input), false);
});
check("explicit renamed root is excluded with component boundaries and case folding", () => {
  const exclusions = ["C:\\Cloud Data"];
  assert.equal(isExcludedAgentPath("c:/cloud data/project/file", exclusions), true);
  assert.equal(isExcludedAgentPath("C:\\Cloud Database\\file", exclusions), false);
  assert.equal(isExcludedAgentPath("C:\\local\\..\\Cloud Data\\project", exclusions), true);
  assert.equal(isExcludedAgentPath("C:\\Cloud Data.\\project", exclusions), true);
  assert.deepEqual(exclusions, ["C:\\Cloud Data"]);
});
check("scope and absolute worktree contracts refuse OneDrive", () => {
  assert.equal(isExactExecutionPath("OneDrive - Example/source.mjs"), false);
  for (const input of blocked.slice(0, 4)) assert.equal(isAbsoluteExecutionCwd(input), false);
  const request = structuredClone(fixture.request); request.cwd = "C:\\Users\\fixture\\OneDrive\\project";
  assert.equal(validateAgentExecutionContract("request", request).ok, false);
  const attempt = structuredClone(fixture.attempt); attempt.worktree.cwd = "/home/fixture/OneDrive/project";
  assert.equal(validateAgentExecutionContract("attempt", attempt).ok, false);
});
check("configuration, evidence and patch path barriers refuse before file observation", () => {
  let calls = 0; const saved = new Map();
  const trap = () => { calls++; throw new Error("FILESYSTEM_TOUCHED"); };
  for (const name of ["lstatSync", "statSync", "readFileSync", "openSync"]) { saved.set(name, fs[name]); fs[name] = trap; }
  const real = fs.realpathSync.native; fs.realpathSync.native = trap;
  try {
    for (const input of blocked.filter(value => value.includes("fixture"))) {
      for (const action of [() => agentRunPhysicalPath(input), () => readAgentRunFile(input),
        () => loadCodexNativePinnedJson({ path: input, sha256: "a".repeat(64) }),
        () => resolveNativeAdmissionPath(input, input, input, { directory: true }),
        () => evaluateNativeWriteAdmission({ result: { target_root: input } })])
        assert.throws(action, { code: "AGENT_CLOUD_PATH_EXCLUDED" });
    }
    assert.throws(() => resolveNativeAdmissionPath("/work/local", "/work/local", "OneDrive/private.txt"), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
    assert.throws(() => agentRunPhysicalPath("C:\\Users\\fixture\\ONEDAB~1\\file"), { code: "AGENT_PATH_ALIAS_UNSUPPORTED" });
    assert.throws(() => agentRunPhysicalPath("C:\\local\\file:stream"), { code: "AGENT_PATH_ALIAS_UNSUPPORTED" });
    assert.throws(() => agentRunPhysicalPath("\\\\?\\C:\\local\\file"), { code: "AGENT_PATH_ALIAS_UNSUPPORTED" });
    assert.equal(calls, 0);
  } finally { for (const [name, value] of saved) fs[name] = value; fs.realpathSync.native = real; }
});
async function checkAsync(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); }
  catch (e) { checks.push({ name, status: "FAIL", detail: String(e.stack).slice(0, 1500) }); } }
async function pointerFixture(fn) {
  const temporary = fs.realpathSync.native(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, "aidn-local-pointer-fixture-")), worktree = path.join(root, "worktree");
  fs.mkdirSync(worktree); const cloud = path.join(root, "OneDrive", "never-created");
  const f = { root, worktree, cloud, write(relative, content) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; } };
  const saved = new Map(); let forbiddenReads = 0, gitCalls = 0; const spawn = childProcess.spawnSync;
  for (const name of ["lstatSync", "statSync", "readFileSync", "openSync", "readdirSync"]) { const original = fs[name]; saved.set(name, original);
    fs[name] = (...args) => { if (typeof args[0] === "string" && isExcludedAgentPath(args[0])) { forbiddenReads++; throw Error("FORBIDDEN_TARGET_ACCESS"); } return original(...args); };
  }
  const real = fs.realpathSync.native; fs.realpathSync.native = (...args) => { if (isExcludedAgentPath(args[0])) { forbiddenReads++; throw Error("FORBIDDEN_TARGET_ACCESS"); } return real(...args); };
  childProcess.spawnSync = () => { gitCalls++; throw Error("UNEXPECTED_CHILD_PROCESS"); }; syncBuiltinESMExports();
  try { await fn(f); assert.equal(forbiddenReads, 0); assert.equal(gitCalls, 0); }
  finally {
    for (const [name, original] of saved) fs[name] = original; fs.realpathSync.native = real; childProcess.spawnSync = spawn; syncBuiltinESMExports();
    assert.equal(path.dirname(fs.realpathSync.native(root)), temporary); assert.ok(path.basename(root).startsWith("aidn-local-pointer-fixture-"));
    fs.rmSync(root, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 }); assert.equal(fs.existsSync(root), false);
  }
}
await checkAsync("local .git pointer is rejected before observing its excluded target", () => pointerFixture(async f => {
  f.write("worktree/.git", `gitdir: ${f.cloud}\n`);
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
  const inspect = createAgentWorktreeInspector({ candidate: { packageRoot: path.join(f.root, "package"), archivePath: path.join(f.root, "package.tgz"), version: "1.0.0", sha256: "a".repeat(64), inventory: {} } });
  await assert.rejects(inspect({ attempt: { worktree: { cwd: f.worktree } }, request: { cwd: f.worktree } }), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
await checkAsync("relative .git pointer is checked again after lexical resolution", () => pointerFixture(async f => {
  f.write("worktree/.git", "gitdir: ../OneDrive/never-created\n");
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
await checkAsync("local Git commondir refuses an excluded common repository before access", () => pointerFixture(async f => {
  f.write("worktree/.git", `gitdir: ${path.join(f.root, "git-admin")}\n`); f.write("git-admin/commondir", f.cloud + "\n");
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
await checkAsync("local Git backlink refuses an excluded worktree before access", () => pointerFixture(async f => {
  f.write("worktree/.git", `gitdir: ${path.join(f.root, "git-admin")}\n`); f.write("git-admin/commondir", "../common\n"); fs.mkdirSync(path.join(f.root, "common"));
  f.write("git-admin/gitdir", f.cloud + "\n"); assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
for (const [name, receipt] of [
  ["native assets", { assets: { ".agents/skills/OneDrive/SKILL.md": {} } }],
  ["installation assets", { installation: { assets: { "OneDrive - Fixture/private.txt": {} } } }],
]) await checkAsync("receipt " + name + " reject excluded targets before access", () => pointerFixture(async f => {
  fs.mkdirSync(path.join(f.worktree, ".git")); f.write("worktree/.aidn/install/receipt.json", JSON.stringify(receipt));
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
await checkAsync("transaction operation paths are checked before canonical activation reads", () => pointerFixture(async f => {
  fs.mkdirSync(path.join(f.worktree, ".git")); const id = "a".repeat(32);
  f.write("worktree/.aidn/install/receipt.json", JSON.stringify({ last_transaction: id }));
  f.write("worktree/.aidn/install/transactions/" + id + ".json", JSON.stringify({ operations: [{ path: "OneDrive/private.txt" }] }));
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
await checkAsync("ordinary asset and transaction pointers remain data and bind their observed bytes", () => pointerFixture(async f => {
  fs.mkdirSync(path.join(f.worktree, ".git")); const id = "a".repeat(32);
  f.write("worktree/.aidn/install/receipt.json", JSON.stringify({ assets: { ".codex/hooks.json": {} },
    installation: { assets: { ".aidn/config.json": {} } }, last_transaction: id }));
  const file = f.write("worktree/.aidn/install/transactions/" + id + ".json", JSON.stringify({ operations: [{ path: ".codex/hooks.json" }] }));
  const before = inspectAgentWorktreeLocalPointers(f.worktree);
  assert(before.files.some(row => row.path === file && row.sha256 !== null));
  fs.writeFileSync(file, JSON.stringify({ operations: [{ path: ".codex/hooks/another.mjs" }] }));
  assert.notDeepEqual(inspectAgentWorktreeLocalPointers(f.worktree), before);
  assert.equal(Object.hasOwn(before, "active"), false);
}));
await checkAsync("receipt package pointer is refused before its contents are opened", () => pointerFixture(async f => {
  fs.mkdirSync(path.join(f.worktree, ".git")); f.write("worktree/.aidn/install/receipt.json", JSON.stringify({ package: { root: f.cloud } }));
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
await checkAsync("receipt global binding is refused before its home is opened", () => pointerFixture(async f => {
  fs.mkdirSync(path.join(f.worktree, ".git")); f.write("worktree/.aidn/install/receipt.json", JSON.stringify({ global_runtime: { home: f.cloud } }));
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
await checkAsync("global runtime asset pointers are checked before canonical verification reads them", () => pointerFixture(async f => {
  fs.mkdirSync(path.join(f.worktree, ".git")); f.write("worktree/.aidn/install/receipt.json", JSON.stringify({ global_runtime: { home: path.join(f.root, "global") } }));
  f.write("global/runtime.json", JSON.stringify({ active: { id: "a".repeat(36) }, assets: [{ path: f.cloud }] }));
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
}));
await checkAsync("ordinary local pointers produce only observations, never activation", () => pointerFixture(async f => {
  f.write("worktree/.git", `gitdir: ${path.join(f.root, "git-admin")}\n`); f.write("git-admin/commondir", "../common\n"); fs.mkdirSync(path.join(f.root, "common"));
  f.write("git-admin/gitdir", path.join(f.worktree, ".git") + "\n"); fs.mkdirSync(path.join(f.root, "package"));
  f.write("worktree/.aidn/install/receipt.json", JSON.stringify({ package: { root: path.join(f.root, "package") } }));
  const before = inspectAgentWorktreeLocalPointers(f.worktree, { expectedPackageRoot: path.join(f.root, "package") });
  assert.equal(before.git_dir, path.join(f.root, "git-admin")); assert.equal(before.common_dir, path.join(f.root, "common")); assert.equal(Object.hasOwn(before, "active"), false);
  assert.deepEqual(inspectAgentWorktreeLocalPointers(f.worktree, { expectedPackageRoot: path.join(f.root, "package") }), before);
}));
await checkAsync("pointer file hardlinks and oversized .git files fail before content parsing", () => pointerFixture(async f => {
  f.write("source.txt", "gitdir: ignored\n"); fs.linkSync(path.join(f.root, "source.txt"), path.join(f.worktree, ".git"));
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), /DELEGATED_LOCAL_POINTER_ALIAS/u);
  fs.unlinkSync(path.join(f.worktree, ".git")); f.write("worktree/.git", "x".repeat(65537));
  assert.throws(() => inspectAgentWorktreeLocalPointers(f.worktree), /DELEGATED_LOCAL_POINTER_INVALID/u);
}));
await checkAsync("changed local pointer bytes alter the preflight fingerprint without granting trust", () => pointerFixture(async f => {
  fs.mkdirSync(path.join(f.worktree, ".git")); const file = f.write("worktree/.aidn/install/receipt.json", JSON.stringify({ other: 1 }));
  const before = inspectAgentWorktreeLocalPointers(f.worktree); fs.writeFileSync(file, JSON.stringify({ other: 2 }));
  assert.notDeepEqual(inspectAgentWorktreeLocalPointers(f.worktree), before);
}));
const digest = value => createHash("sha256").update(value).digest("hex");
function globalFixture(f) {
  const id = "a".repeat(36), prefix = "global/generations/" + id, home = path.join(f.root, "global");
  const entry = "export {};\n", relative = "aidn-workflow/bin/aidn.mjs";
  f.write(prefix + "/node_modules/" + relative, entry);
  const manifest = JSON.stringify({ schema_version: 1, id, version: "1.0.0", integration_revision: GLOBAL_INTEGRATION_REVISION, files: { [relative]: digest(entry) } });
  f.write(prefix + "/manifest.json", manifest);
  const active = { id, version: "1.0.0", manifest_sha256: digest(manifest) };
  f.write("global/runtime.json", JSON.stringify({ schema_version: 1, installation_id: id, active, assets: [] }));
  return { home, active, binding: { schema_version: 1, home, installation_id: id, integration_revision: GLOBAL_INTEGRATION_REVISION },
    nodeModules: path.join(home, "generations", id, "node_modules"), packageRoot: path.join(home, "generations", id, "node_modules", "aidn-workflow") };
}
await checkAsync("optional inventory guard preserves hashes and visits each directory only once", () => pointerFixture(async f => {
  f.write("package/src/index.mjs", "export {};\n"); f.write("package/VERSION", "1.0.0\n");
  const root = path.join(f.root, "package"), historical = inventoryRuntime(root), reads = [], seen = [];
  const original = fs.readdirSync; fs.readdirSync = (...args) => { reads.push(args[0]); return original(...args); };
  try { assert.deepEqual(inventoryRuntime(root, { beforeObserve: file => { seen.push(file); assertAgentLocalPath(file); } }), historical); }
  finally { fs.readdirSync = original; }
  assert.deepEqual(reads, [root, path.join(root, "src")]); assert.equal(new Set(seen).size, 4);
  assert.equal(seen[0], root);
}));
await checkAsync("inventory guard rejects a real excluded Temp child before metadata or contents", () => pointerFixture(async f => {
  f.write("package/ExcludedFixture/private.txt", "fixture only");
  const root = path.join(f.root, "package"), excluded = path.join(root, "ExcludedFixture");
  const original = fs.lstatSync; let forbidden = 0;
  fs.lstatSync = (...args) => { if (args[0] === excluded || args[0].startsWith(excluded + path.sep)) { forbidden++; throw Error("CHILD_OBSERVED"); } return original(...args); };
  try { assert.throws(() => inventoryRuntime(root, { beforeObserve: file => assertAgentLocalPath(file, [excluded]) }), { code: "AGENT_CLOUD_PATH_EXCLUDED" }); }
  finally { fs.lstatSync = original; }
  assert.equal(forbidden, 0);
}));
await checkAsync("global project binding passes the guard to an unlisted synthetic Cloud child", () => pointerFixture(async f => {
  const g = globalFixture(f), original = fs.readdirSync;
  const historical = resolveGlobalProjectBinding(g.binding);
  assert.deepEqual(resolveGlobalProjectBinding(g.binding, { beforeObserve: assertAgentLocalPath }), historical);
  let injected = 0;
  fs.readdirSync = (...args) => {
    const rows = original(...args);
    if (args[0] === g.nodeModules) { injected++; rows.push({ name: "OneDrive", isDirectory: () => true, isFile: () => false }); }
    return rows;
  };
  try { assert.throws(() => resolveGlobalProjectBinding(g.binding, { beforeObserve: assertAgentLocalPath }), { code: "AGENT_CLOUD_PATH_EXCLUDED" }); }
  finally { fs.readdirSync = original; }
  assert.equal(injected, 1);
}));
await checkAsync("activation forwards the guard through global binding and inventory", () => pointerFixture(async f => {
  const g = globalFixture(f), rootId = digest(process.platform === "win32" ? f.worktree.toLowerCase() : f.worktree);
  const id = "b".repeat(32);
  const seal = value => ({ ...value, integrity_sha256: fingerprint(value) });
  f.write("worktree/.aidn/install/receipt.json", JSON.stringify(seal({ schema_version: 1, scope: "codex-integration", root_id: rootId,
    assets: {}, package: { root: g.packageRoot, version: "1.0.0", entry: "bin/aidn.mjs", entry_sha256: "a".repeat(64), version_sha256: "a".repeat(64) },
    global_runtime: g.binding, last_transaction: id })));
  f.write("worktree/.aidn/install/transactions/" + id + ".json", JSON.stringify(seal({ schema_version: 1, id, root_id: rootId,
    scope: "codex-integration", status: "complete", operations: [] })));
  const historical = readActivation({ targetRoot: f.worktree });
  assert.equal(historical.state, "absent"); assert.deepEqual(readActivation({ targetRoot: f.worktree, beforeObserve: assertAgentLocalPath }), historical);
  const original = fs.readdirSync; let injected = 0;
  fs.readdirSync = (...args) => {
    const rows = original(...args);
    if (args[0] === g.nodeModules) { injected++; rows.push({ name: "OneDrive", isDirectory: () => true, isFile: () => false }); }
    return rows;
  };
  try { const result = readActivation({ targetRoot: f.worktree, beforeObserve: assertAgentLocalPath }); assert.equal(result.state, "degraded"); assert.equal(result.active, false); }
  finally { fs.readdirSync = original; }
  assert.equal(injected, 1);
}));
await checkAsync("optional guards refuse roots before the first observation and require explicit global home", () => pointerFixture(async f => {
  assert.throws(() => inventoryRuntime(f.cloud, { beforeObserve: assertAgentLocalPath }), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
  assert.equal(readActivation({ targetRoot: f.cloud, beforeObserve: assertAgentLocalPath }).state, "degraded");
  assert.throws(() => resolveGlobalRuntime({ beforeObserve: assertAgentLocalPath }), { code: "GLOBAL_EXPLICIT_HOME_REQUIRED" });
  assert.throws(() => resolveGlobalRecoveryRuntime({ beforeObserve: assertAgentLocalPath }), { code: "GLOBAL_EXPLICIT_HOME_REQUIRED" });
}));
const fail = checks.filter(row => row.status === "FAIL").length;
console.log(JSON.stringify({ ok: fail === 0, pass: checks.length - fail, fail, skip: 0, checks,
  cloud_access: "NOT_RUN", permissions_changed: false, guarantee: "application-policy-only" }, null, 2));
process.exitCode = fail ? 1 : 0;
