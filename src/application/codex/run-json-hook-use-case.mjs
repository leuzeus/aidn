import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDbBackedStateMode,
  resolveEffectiveStateMode,
} from "../../core/state-mode/state-mode-policy.mjs";
import { shouldAutoDbSyncForSkill } from "../../core/skills/skill-policy.mjs";
import { normalizeHookPayload } from "./normalize-hook-payload.mjs";

const CODEX_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_SYNC_SCRIPT = path.resolve(CODEX_DIR, "..", "..", "..", "tools", "runtime", "sync-db-first-selective.mjs");
function ensureJsonArg(commandArgs) {
  if (commandArgs.includes("--json")) {
    return commandArgs;
  }
  return [...commandArgs, "--json"];
}

function buildDefaultCommand(args) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const commandArgs = [
    "aidn",
    "perf",
    "skill-hook",
    "--skill",
    args.skill,
    "--target",
    args.target,
  ];
  if (args.mode) {
    commandArgs.push("--mode", args.mode);
  }
  if (args.strict) {
    commandArgs.push("--strict");
  }
  commandArgs.push("--json");
  return { command, commandArgs, source: "default" };
}

function toCommandLine(command, commandArgs) {
  const esc = (value) => (/\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value);
  return [command, ...commandArgs].map((item) => esc(String(item))).join(" ");
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Empty stdout from command");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const candidate = trimmed.slice(first, last + 1);
      return JSON.parse(candidate);
    }
    throw new Error("Command stdout is not valid JSON");
  }
}

function buildErrorPayload(args, targetRoot, stateMode, commandLine, result, parseError) {
  const strictRequiredByState = isDbBackedStateMode(stateMode);
  const spawnMessage = result?.error?.message ? `spawn error: ${result.error.message}` : "";
  const parseMessage = parseError ? String(parseError.message ?? parseError) : "";
  const message = [parseMessage, spawnMessage].filter((item) => item.length > 0).join(" | ") || "Command failed";
  return {
    ts: new Date().toISOString(),
    ok: false,
    skill: args.skill,
    mode: args.mode || "UNKNOWN",
    target: targetRoot,
    state_mode: stateMode,
    strict_requested: args.strict,
    strict_required_by_state: strictRequiredByState,
    strict: args.strict || strictRequiredByState,
    command: commandLine,
    error: {
      message,
      stdout: String(result?.stdout ?? "").trim(),
      stderr: String(result?.stderr ?? "").trim(),
      status: Number(result?.status ?? 1),
    },
  };
}

function runDbSync(agentAdapter, targetRoot, stateMode) {
  const result = agentAdapter.runCommand({
    command: process.execPath,
    commandArgs: [
      RUNTIME_SYNC_SCRIPT,
      "--target",
      targetRoot,
      "--state-mode",
      stateMode,
      "--json",
    ],
    commandLine: `${process.execPath} ${RUNTIME_SYNC_SCRIPT} --target ${targetRoot} --state-mode ${stateMode} --json`,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    payload: parseJsonOutput(result.stdout),
  };
}

export function runJsonHookUseCase({ args, targetRoot, agentAdapter, hookContextStore }) {
  const stateMode = resolveEffectiveStateMode({
    targetRoot,
    stateMode: args.stateMode || "files",
  });

  const commandSpec = args.command.length > 0
    ? {
      command: args.command[0],
      commandArgs: args.command.slice(1),
      source: "explicit",
    }
    : buildDefaultCommand(args);

  if (!commandSpec.command) {
    throw new Error("Missing command after --");
  }

  const commandArgs = args.forceJson
    ? ensureJsonArg(commandSpec.commandArgs)
    : commandSpec.commandArgs;
  const commandLine = toCommandLine(commandSpec.command, commandArgs);
  const result = agentAdapter.runCommand({
    command: commandSpec.command,
    commandArgs,
    commandLine,
    envOverrides: {
      AIDN_STATE_MODE: stateMode,
    },
  });

  let rawPayload = null;
  let parseError = null;
  try {
    rawPayload = parseJsonOutput(result.stdout);
  } catch (error) {
    parseError = error;
    rawPayload = buildErrorPayload(args, targetRoot, stateMode, commandLine, result, parseError);
  }

  const strictRequiredByState = isDbBackedStateMode(stateMode);
  const normalized = normalizeHookPayload(rawPayload, {
    skill: args.skill,
    mode: args.mode || undefined,
    stateMode,
    strictRequested: args.strict || strictRequiredByState,
    command: commandLine,
    targetRoot,
  });

  const contextWrite = hookContextStore.persistContext({
    targetRoot,
    contextFile: args.contextFile,
    rawDir: args.rawDir,
    maxEntries: args.maxEntries,
    skill: args.skill,
    rawPayload,
    normalized,
    sourceMeta: {
      command: commandLine,
      command_status: result.status ?? 1,
    },
  });

  const autoDbSync = args.dbSyncExplicit
    ? Boolean(args.dbSync)
    : shouldAutoDbSyncForSkill(args.skill);
  let dbSync = {
    enabled: false,
    skipped: true,
    reason: "disabled",
    payload: null,
    error: null,
  };
  if (autoDbSync && isDbBackedStateMode(stateMode)) {
    dbSync.enabled = true;
    dbSync.skipped = false;
    dbSync.reason = null;
    try {
      const sync = runDbSync(agentAdapter, targetRoot, stateMode);
      dbSync.payload = sync.payload;
      if (sync.status !== 0 || dbSync.payload?.ok === false) {
        dbSync.error = {
          message: "DB sync failed",
          status: sync.status,
          stderr: String(sync.stderr ?? "").trim(),
        };
      }
    } catch (error) {
      dbSync.error = {
        message: String(error.message ?? error),
        status: 1,
        stderr: "",
      };
    }
  } else if (autoDbSync) {
    dbSync.enabled = true;
    dbSync.skipped = true;
    dbSync.reason = "state_mode_not_db_backed";
  }

  return {
    ts: new Date().toISOString(),
    ok: normalized.ok,
    skill: normalized.skill,
    mode: normalized.mode,
    state_mode: normalized.state_mode,
    strict: normalized.strict,
    decision: normalized.decision,
    fallback: normalized.fallback,
    reason_codes: normalized.reason_codes,
    action: normalized.action,
    result: normalized.result,
    error: normalized.error,
    command: commandLine,
    command_status: result.status ?? 1,
    context_file: contextWrite.context_file,
    raw_file: contextWrite.raw_file,
    history_count: contextWrite.history_count,
    db_sync: dbSync,
    normalized,
  };
}
