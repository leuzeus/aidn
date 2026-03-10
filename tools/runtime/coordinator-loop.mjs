#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { evaluateCoordinatorEscalation } from "../../src/core/agents/coordinator-escalation-policy.mjs";
import { computeCoordinatorNextAction } from "./coordinator-next-action.mjs";

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

function readTextIfExists(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    map.set(match[1], normalizeScalar(match[2]));
  }
  return map;
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

function sameDispatchIdentity(left, right) {
  return normalizeScalar(left?.recommended_role) === normalizeScalar(right?.recommended_role)
    && normalizeScalar(left?.recommended_action) === normalizeScalar(right?.recommended_action)
    && normalizeScalar(left?.goal) === normalizeScalar(right?.goal);
}

function sameRecommendation(entry, recommendation) {
  return normalizeScalar(entry?.recommended_role) === normalizeScalar(recommendation?.role)
    && normalizeScalar(entry?.recommended_action) === normalizeScalar(recommendation?.action)
    && normalizeScalar(entry?.goal) === normalizeScalar(recommendation?.goal);
}

function summarizeHistory(entries) {
  const dispatchEntries = entries.filter((entry) => normalizeScalar(entry?.event || "coordinator_dispatch") === "coordinator_dispatch");
  const arbitrationEntries = entries.filter((entry) => normalizeScalar(entry?.event) === "user_arbitration");
  const total = dispatchEntries.length;
  const last = total > 0 ? dispatchEntries[total - 1] : null;
  const lastArbitration = arbitrationEntries.length > 0 ? arbitrationEntries[arbitrationEntries.length - 1] : null;
  let repeatedDispatchCount = 0;
  if (last) {
    for (let index = dispatchEntries.length - 1; index >= 0; index -= 1) {
      if (!sameDispatchIdentity(dispatchEntries[index], last)) {
        break;
      }
      repeatedDispatchCount += 1;
    }
  }
  const recentFailureCount = dispatchEntries
    .slice(-5)
    .filter((entry) => FAILURE_STATUSES.has(normalizeScalar(entry?.execution_status).toLowerCase()))
    .length;
  const lastDispatchTs = Date.parse(String(last?.ts ?? ""));
  const lastArbitrationTs = Date.parse(String(lastArbitration?.ts ?? ""));
  const arbitrationApplied = Boolean(lastArbitration)
    && (Number.isNaN(lastDispatchTs) || (!Number.isNaN(lastArbitrationTs) && lastArbitrationTs >= lastDispatchTs));
  return {
    total_dispatches: total,
    last_dispatch: last
      ? {
        ts: normalizeScalar(last.ts || "unknown") || "unknown",
        recommended_role: normalizeScalar(last.recommended_role || "unknown") || "unknown",
        recommended_action: normalizeScalar(last.recommended_action || "unknown") || "unknown",
        goal: normalizeScalar(last.goal || "unknown") || "unknown",
        dispatch_status: normalizeScalar(last.dispatch_status || "unknown") || "unknown",
        execution_status: normalizeScalar(last.execution_status || "unknown") || "unknown",
        stop_required: Boolean(last.stop_required),
      }
      : null,
    repeated_dispatch_count: repeatedDispatchCount,
    recent_failure_count: recentFailureCount,
    history_status: total > 0 ? "available" : "empty",
    total_arbitrations: arbitrationEntries.length,
    last_arbitration: lastArbitration
      ? {
        ts: normalizeScalar(lastArbitration.ts || "unknown") || "unknown",
        decision: normalizeScalar(lastArbitration.decision || "unknown") || "unknown",
        note: normalizeScalar(lastArbitration.note || "unknown") || "unknown",
        goal: normalizeScalar(lastArbitration.goal || "") || "",
      }
      : null,
    arbitration_applied: arbitrationApplied,
  };
}

function parseCoordinationSummary(text) {
  if (!String(text).trim()) {
    return {
      status: "missing",
      total_dispatches: null,
      last_recommended_role: "unknown",
      last_recommended_action: "unknown",
      last_execution_status: "unknown",
    };
  }
  const map = parseSimpleMap(text);
  return {
    status: normalizeScalar(map.get("history_status") ?? "unknown") || "unknown",
    total_dispatches: parseInteger(map.get("total_dispatches")),
    last_recommended_role: normalizeScalar(map.get("last_recommended_role") ?? "unknown") || "unknown",
    last_recommended_action: normalizeScalar(map.get("last_recommended_action") ?? "unknown") || "unknown",
    last_execution_status: normalizeScalar(map.get("last_execution_status") ?? "unknown") || "unknown",
  };
}

function deriveSummaryAlignment(summary, history) {
  if (summary.status === "missing") {
    return {
      status: history.total_dispatches === 0 ? "not_required" : "missing",
      reason: history.total_dispatches === 0
        ? "no coordination history exists yet"
        : "coordination summary is missing while history entries exist",
    };
  }
  if (Number.isInteger(summary.total_dispatches) && summary.total_dispatches !== history.total_dispatches) {
    return {
      status: "mismatch",
      reason: `summary.total_dispatches=${summary.total_dispatches} history.total_dispatches=${history.total_dispatches}`,
    };
  }
  if (history.last_dispatch
    && (summary.last_recommended_role !== history.last_dispatch.recommended_role
      || summary.last_recommended_action !== history.last_dispatch.recommended_action
      || summary.last_execution_status !== history.last_dispatch.execution_status)) {
    return {
      status: "mismatch",
      reason: "summary last dispatch fields are not aligned with coordination history",
    };
  }
  return {
    status: "aligned",
    reason: "summary fields are aligned with coordination history",
  };
}

function buildFailureRecoveryRecommendation(lastDispatch) {
  const failedRole = normalizeScalar(lastDispatch?.recommended_role || "unknown") || "unknown";
  const failedAction = normalizeScalar(lastDispatch?.recommended_action || "unknown") || "unknown";
  const failedStatus = normalizeScalar(lastDispatch?.execution_status || "unknown") || "unknown";
  return {
    role: "coordinator",
    action: "reanchor",
    goal: `reanchor after ${failedStatus} relay for ${failedRole} + ${failedAction}`,
    source: "coordination-history",
    reason: "the latest coordinator dispatch did not complete successfully",
    stop_required: false,
  };
}

function buildRepeatRecoveryRecommendation(recommendation, repeatCount) {
  return {
    role: "coordinator",
    action: "coordinate",
    goal: `review repeated relay loop before rerunning ${recommendation.role} + ${recommendation.action}`,
    source: "coordination-history",
    reason: `the same relay was selected ${repeatCount} times in a row`,
    stop_required: false,
  };
}

function buildEscalationRecommendation(escalation) {
  return {
    role: "coordinator",
    action: "coordinate",
    goal: "request user arbitration before another coordinator dispatch",
    source: "coordination-escalation",
    reason: escalation.reason,
    stop_required: true,
  };
}

function buildArbitrationRecommendation(baseRecommendation, arbitration) {
  const decision = normalizeScalar(arbitration?.decision || "unknown");
  const goalOverride = normalizeScalar(arbitration?.goal || "");
  if (decision === "reanchor") {
    return {
      role: "coordinator",
      action: "reanchor",
      goal: goalOverride || "reanchor current session, cycle, and runtime facts before continuing",
      source: "user_arbitration",
      reason: "user arbitration redirected the loop to reanchor",
      stop_required: false,
    };
  }
  if (decision === "repair") {
    return {
      role: "repair",
      action: "repair",
      goal: goalOverride || "resume with repair-first routing after user arbitration",
      source: "user_arbitration",
      reason: "user arbitration redirected the loop to repair",
      stop_required: true,
    };
  }
  if (decision === "audit") {
    return {
      role: "auditor",
      action: "audit",
      goal: goalOverride || "run an audit pass after user arbitration",
      source: "user_arbitration",
      reason: "user arbitration redirected the loop to audit",
      stop_required: false,
    };
  }
  if (decision === "integration_cycle") {
    return {
      role: "coordinator",
      action: "coordinate",
      goal: goalOverride || "open a dedicated integration cycle for the candidate session cycles",
      source: "user_arbitration",
      reason: "user arbitration selected an explicit integration vehicle",
      stop_required: false,
    };
  }
  if (decision === "report_forward") {
    return {
      role: "coordinator",
      action: "coordinate",
      goal: goalOverride || "report the candidate cycles forward instead of integrating them now",
      source: "user_arbitration",
      reason: "user arbitration deferred the integration path",
      stop_required: false,
    };
  }
  if (decision === "rework_from_example") {
    return {
      role: "coordinator",
      action: "coordinate",
      goal: goalOverride || "open a dedicated integration vehicle and replay the selected cycles from example",
      source: "user_arbitration",
      reason: "user arbitration chose replay-based integration over mechanical merge",
      stop_required: false,
    };
  }
  return {
    ...baseRecommendation,
    goal: goalOverride || baseRecommendation.goal,
    source: "user_arbitration",
    reason: "user arbitration explicitly allowed the next relay to continue",
  };
}

export function computeCoordinatorLoopState({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  historyFile = ".aidn/runtime/context/coordination-history.ndjson",
  summaryFile = "docs/audit/COORDINATION-SUMMARY.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const nextAction = computeCoordinatorNextAction({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
    runtimeStateFile,
    packetFile,
  });
  const historyPath = resolveTargetPath(absoluteTargetRoot, historyFile);
  const summaryPath = resolveTargetPath(absoluteTargetRoot, summaryFile);
  const history = summarizeHistory(readNdjson(historyPath));
  const summary = parseCoordinationSummary(readTextIfExists(summaryPath));
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
    summary_file: summaryPath,
    handoff: nextAction.handoff,
    scope: nextAction.scope,
    context: nextAction.context,
    base_recommendation: nextAction.recommendation,
    recommendation,
    loop: {
      status: loopStatus,
      reasons: loopReasons,
      history,
      summary,
      summary_alignment: summaryAlignment,
      escalation,
    },
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = computeCoordinatorLoopState({
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
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
