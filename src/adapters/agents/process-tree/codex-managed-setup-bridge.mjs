import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createManagedSetupProtocol } from "../../../core/agents/codex-managed-setup-protocol.mjs";
import { runManagedSetupChannel } from "../codex-managed-setup-channel.mjs";
import { createManagedSetupTransport, buildManagedSetupArguments } from "../codex-managed-setup-transport.mjs";

export const MANAGED_SETUP_BRIDGE_SOURCE_FILES = Object.freeze([
  "src/adapters/agents/process-tree/codex-managed-setup-bridge.mjs",
  "src/adapters/agents/process-tree/codex-managed-setup-preflight.ps1",
  "src/adapters/agents/codex-managed-setup-transport.mjs",
  "src/adapters/agents/codex-managed-setup-channel.mjs",
  "src/core/agents/codex-managed-setup-protocol.mjs",
]);
const PROTOCOL = "aidn-controlled-managed-setup.v1", HASH = /^[a-f0-9]{64}$/u;
const INPUT_LIMIT = 262144, OUTPUT_LIMIT = 131072;
class BridgeFailure extends Error { constructor(code) { super(code); this.code = code; } }
const ensure = (condition, code) => { if (!condition) throw new BridgeFailure(code); };
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...fields].sort().join("|");
const digest = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]"
  : value !== null && typeof value === "object" ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
    : JSON.stringify(value);
const fingerprint = value => digest(canonical(value));
const samePath = (a, b) => a === b || (/^[A-Za-z]:\\/u.test(a) && /^[A-Za-z]:\\/u.test(b)
  && a.replace(/[a-z]/gu, c => c.toUpperCase()) === b.replace(/[a-z]/gu, c => c.toUpperCase()));
const absolute = value => typeof value === "string" && value.isWellFormed() && value.normalize("NFC") === value
  && !/[\x00-\x1f]/u.test(value) && ((path.isAbsolute(value) && path.normalize(value) === value)
    || (path.win32.isAbsolute(value) && path.win32.normalize(value) === value));
const pin = value => exact(value, ["executable", "sha256"]) && absolute(value.executable) && typeof value.sha256 === "string" && HASH.test(value.sha256);
const relative = value => typeof value === "string" && value.length <= 512 && /^[A-Za-z0-9_./ -]+$/u.test(value)
  && value.split("/").every(part => part && part !== "." && part !== ".." && !/[. ]$/u.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
const join = (root, item) => /^[A-Za-z]:\\/u.test(root) ? path.win32.join(root, ...item.split("/")) : path.join(root, ...item.split("/"));
function jsonData(value, depth = 0, seen = new Set()) {
  ensure(depth <= 20, "SETUP_BRIDGE_JSON_DEPTH");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { ensure(value.isWellFormed(), "SETUP_BRIDGE_UNICODE_INVALID"); return; }
  if (typeof value === "number") { ensure(Number.isFinite(value), "SETUP_BRIDGE_JSON_INVALID"); return; }
  ensure(value && typeof value === "object" && (Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    && !seen.has(value), "SETUP_BRIDGE_JSON_INVALID");
  seen.add(value); const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) ensure(keys.length === value.length + 1, "SETUP_BRIDGE_JSON_INVALID");
  for (const key of keys) {
    ensure(typeof key === "string" && key.isWellFormed(), "SETUP_BRIDGE_JSON_INVALID");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    ensure(Object.hasOwn(descriptor, "value"), "SETUP_BRIDGE_JSON_ACCESSOR");
    if (Array.isArray(value) && key === "length") continue;
    ensure(descriptor.enumerable && (!Array.isArray(value) || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length), "SETUP_BRIDGE_JSON_INVALID");
    jsonData(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

export function assertManagedSetupBridgeRequest(envelope) {
  jsonData(envelope);
  const fields = ["protocol", "intent", "invocation_id", "operation_sha256", "configuration_sha256", "approval_sha256", "protocol_config",
    "node", "powershell", "job_name", "candidate_root", "source_inventory", "client", "sidecars", "cwd", "env", "limits", "prerequisites", "request_sha256"];
  ensure(exact(envelope, fields) && envelope.protocol === PROTOCOL && envelope.intent === "execute-managed-setup"
    && typeof envelope.invocation_id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(envelope.invocation_id), "SETUP_BRIDGE_REQUEST_INVALID");
  for (const field of ["operation_sha256", "configuration_sha256", "approval_sha256", "request_sha256"]) ensure(typeof envelope[field] === "string" && HASH.test(envelope[field]), "SETUP_BRIDGE_PIN_INVALID");
  const { request_sha256, ...body } = envelope;
  ensure(Buffer.byteLength(canonical(envelope)) <= INPUT_LIMIT && fingerprint(body) === request_sha256, "SETUP_BRIDGE_REQUEST_HASH_MISMATCH");
  ensure(pin(body.node) && pin(body.powershell) && absolute(body.candidate_root)
    && /^Local\\aidn-execution-[a-f0-9]{32}$/u.test(body.job_name), "SETUP_BRIDGE_RUNTIME_INVALID");
  ensure(exact(body.sidecars, ["setup", "command_runner"]) && pin(body.sidecars.setup) && pin(body.sidecars.command_runner), "SETUP_BRIDGE_SIDECAR_INVALID");
  ensure(body.source_inventory && typeof body.source_inventory === "object" && !Array.isArray(body.source_inventory), "SETUP_BRIDGE_INVENTORY_INVALID");
  const names = Object.keys(body.source_inventory);
  ensure(names.length >= MANAGED_SETUP_BRIDGE_SOURCE_FILES.length && names.length <= 4096
    && new Set(names.map(name => name.toLowerCase())).size === names.length
    && names.every(name => relative(name) && typeof body.source_inventory[name] === "string" && HASH.test(body.source_inventory[name]))
    && MANAGED_SETUP_BRIDGE_SOURCE_FILES.every(name => HASH.test(body.source_inventory[name] ?? "")), "SETUP_BRIDGE_INVENTORY_INVALID");
  createManagedSetupProtocol(body.protocol_config, { at: 0 });
  ensure(body.cwd === body.protocol_config.cwd && body.operation_sha256 === body.protocol_config.operation_sha256
    && body.client?.sha256 === body.protocol_config.client_sha256, "SETUP_BRIDGE_PROTOCOL_BINDING");
  ensure(exact(body.limits, ["max_stdout_bytes", "max_stderr_bytes", "max_pending_bytes", "stop_timeout_ms"])
    && Number.isSafeInteger(body.limits.stop_timeout_ms) && body.limits.stop_timeout_ms > 0 && body.limits.stop_timeout_ms <= 60000
    && body.limits.max_stdout_bytes <= body.protocol_config.limits.max_total_bytes, "SETUP_BRIDGE_LIMIT_INVALID");
  // Construction validates the closed environment/arguments without spawning.
  createManagedSetupTransport({ client: body.client, cwd: body.cwd, env: body.env,
    limits: { max_stdout_bytes: body.limits.max_stdout_bytes, max_stderr_bytes: body.limits.max_stderr_bytes, max_pending_bytes: body.limits.max_pending_bytes },
    spawnProcess() { throw new BridgeFailure("SETUP_BRIDGE_VALIDATION_SPAWN_FORBIDDEN"); } });
  const home = Object.entries(body.env).find(([name]) => name.toUpperCase() === "CODEX_HOME")?.[1];
  ensure(home === body.protocol_config.expected_codex_home, "SETUP_BRIDGE_HOME_BINDING");
  ensure(exact(body.prerequisites, ["reference", "sha256"]) && absolute(body.prerequisites.reference)
    && typeof body.prerequisites.sha256 === "string" && HASH.test(body.prerequisites.sha256), "SETUP_BRIDGE_PREREQUISITE_REFERENCE_INVALID");
  return true;
}

async function physical(file, directory = false) {
  ensure(absolute(file), "SETUP_BRIDGE_PATH_INVALID");
  let cursor = file;
  for (;;) {
    const stat = await fs.lstat(cursor); ensure(!stat.isSymbolicLink(), "SETUP_BRIDGE_PATH_ALIAS");
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  const stat = await fs.lstat(file);
  ensure(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1, "SETUP_BRIDGE_PATH_KIND_INVALID");
  ensure(samePath(await fs.realpath(file), file), "SETUP_BRIDGE_PATH_ALIAS"); return stat;
}
async function inspectFile(file, { maxBytes, keepBytes = false, signal }) {
  const before = await physical(file); ensure(before.size <= maxBytes, "SETUP_BRIDGE_FILE_LIMIT");
  const handle = await fs.open(file, "r"), hash = createHash("sha256"), chunks = [];
  let total = 0;
  try {
    const opened = await handle.stat(); ensure(opened.dev === before.dev && opened.ino === before.ino, "SETUP_BRIDGE_FILE_CHANGED");
    for (;;) {
      ensure(!signal.aborted, "SETUP_BRIDGE_CANCELLED");
      const buffer = Buffer.alloc(Math.min(65536, maxBytes - total + 1)), read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      total += read.bytesRead; ensure(total <= maxBytes, "SETUP_BRIDGE_FILE_LIMIT"); const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk); if (keepBytes) chunks.push(chunk);
    }
    const after = await handle.stat(), final = await physical(file);
    ensure(total === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
      && final.dev === before.dev && final.ino === before.ino && final.size === before.size && final.mtimeMs === before.mtimeMs, "SETUP_BRIDGE_FILE_CHANGED");
    return { physical_path: file, kind: "file", bytes: total, sha256: hash.digest("hex"), ...(keepBytes ? { content: Buffer.concat(chunks, total) } : {}) };
  } finally { await handle.close(); }
}
async function inspectDirectory(file) { await physical(file, true); return { physical_path: file, kind: "directory" }; }
const iso = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function prerequisites(record, body, at) {
  const fields = ["contract_version", "operation_sha256", "client_sha256", "configuration_sha256", "cwd", "profile_root", "node_sha256",
    "candidate_inventory_sha256", "environment_sha256", "client_arguments_sha256", "approval_sha256", "observed_at", "expires_at", "route"];
  jsonData(record);
  ensure(exact(record, fields) && record.contract_version === "aidn-managed-setup-prerequisites.v1"
    && iso(record.observed_at) && iso(record.expires_at) && iso(at), "SETUP_BRIDGE_PREREQUISITE_INVALID");
  ensure(Date.parse(record.observed_at) <= Date.parse(at) && Date.parse(at) < Date.parse(record.expires_at)
    && Date.parse(record.expires_at) - Date.parse(record.observed_at) > 0
    && Date.parse(record.expires_at) - Date.parse(record.observed_at) <= 300000, "SETUP_BRIDGE_PREREQUISITE_STALE");
  const bindings = { operation_sha256: body.operation_sha256, client_sha256: body.client.sha256, configuration_sha256: body.configuration_sha256,
    cwd: body.cwd, profile_root: body.protocol_config.expected_codex_home, node_sha256: body.node.sha256,
    candidate_inventory_sha256: fingerprint(body.source_inventory), environment_sha256: fingerprint(body.env),
    client_arguments_sha256: fingerprint(body.client.args), approval_sha256: body.approval_sha256 };
  ensure(Object.entries(bindings).every(([name, value]) => record[name] === value)
    && exact(record.route, ["service_enabled", "registered_core_requested"])
    && record.route.service_enabled === false && record.route.registered_core_requested === false, "SETUP_BRIDGE_PREREQUISITE_BINDING");
}


function assertContainingJob(observation, request) {
  ensure(exact(observation, ["contract_version", "request_sha256", "phase", "observed_at", "status", "launcher", "target", "helpers", "errors"])
    && observation.contract_version === "aidn-managed-setup-preflight.v1" && observation.request_sha256 === request.request_sha256
    && observation.phase === "inside_bridge" && observation.status === "OBSERVED"
    && iso(observation.observed_at)
    && Array.isArray(observation.errors) && observation.errors.length === 0
    && exact(observation.helpers, ["complete", "rows"]) && observation.helpers.complete === true
    && Array.isArray(observation.helpers.rows) && observation.helpers.rows.length === 0, "SETUP_BRIDGE_CONTAINING_JOB_UNCONFIRMED");
  const fields = ["pid", "started_at", "elevated", "admin_enabled", "integrity_sid", "elevation_type", "token_type",
    "has_restrictions", "restricted_sid_count", "is_app_container", "job_name", "job_member"];
  for (const [role, row] of [["launcher", observation.launcher], ["target", observation.target]]) {
    ensure(exact(row, fields) && row.pid === process.pid && typeof row.started_at === "string"
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/u.test(row.started_at) && Number.isFinite(Date.parse(row.started_at))
      && new Date(row.started_at).toISOString() === row.started_at.replace(/(\.\d{3})\d{4}Z$/u, "$1Z")
      && row.elevated === true && row.admin_enabled === true && row.integrity_sid === "S-1-16-12288"
      && [1, 2].includes(row.elevation_type) && row.token_type === 1
      && row.has_restrictions === false && row.restricted_sid_count === 0 && row.is_app_container === false
      && (role === "target" ? row.job_name === request.job_name && row.job_member === true : row.job_name === null && row.job_member === null),
    "SETUP_BRIDGE_CONTAINING_JOB_UNCONFIRMED");
  }
  ensure(observation.launcher.started_at === observation.target.started_at, "SETUP_BRIDGE_CONTAINING_JOB_UNCONFIRMED");
  return true;
}

/** Fixed, read-only native verifier. The caller must already have pinned its
 * PowerShell executable and script. No setup/app-server command is accepted. */
export async function verifyManagedSetupContainingJob({ request, signal, spawnProcess, clock }) {
  ensure(typeof spawnProcess === "function" && clock && typeof clock.now === "function"
    && typeof clock.waitUntil === "function" && signal instanceof AbortSignal, "SETUP_BRIDGE_PREFLIGHT_DEPENDENCY");
  ensure(!signal.aborted, "SETUP_BRIDGE_CANCELLED");
  const payload = { contract_version: "aidn-managed-setup-preflight-request.v1", request_sha256: request.request_sha256,
    phase: "inside_bridge", launcher: { pid: process.pid, started_at: null },
    target: { pid: process.pid, started_at: null, job_name: request.job_name }, max_duration_ms: 5000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  ensure(Buffer.byteLength(JSON.stringify(payload)) <= 65536, "SETUP_BRIDGE_PREFLIGHT_INPUT_LIMIT");
  const script = join(request.candidate_root, "src/adapters/agents/process-tree/codex-managed-setup-preflight.ps1");
  let previous = -1;
  const readTime = () => {
    const now = clock.now();
    ensure(Number.isSafeInteger(now) && now >= 0 && now >= previous, "SETUP_BRIDGE_CLOCK_INVALID");
    previous = now; return now;
  };
  const deadline = readTime() + 5000;
  ensure(Number.isSafeInteger(deadline), "SETUP_BRIDGE_CLOCK_INVALID");
  const checkpoint = () => {
    const now = readTime();
    ensure(!signal.aborted, "SETUP_BRIDGE_CANCELLED");
    ensure(now < deadline, "SETUP_BRIDGE_PREFLIGHT_TIMEOUT");
  };
  let child, closed = false, exitCode = null, stdoutBytes = 0, stderrBytes = 0, reason = null;
  const chunks = [], timer = new AbortController();
  let complete, wakeStop;
  const completion = new Promise(resolve => { complete = resolve; });
  const stopWake = new Promise(resolve => { wakeStop = resolve; });
  const stop = code => {
    reason ??= code; wakeStop();
    try { if (child && !closed && child.exitCode == null && child.signalCode == null) child.kill(); } catch {}
  };
  const cancel = () => stop("SETUP_BRIDGE_CANCELLED");
  try {
    checkpoint();
    child = spawnProcess(request.powershell.executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script, "-RequestBase64", encoded],
      { cwd: request.cwd, env: request.env, windowsHide: true, shell: false, detached: false, stdio: ["ignore", "pipe", "pipe"] });
    ensure(child && typeof child.on === "function" && typeof child.kill === "function"
      && child.stdout && typeof child.stdout.on === "function" && child.stderr && typeof child.stderr.on === "function", "SETUP_BRIDGE_PREFLIGHT_CHILD_INVALID");
    child.on("error", () => { stop("SETUP_BRIDGE_PREFLIGHT_PROCESS_ERROR"); });
    child.on("close", code => { closed = true; exitCode = Number.isSafeInteger(code) ? code : null; complete(); });
    child.stdout.on("error", () => stop("SETUP_BRIDGE_PREFLIGHT_STREAM_ERROR"));
    child.stderr.on("error", () => stop("SETUP_BRIDGE_PREFLIGHT_STREAM_ERROR"));
    child.stdout.on("data", bytes => {
      if (!(bytes instanceof Uint8Array)) { stop("SETUP_BRIDGE_PREFLIGHT_STREAM_ERROR"); return; }
      stdoutBytes += bytes.length;
      if (stdoutBytes > 65536) { stop("SETUP_BRIDGE_PREFLIGHT_OUTPUT_LIMIT"); return; }
      chunks.push(Buffer.from(bytes));
    });
    child.stderr.on("data", bytes => {
      if (!(bytes instanceof Uint8Array)) { stop("SETUP_BRIDGE_PREFLIGHT_STREAM_ERROR"); return; }
      stderrBytes += bytes.length; if (stderrBytes > 16384) stop("SETUP_BRIDGE_PREFLIGHT_OUTPUT_LIMIT");
    });
    signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
    const budget = Promise.resolve().then(() => clock.waitUntil(deadline, { signal: timer.signal })).then(() => {
      ensure(readTime() >= deadline, "SETUP_BRIDGE_CLOCK_INVALID"); stop("SETUP_BRIDGE_PREFLIGHT_TIMEOUT");
    });
    await Promise.race([completion, budget, stopWake]);
    if (!closed) {
      const stopDeadline = readTime() + 1000, stopTimer = new AbortController();
      try { await Promise.race([completion, clock.waitUntil(stopDeadline, { signal: stopTimer.signal })]); }
      finally { stopTimer.abort(); }
    }
    ensure(closed, "SETUP_BRIDGE_PREFLIGHT_STOP_UNCONFIRMED");
    ensure(!reason && exitCode === 0, reason ?? "SETUP_BRIDGE_PREFLIGHT_FAILED");
    let observed; try { observed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, stdoutBytes))); }
    catch { throw new BridgeFailure("SETUP_BRIDGE_PREFLIGHT_JSON_INVALID"); }
    jsonData(observed); assertContainingJob(observed, request); checkpoint(); return observed;
  } catch (error) {
    stop(error instanceof BridgeFailure ? error.code : "SETUP_BRIDGE_PREFLIGHT_FAILED");
    throw error instanceof BridgeFailure ? error : new BridgeFailure("SETUP_BRIDGE_PREFLIGHT_FAILED");
  } finally { timer.abort(); signal.removeEventListener("abort", cancel); }
}

// The injectable ports are test seams, never evidence of native qualification.
// Direct entry below binds the real readers, spawn and live Job verifier.
export async function runManagedSetupBridge(input, {
  spawnProcess, signal, inspectFile: fileInspector = inspectFile, inspectDirectory: directoryInspector = inspectDirectory,
  clock, at, verifyContainingJob,
} = {}) {
  let identity = { protocol: PROTOCOL, invocation_id: null, request_sha256: null, operation_sha256: null };
  let transport = null, containingJob = null, result = null;
  try {
    assertManagedSetupBridgeRequest(input);
    const body = JSON.parse(canonical(input));
    identity = { protocol: PROTOCOL, invocation_id: body.invocation_id, request_sha256: body.request_sha256, operation_sha256: body.operation_sha256 };
    ensure(typeof spawnProcess === "function" && typeof fileInspector === "function" && typeof directoryInspector === "function"
      && clock && typeof clock.now === "function" && typeof clock.waitUntil === "function"
      && typeof verifyContainingJob === "function" && iso(at), "SETUP_BRIDGE_DEPENDENCY_REQUIRED");
    ensure(signal === undefined || signal instanceof AbortSignal, "SETUP_BRIDGE_SIGNAL_INVALID");
    ensure(samePath(body.node.executable, process.execPath), "SETUP_BRIDGE_NODE_IDENTITY");
    ensure(samePath(join(body.candidate_root, MANAGED_SETUP_BRIDGE_SOURCE_FILES[0]), fileURLToPath(import.meta.url)), "SETUP_BRIDGE_SOURCE_IDENTITY");
    const stop = new AbortController(), abort = () => stop.abort();
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    const began = clock.now(), deadline = began + body.protocol_config.limits.max_duration_ms;
    ensure(Number.isSafeInteger(began) && began >= 0 && Number.isSafeInteger(deadline), "SETUP_BRIDGE_CLOCK_INVALID");
    let previous = began;
    const checkpoint = () => {
      const now = clock.now(); ensure(Number.isSafeInteger(now) && now >= previous, "SETUP_BRIDGE_CLOCK_INVALID"); previous = now;
      ensure(!stop.signal.aborted, "SETUP_BRIDGE_CANCELLED"); ensure(now < deadline, "SETUP_BRIDGE_TIMEOUT");
    };
    async function bounded(action) {
      checkpoint(); const timer = new AbortController(); let cancel;
      try {
        return await Promise.race([
          Promise.resolve().then(() => { checkpoint(); return action(); }).then(value => { checkpoint(); return value; }),
          Promise.resolve().then(() => clock.waitUntil(deadline, { signal: timer.signal })).then(() => {
            ensure(clock.now() >= deadline, "SETUP_BRIDGE_CLOCK_INVALID"); throw new BridgeFailure("SETUP_BRIDGE_TIMEOUT");
          }),
          new Promise((_, reject) => { cancel = () => reject(new BridgeFailure("SETUP_BRIDGE_CANCELLED")); stop.signal.addEventListener("abort", cancel, { once: true }); if (stop.signal.aborted) cancel(); }),
        ]);
      } finally { timer.abort(); stop.signal.removeEventListener("abort", cancel); }
    }
    async function checkFile(file, sha256, maxBytes, keepBytes = false) {
      const record = await bounded(() => fileInspector(file, { maxBytes, keepBytes, signal: stop.signal }));
      ensure(record && record.kind === "file" && samePath(record.physical_path, file) && record.sha256 === sha256
        && Number.isSafeInteger(record.bytes) && record.bytes >= 0 && record.bytes <= maxBytes, "SETUP_BRIDGE_FILE_PIN_MISMATCH");
      if (keepBytes) ensure(record.content instanceof Uint8Array && record.content.byteLength === record.bytes && digest(record.content) === sha256, "SETUP_BRIDGE_FILE_PIN_MISMATCH");
      return record;
    }
    try {
      for (const directory of [body.candidate_root, body.cwd, body.protocol_config.expected_codex_home]) {
        const record = await bounded(() => directoryInspector(directory, { signal: stop.signal }));
        ensure(record?.kind === "directory" && samePath(record.physical_path, directory), "SETUP_BRIDGE_DIRECTORY_MISMATCH");
      }
      for (const [name, sha256] of Object.entries(body.source_inventory)) await checkFile(join(body.candidate_root, name), sha256, 8 * 1024 * 1024);
      for (const selected of [body.node, body.powershell, body.sidecars.setup, body.sidecars.command_runner]) await checkFile(selected.executable, selected.sha256, 256 * 1024 * 1024);
      await checkFile(body.client.executable, body.client.sha256, 512 * 1024 * 1024);
      const receipt = await checkFile(body.prerequisites.reference, body.prerequisites.sha256, INPUT_LIMIT, true);
      let record; try { record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receipt.content)); }
      catch { throw new BridgeFailure("SETUP_BRIDGE_PREREQUISITE_INVALID"); }
      prerequisites(record, body, new Date(Date.parse(at) + clock.now() - began).toISOString());
      const observedJob = await bounded(() => verifyContainingJob({ request: body, signal: stop.signal }));
      // A verifier must return its actual observation; a boolean is never enough.
      // Reject before retaining any untrusted fields in the result envelope.
      jsonData(observedJob); assertContainingJob(observedJob, body);
      containingJob = JSON.parse(canonical(observedJob));
      // Native preflight can take time. Recheck material and receipt freshness
      // before the lazy app-server spawn, never extend the overall bridge budget.
      await checkFile(body.client.executable, body.client.sha256, 512 * 1024 * 1024);
      for (const selected of Object.values(body.sidecars)) await checkFile(selected.executable, selected.sha256, 256 * 1024 * 1024);
      const finalReceipt = await checkFile(body.prerequisites.reference, body.prerequisites.sha256, INPUT_LIMIT, true);
      ensure(digest(finalReceipt.content) === digest(receipt.content), "SETUP_BRIDGE_PREREQUISITE_CHANGED");
      checkpoint(); prerequisites(record, body, new Date(Date.parse(at) + clock.now() - began).toISOString());
      transport = createManagedSetupTransport({ client: body.client, cwd: body.cwd, env: body.env,
        limits: { max_stdout_bytes: body.limits.max_stdout_bytes, max_stderr_bytes: body.limits.max_stderr_bytes, max_pending_bytes: body.limits.max_pending_bytes }, spawnProcess });
      const lifetime = new AbortController(); let deadlineExpired = false, timerFailed = false;
      const budget = Promise.resolve().then(() => clock.waitUntil(deadline, { signal: lifetime.signal })).then(() => {
        if (lifetime.signal.aborted) return;
        if (clock.now() < deadline) timerFailed = true; else deadlineExpired = true;
        stop.abort();
      }).catch(() => { if (!lifetime.signal.aborted) { timerFailed = true; stop.abort(); } });
      try {
        result = await runManagedSetupChannel(body.protocol_config, { transport, clock, signal: stop.signal,
          limits: { max_stdout_bytes: body.limits.max_stdout_bytes, stop_timeout_ms: body.limits.stop_timeout_ms } });
      } finally { lifetime.abort(); }
      // budget has rejection handlers even for an uncooperative injected timer.
      void budget;
      ensure(!timerFailed, "SETUP_BRIDGE_CLOCK_INVALID");
      ensure(!deadlineExpired, "SETUP_BRIDGE_TIMEOUT");
    } finally { stop.abort(); signal?.removeEventListener("abort", abort); }
    return freeze({ ...identity, ok: true, result: { channel: result, transport: transport?.getObservation() ?? null, preflight: containingJob },
      qualified: false, execution_available: false, admission_available: false, source_evidence: "candidate" });
  } catch (error) {
    return freeze({ ...identity, ok: false, error: { code: error instanceof BridgeFailure ? error.code : "SETUP_BRIDGE_FAILED" },
      result: { channel: result, transport: transport?.getObservation() ?? null, preflight: containingJob },
      qualified: false, execution_available: false, admission_available: false, source_evidence: "candidate" });
  }
}

// Explicit internal entry: the parent has already assigned this bridge to its Job.
// Importing this module has no CLI, process, probe or filesystem side effects.
async function main() {
  let output;
  try {
    const args = process.argv.slice(2);
    ensure(args.length === 3 && args[0] === "--execute" && args[1] === "--expect-request" && HASH.test(args[2]), "SETUP_BRIDGE_EXPLICIT_INTENT_REQUIRED");
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) { bytes += chunk.length; ensure(bytes <= INPUT_LIMIT, "SETUP_BRIDGE_INPUT_LIMIT"); chunks.push(chunk); }
    const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)));
    assertManagedSetupBridgeRequest(input);
    ensure(input.request_sha256 === args[2], "SETUP_BRIDGE_EXPECT_REQUEST_MISMATCH");
    const clock = {
      now: () => Math.floor(performance.now()),
      waitUntil(deadline, { signal }) {
        return new Promise((resolve, reject) => {
          let timer;
          const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
          const abort = () => { cleanup(); reject(new BridgeFailure("SETUP_BRIDGE_CANCELLED")); };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) { abort(); return; }
          timer = setTimeout(() => { cleanup(); resolve(); }, Math.max(0, deadline - Math.floor(performance.now())));
        });
      },
    };
    output = await runManagedSetupBridge(input, { spawnProcess: spawn, clock, at: new Date().toISOString(),
      verifyContainingJob: ({ request, signal }) => verifyManagedSetupContainingJob({ request, signal, spawnProcess: spawn, clock }) });
  } catch (error) { output = { protocol: PROTOCOL, ok: false, error: { code: error instanceof BridgeFailure ? error.code : "SETUP_BRIDGE_INPUT_INVALID" },
    qualified: false, execution_available: false, admission_available: false, source_evidence: "candidate" }; }
  const json = JSON.stringify(output);
  ensure(Buffer.byteLength(json) <= OUTPUT_LIMIT, "SETUP_BRIDGE_OUTPUT_LIMIT");
  process.stdout.write(json + "\n", () => { process.exit(output.ok ? 0 : 1); });
}
if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) await main();
