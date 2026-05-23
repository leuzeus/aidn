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

function normalizedScalarLocal(value) {
  return String(value ?? "").trim();
}

function canonicalUnknownLocal(value) {
  return normalizedScalarLocal(value).toLowerCase() === "unknown";
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
