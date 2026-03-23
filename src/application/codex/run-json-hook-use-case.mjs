import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDbBackedStateMode,
  resolveEffectiveStateMode,
} from "../../core/state-mode/state-mode-policy.mjs";
import { shouldAutoDbSyncForSkill } from "../../core/skills/skill-policy.mjs";
import {
  buildRunJsonHookSummary,
  deriveRepairLayerAdvice,
  deriveRepairPrimaryReason,
  deriveRepairLayerStatus,
} from "../../core/workflow/workflow-output-factory.mjs";
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
  if (args.noAutoSkipGate) {
    commandArgs.push("--no-auto-skip-gate");
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

function toOpenCountFromSeverityCounts(severityCounts) {
  if (!severityCounts || typeof severityCounts !== "object") {
    return null;
  }
  return Number(severityCounts.warning ?? 0) + Number(severityCounts.error ?? 0);
}

function normalizeTopFindings(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(0, 5).map((item) => ({
    severity: item?.severity ?? null,
    finding_type: item?.finding_type ?? null,
    entity_id: item?.entity_id ?? null,
    artifact_path: item?.artifact_path ?? null,
    message: item?.message ?? null,
  }));
}

function mergeRepairLayerSummary(normalized, dbSyncPayload) {
  const triage = dbSyncPayload?.repair_layer_triage_result?.triage ?? {};
  const triageSummary = triage?.summary && typeof triage.summary === "object" ? triage.summary : {};
  const repairSummary = dbSyncPayload?.repair_layer_result?.summary && typeof dbSyncPayload.repair_layer_result.summary === "object"
    ? dbSyncPayload.repair_layer_result.summary
    : {};
  const dbSyncOpenCount = triageSummary.open_findings_count
    ?? toOpenCountFromSeverityCounts(repairSummary.severity_counts);
  const openCount = Number(dbSyncOpenCount ?? normalized.repair_layer_open_count ?? 0);
  const blocking = Number(repairSummary?.severity_counts?.error ?? 0) > 0
    || normalized.repair_layer_blocking === true;
  const dbSyncTopFindings = normalizeTopFindings(
    Array.isArray(triage?.items) && triage.items.length > 0
      ? triage.items
      : repairSummary.top_findings,
  );
  const topFindings = dbSyncTopFindings.length > 0
    ? dbSyncTopFindings
    : (Array.isArray(normalized.repair_layer_top_findings) ? normalized.repair_layer_top_findings : []);
  return {
    ...normalized,
    repair_layer_open_count: openCount,
    repair_layer_blocking: blocking,
    repair_layer_top_findings: topFindings,
    repair_layer_status: deriveRepairLayerStatus({
      openCount,
      blocking,
    }),
    repair_layer_advice: deriveRepairLayerAdvice({
      openCount,
      blocking,
      topFindings,
    }),
    repair_primary_reason: deriveRepairPrimaryReason({
      status: deriveRepairLayerStatus({
        openCount,
        blocking,
      }),
      advice: deriveRepairLayerAdvice({
        openCount,
        blocking,
        topFindings,
      }),
      topFindings,
    }),
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

  const effectiveNormalized = dbSync.payload
    ? mergeRepairLayerSummary(normalized, dbSync.payload)
    : normalized;

  const contextWrite = hookContextStore.persistContext({
    targetRoot,
    contextFile: args.contextFile,
    rawDir: args.rawDir,
    maxEntries: args.maxEntries,
    skill: args.skill,
    rawPayload,
    normalized: effectiveNormalized,
    sourceMeta: {
      command: commandLine,
      command_status: result.status ?? 1,
    },
  });

  const output = {
    ts: new Date().toISOString(),
    ok: effectiveNormalized.ok,
    skill: effectiveNormalized.skill,
    mode: effectiveNormalized.mode,
    state_mode: effectiveNormalized.state_mode,
    strict: effectiveNormalized.strict,
    decision: effectiveNormalized.decision,
    fallback: effectiveNormalized.fallback,
    reason_codes: effectiveNormalized.reason_codes,
    action: effectiveNormalized.action,
    result: effectiveNormalized.result,
    repair_layer_open_count: effectiveNormalized.repair_layer_open_count,
    repair_layer_blocking: effectiveNormalized.repair_layer_blocking,
    repair_layer_status: effectiveNormalized.repair_layer_status,
    repair_layer_advice: effectiveNormalized.repair_layer_advice,
    repair_primary_reason: effectiveNormalized.repair_primary_reason,
    repair_layer_top_findings: effectiveNormalized.repair_layer_top_findings,
    error: effectiveNormalized.error,
    command: commandLine,
    command_status: result.status ?? 1,
    context_file: contextWrite.context_file,
    raw_file: contextWrite.raw_file,
    history_count: contextWrite.history_count,
    db_sync: dbSync,
    normalized: effectiveNormalized,
  };
  output.summary = buildRunJsonHookSummary(output);
  return output;
}
