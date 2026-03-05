#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).map((item) => String(item));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return [];
}

function toBooleanOrNull(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function normalizeError(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const message = firstDefined(input.message, input.error_message, null);
  const stdout = firstDefined(input.stdout, null);
  const stderr = firstDefined(input.stderr, null);
  const status = Number(firstDefined(input.status, input.code, null));
  if (message == null && stdout == null && stderr == null && Number.isNaN(status)) {
    return null;
  }
  return {
    message: message == null ? "" : String(message),
    stdout: stdout == null ? "" : String(stdout),
    stderr: stderr == null ? "" : String(stderr),
    status: Number.isFinite(status) ? status : null,
  };
}

export function normalizeHookPayload(rawInput, options = {}) {
  const now = new Date().toISOString();
  const input = rawInput && typeof rawInput === "object" ? rawInput : {};
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const gate = input.gate && typeof input.gate === "object" ? input.gate : {};
  const reload = input.reload && typeof input.reload === "object" ? input.reload : {};
  const levels = input.levels && typeof input.levels === "object" ? input.levels : {};
  const level1 = levels.level1 && typeof levels.level1 === "object" ? levels.level1 : {};
  const error = normalizeError(firstDefined(input.error, payload.error, null));

  const stateMode = firstDefined(
    options.stateMode,
    input.state_mode,
    payload.state_mode,
    "files",
  );

  const strictRequested = Boolean(options.strictRequested);
  const inputStrictRequested = toBooleanOrNull(firstDefined(input.strict_requested, null));
  let strict = toBooleanOrNull(firstDefined(
    input.strict,
    input.strict_required_by_state,
    null,
  ));
  if (strict == null) {
    strict = strictRequested || stateMode === "dual" || stateMode === "db-only";
  } else if (strictRequested && strict !== true) {
    strict = true;
  }

  const explicitOk = typeof input.ok === "boolean" ? input.ok : null;
  const inferredOk = explicitOk != null ? explicitOk : error == null;

  const normalized = {
    ts: String(firstDefined(input.ts, payload.ts, now)),
    ok: inferredOk,
    skill: String(firstDefined(input.skill, options.skill, "unknown")),
    mode: String(firstDefined(input.mode, options.mode, "UNKNOWN")),
    tool: firstDefined(input.tool, options.tool, null),
    command: firstDefined(options.command, input.command, null),
    state_mode: String(stateMode),
    strict: Boolean(strict),
    strict_requested: strictRequested || inputStrictRequested === true,
    strict_required_by_state: stateMode === "dual" || stateMode === "db-only",
    decision: firstDefined(
      payload.decision,
      input.decision,
      reload.decision,
      level1.decision,
      null,
    ),
    fallback: toBooleanOrNull(firstDefined(
      payload.fallback,
      input.fallback,
      reload.fallback,
      level1.fallback,
      null,
    )),
    reason_codes: toArray(firstDefined(
      payload.reason_codes,
      input.reason_codes,
      reload.reason_codes,
      level1.reason_codes,
      null,
    )),
    action: firstDefined(
      payload.action,
      input.action,
      gate.action,
      null,
    ),
    result: firstDefined(
      payload.result,
      input.result,
      gate.result,
      null,
    ),
    reason_code: firstDefined(
      payload.reason_code,
      input.reason_code,
      gate.reason_code,
      null,
    ),
    gates_triggered: toArray(firstDefined(
      payload.gates_triggered,
      input.gates_triggered,
      gate.gates_triggered,
      null,
    )),
    mapping: firstDefined(payload.mapping, input.mapping, null),
    target: firstDefined(input.target, input.target_root, payload.target_root, options.targetRoot, null),
    error,
    raw: input,
  };

  if (normalized.ok === false && normalized.error == null) {
    normalized.error = {
      message: "Hook execution failed",
      stdout: "",
      stderr: "",
      status: null,
    };
  }
  return normalized;
}

function parseArgs(argv) {
  const args = {
    inputFile: "",
    skill: "",
    mode: "",
    stateMode: "",
    strictRequested: false,
    command: "",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--in") {
      args.inputFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--skill") {
      args.skill = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--mode") {
      args.mode = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--strict-requested") {
      args.strictRequested = true;
    } else if (token === "--command") {
      args.command = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.inputFile) {
    throw new Error("Missing value for --in");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/codex/normalize-hook-payload.mjs --in .aidn/runtime/context/raw/context-reload-latest.json --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const absolute = path.resolve(process.cwd(), args.inputFile);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Input file not found: ${absolute}`);
    }
    const raw = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const normalized = normalizeHookPayload(raw, {
      skill: args.skill || undefined,
      mode: args.mode || undefined,
      stateMode: args.stateMode || undefined,
      strictRequested: args.strictRequested,
      command: args.command || undefined,
    });
    if (args.json) {
      console.log(JSON.stringify(normalized, null, 2));
    } else {
      console.log(`ok=${normalized.ok} skill=${normalized.skill} mode=${normalized.mode} decision=${normalized.decision ?? "n/a"} action=${normalized.action ?? "n/a"}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
