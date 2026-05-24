#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadRegisteredAgentAdapters } from "../../src/application/runtime/agent-adapter-registry-service.mjs";
import { appendSharedCoordinationRecord, resolveSharedCoordinationStore, summarizeSharedCoordinationResolution } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { runDbFirstArtifactUseCase } from "../../src/application/runtime/db-first-artifact-use-case.mjs";
import { resolveStateMode } from "../../src/application/runtime/db-first-artifact-lib.mjs";
import { deriveCoordinatorDispatchExecuteDiagnostic } from "../../src/application/runtime/coordinator-diagnostics-lib.mjs";
import { deriveGovernedRuntimeArtifactMetadata } from "../../src/application/runtime/governed-runtime-artifact-metadata-lib.mjs";
import { loadAgentRoster } from "../../src/application/runtime/agent-roster-service.mjs";
import { appendRuntimeNdjsonEvent } from "../../src/application/runtime/runtime-path-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import {
  loadSqliteIndexPayloadSafe,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "./db-first-runtime-view-lib.mjs";
import { computeCoordinatorDispatchPlan } from "./coordinator-dispatch-plan.mjs";
import { projectCoordinationSummary } from "./project-coordination-summary.mjs";
import { projectMultiAgentStatus } from "./project-multi-agent-status.mjs";
import {
  buildCoordinationHistoryEvent,
  buildCoordinationLogEntry,
} from "../../src/application/runtime/coordinator-dispatch-execute-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    agent: "auto",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    agentRosterFile: "docs/audit/AGENT-ROSTER.md",
    coordinationLogFile: "docs/audit/COORDINATION-LOG.md",
    coordinationSummaryFile: "docs/audit/COORDINATION-SUMMARY.md",
    multiAgentStatusFile: "docs/audit/MULTI-AGENT-STATUS.md",
    coordinationHistoryFile: ".aidn/runtime/context/coordination-history.ndjson",
    execute: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--agent") {
      args.agent = String(argv[i + 1] ?? "").trim().toLowerCase();
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
    } else if (token === "--agent-roster-file") {
      args.agentRosterFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--coordination-log-file") {
      args.coordinationLogFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--coordination-summary-file") {
      args.coordinationSummaryFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--multi-agent-status-file") {
      args.multiAgentStatusFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--coordination-history-file") {
      args.coordinationHistoryFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--execute") {
      args.execute = true;
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
  if (!args.agent) {
    throw new Error("Missing value for --agent");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-dispatch-execute.mjs --target .");
  console.log("  node tools/runtime/coordinator-dispatch-execute.mjs --target . --execute --json");
}

async function resolveAgentAdapter(agentId, options = {}) {
  const normalizedId = String(agentId ?? "").trim().toLowerCase();
  const adapters = await loadRegisteredAgentAdapters({
    ...options,
    ignoreLoadFailures: true,
  });
  const adapter = adapters
    .find((candidate) => candidate.getProfile().id === normalizedId);
  if (!adapter) {
    throw new Error(`Unsupported agent adapter: ${agentId}`);
  }
  return adapter;
}

function sanitizeOutput(value) {
  return String(value ?? "").trim();
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

function deriveSharedPlanningCandidate(dispatch) {
  const sharedPlanning = dispatch?.shared_planning ?? {};
  const recommendation = dispatch?.coordinator_recommendation ?? {};
  const dispatchScope = String(dispatch?.dispatch_scope?.scope_type ?? "none").trim();
  const nextDispatchScope = String(sharedPlanning.next_dispatch_scope ?? "none").trim();
  const nextDispatchAction = String(sharedPlanning.next_dispatch_action ?? "none").trim();
  const candidateReady = Boolean(sharedPlanning.enabled) && sharedPlanning.dispatch_ready === true;
  const actionAligned = candidateReady && nextDispatchAction !== "none"
    && (
      nextDispatchAction === String(recommendation.action ?? "").trim()
      || (String(recommendation.role ?? "").trim() === "coordinator" && nextDispatchAction === "coordinate")
    );
  const scopeAligned = candidateReady && nextDispatchScope !== "none"
    && (
      nextDispatchScope === dispatchScope
      || (String(recommendation.role ?? "").trim() === "coordinator" && nextDispatchScope === "session")
    );
  const candidateAligned = actionAligned && scopeAligned;
  return {
    enabled: Boolean(sharedPlanning.enabled),
    candidate_ready: candidateReady,
    candidate_aligned: candidateAligned,
    preferred_source: candidateAligned ? "shared_planning" : "workflow",
    next_dispatch_scope: nextDispatchScope,
    next_dispatch_action: nextDispatchAction,
    backlog_next_step: String(sharedPlanning.backlog_next_step ?? "unknown").trim() || "unknown",
  };
}

function buildCoordinationLogSummaryBlock({ updatedAt, governanceMetadata }) {
  const lines = [];
  lines.push("## Summary");
  lines.push("");
  lines.push(`contract_version: ${governanceMetadata.contract_version}`);
  lines.push(`updated_at: ${updatedAt}`);
  lines.push(`source_of_truth: ${governanceMetadata.source_of_truth}`);
  lines.push(`source_mode: ${governanceMetadata.source_mode}`);
  lines.push(`lifecycle_status: ${governanceMetadata.lifecycle_status}`);
  lines.push(`owner: ${governanceMetadata.owner}`);
  lines.push(`steward: ${governanceMetadata.steward}`);
  lines.push("");
  return lines.join("\n");
}

function buildCoordinationLogHeader({ updatedAt, governanceMetadata }) {
  const lines = [];
  lines.push("# Coordination Log");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- record coordinator dispatch decisions and executions");
  lines.push("- keep a short trace of multi-agent routing over time");
  lines.push("- preserve a human-readable coordination trail without redefining workflow rules");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a coordination state log");
  lines.push("- canonical workflow rules remain in `SPEC.md`");
  lines.push("- execution contract remains in `AGENTS.md`");
  lines.push("");
  lines.push(buildCoordinationLogSummaryBlock({ updatedAt, governanceMetadata }));
  lines.push("## Entries");
  lines.push("");
  lines.push("Append one section per explicit coordinator dispatch execution.");
  lines.push("");
  lines.push("Recommended fields:");
  lines.push("");
  lines.push("- timestamp");
  lines.push("- selected agent");
  lines.push("- recommended role/action");
  lines.push("- dispatch status");
  lines.push("- execution status");
  lines.push("- entrypoint");
  lines.push("- key notes");
  lines.push("- executed step summary");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- `coordinator-dispatch-plan` stays read-only and should not mutate this file");
  lines.push("- `coordinator-dispatch-execute --execute` may append to this log");
  lines.push("- `dry-run` should describe the planned log entry without writing it");
  lines.push("- structured runtime history may also be appended under `.aidn/runtime/context/coordination-history.ndjson`");
  lines.push("- refresh `COORDINATION-SUMMARY.md` after each executed dispatch");
  lines.push("");
  return lines.join("\n");
}

function alignCoordinationLogDocument({ current, entry, updatedAt, governanceMetadata }) {
  const summaryBlock = buildCoordinationLogSummaryBlock({ updatedAt, governanceMetadata });
  let base = String(current ?? "");
  if (!base.trim()) {
    base = buildCoordinationLogHeader({ updatedAt, governanceMetadata });
  } else if (/^## Summary\b/m.test(base)) {
    base = base.replace(
      /## Summary\b[\s\S]*?(?=\n## Entries\b|\n## Notes\b|$)/m,
      `${summaryBlock}\n`,
    );
  } else if (/\n## Entries\b/m.test(base)) {
    base = base.replace(/\n## Entries\b/m, `\n${summaryBlock}\n## Entries`);
  } else {
    base = `${base.replace(/\s*$/u, "")}\n\n${summaryBlock}\n`;
  }
  return buildAppendedMarkdown(base, entry, buildCoordinationLogHeader({ updatedAt, governanceMetadata }));
}

function appendCoordinationLog(logPath, entry, options = {}) {
  const { updatedAt, governanceMetadata } = options;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const current = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const next = alignCoordinationLogDocument({
    current,
    entry,
    updatedAt: updatedAt || new Date().toISOString(),
    governanceMetadata,
  });
  fs.writeFileSync(logPath, next, "utf8");
}

function buildAppendedMarkdown(current, entry, header) {
  const normalizedCurrent = String(current ?? "");
  const base = normalizedCurrent.length > 0 ? normalizedCurrent : header;
  return base.endsWith("\n\n") || base.length === 0
    ? `${base}${entry}`
    : `${base}\n${entry}`;
}

async function runCoordinatorDispatch({
  targetRoot,
  agent = "auto",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  agentRosterFile = "docs/audit/AGENT-ROSTER.md",
  coordinationLogFile = "docs/audit/COORDINATION-LOG.md",
  coordinationSummaryFile = "docs/audit/COORDINATION-SUMMARY.md",
  multiAgentStatusFile = "docs/audit/MULTI-AGENT-STATUS.md",
  coordinationHistoryFile = ".aidn/runtime/context/coordination-history.ndjson",
  execute = false,
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace,
    ...sharedCoordinationOptions,
  });
  const sharedCoordinationBackend = summarizeSharedCoordinationResolution(sharedCoordinationResolution);
  const effectiveStateMode = resolveStateMode(absoluteTargetRoot, "");
  const governanceMetadata = deriveGovernedRuntimeArtifactMetadata({
    workspace,
    runtimeStateMode: effectiveStateMode,
    sourceOfTruthConcept: "coordination_records",
    lifecycleStatus: "refreshed",
  });
  const roster = loadAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile: agentRosterFile,
  });
  const dispatch = await computeCoordinatorDispatchPlan({
    targetRoot: absoluteTargetRoot,
    agent,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    agentRosterFile,
    sharedCoordination: sharedCoordinationResolution,
  });
  const sharedPlanningCandidate = deriveSharedPlanningCandidate(dispatch);
  const coordinationLogPath = resolveTargetPath(absoluteTargetRoot, coordinationLogFile);
  const coordinationSummaryPath = resolveTargetPath(absoluteTargetRoot, coordinationSummaryFile);
  const coordinationHistoryPath = resolveTargetPath(absoluteTargetRoot, coordinationHistoryFile);
  const decorateWithSharedCoordination = async (result) => {
    const sharedCoordinationSync = await appendSharedCoordinationRecord(sharedCoordinationResolution, {
      workspace,
      recordType: "coordinator_dispatch",
      status: result.execution_status ?? result.dispatch_status ?? "unknown",
      payload: result.coordination_history_event ?? buildCoordinationHistoryEvent(result),
      sessionId: result.active_session ?? "",
      cycleId: result.active_cycle ?? "",
      scopeType: result.dispatch_scope?.scope_type ?? "none",
      scopeId: result.dispatch_scope?.scope_id ?? "none",
      actorRole: "coordinator",
      actorAction: result.coordinator_recommendation?.action ?? "coordinate",
      coordinationLogRef: String(coordinationLogFile).replace(/\\/g, "/"),
      coordinationSummaryRef: String(coordinationSummaryFile).replace(/\\/g, "/"),
    });
    return {
      ...result,
      workspace,
      shared_coordination_backend: sharedCoordinationBackend,
      shared_coordination_sync: sharedCoordinationSync,
    };
  };

  if (!execute) {
    const dryRunResult = {
      ...dispatch,
      coordination_log_file: coordinationLogPath,
      coordination_summary_file: coordinationSummaryPath,
      coordination_history_file: coordinationHistoryPath,
      preferred_dispatch_source: sharedPlanningCandidate.preferred_source,
      shared_planning_candidate: sharedPlanningCandidate,
      coordination_log_appended: false,
      coordination_log_entry: "",
      coordination_summary_written: false,
      coordination_summary: null,
      multi_agent_status_written: false,
      multi_agent_status: null,
      coordination_history_appended: false,
      coordination_history_event: null,
      execution_status: "dry_run",
      executed: false,
      executed_steps: [],
    };
    dryRunResult.coordination_log_entry = buildCoordinationLogEntry(dryRunResult);
    dryRunResult.coordination_history_event = buildCoordinationHistoryEvent(dryRunResult);
    return decorateWithSharedCoordination(dryRunResult);
  }

  if (dispatch.dispatch_status === "unsupported") {
    const unsupportedResult = {
      ...dispatch,
      coordination_log_file: coordinationLogPath,
      coordination_summary_file: coordinationSummaryPath,
      coordination_history_file: coordinationHistoryPath,
      preferred_dispatch_source: sharedPlanningCandidate.preferred_source,
      shared_planning_candidate: sharedPlanningCandidate,
      coordination_log_appended: false,
      coordination_log_entry: "",
      coordination_summary_written: false,
      coordination_summary: null,
      multi_agent_status_written: false,
      multi_agent_status: null,
      coordination_history_appended: false,
      coordination_history_event: null,
      execution_status: "unsupported",
      executed: false,
      executed_steps: [],
    };
    unsupportedResult.coordination_log_entry = buildCoordinationLogEntry(unsupportedResult);
    unsupportedResult.coordination_history_event = buildCoordinationHistoryEvent(unsupportedResult);
    return decorateWithSharedCoordination(unsupportedResult);
  }

  if (dispatch.dispatch_status === "escalated") {
    const escalatedResult = {
      ...dispatch,
      coordination_log_file: coordinationLogPath,
      coordination_summary_file: coordinationSummaryPath,
      coordination_history_file: coordinationHistoryPath,
      preferred_dispatch_source: sharedPlanningCandidate.preferred_source,
      shared_planning_candidate: sharedPlanningCandidate,
      coordination_log_appended: false,
      coordination_log_entry: "",
      coordination_summary_written: false,
      coordination_summary: null,
      multi_agent_status_written: false,
      multi_agent_status: null,
      coordination_history_appended: false,
      coordination_history_event: null,
      execution_status: "escalated",
      executed: false,
      executed_steps: [],
    };
    escalatedResult.coordination_log_entry = buildCoordinationLogEntry(escalatedResult);
    escalatedResult.coordination_history_event = buildCoordinationHistoryEvent(escalatedResult);
    return decorateWithSharedCoordination(escalatedResult);
  }

  if (!Array.isArray(dispatch.steps) || dispatch.steps.length === 0) {
    const noStepsResult = {
      ...dispatch,
      coordination_log_file: coordinationLogPath,
      coordination_summary_file: coordinationSummaryPath,
      coordination_history_file: coordinationHistoryPath,
      preferred_dispatch_source: sharedPlanningCandidate.preferred_source,
      shared_planning_candidate: sharedPlanningCandidate,
      coordination_log_appended: false,
      coordination_log_entry: "",
      coordination_summary_written: false,
      coordination_summary: null,
      multi_agent_status_written: false,
      multi_agent_status: null,
      coordination_history_appended: false,
      coordination_history_event: null,
      execution_status: "no_steps",
      executed: false,
      executed_steps: [],
    };
    noStepsResult.coordination_log_entry = buildCoordinationLogEntry(noStepsResult);
    noStepsResult.coordination_history_event = buildCoordinationHistoryEvent(noStepsResult);
    return decorateWithSharedCoordination(noStepsResult);
  }

  const agentAdapter = await resolveAgentAdapter(dispatch.selected_agent.id, {
    targetRoot: absoluteTargetRoot,
    roster,
  });

  const executedSteps = [];
  let overallStatus = "executed";
  for (const step of dispatch.steps) {
    const result = agentAdapter.runCommand({
      command: step.command,
      commandArgs: step.args,
      commandLine: step.command_line,
    });
    const status = Number.isInteger(result?.status) ? result.status : 1;
    const output = {
      label: step.label,
      command: step.command,
      args: step.args,
      command_line: step.command_line,
      exit_code: status,
      stdout: sanitizeOutput(result?.stdout),
      stderr: sanitizeOutput(result?.stderr),
      ok: status === 0,
    };
    executedSteps.push(output);
    if (!output.ok) {
      overallStatus = "failed";
      break;
    }
  }

  const finalResult = {
    ...dispatch,
    coordination_log_file: coordinationLogPath,
    coordination_summary_file: coordinationSummaryPath,
    coordination_history_file: coordinationHistoryPath,
    preferred_dispatch_source: sharedPlanningCandidate.preferred_source,
    shared_planning_candidate: sharedPlanningCandidate,
    coordination_log_appended: false,
    coordination_log_entry: "",
    coordination_summary_written: false,
    coordination_summary: null,
    multi_agent_status_written: false,
    multi_agent_status: null,
    coordination_history_appended: false,
    coordination_history_event: null,
    execution_status: overallStatus,
    executed: overallStatus === "executed",
    executed_steps: executedSteps,
  };
  finalResult.coordination_log_entry = buildCoordinationLogEntry(finalResult);
  finalResult.coordination_history_event = buildCoordinationHistoryEvent(finalResult);
  const updatedAt = new Date().toISOString();
  if (effectiveStateMode === "files") {
    appendCoordinationLog(coordinationLogPath, finalResult.coordination_log_entry, {
      updatedAt,
      governanceMetadata,
    });
    finalResult.coordination_log_appended = true;
  } else {
    const { dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot, effectiveStateMode);
    const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafe(absoluteTargetRoot) : {
      exists: false,
      sqliteFile: "",
      payload: null,
      warning: "",
    };
    const existingLog = resolveAuditArtifactText({
      targetRoot: absoluteTargetRoot,
      candidatePath: coordinationLogFile,
      dbBacked: dbBackedMode,
      sqlitePayload: sqliteFallback.payload,
    });
    const relativeLogPath = String(coordinationLogFile).replace(/\\/g, "/").replace(/^docs\/audit\//i, "");
    const coordinationLogDbFirst = runDbFirstArtifactUseCase({
      target: absoluteTargetRoot,
      auditRoot: "docs/audit",
      path: relativeLogPath,
      content: alignCoordinationLogDocument({
        current: existingLog.text,
        entry: finalResult.coordination_log_entry,
        updatedAt,
        governanceMetadata,
      }),
      kind: "other",
      family: "normative",
      subtype: "coordination_log",
      stateMode: effectiveStateMode,
    });
    finalResult.coordination_log_appended = Boolean(coordinationLogDbFirst?.ok);
  }
  appendRuntimeNdjsonEvent(coordinationHistoryPath, finalResult.coordination_history_event);
  finalResult.coordination_history_appended = true;
  finalResult.coordination_summary = await projectCoordinationSummary({
    targetRoot: absoluteTargetRoot,
    historyFile: coordinationHistoryFile,
    out: coordinationSummaryFile,
    workspace,
    sharedCoordination: sharedCoordinationResolution,
  });
  finalResult.coordination_summary_written = Boolean(finalResult.coordination_summary?.written);
  finalResult.multi_agent_status = await projectMultiAgentStatus({
    targetRoot: absoluteTargetRoot,
    coordinationHistoryFile,
    out: multiAgentStatusFile,
    sharedCoordination: sharedCoordinationResolution,
  });
  finalResult.multi_agent_status_written = Boolean(finalResult.multi_agent_status?.written);
  return decorateWithSharedCoordination(finalResult);
}

export async function executeCoordinatorDispatch(options = {}) {
  const result = await runCoordinatorDispatch(options);
  return {
    ...result,
    dispatch_execute_diagnostic: deriveCoordinatorDispatchExecuteDiagnostic(result),
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await executeCoordinatorDispatch({
      targetRoot: args.target,
      agent: args.agent,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      packetFile: args.packetFile,
      agentRosterFile: args.agentRosterFile,
      coordinationLogFile: args.coordinationLogFile,
      coordinationSummaryFile: args.coordinationSummaryFile,
      multiAgentStatusFile: args.multiAgentStatusFile,
      coordinationHistoryFile: args.coordinationHistoryFile,
      execute: args.execute,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator dispatch execute:");
      console.log(`- dispatch_status=${result.dispatch_status}`);
      console.log(`- execution_status=${result.execution_status}`);
      console.log(`- executed=${result.executed}`);
      console.log(`- entrypoint=${result.entrypoint_kind}:${result.entrypoint_name}`);
      if (args.execute) {
        console.log(`- coordination_summary=${result.coordination_summary_file} (${result.coordination_summary_written ? "written" : "unchanged"})`);
        console.log(`- multi_agent_status=${result.multi_agent_status?.output_file ?? "none"} (${result.multi_agent_status_written ? "written" : "unchanged"})`);
      }
      for (const step of result.executed_steps) {
        console.log(`- step=${step.label} exit_code=${step.exit_code}`);
      }
    }
    if (args.execute && result.execution_status !== "executed") {
      process.exit(1);
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
