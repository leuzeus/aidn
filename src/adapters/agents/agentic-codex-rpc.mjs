import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const failure = code => Object.assign(new Error(code), { code });

const terminalErrorCodes = new Set([
  "contextWindowExceeded", "sessionBudgetExceeded", "usageLimitExceeded", "rateLimitExceeded",
  "flexUnavailable", "serverOverloaded", "modelNotFound", "policyCapacityUnavailable",
  "cyberPolicy", "misalignmentPolicyViolation", "tooManyDenials", "internalServerError",
  "unauthorized", "badRequest", "threadRollbackFailed", "sandboxError", "other",
]);
const upstreamErrorCodes = new Set([
  "httpConnectionFailed", "responseStreamConnectionFailed", "responseStreamDisconnected", "responseTooManyFailedAttempts",
]);

const providerErrorCodes = new Set([
  "invalid_json_schema", "invalid_api_key", "model_not_found", "context_length_exceeded",
  "rate_limit_exceeded", "insufficient_quota", "credit_balance_exhausted", "server_is_overloaded",
]);

function reportedProviderErrorCode(message) {
  if (typeof message !== "string" || Buffer.byteLength(message) > 4096) return null;
  try {
    const code = JSON.parse(message)?.error?.code;
    return providerErrorCodes.has(code) ? code : null;
  } catch { return null; }
}

// The transport digest commits to the whole frame. Retain only known
// protocol tags and the upstream HTTP status alongside that digest.
function failedTurnDiagnostic(message) {
  if (message.method !== "turn/completed" || Object.hasOwn(message, "id")) return {};
  const turn = message.params?.turn;
  if (turn?.status === "completed") return {};
  const info = turn?.error?.codexErrorInfo;
  const keys = info && typeof info === "object" && !Array.isArray(info) ? Object.keys(info) : [];
  const variant = keys.length === 1 ? keys[0] : null;
  let code = info == null ? null : "unrecognized";
  let status = null;
  if (terminalErrorCodes.has(info)) code = info;
  else if (variant === "activeTurnNotSteerable") code = variant;
  else if (upstreamErrorCodes.has(variant)) {
    code = variant;
    status = info[variant]?.httpStatusCode;
  }
  const providerCode = code === "other" ? reportedProviderErrorCode(turn?.error?.message) : null;
  return {
    ...(providerCode ? { reported_provider_error_code: providerCode } : {}),
    turn_status: ["failed", "interrupted", "inProgress"].includes(turn?.status) ? turn.status : "unrecognized",
    codex_error_info: code,
    upstream_http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
  };
}

// This child must run inside the composition's owned process tree. close()
// confirms the direct child only; the outer controller proves tree termination.
export function createAgenticCodexRpc({ executable, sha256, args, cwd, env, deadline, onNotification,
  notificationMethods = null, onFailure = () => {}, diagnostic = () => {}, spawnProcess = spawn, maxBytes = 8 * 1024 * 1024 }) {
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now() || !Array.isArray(args)
    || args.length > 256 || args.some(value => typeof value !== "string" || value.includes("\0"))
    || !/^[a-f0-9]{64}$/.test(sha256) || hash(fs.readFileSync(executable)) !== sha256) throw failure("PROCESS_RPC_PIN_INVALID");
  const child = spawnProcess(executable, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let next = 0, buffer = Buffer.alloc(0), bytes = 0, stopped = null, closed = false, queue = Promise.resolve();
  let closing = null;
  function stop(code, terminate = true) {
    if (stopped) return; stopped = code;
    try { diagnostic({ code, pending_ids: [...pending.keys()], buffered_bytes: buffer.length, observed_bytes: bytes }); } catch { /* preserve first failure */ }
    try { onFailure(failure(code)); } catch { /* failure reporting cannot prevent cleanup */ }
    for (const row of pending.values()) { clearTimeout(row.timer); row.reject(failure(code)); }
    pending.clear(); if (terminate && !closed) child.kill();
  }
  function send(message) {
    const text = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(text) > 262144) { stop("PROCESS_RPC_SEND_LIMIT"); throw failure("PROCESS_RPC_SEND_LIMIT"); }
    child.stdin.write(text, error => { if (error) stop("PROCESS_RPC_WRITE_FAILED"); });
  }
  child.once("error", () => stop("PROCESS_RPC_SPAWN_FAILED"));
  child.stdin.on("error", () => stop("PROCESS_RPC_WRITE_FAILED"));
  child.stderr.on("data", part => { bytes += part.length; if (bytes > maxBytes) stop("PROCESS_RPC_BYTE_LIMIT"); });
  child.once("close", () => { closed = true; if (!stopped) stop("PROCESS_RPC_CLOSED"); });
  child.stdout.on("data", part => {
    if (stopped) return;
    bytes += part.length;
    if (bytes > maxBytes || buffer.length + part.length > 2 * 1024 * 1024) { stop("PROCESS_RPC_BYTE_LIMIT"); return; }
    buffer = Buffer.concat([buffer, part]);
    for (;;) {
      const end = buffer.indexOf(10); if (end < 0) break;
      const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
      let message; try { message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)); }
      catch { stop("PROCESS_RPC_FRAME_INVALID"); return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) { stop("PROCESS_RPC_FRAME_INVALID"); return; }
      const interested = !message.method || Object.hasOwn(message, "id") || !notificationMethods || notificationMethods.includes(message.method);
      if (message.method && (typeof message.method !== "string" || !/^[a-zA-Z][a-zA-Z0-9/_-]{0,127}$/.test(message.method))) { stop("PROCESS_RPC_METHOD_INVALID"); return; }
      try { if (interested) diagnostic({ type: message.method ?? "reply", id: Number.isSafeInteger(message.id) ? message.id : null,
        ...(typeof message.id === "string" ? { foreign_id_sha256: hash(message.id), foreign_id_bytes: Buffer.byteLength(message.id) } : {}), bytes: line.length, sha256: hash(line), ...failedTurnDiagnostic(message) }); }
      catch { stop("PROCESS_RPC_DIAGNOSTIC_FAILED"); return; }
      if (Object.hasOwn(message, "id") && !message.method) {
        const row = pending.get(message.id);
        if (!row) { stop("PROCESS_RPC_FOREIGN_REPLY"); return; }
        pending.delete(message.id); clearTimeout(row.timer);
        if (message.error) row.reject(failure("PROCESS_RPC_REFUSED")); else row.resolve(message.result);
      } else if (typeof message.method === "string" && !Object.hasOwn(message, "id")) {
        if (interested) queue = queue.then(() => onNotification(message)).catch(error => stop(/^PROCESS_[A-Z_]+$/.test(error?.code ?? "") ? error.code : "PROCESS_RPC_NOTIFICATION_REFUSED"));
      } else {
        // No approval escalation or dynamic-tool bridge. A server request is
        // refused rather than being executed with host privileges.
        stop("PROCESS_RPC_SERVER_REQUEST_UNSUPPORTED"); return;
      }
    }
  });
  const globalTimer = setTimeout(() => stop("PROCESS_RPC_GLOBAL_DEADLINE"), Math.max(1, deadline - Date.now()));
  async function closeTransport(graceful) {
    clearTimeout(globalTimer);
    const endInput = graceful && !stopped && !closed && pending.size === 0 && Date.now() < deadline;
    stop("PROCESS_RPC_STOPPED", !endInput);
    if (!closed) await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); child.off("close", finish); resolve(); };
      const timeout = endInput ? Math.min(2000, Math.max(0, deadline - Date.now())) : 2000;
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(); }, timeout);
      child.once("close", finish);
      if (endInput) child.stdin.end();
    });
    return { closed, direct_child_only: true, bytes };
  }
  return Object.freeze({
    request(method, params, timeoutMs = 20000) {
      if (stopped) return Promise.reject(failure(stopped));
      const id = ++next, remaining = Math.min(timeoutMs, deadline - Date.now());
      if (remaining <= 0) return Promise.reject(failure("PROCESS_RPC_GLOBAL_DEADLINE"));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(failure("PROCESS_RPC_TIMEOUT")); stop("PROCESS_RPC_TIMEOUT"); }, remaining);
        pending.set(id, { resolve, reject, timer });
        try { send({ id, method, params }); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    notify(method, params) { if (stopped) throw failure(stopped); send({ method, params }); },
    async flush() { await queue; if (stopped) throw failure(stopped); },
    close({ graceful = false } = {}) {
      closing ??= closeTransport(graceful).finally(() => { closing = null; });
      return closing;
    },
  });
}
