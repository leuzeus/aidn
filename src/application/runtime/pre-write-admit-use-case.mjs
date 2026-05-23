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
