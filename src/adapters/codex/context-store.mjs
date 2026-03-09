import fs from "node:fs";
import path from "node:path";

export const DEFAULT_CONTEXT_FILE = ".aidn/runtime/context/codex-context.json";
export const DEFAULT_RAW_DIR = ".aidn/runtime/context/raw";

function sanitizeName(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "hook";
}

function resolveTargetPath(targetRoot, inputPath) {
  if (!inputPath) {
    return "";
  }
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }
  return path.resolve(targetRoot, inputPath);
}

function readJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function nextHistory(history, entry, maxEntries) {
  const list = Array.isArray(history) ? [...history, entry] : [entry];
  return list.length > maxEntries ? list.slice(list.length - maxEntries) : list;
}

function buildEntryId(skill, ts, sequence) {
  return `${sanitizeName(skill)}-${String(ts).replace(/[^0-9A-Za-z]+/g, "")}-${sequence}`;
}

export function persistHookContext(options) {
  const now = new Date().toISOString();
  const targetRoot = path.resolve(process.cwd(), options.targetRoot ?? ".");
  const contextFile = resolveTargetPath(targetRoot, options.contextFile || DEFAULT_CONTEXT_FILE);
  const rawDir = resolveTargetPath(targetRoot, options.rawDir || DEFAULT_RAW_DIR);
  const maxEntries = Math.max(1, Number(options.maxEntries ?? 50));
  const skill = String(options.skill ?? "unknown");
  const normalized = options.normalized && typeof options.normalized === "object"
    ? options.normalized
    : {};
  const rawPayload = options.rawPayload;
  const sourceMeta = options.sourceMeta && typeof options.sourceMeta === "object"
    ? options.sourceMeta
    : {};

  fs.mkdirSync(rawDir, { recursive: true });
  const rawFile = path.join(
    rawDir,
    `${sanitizeName(skill)}-${now.replace(/[:.]/g, "-")}.json`,
  );
  writeJson(rawFile, rawPayload ?? {});

  const store = readJsonSafe(contextFile, {
    schema_version: 1,
    target_root: targetRoot,
    updated_at: now,
    latest: {},
    history: [],
  });
  if (!store || typeof store !== "object") {
    throw new Error(`Invalid context store format: ${contextFile}`);
  }
  if (!store.latest || typeof store.latest !== "object") {
    store.latest = {};
  }
  if (!Array.isArray(store.history)) {
    store.history = [];
  }

  const sequence = store.history.length + 1;
  const entry = {
    id: buildEntryId(skill, normalized.ts ?? now, sequence),
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
    repair_layer_top_findings: Array.isArray(normalized.repair_layer_top_findings)
      ? normalized.repair_layer_top_findings.slice(0, 5)
      : [],
    gates_triggered: Array.isArray(normalized.gates_triggered) ? normalized.gates_triggered : [],
    error: normalized.error ?? null,
    command: normalized.command ?? sourceMeta.command ?? null,
    command_status: sourceMeta.command_status ?? null,
    raw_file: rawFile,
    target: normalized.target ?? targetRoot,
  };

  store.latest[skill] = entry;
  store.history = nextHistory(store.history, entry, maxEntries);
  store.updated_at = now;
  store.target_root = targetRoot;

  writeJson(contextFile, store);
  return {
    context_file: contextFile,
    raw_file: rawFile,
    entry,
    history_count: store.history.length,
  };
}

export function readHookContext(options = {}) {
  const targetRoot = path.resolve(process.cwd(), options.targetRoot ?? ".");
  const contextFile = resolveTargetPath(targetRoot, options.contextFile || DEFAULT_CONTEXT_FILE);
  const store = readJsonSafe(contextFile, null);
  return {
    context_file: contextFile,
    exists: Boolean(store && typeof store === "object"),
    store,
  };
}
