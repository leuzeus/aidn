import path from "node:path";
import { createHash } from "node:crypto";
import { assertManagedSetupStartup, buildManagedSetupStartupPaths } from "../../core/agents/codex-managed-startup.mjs";
import { buildCodexStartupArguments, CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../core/agents/codex-startup-arguments.mjs";

const ENV = new Set(CODEX_STARTUP_ENVIRONMENT_PROFILES.managed);
const ARGUMENTS = Object.freeze([
  "-c", 'sandbox_mode="workspace-write"', "-c", 'windows.sandbox="elevated"',
  "-c", "features.windows_sandbox_service=false", "-c", 'approval_policy="never"',
  "-c", "sandbox_workspace_write.writable_roots=[]", "-c", "sandbox_workspace_write.network_access=false",
  "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true", "-c", "sandbox_workspace_write.exclude_slash_tmp=true",
  "app-server", "--listen", "stdio://",
]);
export function buildManagedSetupArguments(startup) {
  const paths = buildManagedSetupStartupPaths(startup);
  const common = buildCodexStartupArguments({ mcp_server_ids: startup.mcp_server_ids, plugin_ids: startup.plugin_ids, app_ids: startup.app_ids,
    environment_override_names: startup.environment_override_names, environment_names: CODEX_STARTUP_ENVIRONMENT_PROFILES.managed,
    log_dir: paths.log_dir, sqlite_home: paths.sqlite_home });
  return [...ARGUMENTS.slice(0, -3), "-c", "agents.enabled=false", ...common, ...ARGUMENTS.slice(-3)];
}
const HASH = /^[a-f0-9]{64}$/u;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const ensure = (ok, code) => { if (!ok) fail(code); };
const exact = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...names].sort().join("|");
const absolute = value => typeof value === "string" && (path.isAbsolute(value) || path.win32.isAbsolute(value))
  && !/[\x00-\x1f]/u.test(value);
const positive = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;

/**
 * Single-use transport for the fixed setup channel. No implicit executable,
 * environment, spawn implementation, availability check or process creation on
 * construction. The bridge must validate physical paths, pins, operation and
 * preconditions first. spawnProcess has node:child_process.spawn's signature.
 *
 * Only the channel's three exact encoded client frames can cross stdin. All
 * stream bytes stay private. stderr is counted/hashed, never copied to stdout.
 * requestStop closes stdin and terminates only the owned direct app-server.
 * It ALWAYS reports unconfirmed: neither its exit nor EOF establishes Job0.
 * The parent controller remains responsible for every surviving descendant.
 */
function jsonData(value, depth = 0, seen = new Set()) {
  ensure(depth <= 20 && !seen.has(value), "SETUP_TRANSPORT_DATA_INVALID");
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return;
  ensure(value && typeof value === "object" && (Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value))), "SETUP_TRANSPORT_DATA_INVALID");
  seen.add(value); const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) ensure(keys.length === value.length + 1, "SETUP_TRANSPORT_DATA_INVALID");
  for (const key of keys) {
    ensure(typeof key === "string" && key.isWellFormed(), "SETUP_TRANSPORT_DATA_INVALID");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    ensure(Object.hasOwn(descriptor, "value"), "SETUP_TRANSPORT_DATA_INVALID");
    if (Array.isArray(value) && key === "length") continue;
    ensure(descriptor.enumerable && (!Array.isArray(value) || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length), "SETUP_TRANSPORT_DATA_INVALID");
    jsonData(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}
export function createManagedSetupTransport({ client, cwd, env, limits, startup, spawnProcess } = {}) {
  jsonData({ client, cwd, env, limits, startup });
  const expectedArguments = buildManagedSetupArguments(startup);
  ensure(exact(client, ["executable", "sha256", "args"]) && absolute(client.executable) && typeof client.sha256 === "string" && HASH.test(client.sha256)
    && Array.isArray(client.args) && client.args.length === expectedArguments.length && client.args.every((value, index) => value === expectedArguments[index]), "SETUP_TRANSPORT_CLIENT_INVALID");
  ensure(absolute(cwd) && typeof spawnProcess === "function", "SETUP_TRANSPORT_DEPENDENCY_INVALID");
  ensure(env && typeof env === "object" && !Array.isArray(env) && Object.keys(env).length <= ENV.size
    && new Set(Object.keys(env).map(name => name.toUpperCase())).size === Object.keys(env).length
    && Object.entries(env).every(([name, value]) => ENV.has(name.toUpperCase()) && typeof value === "string"
      && value.length <= 32768 && !/[\0\r\n]/u.test(value))
    && Object.entries(env).some(([name, value]) => name.toUpperCase() === "CODEX_HOME" && absolute(value)), "SETUP_TRANSPORT_ENVIRONMENT_INVALID");
  ensure(exact(limits, ["max_stdout_bytes", "max_stderr_bytes", "max_pending_bytes"])
    && positive(limits.max_stdout_bytes, 1048576) && positive(limits.max_stderr_bytes, 1048576)
    && positive(limits.max_pending_bytes, limits.max_stdout_bytes), "SETUP_TRANSPORT_LIMIT_INVALID");
  const environmentValue = name => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
  assertManagedSetupStartup(startup, { cwd, profile_root: environmentValue("CODEX_HOME"), candidate_root: cwd });
  ensure(environmentValue("TEMP") === startup.state_root && environmentValue("TMP") === startup.state_root, "SETUP_TRANSPORT_STARTUP_ENVIRONMENT_MISMATCH");
  const selected = structuredClone({ client, cwd, env, limits, startup });
  const frames = [
    { id: "aidn.managed-setup.initialize.1", method: "initialize", params: { clientInfo: { name: "aidn_managed_setup_protocol", version: "0.1.0-preparation" } } },
    { method: "initialized" },
    { id: "aidn.managed-setup.start.1", method: "windowsSandbox/setupStart", params: { cwd, mode: "elevated" } },
  ].map(frame => Buffer.from(JSON.stringify(frame) + "\n"));
  let child = null, index = 0, writing = false, stopped = false, forced = false, ended = false, closed = false, claimed = false, fault = null;
  let pendingBytes = 0, stdoutBytes = 0, stderrBytes = 0, exitCode = null, exitSignal = null;
  const queue = [], readers = [], closeWaiters = new Set(), writes = new Set();
  const stdoutHash = createHash("sha256"), stderrHash = createHash("sha256");
  function notify() {
    while (readers.length && (queue.length || fault || ended)) {
      const reader = readers.shift();
      if (fault) reader.reject(Object.assign(new Error(fault), { code: fault }));
      else if (queue.length) {
        const value = queue.shift(); pendingBytes -= value.byteLength;
        reader.resolve({ done: false, value });
      } else reader.resolve({ done: true });
    }
  }
  function closeInput() {
    if (stopped) return;
    stopped = true;
    for (const cancel of [...writes]) cancel();
    if (!child) { ended = true; closed = true; notify(); return; }
    try { if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end(); } catch {}
  }
  function stopDirect() {
    closeInput();
    // kill() targets the owned ChildProcess only; never taskkill, PID enumeration,
    // UAC, service control or a claim about descendant termination.
    if (!forced && child && !closed && child.exitCode == null && child.signalCode == null) {
      forced = true; try { child.kill(); } catch {}
    }
  }
  function rejectStream(code) {
    fault ??= code;
    queue.length = 0; pendingBytes = 0;
    notify(); stopDirect();
  }
  function start() {
    try {
      child = spawnProcess(selected.client.executable, selected.client.args, {
        cwd: selected.cwd, env: selected.env, shell: false, windowsHide: true,
        detached: false, stdio: ["pipe", "pipe", "pipe"],
      });
    } catch { fail("SETUP_TRANSPORT_SPAWN_FAILED"); }
    ensure(child && typeof child.on === "function" && typeof child.kill === "function"
      && child.stdin && typeof child.stdin.write === "function" && typeof child.stdin.end === "function"
      && typeof child.stdin.on === "function" && typeof child.stdin.removeListener === "function"
      && child.stdout && typeof child.stdout.on === "function" && child.stderr && typeof child.stderr.on === "function",
    "SETUP_TRANSPORT_CHILD_INVALID");
    child.on("error", () => rejectStream("SETUP_TRANSPORT_PROCESS_ERROR"));
    child.on("exit", (code, signal) => { exitCode = Number.isSafeInteger(code) ? code : null; exitSignal = typeof signal === "string" ? signal : null; });
    child.on("close", (code, signal) => {
      closed = true;
      exitCode = Number.isSafeInteger(code) ? code : exitCode;
      exitSignal = typeof signal === "string" ? signal : exitSignal;
      if (!ended) { fault ??= "SETUP_TRANSPORT_STDOUT_NOT_ENDED"; notify(); }
      for (const resolve of [...closeWaiters]) resolve();
      for (const cancel of [...writes]) cancel();
    });
    child.stdin.on("error", () => rejectStream("SETUP_TRANSPORT_STDIN_ERROR"));
    child.stdout.on("error", () => rejectStream("SETUP_TRANSPORT_STDOUT_ERROR"));
    child.stderr.on("error", () => rejectStream("SETUP_TRANSPORT_STDERR_ERROR"));
    child.stdout.on("data", bytes => {
      if (fault) return;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) { rejectStream("SETUP_TRANSPORT_STDOUT_INVALID"); return; }
      stdoutBytes += bytes.byteLength;
      if (stdoutBytes > selected.limits.max_stdout_bytes) { rejectStream("SETUP_TRANSPORT_STDOUT_LIMIT"); return; }
      stdoutHash.update(bytes);
      pendingBytes += bytes.byteLength;
      if (pendingBytes > selected.limits.max_pending_bytes) { rejectStream("SETUP_TRANSPORT_PENDING_LIMIT"); return; }
      queue.push(Buffer.from(bytes)); notify();
    });
    child.stdout.on("end", () => { ended = true; notify(); });
    child.stderr.on("data", bytes => {
      if (!(bytes instanceof Uint8Array)) { rejectStream("SETUP_TRANSPORT_STDERR_INVALID"); return; }
      stderrBytes += bytes.byteLength;
      if (stderrBytes > selected.limits.max_stderr_bytes) { rejectStream("SETUP_TRANSPORT_STDERR_LIMIT"); return; }
      stderrHash.update(bytes);
    });
  }
  async function send(bytes, { signal } = {}) {
    ensure(signal instanceof AbortSignal && !signal.aborted && !stopped && !fault, "SETUP_TRANSPORT_CANCELLED");
    ensure(!writing && index < frames.length && bytes instanceof Uint8Array
      && Buffer.from(bytes).equals(frames[index]), "SETUP_TRANSPORT_FRAME_REFUSED");
    writing = true; index++;
    try {
      if (!child) start();
      ensure(!signal.aborted && !stopped && !fault && !closed, "SETUP_TRANSPORT_CANCELLED");
      await new Promise((resolve, reject) => {
        let settled = false, returned = false, accepted = false, flushed = false, drained = false;
        const cleanup = () => { signal.removeEventListener("abort", cancel); child.stdin.removeListener("drain", drain); writes.delete(cancel); };
        const finish = error => {
          if (settled) return;
          if (!error && !(returned && flushed && (accepted || drained))) return;
          settled = true; cleanup(); if (error) reject(error); else resolve();
        };
        const cancel = () => finish(Object.assign(new Error("SETUP_TRANSPORT_WRITE_STOPPED"), { code: "SETUP_TRANSPORT_WRITE_STOPPED" }));
        const drain = () => { drained = true; finish(); };
        writes.add(cancel); signal.addEventListener("abort", cancel, { once: true }); child.stdin.on("drain", drain);
        if (signal.aborted || stopped || fault || closed) { cancel(); return; }
        try {
          accepted = child.stdin.write(Buffer.from(bytes), error => {
            if (error) { finish(Object.assign(new Error("SETUP_TRANSPORT_WRITE_FAILED"), { code: "SETUP_TRANSPORT_WRITE_FAILED" })); return; }
            flushed = true; finish();
          }) !== false;
          returned = true; finish();
        } catch { finish(Object.assign(new Error("SETUP_TRANSPORT_WRITE_FAILED"), { code: "SETUP_TRANSPORT_WRITE_FAILED" })); }
      });
    } finally { writing = false; }
  }
  const stdout = Object.freeze({
    [Symbol.asyncIterator]() {
      ensure(!claimed, "SETUP_TRANSPORT_READER_ALREADY_CLAIMED"); claimed = true;
      return { next() {
        return new Promise((resolve, reject) => {
          if (readers.length) { reject(Object.assign(new Error("SETUP_TRANSPORT_CONCURRENT_READ"), { code: "SETUP_TRANSPORT_CONCURRENT_READ" })); return; }
          readers.push({ resolve, reject }); notify();
        });
      } };
    },
  });
  async function requestStop({ reason, signal } = {}) {
    ensure(signal instanceof AbortSignal, "SETUP_TRANSPORT_STOP_SIGNAL_INVALID");
    if (reason === "SETUP_PROTOCOL_TERMINAL") closeInput(); else stopDirect();
    if (!closed && !signal.aborted) await new Promise(resolve => {
      const done = () => { signal.removeEventListener("abort", done); closeWaiters.delete(done); if (signal.aborted) stopDirect(); resolve(); };
      closeWaiters.add(done); signal.addEventListener("abort", done, { once: true });
      if (closed || signal.aborted) done();
    });
    if (signal.aborted) stopDirect();
    return { termination: "unconfirmed" };
  }
  function getObservation() {
    return Object.freeze({
      pid: Number.isSafeInteger(child?.pid) && child.pid > 0 ? child.pid : null,
      closed, forced, stdout_ended: ended, stop_requested: stopped,
      exit_code: exitCode, signal: exitSignal, reason_code: fault,
      stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes, pending_bytes: pendingBytes,
      stdout_sha256: stdoutHash.copy().digest("hex"), stderr_sha256: stderrHash.copy().digest("hex"),
      sent_frames: index, termination: "unconfirmed",
    });
  }
  return Object.freeze({ send, stdout, requestStop, getObservation });
}
