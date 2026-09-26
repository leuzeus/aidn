#!/usr/bin/env node
import {
  addPreWriteSourceOfTruthIssue,
  buildPreWriteAdmissionResult,
  evaluatePreWriteCycleCreateGates,
  evaluatePreWriteGenericWorkflowGates,
  evaluatePreWriteSourceOfTruthAndRuntimeGates,
  knownPreWriteStateMode,
  mergePreWritePolicy,
  sourceOfTruthPoliciesForPreWriteAdmission,
  verifyInitialCycleContext,
} from "../../src/application/runtime/pre-write-admit-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyPolicyMerge() {
  const generic = mergePreWritePolicy("unknown-skill");
  const cycleCreate = mergePreWritePolicy("cycle-create");
  assert(generic.requireMode === true, "generic policy should keep default mode gate");
  assert(cycleCreate.requireFreshCurrentState === true, "cycle-create should require fresh current state");
  assert(cycleCreate.requireRuntimeClearInDbModes === true, "cycle-create should require runtime clear in DB modes");
  assert(cycleCreate.allowInitialCycleFreshness && !generic.allowInitialCycleFreshness, "initial cycle handling belongs only to cycle-create");
}

function verifyInitialCycleContextBoundary() {
  const current = { active_cycle: "none", cycle_branch: "none", active_session: "S101",
    branch_kind: "session", session_branch: "S101-initial", mode: "THINKING", updated_at: "2026-09-25" };
  const sessionText = "## WORK MODE - THINKING\nsession_branch: S101-initial\ncycle_branch: none\nprimary_focus_cycle: none\n";
  const base = { skill: "cycle-create", effectiveStateMode: "db-only", currentMap: new Map(Object.entries(current)),
    currentStateResolution: { exists: true, source: "postgres" }, runtimeStateResolution: { exists: true, source: "postgres" },
    sessionResolution: { exists: true, source: "postgres", logicalPath: "docs/audit/sessions/S101-initial.md", text: sessionText }, currentBranch: "S101-initial" };
  assert(verifyInitialCycleContext(base), "canonical PostgreSQL initial session must be recognized");
  for (const [key, value] of [["active_cycle", "unknown"], ["active_cycle", ""], ["active_cycle", "C101"],
    ["cycle_branch", "feature/C101"], ["active_session", "none"], ["updated_at", "invalid"], ["branch_kind", "cycle"], ["session_branch", "other"]]) {
    assert(!verifyInitialCycleContext({ ...base, currentMap: new Map(Object.entries({ ...current, [key]: value })) }), `initial cycle must reject ${key}=${value}`);
  }
  for (const key of ["currentStateResolution", "runtimeStateResolution", "sessionResolution"]) {
    assert(!verifyInitialCycleContext({ ...base, [key]: { ...base[key], exists: false } }), `initial cycle must reject missing ${key}`);
    assert(!verifyInitialCycleContext({ ...base, [key]: { ...base[key], source: "file" } }), `initial cycle must reject file fallback for ${key}`);
  }
  for (const skill of ["cycle-close", "requirements-delta", "promote-baseline", "context-reload"]) {
    assert(!verifyInitialCycleContext({ ...base, skill }), `initial handling must not admit ${skill}`);
  }
  for (const text of [sessionText.replace("THINKING", "COMMITTING"), sessionText.replace("primary_focus_cycle: none", "primary_focus_cycle: C101"),
    sessionText.replace("primary_focus_cycle: none", ""), sessionText + "integration_target_cycle: C101\n"]) {
    assert(!verifyInitialCycleContext({ ...base, sessionResolution: { ...base.sessionResolution, text } }), "session inconsistency must not qualify as initial");
  }
  assert(!verifyInitialCycleContext({ ...base, currentBranch: "other" }), "physical branch must agree");
  assert(!verifyInitialCycleContext({ ...base, sessionResolution: { ...base.sessionResolution, logicalPath: "docs/audit/sessions/S1010-other.md" } }), "a session ID prefix collision is not the same session");
}

function verifyResultAssembly() {
  const result = buildPreWriteAdmissionResult({
    targetRoot: "G:/fixture/project",
    workspace: { workspace_id: "workspace-1" },
    sharedStateBackend: null,
    sharedRuntimeValidation: { status: "clear" },
    skill: "cycle-create",
    policy: mergePreWritePolicy("cycle-create"),
    sourceOfTruth: { concepts: {}, observed_sources: {} },
    currentStateExists: true,
    runtimeStateExists: true,
    currentStateResolution: { logicalPath: "docs/audit/CURRENT-STATE.md" },
    runtimeStateResolution: { logicalPath: "docs/audit/RUNTIME-STATE.md" },
    sessionResolution: { exists: true, logicalPath: "docs/audit/sessions/S101.md", source: "file" },
    cycleStatusResolution: { exists: true, logicalPath: "docs/audit/cycles/C101/status.md", source: "file" },
    planResolution: { exists: false, logicalPath: "none", source: "missing" },
    context: {
      mode: "COMMITTING",
      repair_layer_status: "ok",
      current_state_freshness: "ok",
    },
    checks: {},
    blockingReasons: [],
    warnings: ["warning"],
    blockingFindings: [],
    prioritizedArtifacts: ["docs/audit/CURRENT-STATE.md"],
    sourceOfTruthIssues: [{ severity: "warn", reason_code: "SOT_WARN" }],
    sourceOfTruthRepairActions: ["refresh policy"],
  });

  assert(result.ok === true, "warning-only result should stay ok");
  assert(result.admission_status === "admitted_with_warnings", "warning-only result should advertise warnings");
  assert(result.skill === "cycle-create", "result should preserve skill");
  assert(result.context.source_of_truth_status === "warn", "result should derive source_of_truth_status");
  assert(result.source_of_truth.repair_actions.includes("refresh policy"), "result should preserve repair actions");
}

function verifySourceOfTruthHelpers() {
  const policies = sourceOfTruthPoliciesForPreWriteAdmission("dual");
  assert(Boolean(policies.session_state), "pre-write source-of-truth helper should resolve session_state policy");
  assert(knownPreWriteStateMode("db-only") === true, "db-only should be a known pre-write state mode");
  assert(knownPreWriteStateMode("weird") === false, "unknown mode should not be accepted");
  const issues = [];
  const warnings = [];
  const blockingReasons = [];
  const repairActions = [];
  addPreWriteSourceOfTruthIssue({
    issues,
    warnings,
    blockingReasons,
    repairActions,
    severity: "warn",
    reasonCode: "SOT_WARN",
    message: "warn message",
    repairAction: "repair step",
  });
  assert(issues.length === 1, "source-of-truth issue helper should collect issues");
  assert(warnings.includes("SOT_WARN: warn message"), "source-of-truth issue helper should add warning text");
  assert(repairActions.includes("repair step"), "source-of-truth issue helper should keep repair action");
}

function verifySourceOfTruthRuntimeGates() {
  const checks = {};
  const warnings = [];
  const blockingReasons = [];
  const sourceOfTruthIssues = [];
  const sourceOfTruthRepairActions = [];
  const sourceOfTruth = {
    concepts: sourceOfTruthPoliciesForPreWriteAdmission("db-only"),
    observed_sources: {
      current_state: "file",
      runtime_state: "sqlite",
      session_artifact: "sqlite",
      cycle_status: "sqlite",
      plan_artifact: "sqlite",
    },
  };
  const addCheck = (target, key, pass, details, extra = {}) => {
    target[key] = { pass, details, ...extra };
  };
  evaluatePreWriteSourceOfTruthAndRuntimeGates({
    checks,
    addCheck,
    sourceOfTruth,
    sourceOfTruthIssues,
    sourceOfTruthRepairActions,
    warnings,
    blockingReasons,
    runtimeStateExists: true,
    runtimeStateMode: "files",
    effectiveStateMode: "db-only",
    repairLayerStatus: "warn",
    currentStateFreshness: "unknown",
    blockingFindings: [],
    policy: mergePreWritePolicy("cycle-create"),
    runtimeRepairRouting: { routing_hint: "audit-first" },
    repairHints: { REPAIR: "repair", AUDIT_FIRST: "audit-first" },
    classifyRepairFindingSummary() {
      return null;
    },
  });
  assert(checks.source_of_truth_policy_resolved.pass === true, "SoT/runtime gate should resolve policies");
  assert(checks.source_of_truth_state_mode_alignment.pass === false, "SoT/runtime gate should detect state mode mismatch");
  assert(blockingReasons.some((item) => item.includes("SOT_STATE_MODE_MISMATCH")), "SoT/runtime gate should emit mismatch block");
  assert(warnings.some((item) => item.includes("SOT_DB_ONLY_PROJECTION_READ")), "SoT/runtime gate should warn on db-only projection reads");
}

function verifyCycleCreateGates() {
  const checks = {};
  const blockingReasons = [];
  const warnings = [];
  const addCheck = (target, key, pass, details, extra = {}) => {
    target[key] = { pass, details, ...extra };
  };
  evaluatePreWriteCycleCreateGates({
    checks,
    addCheck,
    blockingReasons,
    warnings,
    cycleCreateGitGate: {
      dirty_entries: [" M docs/audit/CURRENT-STATE.md"],
      upstream_branch: "origin/feature/C101-alpha",
      upstream_ahead: 1,
      upstream_behind: 0,
      blocking_reasons: ["git working tree is not clean before cycle creation"],
      warnings: [],
    },
    sessionIntegrationGate: {
      applicable: true,
      cycle_merged_into_session: "no",
      session_upstream_branch: "origin/S101-alpha",
      session_upstream_ahead: 0,
      session_upstream_behind: 0,
      cycle_upstream_branch: "origin/feature/C101-alpha",
      cycle_upstream_ahead: 1,
      cycle_upstream_behind: 0,
      blocking_reasons: ["previous cycle branch feature/C101-alpha is not merged into session branch S101-alpha"],
      warnings: [],
    },
    skill: "cycle-create",
    activeBacklog: "backlog/BL-S101-session-planning.md",
    backlogStatus: "promoted",
    backlogSelectedExecutionScope: "none",
    planningArbitrationStatus: "none",
    canonicalNone(value) {
      return String(value ?? "").trim().toLowerCase() === "none";
    },
    canonicalUnknown(value) {
      return String(value ?? "").trim().toLowerCase() === "unknown";
    },
    summarizePorcelain(values) {
      return values;
    },
  });
  assert(checks.git_cycle_create_clean.pass === false, "cycle-create gates should expose dirty git check");
  assert(checks.cycle_create_previous_cycle_merged_into_session.pass === false, "cycle-create gates should expose unmerged previous cycle");
  assert(blockingReasons.some((item) => item.includes("selected execution scope")), "cycle-create gates should require execution scope");
}

function verifyGenericWorkflowGates() {
  const checks = {};
  const blockingReasons = [];
  const warnings = [];
  const addCheck = (target, key, pass, details, extra = {}) => {
    target[key] = { pass, details, ...extra };
  };
  evaluatePreWriteGenericWorkflowGates({
    checks,
    addCheck,
    blockingReasons,
    warnings,
    policy: mergePreWritePolicy("promote-baseline"),
    skill: "promote-baseline",
    mode: "COMMITTING",
    branchKind: "unknown",
    activeSession: "S101",
    activeCycle: "C101",
    sessionResolution: { exists: true, source: "file", logicalPath: "docs/audit/sessions/S101.md" },
    cycleStatusResolution: { exists: true, source: "file", logicalPath: "docs/audit/cycles/C101/status.md" },
    effectiveFirstPlanStep: "implement alpha feature validation",
    currentFirstPlanStep: "step-a",
    derivedFirstPlanStep: "step-b",
    dorState: "NOT_READY",
    dorOverrideReason: "none",
    cycleState: "DONE",
    usageMatrixScope: "shared",
    usageMatrixState: "NOT_DEFINED",
    usageMatrixRationale: "none",
    activeCycleLabel: "C101",
    cycleBranch: "feature/C101-alpha",
    mappedCycleBranch: "feature/C101-other",
    canonicalNone(value) {
      return String(value ?? "").trim().toLowerCase() === "none";
    },
    canonicalUnknown(value) {
      return String(value ?? "").trim().toLowerCase() === "unknown";
    },
    usageMatrixSatisfied() {
      return false;
    },
  });
  assert(checks.branch_kind_known.pass === false, "generic gates should expose branch kind drift");
  assert(blockingReasons.some((item) => item.includes("branch kind is unknown")), "generic gates should require branch kind when policy does");
  assert(blockingReasons.some((item) => item.includes("dor_state is not READY")), "generic gates should enforce DoR");
  assert(blockingReasons.some((item) => item.includes("usage matrix is not complete")), "generic gates should enforce usage matrix");
  assert(blockingReasons.some((item) => item.includes("cycle branch mismatch")), "generic gates should surface branch mismatch");
  assert(warnings.some((item) => item.includes("first_plan_step differs")), "generic gates should warn on plan step drift");
}

function main() {
  try {
    verifyPolicyMerge();
    verifyInitialCycleContextBoundary();
    verifyResultAssembly();
    verifySourceOfTruthHelpers();
    verifySourceOfTruthRuntimeGates();
    verifyCycleCreateGates();
    verifyGenericWorkflowGates();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
