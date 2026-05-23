import { getSourceOfTruthPolicy } from "../../core/source-of-truth/source-of-truth-policy.mjs";

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
    if (normalizedScalarLocal(currentStateFreshness).toLowerCase() === "stale") {
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

function normalizedScalarLocal(value) {
  return String(value ?? "").trim();
}

function canonicalUnknownLocal(value) {
  return normalizedScalarLocal(value).toLowerCase() === "unknown";
}

function isResolvedPlanningArbitrationStatusLocal(value) {
  const normalized = normalizedScalarLocal(value).toLowerCase();
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
