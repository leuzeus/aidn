#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readSharedCoordinationRecords,
  resolveSharedCoordinationStore,
  summarizeSharedCoordinationResolution,
} from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { runDbFirstArtifactUseCase } from "../../src/application/runtime/db-first-artifact-use-case.mjs";
import { resolveStateMode } from "../../src/application/runtime/db-first-artifact-lib.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    historyFile: ".aidn/runtime/context/coordination-history.ndjson",
    out: "docs/audit/COORDINATION-SUMMARY.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--history-file") {
      args.historyFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
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
  if (!args.target || !args.out) {
    throw new Error("Missing required arguments");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/project-coordination-summary.mjs --target .");
  console.log("  node tools/runtime/project-coordination-summary.mjs --target tests/fixtures/repo-installed-core --json");
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
    preferred_dispatch_source: normalizeScalar(payload.preferred_dispatch_source || "workflow") || "workflow",
    decision: normalizeScalar(payload.decision || "unknown") || "unknown",
    note: normalizeScalar(payload.note || "unknown") || "unknown",
  };
}

function summarize(entries) {
  const dispatchEntries = entries.filter((entry) => normalizeScalar(entry.event || "coordinator_dispatch") === "coordinator_dispatch");
  const arbitrationEntries = entries.filter((entry) => normalizeScalar(entry.event) === "user_arbitration");
  const total = dispatchEntries.length;
  const last = total > 0 ? dispatchEntries[total - 1] : null;
  const lastArbitration = arbitrationEntries.length > 0 ? arbitrationEntries[arbitrationEntries.length - 1] : null;
  const byDispatchStatus = {};
  const byExecutionStatus = {};
  const byRole = {};
  const byPreferredDispatchSource = {};
  const byEventType = {};

  for (const entry of entries) {
    const eventType = normalizeScalar(entry.event || "coordinator_dispatch");
    byEventType[eventType] = (byEventType[eventType] ?? 0) + 1;
  }

  for (const entry of dispatchEntries) {
    const dispatchStatus = normalizeScalar(entry.dispatch_status || "unknown");
    const executionStatus = normalizeScalar(entry.execution_status || "unknown");
    const role = normalizeScalar(entry.recommended_role || "unknown");
    const preferredDispatchSource = normalizeScalar(entry.preferred_dispatch_source || "workflow");
    byDispatchStatus[dispatchStatus] = (byDispatchStatus[dispatchStatus] ?? 0) + 1;
    byExecutionStatus[executionStatus] = (byExecutionStatus[executionStatus] ?? 0) + 1;
    byRole[role] = (byRole[role] ?? 0) + 1;
    byPreferredDispatchSource[preferredDispatchSource] = (byPreferredDispatchSource[preferredDispatchSource] ?? 0) + 1;
  }

  return {
    updated_at: new Date().toISOString(),
    history_status: total > 0 ? "available" : "empty",
    total_dispatches: total,
    last_recommended_role: normalizeScalar(last?.recommended_role || "unknown") || "unknown",
    last_recommended_action: normalizeScalar(last?.recommended_action || "unknown") || "unknown",
    last_preferred_dispatch_source: normalizeScalar(last?.preferred_dispatch_source || "workflow") || "workflow",
    last_execution_status: normalizeScalar(last?.execution_status || "unknown") || "unknown",
    arbitration_count: arbitrationEntries.length,
    last_arbitration_decision: normalizeScalar(lastArbitration?.decision || "unknown") || "unknown",
    last_arbitration_ts: normalizeScalar(lastArbitration?.ts || "unknown") || "unknown",
    by_dispatch_status: byDispatchStatus,
    by_execution_status: byExecutionStatus,
    by_role: byRole,
    by_preferred_dispatch_source: byPreferredDispatchSource,
    by_event_type: byEventType,
    recent_dispatches: dispatchEntries.slice(-5).reverse().map((entry) => ({
      ts: normalizeScalar(entry.ts || "unknown") || "unknown",
      selected_agent: normalizeScalar(entry.selected_agent || "unknown") || "unknown",
      recommended_role: normalizeScalar(entry.recommended_role || "unknown") || "unknown",
      recommended_action: normalizeScalar(entry.recommended_action || "unknown") || "unknown",
      preferred_dispatch_source: normalizeScalar(entry.preferred_dispatch_source || "workflow") || "workflow",
      dispatch_status: normalizeScalar(entry.dispatch_status || "unknown") || "unknown",
      execution_status: normalizeScalar(entry.execution_status || "unknown") || "unknown",
      goal: normalizeScalar(entry.goal || "unknown") || "unknown",
    })),
  };
}

function renderCounts(label, counts) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) {
    return [`${label}: none`];
  }
  return [
    `${label}:`,
    ...entries
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, value]) => `- ${key}: ${value}`),
  ];
}

function buildMarkdown(summary, historyRelativePath) {
  const lines = [];
  lines.push("# Coordination Summary");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- summarize recent multi-agent dispatch activity");
  lines.push("- reduce the cost of reading raw coordination history");
  lines.push("- highlight the latest coordinator decision and execution outcome");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a derived state digest");
  lines.push("- canonical workflow rules remain in `SPEC.md`");
  lines.push("- the detailed coordination trace remains in `COORDINATION-LOG.md`");
  lines.push(`- the structured runtime trace remains in \`${historyRelativePath}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${summary.updated_at}`);
  lines.push(`history_status: ${summary.history_status}`);
  lines.push(`total_dispatches: ${summary.total_dispatches}`);
  lines.push(`last_recommended_role: ${summary.last_recommended_role}`);
  lines.push(`last_recommended_action: ${summary.last_recommended_action}`);
  lines.push(`last_preferred_dispatch_source: ${summary.last_preferred_dispatch_source}`);
  lines.push(`last_execution_status: ${summary.last_execution_status}`);
  lines.push(`arbitration_count: ${summary.arbitration_count}`);
  lines.push(`last_arbitration_decision: ${summary.last_arbitration_decision}`);
  lines.push(`last_arbitration_ts: ${summary.last_arbitration_ts}`);
  lines.push("");
  lines.push("## Aggregates");
  lines.push("");
  lines.push(...renderCounts("event_type_counts", summary.by_event_type));
  lines.push("");
  lines.push(...renderCounts("dispatch_status_counts", summary.by_dispatch_status));
  lines.push("");
  lines.push(...renderCounts("execution_status_counts", summary.by_execution_status));
  lines.push("");
  lines.push(...renderCounts("recommended_role_counts", summary.by_role));
  lines.push("");
  lines.push(...renderCounts("preferred_dispatch_source_counts", summary.by_preferred_dispatch_source));
  lines.push("");
  lines.push("## Recent Dispatches");
  lines.push("");
  if (!Array.isArray(summary.recent_dispatches) || summary.recent_dispatches.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.recent_dispatches) {
      lines.push(`- ${item.ts} | ${item.selected_agent} | ${item.recommended_role} + ${item.recommended_action} | source=${item.preferred_dispatch_source} | dispatch=${item.dispatch_status} | execution=${item.execution_status} | goal=${item.goal}`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- refresh this summary after `coordinator-dispatch-execute --execute`");
  lines.push("- use `COORDINATION-LOG.md` for readable detail");
  lines.push(`- use \`${historyRelativePath}\` for structured analysis`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function projectCoordinationSummary({
  targetRoot,
  historyFile = ".aidn/runtime/context/coordination-history.ndjson",
  out = "docs/audit/COORDINATION-SUMMARY.md",
  workspace = null,
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const effectiveStateMode = resolveStateMode(absoluteTargetRoot, "");
  const effectiveWorkspace = workspace ?? resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const historyPath = resolveTargetPath(absoluteTargetRoot, historyFile);
  const outPath = resolveTargetPath(absoluteTargetRoot, out);
  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace: effectiveWorkspace,
    ...sharedCoordinationOptions,
  });
  const sharedRecords = await readSharedCoordinationRecords(sharedCoordinationResolution, {
    workspace: effectiveWorkspace,
    limit: 200,
  });
  const entries = sharedRecords.ok && Array.isArray(sharedRecords.records) && sharedRecords.records.length > 0
    ? sharedRecords.records.map((record) => mapCoordinationRecordToEvent(record)).filter(Boolean)
    : readNdjson(historyPath);
  const summary = summarize(entries);
  const historySource = sharedRecords.ok && Array.isArray(sharedRecords.records) && sharedRecords.records.length > 0
    ? "shared-coordination"
    : "coordination-history";
  const historyRelativePath = historySource === "shared-coordination"
    ? "shared-coordination://coordination_records"
    : (path.relative(absoluteTargetRoot, historyPath).replace(/\\/g, "/") || historyFile);
  const markdown = buildMarkdown(summary, historyRelativePath);
  const relativeOut = String(out).replace(/\\/g, "/").replace(/^docs\/audit\//i, "");
  const dbFirstWrite = effectiveStateMode === "dual" || effectiveStateMode === "db-only"
    ? runDbFirstArtifactUseCase({
      target: absoluteTargetRoot,
      auditRoot: "docs/audit",
      path: relativeOut,
      content: markdown,
      kind: "other",
      family: "normative",
      subtype: "coordination_summary",
      stateMode: effectiveStateMode,
    })
    : null;
  const write = effectiveStateMode === "files"
    ? writeUtf8IfChanged(outPath, markdown)
    : {
      path: outPath,
      written: Boolean(dbFirstWrite?.ok),
    };
  return {
    target_root: absoluteTargetRoot,
    workspace: effectiveWorkspace,
    history_file: historyPath,
    history_source: historySource,
    shared_coordination_backend: summarizeSharedCoordinationResolution(sharedCoordinationResolution),
    output_file: write.path,
    written: write.written,
    state_mode: effectiveStateMode,
    db_first_applied: Boolean(dbFirstWrite),
    db_first_materialized: Boolean(dbFirstWrite?.materialized),
    db_first_artifact_path: dbFirstWrite?.artifact?.path ?? relativeOut,
    summary,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await projectCoordinationSummary({
      targetRoot: args.target,
      historyFile: args.historyFile,
      out: args.out,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Coordination summary: ${result.output_file} (${result.written ? "written" : "unchanged"})`);
      console.log(`- history_status=${result.summary.history_status}`);
      console.log(`- total_dispatches=${result.summary.total_dispatches}`);
      console.log(`- last_recommended_role=${result.summary.last_recommended_role}`);
      console.log(`- last_execution_status=${result.summary.last_execution_status}`);
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
