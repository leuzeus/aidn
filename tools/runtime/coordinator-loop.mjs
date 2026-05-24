#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readSharedCoordinationRecords, resolveSharedCoordinationStore } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { evaluateCoordinatorEscalation } from "../../src/core/agents/coordinator-escalation-policy.mjs";
import {
  buildArbitrationRecommendation,
  buildEscalationRecommendation,
  buildFailureRecoveryRecommendation,
  buildRepeatRecoveryRecommendation,
  deriveCoordinatorLoopDiagnostic,
  deriveSummaryAlignment,
  parseCoordinationSummary,
  sameRecommendation,
  summarizeHistory,
} from "../../src/application/runtime/coordinator-loop-use-case.mjs";
import { computeCoordinatorNextAction } from "./coordinator-next-action.mjs";
import {
  loadSqliteIndexPayloadSafe,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "./db-first-runtime-view-lib.mjs";

const FAILURE_STATUSES = new Set(["failed", "unsupported", "no_steps"]);

function parseArgs(argv) {
  const args = {
    target: ".",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    historyFile: ".aidn/runtime/context/coordination-history.ndjson",
    summaryFile: "docs/audit/COORDINATION-SUMMARY.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--history-file") {
      args.historyFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--summary-file") {
      args.summaryFile = String(argv[i + 1] ?? "").trim();
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
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-loop.mjs --target .");
  console.log("  node tools/runtime/coordinator-loop.mjs --target tests/fixtures/repo-installed-core --json");
}

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function readTextIfExists(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readNdjson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry && typeof entry === "object");
}

function mapCoordinationRecordToEvent(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const payload = record.payload && typeof record.payload === "object"
    ? record.payload
    : {};
  return {
    ts: normalizeScalar(payload.ts || record.created_at || "unknown") || "unknown",
    event: normalizeScalar(payload.event || record.record_type || "coordinator_dispatch") || "coordinator_dispatch",
    selected_agent: normalizeScalar(payload.selected_agent || "unknown") || "unknown",
    recommended_role: normalizeScalar(payload.recommended_role || record.actor_role || "unknown") || "unknown",
    recommended_action: normalizeScalar(payload.recommended_action || record.actor_action || "unknown") || "unknown",
    goal: normalizeScalar(payload.goal || "unknown") || "unknown",
    dispatch_status: normalizeScalar(payload.dispatch_status || "unknown") || "unknown",
    execution_status: normalizeScalar(payload.execution_status || record.status || "unknown") || "unknown",
    stop_required: Boolean(payload.stop_required),
    decision: normalizeScalar(payload.decision || "unknown") || "unknown",
    note: normalizeScalar(payload.note || "unknown") || "unknown",
  };
}


export async function computeCoordinatorLoopState({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  historyFile = ".aidn/runtime/context/coordination-history.ndjson",
  summaryFile = "docs/audit/COORDINATION-SUMMARY.md",
  workspace = null,
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const nextAction = await computeCoordinatorNextAction({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    workspace: effectiveWorkspace,
    sharedCoordination,
    sharedCoordinationOptions,
  });
  const { dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafe(absoluteTargetRoot) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const historyPath = resolveTargetPath(absoluteTargetRoot, historyFile);
  const summaryPath = resolveTargetPath(absoluteTargetRoot, summaryFile);
  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace: effectiveWorkspace,
    ...sharedCoordinationOptions,
  });
  const sharedRecords = await readSharedCoordinationRecords(sharedCoordinationResolution, {
    workspace: effectiveWorkspace,
    limit: 200,
  });
  const summaryResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: summaryFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
  });
  const historyEntries = sharedRecords.ok && Array.isArray(sharedRecords.records) && sharedRecords.records.length > 0
    ? sharedRecords.records.map((record) => mapCoordinationRecordToEvent(record)).filter(Boolean)
    : readNdjson(historyPath);
  const history = summarizeHistory(historyEntries);
  const summary = summaryResolution.exists
    ? parseCoordinationSummary(summaryResolution.text)
    : (sharedRecords.ok && Array.isArray(sharedRecords.records) && sharedRecords.records.length > 0
      ? {
        status: history.history_status,
        total_dispatches: history.total_dispatches,
        last_recommended_role: history.last_dispatch?.recommended_role ?? "unknown",
        last_recommended_action: history.last_dispatch?.recommended_action ?? "unknown",
        last_execution_status: history.last_dispatch?.execution_status ?? "unknown",
      }
      : parseCoordinationSummary(readTextIfExists(summaryPath)));
  const summaryAlignment = deriveSummaryAlignment(summary, history);

  let recommendation = { ...nextAction.recommendation };
  let loopStatus = history.total_dispatches === 0 ? "history_empty" : "steady";
  const loopReasons = [];

  if (history.arbitration_applied && history.last_arbitration) {
    recommendation = buildArbitrationRecommendation(recommendation, history.last_arbitration);
    loopStatus = "arbitrated";
    loopReasons.push(`user_arbitration_decision=${history.last_arbitration.decision}`);
  } else if (history.last_dispatch && FAILURE_STATUSES.has(normalizeScalar(history.last_dispatch.execution_status).toLowerCase())) {
    recommendation = buildFailureRecoveryRecommendation(history.last_dispatch);
    loopStatus = "reanchor_after_failure";
    loopReasons.push(`latest execution_status=${history.last_dispatch.execution_status}`);
  } else if (history.repeated_dispatch_count >= 3 && sameRecommendation(history.last_dispatch, recommendation)) {
    recommendation = buildRepeatRecoveryRecommendation(recommendation, history.repeated_dispatch_count);
    loopStatus = "repeat_detected";
    loopReasons.push(`repeated_dispatch_count=${history.repeated_dispatch_count}`);
  } else if (recommendation.stop_required === true) {
    loopStatus = "gated";
    loopReasons.push("current recommendation requires a stop gate");
  }

  if (summaryAlignment.status === "mismatch" || summaryAlignment.status === "missing") {
    loopReasons.push(summaryAlignment.reason);
  }

  const escalation = evaluateCoordinatorEscalation({
    recommendation,
    loopStatus,
    history,
    summaryAlignment,
  });
  if (escalation.level === "user_arbitration_required") {
    recommendation = buildEscalationRecommendation(escalation);
    loopReasons.push(escalation.reason);
  } else if (escalation.level === "watch") {
    loopReasons.push(escalation.reason);
  }

  if (!canAgentRolePerform(recommendation.role, recommendation.action)) {
    throw new Error(`Invalid coordinator loop recommendation: role=${recommendation.role} action=${recommendation.action}`);
  }

  return {
    target_root: absoluteTargetRoot,
    current_state_file: nextAction.current_state_file,
    runtime_state_file: nextAction.runtime_state_file,
    packet_file: nextAction.packet_file,
    history_file: historyPath,
    summary_file: summaryResolution.exists ? summaryResolution.logicalPath : summaryPath,
    handoff: nextAction.handoff,
    scope: nextAction.scope,
    context: nextAction.context,
    base_recommendation: nextAction.recommendation,
    recommendation,
    loop: {
      status: loopStatus,
      reasons: loopReasons,
      history,
      history_source: sharedRecords.ok && Array.isArray(sharedRecords.records) && sharedRecords.records.length > 0
        ? "shared-coordination"
        : "coordination-history",
      summary,
      summary_source: summaryResolution.exists
        ? summaryResolution.source
        : (sharedRecords.ok && Array.isArray(sharedRecords.records) && sharedRecords.records.length > 0 ? "shared-coordination" : "missing"),
      summary_alignment: summaryAlignment,
      escalation,
    },
    coordinator_loop_diagnostic: deriveCoordinatorLoopDiagnostic({
      recommendation,
      loop: {
        status: loopStatus,
        history,
        summary_alignment: summaryAlignment,
        escalation,
      },
    }),
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await computeCoordinatorLoopState({
      targetRoot: args.target,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      packetFile: args.packetFile,
      historyFile: args.historyFile,
      summaryFile: args.summaryFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator loop:");
      console.log(`- loop_status=${result.loop.status}`);
      console.log(`- role=${result.recommendation.role}`);
      console.log(`- action=${result.recommendation.action}`);
      console.log(`- goal=${result.recommendation.goal}`);
      console.log(`- history_status=${result.loop.history.history_status}`);
      console.log(`- repeated_dispatch_count=${result.loop.history.repeated_dispatch_count}`);
      console.log(`- summary_alignment=${result.loop.summary_alignment.status}`);
      console.log(`- escalation=${result.loop.escalation.status}:${result.loop.escalation.level}`);
    }
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
