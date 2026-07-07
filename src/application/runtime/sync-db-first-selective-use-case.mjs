import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStateMode } from "./db-first-artifact-lib.mjs";
import { runDbFirstArtifactUseCase } from "./db-first-artifact-use-case.mjs";
import {
  buildRepairLayerInputDigest,
  REPAIR_LAYER_ENGINE_VERSION,
} from "./repair-layer-payload-lib.mjs";
import { writeRepairLayerTriageArtifacts } from "./repair-layer-artifact-service.mjs";
import { runRepairLayerUseCase } from "./repair-layer-use-case.mjs";
import { detectRuntimeSnapshotBackend, readRuntimeSnapshot } from "./runtime-snapshot-service.mjs";
import {
  readAidnProjectConfig,
  resolveConfigRuntimePersistenceBackend,
} from "../../lib/config/aidn-config-lib.mjs";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const FULL_SYNC_SCRIPT = path.resolve(RUNTIME_DIR, "..", "..", "..", "tools", "runtime", "sync-db-first.mjs");

function parseGitPath(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parsePorcelainLine(line) {
  if (!line || line.length < 4) {
    return null;
  }
  const status = line.slice(0, 2);
  const body = line.slice(3);
  if (!body) {
    return null;
  }
  const renameIdx = body.indexOf(" -> ");
  if (renameIdx >= 0) {
    return {
      path: parseGitPath(body.slice(renameIdx + 4)),
      status,
    };
  }
  return {
    path: parseGitPath(body),
    status,
  };
}

function readChangedAuditPaths(gitAdapter, targetRoot, auditRoot) {
  const stdout = gitAdapter.execStatusPorcelain(targetRoot, auditRoot, true);
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const out = [];
  let requiresFullSync = false;
  for (const line of lines) {
    const parsed = parsePorcelainLine(line);
    if (parsed?.path) {
      out.push(parsed.path.replace(/\\/g, "/"));
      const status = String(parsed.status ?? "");
      if (/[DR]/.test(status)) {
        requiresFullSync = true;
      }
    }
  }
  return {
    changedPaths: Array.from(new Set(out)),
    requiresFullSync,
  };
}

function emptyFastPath({ used = false, reason = "not_evaluated", diagnostics = {} } = {}) {
  return {
    used,
    reason,
    skipped_operations: used
      ? [
        "db_artifact_sync",
        "full_sync_fallback",
        "repair_layer_reapply",
        "repair_layer_triage_render",
      ]
      : [],
    diagnostics,
  };
}

function resolveRuntimePersistenceBackend(targetRoot) {
  const config = readAidnProjectConfig(targetRoot);
  return resolveConfigRuntimePersistenceBackend(config.data) ?? "sqlite";
}

function findLocalCycleStatusPath(targetRoot, cycleId) {
  const normalizedCycleId = String(cycleId ?? "").trim().toUpperCase();
  if (!normalizedCycleId) {
    return "";
  }
  const cyclesRoot = path.join(targetRoot, "docs", "audit", "cycles");
  if (!fs.existsSync(cyclesRoot)) {
    return "";
  }
  const entries = fs.readdirSync(cyclesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.toUpperCase().startsWith(`${normalizedCycleId}-`)) {
      continue;
    }
    const repoPath = `docs/audit/cycles/${entry.name}/status.md`;
    const absolute = path.join(cyclesRoot, entry.name, "status.md");
    if (fs.existsSync(absolute)) {
      return repoPath;
    }
  }
  return "";
}

function referencedCycleIdFromFinding(item) {
  const direct = String(item?.referenced_cycle_id ?? "").trim().toUpperCase();
  if (direct) {
    return direct;
  }
  const message = String(item?.message ?? "");
  const match = message.match(/\bC\d+\b/i);
  return match ? match[0].toUpperCase() : "";
}

function summarizeRepairRefreshNeed(findings, targetRoot) {
  const rows = Array.isArray(findings) ? findings : [];
  const refreshableFindingTypes = new Set([
    "UNINDEXED_CYCLE_STATUS_REFERENCE",
    "UNRESOLVED_CYCLE_REFERENCE",
    "UNRESOLVED_SESSION_CYCLE",
  ]);
  const trackedNotIndexed = rows.filter((item) => {
    const findingType = String(item?.finding_type ?? "");
    if (!refreshableFindingTypes.has(findingType)) {
      return false;
    }
    if (
      String(item?.reference_resolution_state ?? "") === "tracked_not_indexed"
      || String(item?.git_tracking ?? "") === "tracked"
    ) {
      return true;
    }
    return Boolean(findLocalCycleStatusPath(targetRoot, referencedCycleIdFromFinding(item)));
  });
  return {
    required: trackedNotIndexed.length > 0,
    reason: trackedNotIndexed.length > 0 ? "repair_layer_tracked_not_indexed" : "none",
    findings_count: trackedNotIndexed.length,
  };
}

async function evaluateNoChangeFastPath({
  args,
  targetRoot,
  stateMode,
  gitAvailable,
  changedPaths,
  requiresFullSync,
  runtimePersistenceBackend = "sqlite",
} = {}) {
  const baseDiagnostics = {
    changed_paths_count: Array.isArray(changedPaths) ? changedPaths.length : 0,
    git_available: gitAvailable === true,
    requires_full_sync: requiresFullSync === true,
    index_backend: "unknown",
    index_exists: false,
    repair_layer_meta_current: false,
    repair_findings_count: null,
    repair_warning_count: null,
    repair_error_count: null,
    repair_refresh_required: false,
    repair_refresh_reason: "none",
    repair_refresh_findings_count: 0,
    runtime_persistence_backend: runtimePersistenceBackend,
  };

  if (!["dual", "db-only"].includes(stateMode)) {
    return emptyFastPath({
      reason: "state_mode_not_db_backed",
      diagnostics: baseDiagnostics,
    });
  }
  if (!gitAvailable) {
    return emptyFastPath({
      reason: "git_unavailable",
      diagnostics: baseDiagnostics,
    });
  }
  if (requiresFullSync) {
    return emptyFastPath({
      reason: "git_status_requires_full",
      diagnostics: baseDiagnostics,
    });
  }
  if (baseDiagnostics.changed_paths_count > 0) {
    return emptyFastPath({
      reason: "changed_workflow_artifacts",
      diagnostics: baseDiagnostics,
    });
  }
  if (runtimePersistenceBackend === "postgres") {
    return emptyFastPath({
      reason: "postgres_canonical_backend",
      diagnostics: {
        ...baseDiagnostics,
        sqlite_decision_source: "not_used",
      },
    });
  }

  const indexFile = path.isAbsolute(args.sqliteFile)
    ? path.resolve(args.sqliteFile)
    : path.resolve(targetRoot, args.sqliteFile);
  const indexBackend = detectRuntimeSnapshotBackend(indexFile, "sqlite");
  baseDiagnostics.index_backend = indexBackend;
  baseDiagnostics.index_file = indexFile;
  if (!fs.existsSync(indexFile)) {
    return emptyFastPath({
      reason: "runtime_index_missing",
      diagnostics: baseDiagnostics,
    });
  }

  let payload = null;
  try {
    const snapshot = await readRuntimeSnapshot({
      indexFile,
      backend: indexBackend,
      targetRoot,
    });
    payload = snapshot.payload;
    baseDiagnostics.index_exists = true;
  } catch (error) {
    return emptyFastPath({
      reason: "runtime_index_unreadable",
      diagnostics: {
        ...baseDiagnostics,
        error: String(error.message ?? error),
      },
    });
  }

  const repairDecisions = Array.isArray(payload?.repair_decisions) ? payload.repair_decisions : [];
  const inputDigest = buildRepairLayerInputDigest({
    artifacts: Array.isArray(payload?.artifacts) ? payload.artifacts : [],
    cycles: Array.isArray(payload?.cycles) ? payload.cycles : [],
    repair_decisions: repairDecisions,
  });
  const previousMeta = payload?.repair_layer_meta && typeof payload.repair_layer_meta === "object"
    ? payload.repair_layer_meta
    : null;
  const metaCurrent = previousMeta
    && previousMeta.engine_version === REPAIR_LAYER_ENGINE_VERSION
    && previousMeta.input_digest === inputDigest;
  baseDiagnostics.repair_layer_meta_current = metaCurrent === true;
  baseDiagnostics.expected_input_digest = inputDigest;
  baseDiagnostics.cached_input_digest = previousMeta?.input_digest ?? null;
  baseDiagnostics.cached_engine_version = previousMeta?.engine_version ?? null;
  if (!metaCurrent) {
    return emptyFastPath({
      reason: previousMeta ? "repair_layer_meta_stale" : "repair_layer_meta_missing",
      diagnostics: baseDiagnostics,
    });
  }

  const findings = Array.isArray(payload?.migration_findings) ? payload.migration_findings : [];
  const warningCount = findings.filter((item) => String(item?.severity ?? "").toLowerCase() === "warning").length;
  const errorCount = findings.filter((item) => String(item?.severity ?? "").toLowerCase() === "error").length;
  baseDiagnostics.repair_findings_count = findings.length;
  baseDiagnostics.repair_warning_count = warningCount;
  baseDiagnostics.repair_error_count = errorCount;
  const repairRefresh = summarizeRepairRefreshNeed(findings, targetRoot);
  baseDiagnostics.repair_refresh_required = repairRefresh.required;
  baseDiagnostics.repair_refresh_reason = repairRefresh.reason;
  baseDiagnostics.repair_refresh_findings_count = repairRefresh.findings_count;
  if (warningCount > 0 || errorCount > 0 || findings.length > 0) {
    return emptyFastPath({
      reason: "repair_findings_open",
      diagnostics: baseDiagnostics,
    });
  }

  return emptyFastPath({
    used: true,
    reason: "unchanged_clean_runtime_index",
    diagnostics: baseDiagnostics,
  });
}

export async function runSyncDbFirstSelectiveUseCase({
  args,
  targetRoot,
  gitAdapter,
  processAdapter,
  repairLayerTriageSummaryScript,
}) {
  const stateMode = resolveStateMode(targetRoot, args.stateMode);
  const strictByState = stateMode === "dual" || stateMode === "db-only";
  const strict = args.strict || strictByState;
  const runtimePersistenceBackend = resolveRuntimePersistenceBackend(targetRoot);

  if (stateMode === "files" && !args.forceInFiles) {
    return {
      ts: new Date().toISOString(),
      ok: true,
      skipped: true,
      reason: "state_mode_files",
      target_root: targetRoot,
      state_mode: stateMode,
      strict,
    };
  }

  const auditRoot = String(args.auditRoot).replace(/\\/g, "/");
  let changedPaths = [];
  let requiresFullSync = false;
  let gitAvailable = true;
  try {
    const changed = readChangedAuditPaths(gitAdapter, targetRoot, auditRoot);
    changedPaths = changed.changedPaths;
    requiresFullSync = changed.requiresFullSync;
  } catch (error) {
    gitAvailable = false;
    if (!args.fallbackFull) {
      throw error;
    }
  }

  const summary = {
    changed_paths_count: changedPaths.length,
    candidates_count: 0,
    synced_count: 0,
    skipped_missing_count: 0,
    failed_count: 0,
  };
  const synced = [];
  const errors = [];

  if (runtimePersistenceBackend === "postgres") {
    const fastPath = emptyFastPath({
      reason: "postgres_canonical_backend",
      diagnostics: {
        changed_paths_count: changedPaths.length,
        git_available: gitAvailable === true,
        requires_full_sync: requiresFullSync === true,
        runtime_persistence_backend: "postgres",
        sqlite_decision_source: "not_used",
      },
    });
    return {
      ts: new Date().toISOString(),
      ok: true,
      skipped: true,
      reason: "postgres_canonical_backend",
      target_root: targetRoot,
      state_mode: stateMode,
      strict,
      runtime_persistence_backend: runtimePersistenceBackend,
      git_available: gitAvailable,
      fallback_full_enabled: args.fallbackFull,
      fallback_full_used: false,
      fallback_full_reason: null,
      fast_path: fastPath,
      summary,
      synced,
      errors,
      fallback: null,
      repair_layer_result: {
        action: "skipped",
        skipped: true,
        skip_reason: "postgres_canonical_backend",
      },
      repair_layer_triage_result: {
        skipped: true,
        skip_reason: "postgres_canonical_backend",
      },
    };
  }

  if (gitAvailable) {
    const auditRootAbs = path.resolve(targetRoot, auditRoot);
    for (const relRepo of changedPaths) {
      const absolute = path.resolve(targetRoot, relRepo);
      if (!absolute.startsWith(auditRootAbs)) {
        continue;
      }
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        summary.skipped_missing_count += 1;
        continue;
      }
      const relAudit = path.relative(auditRootAbs, absolute).replace(/\\/g, "/");
      summary.candidates_count += 1;
      try {
        const out = runDbFirstArtifactUseCase({
          target: targetRoot,
          path: relAudit,
          sourceFile: absolute,
          stateMode,
          sqliteFile: args.sqliteFile,
          materialize: "false",
        });
        summary.synced_count += 1;
        synced.push({
          path: relAudit,
          sha256: out.artifact?.sha256 ?? null,
          size_bytes: out.artifact?.size_bytes ?? null,
        });
      } catch (error) {
        summary.failed_count += 1;
        errors.push({
          path: relAudit,
          message: String(error.message ?? error),
        });
      }
    }
  }

  const fastPath = await evaluateNoChangeFastPath({
    args,
    targetRoot,
    stateMode,
    gitAvailable,
    changedPaths,
    requiresFullSync,
    runtimePersistenceBackend,
  });
  if (fastPath.used) {
    return {
      ts: new Date().toISOString(),
      ok: true,
      target_root: targetRoot,
      state_mode: stateMode,
      strict,
      runtime_persistence_backend: runtimePersistenceBackend,
      git_available: gitAvailable,
      fallback_full_enabled: args.fallbackFull,
      fallback_full_used: false,
      fallback_full_reason: null,
      fast_path: fastPath,
      summary,
      synced,
      errors,
      fallback: null,
      repair_layer_result: {
        action: "skipped",
        skipped: true,
        skip_reason: "fast_path_unchanged_clean_runtime_index",
      },
      repair_layer_triage_result: {
        skipped: true,
        skip_reason: "fast_path_unchanged_clean_runtime_index",
      },
    };
  }

  let fallback = null;
  const repairRefreshRequired = fastPath?.diagnostics?.repair_refresh_required === true;
  const shouldFallback = args.fallbackFull
    && (!gitAvailable || summary.failed_count > 0 || requiresFullSync || repairRefreshRequired);
  if (shouldFallback) {
    fallback = processAdapter.runJsonNodeScript(FULL_SYNC_SCRIPT, [
      "--target",
      targetRoot,
      "--state-mode",
      stateMode,
      "--json",
    ]);
  }

  let repairLayerResult = null;
  let repairLayerTriageResult = null;
  if (fallback == null && stateMode !== "files") {
    repairLayerResult = await runRepairLayerUseCase({
      args: {
        indexFile: args.sqliteFile,
        indexBackend: "sqlite",
        reportFile: args.repairLayerReportFile,
        apply: true,
      },
      targetRoot,
    });
    repairLayerTriageResult = await writeRepairLayerTriageArtifacts({
      targetRoot,
      indexFile: args.sqliteFile,
      backend: "sqlite",
      triageFile: args.repairLayerTriageFile,
      summaryFile: args.repairLayerTriageSummaryFile,
      renderScript: repairLayerTriageSummaryScript,
      runNodeScript(scriptPath, scriptArgs) {
        return processAdapter.runNodeScript(scriptPath, scriptArgs);
      },
    });
  }

  return {
    ts: new Date().toISOString(),
    ok: summary.failed_count === 0 && (fallback == null || fallback.ok !== false),
    target_root: targetRoot,
    state_mode: stateMode,
    strict,
    runtime_persistence_backend: runtimePersistenceBackend,
    git_available: gitAvailable,
    fallback_full_enabled: args.fallbackFull,
    fallback_full_used: fallback != null,
    fallback_full_reason: fallback != null
      ? (!gitAvailable
        ? "git_unavailable"
        : (summary.failed_count > 0
          ? "selective_failed"
          : (requiresFullSync
            ? "git_status_requires_full"
            : "repair_layer_tracked_not_indexed")))
      : null,
    fast_path: fastPath,
    summary,
    synced,
    errors,
    fallback,
    repair_layer_result: fallback?.repair_layer_result ?? repairLayerResult,
    repair_layer_triage_result: fallback?.repair_layer_triage_result ?? repairLayerTriageResult,
  };
}
