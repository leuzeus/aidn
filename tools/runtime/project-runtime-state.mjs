#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildRuntimeStateMarkdown,
  deriveRuntimeStateRepairSummary,
  prepareRuntimeStateProjection,
} from "../../src/application/runtime/runtime-state-projector-use-case.mjs";
import { resolvePromotedSharedPlanningContext } from "../../src/application/runtime/shared-planning-resolution-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { validateSharedRuntimeContext } from "../../src/application/runtime/shared-runtime-validation-service.mjs";
import { evaluateRepairRouting } from "../../src/application/runtime/workflow-transition-lib.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { evaluateCurrentStateConsistency } from "../perf/verify-current-state-consistency.mjs";
import {
  buildVirtualCurrentStateConsistency,
  loadDbIndexPayloadSafe,
  normalizeScalar,
  parseSimpleMap,
  resolveDbArtifactSourceName,
  resolveAuditArtifactText,
  resolveCycleStatusArtifact,
  resolveDbBackedMode,
  resolveSessionArtifact,
} from "./db-first-runtime-view-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    hydratedFile: ".aidn/runtime/context/hydrated-context.json",
    contextFile: ".aidn/runtime/context/codex-context.json",
    out: "docs/audit/RUNTIME-STATE.md",
    json: false,
    dryRun: false,
    write: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--hydrated-file") {
      args.hydratedFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--context-file") {
      args.contextFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--write") {
      args.write = true;
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
  console.log("  node tools/runtime/project-runtime-state.mjs --target .");
  console.log("  node tools/runtime/project-runtime-state.mjs --target . --write");
  console.log("  node tools/runtime/project-runtime-state.mjs --target tests/fixtures/repo-installed-core --json");
  console.log("  node tools/runtime/project-runtime-state.mjs --target tests/fixtures/repo-installed-core --dry-run --json");
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

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function projectRuntimeState({
  targetRoot,
  hydratedFile = ".aidn/runtime/context/hydrated-context.json",
  contextFile = ".aidn/runtime/context/codex-context.json",
  out = "docs/audit/RUNTIME-STATE.md",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
  sharedStateOptions = {},
  dryRun = false,
  write = false,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const hydratedPath = resolveTargetPath(absoluteTargetRoot, hydratedFile);
  const contextPath = resolveTargetPath(absoluteTargetRoot, contextFile);
  const hydrated = readJsonIfExists(hydratedPath);
  const fallbackContext = readJsonIfExists(contextPath);
  const auditRoot = path.join(absoluteTargetRoot, "docs", "audit");
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const sharedRuntimeValidation = validateSharedRuntimeContext({
    targetRoot: absoluteTargetRoot,
    workspace,
  });
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const sqliteFallback = dbBackedMode ? await loadDbIndexPayloadSafe(absoluteTargetRoot, sharedStateOptions) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const dbSource = resolveDbArtifactSourceName(sqliteFallback.backend);
  const currentStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: "docs/audit/CURRENT-STATE.md",
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
  const currentStateMap = parseSimpleMap(currentStateResolution.text);
  const activeSession = normalizeScalar(currentStateMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentStateMap.get("active_cycle") ?? "none") || "none";
  const sharedPlanning = await resolvePromotedSharedPlanningContext({
    targetRoot: absoluteTargetRoot,
    workspace,
    currentState: {
      active_session: activeSession,
      active_backlog: currentStateMap.get("active_backlog") ?? "none",
      backlog_status: currentStateMap.get("backlog_status") ?? "unknown",
      backlog_next_step: currentStateMap.get("backlog_next_step") ?? "unknown",
      backlog_selected_execution_scope: currentStateMap.get("backlog_selected_execution_scope") ?? "none",
      planning_arbitration_status: currentStateMap.get("planning_arbitration_status") ?? "none",
    },
    sharedCoordination,
    sharedCoordinationOptions,
  });
  const sessionResolution = resolveSessionArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    sessionId: activeSession,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
  });
  const cycleStatusResolution = resolveCycleStatusArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot,
    cycleId: activeCycle,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
  });
  const consistency = currentStateResolution.source === "file"
    ? evaluateCurrentStateConsistency({ targetRoot: absoluteTargetRoot })
    : buildVirtualCurrentStateConsistency({
      currentStateResolution,
      activeCycle,
      activeSession,
      cycleStatusResolution,
    });
  const repairSummary = deriveRuntimeStateRepairSummary(hydrated, fallbackContext);
  const digest = prepareRuntimeStateProjection({
    workspace,
    dbBackedMode,
    effectiveStateMode,
    hydrated,
    fallbackContext,
    repairRouting: evaluateRepairRouting(repairSummary),
    sharedRuntimeValidation,
    sharedPlanning,
    consistency,
    currentStateResolution,
    sessionResolution,
    cycleStatusResolution,
    contextSource: hydrated
      ? path.relative(absoluteTargetRoot, hydratedPath).replace(/\\/g, "/")
      : (fallbackContext ? path.relative(absoluteTargetRoot, contextPath).replace(/\\/g, "/") : "none"),
    hydratedFile,
    contextFile,
  });
  const markdown = buildRuntimeStateMarkdown(digest);
  const outputPath = resolveTargetPath(absoluteTargetRoot, out);
  const shouldWrite = Boolean(write) && !dryRun;
  const outWrite = shouldWrite
    ? writeUtf8IfChanged(outputPath, markdown)
    : { path: outputPath, written: false };
  return {
    target_root: absoluteTargetRoot,
    dry_run: Boolean(dryRun),
    write: shouldWrite,
    workspace,
    shared_state_backend: sqliteFallback.backend ?? null,
    shared_runtime_validation: sharedRuntimeValidation,
    output_file: outWrite.path,
    written: outWrite.written,
    digest,
    consistency,
  };
}

function printFreshnessHint(digest) {
  if (String(digest?.current_state_freshness ?? "").trim().toLowerCase() !== "stale") {
    return;
  }
  console.log("Current state stale: docs/audit/CURRENT-STATE.md");
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const output = await projectRuntimeState({
      targetRoot: args.target,
      hydratedFile: args.hydratedFile,
      contextFile: args.contextFile,
      out: args.out,
      dryRun: args.dryRun,
      write: args.write,
    });

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Runtime state digest: ${output.output_file} (${output.written ? "written" : "unchanged"})`);
      console.log(`- runtime_state_mode=${output.digest.runtime_state_mode}`);
      console.log(`- repair_layer_status=${output.digest.repair_layer_status}`);
      console.log(`- repair_routing_hint=${output.digest.repair_routing_hint}`);
      console.log(`- current_state_freshness=${output.digest.current_state_freshness}`);
      console.log(`- consistency=${output.digest.consistency_status}`);
      printFreshnessHint(output.digest);
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
