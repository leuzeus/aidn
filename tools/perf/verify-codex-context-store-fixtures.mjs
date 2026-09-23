#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { persistHookContext, readHookContext, DEFAULT_CONTEXT_FILE } from "../../src/adapters/codex/context-store.mjs";
import { captureContextIdentity } from "../../src/adapters/codex/context-provenance.mjs";
import { evaluateContextObservation } from "../../src/application/codex/context-observation.mjs";
import { createHookContextStoreAdapter } from "../../src/adapters/codex/hook-context-store-adapter.mjs";
import { createCodexAgentAdapter } from "../../src/adapters/codex/codex-agent-adapter.mjs";
import { runJsonHookUseCase } from "../../src/application/codex/run-json-hook-use-case.mjs";
import { deriveRuntimeStateRepairSummary } from "../../src/application/runtime/runtime-state-projector-use-case.mjs";
import { initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

const assertions = [];
const children = [];
const started = performance.now();
function check(name, condition) {
  assertions.push({ name, pass: Boolean(condition) });
  if (!condition) throw new Error(name);
}
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function expectCode(name, action, code) {
  let observed = null;
  try { action(); } catch (error) { observed = error.code; }
  check(name, observed === code);
}
function makeEntry(identity) {
  return {
    ok: true, command_status: 0, reusable: true, repair_layer_status: "clean",
    provenance: {
      kind: "hook-command-observation.v1", authority: "diagnostic-only-not-validation-or-admission",
      command: process.execPath, argv: ["-e", "process.stdout.write('{}')"],
      command_status: 0, command_signal: null, command_error: false,
      before: identity, after: identity,
    },
  };
}
async function concurrentWrites(root) {
  const moduleUrl = pathToFileURL(path.resolve("src/adapters/codex/context-store.mjs")).href;
  const contextFile = path.join(root, DEFAULT_CONTEXT_FILE);
  const executions = 8;
  const perChild = 8;
  let invalidReads = 0;
  let validReads = 0;
  const monitor = setInterval(() => {
    if (!fs.existsSync(contextFile)) return;
    try { JSON.parse(fs.readFileSync(contextFile, "utf8")); validReads += 1; } catch { invalidReads += 1; }
  }, 1);
  try {
    const outcomes = await Promise.all(Array.from({ length: executions }, (_, index) => new Promise((resolve) => {
      const script = `import {persistHookContext} from ${JSON.stringify(moduleUrl)}; for(let i=0;i<${perChild};i++)persistHookContext({targetRoot:${JSON.stringify(root)},skill:'concurrent',maxEntries:100,normalized:{ts:'2026-01-01T00:00:00Z',ok:true},rawPayload:{writer:${index},i},sourceMeta:{execution_id:'writer-${index}-'+i,command_status:0}});`;
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-1500); });
      const timer = setTimeout(() => child.kill(), 30000);
      child.on("error", (error) => { clearTimeout(timer); resolve({ status: null, error: error.code }); });
      child.on("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, stderr }); });
    })));
    children.push(...outcomes);
    check("all eight competing writers exit successfully", outcomes.every((item) => item.status === 0 && !item.signal));
  } finally { clearInterval(monitor); }
  const store = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  check("concurrent readers see complete JSON only", validReads > 0 && invalidReads === 0);
  check("all 64 concurrent observations survive", store.history.length === executions * perChild);
  check("same-timestamp raw IDs remain unique", new Set(store.history.map((entry) => entry.id)).size === 64);
  check("all raw payloads survive independently", store.history.every((entry) => fs.existsSync(entry.raw_file))
    && new Set(store.history.map((entry) => fs.readFileSync(entry.raw_file, "utf8"))).size === 64);
  const latest = store.latest.concurrent;
  check("latest points to retained history", store.history.some((entry) => entry.id === latest.id));
}
async function verify(tempRoot) {
  const concurrentRoot = path.join(tempRoot, "concurrent");
  fs.mkdirSync(concurrentRoot);
  await concurrentWrites(concurrentRoot);
  const root = path.join(tempRoot, "repo");
  const rules = path.join(tempRoot, "package");
  write(path.join(root, "input.txt"), "initial\n");
  write(path.join(root, ".gitignore"), ".aidn/runtime/\n");
  write(path.join(rules, "package.json"), '{"name":"fixture","version":"1.0.0"}');
  write(path.join(rules, "src", "rule.mjs"), "export const rule = 1;\n");
  initGitRepo(root, { sourceBranch: "main" });
  const capture = (stateMode = "files") => captureContextIdentity({ targetRoot: root, stateMode, packageRoot: rules });
  const current = capture();
  check("capture binds Git branch HEAD worktree content and package rules", current.status === "captured"
    && current.branch === "main" && current.head_commit.length === 40 && current.worktree_id && current.rules_sha256.length === 64);
  const entry = makeEntry(current);
  check("unchanged successful files observation is reusable diagnostic data", evaluateContextObservation(entry, capture()).reusable);
  check("stored reusable flag alone is insufficient", !evaluateContextObservation({ ok: true, reusable: true }, current).reusable);
  check("direct projector calls require live context", deriveRuntimeStateRepairSummary({ requested_skill: "probe", decisions: { probe: entry } }, null).status === "unknown");
  check("projector accepts a current successful observation", deriveRuntimeStateRepairSummary({ requested_skill: "probe", decisions: { probe: entry } }, null, current).status === "clean");
  check("unsuccessful exit cannot be upgraded by model ok", !evaluateContextObservation({ ...entry, provenance: { ...entry.provenance, command_status: 1 } }, current).reusable);
  check("signal cannot be upgraded by model ok", !evaluateContextObservation({ ...entry, provenance: { ...entry.provenance, command_signal: "SIGTERM" } }, current).reusable);
  check("unavailable live context fails closed", !evaluateContextObservation(entry, { status: "unavailable" }).reusable);
  for (const mode of ["dual", "db-only"]) {
    const dbContext = capture(mode);
    const result = evaluateContextObservation(makeEntry(dbContext), dbContext);
    check(`${mode} without canonical database revision is explicitly non-reusable`, !result.reusable && result.reuse_reasons.includes("canonical_runtime_revision_unavailable"));
  }
  write(path.join(root, "input.txt"), "changed\n");
  const dirty = capture();
  check("tracked content changes invalidate reuse", !evaluateContextObservation(entry, dirty).reusable);
  check("changes during command invalidate reuse", evaluateContextObservation({ ...entry, provenance: { ...entry.provenance, after: dirty } }, dirty).reuse_reasons.includes("context_changed_during_command"));
  check("stale clean history cannot relax repair warning", deriveRuntimeStateRepairSummary({ requested_skill: "probe", decisions: { probe: entry }, repair_layer: { status: "warn" } }, null, dirty).status === "warn");
  const blocking = { ...entry, repair_layer_status: "block", repair_layer_blocking: true };
  check("stale blocking history is not reported as a current block", deriveRuntimeStateRepairSummary({ requested_skill: "probe", decisions: { probe: blocking } }, null, dirty).status === "unknown");
  git(root, "add", "input.txt");
  check("index state changes invalidate dirty observations", capture().fingerprint !== dirty.fingerprint);
  git(root, "reset", "--hard", "HEAD");
  check("identical restored content can reuse bounded observation", evaluateContextObservation(entry, capture()).reusable);
  write(path.join(root, "new.txt"), "AAAA");
  const untracked = capture();
  write(path.join(root, "new.txt"), "BBBB");
  check("same-size untracked content changes invalidate", capture().fingerprint !== untracked.fingerprint);
  fs.unlinkSync(path.join(root, "new.txt"));
  git(root, "checkout", "-b", "alternate");
  check("branch change at identical HEAD invalidates", !evaluateContextObservation(entry, capture()).reusable);
  git(root, "checkout", "main");
  git(root, "commit", "--allow-empty", "-m", "new head");
  check("HEAD change at identical content invalidates", !evaluateContextObservation(entry, capture()).reusable);
  const other = path.join(tempRoot, "other-worktree");
  git(root, "worktree", "add", "--detach", other, "HEAD");
  const otherContext = captureContextIdentity({ targetRoot: other, packageRoot: rules });
  check("another worktree cannot reuse the observation", !evaluateContextObservation(makeEntry(capture()), otherContext).reusable);
  const beforeRule = capture();
  write(path.join(rules, "src", "rule.mjs"), "export const rule = 2;\n");
  check("package rules change invalidates reuse", !evaluateContextObservation(makeEntry(beforeRule), capture()).reusable);
  const beforeConfig = capture();
  write(path.join(root, ".aidn", "config.json"), '{"fixture_revision":2}');
  check("project configuration change invalidates reuse", !evaluateContextObservation(makeEntry(beforeConfig), capture()).reusable);

  const options = { targetRoot: root, skill: "probe", normalized: { ok: true }, rawPayload: { value: 1 }, sourceMeta: { execution_id: "same-execution", command_status: 0 } };
  const first = persistHookContext(options);
  const storeBefore = fs.readFileSync(first.context_file, "utf8");
  const second = persistHookContext(options);
  check("identical retained execution writes are idempotent", second.deduplicated === true && second.raw_file === first.raw_file && fs.readFileSync(first.context_file, "utf8") === storeBefore);
  expectCode("conflicting duplicate identity is rejected", () => persistHookContext({ ...options, rawPayload: { value: 2 } }), "CODEX_CONTEXT_EXECUTION_CONFLICT");
  check("duplicate conflict preserves existing data", fs.readFileSync(first.context_file, "utf8") === storeBefore);
  write(`${first.context_file}.lock`, "interrupted-owner");
  expectCode("lock timeout never steals an interrupted writer lock", () => persistHookContext({ ...options, lockTimeoutMs: 10 }), "CODEX_CONTEXT_LOCK_TIMEOUT");
  check("lock timeout preserves lock and store", fs.readFileSync(`${first.context_file}.lock`, "utf8") === "interrupted-owner" && fs.readFileSync(first.context_file, "utf8") === storeBefore);
  fs.unlinkSync(`${first.context_file}.lock`);
  write(first.context_file, "{truncated");
  expectCode("malformed store read is visible failure", () => readHookContext({ targetRoot: root, packageRoot: rules }), "CODEX_CONTEXT_INVALID");
  expectCode("malformed store write preserves evidence", () => persistHookContext(options), "CODEX_CONTEXT_INVALID");
  check("malformed bytes remain intact", fs.readFileSync(first.context_file, "utf8") === "{truncated");
  write(first.context_file, storeBefore);
  expectCode("cross-target context file is refused", () => readHookContext({ targetRoot: other, contextFile: first.context_file, packageRoot: rules }), "CODEX_CONTEXT_SCOPE_MISMATCH");
  const hookContextStore = createHookContextStoreAdapter({ packageRoot: rules });
  const agentAdapter = createCodexAgentAdapter();
  const args = {
    skill: "probe", target: root, stateMode: "files", mode: "", command: [process.execPath, "-e", "process.stdout.write(JSON.stringify({ok:true,repair_layer_status:'clean'}))"],
    forceJson: false, strict: false, dbSyncExplicit: true, dbSync: false, maxEntries: 50,
  };
  const output = await runJsonHookUseCase({ args, targetRoot: root, hookContextStore, agentAdapter });
  check("real command captures status command and content provenance", output.provenance.command_status === 0 && output.provenance.command === process.execPath && output.provenance.before.status === "captured");
  const read = hookContextStore.readContext({ targetRoot: root });
  check("new successful hook observation is reusable on fresh read", read.store.latest.probe.reusable === true);
  const onDisk = JSON.parse(fs.readFileSync(first.context_file, "utf8"));
  onDisk.latest.probe.reusable = true;
  write(first.context_file, JSON.stringify(onDisk));
  write(path.join(root, "input.txt"), "later\n");
  const stale = hookContextStore.readContext({ targetRoot: root }).store.latest.probe;
  check("historical ok is retained but forged reusable flag is ignored", stale.ok === true && stale.reusable === false && stale.reuse_status === "stale");
  const failure = await runJsonHookUseCase({ args: { ...args, command: [process.execPath, "-e", "process.stdout.write('{\"ok\":true}');process.exitCode=3"] }, targetRoot: root, hookContextStore, agentAdapter });
  check("actual nonzero command cannot create reusable success", failure.provenance.command_status === 3 && hookContextStore.readContext({ targetRoot: root }).store.latest.probe.reusable === false);
}
let tempRoot = "";
let failure = null;
let cleanup = null;
try {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-codex-context-store-"));
  await verify(tempRoot);
} catch (error) {
  failure = { message: error.message, code: error.code ?? null };
} finally {
  if (tempRoot) {
    const resolved = path.resolve(tempRoot);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("aidn-codex-context-store-")) throw new Error("Unowned fixture cleanup target");
    const removed = removePathWithRetry(resolved);
    cleanup = { ok: removed.ok && !fs.existsSync(resolved), attempts: removed.attempts };
  }
}
const pass = !failure && cleanup?.ok === true;
console.log(JSON.stringify({ pass, status: pass ? "PASS" : "FAIL", duration_ms: Math.round(performance.now() - started), assertions, children, failure, cleanup }, null, 2));
if (!pass) process.exitCode = 1;
