#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigStateMode,
} from "../aidn-config-lib.mjs";
import { normalizeHookPayload } from "./normalize-hook-payload.mjs";
import { persistHookContext } from "./context-store.mjs";

const CODEX_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_SYNC_SCRIPT = path.resolve(CODEX_DIR, "..", "runtime", "sync-db-first-selective.mjs");
const MUTATING_SKILLS = new Set([
  "start-session",
  "close-session",
  "cycle-create",
  "cycle-close",
  "promote-baseline",
  "requirements-delta",
  "convert-to-spike",
]);

function splitArgs(argv) {
  const idx = argv.indexOf("--");
  if (idx < 0) {
    return { options: argv, command: [] };
  }
  return {
    options: argv.slice(0, idx),
    command: argv.slice(idx + 1),
  };
}

function parseArgs(argv) {
  const { options, command } = splitArgs(argv);
  const args = {
    skill: "",
    mode: "",
    target: ".",
    stateMode: "",
    strict: false,
    failOnError: false,
    forceJson: true,
    contextFile: ".aidn/runtime/context/codex-context.json",
    rawDir: ".aidn/runtime/context/raw",
    maxEntries: 50,
    json: false,
    dbSync: null,
    dbSyncExplicit: false,
    command,
  };

  for (let i = 0; i < options.length; i += 1) {
    const token = options[i];
    if (token === "--skill") {
      args.skill = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(options[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--target") {
      args.target = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(options[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--fail-on-error") {
      args.failOnError = true;
    } else if (token === "--no-force-json") {
      args.forceJson = false;
    } else if (token === "--context-file") {
      args.contextFile = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--raw-dir") {
      args.rawDir = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--max-entries") {
      args.maxEntries = Number(options[i + 1] ?? 50);
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--db-sync") {
      args.dbSync = true;
      args.dbSyncExplicit = true;
    } else if (token === "--no-db-sync") {
      args.dbSync = false;
      args.dbSyncExplicit = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.skill) {
    throw new Error("Missing value for --skill");
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!Number.isFinite(args.maxEntries) || args.maxEntries < 1) {
    throw new Error("Invalid --max-entries. Expected a positive integer.");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/codex/run-json-hook.mjs --skill context-reload --mode THINKING --target . --json");
  console.log("  node tools/codex/run-json-hook.mjs --skill context-reload --mode THINKING --target . -- npx aidn perf skill-hook --skill context-reload --target . --mode THINKING --json");
  console.log("  node tools/codex/run-json-hook.mjs --skill branch-cycle-audit --mode COMMITTING --target . --strict --fail-on-error");
  console.log("  node tools/codex/run-json-hook.mjs --skill cycle-create --mode COMMITTING --target . --db-sync --json");
}

function resolveStateMode(targetRoot, cliStateMode) {
  if (cliStateMode) {
    return cliStateMode;
  }
  const envMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envMode) {
    return envMode;
  }
  const config = readAidnProjectConfig(targetRoot);
  return resolveConfigStateMode(config.data) ?? "files";
}

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

function runDbSync(targetRoot, stateMode) {
  const stdout = spawnSync(process.execPath, [
    RUNTIME_SYNC_SCRIPT,
    "--target",
    targetRoot,
    "--state-mode",
    stateMode,
    "--json",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    env: process.env,
    shell: false,
  });
  const payload = parseJsonOutput(stdout.stdout);
  return {
    status: stdout.status ?? 1,
    stdout: stdout.stdout ?? "",
    stderr: stdout.stderr ?? "",
    payload,
  };
}

function runCommand(command, commandArgs, commandLine, envOverrides = {}) {
  const env = {
    ...process.env,
    ...envOverrides,
  };
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env,
      shell: false,
    });
  }
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    env,
    shell: false,
  });
}

function buildErrorPayload(args, targetRoot, stateMode, commandLine, result, parseError) {
  const strictRequiredByState = stateMode === "dual" || stateMode === "db-only";
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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const stateMode = resolveStateMode(targetRoot, args.stateMode);

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
    const result = runCommand(commandSpec.command, commandArgs, commandLine, {
      AIDN_STATE_MODE: stateMode,
    });

    let rawPayload = null;
    let parseError = null;
    try {
      rawPayload = parseJsonOutput(result.stdout);
    } catch (error) {
      parseError = error;
      rawPayload = buildErrorPayload(args, targetRoot, stateMode, commandLine, result, parseError);
    }

    const strictRequiredByState = stateMode === "dual" || stateMode === "db-only";
    const normalized = normalizeHookPayload(rawPayload, {
      skill: args.skill,
      mode: args.mode || undefined,
      stateMode,
      strictRequested: args.strict || strictRequiredByState,
      command: commandLine,
      targetRoot,
    });

    const contextWrite = persistHookContext({
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
      : MUTATING_SKILLS.has(args.skill);
    let dbSync = {
      enabled: false,
      skipped: true,
      reason: "disabled",
      payload: null,
      error: null,
    };
    if (autoDbSync && (stateMode === "dual" || stateMode === "db-only")) {
      dbSync.enabled = true;
      dbSync.skipped = false;
      dbSync.reason = null;
      try {
        const sync = runDbSync(targetRoot, stateMode);
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

    const output = {
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

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      const status = output.ok ? "OK" : "WARN";
      const decision = output.decision ?? output.action ?? output.result ?? "n/a";
      console.log(`Hook context ${status}: skill=${output.skill} mode=${output.mode} state=${output.state_mode} decision=${decision}`);
      console.log(`Context file: ${output.context_file}`);
    }

    const dbSyncFailed = dbSync.enabled && dbSync.error != null;
    const shouldFail = (!output.ok && (args.failOnError || output.strict === true))
      || (dbSyncFailed && output.strict === true);
    if (shouldFail) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
