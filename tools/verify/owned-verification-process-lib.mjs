import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildAgentProcessHelper } from "./build-agent-process-helper.mjs";
import { createWindowsProcessTreeController } from "../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs";

const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const now = () => new Date().toISOString();
const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
export function verificationCallerIdentity() {
  const observed = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command",
    `[System.Diagnostics.Process]::GetProcessById(${process.pid}).StartTime.ToUniversalTime().Ticks.ToString()`],
  { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 4096 });
  const ticks = observed.stdout?.trim();
  if (observed.status !== 0 || !/^\d{18}$/u.test(ticks ?? "")) throw Error("VERIFICATION_CALLER_IDENTITY_UNAVAILABLE");
  return { pid: process.pid, creation_ticks: ticks };
}
async function watchCaller(identity, cancellation) {
  if (!Number.isSafeInteger(identity?.pid) || identity.pid <= 0 || !/^\d{18}$/u.test(identity.creation_ticks ?? ""))
    throw Error("VERIFICATION_CALLER_IDENTITY_REQUIRED");
  const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-File", path.join(import.meta.dirname, "watch-verification-caller.ps1"),
    "-CallerId", String(identity.pid), "-CallerCreationTicks", identity.creation_ticks, "-SupervisorId", String(process.pid)],
  { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  let closed = false;
  const ended = new Promise(resolve => child.once("close", () => { closed = true; cancellation.abort(); resolve(); }));
  try { await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("VERIFICATION_CALLER_WATCH_TIMEOUT")), 10000);
    const fail = () => { clearTimeout(timer); reject(Error("VERIFICATION_CALLER_WATCH_FAILED")); };
    child.once("error", fail); child.once("close", fail);
    child.stdout.on("data", bytes => {
      output += bytes.toString("utf8");
      if (output === "VERIFICATION_CALLER_WATCH_READY\r\n" || output === "VERIFICATION_CALLER_WATCH_READY\n") {
        clearTimeout(timer); child.removeListener("close", fail); resolve();
      } else if (output.length > 128) fail();
    });
    child.stderr.resume();
  }); } catch (error) { if (!closed) child.kill(); await ended; throw error; }
  return { pid: child.pid, async close() { if (!closed) child.kill(); await ended; } };
}
function reconcileFixtureObservations(root, receipt) {
  // Preserve interrupted originals. The enclosing Job proves OS closure only;
  // it cannot invent an individual child exit code or a business cleanup result.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    if (fs.existsSync(path.join(directory, "cases.json"))) {
      const catalog = JSON.parse(fs.readFileSync(path.join(directory, "cases.json"), "utf8"));
      for (const [index, args] of catalog.cases.entries()) {
        const child = path.join(directory, String(index + 1).padStart(3, "0"));
        if (!fs.existsSync(child)) continue;
        fs.writeFileSync(path.join(child, "enclosing-job-closure.json"), JSON.stringify({ index: index + 1, args,
          observed_at: now(), individual_result_retained: fs.existsSync(path.join(child, "result.json")),
          individual_exit_code: "READ_ORIGINAL_RESULT_OR_UNKNOWN", enclosing_result: receipt.result,
          cleanup: receipt.cleanup, scope: "owned OS Job only; no business ALLresources closure" }, null, 2), { flag: "wx" });
      }
    }
    reconcileFixtureObservations(directory, receipt);
  }
}
export function verificationEvidenceDirectory(cwd, root = os.tmpdir()) {
  if (!path.isAbsolute(root)) throw Error("VERIFICATION_EVIDENCE_ABSOLUTE_PATH_REQUIRED");
  const physical = fs.realpathSync.native(root), relative = path.relative(fs.realpathSync.native(cwd), physical);
  if (!relative || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
    throw Error("VERIFICATION_EVIDENCE_MUST_BE_OUTSIDE_CHECKOUT");
  return fs.mkdtempSync(path.join(physical, "aidn-verification-"));
}

// Verification tools reuse the existing OS controller. This grants no business
// authority, Native permission, or shared-runtime access.
export function verificationWindowsController(evidenceDir, env = process.env) {
  const manifest = env.AIDN_VERIFICATION_HELPER_MANIFEST
    ? JSON.parse(fs.readFileSync(env.AIDN_VERIFICATION_HELPER_MANIFEST, "utf8"))
    : buildAgentProcessHelper({ outputDir: path.join(evidenceDir, "helper") });
  return { manifest, controller: createWindowsProcessTreeController({ helperPath: manifest.helper_path,
    helperSha256: manifest.helper_sha256, helperSourceSha256: manifest.source_sha256,
    candidateSha256: hash(fileURLToPath(import.meta.url)), allowNoDeadline: true }) };
}

export async function runWindowsVerificationCommand({ command, args, cwd, env = process.env, deadlineAt,
  maxOutputBytes, controller, evidenceDir, signal, onEvent = () => {} }) {
  if (deadlineAt !== null && (!Number.isSafeInteger(deadlineAt) || deadlineAt <= 0)) throw Error("VERIFICATION_DEADLINE_INVALID");
  const started = now(), remaining = deadlineAt === null ? null : deadlineAt - Date.now();
  const identity = { command, args, cwd, started_at: started, deadline_at: deadlineAt === null ? null : new Date(deadlineAt).toISOString() };
  fs.writeFileSync(path.join(evidenceDir, "started.json"), JSON.stringify(identity, null, 2), { flag: "wx" });
  let result;
  if (remaining !== null && remaining <= 0 || signal?.aborted) result = { outcome: signal?.aborted ? "cancelled" : "timed_out",
    reason_code: signal?.aborted ? "PROCESS_CANCELLED_BEFORE_START" : "PROCESS_TIMEOUT_BEFORE_START",
    termination_state: "not_started", exit_code: null, runner: null, termination_proof: null };
  else {
    const timeout = new AbortController(), timer = remaining === null ? null : setTimeout(() => timeout.abort(), remaining);
    try { result = await controller.run({ runnerId: "verification." + randomUUID(), executable: command,
      executableSha256: hash(command), args, cwd, env: Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")),
      stdin: "", maxDurationMs: remaining, maxOutputBytes, stopTimeoutMs: 5000 }, { signal, timeoutSignal: timeout.signal, onEvent: event => {
        if (deadlineAt !== null && Date.now() >= deadlineAt) timeout.abort();
        if (event.type === "prepared" || event.type === "resumed") fs.appendFileSync(path.join(evidenceDir, "events.jsonl"), JSON.stringify({ at: now(), ...event }) + "\n");
        return onEvent(event);
      } });
    } finally { clearTimeout(timer); }
  }
  const receipt = { ...identity, ended_at: now(), deadline_exceeded: deadlineAt !== null && Date.now() >= deadlineAt, result,
    cleanup: { state: result.termination_state, proof: result.termination_proof },
    transcripts: Object.fromEntries(["stdout", "stderr"].map(name => {
      const file = path.join(evidenceDir, name + ".log"), sha256 = fs.existsSync(file) ? hash(file) : null;
      return [name, { sha256, controller_sha256: result.hashes?.[name + "_sha256"] ?? null,
        complete: sha256 !== null && sha256 === result.hashes?.[name + "_sha256"] }];
    })) };
  fs.writeFileSync(path.join(evidenceDir, "result.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  return result;
}

// Keep the synchronous family API. The supervisor owns the Job's lifetime pipe;
// if it dies, EOF reaches the helper (never inherited by the command's children).
export function runOwnedVerificationCommandSync({ command, args, cwd, env, timeoutMs, maxBuffer }) {
  if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) throw Error("VERIFICATION_TIMEOUT_INVALID");
  const evidenceDir = verificationEvidenceDirectory(cwd, env.AIDN_VERIFICATION_EVIDENCE_ROOT);
  const deadlineAt = timeoutMs === null ? null : Date.now() + timeoutMs;
  const caller = verificationCallerIdentity();
  const request = { command, args, cwd, deadlineAt, maxOutputBytes: maxBuffer, evidenceDir, caller };
  const outer = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--supervise"], {
    cwd, env, input: JSON.stringify(request), encoding: "utf8", shell: false, windowsHide: true,
    // The command retains its original deadline. This separate allowance only
    // collects closure evidence; the helper independently enforces the deadline.
    ...(timeoutMs === null ? {} : { timeout: timeoutMs + 15000 }), maxBuffer,
  });
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(path.join(evidenceDir, "result.json"), "utf8")); } catch { /* retain unknown */ }
  const stopped = receipt?.result, closed = stopped?.termination_state === "confirmed";
  const ok = closed && stopped.outcome === "completed" && !outer.error && outer.status === 0;
  const error = ok ? null : Object.assign(new Error(stopped?.reason_code ?? "VERIFICATION_TERMINATION_UNCONFIRMED"),
    { code: stopped?.outcome === "timed_out" ? "ETIMEDOUT" : outer.error?.code ?? stopped?.reason_code ?? "VERIFICATION_TERMINATION_UNCONFIRMED" });
  return { ...outer, status: ok ? 0 : stopped?.exit_code ?? outer.status, error,
    verification_process: { evidence_dir: evidenceDir, deadline_at: deadlineAt === null ? null : new Date(deadlineAt).toISOString(),
      outcome: stopped?.outcome ?? "indeterminate", cleanup: receipt?.cleanup ?? { state: "unknown", proof: null } } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--supervise") throw Error("VERIFICATION_SUPERVISOR_ARGUMENT_INVALID");
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  const cancellation = new AbortController();
  const stop = () => cancellation.abort(); process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const watch = await watchCaller(request.caller, cancellation);
  fs.writeFileSync(path.join(request.evidenceDir, "caller-watch.json"), JSON.stringify({ caller: request.caller,
    supervisor_pid: process.pid, watcher_pid: watch.pid, admitted_at: now(), method: "retained Windows process handles" }), { flag: "wx" });
  let descriptors = [];
  try {
    const { controller, manifest } = verificationWindowsController(request.evidenceDir);
    const env = { ...process.env, AIDN_VERIFICATION_HELPER_MANIFEST: manifest.manifest_path,
      AIDN_FIXTURE_EVIDENCE_ROOT: request.evidenceDir,
      AIDN_VERIFICATION_SUPERVISOR_PID: String(process.pid) };
    if (request.deadlineAt === null) delete env.AIDN_VERIFICATION_DEADLINE_AT;
    else env.AIDN_VERIFICATION_DEADLINE_AT = String(request.deadlineAt);
    descriptors = ["stdout", "stderr"].map(name => fs.openSync(path.join(request.evidenceDir, name + ".log"), "wx"));
    const result = await runWindowsVerificationCommand({ ...request, controller, env, signal: cancellation.signal,
      onEvent(event) { if (["stdout", "stderr"].includes(event.type)) {
        fs.writeSync(descriptors[event.type === "stdout" ? 0 : 1], event.bytes);
        process[event.type].write(event.bytes);
      } } });
    try { reconcileFixtureObservations(request.evidenceDir, JSON.parse(fs.readFileSync(path.join(request.evidenceDir, "result.json"), "utf8"))); }
    catch (error) {
      fs.writeFileSync(path.join(request.evidenceDir, "observation-reconciliation-error.json"), JSON.stringify({
        at: now(), error_code: error.code ?? null, error: error.message, original_result_preserved: true }), { flag: "wx" });
      throw error;
    }
    process.exitCode = result.outcome === "completed" && result.termination_state === "confirmed" ? 0 : 1;
  } finally { for (const fd of descriptors) fs.closeSync(fd); await watch.close(); }
}
