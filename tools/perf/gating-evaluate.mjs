#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { readAidnProjectConfig, resolveConfigStateMode } from "../aidn-config-lib.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    cache: ".aidn/runtime/cache/reload-state.json",
    eventFile: ".aidn/runtime/perf/workflow-events.ndjson",
    indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
    stateMode: envStateMode || "files",
    stateModeExplicit: false,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    indexBackend: "auto",
    thresholdFiles: 3,
    thresholdMinutes: 45,
    mode: "COMMITTING",
    runId: "",
    reloadDecision: "",
    reloadFallback: "",
    reloadReasonCodes: "",
    emitEvent: true,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--cache") {
      args.cache = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--event-file") {
      args.eventFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-sync-check-file") {
      args.indexSyncCheckFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").toLowerCase();
      args.stateModeExplicit = true;
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--index-backend") {
      args.indexBackend = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--threshold-files") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--threshold-files must be an integer");
      }
      args.thresholdFiles = Number(raw);
    } else if (token === "--threshold-minutes") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--threshold-minutes must be an integer");
      }
      args.thresholdMinutes = Number(raw);
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").toUpperCase();
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--reload-decision") {
      args.reloadDecision = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--reload-fallback") {
      args.reloadFallback = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--reload-reason-codes") {
      args.reloadReasonCodes = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--no-emit-event") {
      args.emitEvent = false;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.eventFile) {
    throw new Error("Missing value for --event-file");
  }
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid --state-mode. Expected files|dual|db-only");
  }
  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  if (!["auto", "json", "sqlite"].includes(args.indexBackend)) {
    throw new Error("Invalid --index-backend. Expected auto|json|sqlite");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  if (args.reloadDecision && !["incremental", "full", "stop"].includes(args.reloadDecision)) {
    throw new Error("Invalid --reload-decision. Expected incremental|full|stop");
  }
  if (args.reloadFallback && !["true", "false"].includes(args.reloadFallback)) {
    throw new Error("Invalid --reload-fallback. Expected true|false");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/gating-evaluate.mjs --target ../client");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --mode COMMITTING");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --index-sync-check-file .aidn/runtime/index/index-sync-check.json");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --state-mode db-only --index-file .aidn/runtime/index/workflow-index.sqlite");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --run-id S072-20260301T1012Z");
  console.log("  node tools/perf/gating-evaluate.mjs --target ../client --reload-decision incremental --reload-fallback false --reload-reason-codes \"\"");
  console.log("  node tools/perf/gating-evaluate.mjs --json");
}

function parseReloadReasonCodes(value) {
  if (!value) {
    return [];
  }
  if (value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter((item) => item.length > 0);
      }
    } catch {
      // fall back to comma-separated parsing
    }
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function runReloadCheck(targetRoot, cachePath, stateMode, indexFile, indexBackend) {
  const command = [
    path.join(PERF_DIR, "reload-check.mjs"),
    "--target",
    targetRoot,
    "--cache",
    cachePath,
    "--state-mode",
    stateMode,
    "--index-file",
    indexFile,
    "--index-backend",
    indexBackend,
    "--json",
  ];
  const stdout = execFileSync(process.execPath, command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function readTextSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseKeyValues(content) {
  const out = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
    out[key] = match[2].trim();
  }
  return out;
}

function getLatestFileByPattern(dirPath, regex) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }
  const files = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && regex.test(entry.name))
    .map((entry) => path.join(dirPath, entry.name));
  if (files.length === 0) {
    return null;
  }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

function extractSessionObjective(sessionPath) {
  if (!sessionPath || !fs.existsSync(sessionPath)) {
    return null;
  }
  const text = readTextSafe(sessionPath);
  const kv = parseKeyValues(text);
  if (kv.session_objective) {
    return kv.session_objective;
  }
  if (kv.objective) {
    return kv.objective;
  }
  const headingMatch = text.match(/##\s*Session Objective[\s\S]*?(?:\n-|\n\*|\n\d+\.)\s*(.+)/i);
  if (headingMatch) {
    return headingMatch[1].trim();
  }
  return null;
}

function parseStatusMeta(statusPath) {
  const text = readTextSafe(statusPath);
  const kv = parseKeyValues(text);
  return {
    state: (kv.state ?? "UNKNOWN").toUpperCase(),
    currentGoal: kv.current_goal ?? null,
  };
}

function getActiveCycleGoal(targetRoot) {
  const cyclesRoot = path.join(targetRoot, "docs", "audit", "cycles");
  if (!fs.existsSync(cyclesRoot)) {
    return null;
  }
  const statusFiles = [];
  const cycleDirs = fs.readdirSync(cyclesRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dirent of cycleDirs) {
    const statusPath = path.join(cyclesRoot, dirent.name, "status.md");
    if (fs.existsSync(statusPath)) {
      statusFiles.push(statusPath);
    }
  }
  if (statusFiles.length === 0) {
    return null;
  }

  const active = [];
  for (const filePath of statusFiles) {
    const meta = parseStatusMeta(filePath);
    if (meta.state === "OPEN" || meta.state === "IMPLEMENTING" || meta.state === "VERIFYING") {
      active.push({
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
        currentGoal: meta.currentGoal,
      });
    }
  }
  if (active.length === 0) {
    return null;
  }
  active.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return active[0].currentGoal ?? null;
}

function getChangedFiles(targetRoot) {
  const changed = new Set();
  try {
    const statusOutput = execSync(`git -C "${targetRoot}" status --porcelain --untracked-files=no`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!statusOutput) {
      return [];
    }
    for (const line of statusOutput.split(/\r?\n/)) {
      if (line.length < 4) {
        continue;
      }
      const payload = line.slice(3).trim();
      if (!payload) {
        continue;
      }
      const renamed = payload.match(/^(.*)\s->\s(.*)$/);
      if (renamed) {
        changed.add(renamed[2].trim());
      } else {
        changed.add(payload);
      }
    }
  } catch {
    // ignore and keep best-effort result
  }
  return Array.from(changed).sort((a, b) => a.localeCompare(b));
}

function readEventSignalStats(filePath, options = {}) {
  const {
    includeDrift = true,
    includeFallback = true,
  } = options;
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return {
      latestDriftMs: null,
      fallbackRecentCount: 0,
    };
  }
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/);
  let latestDriftMs = null;
  let fallbackRecentCount = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    const mightBeDrift = includeDrift && line.includes("\"skill\":\"drift-check\"");
    const mightBeFallback = includeFallback
      && line.includes("\"skill\":\"reload-check\"")
      && line.includes("\"result\":\"fallback\"");
    if (!mightBeDrift && !mightBeFallback) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      const skill = String(event.skill ?? "");
      if (includeDrift && skill === "drift-check") {
        const eventMs = toTimestampMs(event.ts);
        if (eventMs != null && (latestDriftMs == null || eventMs > latestDriftMs)) {
          latestDriftMs = eventMs;
        }
      }
      if (includeFallback && skill === "reload-check" && String(event.result ?? "") === "fallback") {
        fallbackRecentCount += 1;
      }
    } catch {
      // ignore malformed line
    }
  }
  return {
    latestDriftMs,
    fallbackRecentCount,
  };
}

function readJsonOptional(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return { exists: false, absolute, data: null };
  }
  try {
    return { exists: true, absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch {
    return { exists: true, absolute, data: null };
  }
}

function toTimestampMs(iso) {
  const ms = Date.parse(String(iso ?? ""));
  return Number.isNaN(ms) ? null : ms;
}

function detectSignals(targetRoot, args, reloadResult) {
  const sessionsRoot = path.join(targetRoot, "docs", "audit", "sessions");
  const latestSession = getLatestFileByPattern(sessionsRoot, /^S\d+.*\.md$/i);
  const sessionObjective = extractSessionObjective(latestSession);
  const cycleGoal = getActiveCycleGoal(targetRoot);
  const changedFiles = getChangedFiles(targetRoot);

  const signal = {
    objective_delta: false,
    scope_growth: false,
    cross_domain_touch: false,
    time_since_last_drift_check: false,
    uncertain_intent: false,
    structure_mixed: false,
    index_sync_drift: false,
  };
  const noChangeFastPath = reloadResult.decision === "incremental"
    && reloadResult.fallback !== true
    && Array.isArray(reloadResult.reason_codes)
    && reloadResult.reason_codes.length === 0
    && changedFiles.length === 0;

  if (!noChangeFastPath && sessionObjective && cycleGoal) {
    const left = sessionObjective.toLowerCase().trim();
    const right = cycleGoal.toLowerCase().trim();
    signal.objective_delta = left !== right && !left.includes(right) && !right.includes(left);
  }

  if (!noChangeFastPath) {
    signal.scope_growth = changedFiles.length > args.thresholdFiles;
    signal.cross_domain_touch = changedFiles.some((file) =>
      /(db|database|schema|migration|auth|security|api)/i.test(file),
    );
  }
  const eventStats = readEventSignalStats(args.eventFile, {
    includeDrift: !noChangeFastPath && args.mode === "COMMITTING",
    includeFallback: true,
  });
  const latestDrift = eventStats.latestDriftMs;

  if (!noChangeFastPath && args.mode === "COMMITTING") {
    if (latestDrift == null) {
      signal.time_since_last_drift_check = true;
    } else {
      const elapsedMinutes = (Date.now() - latestDrift) / (1000 * 60);
      signal.time_since_last_drift_check = elapsedMinutes > args.thresholdMinutes;
    }
  }

  if (!noChangeFastPath) {
    signal.uncertain_intent = !sessionObjective || sessionObjective.trim().length < 15;
    signal.structure_mixed = (reloadResult.reason_codes ?? []).some((code) =>
      code === "STRUCTURE_MIXED_PROFILE" || code === "STRUCTURE_PROFILE_UNKNOWN" || code === "DECLARED_VERSION_STALE",
    );
  }
  const indexSyncCheck = readJsonOptional(args.indexSyncCheckFile);
  const indexSyncPayload = indexSyncCheck.data;
  const indexSyncInSync = indexSyncPayload?.in_sync === true;
  const indexSyncTargetRoot = typeof indexSyncPayload?.target_root === "string"
    ? path.resolve(indexSyncPayload.target_root)
    : null;
  const indexSyncTargetMatch = indexSyncTargetRoot === targetRoot;
  signal.index_sync_drift = indexSyncCheck.exists && indexSyncTargetMatch && !indexSyncInSync;

  const activeSignals = Object.entries(signal)
    .filter(([, active]) => active)
    .map(([name]) => name);

  const criticalSignals = activeSignals.filter((name) =>
    name === "cross_domain_touch"
      || name === "index_sync_drift"
      || (name === "scope_growth" && args.mode === "COMMITTING"),
  );

  const fallbackRecentCount = eventStats.fallbackRecentCount;

  const level1 = {
    decision: reloadResult.decision,
    fallback: reloadResult.fallback,
    reason_codes: reloadResult.reason_codes ?? [],
  };

  const level2 = {
    required: activeSignals.length > 0,
    active_signals: activeSignals,
    critical_signals: criticalSignals,
      changed_files_count: changedFiles.length,
      changed_files_sample: changedFiles.slice(0, 20),
      index_sync_check_file: indexSyncCheck.absolute,
      index_sync_check_exists: indexSyncCheck.exists,
      index_sync_target_match: indexSyncTargetMatch,
      index_sync_in_sync: indexSyncInSync,
    };

  const hasBlockingReason = level1.reason_codes.some((code) =>
    code === "MAPPING_AMBIGUOUS" || code === "MAPPING_MISSING" || code === "REQUIRED_ARTIFACT_MISSING",
  );

  const level3 = {
    required: hasBlockingReason
      || fallbackRecentCount >= 3
      || (indexSyncTargetMatch && indexSyncPayload?.drift_level === "high"),
    reason: hasBlockingReason
      ? "blocking_l1_reason"
      : (fallbackRecentCount >= 3
        ? "repeated_fallbacks"
        : (indexSyncTargetMatch && indexSyncPayload?.drift_level === "high" ? "index_sync_high_drift" : null)),
    fallback_recent_count: fallbackRecentCount,
    index_sync_drift_level: indexSyncPayload?.drift_level ?? null,
  };

  return { level1, level2, level3 };
}

function deriveAction(levels) {
  if (levels.level3.required) {
    return {
      action: "stop_and_triage_incident",
      result: "stop",
      gates_triggered: ["R10"],
      reason_code: levels.level3.reason === "blocking_l1_reason"
        ? "L3_BLOCKING"
        : (levels.level3.reason === "index_sync_high_drift" ? "L3_INDEX_SYNC_DRIFT" : "L3_REPEATED_FALLBACK"),
    };
  }
  if (levels.level2.required) {
    return {
      action: "run_conditional_drift_check",
      result: "warn",
      gates_triggered: ["R05"],
      reason_code: "L2_SIGNAL_TRIGGERED",
    };
  }
  return {
    action: "proceed_l1_fast_checks_only",
    result: "ok",
    gates_triggered: ["R03", "R04"],
    reason_code: null,
  };
}

function appendEvent(eventFile, payload) {
  const absolute = path.resolve(process.cwd(), eventFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.appendFileSync(absolute, `${JSON.stringify(payload)}\n`, "utf8");
  return absolute;
}

function compactRunStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "");
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function getCurrentBranch(targetRoot) {
  try {
    return execSync(`git -C "${targetRoot}" branch --show-current`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function printHuman(result) {
  console.log(`Action: ${result.action}`);
  console.log(`Result: ${result.result}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`L1 decision: ${result.levels.level1.decision}`);
  console.log(`L1 reasons: ${result.levels.level1.reason_codes.length ? result.levels.level1.reason_codes.join(", ") : "none"}`);
  console.log(`L2 required: ${result.levels.level2.required ? "yes" : "no"}`);
  if (result.levels.level2.active_signals.length) {
    console.log(`L2 signals: ${result.levels.level2.active_signals.join(", ")}`);
  }
  console.log(`L3 required: ${result.levels.level3.required ? "yes" : "no"}`);
  if (result.levels.level3.reason) {
    console.log(`L3 reason: ${result.levels.level3.reason}`);
  }
}

function main() {
  const started = Date.now();
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    args.cache = resolveTargetPath(targetRoot, args.cache);
    args.eventFile = resolveTargetPath(targetRoot, args.eventFile);
    args.indexSyncCheckFile = resolveTargetPath(targetRoot, args.indexSyncCheckFile);
    if (!args.stateModeExplicit && !String(process.env.AIDN_STATE_MODE ?? "").trim()) {
      const config = readAidnProjectConfig(targetRoot);
      const configStateMode = resolveConfigStateMode(config.data);
      if (configStateMode) {
        args.stateMode = configStateMode;
      }
    }
    if (!["files", "dual", "db-only"].includes(args.stateMode)) {
      throw new Error("Invalid effective state mode. Expected files|dual|db-only");
    }
    if (args.stateMode !== "files") {
      args.indexFile = resolveTargetPath(targetRoot, args.indexFile);
    }
    let reload = null;
    if (args.reloadDecision) {
      reload = {
        decision: args.reloadDecision,
        fallback: args.reloadFallback === "true",
        reason_codes: parseReloadReasonCodes(args.reloadReasonCodes),
      };
    } else {
      reload = runReloadCheck(
        targetRoot,
        args.cache,
        args.stateMode,
        args.indexFile,
        args.indexBackend,
      );
    }
    const levels = detectSignals(targetRoot, args, reload);
    const decision = deriveAction(levels);

  const result = {
    ts: new Date().toISOString(),
    mode: args.mode,
    state_mode: args.stateMode,
    target_root: targetRoot,
    branch: getCurrentBranch(targetRoot),
    action: decision.action,
    result: decision.result,
    reason_code: decision.reason_code,
    gates_triggered: decision.gates_triggered,
    levels,
    duration_ms: Date.now() - started,
  };

    if (args.emitEvent) {
      const eventPayload = {
        ts: result.ts,
        run_id: args.runId || `gate-${compactRunStamp()}`,
        session_id: null,
        cycle_id: null,
        branch: result.branch,
        mode: result.mode,
        skill: "gating-evaluate",
        phase: "end",
        event: "gating_summary",
        duration_ms: result.duration_ms,
        files_read_count: 0,
        bytes_read: 0,
        files_written_count: 0,
        bytes_written: 0,
        gates_triggered: decision.gates_triggered,
        result: decision.result === "warn" ? "warn" : decision.result,
        reason_code: decision.reason_code,
        trace_id: `tr-${crypto.randomBytes(4).toString("hex")}`,
      };
      result.event_file = appendEvent(args.eventFile, eventPayload);
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printHuman(result);
    if (result.event_file) {
      console.log(`Event file: ${result.event_file}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
