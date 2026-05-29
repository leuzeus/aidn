import { getSourceOfTruthPolicy } from "../../core/source-of-truth/source-of-truth-policy.mjs";
import fs from "node:fs";
import path from "node:path";
import { resolveDbBackedMode } from "../../../tools/runtime/db-first-runtime-view-lib.mjs";

const DEFAULT_POLICY = Object.freeze({
  requireMode: true,
  requireBranchKind: false,
  requireActiveSession: false,
  requireActiveCycle: false,
  requireCycleStatus: false,
  requireDorReady: false,
  requireFirstPlanStep: false,
  requireFreshCurrentState: false,
  requireRuntimeClearInDbModes: false,
});

const SKILL_POLICIES = Object.freeze({
  "start-session": {
    requireMode: false,
  },
  "close-session": {
    requireActiveSession: true,
  },
  "branch-cycle-audit": {
    requireMode: false,
  },
  "drift-check": {
    requireMode: false,
  },
  "handoff-close": {
    requireActiveSession: false,
  },
  "cycle-create": {
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
  "cycle-close": {
    requireBranchKind: true,
    requireActiveCycle: true,
    requireCycleStatus: true,
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
  "promote-baseline": {
    requireBranchKind: true,
    requireActiveCycle: true,
    requireCycleStatus: true,
    requireDorReady: true,
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
  "requirements-delta": {
    requireActiveCycle: true,
    requireCycleStatus: true,
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
  "convert-to-spike": {
    requireActiveCycle: true,
    requireCycleStatus: true,
    requireFreshCurrentState: true,
    requireRuntimeClearInDbModes: true,
  },
});

function uniqueItems(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function canonicalNone(value) {
  return normalizeScalar(value).toLowerCase() === "none";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

export function findSessionFile(auditRoot, sessionId, targetRoot = "") {
  if (!sessionId || canonicalNone(sessionId) || canonicalUnknown(sessionId)) {
    return null;
  }
  const dbBackedMode = targetRoot ? resolveDbBackedMode(targetRoot).dbBackedMode : false;
  const sessionsDir = path.join(auditRoot, "sessions");
  if (!exists(sessionsDir) || dbBackedMode === true && !exists(sessionsDir)) {
    return null;
  }
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name));
  const direct = entries.find((entry) => entry.name.startsWith(sessionId));
  return direct ? path.join(sessionsDir, direct.name) : null;
}

export function findCycleStatus(auditRoot, cycleId, targetRoot = "") {
  if (!cycleId || canonicalNone(cycleId) || canonicalUnknown(cycleId)) {
    return null;
  }
  const dbBackedMode = targetRoot ? resolveDbBackedMode(targetRoot).dbBackedMode : false;
  const cyclesDir = path.join(auditRoot, "cycles");
  if (!exists(cyclesDir) || dbBackedMode === true && !exists(cyclesDir)) {
    return null;
  }
  const entries = fs.readdirSync(cyclesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${cycleId}-`));
  for (const entry of entries) {
    const statusPath = path.join(cyclesDir, entry.name, "status.md");
    if (exists(statusPath)) {
      return statusPath;
    }
  }
  return null;
}

export function deriveFirstPlanStep(planText) {
  const lines = String(planText).split(/\r?\n/);
  let inTasks = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "## Tasks") {
      inTasks = true;
      continue;
    }
    if (inTasks && /^##\s+/.test(line)) {
      break;
    }
    if (!inTasks) {
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered && normalizeScalar(numbered[1])) {
      return normalizeScalar(numbered[1]);
    }
    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet && normalizeScalar(bullet[1])) {
      return normalizeScalar(bullet[1]);
    }
  }
  return "unknown";
}

function summarizePorcelain(lines, limit = 3) {
  return lines.slice(0, limit).map((line) => normalizeScalar(line));
}

export function evaluateCycleCreateGitGate({ git, targetRoot }) {
  const currentBranch = normalizeScalar(git.getCurrentBranch(targetRoot) ?? "unknown") || "unknown";
  const repoRoot = normalizeScalar(typeof git.getRepoRoot === "function" ? git.getRepoRoot(targetRoot) : "") || "none";
  const repoScoped = repoRoot !== "none" && path.resolve(repoRoot) === path.resolve(targetRoot);
  const output = {
    branch: currentBranch,
    repo_root: repoRoot,
    repo_scoped: repoScoped,
    upstream_branch: "none",
    upstream_ahead: 0,
    upstream_behind: 0,
    dirty_entries: [],
    blocking_reasons: [],
    warnings: [],
  };

  try {
    const statusOutput = git.execStatusPorcelain(targetRoot, ".", true);
    output.dirty_entries = String(statusOutput)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch {
    output.warnings.push("git status is unavailable; cycle-create hygiene could not be verified automatically");
    return output;
  }

  if (output.dirty_entries.length > 0) {
    const samples = summarizePorcelain(output.dirty_entries).join(", ");
    output.blocking_reasons.push(
      `git working tree is not clean before cycle creation; reconcile pending files first (${samples}${output.dirty_entries.length > 3 ? ", ..." : ""})`,
    );
  }

  if (!repoScoped) {
    output.warnings.push("target is not the git repository root; upstream sync gate is skipped for this pre-write check");
    return output;
  }

  if (typeof git.getUpstreamBranch !== "function" || typeof git.getAheadBehind !== "function") {
    output.warnings.push("upstream sync check is unavailable in the current git adapter");
    return output;
  }

  const upstreamBranch = normalizeScalar(git.getUpstreamBranch(targetRoot) ?? "") || "none";
  output.upstream_branch = upstreamBranch;
  if (upstreamBranch === "none" || currentBranch === "unknown") {
    output.warnings.push("no upstream tracking branch is configured; push/merge reconciliation cannot be verified automatically");
    return output;
  }

  const divergence = git.getAheadBehind(targetRoot, "HEAD", upstreamBranch);
  if (divergence?.known !== true) {
    output.warnings.push(`upstream divergence for ${currentBranch} could not be determined automatically`);
    return output;
  }

  output.upstream_ahead = Number(divergence.ahead ?? 0);
  output.upstream_behind = Number(divergence.behind ?? 0);
  if (output.upstream_ahead > 0 || output.upstream_behind > 0) {
    output.blocking_reasons.push(
      `current branch ${currentBranch} diverges from ${upstreamBranch}: ahead ${output.upstream_ahead}, behind ${output.upstream_behind}; push/reconcile before creating a new cycle`,
    );
  }
  return output;
}

export function evaluateSessionIntegrationGate({ git, targetRoot, branchKind, sessionBranch, cycleBranch } = {}) {
  const output = {
    applicable: false,
    session_branch: normalizeScalar(sessionBranch ?? "") || "none",
    cycle_branch: normalizeScalar(cycleBranch ?? "") || "none",
    session_upstream_branch: "none",
    session_upstream_ahead: 0,
    session_upstream_behind: 0,
    cycle_upstream_branch: "none",
    cycle_upstream_ahead: 0,
    cycle_upstream_behind: 0,
    cycle_merged_into_session: "unknown",
    blocking_reasons: [],
    warnings: [],
  };
  if (String(branchKind).toLowerCase() !== "session") {
    return output;
  }
  output.applicable = true;
  if (canonicalNone(output.session_branch) || canonicalUnknown(output.session_branch)) {
    output.warnings.push("session integration gate could not verify the session branch");
    return output;
  }
  if (canonicalNone(output.cycle_branch) || canonicalUnknown(output.cycle_branch)) {
    output.warnings.push("session integration gate could not verify the previous cycle branch");
    return output;
  }

  const repoRoot = normalizeScalar(typeof git.getRepoRoot === "function" ? git.getRepoRoot(targetRoot) : "") || "none";
  if (repoRoot === "none" || path.resolve(repoRoot) !== path.resolve(targetRoot)) {
    output.warnings.push("session integration gate is skipped because the target is not the git repository root");
    return output;
  }
  if (typeof git.refExists !== "function" || typeof git.isAncestor !== "function") {
    output.warnings.push("session integration gate is unavailable in the current git adapter");
    return output;
  }
  if (!git.refExists(targetRoot, output.session_branch)) {
    output.warnings.push(`session branch ${output.session_branch} is not available locally`);
    return output;
  }
  if (!git.refExists(targetRoot, output.cycle_branch)) {
    output.warnings.push(`previous cycle branch ${output.cycle_branch} is not available locally`);
    return output;
  }

  const cycleUpstreamBranch = normalizeScalar(typeof git.getUpstreamBranch === "function" ? git.getUpstreamBranch(targetRoot, output.cycle_branch) : "") || "none";
  output.cycle_upstream_branch = cycleUpstreamBranch;
  if (cycleUpstreamBranch !== "none" && typeof git.getAheadBehind === "function") {
    const divergence = git.getAheadBehind(targetRoot, output.cycle_branch, cycleUpstreamBranch);
    if (divergence?.known === true) {
      output.cycle_upstream_ahead = Number(divergence.ahead ?? 0);
      output.cycle_upstream_behind = Number(divergence.behind ?? 0);
      if (output.cycle_upstream_ahead > 0 || output.cycle_upstream_behind > 0) {
        output.blocking_reasons.push(
          `previous cycle branch ${output.cycle_branch} diverges from ${cycleUpstreamBranch}: ahead ${output.cycle_upstream_ahead}, behind ${output.cycle_upstream_behind}; push/reconcile the previous cycle before creating a new one`,
        );
      }
    }
  } else {
    output.warnings.push(`previous cycle branch ${output.cycle_branch} has no upstream tracking branch; push status cannot be verified automatically`);
  }

  output.cycle_merged_into_session = git.isAncestor(targetRoot, output.cycle_branch, output.session_branch) ? "yes" : "no";
  if (output.cycle_merged_into_session !== "yes") {
    output.blocking_reasons.push(
      `previous cycle branch ${output.cycle_branch} is not merged into session branch ${output.session_branch}; merge or close/report the cycle before creating a new one`,
    );
  }

  const sessionUpstreamBranch = normalizeScalar(typeof git.getUpstreamBranch === "function" ? git.getUpstreamBranch(targetRoot, output.session_branch) : "") || "none";
  output.session_upstream_branch = sessionUpstreamBranch;
  if (sessionUpstreamBranch !== "none" && typeof git.getAheadBehind === "function") {
    const divergence = git.getAheadBehind(targetRoot, output.session_branch, sessionUpstreamBranch);
    if (divergence?.known === true) {
      output.session_upstream_ahead = Number(divergence.ahead ?? 0);
      output.session_upstream_behind = Number(divergence.behind ?? 0);
      if (output.session_upstream_ahead > 0 || output.session_upstream_behind > 0) {
        output.blocking_reasons.push(
          `session branch ${output.session_branch} diverges from ${sessionUpstreamBranch}: ahead ${output.session_upstream_ahead}, behind ${output.session_upstream_behind}; reconcile the merged session branch before creating a new cycle`,
        );
      }
    }
  } else {
    output.warnings.push(`session branch ${output.session_branch} has no upstream tracking branch; post-merge reconciliation cannot be verified automatically`);
  }

  return output;
}

export function mergePreWritePolicy(skill) {
  const specific = SKILL_POLICIES[skill] ?? {};
  return { ...DEFAULT_POLICY, ...specific };
}

const SOURCE_OF_TRUTH_ADMISSION_CONCEPTS = Object.freeze([
  "session_state",
  "cycle_state",
  "runtime_digests",
  "artifact_inventory",
  "repair_findings",
  "coordination_records",
]);

export function knownPreWriteStateMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "files" || normalized === "dual" || normalized === "db-only";
}

export function sourceOfTruthPoliciesForPreWriteAdmission(stateMode) {
  return Object.fromEntries(SOURCE_OF_TRUTH_ADMISSION_CONCEPTS.map((concept) => [
    concept,
    getSourceOfTruthPolicy(concept, stateMode),
  ]));
}

export function addPreWriteSourceOfTruthIssue({
  issues,
  warnings,
  blockingReasons,
  repairActions,
  severity,
  reasonCode,
  message,
  repairAction,
}) {
  issues.push({
    severity,
    reason_code: reasonCode,
    message,
    repair_action: repairAction,
  });
  if (repairAction) {
    repairActions.push(repairAction);
  }
  if (severity === "block") {
    blockingReasons.push(`${reasonCode}: ${message}`);
  } else {
    warnings.push(`${reasonCode}: ${message}`);
  }
}

export function derivePreWriteObservedContext({
  currentMap,
  runtimeMap,
  sharedPlanning,
  cycleStatusMap,
  effectiveStateMode,
  currentStateResolution,
  runtimeStateResolution,
  sessionResolution,
  cycleStatusResolution,
  planResolution,
  effectiveFirstPlanStep,
  normalizeUsageMatrixScope,
  normalizeUsageMatrixState,
} = {}) {
  const mode = normalizeScalarLocal(currentMap.get("mode") ?? "unknown") || "unknown";
  const branchKind = normalizeScalarLocal(currentMap.get("branch_kind") ?? "unknown") || "unknown";
  const activeSession = normalizeScalarLocal(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalarLocal(currentMap.get("active_cycle") ?? "none") || "none";
  const dorState = normalizeScalarLocal(currentMap.get("dor_state") ?? "unknown") || "unknown";
  const currentFirstPlanStep = normalizeScalarLocal(currentMap.get("first_plan_step") ?? "unknown") || "unknown";
  const activeBacklog = normalizeScalarLocal(sharedPlanning.active_backlog) || "none";
  const backlogStatus = normalizeScalarLocal(sharedPlanning.backlog_status) || "unknown";
  const backlogNextStep = normalizeScalarLocal(sharedPlanning.backlog_next_step) || "unknown";
  const backlogSelectedExecutionScope = normalizeScalarLocal(sharedPlanning.backlog_selected_execution_scope) || "none";
  const planningArbitrationStatus = normalizeScalarLocal(sharedPlanning.planning_arbitration_status) || "none";
  const cycleBranch = normalizeScalarLocal(currentMap.get("cycle_branch") ?? "none") || "none";
  const sessionBranch = normalizeScalarLocal(currentMap.get("session_branch") ?? "none") || "none";
  const runtimeStateMode = normalizeScalarLocal(runtimeMap.get("runtime_state_mode") ?? currentMap.get("runtime_state_mode") ?? effectiveStateMode ?? "unknown") || "unknown";
  const repairLayerStatus = normalizeScalarLocal(runtimeMap.get("repair_layer_status") ?? currentMap.get("repair_layer_status") ?? "unknown") || "unknown";
  const currentStateFreshness = normalizeScalarLocal(runtimeMap.get("current_state_freshness") ?? "unknown") || "unknown";
  const dorOverrideReason = normalizeScalarLocal(cycleStatusMap.get("dor_override_reason") ?? "none") || "none";
  const mappedCycleBranch = normalizeScalarLocal(cycleStatusMap.get("branch_name") ?? "none") || "none";
  const usageMatrixScope = normalizeUsageMatrixScope(cycleStatusMap.get("usage_matrix_scope") ?? "local");
  const usageMatrixState = normalizeUsageMatrixState(cycleStatusMap.get("usage_matrix_state") ?? "NOT_DEFINED");
  const usageMatrixSummary = normalizeScalarLocal(cycleStatusMap.get("usage_matrix_summary") ?? "none") || "none";
  const usageMatrixRationale = normalizeScalarLocal(cycleStatusMap.get("usage_matrix_rationale") ?? "none") || "none";
  const cycleState = normalizeScalarLocal(cycleStatusMap.get("state") ?? "unknown").toUpperCase() || "UNKNOWN";
  const sourceOfTruthIssues = [];
  const sourceOfTruthRepairActions = [];
  const sourceOfTruth = {
    state_mode: effectiveStateMode,
    runtime_state_mode: runtimeStateMode,
    concepts: sourceOfTruthPoliciesForPreWriteAdmission(effectiveStateMode),
    observed_sources: {
      current_state: currentStateResolution.source,
      runtime_state: runtimeStateResolution.source,
      session_artifact: sessionResolution.source,
      cycle_status: cycleStatusResolution.source,
      plan_artifact: planResolution.source,
    },
    issues: sourceOfTruthIssues,
    repair_actions: sourceOfTruthRepairActions,
  };
  return {
    mode,
    branchKind,
    activeSession,
    activeCycle,
    dorState,
    currentFirstPlanStep,
    effectiveFirstPlanStep,
    activeBacklog,
    backlogStatus,
    backlogNextStep,
    backlogSelectedExecutionScope,
    planningArbitrationStatus,
    cycleBranch,
    sessionBranch,
    runtimeStateMode,
    repairLayerStatus,
    currentStateFreshness,
    dorOverrideReason,
    mappedCycleBranch,
    usageMatrixScope,
    usageMatrixState,
    usageMatrixSummary,
    usageMatrixRationale,
    cycleState,
    sourceOfTruth,
    sourceOfTruthIssues,
    sourceOfTruthRepairActions,
  };
}

export function evaluatePreWriteSourceOfTruthAndRuntimeGates({
  checks,
  addCheck,
  sourceOfTruth,
  sourceOfTruthIssues,
  sourceOfTruthRepairActions,
  warnings,
  blockingReasons,
  runtimeStateExists,
  runtimeStateResolution,
  runtimeStateMode,
  effectiveStateMode,
  repairLayerStatus,
  currentStateFreshness,
  blockingFindings = [],
  policy,
  runtimeRepairRouting,
  repairHints,
  classifyRepairFindingSummary,
} = {}) {
  const sourceOfTruthPoliciesResolved = Object.values(sourceOfTruth.concepts).every(Boolean);
  addCheck(checks, "source_of_truth_policy_resolved", sourceOfTruthPoliciesResolved, sourceOfTruthPoliciesResolved
    ? `source-of-truth policy resolved for ${Object.keys(sourceOfTruth.concepts).join(", ")}`
    : "source-of-truth policy missing for one or more admission concepts", {
      reason_code: sourceOfTruthPoliciesResolved ? "SOT_POLICY_RESOLVED" : "SOT_POLICY_MISSING",
    });
  if (!sourceOfTruthPoliciesResolved) {
    addPreWriteSourceOfTruthIssue({
      issues: sourceOfTruthIssues,
      warnings,
      blockingReasons,
      repairActions: sourceOfTruthRepairActions,
      severity: "block",
      reasonCode: "SOT_POLICY_MISSING",
      message: "source-of-truth policy is incomplete for pre-write admission",
      repairAction: "complete src/core/source-of-truth/source-of-truth-policy.mjs and rerun npm run perf:verify-source-of-truth-policy",
    });
  }

  const normalizedRuntimeStateMode = String(runtimeStateMode ?? "").trim().toLowerCase();
  const runtimeModeAligned = !runtimeStateExists
    || canonicalUnknownLocal(runtimeStateMode)
    || !knownPreWriteStateMode(runtimeStateMode)
    || normalizedRuntimeStateMode === effectiveStateMode;
  addCheck(checks, "source_of_truth_state_mode_alignment", runtimeModeAligned, runtimeModeAligned
    ? `effective_state_mode=${effectiveStateMode}; runtime_state_mode=${runtimeStateMode}`
    : `effective_state_mode=${effectiveStateMode}; runtime_state_mode=${runtimeStateMode}`, {
      reason_code: runtimeModeAligned ? "SOT_STATE_MODE_ALIGNED" : "SOT_STATE_MODE_MISMATCH",
    });
  if (!runtimeModeAligned) {
    const severity = effectiveStateMode === "db-only" || normalizedRuntimeStateMode === "db-only" ? "block" : "warn";
    addPreWriteSourceOfTruthIssue({
      issues: sourceOfTruthIssues,
      warnings,
      blockingReasons,
      repairActions: sourceOfTruthRepairActions,
      severity,
      reasonCode: "SOT_STATE_MODE_MISMATCH",
      message: `effective state mode ${effectiveStateMode} diverges from runtime digest mode ${runtimeStateMode}`,
      repairAction: "regenerate or import the runtime digest for the selected state mode before mutating workflow artifacts",
    });
  }

  const dbOnlyProjectionReads = effectiveStateMode === "db-only"
    ? Object.entries(sourceOfTruth.observed_sources)
      .filter(([key, value]) => key !== "plan_artifact" && value === "file")
      .map(([key]) => key)
    : [];
  const dbOnlySourcesCanonical = dbOnlyProjectionReads.length === 0;
  addCheck(checks, "source_of_truth_db_only_source_alignment", dbOnlySourcesCanonical, dbOnlySourcesCanonical
    ? `effective_state_mode=${effectiveStateMode}; no db-only projection-only source reads detected`
    : `db-only admission read Markdown projections for ${dbOnlyProjectionReads.join(", ")}`, {
      reason_code: dbOnlySourcesCanonical ? "SOT_DB_ONLY_SOURCES_ALIGNED" : "SOT_DB_ONLY_PROJECTION_READ",
    });
  if (dbOnlyProjectionReads.length > 0) {
    addPreWriteSourceOfTruthIssue({
      issues: sourceOfTruthIssues,
      warnings,
      blockingReasons,
      repairActions: sourceOfTruthRepairActions,
      severity: "warn",
      reasonCode: "SOT_DB_ONLY_PROJECTION_READ",
      message: `db-only mode resolved projection files for ${dbOnlyProjectionReads.join(", ")}`,
      repairAction: "refresh the runtime DB/index and rerun the projector with explicit write semantics when a Markdown projection is required",
    });
  }

  addCheck(checks, "runtime_repair_status_known", !canonicalUnknownLocal(repairLayerStatus), `repair_layer_status=${repairLayerStatus}`);
  addCheck(checks, "current_state_freshness_known", !canonicalUnknownLocal(currentStateFreshness), `current_state_freshness=${currentStateFreshness}`);

  if (runtimeRepairRouting.routing_hint === repairHints.REPAIR) {
    blockingReasons.push(blockingFindings.length > 0
      ? `repair layer is blocking: ${blockingFindings.join(", ")}`
      : "repair layer is blocking");
  } else if (runtimeRepairRouting.routing_hint === repairHints.AUDIT_FIRST) {
    const repairSpecificWarning = blockingFindings
      .map((item) => classifyRepairFindingSummary(item))
      .find(Boolean);
    if (repairSpecificWarning) {
      warnings.push(repairSpecificWarning);
    }
  }

  if (policy.requireFreshCurrentState) {
    if (normalizeScalarLocal(currentStateFreshness).toLowerCase() === "stale") {
      blockingReasons.push("CURRENT-STATE.md is stale according to RUNTIME-STATE.md");
    } else if (canonicalUnknownLocal(currentStateFreshness)) {
      if (["dual", "db-only"].includes(normalizedRuntimeStateMode)) {
        blockingReasons.push("current state freshness is unknown in DB-backed mode");
      } else {
        warnings.push("current state freshness is unknown; confirm live session/cycle facts before writing");
      }
    }
  }

  if (policy.requireRuntimeClearInDbModes && ["dual", "db-only"].includes(normalizedRuntimeStateMode)) {
    if (!runtimeStateExists) {
      blockingReasons.push("runtime digest is missing in DB-backed mode");
    }
    if (canonicalUnknownLocal(repairLayerStatus)) {
      blockingReasons.push("repair layer status is unknown in DB-backed mode");
    }
  }
}

export function evaluatePreWriteCycleCreateGates({
  checks,
  addCheck,
  blockingReasons,
  warnings,
  cycleCreateGitGate = null,
  sessionIntegrationGate = null,
  skill = "",
  activeBacklog = "none",
  backlogStatus = "unknown",
  backlogSelectedExecutionScope = "none",
  planningArbitrationStatus = "none",
  canonicalNone,
  canonicalUnknown,
  summarizePorcelain,
} = {}) {
  if (cycleCreateGitGate) {
    addCheck(checks, "git_cycle_create_clean", cycleCreateGitGate.dirty_entries.length === 0, cycleCreateGitGate.dirty_entries.length === 0
      ? "git working tree is clean for cycle creation"
      : `pending files detected before cycle creation: ${summarizePorcelain(cycleCreateGitGate.dirty_entries).join(", ")}`);
    addCheck(checks, "git_cycle_create_upstream_sync", cycleCreateGitGate.upstream_ahead === 0 && cycleCreateGitGate.upstream_behind === 0, cycleCreateGitGate.upstream_branch === "none"
      ? "upstream sync not configured"
      : `upstream=${cycleCreateGitGate.upstream_branch}; ahead=${cycleCreateGitGate.upstream_ahead}; behind=${cycleCreateGitGate.upstream_behind}`);
    blockingReasons.push(...cycleCreateGitGate.blocking_reasons);
    warnings.push(...cycleCreateGitGate.warnings);
  }

  if (sessionIntegrationGate?.applicable) {
    addCheck(checks, "cycle_create_previous_cycle_merged_into_session", sessionIntegrationGate.cycle_merged_into_session === "yes", `cycle_merged_into_session=${sessionIntegrationGate.cycle_merged_into_session}`);
    addCheck(checks, "cycle_create_session_branch_reconciled", sessionIntegrationGate.session_upstream_ahead === 0 && sessionIntegrationGate.session_upstream_behind === 0, sessionIntegrationGate.session_upstream_branch === "none"
      ? "session upstream sync not configured"
      : `session_upstream=${sessionIntegrationGate.session_upstream_branch}; ahead=${sessionIntegrationGate.session_upstream_ahead}; behind=${sessionIntegrationGate.session_upstream_behind}`);
    addCheck(checks, "cycle_create_previous_cycle_branch_pushed", sessionIntegrationGate.cycle_upstream_ahead === 0 && sessionIntegrationGate.cycle_upstream_behind === 0, sessionIntegrationGate.cycle_upstream_branch === "none"
      ? "cycle upstream sync not configured"
      : `cycle_upstream=${sessionIntegrationGate.cycle_upstream_branch}; ahead=${sessionIntegrationGate.cycle_upstream_ahead}; behind=${sessionIntegrationGate.cycle_upstream_behind}`);
    blockingReasons.push(...sessionIntegrationGate.blocking_reasons);
    warnings.push(...sessionIntegrationGate.warnings);
  }

  const promotedSharedPlanning = !canonicalNone(activeBacklog)
    && !canonicalUnknown(activeBacklog)
    && !canonicalNone(backlogStatus)
    && !canonicalUnknown(backlogStatus)
    && String(backlogStatus).toLowerCase() !== "closed"
    && String(backlogStatus).toLowerCase() !== "consumed_by_cycle";
  addCheck(checks, "shared_planning_scope_selected", !promotedSharedPlanning || (!canonicalNone(backlogSelectedExecutionScope) && !canonicalUnknown(backlogSelectedExecutionScope)), `backlog_selected_execution_scope=${backlogSelectedExecutionScope}`);
  if (skill === "cycle-create" && promotedSharedPlanning) {
    if (!isResolvedPlanningArbitrationStatusLocal(planningArbitrationStatus)) {
      blockingReasons.push(`shared planning arbitration remains unresolved: ${planningArbitrationStatus}`);
    }
    if (canonicalNone(backlogSelectedExecutionScope) || canonicalUnknown(backlogSelectedExecutionScope)) {
      blockingReasons.push("shared planning does not define a selected execution scope for cycle creation");
    } else if (String(backlogSelectedExecutionScope).toLowerCase() !== "new_cycle") {
      blockingReasons.push(`shared planning selected execution scope is ${backlogSelectedExecutionScope}; cycle-create requires new_cycle`);
    }
  }
}

export function evaluatePreWriteGenericWorkflowGates({
  checks,
  addCheck,
  blockingReasons,
  warnings,
  policy,
  skill = "",
  mode,
  branchKind,
  activeSession,
  activeCycle,
  sessionResolution,
  cycleStatusResolution,
  effectiveFirstPlanStep,
  currentFirstPlanStep,
  derivedFirstPlanStep,
  dorState,
  dorOverrideReason,
  cycleState = "UNKNOWN",
  usageMatrixScope = "local",
  usageMatrixState = "NOT_DEFINED",
  usageMatrixRationale = "none",
  activeCycleLabel = "unknown",
  cycleBranch = "none",
  mappedCycleBranch = "none",
  canonicalNone,
  canonicalUnknown,
  usageMatrixSatisfied,
} = {}) {
  addCheck(checks, "mode_known", !canonicalUnknown(mode), `mode=${mode}`);
  if (policy.requireMode && canonicalUnknown(mode)) {
    blockingReasons.push("mode is unknown");
  }

  addCheck(checks, "branch_kind_known", !canonicalUnknown(branchKind), `branch_kind=${branchKind}`);
  if (policy.requireBranchKind && canonicalUnknown(branchKind)) {
    blockingReasons.push("branch kind is unknown");
  }

  addCheck(checks, "active_session_known", !canonicalUnknown(activeSession), `active_session=${activeSession}`);
  if (policy.requireActiveSession && (canonicalUnknown(activeSession) || canonicalNone(activeSession))) {
    blockingReasons.push("active session is missing");
  }

  addCheck(checks, "active_cycle_known", !canonicalUnknown(activeCycle) && !canonicalNone(activeCycle), `active_cycle=${activeCycle}`);
  if (policy.requireActiveCycle && (canonicalUnknown(activeCycle) || canonicalNone(activeCycle))) {
    blockingReasons.push("active cycle is missing");
  }

  addCheck(checks, "session_file_exists", sessionResolution.exists, sessionResolution.exists
    ? `session artifact resolved via ${sessionResolution.source}: ${sessionResolution.logicalPath}`
    : "session file not resolved");
  if (policy.requireActiveSession && !sessionResolution.exists) {
    blockingReasons.push("active session file is missing");
  }

  addCheck(checks, "cycle_status_exists", cycleStatusResolution.exists, cycleStatusResolution.exists
    ? `cycle status resolved via ${cycleStatusResolution.source}: ${cycleStatusResolution.logicalPath}`
    : "cycle status file not resolved");
  if (policy.requireCycleStatus && !cycleStatusResolution.exists) {
    blockingReasons.push("active cycle status file is missing");
  }

  addCheck(checks, "first_plan_step_known", !canonicalUnknown(effectiveFirstPlanStep) && !canonicalNone(effectiveFirstPlanStep), `first_plan_step=${effectiveFirstPlanStep}`);
  if (policy.requireFirstPlanStep && (canonicalUnknown(effectiveFirstPlanStep) || canonicalNone(effectiveFirstPlanStep))) {
    blockingReasons.push("first implementation step is unknown");
  }
  if (!canonicalUnknown(currentFirstPlanStep) && !canonicalUnknown(derivedFirstPlanStep)
    && !canonicalNone(currentFirstPlanStep) && !canonicalNone(derivedFirstPlanStep)
    && currentFirstPlanStep !== derivedFirstPlanStep) {
    warnings.push("CURRENT-STATE.md first_plan_step differs from the first parseable plan task");
  }

  addCheck(checks, "dor_ready_or_override", dorState === "READY" || !canonicalNone(dorOverrideReason), `dor_state=${dorState}; dor_override_reason=${dorOverrideReason}`);
  if (policy.requireDorReady && dorState !== "READY" && canonicalNone(dorOverrideReason)) {
    blockingReasons.push("dor_state is not READY and no override reason is documented");
  } else if (policy.requireDorReady && dorState !== "READY" && !canonicalNone(dorOverrideReason)) {
    warnings.push(`DoR override in effect: ${dorOverrideReason}`);
  }

  addCheck(
    checks,
    "usage_matrix_close_or_promotion_ready",
    (skill !== "cycle-close" && skill !== "promote-baseline")
      || String(cycleState).toUpperCase() !== "DONE"
      || usageMatrixSatisfied({
        scope: usageMatrixScope,
        state: usageMatrixState,
        rationale: usageMatrixRationale,
      }),
    `usage_matrix_scope=${usageMatrixScope}; usage_matrix_state=${usageMatrixState}`,
  );
  if (
    (skill === "cycle-close" || skill === "promote-baseline")
    && String(cycleState).toUpperCase() === "DONE"
    && !usageMatrixSatisfied({
      scope: usageMatrixScope,
      state: usageMatrixState,
      rationale: usageMatrixRationale,
    })
  ) {
    blockingReasons.push(
      skill === "promote-baseline"
        ? `cycle ${activeCycleLabel} is marked DONE but usage matrix is not complete for promote-baseline (scope=${usageMatrixScope}, state=${usageMatrixState})`
        : `cycle ${activeCycleLabel} is marked DONE but usage matrix is not complete for cycle-close (scope=${usageMatrixScope}, state=${usageMatrixState})`,
    );
  }

  if (!canonicalNone(cycleBranch) && !canonicalNone(mappedCycleBranch) && !canonicalUnknown(mappedCycleBranch)
    && cycleBranch !== mappedCycleBranch) {
    blockingReasons.push(`cycle branch mismatch: CURRENT-STATE=${cycleBranch} status.md=${mappedCycleBranch}`);
  }
}

function normalizeScalarLocal(value) {
  return String(value ?? "").trim();
}

function canonicalUnknownLocal(value) {
  return normalizeScalarLocal(value).toLowerCase() === "unknown";
}

function isResolvedPlanningArbitrationStatusLocal(value) {
  const normalized = normalizeScalarLocal(value).toLowerCase();
  return !normalized
    || normalized === "none"
    || normalized === "resolved"
    || normalized === "closed"
    || normalized === "approved"
    || normalized === "cleared";
}

export function buildPreWriteAdmissionResult({
  targetRoot,
  workspace,
  sharedStateBackend = null,
  sharedRuntimeValidation,
  skill = "",
  policy,
  sourceOfTruth,
  currentStateExists = false,
  runtimeStateExists = false,
  currentStateResolution,
  runtimeStateResolution,
  sessionResolution,
  cycleStatusResolution,
  planResolution,
  context,
  checks,
  blockingReasons = [],
  warnings = [],
  blockingFindings = [],
  prioritizedArtifacts = [],
  sourceOfTruthIssues = [],
  sourceOfTruthRepairActions = [],
} = {}) {
  const ok = blockingReasons.length === 0;
  const admissionStatus = ok
    ? (warnings.length > 0 ? "admitted_with_warnings" : "admitted")
    : "blocked";
  const sourceOfTruthStatus = sourceOfTruthIssues.some((item) => item.severity === "block")
    ? "block"
    : sourceOfTruthIssues.some((item) => item.severity === "warn")
      ? "warn"
      : "clear";
  sourceOfTruth.repair_actions = uniqueItems(sourceOfTruthRepairActions);

  return {
    ok,
    admission_status: admissionStatus,
    target_root: targetRoot,
    workspace,
    shared_state_backend: sharedStateBackend,
    shared_runtime_validation: sharedRuntimeValidation,
    skill: skill || "generic",
    policy,
    source_of_truth: sourceOfTruth,
    current_state_file: currentStateExists ? currentStateResolution.logicalPath : "none",
    runtime_state_file: runtimeStateExists ? runtimeStateResolution.logicalPath : "none",
    session_file: sessionResolution.exists ? sessionResolution.logicalPath : "none",
    cycle_status_file: cycleStatusResolution.exists ? cycleStatusResolution.logicalPath : "none",
    plan_file: planResolution.exists ? planResolution.logicalPath : "none",
    context: {
      ...context,
      source_of_truth_status: sourceOfTruthStatus,
      source_of_truth_reason_codes: uniqueItems(sourceOfTruthIssues.map((item) => item.reason_code)).join(", ") || "none",
    },
    checks,
    blocking_reasons: blockingReasons,
    warnings,
    blocking_findings: blockingFindings,
    prioritized_artifacts: prioritizedArtifacts,
  };
}
