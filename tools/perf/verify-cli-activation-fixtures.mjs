#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listDispatchableCommandDescriptors, getGroupCommandDescriptor } from "../../src/core/cli/command-registry.mjs";
import { resolveActivationTarget, readActivation, planAuthorization, applyAuthorization } from "../../src/application/install/project-activation-service.mjs";
import { resolveCliEffectClass } from "../../src/core/cli/effect-policy.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const started = Date.now(), repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-cli-activation-"));
const checks = [], hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const seal = (value) => ({ ...value, integrity_sha256: hash(stable(value)) });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_|^NODE_OPTIONS$/i.test(key)));
const put = (root, relative, value) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const directory = (name) => { const root = path.join(temp, name); fs.mkdirSync(root, { recursive: true }); return root; };
function git(root, args) {
  const result = spawnSync("git", ["-C", root, "-c", "user.name=aidn-fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "-c", `core.hooksPath=${path.join(temp, "no-hooks")}`, ...args], { env, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
}
function repository(name) {
  const root = directory(name); git(root, ["init", "--quiet", "--initial-branch=main"]);
  put(root, "fixture.txt", "neutral fixture\n"); git(root, ["add", "fixture.txt"]); git(root, ["commit", "--quiet", "-m", "fixture"]); return root;
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
// Neutral sealed receipts exercise the real activation reader, without installing
// the source repository or executing a runtime/backend implementation.
const packageRoot = directory("neutral-package");
put(packageRoot, "VERSION", "0.8.0\n"); put(packageRoot, "bin/aidn.mjs", "// neutral fixture, never executed\n");
const binding = { root: packageRoot, version: "0.8.0", entry: "bin/aidn.mjs", entry_sha256: hash(fs.readFileSync(path.join(packageRoot, "bin/aidn.mjs"))), version_sha256: hash(fs.readFileSync(path.join(packageRoot, "VERSION"))) };
function installReceipt(root, migrated = false) {
  const identity = resolveActivationTarget({ targetRoot: root }), assets = {};
  for (const relative of [".codex/hooks/aidn-hook-runtime.mjs", ".codex/hooks/aidn-session-start.mjs", ".codex/hooks/aidn-pre-tool-use.mjs", ".agents/skills/aidn-context-reload/SKILL.md", ".agents/skills/aidn-start-session/SKILL.md"]) {
    const text = `Neutral fixture ${relative}\n`; put(root, relative, text); assets[relative] = { kind: "file", current: Buffer.from(text).toString("base64") };
  }
  const block = "<!-- CODEX-AUDIT-WORKFLOW START -->\nNeutral fixture\n<!-- CODEX-AUDIT-WORKFLOW END -->";
  put(root, "AGENTS.md", `Client text\n${block}\n`); assets["AGENTS.md"] = { kind: "agents-block", current: block };
  const owned = ["SessionStart", "PreToolUse"].map((event) => ({ event, group: { matcher: "fixture" }, hook: { type: "command", command: `echo fixture-${event}` } }));
  put(root, ".codex/hooks.json", JSON.stringify({ hooks: Object.fromEntries(owned.map((token) => [token.event, [{ ...token.group, hooks: [token.hook] }]])) }));
  assets[".codex/hooks.json"] = { kind: "hooks", current: owned };
  const id = crypto.randomBytes(16).toString("hex");
  const receipt = { schema_version: 1, scope: "codex-integration", root_id: identity.root_id, package: binding, assets, last_transaction: id, last_action: "install", ...(migrated ? { activation: { mode: identity.scope, authority_id: identity.authority_id } } : {}) };
  put(root, `.aidn/install/transactions/${id}.json`, JSON.stringify(seal({ schema_version: 1, id, scope: "codex-integration", root_id: identity.root_id, status: "complete", operations: [], receipt_after: receipt })));
  put(root, ".aidn/install/receipt.json", JSON.stringify(seal(receipt)));
  return receipt;
}
const implementations = listDispatchableCommandDescriptors().filter((item) => item.dispatch_kind === "script").map((item) => pathToFileURL(path.join(repoRoot, item.implementation)).href);
// A reached tool is stopped before its own imports execute. The sentinel proves
// dispatch, and prevents these tests from connecting to any real backend.
put(temp, "block-tools.mjs", `const blocked = new Set(${JSON.stringify(implementations)});\nexport async function resolve(specifier, context, next) { const result = await next(specifier, context); if (blocked.has(result.url)) throw new Error("FIXTURE_TOOL_REACHED"); return result; }\n`);
put(temp, "preload.mjs", `import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(path.join(temp, "block-tools.mjs")).href)}, import.meta.url);\n`);
function invoke(cwd, args, { intercept = true } = {}) {
  const before = snapshot(temp);
  const result = spawnSync(process.execPath, [path.join(repoRoot, "bin/aidn.mjs"), ...args], { cwd, env: { ...env, ...(intercept ? { NODE_OPTIONS: `--import=${pathToFileURL(path.join(temp, "preload.mjs")).href}` } : {}) }, encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(result.error, undefined); assert.deepEqual(snapshot(temp), before, "CLI invocation must not write fixture trees"); return result;
}
function refusal(cwd, args, state) {
  const result = invoke(cwd, args);
  assert.equal(result.status, 2, `Expected activation refusal before tool load: ${result.stderr.slice(0, 900)}`);
  assert(!result.stderr.includes("FIXTURE_TOOL_REACHED"));
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, "AIDN_ACTIVATION_REQUIRED"); assert.equal(payload.refused, true); assert.equal(payload.written, false);
  assert.equal(payload.ok, false); assert.equal(payload.activation.active, false);
  if (state) assert.equal(payload.activation.state, state);
  return payload;
}
function dispatched(cwd, args) { const result = invoke(cwd, args); assert.equal(result.status, 1); assert.match(result.stderr, /FIXTURE_TOOL_REACHED/); assert(!result.stdout.includes("AIDN_ACTIVATION_REQUIRED")); }
function check(name, action) { action(); checks.push({ name, status: "PASS" }); }
let failure = null, cleanup = false;
try {
  const absent = directory("non-git");
  check("inactive non-Git client is refused before runtime import", () => { refusal(absent, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "absent"); });
  const { classifyCliActivation, commandMayRefuseActivation } = await import("../../src/core/cli/activation-policy.mjs");
  check("public workflow defaults closed while source and explicit maintenance remain reachable", () => {
    for (const name of ["artifact-fetch", "project-runtime-state", "coordinator-dispatch-execute", "sync-db-first"]) assert.equal(classifyCliActivation(getGroupCommandDescriptor("runtime", name)).requires_activation, true, name);
    assert.equal(classifyCliActivation({ visibility: "public", group: "future", name: "new-workflow" }).requires_activation, true);
    for (const descriptor of listDispatchableCommandDescriptors()) {
      if (descriptor.dispatch_kind === "builtin" || (descriptor.group === "perf" && descriptor.name.startsWith("verify-")) || descriptor.name === "normalize-hook-payload") assert.equal(commandMayRefuseActivation(descriptor), false, descriptor.command);
      else if (descriptor.visibility === "internal") assert.equal(commandMayRefuseActivation(descriptor), true, descriptor.command);
    }
    for (const name of ["db-status", "persistence-adopt", "persistence-backup", "state-reanchor"]) dispatched(absent, ["runtime", name, "--json"]);
    for (const args of [["install", "--dry-run"], ["bootstrap", "--diagnose", "--json"], ["project", "config", "--list", "--json"]]) dispatched(absent, args);
    assert.equal(classifyCliActivation(getGroupCommandDescriptor("runtime", "pre-write-admit")).category, "self-guarded");
  });
  check("internal workflow aliases refuse before imports; verification and normalization stay available", () => {
    for (const name of ["skill-hook", "session-start", "session-close", "hook", "reload-check", "gate", "checkpoint", "index", "reset", "collect", "constraint-report"]) {
      const payload = refusal(absent, ["perf", name, "--json"], "absent");
      assert.equal(payload.effect_class, name === "constraint-report" ? "projector" : "mutating");
    }
    const payload = refusal(absent, ["codex", "run-json-hook", "--skill", "context-reload", "--json"], "absent");
    assert.equal(payload.effect_class, "mutating");
    dispatched(absent, ["perf", "verify-index-sync"]); dispatched(absent, ["codex", "normalize-hook-payload", "--json"]);
  });
  check("daemon only exempts one explicit maintenance action", () => {
    const descriptor = getGroupCommandDescriptor("runtime", "local-daemon");
    for (const action of ["--status", "--stop"]) dispatched(absent, ["runtime", "local-daemon", action, "--json"]);
    for (const args of [[], ["--start"], ["--serve"], ["--start", "--status"], ["--stop", "--status"]]) {
      assert.equal(classifyCliActivation(descriptor, args).requires_activation, true); refusal(absent, ["runtime", "local-daemon", ...args, "--json"]);
    }
  });
  const root = repository("repository"); installReceipt(root);
  check("legacy activation dispatches only the installed repository and subdirectory", () => {
    assert.equal(readActivation({ targetRoot: root }).state, "legacy-active");
    dispatched(root, ["runtime", "artifact-fetch", "--path", "fixture", "--json"]);
    const nested = path.join(root, "src"); fs.mkdirSync(nested);
    dispatched(nested, ["runtime", "artifact-fetch", "--target", root, "--path", "fixture", "--json"]);
    dispatched(nested, ["runtime", "artifact-fetch", "--path", "fixture", "--json"]);
    refusal(absent, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "absent");
  });
  check("nested Git repo and adjacent repo never inherit outer activation", () => {
    const nested = repository("repository/inner"), adjacent = repository("adjacent");
    refusal(nested, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "absent");
    refusal(adjacent, ["codex", "hydrate-context", "--json"], "absent");
  });
  const sibling = path.join(temp, "worktree"); git(root, ["worktree", "add", "--quiet", "-b", "fixture-worktree", sibling]);
  check("repository authorization still requires preparation of each worktree", () => {
    refusal(sibling, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "absent");
    applyAuthorization(planAuthorization({ targetRoot: root, action: "authorize" }));
    installReceipt(root, true);
    refusal(sibling, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "unprepared");
    put(sibling, ".aidn/install/receipt.json", fs.readFileSync(path.join(root, ".aidn/install/receipt.json")));
    refusal(sibling, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "degraded");
    installReceipt(sibling, true); dispatched(sibling, ["codex", "workflow-step", "--json"]);
  });
  check("explicit target uses last target and preserves logical refused effect", () => {
    dispatched(absent, ["runtime", "artifact-fetch", "--target", absent, "--target", root, "--path", "fixture", "--json"]);
    const args = ["--target", root, "--target", absent, "--write", "--json"];
    const payload = refusal(root, ["runtime", "sync-db-first", ...args], "absent");
    assert.equal(payload.effect_class, resolveCliEffectClass("aidn runtime sync-db-first", args));
    assert.equal(payload.target_root, absent);
  });
  check("subprocess target and help do not authorize an inactive wrapper", () => {
    refusal(absent, ["codex", "run-json-hook", "--skill", "context-reload", "--", "node", "unexecuted.mjs", "--target", root, "--help"], "absent");
    dispatched(root, ["codex", "run-json-hook", "--skill", "context-reload", "--target", root, "--", "node", "unexecuted.mjs", "--target", absent]);
  });
  check("repository revocation refuses every prepared worktree without backend import", () => {
    applyAuthorization(planAuthorization({ targetRoot: sibling, action: "revoke" }));
    for (const target of [root, sibling]) refusal(target, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "revoked");
  });
  check("non-Git authorization stays local and pending receipt cannot activate", () => {
    installReceipt(absent, true); applyAuthorization(planAuthorization({ targetRoot: absent, action: "authorize" }));
    dispatched(absent, ["runtime", "artifact-fetch", "--path", "fixture", "--json"]);
    const subdirectory = path.join(absent, "child"); fs.mkdirSync(subdirectory);
    refusal(subdirectory, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "absent");
    put(absent, ".aidn/install/pending.json", "{}\n"); refusal(absent, ["runtime", "artifact-fetch", "--path", "fixture", "--json"], "degraded");
  });
  check("help and version remain available without activation or mutation", () => {
    for (const args of [["--version"], ["--help"], ["runtime", "artifact-fetch", "--write", "--help"], ["runtime", "artifact-fetch", "--target", "--help"]]) {
      const result = invoke(root, args, { intercept: false }); assert.equal(result.status, 0, result.stderr); assert(!result.stdout.includes("AIDN_ACTIVATION_REQUIRED"));
    }
    const bootstrap = invoke(root, ["bootstrap", "--target", "-h", "--json"], { intercept: false });
    assert.notEqual(bootstrap.status, 0); assert.equal(JSON.parse(bootstrap.stdout).ok, false, "installation argument errors keep their original JSON contract");
  });
} catch (error) { failure = { message: error.message, stack: error.stack }; }
finally {
  const resolved = path.resolve(temp), prefix = `${path.resolve(os.tmpdir())}${path.sep}`;
  assert(resolved.startsWith(prefix) && path.basename(resolved).startsWith("aidn-cli-activation-"));
  removePathWithRetry(resolved); cleanup = !fs.existsSync(resolved);
}
console.log(JSON.stringify({ ok: !failure, checks, failure, elapsed_ms: Date.now() - started, cleanup }, null, 2));
process.exitCode = failure ? 1 : 0;
