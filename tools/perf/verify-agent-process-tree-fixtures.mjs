#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { buildAgentProcessHelper } from "../verify/build-agent-process-helper.mjs";
import { createWindowsProcessTreeController } from "../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs";

const checks = [], digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const check = async (name, action) => { await action(); checks.push({ name, status: "PASS" }); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
async function assertGone(pids) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && pids.some(alive)) await delay(20);
  assert(pids.every((pid) => !alive(pid)), "owned fixture process must be absent");
}
let root, marker, spectator, spectatorExit, manifest;
let cleanup = { root_removed: false, spectator_stopped: false };
try {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("PROCESS_TREE_NATIVE_PLATFORM_UNAVAILABLE");
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--helper-manifest" || !path.isAbsolute(args[1]))) throw new Error("PROCESS_TREE_FIXTURE_ARGUMENTS_INVALID");
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-process-tree-"));
  marker = randomUUID(); fs.writeFileSync(path.join(root, "owner.txt"), marker);
  const cwd = path.join(root, "worktree espace été"); fs.mkdirSync(cwd);
  // An explicit external manifest lets native Codex qualification reuse this
  // exact tested binary. Borrowed helpers remain untouched during cleanup.
  manifest = args.length ? JSON.parse(fs.readFileSync(args[1], "utf8"))
    : buildAgentProcessHelper({ outputDir: path.join(root, "helper") });
  assert.equal(manifest.contract_version, "agent-process-helper-build.v1");
  const binding = { helperPath: manifest.helper_path, helperSha256: manifest.helper_sha256,
    helperSourceSha256: manifest.source_sha256, candidateSha256: digest(path.resolve(import.meta.dirname, "../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs")) };
  const controller = createWindowsProcessTreeController(binding);
  const request = (script, changes = {}) => ({ runnerId: `fixture.${randomUUID()}`, executable: process.execPath,
    executableSha256: digest(process.execPath), args: ["-e", script], cwd,
    env: { SystemRoot: process.env.SystemRoot }, stdin: "", maxDurationMs: 10000, stopTimeoutMs: 3000, ...changes });
  await check("availability is read only and binds helper source and executable", async () => {
    const before = fs.readdirSync(cwd);
    assert.equal((await controller.checkAvailability({ cwd, executable: process.execPath, executableSha256: digest(process.execPath) })).available, true);
    assert.deepEqual(fs.readdirSync(cwd), before);
    assert.equal((await createWindowsProcessTreeController({ ...binding, helperSha256: "0".repeat(64) }).checkAvailability({ cwd })).available, false);
    assert.equal((await createWindowsProcessTreeController({ ...binding, helperSourceSha256: "0".repeat(64) }).checkAvailability({ cwd })).available, false);
    assert.equal((await controller.checkAvailability({ cwd, executable: process.execPath, executableSha256: "0".repeat(64) })).available, false);
  });
  await check("suspended preparation, exact cwd argv stdin and explicit environment", async () => {
    const output = [], events = []; const sentinel = path.join(cwd, "resumed.txt");
    const script = `const fs=require('node:fs');fs.writeFileSync('resumed.txt','yes');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>console.log(JSON.stringify({cwd:process.cwd(),input,args:process.argv.slice(1),secret:process.env.AIDN_PROCESS_FIXTURE_SECRET??null})));`;
    const prior = process.env.AIDN_PROCESS_FIXTURE_SECRET; process.env.AIDN_PROCESS_FIXTURE_SECRET = "must-not-inherit";
    let result;
    try { result = await controller.run(request(script, { stdin: "été\nsecond line", args: ["-e", script, "--", "space argument", 'quote"argument', "C:\\path ending\\"] }), {
      onEvent: async (event) => {
        events.push(event.type);
        if (event.type === "prepared") { await delay(80); assert.equal(fs.existsSync(sentinel), false); }
        if (event.type === "stdout") output.push(event.bytes);
      },
    }); } finally { if (prior === undefined) delete process.env.AIDN_PROCESS_FIXTURE_SECRET; else process.env.AIDN_PROCESS_FIXTURE_SECRET = prior; }
    assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.termination_state, "confirmed");
    assert.equal(result.termination_proof.active_processes, 0); assert.deepEqual(events.slice(0, 2), ["prepared", "resumed"]);
    assert.deepEqual(JSON.parse(Buffer.concat(output).toString()), { cwd, input: "été\nsecond line", args: ["space argument", 'quote"argument', "C:\\path ending\\"], secret: null });
    await assertGone([result.runner.pid]);
  });
  await check("prepared callback rejection never resumes and stops emissions", async () => {
    const events = []; const sentinel = path.join(cwd, "must-not-execute.txt");
    const result = await controller.run(request("require('node:fs').writeFileSync('must-not-execute.txt','bad')"), {
      onEvent: async (event) => { events.push(event.type); throw new Error("fixture rejection"); },
    });
    assert.equal(result.outcome, "failed"); assert.equal(result.reason_code, "PROCESS_CALLBACK_FAILED");
    assert.equal(result.termination_state, "confirmed", JSON.stringify(result)); assert.equal(fs.existsSync(sentinel), false);
    assert.deepEqual(events, ["prepared"]); await assertGone([result.runner.pid]);
  });
  spectator = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd, stdio: "ignore", windowsHide: true });
  spectatorExit = new Promise((resolve) => spectator.once("exit", resolve));
  await check("unsettled prepared callback is bounded and late completion never resumes", async () => {
    const events = []; let completeCallback;
    const sentinel = path.join(cwd, "late-resume-forbidden.txt"), started = Date.now();
    const result = await controller.run(request("require('node:fs').writeFileSync('late-resume-forbidden.txt','bad')", { maxDurationMs: 600 }), {
      onEvent(event) {
        events.push(event.type);
        if (event.type === "prepared") return new Promise((resolve) => { completeCallback = resolve; });
        assert.fail("suspended worker must not emit another callback");
      },
    });
    assert(Date.now() - started < 4500, "callback cannot extend the process deadline indefinitely");
    assert.equal(result.outcome, "timed_out", JSON.stringify(result)); assert.equal(result.termination_state, "confirmed");
    assert.equal(result.termination_proof.active_processes, 0); assert.equal(fs.existsSync(sentinel), false);
    assert.deepEqual(events, ["prepared"]); assert.equal(typeof completeCallback, "function");
    completeCallback(); await delay(80);
    assert.deepEqual(events, ["prepared"]); assert.equal(fs.existsSync(sentinel), false);
    assert(alive(spectator.pid), "unrelated process preserved"); await assertGone([result.runner.pid]);
  });
  await check("unsettled stdout callback cannot hide terminal proof after helper exits", async () => {
    const events = []; const started = Date.now();
    const result = await controller.run(request("process.stdout.write('bounded callback');", { maxDurationMs: 600 }), {
      onEvent(event) {
        events.push(event.type);
        if (event.type === "stdout") return new Promise(() => {});
      },
    });
    assert(Date.now() - started < 4500, "closed helper cannot disable the callback deadline");
    assert.equal(result.outcome, "timed_out", JSON.stringify(result)); assert.equal(result.termination_state, "confirmed");
    assert.equal(result.termination_proof.active_processes, 0); assert(events.includes("stdout"));
    const settledEvents = [...events]; await delay(80); assert.deepEqual(events, settledEvents);
    assert(alive(spectator.pid), "unrelated process preserved"); await assertGone([result.runner.pid]);
  });
  await check("abort releases an unsettled callback without waiting for task timeout", async () => {
    const abort = new AbortController(), events = [], started = Date.now();
    const result = await controller.run(request("setInterval(()=>{},1000)"), {
      signal: abort.signal,
      onEvent(event) {
        events.push(event.type);
        if (event.type === "prepared") { setTimeout(() => abort.abort(), 30); return new Promise(() => {}); }
      },
    });
    assert(Date.now() - started < 4500); assert.equal(result.outcome, "cancelled", JSON.stringify(result));
    assert.equal(result.termination_state, "confirmed"); assert.deepEqual(events, ["prepared"]);
    assert(alive(spectator.pid), "unrelated process preserved"); await assertGone([result.runner.pid]);
  });
  const treeScript = "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(JSON.stringify({parent:process.pid,child:c.pid}));setInterval(()=>{},1000);";
  async function treeCase(mode) {
    const abort = new AbortController(); let runner, observation, text = "";
    const result = await controller.run(request(treeScript, { maxDurationMs: mode === "timeout" ? 700 : 10000 }), {
      signal: abort.signal,
      onEvent: async (event) => {
        if (event.type === "prepared") runner = event;
        if (event.type === "stdout") {
          text += event.bytes.toString(); if (!text.includes("\n")) return;
          observation = JSON.parse(text.trim());
          if (mode === "cancel") abort.abort();
          if (mode === "helper-death") process.kill(runner.helper_pid);
        }
      },
    });
    assert(observation?.child > 0, "descendant must be observed before stop");
    await assertGone([observation.parent, observation.child]); assert(alive(spectator.pid), "unrelated process preserved");
    return result;
  }
  await check("cancellation kills descendants and preserves unrelated process", async () => {
    const result = await treeCase("cancel"); assert.equal(result.outcome, "cancelled", JSON.stringify(result));
    assert.equal(result.termination_state, "confirmed"); assert.equal(result.termination_proof.active_processes, 0);
  });
  await check("native timeout kills descendants with zero-active proof", async () => {
    const result = await treeCase("timeout"); assert.equal(result.outcome, "timed_out", JSON.stringify(result));
    assert.equal(result.termination_state, "confirmed");
  });
  await check("helper death closes job and remains indeterminate without terminal proof", async () => {
    const result = await treeCase("helper-death"); assert.equal(result.outcome, "indeterminate", JSON.stringify(result));
    assert.equal(result.termination_state, "unknown"); assert.equal(result.termination_proof, null);
  });
  await check("spawn failure cannot be mistaken for started process", async () => {
    const executable = path.join(root, "invalid.exe"); fs.writeFileSync(executable, "not a PE executable");
    const result = await controller.run(request("", { executable, executableSha256: digest(executable), args: [] }));
    assert.equal(result.outcome, "failed"); assert.equal(result.termination_state, "not_started"); assert.equal(result.runner, null);
    assert.equal(result.reason_code, "CREATE_PROCESS_FAILED");
  });
  await check("output flood is bounded and stops the job", async () => {
    let received = 0;
    const result = await controller.run(request("process.stdout.write('x'.repeat(1024*1024));setInterval(()=>{},1000)", { maxOutputBytes: 8192 }), {
      onEvent: async (event) => { if (event.type === "stdout") received += event.bytes.length; },
    });
    assert.equal(result.outcome, "failed", JSON.stringify(result)); assert.equal(result.reason_code, "OUTPUT_LIMIT");
    assert.equal(result.termination_state, "confirmed"); assert(received <= 8192); await assertGone([result.runner.pid]);
  });
  await check("slow callbacks cannot grow the event queue without bound", async () => {
    const result = await controller.run(request("process.stdout.write('x'.repeat(1024*1024));setInterval(()=>{},1000)", { maxPendingBytes: 8192 }), {
      onEvent: async (event) => { if (event.type === "stdout") await delay(40); },
    });
    assert.notEqual(result.outcome, "completed"); assert(result.bytes.stdout < 65536);
    if (result.runner) await assertGone([result.runner.pid]);
  });
  await check("pre-cancelled execution has no process or callback", async () => {
    const abort = new AbortController(); abort.abort();
    const result = await controller.run(request("throw 1"), { signal: abort.signal, onEvent: async () => assert.fail("no callback expected") });
    assert.equal(result.outcome, "cancelled"); assert.equal(result.termination_state, "not_started");
  });
} catch (error) {
  process.exitCode = 1; checks.push({ name: error.message, status: "FAIL", detail: error.stack?.split("\n").slice(0, 4).join("\n") });
} finally {
  if (spectator) { spectator.kill(); await spectatorExit; cleanup.spectator_stopped = !alive(spectator.pid); }
  else cleanup.spectator_stopped = true;
  if (root) {
    const resolved = path.resolve(root), temp = fs.realpathSync.native(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(), temp.toLowerCase());
    assert(path.basename(resolved).startsWith("aidn-process-tree-"));
    assert.equal(fs.readFileSync(path.join(root, "owner.txt"), "utf8"), marker);
    fs.rmSync(root, { recursive: true, force: false }); cleanup.root_removed = !fs.existsSync(root);
  }
}
console.log(JSON.stringify({ status: process.exitCode ? "FAIL" : "PASS", proof_class: "native-process-windows",
  codex_executed: false, sandbox_containment_qualified: false,
  helper_sha256: manifest?.helper_sha256 ?? null, source_sha256: manifest?.source_sha256 ?? null,
  checks, cleanup }, null, 2));
