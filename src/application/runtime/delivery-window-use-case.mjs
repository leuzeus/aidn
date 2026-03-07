import fs from "node:fs";
import crypto from "node:crypto";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import {
  appendRuntimeNdjsonEvent,
  resolveRuntimeTargetPath,
  writeRuntimeJsonFile,
} from "./runtime-path-service.mjs";

function nowIso() {
  return new Date().toISOString();
}

function compactNow() {
  return nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
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
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text || null;
}

function toMs(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function makeDeliveryEvent({
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

export function runDeliveryWindowUseCase({ args, targetRoot }) {
  const gitAdapter = createLocalGitAdapter();
  const eventFilePath = resolveRuntimeTargetPath(targetRoot, args.file);
  const stateFilePath = resolveRuntimeTargetPath(targetRoot, args.stateFile);
  const runIdFilePath = resolveRuntimeTargetPath(targetRoot, args.runIdFile);
  const branch = gitAdapter.getCurrentBranch(targetRoot);
  const linkedRunId = readRunIdFile(runIdFilePath);
  const resolvedRunId = args.runId || linkedRunId || `delivery-${compactNow()}`;

  if (args.action === "start") {
    const startState = {
      run_id: resolvedRunId,
      started_at: nowIso(),
      target_root: targetRoot,
      branch,
      mode: args.mode,
    };
    const saved = writeRuntimeJsonFile(stateFilePath, startState);
    const event = makeDeliveryEvent({
      runId: startState.run_id,
      mode: startState.mode,
      branch: startState.branch,
      phase: "start",
      event: "delivery_window_start",
      durationMs: 0,
    });
    const eventFile = appendRuntimeNdjsonEvent(eventFilePath, event);
    return {
      action: "start",
      run_id: startState.run_id,
      state_file: saved,
      event_file: eventFile,
    };
  }

  const state = readJsonSafe(stateFilePath);
  if (!state || !state.started_at || !state.run_id) {
    throw new Error("No active delivery window. Start one first with --action start");
  }
  const startedMs = toMs(state.started_at);
  if (startedMs == null) {
    throw new Error("Invalid delivery window start timestamp");
  }

  const durationMs = Math.max(0, Date.now() - startedMs);
  const event = makeDeliveryEvent({
    runId: state.run_id,
    mode: state.mode ?? args.mode,
    branch: state.branch ?? branch,
    phase: "end",
    event: "delivery_window_end",
    durationMs,
  });
  const eventFile = appendRuntimeNdjsonEvent(eventFilePath, event);
  fs.rmSync(stateFilePath, { force: true });
  return {
    action: "end",
    run_id: state.run_id,
    duration_ms: durationMs,
    event_file: eventFile,
    state_file_removed: true,
  };
}
