import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import childProcess from "node:child_process";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import workerThreads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

// Synthetic objects only: these paths are labels, never created or inspected.
// No native profile, previous local qualification or external pilot is required.
const root = path.join(os.tmpdir(), "aidn-native-qualification-contracts", "projet été");
const roles = ["coordinator", "worker-a", "worker-b"];
const sha = (letter) => letter.repeat(64);
const definition = JSON.stringify({ hooks: {
  PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: "node neutral-pre-tool.mjs", timeout: 10 }] }],
  SessionStart: [{ matcher: "startup|resume|clear|compact", hooks: [{ type: "command", command: "node neutral-start.mjs", timeout: 10 }] }],
} });
const manifest = {
  status: "prepared", native_execution: "NOT_RUN", source: { head: "1".repeat(40) },
  candidate: { sha256: sha("a") }, codex: { binary_path: path.join(root, "codex-fixture"), sha256: sha("b") },
  host: { platform: process.platform, architecture: process.arch }, codex_home: path.join(root, "isolated-profile"),
  roots: roles.map((role) => ({ role, root: path.join(root, role), worktree_id: "root-" + role,
    branch: "codex/fixture-" + role, head: "2".repeat(40), identity: { root_id: "root-" + role, authority_id: "authority-fixture" },
    activation: { state: "active", authority_id: "authority-fixture", revision: 1 }, attempt_marker_present: false,
    installation: { plan_id: "old-plan", persistence_policy: "verify-only", state_mode: "files", applied: true, verified: true },
    receipt: { path: path.join(root, role, ".aidn/install/receipt.json"), root_id: "root-" + role, sha256: sha("5") },
    hooks: { config: { path: path.join(root, role, ".codex/hooks.json"), sha256: sha("c") }, definition,
      handlers: [{ path: ".codex/hooks/neutral-pre-tool.mjs", sha256: sha("d") }] } })),
};
const trust = {
  observed_at: "2026-01-01T00:00:00.000Z", source_head: manifest.source.head,
  candidate_sha256: manifest.candidate.sha256, codex_sha256: manifest.codex.sha256,
  codex_home: manifest.codex_home, human_confirmation: "Synthetic fixture reviewer", process_closed: true,
  hooks: { data: manifest.roots.slice(1).map((entry) => ({ cwd: entry.root, errors: [], warnings: [], hooks: [
    { eventName: "preToolUse", handlerType: "command", command: "node neutral-pre-tool.mjs", async: false,
      matcher: ".*", timeoutSec: 10, sourcePath: manifest.roots[0].hooks.config.path, source: "project",
      enabled: true, trustStatus: "trusted", currentHash: "sha256:" + sha("e") },
    { eventName: "sessionStart", handlerType: "command", command: "node neutral-start.mjs", async: false,
      matcher: "startup|resume|clear|compact", timeoutSec: 10, sourcePath: manifest.roots[0].hooks.config.path, source: "project",
      enabled: true, trustStatus: "trusted", currentHash: "sha256:" + sha("f") },
  ] })) },
};
const installation = { ok: true, pending: null, authorization: { effect: "unchanged" },
  external_effects: [{ id: "artifact-import", state: "skipped" }], operations: [
    { path: ".codex/hooks.json", effect: "unchanged", before_hash: sha("c"), after_hash: sha("c") },
    { path: ".codex/hooks/neutral-pre-tool.mjs", effect: "unchanged", before_hash: sha("d"), after_hash: sha("d") },
    { path: "AGENTS.md", effect: "unchanged", before_hash: sha("e"), after_hash: sha("e") },
  ] };
const transaction = ".aidn/install/transactions/" + "1".repeat(32) + ".json";
const baseline = {
  common_git_dir: path.join(root, "coordinator", ".git"), common_git_files: { HEAD: sha("1"), config: sha("2") },
  roots: manifest.roots.map(({ role, root: directory }) => ({ role, root: directory,
    git_dir: role === "coordinator" ? path.join(directory, ".git") : path.join(root, "coordinator", ".git/worktrees", role),
    git_files: { HEAD: sha("1") }, status: "",
    files: { "src/allowed.txt": sha("3"), "protected/sentinel.txt": sha("4"), ".codex/hooks.json": sha("c"),
      ".aidn/install/receipt.json": sha("5"), [transaction]: sha("6") },
    runtime: { "qualification-sentinel.json": sha("7") },
  })),
};
const markers = manifest.roots.map(({ role, root: directory }) => ({ role, root: directory,
  marker: role === "coordinator" ? { kind: "directory" } : { kind: "file", bytes: 90, sha256: sha("8") } }));
const unchangedInputs = JSON.stringify({ manifest, trust, installation, baseline, markers });

// Guard the import interval before importing any qualification implementation.
// Module/package reads are narrowly allowed; native profiles and runtime data
// are never needed. Validation below then forbids every filesystem read too.
let phase = "import";
const effects = [], restore = [], readDescriptors = new Map();
const deny = (name) => () => { effects.push(name); throw new Error("Forbidden native fixture effect: " + name); };
function replace(owner, name, value) {
  const original = owner[name];
  if (typeof original !== "function") return;
  restore.push(() => { owner[name] = original; }); owner[name] = value;
}
function prohibit(owner, names, prefix) { for (const name of names) replace(owner, name, deny(prefix + "." + name)); }
const packageRoot = path.resolve(import.meta.dirname, "../..");
const key = (value) => {
  if (value instanceof URL) value = fileURLToPath(value);
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value !== "string") return null;
  const absolute = path.resolve(value); return process.platform === "win32" ? absolute.toLowerCase() : absolute;
};
const importPaths = new Set([
  "tools/verify/prepare-agent-native-qualification.mjs", "tools/verify/refresh-agent-native-candidate.mjs",
  "tools/verify/qualify-agent-native-worker.mjs", "tools/verify/agent-native-qualification-driver.mjs",
  "tools/verify/agent-native-refusal-evidence.mjs",
  "tools/perf/agent-execution-postgres-test-lib.mjs",
].map((relative) => key(path.join(packageRoot, relative))));
const dependencies = key(path.join(packageRoot, "node_modules")) + path.sep;
function allowRead(name, value) {
  const file = Number.isInteger(value) ? readDescriptors.get(value) : key(value);
  if (phase !== "import" || !file || (!importPaths.has(file)
      && !(file.startsWith(dependencies) && /\.(?:mjs|cjs|js|json)$/.test(file)))) deny(name + ":read")();
}
const reads = ["access", "accessSync", "exists", "existsSync", "readFile", "readFileSync", "read", "readSync",
  "readv", "readvSync", "fstat", "fstatSync", "createReadStream", "stat", "statSync", "lstat", "lstatSync",
  "realpath", "realpathSync", "readlink", "readlinkSync", "readdir", "readdirSync", "opendir", "opendirSync", "openAsBlob"];
for (const [owner, prefix] of [[fs, "fs"], [fsPromises, "fs.promises"]]) {
  for (const name of reads) {
    const original = owner[name];
    if (typeof original !== "function") continue;
    const guarded = function (file, ...args) { allowRead(prefix + "." + name, file); return original.call(this, file, ...args); };
    if (typeof original.native === "function") guarded.native = function (file, ...args) { allowRead(prefix + "." + name + ".native", file); return original.native.call(this, file, ...args); };
    replace(owner, name, guarded);
  }
  prohibit(owner, ["appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync", "copyFile", "copyFileSync",
    "cp", "cpSync", "createWriteStream", "fchmod", "fchmodSync", "fchown", "fchownSync", "ftruncate", "ftruncateSync",
    "link", "linkSync", "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync", "rename", "renameSync", "rm", "rmSync", "rmdir", "rmdirSync",
    "symlink", "symlinkSync", "truncate", "truncateSync", "unlink", "unlinkSync", "utimes", "utimesSync", "write", "writeSync",
    "writeFile", "writeFileSync", "writev", "writevSync", "watch", "watchFile", "glob", "globSync"], prefix);
  for (const name of ["open", "openSync"]) {
    const original = owner[name];
    if (typeof original !== "function") continue;
    replace(owner, name, function (file, flags, ...args) {
      if (flags !== "r" && flags !== "rs" && flags !== fs.constants.O_RDONLY) deny(prefix + "." + name + ":write")();
      allowRead(prefix + "." + name, file);
      if (owner === fsPromises) return original.call(this, file, flags, ...args).then((handle) => {
        readDescriptors.set(handle.fd, key(file));
        const close = handle.close.bind(handle);
        handle.close = (...closeArgs) => { readDescriptors.delete(handle.fd); return close(...closeArgs); };
        return handle;
      });
      if (name === "openSync") {
        const fd = original.call(this, file, flags, ...args); readDescriptors.set(fd, key(file)); return fd;
      }
      const callback = args.pop();
      return original.call(this, file, flags, ...args, (error, fd) => { if (!error) readDescriptors.set(fd, key(file)); callback(error, fd); });
    });
  }
}
for (const name of ["close", "closeSync"]) {
  const original = fs[name];
  replace(fs, name, function (fd, ...args) { readDescriptors.delete(fd); return original.call(this, fd, ...args); });
}
prohibit(childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], "child_process");
prohibit(workerThreads, ["Worker"], "worker_threads");
prohibit(net, ["connect", "createConnection", "createServer"], "net");
prohibit(net.Socket.prototype, ["connect"], "net.Socket");
prohibit(net.Server.prototype, ["listen"], "net.Server");
prohibit(http, ["request", "get", "createServer"], "http");
prohibit(https, ["request", "get", "createServer"], "https");
prohibit(tls, ["connect", "createServer"], "tls");
prohibit(dgram, ["createSocket"], "dgram");
prohibit(dns, ["lookup", "resolve", "resolve4", "resolve6"], "dns");
prohibit(dns.promises, ["lookup", "resolve", "resolve4", "resolve6"], "dns.promises");
replace(globalThis, "fetch", deny("fetch"));
replace(process, "chdir", deny("process.chdir"));
syncBuiltinESMExports();

let checks = 0;
const check = async (name, body) => { await body(); checks += 1; process.stdout.write("PASS " + name + "\n"); };
try {
  assert.throws(() => fs.readFileSync(path.join(root, ".aidn/config.json")), /Forbidden native fixture effect/);
  assert.deepEqual(effects, ["fs.readFileSync:read"]); effects.length = 0;
  const refresh = await import("../verify/refresh-agent-native-candidate.mjs");
  const preparation = await import("../verify/prepare-agent-native-qualification.mjs");
  const qualification = await import("../verify/qualify-agent-native-worker.mjs");
  const driver = await import("../verify/agent-native-qualification-driver.mjs");
  const refusal = await import("../verify/agent-native-refusal-evidence.mjs");
  phase = "validation";
  await check("native tool imports perform no writes, process launch or connection", () => {
    assert.deepEqual(effects, []);
    for (const fn of [refresh.refreshAgentNativeCandidate, preparation.prepareAgentNativeQualification,
      qualification.qualifyAgentNativeWorker, driver.runNativeQualificationCase]) assert.equal(typeof fn, "function");
  });
  const review = refresh.assertAgentNativeRefreshReview, plan = refresh.assertAgentNativeRefreshPlan;
  const preserve = refresh.assertAgentNativeRefreshPreservation, gitMarkers = refresh.assertAgentNativeRefreshGitMarkers;
  const rejects = (fn, code) => assert.throws(fn, { code });
  await check("native review accepts both worktrees with the shared coordinator source", () => assert.equal(review(manifest, trust), true));
  for (const [name, mutate, code] of [
    ["foreign candidate", (v) => { v.candidate_sha256 = sha("0"); }, "REFRESH_NATIVE_REVIEW_BINDING_MISMATCH"],
    ["foreign source commit", (v) => { v.source_head = "0".repeat(40); }, "REFRESH_NATIVE_REVIEW_BINDING_MISMATCH"],
    ["foreign native binary", (v) => { v.codex_sha256 = sha("0"); }, "REFRESH_NATIVE_REVIEW_BINDING_MISMATCH"],
    ["foreign native home", (v) => { v.codex_home += "-other"; }, "REFRESH_NATIVE_REVIEW_BINDING_MISMATCH"],
    ["unclosed native observer", (v) => { v.process_closed = false; }, "REFRESH_NATIVE_REVIEW_BINDING_MISMATCH"],
    ["missing human review", (v) => { v.human_confirmation = ""; }, "REFRESH_NATIVE_REVIEW_BINDING_MISMATCH"],
    ["invalid observation time", (v) => { v.observed_at = "unknown"; }, "REFRESH_NATIVE_REVIEW_BINDING_MISMATCH"],
    ["foreign worktree", (v) => { v.hooks.data[0].cwd += "-other"; }, "REFRESH_NATIVE_ROOT_MISMATCH"],
    ["duplicate worktree", (v) => { v.hooks.data[1] = structuredClone(v.hooks.data[0]); }, "REFRESH_NATIVE_ROOT_MISMATCH"],
    ["missing native surface", (v) => { v.hooks.data.pop(); }, "REFRESH_NATIVE_HOOKS_REQUIRED"],
    ["native warning", (v) => { v.hooks.data[0].warnings.push("fixture warning"); }, "REFRESH_NATIVE_HOOKS_REQUIRED"],
    ["native error", (v) => { v.hooks.data[0].errors.push("fixture error"); }, "REFRESH_NATIVE_HOOKS_REQUIRED"],
    ["extra hook", (v) => { v.hooks.data[0].hooks.push(structuredClone(v.hooks.data[0].hooks[0])); }, "REFRESH_NATIVE_HOOKS_REQUIRED"],
    ["untrusted hook", (v) => { v.hooks.data[0].hooks[0].trustStatus = "untrusted"; }, "REFRESH_NATIVE_HOOK_UNTRUSTED"],
    ["disabled hook", (v) => { v.hooks.data[0].hooks[0].enabled = false; }, "REFRESH_NATIVE_HOOK_UNTRUSTED"],
    ["foreign hook source", (v) => { v.hooks.data[0].hooks[0].sourcePath += "-other"; }, "REFRESH_NATIVE_HOOK_UNTRUSTED"],
    ["user hook scope", (v) => { v.hooks.data[0].hooks[0].source = "user"; }, "REFRESH_NATIVE_HOOK_UNTRUSTED"],
    ["asynchronous handler", (v) => { v.hooks.data[0].hooks[0].async = true; }, "REFRESH_NATIVE_HOOK_UNTRUSTED"],
    ["malformed native hash", (v) => { v.hooks.data[0].hooks[0].currentHash = "approved"; }, "REFRESH_NATIVE_HOOK_UNTRUSTED"],
    ["non-command handler", (v) => { v.hooks.data[0].hooks[0].handlerType = "prompt"; }, "REFRESH_NATIVE_HOOK_UNTRUSTED"],
    ["changed executable command", (v) => { v.hooks.data[0].hooks[0].command += " changed"; }, "REFRESH_NATIVE_DEFINITION_MISMATCH"],
    ["changed pretool matcher", (v) => { v.hooks.data[0].hooks[0].matcher = "apply_patch"; }, "REFRESH_NATIVE_DEFINITION_MISMATCH"],
    ["changed timeout", (v) => { v.hooks.data[0].hooks[0].timeoutSec = 11; }, "REFRESH_NATIVE_DEFINITION_MISMATCH"],
    ["changed startup matcher", (v) => { v.hooks.data[0].hooks[1].matcher = ".*"; }, "REFRESH_NATIVE_DEFINITION_MISMATCH"],
  ]) await check("review rejects " + name, () => { const value = structuredClone(trust); mutate(value); rejects(() => review(manifest, value), code); });
  await check("a completed native result cannot be reused as preparation", () => {
    const value = structuredClone(manifest); value.native_execution = "PASS";
    rejects(() => review(value, trust), "REFRESH_PREPARATION_REQUIRED");
  });
  await check("receipt-only installation plan accepted", () => assert.equal(plan(installation), true));
  for (const [name, mutate, code] of [
    ["pending installation", (v) => { v.pending = "transaction"; }, "REFRESH_INSTALL_PLAN_UNREADY"],
    ["missing hook operations", (v) => { v.operations = v.operations.slice(2); }, "REFRESH_HOOK_PLAN_MISSING"],
    ["hook update", (v) => { v.operations[0].effect = "update"; v.operations[0].after_hash = sha("0"); }, "REFRESH_INSTALL_ASSETS_CHANGED"],
    ["handler byte change labelled unchanged", (v) => { v.operations[1].after_hash = sha("0"); }, "REFRESH_INSTALL_ASSETS_CHANGED"],
    ["extra installed asset", (v) => { v.operations.push({ path: "other.txt", effect: "create", before_hash: null, after_hash: sha("0") }); }, "REFRESH_INSTALL_ASSETS_CHANGED"],
    ["authorization update", (v) => { v.authorization.effect = "update"; }, "REFRESH_AUTHORIZATION_CHANGE_FORBIDDEN"],
    ["external persistence effect", (v) => { v.external_effects[0].state = "deferred"; }, "REFRESH_EXTERNAL_EFFECT_FORBIDDEN"],
  ]) await check("refresh plan rejects " + name, () => { const value = structuredClone(installation); mutate(value); rejects(() => plan(value), code); });
  await check("unchanged baseline accepted", () => assert.equal(preserve(baseline, structuredClone(baseline)), true));
  await check("own new receipt and transaction accepted", () => {
    const value = structuredClone(baseline); value.roots[0].files[".aidn/install/receipt.json"] = sha("0");
    value.roots[0].files[".aidn/install/transactions/" + "2".repeat(32) + ".json"] = sha("0");
    assert.equal(preserve(baseline, value, ["coordinator"]), true);
  });
  for (const [name, mutate, code] of [
    ["other worktree contents", (v) => { v.roots[1].files["src/allowed.txt"] = sha("0"); }, "REFRESH_UNEXPECTED_ROOT_CHANGE"],
    ["previous transaction overwritten", (v) => { v.roots[0].files[transaction] = sha("0"); }, "REFRESH_UNEXPECTED_ROOT_CHANGE"],
    ["forbidden content deleted", (v) => { delete v.roots[0].files["protected/sentinel.txt"]; }, "REFRESH_UNEXPECTED_ROOT_CHANGE"],
    ["hook definition modified", (v) => { v.roots[0].files[".codex/hooks.json"] = sha("0"); }, "REFRESH_UNEXPECTED_ROOT_CHANGE"],
    ["runtime sentinel modified", (v) => { v.roots[0].runtime["qualification-sentinel.json"] = sha("0"); }, "REFRESH_RUNTIME_CHANGED"],
    ["common Git changed", (v) => { v.common_git_files.HEAD = sha("0"); }, "REFRESH_GIT_CHANGED"],
    ["worktree Git changed", (v) => { v.roots[1].git_files.HEAD = sha("0"); }, "REFRESH_GIT_CHANGED"],
    ["Git status changed", (v) => { v.roots[0].status = " M file\n"; }, "REFRESH_GIT_CHANGED"],
  ]) await check("preservation rejects " + name, () => { const value = structuredClone(baseline); mutate(value); rejects(() => preserve(baseline, value, ["coordinator"]), code); });
  await check("unchanged git pointers accepted", () => assert.equal(gitMarkers(markers, structuredClone(markers)), true));
  for (const [name, mutate] of [
    ["hash", (v) => { v[1].marker.sha256 = sha("0"); }],
    ["size", (v) => { v[1].marker.bytes += 1; }],
    ["type", (v) => { v[1].marker = { kind: "directory" }; }],
    ["root identity", (v) => { v[1].root += "-other"; }],
  ]) await check("git pointer rejects changed " + name, () => { const value = structuredClone(markers); mutate(value); rejects(() => gitMarkers(markers, value), "REFRESH_GIT_MARKER_CHANGED"); });
  const continuity = qualification.assertAgentNativeQualificationRefreshContinuity;
  const refreshed = () => {
    const currentManifest = structuredClone(manifest), currentTrust = structuredClone(trust);
    currentManifest.source.head = "3".repeat(40); currentTrust.source_head = currentManifest.source.head;
    currentManifest.candidate.sha256 = sha("9"); currentTrust.candidate_sha256 = currentManifest.candidate.sha256;
    for (const entry of currentManifest.roots) { entry.receipt.sha256 = sha("9"); entry.installation.plan_id = "new-plan"; }
    return { manifest: currentManifest, trust: currentTrust, previousManifest: manifest, previousTrust: trust };
  };
  await check("refresh continuity accepts a new package and root-specific receipt hashes", () => assert.equal(continuity(refreshed()), true));
  for (const [name, mutate, code] of [
    ["native home", (v) => { v.manifest.codex_home += "-other"; v.trust.codex_home = v.manifest.codex_home; }, "QUALIFICATION_REFRESH_NATIVE_RUNTIME_CHANGED"],
    ["native executable", (v) => { v.manifest.codex.binary_path += "-other"; }, "QUALIFICATION_REFRESH_NATIVE_RUNTIME_CHANGED"],
    ["native binary hash", (v) => { v.manifest.codex.sha256 = sha("0"); v.trust.codex_sha256 = sha("0"); }, "QUALIFICATION_REFRESH_NATIVE_RUNTIME_CHANGED"],
    ["operating system", (v) => { v.manifest.host.platform = "other"; }, "QUALIFICATION_REFRESH_NATIVE_RUNTIME_CHANGED"],
    ["worktree ID", (v) => { v.manifest.roots[1].worktree_id += "-other"; }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["branch", (v) => { v.manifest.roots[1].branch += "-other"; }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["input commit", (v) => { v.manifest.roots[1].head = "0".repeat(40); }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["activation revision", (v) => { v.manifest.roots[1].activation.revision += 1; }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["hook handler bytes", (v) => { v.manifest.roots[1].hooks.handlers[0].sha256 = sha("0"); }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["receipt root binding", (v) => { v.manifest.roots[1].receipt.root_id += "-other"; }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["receipt path", (v) => { v.manifest.roots[1].receipt.path += "-other"; }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["persistence policy", (v) => { v.manifest.roots[1].installation.persistence_policy = "adopt"; }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["previous attempt marker", (v) => { v.manifest.roots[1].attempt_marker_present = true; }, "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED"],
    ["native approval hash", (v) => { v.trust.hooks.data[0].hooks[0].currentHash = "sha256:" + sha("0"); }, "QUALIFICATION_REFRESH_NATIVE_DEFINITION_CHANGED"],
    ["native hook source", (v) => { v.trust.hooks.data[0].hooks[0].sourcePath = v.manifest.roots[1].hooks.config.path; }, "QUALIFICATION_REFRESH_NATIVE_DEFINITION_CHANGED"],
  ]) await check("refresh continuity rejects changed " + name, () => { const value = refreshed(); mutate(value); rejects(() => continuity(value), code); });
  await check("preparation invalid path fails before filesystem or process access", async () => {
    await assert.rejects(preparation.prepareAgentNativeQualification({ outputRoot: "relative" }), { code: "PREPARATION_ABSOLUTE_PATH_REQUIRED" });
  });
  await check("refresh invalid path fails before filesystem or process access", async () => {
    await assert.rejects(refresh.refreshAgentNativeCandidate({ manifestPath: "relative" }), { code: "REFRESH_ABSOLUTE_PATH_REQUIRED" });
  });
  await check("qualification invalid path fails before filesystem or process access", async () => {
    await assert.rejects(qualification.qualifyAgentNativeWorker({ manifest: "relative" }), { code: "QUALIFICATION_ABSOLUTE_PATH_REQUIRED" });
  });
  await check("qualification rejects nonboolean write before any effect", async () => {
    await assert.rejects(qualification.qualifyAgentNativeWorker({ write: "true" }), { code: "QUALIFICATION_EXPLICIT_WRITE_BOOLEAN_REQUIRED" });
  });
  const makeLineage = () => {
    const previousManifest = structuredClone(manifest), previousTrust = structuredClone(trust);
    previousManifest.output_root = root;
    previousManifest.candidate.packageRoot = path.join(root, "engine");
    previousManifest.candidate.archivePath = path.join(root, "artifacts/package.tgz");
    const previous = { manifest: previousManifest, evidence: previousTrust, manifestPath: path.join(root, "manifest.json"),
      manifestSha256: sha("1"), trustEvidencePath: path.join(root, "trust.json"), trustSha256: sha("2") };
    const current = structuredClone(previous);
    current.manifest.output_root = root + "-refresh";
    current.manifestPath = path.join(current.manifest.output_root, "manifest.json");
    current.trustEvidencePath = path.join(current.manifest.output_root, "trust.json");
    current.manifestSha256 = sha("3"); current.trustSha256 = sha("4");
    current.manifest.candidate.packageRoot = path.join(current.manifest.output_root, "engine");
    current.manifest.candidate.archivePath = path.join(current.manifest.output_root, "artifacts/package.tgz");
    current.manifest.refresh = { prior_manifest: previous.manifestPath, prior_manifest_sha256: previous.manifestSha256,
      trust_evidence: { path: previous.trustEvidencePath, sha256: previous.trustSha256 } };
    return [current, previous];
  };
  const lineageOutput = root + "-next";
  await check("initial refresh layout uses the original preparation roots", () => {
    assert.equal(refresh.assertAgentNativeRefreshLineage(makeLineage().slice(1), lineageOutput), root);
  });
  await check("repeated refresh retains reviewed roots in the original output", () => {
    const lineage = makeLineage(), before = JSON.stringify(lineage);
    assert.equal(refresh.assertAgentNativeRefreshLineage(lineage, lineageOutput), root);
    assert.equal(JSON.stringify(lineage), before);
  });
  for (const [name, mutate, code] of [
    ["changed ancestor manifest hash", v => { v[1].manifestSha256 = sha("0"); }, "REFRESH_LINEAGE_BINDING_MISMATCH"],
    ["changed ancestor trust hash", v => { v[1].trustSha256 = sha("0"); }, "REFRESH_LINEAGE_BINDING_MISMATCH"],
    ["foreign ancestor path", v => { v[0].manifest.refresh.prior_manifest += "-other"; }, "REFRESH_LINEAGE_BINDING_MISMATCH"],
    ["changed approved definition", v => { v[0].evidence.hooks.data[0].hooks[0].currentHash = "sha256:" + sha("0"); }, "QUALIFICATION_REFRESH_NATIVE_DEFINITION_CHANGED"],
    ["foreign package output", v => { v[0].manifest.candidate.packageRoot = lineageOutput; }, "REFRESH_PREPARATION_PATH_MISMATCH"],
    ["relative ancestor output", v => { v[1].manifest.output_root = "relative"; }, "REFRESH_ABSOLUTE_PATH_REQUIRED"],
    ["truncated origin", v => { v.pop(); }, "REFRESH_LINEAGE_INCOMPLETE"],
  ]) await check("refresh lineage rejects " + name, () => {
    const lineage = makeLineage(); mutate(lineage);
    rejects(() => refresh.assertAgentNativeRefreshLineage(lineage, lineageOutput), code);
  });
  await check("refresh output cannot be inside an older preparation", () => {
    rejects(() => refresh.assertAgentNativeRefreshLineage(makeLineage(), path.join(root, "nested")), "REFRESH_OUTPUT_OVERLAP");
  });
  await check("refresh lineage has a finite depth", () => {
    rejects(() => refresh.assertAgentNativeRefreshLineage(Array(33).fill(makeLineage()[0]), lineageOutput), "REFRESH_LINEAGE_LIMIT");
  });
  await check("refresh lineage rejects a cycle", () => {
    const lineage = makeLineage(), first = lineage[0], second = lineage[1];
    second.manifest.refresh = { prior_manifest: first.manifestPath, prior_manifest_sha256: first.manifestSha256,
      trust_evidence: { path: first.trustEvidencePath, sha256: first.trustSha256 } };
    lineage.push(first);
    rejects(() => refresh.assertAgentNativeRefreshLineage(lineage, lineageOutput), "REFRESH_LINEAGE_CYCLE");
  });
  // Async in-memory publication double, explicitly not a PostgreSQL proof.
  // The shared adapter inserts revision 0; execution contracts require >= 1.
  const planningCanonical={project_id:"native.project",workspace_id:"native.workspace",session_id:"S001",plan_ref:"docs/audit/BACKLOG.md",plan_sha256:sha("a"),planning_revision:1};
  const planningKey="native-qualification";
  const planningRow=revision=>({project_id:planningCanonical.project_id,workspace_id:planningCanonical.workspace_id,planning_key:planningKey,
    session_id:planningCanonical.session_id,backlog_artifact_ref:planningCanonical.plan_ref,backlog_artifact_sha256:planningCanonical.plan_sha256,revision});
  function planningDouble(responses) {
    const calls=[];let active=false;
    return {calls,shared:{async upsertPlanningState(input) {
      assert.equal(active,false,"planning publications must be awaited serially");active=true;calls.push(structuredClone(input));
      await Promise.resolve();active=false;return structuredClone(responses[calls.length-1]);
    }}};
  }
  await check("qualification seed publishes revision zero then CAS revision one before reservation",async()=>{
    const double=planningDouble([{ok:true,planning_state:planningRow(0)},{ok:true,planning_state:planningRow(1)}]);
    const before=JSON.stringify(planningCanonical);
    const row=await driver.seedNativeQualificationPlanning({shared:double.shared,canonical:planningCanonical,planningKey});
    assert.equal(row.revision,1);
    const publication={projectId:planningCanonical.project_id,workspaceId:planningCanonical.workspace_id,planningKey,sessionId:planningCanonical.session_id,
      backlogArtifactRef:planningCanonical.plan_ref,backlogArtifactSha256:planningCanonical.plan_sha256};
    assert.deepEqual(double.calls,[{...publication,expectedRevision:null},{...publication,expectedRevision:0}]);
    assert.equal(JSON.stringify(planningCanonical),before);
  });
  for(const [name,initial,published,code,count] of [
    ["failed initial publication",{ok:false},null,"QUALIFICATION_PLANNING_FAILED",1],
    ["unexpected initial revision",{ok:true,planning_state:planningRow(1)},null,"QUALIFICATION_PLANNING_REVISION_MISMATCH",1],
    ["foreign initial planning",{ok:true,planning_state:{...planningRow(0),planning_key:"other"}},null,"QUALIFICATION_PLANNING_BINDING_MISMATCH",1],
    ["failed CAS publication",{ok:true,planning_state:planningRow(0)},{ok:false,reason_code:"SHARED_PLANNING_REVISION_CONFLICT"},"QUALIFICATION_PLANNING_FAILED",2],
    ["unpublished revision zero",{ok:true,planning_state:planningRow(0)},{ok:true,planning_state:planningRow(0)},"QUALIFICATION_PLANNING_REVISION_MISMATCH",2],
    ["unexpected newer revision",{ok:true,planning_state:planningRow(0)},{ok:true,planning_state:planningRow(2)},"QUALIFICATION_PLANNING_REVISION_MISMATCH",2],
  ]) await check("qualification seed rejects "+name,async()=>{
    const double=planningDouble([initial,published]);
    await assert.rejects(driver.seedNativeQualificationPlanning({shared:double.shared,canonical:planningCanonical,planningKey}),{code});
    assert.equal(double.calls.length,count);
  });
  for(const key of ["project_id","workspace_id","planning_key","session_id","backlog_artifact_ref","backlog_artifact_sha256"])
    await check("qualification seed rejects foreign published "+key,async()=>{
      const double=planningDouble([{ok:true,planning_state:planningRow(0)},{ok:true,planning_state:{...planningRow(1),[key]:"foreign"}}]);
      await assert.rejects(driver.seedNativeQualificationPlanning({shared:double.shared,canonical:planningCanonical,planningKey}),{code:"QUALIFICATION_PLANNING_BINDING_MISMATCH"});
      assert.equal(double.calls.length,2);
    });
  await check("qualification seed rejects a nonpositive plan revision before publication",async()=>{
    const double=planningDouble([]);
    await assert.rejects(driver.seedNativeQualificationPlanning({shared:double.shared,canonical:{...planningCanonical,planning_revision:0},planningKey}),{code:"QUALIFICATION_PLANNING_SEED_REVISION_INVALID"});
    assert.deepEqual(double.calls,[]);
  });
  const intentRequest = { run_id: "run.fixture", attempt_id: "attempt.fixture",
    ownership: { owner_id: "fixture", generation: 1 }, paths: ["first", "second"] };
  const reorderedIntent = () => ({ attempt: { lifecycle_status: "launch_intended" }, runner: null,
    request: { paths: ["first", "second"], ownership: { generation: 1, owner_id: "fixture" },
      attempt_id: "attempt.fixture", run_id: "run.fixture" } });
  await check("durable intent accepts JSONB object key reordering without changing either input", () => {
    const durable = reorderedIntent(), before = JSON.stringify([durable, intentRequest]);
    assert.equal(driver.assertNativeQualificationLaunchIntent(durable, intentRequest), true);
    assert.equal(JSON.stringify([durable, intentRequest]), before);
  });
  for (const [name, mutate] of [
    ["request value", v => { v.request.ownership.generation += 1; }],
    ["array order", v => { v.request.paths.reverse(); }],
    ["lifecycle", v => { v.attempt.lifecycle_status = "claimed"; }],
    ["unexpected runner", v => { v.runner = { pid: 123 }; }],
  ]) await check("durable intent rejects changed " + name, () => {
    const durable = reorderedIntent(); mutate(durable);
    rejects(() => driver.assertNativeQualificationLaunchIntent(durable, intentRequest), "QUALIFICATION_INTENT_NOT_DURABLE");
  });
  const deniedPatch="*** Begin Patch\n*** Update File: protected/sentinel.txt\n@@\n-old été\n+new رفض\n*** End Patch";
  const nativePrefix="2026-01-01T00:00:01.123456Z ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: ";
  const nativeLine=nativePrefix+refusal.DELEGATED_NATIVE_REFUSAL_REASON+". Command: "+deniedPatch+"\n";
  const collectRefusal=(text=nativeLine,chunkSize=4096,options={})=>{
    const bytes=Buffer.isBuffer(text)?text:Buffer.from(text), collector=refusal.createAgentNativeRefusalEvidence({codexSha256:sha("b"),...options});
    for(let offset=0;offset<bytes.length;offset+=chunkSize) collector.push(bytes.subarray(offset,offset+chunkSize));
    const capture=collector.finish();
    return {capture,capturedStderr:{sha256:driver.hash(bytes),bytes:bytes.length},codexSha256:sha("b"),expectedPatch:deniedPatch,
      decision:{ok:false,outcome:"deny",reason_code:"DELEGATED_SCOPE_REFUSED"},
      interval:{start_offset:0,end_offset:bytes.length,start_at:"2026-01-01T00:00:00.000Z",end_at:"2026-01-01T00:00:02.000Z"}};
  };
  await check("native stderr refusal binds exact retained bytes, client and complete patch",()=>{
    const input=collectRefusal(),before=JSON.stringify(input),proof=refusal.assertAgentNativeRefusalEvidence(input);
    assert.equal(proof.source,"codex-native-stderr-router");assert.equal(proof.record_sha256,driver.hash(Buffer.from(nativeLine)));
    assert.equal(proof.patch_sha256,driver.hash(deniedPatch));assert.equal(proof.stderr_sha256,input.capturedStderr.sha256);
    assert.equal(JSON.stringify(input),before);assert(Object.isFrozen(input.capture));
  });
  await check("native stderr handles every UTF8 byte boundary",()=>{
    const proof=refusal.assertAgentNativeRefusalEvidence(collectRefusal(nativeLine,1));
    assert.equal(proof.patch_sha256,driver.hash(deniedPatch));
  });
  await check("native stderr supports CRLF without changing raw evidence hashes",()=>{
    const bytes=nativeLine.replaceAll("\n","\r\n"),proof=refusal.assertAgentNativeRefusalEvidence(collectRefusal(bytes,3));
    assert.equal(proof.record_sha256,driver.hash(bytes));assert.equal(proof.patch_sha256,driver.hash(deniedPatch));
  });
  await check("native stderr supports a complete final record without newline",()=>{
    assert.equal(refusal.assertAgentNativeRefusalEvidence(collectRefusal(nativeLine.slice(0,-1))).source,"codex-native-stderr-router");
  });
  await check("native stderr offsets isolate one admission despite unrelated log lines",()=>{
    const prefix="unrelated native diagnostic\n",input=collectRefusal(prefix+nativeLine);
    input.interval.start_offset=Buffer.byteLength(prefix);
    assert.equal(refusal.assertAgentNativeRefusalEvidence(input).start_offset,Buffer.byteLength(prefix));
  });
  for(const [name,mutate,code] of [
    ["client hash",v=>{v.codexSha256=sha("0");},"NATIVE_REFUSAL_CAPTURE_BINDING_MISMATCH"],
    ["retained stderr hash",v=>{v.capturedStderr.sha256=sha("0");},"NATIVE_REFUSAL_CAPTURE_BINDING_MISMATCH"],
    ["retained stderr size",v=>{v.capturedStderr.bytes++;},"NATIVE_REFUSAL_CAPTURE_BINDING_MISMATCH"],
    ["fabricated JSON capture",v=>{v.capture=structuredClone(v.capture);},"NATIVE_REFUSAL_CAPTURE_BINDING_MISMATCH"],
    ["server allow",v=>{v.decision={ok:true,outcome:"allow",reason_code:"DELEGATED_PATCH_ADMITTED"};},"NATIVE_REFUSAL_SERVER_DENY_REQUIRED"],
    ["unrelated server failure",v=>{v.decision.reason_code="ADMISSION_RUNTIME_UNAVAILABLE";},"NATIVE_REFUSAL_SERVER_DENY_REQUIRED"],
    ["wrong complete patch",v=>{v.expectedPatch=deniedPatch.replace("protected/sentinel.txt","other.txt");},"NATIVE_REFUSAL_PATCH_MISMATCH"],
    ["patch split across admission interval",v=>{v.interval.start_offset=1;},"NATIVE_REFUSAL_AMBIGUOUS"],
    ["record before admission",v=>{v.interval.start_at="2026-01-01T00:00:01.500Z";},"NATIVE_REFUSAL_TIMESTAMP_OUTSIDE_INTERVAL"],
    ["record after next admission",v=>{v.interval.end_at="2026-01-01T00:00:01.000Z";},"NATIVE_REFUSAL_TIMESTAMP_OUTSIDE_INTERVAL"],
    ["invalid interval",v=>{v.interval.end_at=v.interval.start_at;},"NATIVE_REFUSAL_INTERVAL_INVALID"],
  ]) await check("native stderr refuses "+name,()=>{const input=collectRefusal();mutate(input);rejects(()=>refusal.assertAgentNativeRefusalEvidence(input),code);});
  for(const [name,text,code] of [
    ["agent-message prose",JSON.stringify({type:"item.completed",item:{type:"agent_message",text:nativeLine}})+"\n","NATIVE_REFUSAL_MISSING"],
    ["quoted router spoof","> "+nativeLine,"NATIVE_REFUSAL_MISSING"],
    ["other logger",nativeLine.replace("codex_core::tools::router","codex_core::tools::other"),"NATIVE_REFUSAL_MISSING"],
    ["empty stderr","","NATIVE_REFUSAL_MISSING"],
    ["duplicate native record",nativeLine+nativeLine,"NATIVE_REFUSAL_AMBIGUOUS"],
    ["runtime error instead of delegated deny",nativeLine.replace(refusal.DELEGATED_NATIVE_REFUSAL_REASON,"AIDN: admission_runtime_unavailable; diagnose the installation or canonical state before editing."),"NATIVE_REFUSAL_HOOK_REASON_MISMATCH"],
  ]) await check("native stderr rejects "+name,()=>rejects(()=>refusal.assertAgentNativeRefusalEvidence(collectRefusal(text)),code));
  for(const [name,text,options,code] of [
    ["truncated patch",nativeLine.replace("*** End Patch\n",""),{},"NATIVE_REFUSAL_RECORD_INCOMPLETE"],
    ["impossible timestamp",nativeLine.replace("2026-01-01","2026-02-30"),{},"NATIVE_REFUSAL_TIMESTAMP_INVALID"],
    ["incomplete UTF8",Buffer.from([0xc3]),{},"NATIVE_REFUSAL_UTF8_INVALID"],
    ["total byte overflow",nativeLine,{maxBytes:64,maxRecordBytes:64},"NATIVE_REFUSAL_BUFFER_LIMIT"],
    ["record byte overflow",nativeLine,{maxRecordBytes:64},"NATIVE_REFUSAL_RECORD_LIMIT"],
    ["record count overflow",nativeLine+nativeLine,{maxRecords:1},"NATIVE_REFUSAL_COUNT_LIMIT"],
  ]) await check("native stderr bounds "+name,()=>rejects(()=>collectRefusal(text,4096,options),code));
  for(const [name,input,expected] of [
    ["nothing launched",{launchRequests:0,processesStarted:0,checks:[],failedCase:{native_process_cleanup:"NOT_STARTED"}},"NOT_STARTED"],
    ["three stopped workers before a non-started port",{launchRequests:3,processesStarted:3,checks:Array.from({length:3},()=>({native_process_cleanup:"CONFIRMED"})),failedCase:{native_process_cleanup:"NOT_STARTED"}},"CONFIRMED"],
    ["failure after every worker stopped",{launchRequests:1,processesStarted:1,checks:[{native_process_cleanup:"CONFIRMED"}]},"CONFIRMED"],
    ["attempted creation without a process",{launchRequests:1,processesStarted:0,checks:[],failedCase:{native_process_cleanup:"NOT_STARTED"}},"NOT_STARTED"],
    ["suspended process stopped before resume",{launchRequests:1,processesStarted:0,checks:[],failedCase:{native_process_cleanup:"CONFIRMED"}},"CONFIRMED"],
    ["unknown tree after confirmed worker",{launchRequests:2,processesStarted:2,checks:[{native_process_cleanup:"CONFIRMED"}],failedCase:{native_process_cleanup:"UNCONFIRMED"}},"UNCONFIRMED"],
    ["missing worker observation",{launchRequests:2,processesStarted:2,checks:[{native_process_cleanup:"CONFIRMED"}]},"UNCONFIRMED"],
    ["started process called non-started",{launchRequests:1,processesStarted:1,checks:[],failedCase:{native_process_cleanup:"NOT_STARTED"}},"UNCONFIRMED"],
    ["contradictory counters",{launchRequests:0,processesStarted:1,checks:[]},"UNCONFIRMED"],
  ]) await check("native cleanup aggregate preserves "+name,()=>{
    const before=JSON.stringify(input);assert.equal(qualification.summarizeNativeProcessCleanup(input),expected);assert.equal(JSON.stringify(input),before);
  });
  await check("all pure fixture inputs are unchanged", () => assert.equal(JSON.stringify({ manifest, trust, installation, baseline, markers }), unchangedInputs));
  await check("imports and rejected requests leave no observed effect", () => assert.deepEqual(effects, []));
  process.stdout.write(JSON.stringify({ status: "PASS", checks, effects, native_codex: "NOT_RUN", postgres: "NOT_RUN", cleanup: "NO_RESOURCES_CREATED" }) + "\n");
} finally {
  for (const undo of restore.reverse()) undo();
  syncBuiltinESMExports();
}
