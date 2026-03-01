#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    action: "",
    file: ".aidn/runtime/perf/workflow-events.ndjson",
    stateFile: ".aidn/runtime/perf/delivery-window.json",
    runIdFile: ".aidn/runtime/perf/current-run-id.txt",
    target: ".",
    mode: "COMMITTING",
    runId: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--action") {
      args.action = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-file") {
      args.stateFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--run-id-file") {
      args.runIdFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").toUpperCase();
      i += 1;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!["start", "end"].includes(args.action)) {
    throw new Error("Missing or invalid --action. Expected start|end");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/delivery-window.mjs --action start --mode COMMITTING");
  console.log("  node tools/perf/delivery-window.mjs --action end --mode COMMITTING");
  console.log("  node tools/perf/delivery-window.mjs --action start --run-id-file .aidn/runtime/perf/current-run-id.txt");
  console.log("  node tools/perf/delivery-window.mjs --action start --run-id S072-20260301T1012Z");
}

function nowIso() {
  return new Date().toISOString();
}

function compactNow() {
  return nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function getBranch(targetRoot) {
  try {
    const branch = execSync(`git -C "${targetRoot}" branch --show-current`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch || "unknown";
  } catch {
    return "unknown";
  }
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readRunIdFile(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  const text = fs.readFileSync(absolute, "utf8").trim();
  return text || null;
}

function writeJson(filePath, payload) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolute;
}

function appendEvent(filePath, payload) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.appendFileSync(absolute, `${JSON.stringify(payload)}\n`, "utf8");
  return absolute;
}

function toMs(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function makeEvent({
  runId,
  mode,
  branch,
  phase,
  event,
  durationMs,
  reasonCode = null,
}) {
  return {
    ts: nowIso(),
    run_id: runId,
    session_id: null,
    cycle_id: null,
    branch,
    mode,
    skill: "delivery-window",
    phase,
    event,
    duration_ms: durationMs,
    files_read_count: 0,
    bytes_read: 0,
    files_written_count: 0,
    bytes_written: 0,
    gates_triggered: [],
    result: "ok",
    reason_code: reasonCode,
    trace_id: `tr-${crypto.randomBytes(4).toString("hex")}`,
    control: false,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const branch = getBranch(targetRoot);
    const linkedRunId = readRunIdFile(args.runIdFile);
    const resolvedRunId = args.runId || linkedRunId || `delivery-${compactNow()}`;
    const statePath = path.resolve(process.cwd(), args.stateFile);

    if (args.action === "start") {
      const startState = {
        run_id: resolvedRunId,
        started_at: nowIso(),
        target_root: targetRoot,
        branch,
        mode: args.mode,
      };
      const saved = writeJson(statePath, startState);
      const event = makeEvent({
        runId: startState.run_id,
        mode: startState.mode,
        branch: startState.branch,
        phase: "start",
        event: "delivery_window_start",
        durationMs: 0,
      });
      const eventFile = appendEvent(args.file, event);
      console.log(`Delivery window started.`);
      console.log(`run_id: ${startState.run_id}`);
      console.log(`state: ${saved}`);
      console.log(`event: ${eventFile}`);
      return;
    }

    const state = readJsonSafe(statePath);
    if (!state || !state.started_at || !state.run_id) {
      throw new Error("No active delivery window. Start one first with --action start");
    }
    const startedMs = toMs(state.started_at);
    if (startedMs == null) {
      throw new Error("Invalid delivery window start timestamp");
    }

    const durationMs = Math.max(0, Date.now() - startedMs);
    const event = makeEvent({
      runId: state.run_id,
      mode: state.mode ?? args.mode,
      branch: state.branch ?? branch,
      phase: "end",
      event: "delivery_window_end",
      durationMs,
    });
    const eventFile = appendEvent(args.file, event);
    fs.rmSync(statePath, { force: true });

    console.log(`Delivery window ended.`);
    console.log(`run_id: ${state.run_id}`);
    console.log(`duration_ms: ${durationMs}`);
    console.log(`event: ${eventFile}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
