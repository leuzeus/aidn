#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess, { spawn } from "node:child_process";
import { EventEmitter, getEventListeners } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { buildAgentProcessHelper } from "../verify/build-agent-process-helper.mjs";
import { createWindowsProcessTreeController } from "../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs";

// Exercise the actual controller with restored built-in doubles: no process,
// filesystem mutation, helper build or platform prerequisite is involved.
export async function verifyPortableProcessTreeFixtures() {
  const checks = [], check = async (name, action) => { await action(); checks.push({ name, status: "PASS" }); };
  const original = { spawn: childProcess.spawn, lstat: fs.lstatSync, read: fs.readFileSync,
    realpath: fs.realpathSync.native, platform: Object.getOwnPropertyDescriptor(process, "platform"), arch: Object.getOwnPropertyDescriptor(process, "arch") };
  const cwd = path.resolve(os.tmpdir(), "aidn-process-tree-portable"), bytes = Buffer.from("portable helper bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex"), events = [], commands = [];
  let launched = 0, mode = "complete", onRead = null, onSpawn = null, onStop = null;
  try {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    Object.defineProperty(process, "arch", { value: "x64", configurable: true });
    fs.lstatSync = file => ({ isSymbolicLink: () => false, isDirectory: () => file === cwd, isFile: () => file !== cwd, nlink: 1 });
    fs.realpathSync.native = file => path.resolve(file);
    fs.readFileSync = () => { onRead?.(); return bytes; };
    childProcess.spawn = () => {
      launched++; onSpawn?.();
      const child = new EventEmitter(); child.pid = 1234; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = new EventEmitter(); child.stdin.writable = true; child.stdin.destroyed = false;
      let payload, sequence = 0, resumed = false, terminal = false;
      const runner = { pid: 5678, started_at: "2026-01-01T00:00:00.000Z", job_name: `Local\\aidn-execution-${"a".repeat(32)}` };
      const frame = value => child.stdout.emit("data", Buffer.from(JSON.stringify({ protocol: "aidn-process-tree.v1", runner_id: payload.runner_id, sequence: ++sequence, ...value }) + "\n"));
      const finish = () => { if (terminal) return; terminal = true;
        frame({ type: "terminal", outcome: resumed ? "completed" : "cancelled", reason_code: resumed ? "PROCESS_COMPLETED" : "PROCESS_CANCELLED",
          termination_state: "confirmed", exit_code: resumed ? 0 : 1, observed_at: "2026-01-01T00:00:01.000Z", resumed, active_processes: 0, ...runner });
        child.emit("close", 0, null);
      };
      child.kill = () => { if (!terminal) { terminal = true; child.emit("close", null, "SIGTERM"); } };
      child.stdin.write = (text, callback) => {
        const message = JSON.parse(text); commands.push(message.action ?? "payload"); callback?.();
        if (!message.action) { payload = message; queueMicrotask(() => frame({ type: "prepared", suspended: true, job_assigned: true, ...runner })); }
        else if (message.action === "resume") { resumed = true; queueMicrotask(() => {
          frame({ type: "resumed", ...runner });
          if (mode === "stdout-close") frame({ type: "stdout", data: Buffer.from("fixture").toString("base64") });
          if (!["hold", "unconfirmed"].includes(mode)) finish();
        }); }
        else if (message.action === "stop") { const stopped = onStop; onStop = null; stopped?.(); queueMicrotask(mode === "unconfirmed" ? () => child.kill() : finish); }
        return true;
      };
      return child;
    };
    syncBuiltinESMExports();
    const controller = createWindowsProcessTreeController({ helperPath: path.join(cwd, "helper.exe"), helperSha256: sha256,
      helperSourceSha256: sha256, candidateSha256: sha256 });
    const request = changes => ({ runnerId: "fixture.portable", executable: path.join(cwd, "node.exe"), executableSha256: sha256,
      args: [], cwd, env: {}, stdin: "", maxDurationMs: 1000, stopTimeoutMs: 10, ...changes });
    const clean = (...signals) => { for (const signal of signals) assert.equal(getEventListeners(signal, "abort").length, 0); };
    const preflight = async (options, outcome, reason) => { const before = launched;
      const result = await controller.run(request(), options); assert.equal(launched, before);
      assert.equal(result.outcome, outcome); assert.equal(result.reason_code, reason); assert.equal(result.termination_state, "not_started"); };
    await check("portable absent timeoutSignal preserves ordinary completion", async () => {
      const result = await controller.run(request()); assert.equal(result.outcome, "completed"); assert.equal(result.termination_state, "confirmed");
    });
    await check("portable invalid timeoutSignal is rejected without spawn", async () => {
      for (const timeoutSignal of [null, {}, { aborted: true }, "timeout"]) await preflight({ timeoutSignal }, "failed", "PROCESS_REQUEST_INVALID");
    });
    await check("portable pre-timeout and pre-cancel preserve distinct outcomes without spawn", async () => {
      const timeout = AbortSignal.abort(), cancel = AbortSignal.abort();
      await preflight({ timeoutSignal: timeout }, "timed_out", "PROCESS_TIMEOUT_BEFORE_START");
      await preflight({ signal: cancel, timeoutSignal: timeout }, "cancelled", "PROCESS_CANCELLED_BEFORE_START"); clean(timeout, cancel);
    });
    await check("portable timeout during availability never creates helper", async () => {
      const timeout = new AbortController(); onRead = () => timeout.abort();
      try { await preflight({ timeoutSignal: timeout.signal }, "timed_out", "PROCESS_TIMEOUT_BEFORE_START"); }
      finally { onRead = null; } clean(timeout.signal);
    });
    await check("portable pre-spawn cancellation wins both signals during availability", async () => {
      const cancel = new AbortController(), timeout = new AbortController(); onRead = () => { timeout.abort(); cancel.abort(); };
      try { await preflight({ signal: cancel.signal, timeoutSignal: timeout.signal }, "cancelled", "PROCESS_CANCELLED_BEFORE_START"); }
      finally { onRead = null; } clean(cancel.signal, timeout.signal);
    });
    await check("portable timeout between spawn and listener installation is observed", async () => {
      const timeout = new AbortController(); onSpawn = () => timeout.abort();
      let result; try { result = await controller.run(request(), { timeoutSignal: timeout.signal }); } finally { onSpawn = null; }
      assert.equal(result.outcome, "timed_out"); assert.equal(result.reason_code, "PROCESS_TIMEOUT"); assert.equal(result.termination_state, "confirmed"); clean(timeout.signal);
    });
    await check("portable timeout releases unsettled preparation and forbids late resume", async () => {
      const timeout = new AbortController(); let complete; events.length = 0; commands.length = 0;
      const result = await controller.run(request(), { timeoutSignal: timeout.signal, onEvent(event) {
        events.push(event.type); if (event.type === "prepared") { queueMicrotask(() => timeout.abort()); return new Promise(resolve => { complete = resolve; }); }
      } });
      assert.equal(result.outcome, "timed_out"); assert.equal(result.reason_code, "PROCESS_TIMEOUT"); assert.equal(result.termination_proof.active_processes, 0);
      assert.deepEqual(events, ["prepared"]); assert(!commands.includes("resume")); complete(); await delay(5);
      assert.deepEqual(events, ["prepared"]); assert(!commands.includes("resume")); clean(timeout.signal);
    });
    for (const first of ["cancel", "timeout"]) await check(`portable ${first} wins competing stop signals`, async () => {
      const cancel = new AbortController(), timeout = new AbortController(); mode = "hold";
      const result = await controller.run(request(), { signal: cancel.signal, timeoutSignal: timeout.signal, onEvent(event) {
        if (event.type === "resumed") { if (first === "cancel") { cancel.abort(); timeout.abort(); } else { timeout.abort(); cancel.abort(); } }
      } });
      assert.equal(result.outcome, first === "cancel" ? "cancelled" : "timed_out"); assert.equal(result.reason_code, first === "cancel" ? "PROCESS_CANCELLED" : "PROCESS_TIMEOUT");
      assert.equal(result.termination_proof.active_processes, 0); clean(cancel.signal, timeout.signal); mode = "complete";
    });
    await check("portable callback failure remains authoritative after timeoutSignal", async () => {
      const timeout = new AbortController(); onStop = () => timeout.abort(); commands.length = 0;
      const result = await controller.run(request(), { timeoutSignal: timeout.signal, onEvent() { throw new Error("fixture callback failure"); } });
      assert.equal(timeout.signal.aborted, true); assert.equal(result.outcome, "failed"); assert.equal(result.reason_code, "PROCESS_CALLBACK_FAILED");
      assert.equal(result.termination_state, "confirmed"); assert.equal(result.termination_proof.active_processes, 0);
      assert(!commands.includes("resume")); clean(timeout.signal);
    });
    await check("portable timeout cannot promote unknown termination", async () => {
      const timeout = new AbortController(); mode = "unconfirmed";
      const result = await controller.run(request(), { timeoutSignal: timeout.signal, onEvent(event) { if (event.type === "resumed") timeout.abort(); } });
      assert.equal(result.outcome, "indeterminate"); assert.equal(result.reason_code, "PROCESS_HELPER_TERMINATION_UNCONFIRMED");
      assert.equal(result.termination_state, "unknown"); assert.equal(result.termination_proof, null); clean(timeout.signal); mode = "complete";
    });
    await check("portable fixed deadline remains active without timeoutSignal firing", async () => {
      const timeout = new AbortController(), started = Date.now(); mode = "hold";
      const result = await controller.run(request({ maxDurationMs: 25 }), { timeoutSignal: timeout.signal });
      assert(Date.now() - started < 1000); assert.equal(result.outcome, "timed_out"); assert.equal(result.reason_code, "PROCESS_TIMEOUT");
      clean(timeout.signal); const previous = commands.length; timeout.abort(); await delay(5); assert.equal(commands.length, previous); mode = "complete";
    });
    await check("portable timeout releases stdout callback after helper close", async () => {
      const timeout = new AbortController(); mode = "stdout-close";
      const result = await controller.run(request(), { timeoutSignal: timeout.signal, onEvent(event) {
        if (event.type === "stdout") { queueMicrotask(() => timeout.abort()); return new Promise(() => {}); }
      } });
      assert.equal(result.outcome, "timed_out"); assert.equal(result.termination_state, "confirmed"); clean(timeout.signal); mode = "complete";
    });
    await check("portable completed run removes both listeners before late abort", async () => {
      const cancel = new AbortController(), timeout = new AbortController();
      const result = await controller.run(request(), { signal: cancel.signal, timeoutSignal: timeout.signal });
      assert.equal(result.outcome, "completed"); clean(cancel.signal, timeout.signal); const previous = commands.length;
      cancel.abort(); timeout.abort(); await delay(5); assert.equal(commands.length, previous);
    });
    return checks;
  } finally {
    childProcess.spawn = original.spawn; fs.lstatSync = original.lstat; fs.readFileSync = original.read; fs.realpathSync.native = original.realpath;
    Object.defineProperty(process, "platform", original.platform); Object.defineProperty(process, "arch", original.arch); syncBuiltinESMExports();
  }
}

const checks = [], digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const check = async (name, action) => { await action(); checks.push({ name, status: "PASS" }); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
async function assertGone(pids) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && pids.some(alive)) await delay(20);
  assert(pids.every((pid) => !alive(pid)), "owned fixture process must be absent");
}
async function main() {
const portable = process.argv.length === 3 && process.argv[2] === "--portable";
let root, marker, spectator, spectatorExit, manifest;
let cleanup = { root_removed: false, spectator_stopped: false };
try {
  if (portable) checks.push(...await verifyPortableProcessTreeFixtures());
  else {
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
  }
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
console.log(JSON.stringify({ status: process.exitCode ? "FAIL" : "PASS", proof_class: portable ? "portable-process-controller-doubles" : "native-process-windows",
  codex_executed: false, sandbox_containment_qualified: false,
  helper_sha256: manifest?.helper_sha256 ?? null, source_sha256: manifest?.source_sha256 ?? null,
  checks, cleanup }, null, 2));

}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
