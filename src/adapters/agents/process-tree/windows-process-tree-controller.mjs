import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const PROTOCOL = "aidn-process-tree.v1";
const SOURCE = path.join(import.meta.dirname, "windows-job-helper.cs");
const hashFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/u;
const failure = (reason, state = "not_started") => ({ outcome: state === "unknown" ? "indeterminate" : "failed",
  reason_code: reason, termination_state: state, exit_code: null, signal: null, runner: null,
  termination_proof: null, bytes: { stdout: 0, stderr: 0 } });
const positive = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
function absolutePhysical(file, directory) {
  if (!path.isAbsolute(file ?? "") || file.includes("\0")) return false;
  const info = fs.lstatSync(file);
  return !info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile() && info.nlink === 1)
    && fs.realpathSync.native(file).toLowerCase() === path.resolve(file).toLowerCase();
}

export function createWindowsProcessTreeController({ helperPath, helperSha256, helperSourceSha256, candidateSha256 } = {}) {
  const hashes = Object.freeze({ helper_sha256: helperSha256, source_sha256: helperSourceSha256, candidate_sha256: candidateSha256 });
  async function checkAvailability({ cwd, signal, executable, executableSha256 } = {}) {
    if (signal?.aborted) return { available: false, reason_code: "PROCESS_CHECK_CANCELLED" };
    if (process.platform !== "win32" || process.arch !== "x64") return { available: false, reason_code: "PROCESS_PLATFORM_UNQUALIFIED" };
    try {
      if (![helperSha256, helperSourceSha256, candidateSha256].every((value) => hashPattern.test(value ?? ""))
        || !absolutePhysical(helperPath, false) || !absolutePhysical(cwd, true)
        || hashFile(helperPath) !== helperSha256 || hashFile(SOURCE) !== helperSourceSha256) {
        return { available: false, reason_code: "PROCESS_HELPER_BINDING_INVALID" };
      }
      if (executable !== undefined && (!hashPattern.test(executableSha256 ?? "")
        || !absolutePhysical(executable, false) || hashFile(executable) !== executableSha256)) {
        return { available: false, reason_code: "PROCESS_EXECUTABLE_BINDING_INVALID" };
      }
      return { available: true, platform: "win32", method: "windows-job-object", ...hashes };
    } catch { return { available: false, reason_code: "PROCESS_HELPER_UNAVAILABLE" }; }
  }
  async function run(request, { signal, onEvent = async () => {} } = {}) {
    const { runnerId, executable, executableSha256, args, cwd, env, stdin, jobName,
      maxDurationMs, maxOutputBytes = 16 * 1024 * 1024, maxPendingBytes = 1024 * 1024,
      stopTimeoutMs = 5000 } = request ?? {};
    if (signal?.aborted) return { ...failure("PROCESS_CANCELLED_BEFORE_START"), outcome: "cancelled" };
    if (typeof onEvent !== "function" || signal !== undefined && !(signal instanceof AbortSignal)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(runnerId ?? "")
      || jobName !== undefined && !/^Local\\aidn-execution-[a-f0-9]{32}$/u.test(jobName)
      || !Array.isArray(args) || args.length > 256 || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))
      || !env || typeof env !== "object" || Array.isArray(env) || Object.keys(env).length > 512
      || Object.entries(env).some(([key, value]) => !key || /[=\0]/u.test(key) || typeof value !== "string" || value.includes("\0"))
      || new Set(Object.keys(env).map((key) => key.toLowerCase())).size !== Object.keys(env).length
      || !(typeof stdin === "string" || Buffer.isBuffer(stdin)) || Buffer.byteLength(stdin) > 262144
      || !positive(maxDurationMs, 86400000) || !positive(stopTimeoutMs, 30000)
      || !positive(maxOutputBytes, 1024 * 1024 * 1024) || !positive(maxPendingBytes, 16 * 1024 * 1024)) return failure("PROCESS_REQUEST_INVALID");
    const payload = JSON.stringify({ protocol: PROTOCOL, runner_id: runnerId, executable, executable_sha256: executableSha256,
      args, cwd, env, stdin_base64: Buffer.from(stdin).toString("base64"), max_duration_ms: maxDurationMs,
      max_output_bytes: maxOutputBytes, stop_timeout_ms: stopTimeoutMs, ...(jobName === undefined ? {} : { job_name: jobName }) });
    if (Buffer.byteLength(payload) > 1024 * 1024) return failure("PROCESS_REQUEST_INVALID");
    const availability = await checkAvailability({ cwd, signal, executable, executableSha256 });
    if (!availability.available) return failure(availability.reason_code);
    // The helper inherits only OS bootstrap variables; worker environment travels in the bounded private pipe.
    const helperEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP)$/iu.test(key)));
    let child;
    try { child = spawn(helperPath, [], { cwd, env: helperEnv, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { return failure("PROCESS_HELPER_SPAWN_FAILED"); }
    const bytes = { stdout: 0, stderr: 0 }, digests = { stdout: createHash("sha256"), stderr: createHash("sha256") };
    let terminal = null, runner = null, nextSequence = 1, pending = 0, buffer = Buffer.alloc(0), stopped = null;
    let callbacksFailed = false, protocolFailed = false, resumed = false, helperError = false, closed = false, stopTimer = null;
    let queue = Promise.resolve();
    let releaseCallbacks;
    const callbacksStopped = new Promise((resolve) => { releaseCallbacks = resolve; });
    const requestStop = (reason) => {
      if (stopped == null) stopped = reason;
      releaseCallbacks({ stopped: true });
      if (closed) return;
      if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write('{"action":"stop"}\n', () => {});
      if (!stopTimer) stopTimer = setTimeout(() => { if (!closed) child.kill(); }, stopTimeoutMs + 1000);
    };
    const invalid = () => { protocolFailed = true; requestStop("PROCESS_HELPER_PROTOCOL_INVALID"); };
    const handle = async (frame) => {
      if (frame.protocol !== PROTOCOL || frame.runner_id !== runnerId || frame.sequence !== nextSequence++ || terminal
        || !["prepared", "resumed", "stdout", "stderr", "terminal"].includes(frame.type)) { invalid(); return; }
      if (frame.type === "terminal") {
        if (!["completed", "failed", "cancelled", "timed_out", "indeterminate"].includes(frame.outcome)
          || !["confirmed", "not_started", "unknown"].includes(frame.termination_state)
          || !/^[A-Z_]+$/u.test(frame.reason_code ?? "")
          || !Number.isFinite(Date.parse(frame.observed_at)) || frame.resumed !== resumed
          || !(frame.exit_code === null || Number.isSafeInteger(frame.exit_code) && frame.exit_code >= 0 && frame.exit_code <= 0xffffffff)
          || (frame.outcome === "indeterminate") !== (frame.termination_state === "unknown")
          || frame.termination_state === "confirmed" && (!runner || frame.active_processes !== 0 || frame.pid !== runner.pid
            || frame.job_name !== runner.job_name || frame.started_at !== runner.started_at)
          || frame.termination_state === "not_started" && (runner || frame.pid !== null || frame.active_processes !== null)
          || frame.outcome === "completed" && (frame.exit_code !== 0 || frame.termination_state !== "confirmed" || !resumed)) { invalid(); return; }
        terminal = frame; return;
      }
      let event;
      if (frame.type === "prepared") {
        if (runner || !Number.isSafeInteger(frame.pid) || frame.pid <= 0 || frame.suspended !== true || frame.job_assigned !== true
          || jobName !== undefined && frame.job_name !== jobName
          || !/^Local\\aidn-execution-[a-f0-9]{32}$/u.test(frame.job_name ?? "") || !Number.isFinite(Date.parse(frame.started_at))) { invalid(); return; }
        runner = { runner_id: runnerId, pid: frame.pid, started_at: frame.started_at, job_name: frame.job_name,
          helper_pid: child.pid, executable_sha256: executableSha256, ...hashes };
        event = { type: "prepared", ...runner, suspended: true, job_assigned: true };
      } else if (frame.type === "resumed") {
        if (!runner || resumed) { invalid(); return; } resumed = true; event = { type: "resumed", ...runner };
      } else {
        if (!runner || !resumed || typeof frame.data !== "string" || frame.data.length > 5464
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(frame.data)) { invalid(); return; }
        const chunk = Buffer.from(frame.data, "base64"); bytes[frame.type] += chunk.length; digests[frame.type].update(chunk);
        if (bytes.stdout + bytes.stderr > maxOutputBytes) { requestStop("PROCESS_OUTPUT_LIMIT"); return; }
        event = { type: frame.type, bytes: chunk };
      }
      if (callbacksFailed || protocolFailed || stopped) return;
      // An arbitrary callback promise cannot be cancelled. Await it while the
      // run is live, then ignore its late settlement: it can never resume the
      // worker or cause a new controller emission after cancellation/deadline.
      let completion;
      try {
        completion = Promise.resolve(onEvent(event)).then(() => ({ completed: true }), () => ({ failed: true }));
      } catch { completion = Promise.resolve({ failed: true }); }
      const callback = await Promise.race([completion, callbacksStopped]);
      if (callback.stopped) { callbacksFailed = true; return; }
      if (callback.failed) { callbacksFailed = true; requestStop("PROCESS_CALLBACK_FAILED"); return; }
      if (frame.type === "prepared" && !stopped && !closed) child.stdin.write('{"action":"resume"}\n', () => {});
    };
    child.stdout.on("data", (chunk) => {
      if (protocolFailed) return;
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf(10); if (end < 0) break;
        const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
        if (line.length > 16384) { invalid(); break; }
        let frame; try { frame = JSON.parse(line.toString("utf8")); } catch { invalid(); break; }
        pending += line.length;
        if (pending > maxPendingBytes) requestStop("PROCESS_EVENT_QUEUE_LIMIT");
        if (pending > maxPendingBytes + 16384) { invalid(); break; }
        queue = queue.then(() => handle(frame)).catch(invalid).finally(() => { pending -= line.length; });
      }
      if (buffer.length > 16384) invalid();
    });
    let stderrBytes = 0;
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; if (stderrBytes > 65536) requestStop("PROCESS_HELPER_DIAGNOSTIC_LIMIT"); });
    child.stdin.on("error", () => { if (!closed && !terminal) requestStop("PROCESS_HELPER_INPUT_FAILED"); });
    const abort = () => requestStop("PROCESS_CANCELLED"); signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => requestStop("PROCESS_TIMEOUT"), maxDurationMs);
    const exit = await new Promise((resolve) => {
      child.once("error", () => { helperError = true; });
      child.once("close", (code, exitSignal) => { closed = true; resolve({ code, signal: exitSignal }); });
      child.stdin.write(`${payload}\n`, () => {});
      if (signal?.aborted) requestStop("PROCESS_CANCELLED");
    });
    // Keep the deadline active after helper close: an in-flight callback may
    // otherwise prevent the queued, already received terminal proof being read.
    await queue;
    clearTimeout(timeout); if (stopTimer) clearTimeout(stopTimer); signal?.removeEventListener("abort", abort);
    const result = terminal && !protocolFailed && buffer.length === 0 && !helperError
      && (exit.code === 0 || terminal.outcome === "indeterminate" && exit.code === 2)
      ? { outcome: terminal.outcome, reason_code: terminal.reason_code, termination_state: terminal.termination_state,
        exit_code: terminal.exit_code, signal: null, runner, bytes,
        termination_proof: terminal.termination_state === "confirmed" ? {
          method: "windows-job-object", runner_id: runnerId, pid: runner.pid, started_at: runner.started_at,
          job_name: runner.job_name, active_processes: 0, observed_at: terminal.observed_at, ...hashes,
        } : null }
      : { ...failure(helperError && !child.pid ? "PROCESS_HELPER_SPAWN_FAILED" : "PROCESS_HELPER_TERMINATION_UNCONFIRMED", helperError && !child.pid ? "not_started" : "unknown"), runner, bytes };
    if (result.termination_state !== "unknown" && stopped) {
      result.reason_code = stopped;
      result.outcome = stopped === "PROCESS_CANCELLED" ? "cancelled" : stopped === "PROCESS_TIMEOUT" ? "timed_out" : "failed";
    }
    return { ...result, hashes: { ...hashes, executable_sha256: executableSha256,
      stdout_sha256: digests.stdout.digest("hex"), stderr_sha256: digests.stderr.digest("hex") } };
  }
  return Object.freeze({ checkAvailability, run });
}
