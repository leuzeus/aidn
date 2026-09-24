import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import { captureContextIdentity } from "./context-provenance.mjs";
import { evaluateContextObservation } from "../../application/codex/context-observation.mjs";

export const DEFAULT_CONTEXT_FILE = ".aidn/runtime/context/codex-context.json";
export const DEFAULT_RAW_DIR = ".aidn/runtime/context/raw";

function sanitizeName(value) {
  return String(value ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "hook";
}

function resolveTargetPath(targetRoot, inputPath) {
  return inputPath ? path.resolve(targetRoot, inputPath) : "";
}

function contextError(code, message) {
  return Object.assign(new Error(message), { code });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw contextError("CODEX_CONTEXT_INVALID", "Codex context is unreadable or invalid; preserve it and re-anchor explicitly.");
  }
}

function validateStore(store, targetRoot) {
  if (!store || typeof store !== "object" || Array.isArray(store)
      || (store.latest != null && (typeof store.latest !== "object" || Array.isArray(store.latest)))
      || (store.history != null && !Array.isArray(store.history))) {
    throw contextError("CODEX_CONTEXT_INVALID", "Invalid Codex context store; refusing to replace it.");
  }
  if (store.target_root && path.resolve(store.target_root) !== targetRoot) {
    throw contextError("CODEX_CONTEXT_SCOPE_MISMATCH", "Codex context belongs to another target; re-anchor instead of reusing its history.");
  }
}

function writeJson(filePath, payload) {
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      writeFileAtomicSync(filePath, serialized, { encoding: "utf8" });
      return;
    } catch (error) {
      // Windows readers can briefly deny replacement. Keep the destination intact;
      // retry the atomic operation under the same store lock, never delete it.
      if (process.platform !== "win32" || !["EPERM", "EBUSY"].includes(error.code) || attempt >= 10) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
    }
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function withContextLock(contextFile, timeoutMs, action) {
  fs.mkdirSync(path.dirname(contextFile), { recursive: true });
  const lockFile = `${contextFile}.lock`;
  const owner = crypto.randomUUID();
  const deadline = performance.now() + timeoutMs;
  const sleepArray = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    let fd;
    try {
      fd = fs.openSync(lockFile, "wx");
      fs.writeFileSync(fd, owner, "utf8");
      fs.closeSync(fd);
      break;
    } catch (error) {
      if (fd != null) {
        fs.closeSync(fd);
        fs.rmSync(lockFile, { force: true });
      }
      if (error.code !== "EEXIST") throw error;
      if (performance.now() >= deadline) {
        // Do not steal a lock by PID or age: a delayed writer may still own it.
        throw contextError("CODEX_CONTEXT_LOCK_TIMEOUT", "Codex context is locked; retry after the writer completes. An interrupted writer requires explicit lock recovery.");
      }
      Atomics.wait(sleepArray, 0, 0, Math.min(20, Math.max(1, deadline - performance.now())));
    }
  }
  try {
    return action();
  } finally {
    if (readLockOwner(lockFile) === owner) fs.rmSync(lockFile, { force: true });
  }
}

function readLockOwner(lockFile) {
  try { return fs.readFileSync(lockFile, "utf8"); } catch { return null; }
}

export function persistHookContext(options) {
  const targetRoot = path.resolve(process.cwd(), options.targetRoot ?? ".");
  const contextFile = resolveTargetPath(targetRoot, options.contextFile || DEFAULT_CONTEXT_FILE);
  const rawDir = resolveTargetPath(targetRoot, options.rawDir || DEFAULT_RAW_DIR);
  const maxEntries = Math.max(1, Number(options.maxEntries ?? 50));
  const lockTimeoutMs = Number(options.lockTimeoutMs ?? 5000);
  if (!Number.isInteger(maxEntries) || !Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0 || lockTimeoutMs > 30000) {
    throw contextError("CODEX_CONTEXT_INVALID_OPTIONS", "Invalid context retention or lock timeout.");
  }
  const skill = String(options.skill ?? "unknown");
  const normalized = options.normalized && typeof options.normalized === "object" ? options.normalized : {};
  const rawPayload = options.rawPayload;
  const sourceMeta = options.sourceMeta && typeof options.sourceMeta === "object" ? options.sourceMeta : {};
  // Only the orchestrator's execution identity can deduplicate a retained observation.
  // Equal payloads from distinct executions are distinct history, not exactly-once effects.
  const executionId = typeof sourceMeta.execution_id === "string" && sourceMeta.execution_id
    ? sourceMeta.execution_id : null;
  const payloadDigest = crypto.createHash("sha256")
    .update(stableJson({ skill, normalized, rawPayload, sourceMeta })).digest("hex");

  return withContextLock(contextFile, lockTimeoutMs, () => {
    const now = new Date().toISOString();
    const store = readJson(contextFile, {
      schema_version: 1, target_root: targetRoot, updated_at: now, latest: {}, history: [],
    });
    validateStore(store, targetRoot);
    store.latest ??= {};
    store.history ??= [];
    if (executionId) {
      const previous = store.history.find((entry) => entry.execution_id === executionId);
      if (previous) {
        if (previous.payload_digest !== payloadDigest) {
          throw contextError("CODEX_CONTEXT_EXECUTION_CONFLICT", "A retained hook execution identity has a different payload.");
        }
        return {
          context_file: contextFile, raw_file: previous.raw_file, entry: previous,
          history_count: store.history.length, deduplicated: true,
        };
      }
    }
    const entryId = `${sanitizeName(skill)}-${crypto.randomUUID()}`;
    const rawFile = path.join(rawDir, `${entryId}.json`);
    const entry = {
      id: entryId,
      execution_id: executionId,
      provenance: sourceMeta.provenance ?? null,
      payload_digest: payloadDigest,
      ts: normalized.ts ?? now,
      skill,
      mode: normalized.mode ?? "UNKNOWN",
      ok: Boolean(normalized.ok),
      state_mode: normalized.state_mode ?? "files",
      strict: Boolean(normalized.strict),
      decision: normalized.decision ?? null,
      fallback: normalized.fallback ?? null,
      reason_codes: Array.isArray(normalized.reason_codes) ? normalized.reason_codes : [],
      action: normalized.action ?? null,
      result: normalized.result ?? null,
      reason_code: normalized.reason_code ?? null,
      repair_layer_open_count: Number(normalized.repair_layer_open_count ?? 0),
      repair_layer_blocking: normalized.repair_layer_blocking === true,
      repair_layer_status: normalized.repair_layer_status ?? null,
      repair_layer_advice: normalized.repair_layer_advice ?? null,
      repair_primary_reason: normalized.repair_primary_reason ?? null,
      repair_layer_top_findings: Array.isArray(normalized.repair_layer_top_findings)
        ? normalized.repair_layer_top_findings.slice(0, 5) : [],
      gates_triggered: Array.isArray(normalized.gates_triggered) ? normalized.gates_triggered : [],
      error: normalized.error ?? null,
      command: sourceMeta.command ?? normalized.command ?? null,
      command_status: sourceMeta.command_status ?? null,
      raw_file: rawFile,
      target: targetRoot,
    };
    writeJson(rawFile, rawPayload ?? {});
    try {
      Object.defineProperty(store.latest, skill, { value: entry, enumerable: true, configurable: true, writable: true });
      store.history = [...store.history, entry].slice(-maxEntries);
      store.updated_at = now;
      store.target_root = targetRoot;
      writeJson(contextFile, store);
    } catch (error) {
      fs.rmSync(rawFile, { force: true });
      throw error;
    }
    return {
      context_file: contextFile, raw_file: rawFile, entry,
      history_count: store.history.length, deduplicated: false,
    };
  });
}

export function readHookContext(options = {}) {
  const targetRoot = path.resolve(process.cwd(), options.targetRoot ?? ".");
  const contextFile = resolveTargetPath(targetRoot, options.contextFile || DEFAULT_CONTEXT_FILE);
  const store = readJson(contextFile, null);
  if (store) {
    validateStore(store, targetRoot);
    const current = captureContextIdentity({ targetRoot, packageRoot: options.packageRoot });
    const annotate = (entry) => ({ ...entry, ...evaluateContextObservation(entry, current) });
    store.latest = Object.fromEntries(Object.entries(store.latest ?? {}).map(([skill, entry]) => [skill, annotate(entry)]));
    store.history = (store.history ?? []).map(annotate);
  }
  return { context_file: contextFile, exists: Boolean(store), store };
}
