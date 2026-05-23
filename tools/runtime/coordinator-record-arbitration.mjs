#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendSharedCoordinationRecord, resolveSharedCoordinationStore, summarizeSharedCoordinationResolution } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { runDbFirstArtifactUseCase } from "../../src/application/runtime/db-first-artifact-use-case.mjs";
import {
  buildCoordinatorArbitrationAppendedMarkdown,
  buildCoordinatorArbitrationEvent,
  buildCoordinatorArbitrationLogEntry,
  buildCoordinatorRecordArbitrationResult,
  COORDINATOR_ALLOWED_ARBITRATION_DECISIONS,
} from "../../src/application/runtime/coordinator-record-arbitration-use-case.mjs";
import { deriveGovernedRuntimeArtifactMetadata } from "../../src/application/runtime/governed-runtime-artifact-metadata-lib.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { resolveStateMode } from "../../src/application/runtime/db-first-artifact-lib.mjs";
import { appendRuntimeNdjsonEvent } from "../../src/application/runtime/runtime-path-service.mjs";
import {
  loadSqliteIndexPayloadSafe,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "./db-first-runtime-view-lib.mjs";
import { projectCoordinationSummary } from "./project-coordination-summary.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    decision: "",
    note: "",
    goal: "",
    arbitrationFile: "docs/audit/USER-ARBITRATION.md",
    coordinationHistoryFile: ".aidn/runtime/context/coordination-history.ndjson",
    coordinationSummaryFile: "docs/audit/COORDINATION-SUMMARY.md",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--decision") {
      args.decision = String(argv[index + 1] ?? "").trim().toLowerCase();
      index += 1;
    } else if (token === "--note") {
      args.note = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--goal") {
      args.goal = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--arbitration-file") {
      args.arbitrationFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--coordination-history-file") {
      args.coordinationHistoryFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--coordination-summary-file") {
      args.coordinationSummaryFile = String(argv[index + 1] ?? "").trim();
      index += 1;
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
  if (!COORDINATOR_ALLOWED_ARBITRATION_DECISIONS.has(args.decision)) {
    throw new Error(`Invalid or missing --decision. Allowed: ${Array.from(COORDINATOR_ALLOWED_ARBITRATION_DECISIONS).join(", ")}`);
  }
  if (!args.note) {
    throw new Error("Missing value for --note");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-record-arbitration.mjs --target . --decision continue --note \"validated by user\"");
  console.log("  node tools/runtime/coordinator-record-arbitration.mjs --target . --decision repair --note \"repair first\" --goal \"triage mismatch\" --json");
  console.log("  node tools/runtime/coordinator-record-arbitration.mjs --target . --decision integration_cycle --note \"use a dedicated integration vehicle\" --json");
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

function buildArbitrationSummaryBlock({ updatedAt, governanceMetadata }) {
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

function buildArbitrationHeader({ updatedAt, governanceMetadata }) {
  const lines = [];
  lines.push("# User Arbitration Log");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- record explicit user decisions that unblock coordinator escalations");
  lines.push("- preserve a human-readable trace of why automatic relay was resumed or redirected");
  lines.push("- avoid silent override of coordinator safeguards");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a state log");
  lines.push("- canonical workflow rules remain in `SPEC.md`");
  lines.push("- agent execution rules remain in `AGENTS.md`");
  lines.push("");
  lines.push(buildArbitrationSummaryBlock({ updatedAt, governanceMetadata }));
  lines.push("## Entries");
  lines.push("");
  lines.push("Append one section per explicit arbitration outcome.");
  lines.push("");
  lines.push("Recommended fields:");
  lines.push("");
  lines.push("- timestamp");
  lines.push("- decision");
  lines.push("- note");
  lines.push("- optional goal override");
  lines.push("- optional integration strategy override");
  lines.push("- resulting next relay expectation");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- record arbitration before resuming automatic multi-agent dispatch after `dispatch_status=escalated`");
  lines.push("- keep the machine-readable companion event in `.aidn/runtime/context/coordination-history.ndjson`");
  lines.push("- refresh `COORDINATION-SUMMARY.md` after recording arbitration");
  lines.push("");
  return lines.join("\n");
}

function alignArbitrationDocument({ current, entry, updatedAt, governanceMetadata }) {
  const summaryBlock = buildArbitrationSummaryBlock({ updatedAt, governanceMetadata });
  let base = String(current ?? "");
  if (!base.trim()) {
    base = buildArbitrationHeader({ updatedAt, governanceMetadata });
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
  return buildCoordinatorArbitrationAppendedMarkdown(
    base,
    entry,
    buildArbitrationHeader({ updatedAt, governanceMetadata }),
  );
}

function appendArbitrationLog(logPath, entry, options = {}) {
  const { updatedAt, governanceMetadata } = options;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const current = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const next = alignArbitrationDocument({
    current,
    entry,
    updatedAt: updatedAt || new Date().toISOString(),
    governanceMetadata,
  });
  fs.writeFileSync(logPath, next, "utf8");
}

export async function recordCoordinatorArbitration({
  targetRoot,
  decision,
  note,
  goal = "",
  arbitrationFile = "docs/audit/USER-ARBITRATION.md",
  coordinationHistoryFile = ".aidn/runtime/context/coordination-history.ndjson",
  coordinationSummaryFile = "docs/audit/COORDINATION-SUMMARY.md",
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
  const effectiveStateMode = resolveStateMode(absoluteTargetRoot, "");
  const governanceMetadata = deriveGovernedRuntimeArtifactMetadata({
    workspace,
    runtimeStateMode: effectiveStateMode,
    sourceOfTruthConcept: "coordination_records",
    lifecycleStatus: "refreshed",
  });
  const arbitrationPath = resolveTargetPath(absoluteTargetRoot, arbitrationFile);
  const historyPath = resolveTargetPath(absoluteTargetRoot, coordinationHistoryFile);
  const summaryPath = resolveTargetPath(absoluteTargetRoot, coordinationSummaryFile);
  const event = buildCoordinatorArbitrationEvent({ decision, note, goal });
  const arbitrationMarkdown = buildCoordinatorArbitrationLogEntry(event);
  const updatedAt = event.ts;
  let arbitrationLogAppended = false;
  let arbitrationDbFirst = null;
  if (effectiveStateMode === "files") {
    appendArbitrationLog(arbitrationPath, arbitrationMarkdown, {
      updatedAt,
      governanceMetadata,
    });
    arbitrationLogAppended = true;
  } else {
    const relativeArbitrationPath = String(arbitrationFile).replace(/\\/g, "/").replace(/^docs\/audit\//i, "");
    const { dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot, effectiveStateMode);
    const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafe(absoluteTargetRoot) : {
      exists: false,
      sqliteFile: "",
      payload: null,
      warning: "",
    };
    const existingArbitration = resolveAuditArtifactText({
      targetRoot: absoluteTargetRoot,
      candidatePath: arbitrationFile,
      dbBacked: dbBackedMode,
      sqlitePayload: sqliteFallback.payload,
    });
    arbitrationDbFirst = runDbFirstArtifactUseCase({
      target: absoluteTargetRoot,
      auditRoot: "docs/audit",
      path: relativeArbitrationPath,
      content: alignArbitrationDocument({
        current: existingArbitration.text,
        entry: arbitrationMarkdown,
        updatedAt,
        governanceMetadata,
      }),
      kind: "other",
      family: "normative",
      subtype: "user_arbitration",
      stateMode: effectiveStateMode,
    });
    arbitrationLogAppended = Boolean(arbitrationDbFirst?.ok);
  }
  appendRuntimeNdjsonEvent(historyPath, event);
  const summary = await projectCoordinationSummary({
    targetRoot: absoluteTargetRoot,
    historyFile: coordinationHistoryFile,
    out: coordinationSummaryFile,
    workspace,
    sharedCoordination: sharedCoordinationResolution,
  });
  const sharedCoordinationSync = await appendSharedCoordinationRecord(sharedCoordinationResolution, {
    workspace,
    recordType: "user_arbitration",
    status: decision,
    payload: event,
    sessionId: "",
    cycleId: "",
    scopeType: "session",
    scopeId: "none",
    actorRole: "user",
    actorAction: "arbitrate",
    coordinationSummaryRef: String(coordinationSummaryFile).replace(/\\/g, "/"),
  });
  return buildCoordinatorRecordArbitrationResult({
    absoluteTargetRoot,
    workspace,
    sharedCoordinationBackend: summarizeSharedCoordinationResolution(sharedCoordinationResolution),
    sharedCoordinationSync,
    effectiveStateMode,
    arbitrationPath,
    historyPath,
    summaryPath,
    arbitrationLogAppended,
    arbitrationDbFirst,
    summary,
    event,
  });
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await recordCoordinatorArbitration({
      targetRoot: args.target,
      decision: args.decision,
      note: args.note,
      goal: args.goal,
      arbitrationFile: args.arbitrationFile,
      coordinationHistoryFile: args.coordinationHistoryFile,
      coordinationSummaryFile: args.coordinationSummaryFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator arbitration recorded:");
      console.log(`- decision=${result.arbitration_event.decision}`);
      console.log(`- arbitration_file=${result.arbitration_file}`);
      console.log(`- coordination_summary=${result.coordination_summary_file} (${result.coordination_summary_written ? "written" : "unchanged"})`);
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
