#!/usr/bin/env node
import {
  buildPreWriteAdmissionResult,
  mergePreWritePolicy,
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

function main() {
  try {
    verifyPolicyMerge();
    verifyResultAssembly();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
