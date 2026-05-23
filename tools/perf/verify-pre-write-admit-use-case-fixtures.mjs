#!/usr/bin/env node
import {
  addPreWriteSourceOfTruthIssue,
  buildPreWriteAdmissionResult,
  evaluatePreWriteCycleCreateGates,
  evaluatePreWriteSourceOfTruthAndRuntimeGates,
  knownPreWriteStateMode,
  mergePreWritePolicy,
  sourceOfTruthPoliciesForPreWriteAdmission,
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

function main() {
  try {
    verifyPolicyMerge();
    verifyResultAssembly();
    verifySourceOfTruthHelpers();
    verifySourceOfTruthRuntimeGates();
    verifyCycleCreateGates();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
