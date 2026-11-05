#!/usr/bin/env node
import { verifyModeWorkContinuationExecution } from "./standard-mode-work-continuation-execution-fixture-lib.mjs";
import { verifyStandardSpikeExecution } from "./standard-spike-execution-fixture-lib.mjs";
import { createStandardReviewEventFixture } from "./standard-pr-review-event-fixture-lib.mjs";
import { verifyModeAnalysisExecution } from "./standard-mode-analysis-execution-fixture-lib.mjs";
import { arrangeStandardReviewScenario, assertCapturedStandardReviewScenario, standardReviewScenarioAnswer } from "./standard-pr-review-scenario-fixture-lib.mjs";
import { preflightStandardComposedFixture } from "./standard-composed-preflight-fixture-lib.mjs";
import { composedCyclePlan, composedCycleValidationProfile, composedCorrectionChoice, prepareComposedNativeAnswer, composedTriageAnswer } from "./standard-composed-cycle-fixture-lib.mjs";
import { observeComposedHost, loseCheckpointReceipt, loseCheckpointOwnerReleaseAck } from "./standard-composed-observation-fixture-lib.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { attachCycleCloseHookModel } from "./cycle-close-hook-fixture-lib.mjs";
import { attachCycleCloseRecordModel } from "./cycle-close-record-fixture-lib.mjs";
import { attachCycleClosureModel, closureHumanSource } from "./cycle-closure-fixture-lib.mjs";
import { attachCycleAuditModel, cycleAuditProposal } from "./cycle-audit-fixture-lib.mjs";
import { CYCLE_AUDIT_CONTRACT } from "../../src/core/workflow/standard-cycle-audit.mjs";
import { verifyCycleVerificationContracts } from "./cycle-verification-fixture-lib.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import assert from "node:assert/strict";
import { createComposedGithubReviewFixture } from "./github-review-evidence-fixture-lib.mjs";
import { CYCLE_PLAN_CONTRACT } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { taskProgressModel } from "./cycle-task-progress-fixture-lib.mjs";
import { CYCLE_WORK_CONTRACT, CYCLE_TASK_WORK_CONTRACT } from "../../src/core/workflow/standard-cycle-work.mjs";
import { verifyCycleWorkContracts } from "./cycle-work-contract-fixture-lib.mjs";
import { fixtureValidationBoundary, createValidationProfileFixture } from "./standard-cycle-validation-fixture-lib.mjs";
import { verifyCyclePlanningContracts, verifyCyclePlanExecution, verifyCycleReadinessContracts } from "./cycle-planning-fixture-lib.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createProjectAgenticProcessExecution } from "../../src/application/runtime/agentic-process-execution-composition.mjs";
import { runOwnedAgenticProcess } from "../../src/application/runtime/agentic-process-owned-run.mjs";
import { createJournaledNativeAllocation } from "../../src/application/runtime/journaled-native-allocation.mjs";
import { verifyNativeAuthorizationEpochs, verifyInitialNativeAuthorizationEpochs } from "./native-authorization-epoch-fixture-lib.mjs";
import { loadStandardWorkflowAssets, createStandardWorkflowExecution } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { createGithubPrOpenTransportFixture } from "./github-pr-open-fixture-lib.mjs";
import { createLocalWorkflowSessionPush } from "../../src/adapters/runtime/local-workflow-session-push.mjs";
import { createStandardWorkflowMixedHost } from "../../src/application/runtime/standard-workflow-mixed-composition.mjs";
import { createStandardProcessAuthority } from "../../src/application/runtime/standard-process-authority.mjs";
import { assertNativeActivityAnswer, nativeActivityAnswerSchema, assertStandardDriftReport } from "../../src/core/workflow/native-activity-output.mjs";
import { evaluateStandardDriftReport, readStandardDriftContext } from "../../src/application/runtime/standard-drift-report.mjs";
import { runReloadCheckUseCase } from "../../src/application/runtime/reload-check-use-case.mjs";
import { createStandardDriftFinalization } from "../../src/application/runtime/standard-drift-finalization.mjs";
import { readControlledDriftGit, assertDiagnosticPathScope } from "../../src/application/runtime/standard-drift-git.mjs";
import { runSkillHookUseCase } from "../../src/application/runtime/skill-hook-use-case.mjs";
import { assertStandardOperationInput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { standardWorkflowOperationBindings, createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createNativeAllocationWorkerAuthority } from "../../src/application/runtime/native-allocation-worker-authority.mjs";
import { verifyNativeHumanVerificationPort } from "./native-human-verification-fixture-lib.mjs";
import { assertNativeAllocationJournal, nativeJournalPath } from "../../src/core/workflow/native-allocation-journal.mjs";
import { controlDelivery } from "../../src/core/workflow/process-control-inbox.mjs";
import { agenticProcessImplementationPins } from "../../src/application/runtime/agentic-process-implementation-pins.mjs";
import { agenticProcessPersistence, createAgenticProcessWorkerEnvironment } from "../../src/application/runtime/agentic-process-persistence.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createAgenticCodexRpc } from "../../src/adapters/agents/agentic-codex-rpc.mjs";
import { normalizePermissionProfile, buildAgenticNativePermissionProfile, createAgenticCodexSessions, summarizeAgenticNativeToolItem } from "../../src/adapters/agents/agentic-codex-session.mjs";
import { applyAuthorization, planAuthorization, resolveActivationTarget, readActivation } from "../../src/application/install/project-activation-service.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash, assertWorkflowRecordProjection } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES, createCodexHostEnvironment } from "../../src/core/agents/codex-startup-arguments.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { performance } from "node:perf_hooks";
import { spawnSync, execFileSync } from "node:child_process";
import { compileBpmnProcess } from "../../src/application/workflow/bpmn-process-service.mjs";
import { createAgenticProcess, inspectAgenticProcess, advanceAgenticProcess, agenticProcessPrefixSha256 } from "../../src/core/workflow/agentic-process.mjs";
import { simulateAgenticProcess, iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { assertNativeHostState } from "../../src/core/workflow/native-host-state.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { assertAgenticControlScenario } from "../../src/core/workflow/agentic-process-control-scenario.mjs";
import { republishBrokerProductFile } from "../../src/adapters/runtime/broker-product-file.mjs";
import { createProjectWorkflowInstanceService } from "../../src/application/runtime/workflow-instance-composition.mjs";

const selectedRecoveryMode = process.argv.find(value => value.startsWith("--drift-recovery-mode="))?.slice("--drift-recovery-mode=".length);
if (selectedRecoveryMode !== undefined && !["files", "dual", "db-only"].includes(selectedRecoveryMode)) throw Error("RECOVERY_FIXTURE_MODE_INVALID");
const selectedChangeRequestMode = process.argv.find(value => value.startsWith("--drift-cr-mode="))?.slice("--drift-cr-mode=".length);
if (selectedChangeRequestMode !== undefined && !["files", "dual", "db-only"].includes(selectedChangeRequestMode)) throw Error("CHANGE_REQUEST_FIXTURE_MODE_INVALID");
const selectedRecoveryCycleMode = process.argv.find(value => value.startsWith("--drift-cycle-mode="))?.slice("--drift-cycle-mode=".length);
const selectedCyclePlanMode = process.argv.find(value => value.startsWith("--cycle-plan-mode="))?.slice("--cycle-plan-mode=".length);
const selectedCycleReadinessMode = process.argv.find(value => value.startsWith("--cycle-readiness-mode="))?.slice("--cycle-readiness-mode=".length);
const selectedCycleWorkMode = process.argv.find(value => value.startsWith("--cycle-work-mode="))?.slice("--cycle-work-mode=".length);
const selectedCycleCloseFinalizeMode = process.argv.find(value => value.startsWith("--cycle-close-finalize-mode="))?.slice("--cycle-close-finalize-mode=".length);
const driftWorkerMode = process.argv.find(value => value.startsWith("--drift-worker-mode="))?.split("=")[1];
if (driftWorkerMode && !["nominal", "revoked", "expired", "wrong-authority", "wrong-subject"].includes(driftWorkerMode)) throw Error("DRIFT_WORKER_FIXTURE_MODE_INVALID");
if (selectedCycleCloseFinalizeMode !== undefined && !["contract", "files", "db-only"].includes(selectedCycleCloseFinalizeMode)) throw Error("CYCLE_CLOSE_FINALIZE_FIXTURE_MODE_INVALID");
const selectedCycleCloseRecordMode = process.argv.find(value => value.startsWith("--cycle-close-record-mode="))?.slice("--cycle-close-record-mode=".length);
if (selectedCycleCloseRecordMode !== undefined && !["contract", "files", "db-only"].includes(selectedCycleCloseRecordMode)) throw Error("CYCLE_CLOSE_RECORD_FIXTURE_MODE_INVALID");
const standardComposedStop = process.argv.find(value => value.startsWith("--standard-composed-stop="))?.slice("--standard-composed-stop=".length) ?? "plan";
if (!["plan", "cycle_admit", "closure_decide", "promotion_decide", "component_complete", "session_pr_correction_decide"].includes(standardComposedStop)) throw Error("STANDARD_COMPOSED_STOP_INVALID");
const standardComposedResume = process.argv.find(value => value.startsWith("--standard-composed-resume="))?.slice("--standard-composed-resume=".length);
const selectedStandardComposedMode = process.argv.find(value => value.startsWith("--standard-composed-mode="))?.slice("--standard-composed-mode=".length);
const selectedModeWorkResumeMode = process.argv.find(value => value.startsWith("--standard-mode-work-resume-mode="))?.split("=")[1];
const selectedSpikeMode = process.argv.find(value => value.startsWith("--standard-spike-mode="))?.split("=")[1];
const selectedSpikeChoice = process.argv.find(value => value.startsWith("--standard-spike-choice="))?.split("=")[1] ?? "convert-to-spike";
const selectedSpikeExperiment = process.argv.find(value => value.startsWith("--standard-spike-experiment="))?.split("=")[1] ?? null;
const selectedSpikeSessionClose = process.argv.includes("--standard-spike-session-close");
if (selectedSpikeSessionClose && !selectedSpikeExperiment) throw Error("STANDARD_SPIKE_SESSION_CLOSE_EXPERIMENT_REQUIRED");
if (selectedSpikeExperiment && (!selectedSpikeMode || selectedSpikeChoice !== "convert-to-spike" || !["retain", "no_go", "drop"].includes(selectedSpikeExperiment))) throw Error("STANDARD_SPIKE_EXPERIMENT_FIXTURE_ARGUMENTS_INVALID");
if (selectedSpikeMode && (!["files", "dual", "db-only"].includes(selectedSpikeMode)
  || !["convert-to-spike", "refused", "deferred", "cancelled"].includes(selectedSpikeChoice))) throw Error("STANDARD_SPIKE_FIXTURE_ARGUMENTS_INVALID");
if (selectedModeWorkResumeMode && !["files", "dual", "db-only"].includes(selectedModeWorkResumeMode)) throw Error("STANDARD_MODE_RESUME_FIXTURE_ARGUMENTS_INVALID");
const selectedModeWorkMode = process.argv.find(value => value.startsWith("--standard-mode-work-mode="))?.split("=")[1];
const selectedModeWorkClose = process.argv.includes("--standard-mode-work-close");
const selectedModeClosureChoice = process.argv.find(value => value.startsWith("--standard-mode-closure-choice="))?.split("=")[1] ?? "close";
if (selectedModeWorkClose && (!selectedModeWorkMode || !["close", "refused", "deferred", "cancelled"].includes(selectedModeClosureChoice))) throw Error("STANDARD_MODE_CLOSURE_FIXTURE_ARGUMENTS_INVALID");
const selectedModeWorkSession = process.argv.find(value => value.startsWith("--standard-mode-work-session="))?.split("=")[1] ?? "THINKING";
const selectedModeWorkResumeChoice = process.argv.find(value => value.startsWith("--standard-mode-work-resume-choice="))?.split("=")[1] ?? "continue_analysis";
const selectedModeWorkResumeDisposition = process.argv.find(value => value.startsWith("--standard-mode-work-resume-disposition="))?.split("=")[1] ?? "waiting";
if (selectedModeWorkResumeMode && (!["THINKING", "EXPLORING"].includes(selectedModeWorkSession)
  || !["continue_analysis", "refused", "deferred", "cancelled"].includes(selectedModeWorkResumeChoice)
  || !(selectedModeWorkSession === "EXPLORING" ? ["waiting", "retain_requested"] : ["waiting"]).includes(selectedModeWorkResumeDisposition))) throw Error("STANDARD_MODE_RESUME_FIXTURE_ARGUMENTS_INVALID");
const selectedModeWorkDisposition = process.argv.find(value => value.startsWith("--standard-mode-work-disposition="))?.split("=")[1] ?? (selectedModeWorkSession === "THINKING" ? "thinking_complete" : "nonretained");
if (selectedModeWorkMode !== undefined && (selectedStandardComposedMode || !["files", "dual", "db-only"].includes(selectedModeWorkMode)
  || !["THINKING", "EXPLORING"].includes(selectedModeWorkSession)
  || !(selectedModeWorkSession === "THINKING" ? ["thinking_complete", "waiting"] : ["nonretained", "waiting", "retain_requested"]).includes(selectedModeWorkDisposition))) throw Error("STANDARD_MODE_WORK_FIXTURE_ARGUMENTS_INVALID");
const standardHostTrace = process.argv.includes('--standard-composed-host-trace');
const standardCheckpointAckLoss = process.argv.includes('--standard-composed-checkpoint-ack-loss');
const standardCheckpointOwnerAckLoss = process.argv.includes('--standard-composed-checkpoint-owner-ack-loss');
const retainAlways = process.argv.includes('--retain-always');
if ((standardHostTrace || standardCheckpointAckLoss || standardCheckpointOwnerAckLoss) && !selectedStandardComposedMode) throw Error('STANDARD_FIXTURE_EXPERIMENT_MODE_REQUIRED');
if (selectedStandardComposedMode !== undefined && !["files", "dual", "db-only"].includes(selectedStandardComposedMode)) throw Error("STANDARD_COMPOSED_FIXTURE_MODE_INVALID");
const standardComposedBudgetText = process.argv.find(value => value.startsWith("--standard-composed-budget-ms="))?.slice("--standard-composed-budget-ms=".length);
const standardComposedBudgetMs = standardComposedBudgetText === undefined ? 7200000 : Number(standardComposedBudgetText);
if (standardComposedBudgetText !== undefined && (!selectedStandardComposedMode || !['promotion_decide', 'component_complete', 'session_pr_correction_decide'].includes(standardComposedStop) || !/^[0-9]+$/.test(standardComposedBudgetText)
  || !Number.isSafeInteger(standardComposedBudgetMs) || standardComposedBudgetMs < 3600000 || standardComposedBudgetMs > 10800000)) throw Error("STANDARD_COMPOSED_FIXTURE_BUDGET_INVALID");
const selectedCycleClosureMode = process.argv.find(value => value.startsWith("--cycle-closure-mode="))?.slice("--cycle-closure-mode=".length);
if (selectedCycleClosureMode !== undefined && !["contract", "files", "db-only"].includes(selectedCycleClosureMode)) throw Error("CYCLE_CLOSURE_FIXTURE_MODE_INVALID");
const selectedCycleAuditMode = process.argv.find(value => value.startsWith("--cycle-audit-mode="))?.slice("--cycle-audit-mode=".length);
if (selectedCycleAuditMode !== undefined && !["contract", "files", "db-only"].includes(selectedCycleAuditMode)) throw Error("CYCLE_AUDIT_FIXTURE_MODE_INVALID");
const selectedCycleTaskMode = process.argv.find(value => value.startsWith("--cycle-task-mode="))?.slice("--cycle-task-mode=".length);
if (selectedCycleTaskMode !== undefined && !["contract", "files", "db-only", "unchanged", "partial", "projection"].includes(selectedCycleTaskMode)) throw Error("CYCLE_TASK_FIXTURE_MODE_INVALID");
const selectedCycleVerificationMode = process.argv.find(value => value.startsWith("--cycle-verification-mode="))?.slice("--cycle-verification-mode=".length);
if (selectedCycleVerificationMode !== undefined && !["contract", "files", "dual", "db-only", "partial", "projection"].includes(selectedCycleVerificationMode)) throw Error("CYCLE_VERIFICATION_FIXTURE_MODE_INVALID");
const selectedCycleValidationMode = process.argv.find(value => value.startsWith("--cycle-validation-mode="))?.slice("--cycle-validation-mode=".length);
if (selectedCycleValidationMode !== undefined && !["contract", "files", "dual", "db-only"].includes(selectedCycleValidationMode)) throw Error("CYCLE_VALIDATION_FIXTURE_MODE_INVALID");
if (selectedCycleWorkMode !== undefined && !["contract", "files", "dual", "db-only", "report", "source"].includes(selectedCycleWorkMode)) throw Error("CYCLE_WORK_FIXTURE_MODE_INVALID");
if (selectedCycleReadinessMode !== undefined && !["contract", "files", "dual", "db-only", "partial", "projection", "refusal", "stale"].includes(selectedCycleReadinessMode)) throw Error("CYCLE_READINESS_FIXTURE_MODE_INVALID");
if (selectedCyclePlanMode !== undefined && !["contract", "files", "dual", "db-only", "partial", "projection"].includes(selectedCyclePlanMode)) throw Error("CYCLE_PLAN_FIXTURE_MODE_INVALID");
if (selectedRecoveryCycleMode !== undefined && !["files", "dual", "db-only"].includes(selectedRecoveryCycleMode)) throw Error("RECOVERY_CYCLE_FIXTURE_MODE_INVALID");
const sha = value => createHash("sha256").update(value).digest("hex");
const standardResponseText = process.argv.find(value => value.startsWith("--standard-composed-max-responses="))?.slice("--standard-composed-max-responses=".length);
if (standardResponseText !== undefined && (!selectedStandardComposedMode || !/^[1-9][0-9]*$/.test(standardResponseText)
  || !Number.isSafeInteger(Number(standardResponseText)))) throw Error("STANDARD_FIXTURE_RESPONSE_LIMIT_INVALID");
const standardScenarioName = process.argv.find(value => value.startsWith("--standard-composed-scenario="))?.slice("--standard-composed-scenario=".length) ?? "positive";
if (!["positive", "correction", "correction-full"].includes(standardScenarioName) || standardScenarioName !== "positive" && !selectedStandardComposedMode) throw Error("STANDARD_FIXTURE_SCENARIO_INVALID");
const fullCorrection = standardScenarioName === 'correction-full';
if (standardCheckpointAckLoss && (selectedStandardComposedMode !== 'files' || standardScenarioName !== 'correction' || !['component_complete', 'session_pr_correction_decide'].includes(standardComposedStop)))
  throw Error('STANDARD_FIXTURE_CHECKPOINT_ACK_LOSS_SCOPE_INVALID');
if (standardCheckpointOwnerAckLoss && (standardCheckpointAckLoss || !['files', 'dual'].includes(selectedStandardComposedMode)
  || standardScenarioName !== 'correction' || !['component_complete', 'session_pr_correction_decide'].includes(standardComposedStop))) throw Error('STANDARD_FIXTURE_CHECKPOINT_OWNER_ACK_LOSS_SCOPE_INVALID');
const standardScenario = selectedStandardComposedMode ? JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/standard-workflow/composed-" +
  (fullCorrection ? "correction.v3" : standardScenarioName === "correction" ? "correction.v2" : "positive.v1") + ".json", import.meta.url), "utf8")) : null;
if (standardResponseText !== undefined) standardScenario.max_responses = Number(standardResponseText);
if (standardScenario && (standardScenario.mode !== "COMMITTING" || standardScenario.closure !== "retain" || standardScenario.promotion !== "promote"
  || standardScenario.task_iterations !== 1 || standardScenario.cold_resume !== true || standardScenario.interruption !== null))
  throw Error("STANDARD_FIXTURE_DRIVER_SCENARIO_UNSUPPORTED");
const standardResumeInput = standardComposedResume ? JSON.parse(fs.readFileSync(standardComposedResume, "utf8")) : null;
if (standardResumeInput) {
  if (Boolean(standardResumeInput.experiment?.host_trace) !== standardHostTrace
    || Boolean(standardResumeInput.experiment?.checkpoint_ack_loss) !== standardCheckpointAckLoss
    || Boolean(standardResumeInput.experiment?.checkpoint_owner_ack_loss) !== standardCheckpointOwnerAckLoss) throw Error('STANDARD_FIXTURE_ORIGINAL_EXPERIMENT_CHANGED');
  assert.deepEqual(standardResumeInput.scenario, standardScenario, "Cold resume must preserve the initial fixture scenario");
  assert.equal(standardResumeInput.authorization.max_responses, standardScenario.max_responses, "Cold resume must preserve the original cumulative ceiling");
}
// This check precedes temporary roots, fixture installation, process creation
// and authorization time. No production ceiling or previous trial is modified.
const standardPreflight = selectedStandardComposedMode ? preflightStandardComposedFixture({
  model: loadStandardWorkflowAssets().model, scenario: standardScenario, stop: standardComposedStop }) : null;
if (standardResumeInput) {
  assert.equal(standardResumeInput.preflight.model_sha256, standardPreflight.model_sha256);
  assert.equal(standardResumeInput.preflight.scenario_sha256, standardPreflight.scenario_sha256);
  assert.equal(standardResumeInput.preflight.stop, standardComposedStop);
}
if (process.argv.includes("--standard-composed-preflight-only")) {
  if (!standardPreflight) throw Error("STANDARD_FIXTURE_PREFLIGHT_MODE_REQUIRED");
  console.log(JSON.stringify(standardPreflight)); process.exit(0);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agentic-execution-")), checks = [];
const businessRoots = [];
function retainComposedChild(controlRoot, label, child) {
  fs.writeFileSync(path.join(controlRoot, label + '.stdout.log'), child.stdout ?? '');
  fs.writeFileSync(path.join(controlRoot, label + '.stderr.log'), child.stderr ?? '');
  fs.writeFileSync(path.join(controlRoot, label + '.exit.json'), JSON.stringify({
    observed_at_utc: new Date().toISOString(), pid: child.pid ?? null, status: child.status, signal: child.signal,
    error_code: child.error?.code ?? null, stdout_bytes: Buffer.byteLength(child.stdout ?? ''),
    stderr_bytes: Buffer.byteLength(child.stderr ?? ''), resource_tree_closure: 'NOT_ESTABLISHED'
  }));
}
let serial = 0, completed = false;
const put = (base, name, text) => { const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
async function check(name, callback) { if (process.argv.includes("--drift-objective-mismatch-only") && !name.startsWith("drift objective mismatch:")) return; if (selectedSpikeMode && !name.startsWith("standard spike:")) return; if (selectedModeWorkResumeMode && !name.startsWith("standard mode resume:")) return; if (selectedModeWorkMode && !name.startsWith("standard mode analysis:")) return; if (selectedStandardComposedMode && !name.startsWith(`standard composed ${selectedStandardComposedMode}:`)) return; if (process.argv.includes("--v2-only") && !name.startsWith("v2 ")) return;
  if (process.argv.includes("--native-human-port-only") && !name.startsWith("native human port:")) return;
  if (process.argv.includes("--native-human-turn-only") && !name.startsWith("worker private before-turn")) return;
  if (driftWorkerMode && !name.startsWith("drift worker current human:")) return;
  const epochMode = process.argv.find(value => value.startsWith("--native-epoch-mode="))?.slice("--native-epoch-mode=".length);
  if (epochMode && !["files", "dual", "db-only"].includes(epochMode)) throw Error("NATIVE_EPOCH_FIXTURE_MODE_INVALID");
  if (epochMode && !name.startsWith(`native epoch ${epochMode}:`)) return;
  const initialEpochMode = process.argv.find(value => value.startsWith("--native-initial-epoch-mode="))?.slice("--native-initial-epoch-mode=".length);
  if (initialEpochMode && !["files", "dual", "db-only"].includes(initialEpochMode)) throw Error("NATIVE_EPOCH_FIXTURE_MODE_INVALID");
  if (initialEpochMode && !name.startsWith(`native initial epoch ${initialEpochMode}:`)) return;
  if (selectedCyclePlanMode && !name.startsWith(`cycle plan ${selectedCyclePlanMode}`)) return;
  if (selectedCycleReadinessMode && !name.startsWith(`cycle readiness ${selectedCycleReadinessMode}:`)) return;
  if (selectedCycleWorkMode && !name.startsWith(`cycle work ${selectedCycleWorkMode}:`)) return;
  if (selectedCycleCloseFinalizeMode && !name.startsWith(`cycle close finalize ${selectedCycleCloseFinalizeMode}:`)) return;
  if (selectedCycleCloseRecordMode && !name.startsWith(`cycle close record ${selectedCycleCloseRecordMode}:`)) return;
  if (selectedCycleClosureMode && !name.startsWith(`cycle closure ${selectedCycleClosureMode}:`)) return;
  if (selectedCycleAuditMode && !name.startsWith(`cycle audit ${selectedCycleAuditMode}:`)) return;
  if (selectedCycleTaskMode && !name.startsWith(`cycle tasks ${selectedCycleTaskMode}:`)) return;
  if (selectedCycleVerificationMode && !name.startsWith(`cycle verification ${selectedCycleVerificationMode}:`)) return;
  if (selectedCycleValidationMode && !name.startsWith(`cycle validation ${selectedCycleValidationMode}:`)) return;
  if (selectedChangeRequestMode && !name.startsWith(`drift CR ${selectedChangeRequestMode}:`)) return;
  if (selectedRecoveryCycleMode && !name.startsWith(`drift cycle ${selectedRecoveryCycleMode}:`)) return;
  if (process.argv.includes("--checkpoint-only") && !name.startsWith("checkpoint ")) return;
  if (process.argv.includes("--journal-only") && !name.startsWith("journal ")) return;
  if (process.argv.includes("--owned-only") && !/^(journal |owned )/.test(name)) return;
  if (process.argv.includes("--resume-only") && !name.startsWith("resume ")) return;
  if (process.argv.includes("--worker-only") && !name.startsWith("worker ")) return;
  if (process.argv.includes("--mixed-only") && !name.startsWith("mixed ")) return;
  if (process.argv.includes("--nonmixed-only") && /^(mixed |drift |dataflow |cycle plan |cycle readiness |cycle work |cycle validation |cycle verification |cycle tasks |cycle audit |cycle closure |cycle close record |cycle close finalize )/.test(name)) return;
  const dataflowMode = process.argv.find(value => value.startsWith("--dataflow-mode="))?.slice("--dataflow-mode=".length);
  if (dataflowMode && !name.startsWith(`dataflow ${dataflowMode}:`)) return;
  const recoveryMode = process.argv.find(value => value.startsWith("--drift-recovery-mode="))?.slice("--drift-recovery-mode=".length);
  if (recoveryMode && !name.startsWith(`drift recovery ${recoveryMode}:`)) return;
  if (process.argv.includes("--drift-only") && !name.startsWith("drift ")) return;
  if (process.argv.includes("--drift-git-only") && !name.startsWith("drift controlled Git")) return;
  if (process.argv.includes("--drift-contract-only") && !name.startsWith("drift contract ")) return;
  if (process.argv.includes("--drift-finalize-contract-only") && !name.startsWith("drift finalization contract ")) return;
  const finalizeMode = process.argv.find(value => value.startsWith("--drift-finalize-mode="))?.slice(22);
  if (finalizeMode && !name.startsWith(`drift finalize ${finalizeMode}:`)) return;
  const finalizeCase = process.argv.find(value => value.startsWith("--drift-finalize-case="))?.slice(22);
  if (finalizeCase && !name.startsWith(`drift finalization ${finalizeCase}:`)) return;
  const completionMode = process.argv.find(value => value.startsWith("--drift-completion-mode="))?.slice("--drift-completion-mode=".length);
  if (completionMode && !name.startsWith(`drift completion ${completionMode}:`)) return;
  const driftMode = process.argv.find(value => value.startsWith("--drift-mode="))?.slice(13);
  if (driftMode && !name.startsWith(`drift ${driftMode}:`)) return;
  await callback(); checks.push(name); console.log("PASS " + name); }
function fixture(options = {}) {
  const base = path.join(root, "case-" + ++serial), targetRoot = options.projectRoot ?? path.join(base, "project"), packageRoot = path.join(base, "package");
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  if (options.git) {
    const emptyHooks = path.join(base, "empty-hooks"); fs.mkdirSync(emptyHooks);
    for (const args of [["init", "-b", "main"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"]]) {
      const result = spawnSync("git", ["-c", "core.hooksPath=" + emptyHooks, ...args], { cwd: targetRoot, encoding: "utf8", shell: false }); assert.equal(result.status, 0, result.stderr);
    }
  }
  let block;
  if (options.projectRoot) block = fs.readFileSync(path.join(targetRoot, "AGENTS.md"), "utf8");
  else {
  const version = fs.readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
  put(packageRoot, "VERSION", version + "\n"); put(packageRoot, "bin/aidn.mjs", "// fixture, never executed\n");
  applyAuthorization(planAuthorization({ targetRoot, action: "authorize" }));
  const identity = resolveActivationTarget({ targetRoot }), assets = {};
  for (const name of [".codex/hooks/aidn-hook-runtime.mjs", ".codex/hooks/aidn-session-start.mjs", ".codex/hooks/aidn-pre-tool-use.mjs", ".agents/skills/context-reload/SKILL.md", ".agents/skills/start-session/SKILL.md"]) {
    const text = "Neutral fixture\n"; put(targetRoot, name, text); assets[name] = { kind: "file", current: Buffer.from(text).toString("base64") };
  }
  block = "<!-- CODEX-AUDIT-WORKFLOW START -->\nNeutral fixture\n<!-- CODEX-AUDIT-WORKFLOW END -->";
  put(targetRoot, "AGENTS.md", block); assets["AGENTS.md"] = { kind: "agents-block", current: block };
  const hooks = ["SessionStart", "PreToolUse"].map(event => ({ event, group: { matcher: "fixture" }, hook: { type: "command", command: "echo fixture" } }));
  put(targetRoot, ".codex/hooks.json", JSON.stringify({ hooks: Object.fromEntries(hooks.map(h => [h.event, [{ ...h.group, hooks: [h.hook] }]])) }));
  assets[".codex/hooks.json"] = { kind: "hooks", current: hooks };
  const receipt = { schema_version: 1, scope: "codex-integration", root_id: identity.root_id,
    package: { root: packageRoot, version, entry: "bin/aidn.mjs", entry_sha256: artifactContentHash(fs.readFileSync(path.join(packageRoot, "bin/aidn.mjs"), "utf8")), version_sha256: artifactContentHash(version + "\n") },
    assets, last_transaction: "a".repeat(32), last_action: "install", activation: { mode: identity.scope, authority_id: identity.authority_id } };
  const tx = { schema_version: 1, id: receipt.last_transaction, scope: "codex-integration", root_id: identity.root_id, status: "complete", operations: [], receipt_after: receipt };
  const seal = value => JSON.stringify({ ...value, integrity_sha256: shadowHash(value) });
  put(targetRoot, `.aidn/install/transactions/${tx.id}.json`, seal(tx)); put(targetRoot, ".aidn/install/receipt.json", seal(receipt));
  }
  assert.equal(readActivation({ targetRoot }).state, "active");
  const dirs = Object.fromEntries(["product", "control", "review", "home"].map(name => [name, name === "product" ? path.join(targetRoot, name) : path.join(base, name)]));
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
  put(dirs.product, "app.mjs", "export const value = 1;\n");
  const model = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
  model.policies[0].allowed_permissions.push("write:product");
  const pin = (name, text) => { const file = put(base, name, text); return { path: file, sha256: sha(text) }; };
  const configuration = { contract_version: "agentic-process-execution.v1", instance_id: "case", target_root: targetRoot,
    implementation_sha256: agenticProcessImplementationPins().sha256,
    product_root: dirs.product, control_root: dirs.control, review_root: dirs.review, product_files: ["app.mjs"],
    model: pin("model.json", JSON.stringify(model)), criteria: pin("criteria.md", "Value must be 2 after implementation."),
    authorities: { project: { path: path.join(targetRoot, "AGENTS.md"), sha256: sha(block) } },
    skills: { architecture: pin("architecture.md", "Inspect and preserve architecture."), tests: pin("tests.md", "Check the explicit criteria.") },
    instructions: { analyze: "Analyze the change.", implement: "Change value to 2.", review: "Review without correcting the work." },
    native: { executable: process.execPath, sha256: sha(fs.readFileSync(process.execPath)), home: dirs.home, tool_roots: [],
      hook_hashes: { work: ["sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64)], review: [] }, model: "fixture-model", effort: "medium",
      startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],
        log_dir: dirs.control, sqlite_home: dirs.control } },
  };
  const authorize = () => { const at = Date.now(); return { approved: true, model_allowed: true, authorized_at_ms: at, global_deadline_ms: at + 60000,
    workflow_deadline_ms: at + 60000, max_turn_ms: 10000,
    max_responses: 6, max_bytes: 10 * 1024 * 1024, configuration_sha256: shadowHash(configuration) }; };
  return { configuration, authorize, base, dirs };
}
function persistenceFixture(f, backend, stateMode) {
  const targetRoot = f.configuration.target_root;
  put(targetRoot, ".aidn/config.json", JSON.stringify({ runtime: { stateMode, persistence: { backend,
    ...(backend === "postgres" ? { connectionRef: "env:AIDN_TEST_DB" } : {}) } } }));
  f.environment = { ...createCodexHostEnvironment(), AIDN_TEST_DB: "postgresql://fixture:fixture@127.0.0.1/never-connected" };
  if (backend === "sqlite") {
    if (stateMode !== "files") createArtifactStore({ sqliteFile: path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite") }).close();
    return;
  }
  f.pgState = put(f.base, "postgres-state.json", JSON.stringify({ scope: resolveRuntimeProjectContext({ targetRoot }).runtime_scope_id,
    commits: 0, tables: { artifacts: [], artifact_blobs: [], runtime_heads: [] }, queries: [] }));
  f.artifactStoreFactory = options => createProjectArtifactStore({ ...options, workerRunner(executable, args, settings) {
    assert.match(args[0], /project-artifact-store-worker\.mjs$/);
    assert.equal(settings.env.AIDN_TEST_DB, f.environment.AIDN_TEST_DB);
    return spawnSync(executable, [fileURLToPath(new URL("agentic-postgres-worker-fixture.mjs", import.meta.url))],
      { ...settings, env: { ...settings.env, AIDN_TEST_PG_STATE: f.pgState } });
  } });
}
function mutatePg(f, changes) { const state = JSON.parse(fs.readFileSync(f.pgState)); Object.assign(state, changes); fs.writeFileSync(f.pgState, JSON.stringify(state)); }
function inlineTomlToJson(text) {
  let quoted = false, escaped = false, result = "";
  for (const character of text) {
    if (!escaped && character === '"') quoted = !quoted;
    result += !quoted && character === "=" ? ":" : character;
    escaped = quoted && !escaped && character === "\\";
  }
  return JSON.parse(result);
}
function transport(f, options = {}) {
  const sessions = [], calls = [];
  const rpcFactory = configuration => {
    const index = sessions.length + 1, thread = `thread-${index}`, permission = configuration.args.find(arg => arg.startsWith("permissions.aidn_agentic_"));
    const profile = permission.split("=")[0].slice("permissions.".length), parsed = inlineTomlToJson(permission.slice(permission.indexOf("=") + 1));
    const cfg = { model: "fixture-model", model_provider: "openai", model_reasoning_effort: "medium", approval_policy: "never", memories: { use_memories: false, generate_memories: false },
      features: { memories: false, plugins: false, apps: false, hooks: true, multi_agent: false }, agents: { enabled: false }, history: { persistence: "none" },
      project_doc_max_bytes: 0, instructions: "", developer_instructions: "",
      log_dir: JSON.parse(configuration.args.find(arg => arg.startsWith("log_dir=")).slice("log_dir=".length)),
      sqlite_home: JSON.parse(configuration.args.find(arg => arg.startsWith("sqlite_home=")).slice("sqlite_home=".length)),
      mcp_servers: {}, plugins: {}, apps: { _default: { enabled: false } },
      shell_environment_policy: { inherit: "all", ignore_default_excludes: true, filters: Object.fromEntries(CODEX_STARTUP_ENVIRONMENT_PROFILES.worker.map(name => [name, "include"])), set: {} },
      permissions: { [profile]: parsed } };
    const session = { thread, turns: 0, closed: false, configuration, cfg }; sessions.push(session);
    return {
      async request(method, params) {
        calls.push({ method, params, thread });
        if (method === "initialize") return {};
        if (method === "windowsSandbox/readiness") return { status: options.backendMissing ? "notReady" : "ready" };
        if (method === "permissionProfile/list") return { data: [{ id: profile, allowed: !options.profileDenied }], nextCursor: null };
        if (method === "hooks/list") {
          assert.equal(params.threadId, thread, "Inspect the actual loaded thread's hooks before any model turn");
          assert.equal(Object.hasOwn(params, "cwds"), false);
          const hooks = configuration.cwd === f.dirs.product ? ["preToolUse", "sessionStart"].map((eventName, index) => ({ eventName,
            enabled: true, trustStatus: "trusted", source: "project", handlerType: "command", async: false,
            sourcePath: path.join(f.configuration.target_root, ".codex/hooks.json"), currentHash: f.configuration.native.hook_hashes.work[index] })) : [];
          if (options.foreignHook) hooks.push({ enabled: true, trustStatus: "trusted", source: "global", currentHash: "sha256:" + "a".repeat(64) });
          if (options.noAdmission) hooks[0].eventName = "unrelatedEvent";
          return { data: [{ cwd: configuration.cwd, hooks, errors: [], warnings: [] }] };
        }
        if (method === "config/read") { options.onConfigRead?.(); if (options.badProfile) return { config: {} }; return { config: cfg }; }
        if (method === "thread/start") return { thread: { id: thread }, model: cfg.model, approvalPolicy: "never", activePermissionProfile: { id: profile },
          sandbox: { type: Object.values(parsed.filesystem).includes("write") ? "workspaceWrite" : "readOnly", networkAccess: false } };
        if (method !== "turn/start") throw Error("unexpected method");
        const turn = `turn-${++session.turns}`;
        if (options.silence) return { turn: { id: turn } };
        if (params.input[0].text.includes("Change value")) put(f.dirs.product, "app.mjs", "export const value = 2;\n");
        if (index === 2 && options.mutateReview) put(f.dirs.product, "app.mjs", "export const value = 99;\n");
        if (index === 2 && options.mutateSnapshot) put(configuration.cwd, "app.mjs", "export const value = 99;\n");
        if (options.revoke) applyAuthorization(planAuthorization({ targetRoot: f.configuration.target_root, action: "revoke" }));
        if (options.backendDrift) put(f.configuration.target_root, ".aidn/config.json", JSON.stringify({ runtime: { persistence: { backend: "sqlite" } } }));
        if (options.storage) put(f.dirs.control, "case/native-overflow.bin", Buffer.alloc(11 * 1024 * 1024));
        const notify = (method, params) => configuration.onNotification({ method, params });
        await notify("rawResponse/completed", { threadId: options.foreignThread ? "other-thread" : thread, turnId: turn, responseId: `response-${session.turns}` });
        const usage = { inputTokens: 10 * session.turns, cachedInputTokens: 0, outputTokens: session.turns, reasoningOutputTokens: 0, totalTokens: 11 * session.turns };
        if (!options.noUsage) await notify("thread/tokenUsage/updated", { threadId: thread, turnId: options.foreignTurn ? "other-turn" : turn,
          tokenUsage: { total: usage, last: usage } });
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "functionCallOutput", name: "exec", id: "fixture-tool", output: "private command/output must not be retained" } });
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "agentMessage", phase: "commentary", text: "Working on the admitted activity." } });
        const answer = options.answer ? await options.answer({ params, index }) : { outcome: options.reject && index === 2 ? "rejected" : "completed", summary: "Fixture result." };
        await notify("item/completed", { threadId: thread, turnId: turn, item: { type: "agentMessage", phase: "final_answer", text: JSON.stringify(answer) } });
        await notify("turn/completed", { threadId: thread, turn: { id: turn, status: "completed" } });
        if (options.unverifiableStorage) fs.symlinkSync(f.base, path.join(f.dirs.control, "case/unverifiable-link"), "junction");
        if (options.transientStorage) put(f.dirs.control, "case/transient.tmp", "transient");
        return { turn: { id: turn } };
      },
      notify() {}, async flush() {}, async close() {
        session.closed = true;
        if (options.corruptEvidenceOnClose) {
          const directory = path.join(f.dirs.control, "case"), file = fs.readdirSync(directory).find(name => name.endsWith("-native-result.json"));
          if (file) fs.appendFileSync(path.join(directory, file), "\n");
        }
        return { closed: !options.closeFailure };
      },
    };
  };
  return { rpcFactory, sessions, calls };
}
async function run(f, options = {}) {
  const t = transport(f, options), auth = f.authorize();
  if (options.maxResponses) auth.max_responses = options.maxResponses;
  if (options.silence) auth.max_turn_ms = 25;
  const result = await createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory,
    ...(f.artifactStoreFactory ? { artifactStoreFactory: f.artifactStoreFactory } : {}), ...(f.environment ? { environment: f.environment } : {}) }).run({ execute: true, authorization: auth, signal: options.signal });
  assert.equal(t.sessions.every(session => session.closed), true);
  assert.equal(fs.existsSync(path.join(f.dirs.control, "case/RESULT.json")), !result.seal?.startsWith("STDOUT_ONLY"));
  return { result, ...t };
}

function journalFixture(options = {}) {
  const f = fixture({ git: options.git }), model = JSON.parse(fs.readFileSync(f.configuration.model.path));
  if (options.stateMode) persistenceFixture(f, "sqlite", options.stateMode);
  model.contract_version = "agentic-process-model.v2"; model.operation_pins = {};
  if (options.waitAtEntry) {
    const activity = model.nodes.find(node => node.kind === "activity");
    model.nodes.push({ id: "external_wait", kind: "event", participant_ref: activity.participant_ref, branches: [
      { flow_id: "continue", node_id: model.entry, event_key: "continue_snapshot" }, { flow_id: "check", node_id: "late_check", event_key: "check_snapshot" }] },
      { ...activity, id: "late_check" }); model.entry = "external_wait";
  } else if (options.wait) {
    const activity = model.nodes.find(node => node.kind === "activity");
    const review = model.nodes.find(node => node.kind === "activity" && model.policies.find(policy => policy.id === node.policy_ref)?.independent_review);
    model.nodes.push({ id: "journal_wait", kind: "sequence", participant_ref: activity.participant_ref, children: [model.entry, "external_wait"] },
      { id: "external_wait", kind: "event", participant_ref: activity.participant_ref, branches: [
        { flow_id: "review", node_id: "late_review", event_key: "review_snapshot" }, { flow_id: "cancel", node_id: "late_cancel", event_key: "cancel_snapshot" }] },
      { ...(options.resumeReview ? review : activity), id: "late_review" }, { ...activity, id: "late_cancel" });
    model.entry = "journal_wait";
  }
  fs.writeFileSync(f.configuration.model.path, JSON.stringify(model)); f.configuration.model.sha256 = sha(JSON.stringify(model));
  const worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
  f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)),
    helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
  const key = Buffer.alloc(32, 73), t = transport(f, options), controllerFactory = journalController(f, t, options);
  const open = (readSigningKey = () => key, nativeAuthorizationSource = options.nativeAuthorizationSource) => createJournaledNativeAllocation({ configuration: f.configuration, readSigningKey, nativeAuthorizationSource,
    ...(f.environment ? { environment: f.environment } : {}), ...(options.controlSource ? { controlSource: options.controlSource } : {}) }, { controllerFactory });
  Object.assign(f, { key, t, open, actor: open() }); return f;
}
function journalController(f, t, options = {}) {
  return () => ({ async checkAvailability() { return { available: true }; },
    async run(request, { onEvent }) {
      f.launches = (f.launches ?? 0) + 1; await options.beforeWorker?.(f);
      if (options.controllerFailure) throw Object.assign(new Error("FIXTURE_CONTROLLER_INTERRUPTED"), { code: "FIXTURE_CONTROLLER_INTERRUPTED" });
      const sent = JSON.parse(request.stdin);
      options.mutateAdmission?.(sent.allocation, f);
      if (options.realWorker) {
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url))], {
          input: JSON.stringify(sent), env: request.env, cwd: request.cwd, encoding: "utf8", shell: false, timeout: 30000,
        });
        f.worker = { status: child.status, stderr: child.stderr, stdout: child.stdout };
        await onEvent({ type: "stdout", bytes: Buffer.from(child.stdout) });
        return { outcome: "completed", termination_state: "confirmed", termination_proof: { active_processes: 0 } };
      }
      let native;
      const allocationAuthority = createNativeAllocationWorkerAuthority({ configuration: f.configuration, authorization: sent.authorization, admission: sent.allocation,
        readProductSha256: () => native.preview().product_sha256, ...(f.environment ? { environment: f.environment } : {}) });
      native = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory, allocationAuthority, processAuthority: allocationAuthority.processAuthority, ...(f.environment ? { environment: f.environment } : {}) });
      const result = await native.run({ execute: true, authorization: sent.authorization });
      await options.afterWorker?.(f, result);
      await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(result)) });
      return { outcome: "completed", termination_state: options.treeUnknown ? "unknown" : "confirmed", termination_proof: options.treeUnknown ? null : { active_processes: 0 } };
    } });
}
async function readyResumeFixture(options = {}) {
  let claim = null;
  const controlSource = { async read() { return claim; }, async verify({ source }) {
    assert.deepEqual(source, claim); return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) };
  } };
  const f = journalFixture({ ...options, wait: true, resumeReview: true, git: true, controlSource });
  f.auth = f.authorize(); f.auth.global_deadline_ms += 180000; f.auth.workflow_deadline_ms += 180000;
  assert.equal((await f.actor.run({ execute: true, authorization: f.auth })).status, "WAITING");
  const state = f.actor.readCheckpoint(1).state.instance, frame = inspectAgenticProcess(state).occurrences.find(row => row.node_id === "external_wait");
  f.request = f.actor.prepareControl(frame.occurrence_id);
  claim = { contract_version: "process-control-source.v1", source_kind: "external", authority_id: "fixture_review", source_event_id: "review-1",
    subject_sha256: "a".repeat(64), request_sha256: shadowHash(f.request), event_key: "review_snapshot", payload_sha256: "b".repeat(64), evidence_refs: [{ ref: "provider:review-1", sha256: "c".repeat(64) }] };
  f.claim = claim;
  if (options.uncaptured) return f;
  f.capture = await f.actor.captureControl({ occurrenceId: frame.occurrence_id, sourceRef: "review", write: true });
  if (!options.undelivered) await f.actor.deliverControl(f.capture.inbox_id, { write: true });
  return f;
}
function mixedFixture(stateMode = "files", options = {}) {
  const projectRoot = createFreshStandardWorkflowFixture(stateMode, businessRoots), f = fixture({ projectRoot }), original = JSON.parse(fs.readFileSync(f.configuration.model.path));
  const op = (id, binding_ref) => ({ id, kind: "operation", participant_ref: "delivery", binding_ref });
  const native = id => original.nodes.find(node => node.id === id);
  original.policies[0].allowed_permissions = ["read:product"];
  const model = { ...original, contract_version: "agentic-process-model.v2", model_id: "actual-mixed-bootstrap-fixture", revision: 1,
    roles: original.roles.filter(role => role.id !== "implementation"), entry: "mixed",
    operation_pins: Object.fromEntries(standardWorkflowOperationBindings().filter(binding => ["context_reload", "session_admit", "session_initialize"].includes(binding.id)).map(binding => [binding.id, shadowHash(binding)])),
    nodes: [{ id: "mixed", kind: "sequence", participant_ref: "delivery", children: ["reload", "admit", "initialize", "analyze", "after_native", "external_wait"] },
      op("reload", "context_reload"), op("admit", "session_admit"), op("initialize", "session_initialize"), native("analyze"), op("after_native", "context_reload"),
      { id: "external_wait", kind: "event", participant_ref: "delivery", branches: [
        { flow_id: "review", node_id: "review_path", event_key: "review_snapshot" }, { flow_id: "finish", node_id: "finish_without_review", event_key: "finish_snapshot" }] },
      { id: "review_path", kind: "sequence", participant_ref: "delivery", children: ["review", "after_review"] }, native("review"),
      op("after_review", "context_reload"), op("finish_without_review", "context_reload")] };
  fs.writeFileSync(f.configuration.model.path, JSON.stringify(model)); f.configuration.model.sha256 = sha(JSON.stringify(model));
  if (options.drift) {
    model.roles.find(row => row.id === "analysis").skills = ["drift-check"];
    model.operation_pins.drift_report_evaluate = shadowHash(standardWorkflowOperationBindings().find(row => row.id === "drift_report_evaluate"));
    model.nodes = [
      { id: "mixed", kind: "sequence", participant_ref: "delivery", children: ["reload", "admit", "initialize", "analyze", "evaluate", "route_drift"] },
      op("reload", "context_reload"), op("admit", "session_admit"), op("initialize", "session_initialize"), native("analyze"), op("evaluate", "drift_report_evaluate"),
      { id: "route_drift", kind: "xor", participant_ref: "delivery", branches: [
        { flow_id: "recovery", node_id: "recovery_pending", condition: "drift_recovery_required" }, { flow_id: "finalize", node_id: "finalization_pending", condition: null }] },
      ...["recovery_pending", "finalization_pending"].map((id, index) => ({ id, kind: "event", participant_ref: "delivery", branches: [
        { flow_id: "continue", node_id: `end_${index}_continue`, event_key: "continue_snapshot" }, { flow_id: "stop", node_id: `end_${index}_stop`, event_key: "stop_snapshot" }] })),
      ...[0, 1].flatMap(index => [op(`end_${index}_continue`, "context_reload"), op(`end_${index}_stop`, "context_reload")]) ];
    const content = fs.readFileSync(new URL("../../scaffold/codex/aidn-drift-check/SKILL.md", import.meta.url));
    f.configuration.skills["drift-check"] = { path: put(f.base, "package/drift-check.md", content), sha256: sha(content) };
    f.configuration.activity_outputs = { analyze: "standard-drift-report.v1" };
    if (options.finalize) {
      model.operation_pins.drift_check_finalize = shadowHash(standardWorkflowOperationBindings().find(row => row.id === "drift_check_finalize"));
      model.nodes = [{ id: "mixed", kind: "sequence", participant_ref: "delivery", children: ["reload", "admit", "initialize", "analyze", "evaluate", "finalize"] },
        ...model.nodes.filter(row => ["reload", "admit", "initialize", "analyze", "evaluate"].includes(row.id)), op("finalize", "drift_check_finalize")];
    }
    if (options.dataBindings) {
      model.operation_pins.mode_decision = shadowHash(standardWorkflowOperationBindings().find(row => row.id === "mode_decision"));
      model.nodes[0].children.push("choose_mode"); model.nodes.push(op("choose_mode", "mode_decision"));
      model.data_bindings = { contract_version: "process-data-bindings.v1", parameter_keys: ["session"], inputs: [
        { node_id: "reload", fields: {} }, { node_id: "admit", fields: {} },
        { node_id: "initialize", fields: Object.fromEntries(["session_id", "session_branch", "objective"].map(name => [name, { source: "parameter", key: "session", path: [name] }])) },
        { node_id: "evaluate", fields: { report_occurrence_id: { source: "occurrence_id", node_id: "analyze" } } },
        { node_id: "finalize", fields: { evaluation_operation_id: { source: "operation_id", node_id: "evaluate" } } },
        { node_id: "choose_mode", fields: { session_id: options.inputSource === "operation_input"
          ? { source: "operation_input", node_id: "initialize", path: ["session_id"] }
          : { source: "operation_output", node_id: "initialize", path: ["observations", "postconditions", "admission", "active_session"] } } },
      ] };
    }
    if (options.recovery) {
      for (const id of ["drift_recovery_decision", options.objectiveFinalize ? "drift_check_finalize" : "drift_recovery_record"]) model.operation_pins[id] = shadowHash(standardWorkflowOperationBindings().find(row => row.id === id));
      model.nodes = [{ id: "mixed", kind: "sequence", participant_ref: "delivery", children: ["reload", "admit", "initialize", "analyze", "evaluate", "decide", "record", "recovery_action_pending"] },
        ...model.nodes.filter(row => ["reload", "admit", "initialize", "analyze", "evaluate"].includes(row.id)),
        op("decide", "drift_recovery_decision"), op("record", options.objectiveFinalize ? "drift_check_finalize" : "drift_recovery_record"),
        { id: "recovery_action_pending", kind: "event", participant_ref: "delivery", branches: [
          { flow_id: "executed", node_id: "action_executed", event_key: "executed" }, { flow_id: "cancel", node_id: "action_cancelled", event_key: "cancelled" }] },
        op("action_executed", "context_reload"), op("action_cancelled", "context_reload")];
      model.data_bindings = { contract_version: "process-data-bindings.v1", parameter_keys: ["session"], inputs: [
        { node_id: "reload", fields: {} }, { node_id: "admit", fields: {} },
        { node_id: "initialize", fields: Object.fromEntries(["session_id", "session_branch", "objective"].map(name => [name, { source: "parameter", key: "session", path: [name] }])) },
        { node_id: "evaluate", fields: { report_occurrence_id: { source: "occurrence_id", node_id: "analyze" } } },
        { node_id: "decide", fields: { evaluation_operation_id: { source: "operation_id", node_id: "evaluate" } } },
        { node_id: "record", fields: options.objectiveFinalize ? { evaluation_operation_id: { source: "operation_id", node_id: "evaluate" } }
          : { decision_operation_id: { source: "operation_id", node_id: "decide" } } },
        { node_id: "action_executed", fields: {} }, { node_id: "action_cancelled", fields: {} },
      ] };
      if (options.changeRequest) {
        model.operation_pins.drift_change_request_record = shadowHash(standardWorkflowOperationBindings().find(row => row.id === "drift_change_request_record"));
        model.nodes[0].children.splice(-1, 0, "change_request"); model.nodes.push(op("change_request", "drift_change_request_record"));
        model.data_bindings.inputs.push({ node_id: "change_request", fields: { recovery_record_operation_id: { source: "operation_id", node_id: "record" } } });
      }
      if (options.recoveryCycle) {
        for (const [node, binding] of [["recovery_context", "drift_recovery_context_refresh"], ["checkpoint", "drift_recovery_checkpoint_observe"], ["recovery_cycle", "drift_recovery_cycle_initialize"]]) {
          model.operation_pins[binding] = shadowHash(standardWorkflowOperationBindings().find(row => row.id === binding)); model.nodes.push(op(node, binding));
        }
        model.nodes[0].children.splice(-1, 0, "recovery_context", "checkpoint", "recovery_cycle");
        model.data_bindings.parameter_keys.push("cycle");
        model.data_bindings.inputs.push(
          { node_id: "recovery_context", fields: { recovery_operation_id: { source: "operation_id", node_id: options.changeRequest ? "change_request" : "record" } } },
          { node_id: "checkpoint", fields: { context_operation_id: { source: "operation_id", node_id: "recovery_context" } } },
          { node_id: "recovery_cycle", fields: { checkpoint_operation_id: { source: "operation_id", node_id: "checkpoint" }, ...Object.fromEntries(["cycle_id", "cycle_type", "title"].map(key => [key, { source: "parameter", key: "cycle", path: [key] }])) } });
      }
    }
    fs.writeFileSync(f.configuration.model.path, JSON.stringify(model)); f.configuration.model.sha256 = sha(JSON.stringify(model));
  }
  if (options.planning) {
    model.roles = model.roles.filter(row => row.id === "analysis"); model.roles[0].skills = ["cycle-create"];
    model.nodes = [{ id: "mixed", kind: "sequence", participant_ref: "delivery", children: ["reload", "admit", "initialize", "analyze", "plan_evaluate", "plan_record", "plan_wait"] },
      op("reload", "context_reload"), op("admit", "session_admit"), op("initialize", "session_initialize"), native("analyze"), op("plan_evaluate", "cycle_plan_evaluate"), op("plan_record", "cycle_plan_record"),
      { id: "plan_wait", kind: "event", participant_ref: "delivery", branches: [{ flow_id: "continue", node_id: "end_continue", event_key: "continue_snapshot" }, { flow_id: "stop", node_id: "end_stop", event_key: "stop_snapshot" }] },
      op("end_continue", "context_reload"), op("end_stop", "context_reload")];
    model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(row => model.nodes.some(node => node.binding_ref === row.id)).map(row => [row.id, shadowHash(row)]));
    model.data_bindings = { contract_version: "process-data-bindings.v1", parameter_keys: ["session"], inputs: [
      { node_id: "reload", fields: {} }, { node_id: "admit", fields: {} },
      { node_id: "initialize", fields: Object.fromEntries(["session_id", "session_branch", "objective"].map(name => [name, { source: "parameter", key: "session", path: [name] }])) },
      { node_id: "plan_evaluate", fields: { report_occurrence_id: { source: "occurrence_id", node_id: "analyze" } } },
      { node_id: "plan_record", fields: { evaluation_operation_id: { source: "operation_id", node_id: "plan_evaluate" } } },
      { node_id: "end_continue", fields: {} }, { node_id: "end_stop", fields: {} }] };
    if (options.readiness) {
      model.nodes[0].children.splice(-1, 0, "readiness_evaluate", "implementation_enter");
      model.nodes.push(op("readiness_evaluate", "cycle_readiness_evaluate"), op("implementation_enter", "cycle_implementation_enter"));
      for (const [node_id, key, source] of [["readiness_evaluate", "record_operation_id", "plan_record"], ["implementation_enter", "evaluation_operation_id", "readiness_evaluate"]])
        model.data_bindings.inputs.push({ node_id, fields: { [key]: { source: "operation_id", node_id: source } } });
      model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(row => model.nodes.some(node => node.binding_ref === row.id)).map(row => [row.id, shadowHash(row)]));
    }
    if (options.work) {
      model.roles.push({ ...original.roles.find(row => row.id === "implementation"), skills: [] });
      model.policies.push({ ...structuredClone(model.policies[0]), id: "work_policy", allowed_permissions: ["read:product", "write:product"] });
      model.nodes[0].children.splice(-1, 0, "implement", "work_evaluate");
      model.nodes.push({ ...native("implement"), policy_ref: "work_policy" }, op("work_evaluate", "cycle_work_evaluate"));
      model.data_bindings.contract_version = "process-data-bindings.v2";
      model.data_bindings.inputs.push({ node_id: "implement", fields: { implementation_operation_id: { source: "operation_id", node_id: "implementation_enter" } } },
        { node_id: "work_evaluate", fields: { report_occurrence_id: { source: "occurrence_id", node_id: "implement" } } });
      if (options.validation) {
        model.nodes[0].children.splice(-1, 0, "validate"); model.nodes.push(op("validate", "cycle_validation_execute"));
        model.data_bindings.inputs.push({ node_id: "validate", fields: { work_operation_id: { source: "operation_id", node_id: "work_evaluate" } } });
      }
      if (options.verification) {
        model.nodes[0].children.splice(-1, 0, "validation_evaluate", "verification_enter");
        model.nodes.push(op("validation_evaluate", "cycle_validation_evaluate"), op("verification_enter", "cycle_verification_enter"));
        model.data_bindings.inputs.push({ node_id: "validation_evaluate", fields: { validation_operation_id: { source: "operation_id", node_id: "validate" } } },
          { node_id: "verification_enter", fields: { evaluation_operation_id: { source: "operation_id", node_id: "validation_evaluate" } } });
      }
      model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(row => model.nodes.some(node => node.binding_ref === row.id)).map(row => [row.id, shadowHash(row)]));
    }
    if (options.taskProgress) taskProgressModel(model);
    if (options.audit) attachCycleAuditModel(model, original);
    if (options.closure) attachCycleClosureModel(model);
    if (options.closeRecord) attachCycleCloseRecordModel(model);
    if (options.closeFinalize) attachCycleCloseHookModel(model);
    if (options.objectiveCompletion) {
      f.objectiveCompletion = true;
      model.roles.push({ id: "objective_auditor", role: "auditor", action: "analyze", skills: ["drift-check"] });
      const policy = model.policies.find(row => row.id === model.nodes.find(row => row.id === "analyze").policy_ref);
      model.policies.push({ ...structuredClone(policy), id: "objective_drift_policy", allowed_permissions: ["read:product"] });
      model.nodes[0].children.splice(model.nodes[0].children.indexOf("close_finalize"), 0, "objective_drift", "objective_evaluate", "objective_decide", "objective_finalize");
      model.nodes.push({ id: "objective_drift", kind: "activity", participant_ref: "delivery", role_ref: "objective_auditor", policy_ref: "objective_drift_policy" });
      for (const [id, binding, field, source] of [["objective_evaluate", "drift_report_evaluate", "report_occurrence_id", "objective_drift"],
        ["objective_decide", "drift_recovery_decision", "evaluation_operation_id", "objective_evaluate"],
        ["objective_finalize", "drift_check_finalize", "evaluation_operation_id", "objective_evaluate"]]) {
        model.nodes.push(op(id, binding)); model.operation_pins[binding] = shadowHash(standardWorkflowOperationBindings().find(row => row.id === binding));
        model.data_bindings.inputs.push({ node_id: id, fields: { [field]: { source: field === "report_occurrence_id" ? "occurrence_id" : "operation_id", node_id: source } } });
      }
    }
    const content = fs.readFileSync(new URL("../../scaffold/codex/aidn-cycle-create/SKILL.md", import.meta.url));
    f.configuration.skills["cycle-create"] = { path: put(f.base, "package/cycle-create.md", content), sha256: sha(content) };
    f.configuration.activity_outputs = { analyze: CYCLE_PLAN_CONTRACT };
    if (options.objectiveCompletion) {
      f.configuration.activity_outputs.objective_drift = "standard-drift-report.v1";
      const content = fs.readFileSync(new URL("../../scaffold/codex/aidn-drift-check/SKILL.md", import.meta.url));
      f.configuration.skills["drift-check"] = { path: put(f.base, "package/drift-check.md", content), sha256: sha(content) };
    }
    if (options.work) f.configuration.activity_outputs.implement = options.taskProgress ? CYCLE_TASK_WORK_CONTRACT : CYCLE_WORK_CONTRACT;
    if (options.audit) {
      f.configuration.activity_outputs.audit_review = CYCLE_AUDIT_CONTRACT;
      const close = fs.readFileSync(new URL("../../scaffold/codex/aidn-cycle-close/SKILL.md", import.meta.url));
      f.configuration.skills["cycle-close"] = { path: put(f.base, "package/cycle-close.md", close), sha256: sha(close) };
    }
    fs.writeFileSync(f.configuration.model.path, JSON.stringify(model)); f.configuration.model.sha256 = sha(JSON.stringify(model));
  }
  f.configuration.instructions = options.planning ? { analyze: "Propose only the typed plan; never write files or declare DoR ready." }
    : options.drift ? { analyze: "Diagnose drift without writing recovery artifacts or acknowledging completion." }
    : { analyze: "Analyze without writing.", review: "Review without correcting." };
  if (options.audit) f.configuration.instructions.audit_review = "Audit the final product and supplied checklist read-only; report uncertainty and leave all decisions and writes to the host.";
  if (options.objectiveCompletion) f.configuration.instructions.objective_drift = "Diagnose the exact terminal context read-only; the host retains decisions and completion effects.";
  if (options.rediagnosis) {
    const report = { ...model.nodes.find(row => row.id === "analyze"), id: "closure_drift_report" };
    model.nodes = [model.nodes.find(row => row.id === "mixed"), ...model.nodes.filter(row => ["reload", "admit", "initialize"].includes(row.id)),
      { id: "closure_drift_loop", kind: "loop", participant_ref: "delivery", child: "closure_drift_iteration", until: "drift_check_completed", max_iterations: 2 },
      { id: "closure_drift_iteration", kind: "sequence", participant_ref: "delivery", children: ["closure_drift_report", "evaluate", "decide"] },
      report, op("evaluate", "drift_report_evaluate"), op("decide", "drift_recovery_decision")];
    model.nodes[0].children = ["reload", "admit", "initialize", "closure_drift_loop"];
    model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(row => model.nodes.some(node => node.binding_ref === row.id)).map(row => [row.id, shadowHash(row)]));
    model.data_bindings.inputs = model.data_bindings.inputs.filter(row => ["reload", "admit", "initialize", "evaluate", "decide"].includes(row.node_id));
    model.data_bindings.inputs.find(row => row.node_id === "evaluate").fields.report_occurrence_id.node_id = "closure_drift_report";
    f.configuration.activity_outputs = { closure_drift_report: "standard-drift-report.v1" };
    f.configuration.instructions = { closure_drift_report: "Diagnose this exact context without writes. A diagnosis request is separate from Native permission." };
    fs.writeFileSync(f.configuration.model.path, JSON.stringify(model)); f.configuration.model.sha256 = sha(JSON.stringify(model));
  }
  if (options.work) f.configuration.instructions.implement = options.taskProgress ? "Implement only the host-selected task and its done criteria; host validation and progression remain separate." : "Implement the frozen first task only; leave deterministic validation to the host.";
  const criteriaText = options.taskProgress ? `Follow the selected task: intermediate value 2, final value ${options.taskFinalValue}, unchanged interface. Host checks remain separate.` : options.work ? "The admitted local value becomes 2; validation remains a separate host operation." : "Read the product without changing any bytes.";
  fs.writeFileSync(f.configuration.criteria.path, criteriaText); f.configuration.criteria.sha256 = sha(criteriaText);
  const worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
  f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)), helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
  if (options.standardModel) {
    const assets = loadStandardWorkflowAssets();
    for (const key of Object.keys(model)) delete model[key];
    Object.assign(model, structuredClone(assets.model));
    const bytes = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, bytes); f.configuration.model.sha256 = sha(bytes);
    f.configuration.activity_outputs = Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, row.output_contract]));
    f.configuration.instructions = Object.fromEntries(assets.catalog.activities.map(row => [row.node_id,
      "Return only the scoped typed report. The host owns governance writes, admission and skill completion."]));
    const paths = [...new Set(assets.catalog.activities.flatMap(row => row.skill_sources.map(source => source.path)))];
    f.configuration.skills = Object.fromEntries(paths.map(name => {
      const id = name.match(/aidn-([^/]+)\/SKILL[.]md$/)[1], content = fs.readFileSync(new URL("../../" + name, import.meta.url));
      return [id, { path: put(f.base, `standard-skills/${id}.md`, content), sha256: sha(content) }];
    }));
  }
  const committed = spawnSync("git", ["add", "product/app.mjs"], { cwd: projectRoot, encoding: "utf8", shell: false }); assert.equal(committed.status, 0, committed.stderr);
  const commit = spawnSync("git", ["-c", "core.hooksPath=NUL", "commit", "-m", "fixture product"], { cwd: projectRoot, encoding: "utf8", shell: false }); assert.equal(commit.status, 0, commit.stderr);
  const key = Buffer.alloc(32, 91), t = transport(f, options), controllerFactory = journalController(f, t, options);
  const grant = { authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) };
  if (options.closure) {
    f.closureSourceFile = path.join(f.base, "human-closure-sources.json"); fs.writeFileSync(f.closureSourceFile, "{}");
    options.humanSource = closureHumanSource(f.closureSourceFile);
  }
  if (options.standardModel) {
    f.sessionPushRemoteRoot = path.join(f.base, "session-push-remote.git"); fs.mkdirSync(f.sessionPushRemoteRoot);
    execFileSync("git", ["init", "--bare", f.sessionPushRemoteRoot], { stdio: "pipe", windowsHide: true, timeout: 30000 });
    // A source branch already exists on the offline remote before workflow
    // delivery. This is fixture arrangement, not a standard push receipt.
    execFileSync("git", ["-C", projectRoot, "-c", "core.hooksPath=NUL", "push", "--", f.sessionPushRemoteRoot, "HEAD:refs/heads/dev"],
      { stdio: "pipe", windowsHide: true, timeout: 30000 });
  }
  const observe = host => options.hostTrace ? observeComposedHost(host, path.join(f.configuration.control_root, 'composed-host-' + process.pid + '.jsonl')) : host;
  const compose = () => observe((options.standardModel ? createStandardWorkflowExecution : createStandardWorkflowMixedHost)({ configuration: f.configuration, readSigningKey: () => key,
    authorize: options.authorize ?? (async () => grant), controlSource: options.controlSource, humanSource: options.humanSource, validationProfile: f.validationProfile, nativeAuthorizationSource: options.nativeAuthorizationSource,
    sessionPushPort: f.sessionPushRemoteRoot ? createLocalWorkflowSessionPush({ targetRoot: projectRoot, remoteRoot: f.sessionPushRemoteRoot }) : null,
    sessionPullRequestPort: f.sessionPushRemoteRoot ? createGithubPrOpenTransportFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: f.configuration.control_root }).port : null,
    sessionReviewEventPort: f.sessionPushRemoteRoot ? createStandardReviewEventFixture(f.configuration.control_root) : null,
    sessionReviewPort: f.sessionPushRemoteRoot ? createComposedGithubReviewFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: f.configuration.control_root }) : null }, { controllerFactory, ...(options.validation ? { validationBoundaryFactory: fixtureValidationBoundary } : {}) }));
  // The human path also qualifies a retained common host. Authority/evidence
  // reads remain inside its methods; acceptance still restarts in a cold Node.
  let sharedHost;
  const open = () => options.closure || options.standardModel ? sharedHost ??= compose() : compose();
  Object.assign(f, { open, reopen: () => { sharedHost = undefined; return open(); }, key, t, model, ...(options.recoveryCycle ? { cycleParameters: { cycle_id: options.changeRequest ? "C002" : "C001", cycle_type: "spike", title: "admitted-recovery" } } : {}) }); return f;
}
function restoreComposedFixture(data, options) {
  if (data.proof_class !== "offline-fixture-only" || shadowHash(data.fixture.configuration) !== data.authorization.configuration_sha256)
    throw Error("STANDARD_FIXTURE_RESUME_CONFIGURATION_CHANGED");
  const f = { ...data.fixture }, key = Buffer.alloc(32, 91), t = transport(f, options), controllerFactory = journalController(f, t, options);
  const model = JSON.parse(fs.readFileSync(f.configuration.model.path));
  assert.equal(shadowHash(model), loadStandardWorkflowAssets().source.model_sha256);
  const grant = { authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) };
  let sharedHost;
  const observe = host => options.hostTrace ? observeComposedHost(host, path.join(f.configuration.control_root, 'composed-host-' + process.pid + '.jsonl')) : host;
  const open = () => sharedHost ??= observe(createStandardWorkflowExecution({ configuration: f.configuration, readSigningKey: () => key,
    authorize: async () => grant, humanSource: options.humanSource, validationProfile: f.validationProfile,
    sessionPushPort: f.sessionPushRemoteRoot ? createLocalWorkflowSessionPush({ targetRoot: f.configuration.target_root, remoteRoot: f.sessionPushRemoteRoot }) : null,
    sessionPullRequestPort: f.sessionPushRemoteRoot ? createGithubPrOpenTransportFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: f.configuration.control_root }).port : null,
    sessionReviewEventPort: f.sessionPushRemoteRoot ? createStandardReviewEventFixture(f.configuration.control_root) : null,
    sessionReviewPort: f.sessionPushRemoteRoot ? createComposedGithubReviewFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: f.configuration.control_root }) : null },
    { controllerFactory, ...(f.validationProfile ? { validationBoundaryFactory: fixtureValidationBoundary } : {}) }));
  return Object.assign(f, { open, reopen: () => { sharedHost = undefined; return open(); }, key, t, model });
}
async function bootstrapMixed(f) {
  const input = { session_id: "S001", session_branch: "S001-mixed", objective: f.sessionObjective ?? "Execute real mixed bootstrap" };
  const parameters = f.model.data_bindings ? { parameters: { session: input, ...(f.cycleParameters ? { cycle: f.cycleParameters } : {}) } } : {};
  const h = f.open(), initial = h.initialize({ write: false, ...parameters });
  h.initialize({ write: true, expectedResultSha256: initial.record.instance_sha256, ...parameters });
  for (let count = 0; count < 3; count++) {
    const result = await f.open().step({ write: true, input: count === 2 && !f.model.data_bindings ? input : {} });
    assert.equal(result.kind, "operation"); assert.notEqual(result.cursor.status, "FAILED");
  }
  const auth = f.authorize(); auth.global_deadline_ms += 1800000; auth.workflow_deadline_ms += 1800000;
  return auth;
}
function finalizationFixture(mode = "files", options = {}) {
  return mixedFixture(mode, { drift: true, finalize: true, ...options, answer({ params }) {
    const context = JSON.parse(params.input[0].text.split("\n").at(-1));
    return { outcome: "completed", summary: "Scoped diagnostic fixture.", report: { contract_version: "standard-drift-report.v1", context_sha256: context.context_sha256,
      original_objective: context.context.original_objective, current_objective: context.context.original_objective, drift_level: "none", objective_changed: false,
      changes: [], keep: ["Current scope"], discard: [], split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" },
      recommendation: "continue", rationale: "Fixture native wire only; application finalization is real.", evidence_refs: context.evidence_refs } };
  } });
}
async function readyFinalization(f) {
  const auth = await bootstrapMixed(f), native = await f.open().step({ write: true, authorization: auth });
  assert.equal(native.journal_phase, "closed", JSON.stringify(native));
  const state = f.open().inspect(), occurrence = state.cursor.occurrences.find(row => row.node_id === "analyze").occurrence_id;
  const evaluated = await f.open().step({ write: true, input: { report_occurrence_id: occurrence } });
  return { evaluated, input: { evaluation_operation_id: evaluated.operation_id } };
}
async function prepareCompletionCycle(f, state, intermediate = false) {
  const targetRoot = f.configuration.target_root, operations = createStandardWorkflowOperations({ targetRoot }), artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const git = (...args) => { const result = spawnSync("git", ["-c", "core.hooksPath=NUL", ...args], { cwd: targetRoot, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr.slice(-512) || result.stdout.slice(-512)); return result.stdout.trim(); };
  let prepared = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture selected mode");
  prepared = await operations.prepareCycleContext({ session_id: "S001" });
  assert.equal((await operations.refreshCycleContext(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture prepared cycle context");
  const objective = f.cycleObjective ?? "Execute real mixed bootstrap with an admitted terminal cycle";
  prepared = await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "completion-context", objective,
    continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-mixed" });
  assert.equal(prepared.can_apply, true, JSON.stringify({ reason: prepared.reason_code,
    blockers: prepared.admission?.prewrite?.blocking_reasons, action: prepared.admission?.lifecycle?.action }));
  assert.equal((await operations.initializeCycle(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  const context = () => readStandardDriftContext({ targetRoot, productRoot: f.configuration.product_root,
    productFiles: f.configuration.product_files, productSha256: f.open().previewNative().product_sha256 });
  const active = await context(); assert.equal(active.context.context_use, "active_cycle"); assert.equal(active.context.original_objective, objective);
  const statusPath = "cycles/C001-feature-completion-context/status.md", briefPath = statusPath.replace("status.md", "brief.md");
  if (state === "OPEN") {
    git("add", "."); git("commit", "--allow-empty", "-m", "fixture active cycle precondition");
    return { artifacts, statusPath, briefPath, objective, git, context };
  }
  async function change(changes) {
    return artifacts.withLocalEffectOwner(shadowHash({ fixture: "terminal-context-precondition", changes }), async () => {
      for (const [name, after] of changes) { const before = artifacts.read(name); artifacts.compareAndSwap({ path: name, before_sha256: before.sha256, after }); }
      artifacts.project(changes.map(([name]) => name)); return { effect_status: "confirmed" };
    });
  }
  // Terminal state is an explicit fixture precondition, not proof of the still
  // missing cycle validation/closure IR ports. All later reads/hooks are real.
  const status = artifacts.read(statusPath), current = artifacts.read("CURRENT-STATE.md"), snapshot = artifacts.read("snapshots/context-snapshot.md");
  await change([[statusPath, status.content.replace(/^state:.*$/m, "state: " + state).replace(/^outcome:.*$/m, "outcome: " + state)],
    [current.path, current.content.replace(/^active_cycle:.*$/m, "active_cycle: none")],
    [snapshot.path, snapshot.content.replace(/(^## Active cycles[^\r\n]*\r?\n)[\s\S]*?(?=^## |$(?![\s\S]))/m, "$1\n- none\n\n")
      .replace(/(^## Next entry point[^\r\n]*\r?\n)[\s\S]*?(?=^## |$(?![\s\S]))/m, "$1\n- Finish the admitted terminal cycle drift check.\n\n")]]);
  if (intermediate) git("switch", "-c", "feature/C001-I1-completion-context");
  prepared = await operations.prepareCycleContext({ session_id: "S001" });
  assert.equal((await operations.refreshCycleContext(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture terminal context precondition");
  return { artifacts, statusPath, briefPath, objective, git, change, context };
}

if (process.argv[2] === "--mixed-continue") {
  try {
    const data = JSON.parse(fs.readFileSync(process.argv[3])), f = { ...data.fixture, launches: 0 }, key = Buffer.from(data.key_hex, "hex"), t = transport(f);
    const host = createStandardWorkflowMixedHost({ configuration: f.configuration, readSigningKey: () => key,
      authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) }) }, { controllerFactory: journalController(f, t) });
    const native = await host.step({ write: true, authorization: data.authorization }), last = await host.step({ write: true });
    process.stdout.write(JSON.stringify({ native, status: last.cursor.status, instance_sha256: last.record.instance_sha256, launches: f.launches,
      sessions: t.sessions.length, closed: t.sessions.every(row => row.closed), leaked_key: JSON.stringify(t.sessions.map(row => row.configuration)).includes(key.toString("base64")) }) + "\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
} else if (["--closure-accept", "--closure-finalize"].includes(process.argv[2])) {
  try {
    const data = JSON.parse(fs.readFileSync(process.argv[3])), f = { ...data.fixture, launches: 0 }, key = Buffer.from(data.key_hex, "hex"), t = transport(f);
    const host = createStandardWorkflowMixedHost({ configuration: f.configuration, readSigningKey: () => key, validationProfile: data.validation_profile,
      humanSource: closureHumanSource(data.human_source_file), authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) }) },
      { controllerFactory: journalController(f, t), validationBoundaryFactory: fixtureValidationBoundary });
    const result = process.argv[2] === "--closure-finalize" ? await host.step({ write: true }) : await host.acceptOperation(data.operation_id, { write: true });
    process.stdout.write(JSON.stringify({ ...(result.operation_id ? { operation_id: result.operation_id } : {}), instance_sha256: result.record.instance_sha256, status: result.cursor.status, launches: f.launches, sessions: t.sessions.length }));
  } finally {
    const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(resolved).startsWith("aidn-agentic-execution-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
} else if (process.argv[2] === "--recovery-record") {
  try {
    const data = JSON.parse(fs.readFileSync(process.argv[3])), f = { ...data.fixture, launches: 0 }, key = Buffer.from(data.key_hex, "hex"), t = transport(f);
    const host = createStandardWorkflowMixedHost({ configuration: f.configuration, readSigningKey: () => key, validationProfile: data.validation_profile,
      authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) }) }, { controllerFactory: journalController(f, t), ...(data.validation_profile ? { validationBoundaryFactory: fixtureValidationBoundary } : {}) });
    const result = await host.step({ write: true });
    process.stdout.write(JSON.stringify({ operation_id: result.operation_id, instance_sha256: result.record.instance_sha256,
      status: result.cursor.status, launches: f.launches, sessions: t.sessions.length }) + "\n");
  } finally {
    const owned = fs.realpathSync(root);
    assert.equal(path.dirname(owned), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(owned).startsWith("aidn-agentic-execution-"));
    fs.rmSync(owned, { recursive: true, force: true });
  }
} else if (process.argv[2] === "--resume-allocation") {
  try {
    const data = JSON.parse(fs.readFileSync(process.argv[3])), f = { ...data.fixture, launches: 0 }, key = Buffer.from(data.key_hex, "hex"), t = transport(f);
    const actor = createJournaledNativeAllocation({ configuration: f.configuration, readSigningKey: () => key,
      ...(f.environment ? { environment: f.environment } : {}) }, { controllerFactory: journalController(f, t) });
    const result = await actor.run({ execute: true, resume: true, authorization: data.authorization });
    process.stdout.write(JSON.stringify({ result, launches: f.launches, sessions: t.sessions.length,
      closed: t.sessions.every(row => row.closed), leaked_key: JSON.stringify(t.sessions.map(row => row.configuration)).includes(key.toString("base64")) }) + "\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
} else try {
  await check("native human port: current source, subject, reservation and cancellation remain authenticated", async () => {
    console.log(JSON.stringify(await verifyNativeHumanVerificationPort()));
  });
  if (driftWorkerMode) await check("drift worker current human: " + driftWorkerMode, async () => {
    const claims = new Map(); let f, review, live = true;
    const actualNow = Date.now;
    const humanSource = { read: ({ sourceRef }) => claims.get(sourceRef) ?? null, async verify({ source, sourceRef, question }) {
      await new Promise(resolve => setImmediate(resolve));
      if (f?.launches >= 2 && driftWorkerMode === "expired") Date.now = () => review.prepared_at_ms + 300001;
      if (!live || shadowHash(claims.get(sourceRef)) !== shadowHash(source) || source.question_sha256 !== shadowHash(question)) return { outcome: "unverified" };
      return { outcome: "verified", authority_id: f?.launches >= 2 && driftWorkerMode === "wrong-authority" ? "another" : source.authority_id,
        source_sha256: f?.launches >= 2 && driftWorkerMode === "wrong-subject" ? "f".repeat(64) : shadowHash(source) };
    } };
    f = finalizationFixture("files", { recovery: true, finalize: false, rediagnosis: true, humanSource,
      beforeWorker() { if (f.launches >= 2 && driftWorkerMode === "revoked") live = false; } });
    f.sessionObjective = "Learn through an explicitly admitted bounded SPIKE";
    f.cycleObjective = "Determine whether a bounded prototype is useful";
    try {
      const authorization = await bootstrapMixed(f); await prepareCompletionCycle(f, "DONE");
      const host = f.open(), first = await host.step({ write: true, authorization });
      assert.equal(first.journal_phase, "closed", JSON.stringify(first));
      await host.step({ write: true });
      const waiting = await host.step({ write: true }); assert.equal(waiting.status, "waiting_for_human");
      review = waiting.question.review; assert.equal(review.contract_version, "standard-drift-recovery-plan.v2");
      const claim = { contract_version: "human-drift-recovery-decision.v2", source_kind: "human", authority_id: "fixture_operator",
        source_event_id: "fixture-worker-diagnosis", subject_sha256: shadowHash(review), question_sha256: shadowHash(waiting.question),
        choice: "request_diagnosis", rationale: "Fixture current request; the separate Native grant is still required.",
        evidence_refs: [{ ref: "fixture:current-human", sha256: shadowHash(review) }] };
      claims.set("current", claim); await host.receiveDecision(waiting.operation_id, { write: true, sourceRef: "current" });
      await host.acceptOperation(waiting.operation_id, { write: true });
      const before = host.inspect().record, count = f.t.calls.filter(row => row.method === "turn/start").length;
      const result = await host.step({ write: true, authorization });
      if (driftWorkerMode === "nominal") { assert.equal(result.journal_phase, "closed", JSON.stringify(result));
        assert.equal(f.t.calls.filter(row => row.method === "turn/start").length, count + 1);
      } else {
        assert.equal(result.first_failure, driftWorkerMode === "expired" ? "STANDARD_DRIFT_DIAGNOSIS_REQUEST_EXPIRED" : "PROCESS_HUMAN_NOT_AUTHENTICATED", JSON.stringify(result));
        assert.equal(f.t.calls.filter(row => row.method === "turn/start").length, count); assert.equal(f.t.sessions.length, 1);
      }
      assert.ok(f.t.sessions.every(row => row.closed));
      assert.equal(shadowHash(host.inspect().record.events.slice(0, before.events.length)), shadowHash(before.events));
      assert.equal(JSON.stringify(f.t.calls).includes("human_verification"), false);
      console.log(JSON.stringify({ scope: "production-parent-worker-ports-with-fixture-actors", mode: driftWorkerMode, result,
        original_human_source_unchanged: shadowHash(claims.get("current")) === shadowHash(claim), published_process: "NOT_RUN", independent_worker_process: "NOT_RUN", native: "fixture" }));
    } finally { Date.now = actualNow; }
  });
  if (selectedSpikeMode) await check("standard spike: published model and real conversion wrapper", () => verifyStandardSpikeExecution({
    mixedFixture, storageMode: selectedSpikeMode, choice: selectedSpikeChoice, experiment: selectedSpikeExperiment, closeSession: selectedSpikeSessionClose }));
  if (selectedModeWorkResumeMode) await check("standard mode resume: expired authority and new cold authenticated decision", () => verifyModeWorkContinuationExecution({
    storageMode: selectedModeWorkResumeMode, sessionMode: selectedModeWorkSession, choice: selectedModeWorkResumeChoice,
    firstDisposition: selectedModeWorkResumeDisposition, mixedFixture }));
  if (selectedModeWorkMode) await check("standard mode analysis: published mixed execution and cold read-only polling", () => verifyModeAnalysisExecution({
    storageMode: selectedModeWorkMode, sessionMode: selectedModeWorkSession, disposition: selectedModeWorkDisposition, mixedFixture, closeSession: selectedModeWorkClose, closureChoice: selectedModeClosureChoice,
  }));
  if (selectedStandardComposedMode) await check(`standard composed ${selectedStandardComposedMode}: shipped model owns actual startup/cycle/R05 prefix to ${standardComposedStop}`, async () => {
    const mode = selectedStandardComposedMode;
    let sourceFile;
    const humanSource = { read: options => sourceFile ? closureHumanSource(sourceFile).read(options) : null,
      verify: options => sourceFile ? closureHumanSource(sourceFile).verify(options) : { outcome: "unverified" } };
    const resumed = standardResumeInput;
    const factory = standardComposedResume ? (_mode, options) => restoreComposedFixture(resumed, options) : mixedFixture;
    const stopsBeforeCorrectionChoice = standardComposedStop === "session_pr_correction_decide";
    const runsPromotion = standardComposedStop === "component_complete" || stopsBeforeCorrectionChoice;
    const runsClosure = runsPromotion || standardComposedStop === "promotion_decide";
    const runsCycle = runsClosure || standardComposedStop === "closure_decide";
    let nativeAnswerSource;
    const f = factory(mode, { standardModel: true, validation: runsCycle, humanSource, hostTrace: standardHostTrace, async answer({ params }) {
      const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
      if (observed.context.contract_version === "standard-cycle-plan-context.v1")
        return { outcome: "completed", summary: "Scoped read-only plan proposal", report: fullCorrection ? composedCyclePlan(observed) : cyclePlanProposal(observed) };
      if (observed.context.contract_version === "standard-cycle-audit-context.v1")
        return { outcome: "completed", summary: "Scoped read-only audit proposal", report: cycleAuditProposal(observed) };
      if (observed.context.contract_version === "standard-pr-triage-context.v1") {
        return fullCorrection ? composedTriageAnswer(observed, nativeAnswerSource) : standardReviewScenarioAnswer(observed, standardScenarioName);
      }
      if (observed.context.contract_version === "standard-cycle-task-work-context.v1") {
        const context = observed.context;
        const cycleId = context.source_context.cycle_id;
        const corrected = fullCorrection && cycleId !== parameters.cycle.cycle_id;
        const from = corrected ? 2 : 1, to = corrected ? 3 : 2;
        assert.ok(cycleId);
        if (corrected) {
          assert.equal(nativeAnswerSource?.kind, 'task');
          assert.equal(nativeAnswerSource.cycle_id, cycleId);
        }
        const request = { tool_name: "apply_patch", cwd: f.configuration.target_root,
          tool_input: { command: `*** Begin Patch\n*** Update File: product/app.mjs\n@@\n-export const value = ${from};\n+export const value = ${to};\n*** End Patch` } };
        const admission = await preWriteAdmit({ targetRoot: f.configuration.target_root, skill: "start-session", nativeRequest: request });
        assert.equal(admission.write_decision.outcome, "allow", JSON.stringify(admission.write_decision));
        assert.equal(fs.readFileSync(path.join(f.configuration.product_root, 'app.mjs'), 'utf8'), `export const value = ${from};\n`);
        fs.writeFileSync(path.join(f.configuration.product_root, "app.mjs"), `export const value = ${to};\n`);
        return { outcome: "completed", summary: "Admitted fixture product change; host verification remains separate", report: {
          contract_version: CYCLE_TASK_WORK_CONTRACT, context_sha256: observed.context_sha256, task_id: context.task.id, task: context.task.task,
          work_outcome: "changed", changes: [{ path: "product/app.mjs", operation: "update" }], notes: ["Host verification remains separate"] } };
      }
      assert.equal(observed.context.contract_version, "standard-drift-context.v2");
      return { outcome: "completed", summary: "Scoped diagnostic fixture; production ports remain real", report: {
        contract_version: "standard-drift-report.v1", context_sha256: observed.context_sha256,
        original_objective: observed.context.original_objective, current_objective: observed.context.original_objective,
        drift_level: "none", objective_changed: false, changes: [], keep: ["Current scope"], discard: [],
        split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" },
        recommendation: "continue", rationale: "Fake native wire diagnostic; no recovery or completion claim", evidence_refs: observed.evidence_refs } };
    } });
    sourceFile = resumed?.fixture.human_source_file ?? path.join(f.configuration.control_root, "standard-human-sources.json");
    if (!resumed) arrangeStandardReviewScenario(f.configuration.control_root, fullCorrection ? 'correction' : standardScenarioName);
    if (!resumed) fs.writeFileSync(sourceFile, "{}");
    if (!fs.existsSync(sourceFile)) throw Error("STANDARD_FIXTURE_HUMAN_SOURCE_HISTORY_REQUIRED");
    const publish = (ref, claim) => {
      const entries = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
      if (entries[ref] && shadowHash(entries[ref]) !== shadowHash(claim)) throw Error("STANDARD_FIXTURE_HUMAN_SOURCE_CHANGED");
      fs.writeFileSync(sourceFile, JSON.stringify({ ...entries, [ref]: claim }));
    };
    // One admitted objective; a distinct cycle goal needs its recovery route.
    const objective = "Exercise the published standard workflow on a disposable project";
    const parameters = { session: { session_id: "S001", session_branch: "S001-standard", objective },
      cycle: { cycle_id: "C001", cycle_type: "feature", title: "standard-prefix", objective } };
    if (runsCycle && !resumed) {
      f.validationProfile = fullCorrection ? composedCycleValidationProfile(f.base) : createValidationProfileFixture(f.base, { testRef: "TEST-001" }).profileRef;
      const criteria = fullCorrection ? 'Follow the host-selected cycle task: first value 2, corrective value 3; preserve the exported interface and use the separate planned verifier.'
        : "The admitted local value becomes 2 while preserving its exported interface; host verification remains separate.";
      fs.writeFileSync(f.configuration.criteria.path, criteria); f.configuration.criteria.sha256 = sha(criteria);
      f.configuration.instructions.implement = "Implement only the host-selected task. Host validation, progression and governance writes remain separate.";
    }
    const resumeFile = path.join(f.configuration.control_root, "standard-resume.json");
    let auth;
    if (resumed) {
      auth = resumed.authorization;
      if (standardComposedBudgetText !== undefined && (auth.global_deadline_ms - auth.authorized_at_ms !== standardComposedBudgetMs
        || auth.workflow_deadline_ms !== auth.global_deadline_ms)) throw Error("STANDARD_COMPOSED_FIXTURE_ORIGINAL_BUDGET_CHANGED");
    }
    else {
      const initial = f.open().initialize({ parameters });
      f.open().initialize({ parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
      auth = f.authorize(); auth.global_deadline_ms += 1800000; auth.workflow_deadline_ms += 1800000; auth.max_turn_ms = 300000;
      auth.max_responses = standardScenario.max_responses;
      if (runsClosure) {
        auth.global_deadline_ms = auth.workflow_deadline_ms = auth.authorized_at_ms + standardComposedBudgetMs;
        auth.max_bytes = 32 * 1024 * 1024;
      }
      fs.writeFileSync(resumeFile, JSON.stringify({ proof_class: "offline-fixture-only", fixture: { configuration: f.configuration, base: f.base, dirs: f.dirs,
        human_source_file: sourceFile, sessionPushRemoteRoot: f.sessionPushRemoteRoot, ...(f.validationProfile ? { validationProfile: f.validationProfile } : {}) },
        scenario: standardScenario, preflight: standardPreflight, authorization: auth,
        experiment: { host_trace: standardHostTrace, checkpoint_ack_loss: standardCheckpointAckLoss, checkpoint_owner_ack_loss: standardCheckpointOwnerAckLoss } }));
    }
    const priorNativeResults = resumed ? f.open().inspect().record.events.filter(event => event.kind === "result").length : 0;
    let childNativeSessions = 0, coldContinuation = false;
    for (let step = 0; step < (fullCorrection ? 160 : 80); step++) {
      const state = f.open().inspect();
      if (runsPromotion && state.cursor.status === "COMPLETED") break;
      const frame = state.cursor.occurrences.find(row => row.status === "READY")
        ?? state.cursor.occurrences.find(row => row.status === "WAITING" && row.operation?.receipt?.outcome === "deferred");
      const reviewWait = state.cursor.occurrences.find(row => ['session_pr_review_wait', 'correction_pr_review_wait'].includes(row.node_id) && row.status === "WAITING");
      if (reviewWait) {
        const control = { instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: reviewWait.occurrence_id };
        const request = f.open().prepareControl(control), capture = () => f.open().captureControl({ ...control, sourceRef: "fixture:standard-review", write: true });
        assert.equal((await f.open().step({ write: false })).kind, "wait");
        assert.equal((await capture()).status, "waiting_for_control");
        assert.equal(f.open().inspect().record.instance_sha256, state.record.instance_sha256);
        await assert.rejects(f.open().captureControl({ ...control, sourceRef: "fixture:claim", captureKind: "claim", write: true }), { code: "PROCESS_CONTROL_CAPTURE_KIND_INVALID" });
        const redelivery = reviewWait.node_id === 'correction_pr_review_wait';
        const intent = state.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === (redelivery ? 'session_pr_redelivery_push' : 'session_pr_update_push')).at(-1).intent;
        const p = f.open().readOperation(intent.operation_id).results.at(-1).output.observations.pull_request;
        const event = { contract_version: "github-pr-review-event.v1", authority_id: "fixture_provider", source_event_id: redelivery ? 'standard-review-event-2' : "standard-review-event-1",
          repository_id: p.repository_id, pull_request_id: p.node_id, pull_request_number: p.number, head_oid: p.head_oid, base_oid: p.base_oid,
          head_ref: p.head_branch, base_ref: p.base_branch, event_key: "review_snapshot", revision: redelivery ? 'fixture-review-revision-2' : "fixture-review-revision-1",
          occurred_at: new Date().toISOString(), actor: { node_id: "U_fixture", login: "fixture-reviewer", type: "User" } };
        const file = path.join(f.configuration.control_root, "standard-pr-review-event.json");
        fs.writeFileSync(file, JSON.stringify({ event, authorized: false, current: true }));
        await assert.rejects(capture(), { code: "PROCESS_CONTROL_PR_NOT_AUTHENTICATED" });
        fs.writeFileSync(file, JSON.stringify({ event, authorized: true, current: true }));
        const reserved = await capture(); assert.equal(reserved.status, "reserved");
        const captured = f.open().readControl(reserved.inbox_id);
        assert.equal(captured.request.instance_sha256, request.instance_sha256);
        assert.equal(captured.payload.observation.observations.update_operation_id, intent.operation_id);
        assertCapturedStandardReviewScenario(captured, fullCorrection ? 'correction' : standardScenarioName);
        assert.equal(captured.phase, "reserved"); assert.equal(f.open().inspect().record.instance_sha256, state.record.instance_sha256);
        const allocations = f.open().inspectAllocations();
        const child = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("standard-pr-review-control-resume-fixture.mjs", import.meta.url)), resumeFile, reserved.inbox_id],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 600000, maxBuffer: 1048576 }));
        assert.equal(child.new_native_allocations, 0); assert.equal(child.signed_payload_consumed, true);
        assert.equal(f.reopen().inspect().record.instance_sha256, child.instance_sha256);
        assert.deepEqual(f.open().inspectAllocations(), allocations);
        console.log(JSON.stringify({ standard_pr_wait_selected: true, signed_payload_consumed: true, fresh_process_resume: true, new_native_allocations: 0 }));
        continue;
      }
      assert.ok(frame, JSON.stringify({ status: state.cursor.status, waits: state.cursor.occurrences.filter(row => row.status === "WAITING") }));
      if (frame.node_id === standardComposedStop) break;
      let result;
      if (standardCheckpointOwnerAckLoss && frame.node_id === 'session_pr_correction_checkpoint') {
        const lost = await loseCheckpointOwnerReleaseAck({ targetRoot: f.configuration.target_root }, () => f.open().step({ write: true, authorization: auth }));
        const original = f.open().readOperation(lost.operation_id);
        assert.equal(lost.result.status, 'WAITING'); assert.equal(original.results[0].receipt.effect_status, 'unknown');
        assert.ok(f.open().inspect().record.events.some(row => row.kind === 'operation_result' && shadowHash(row.receipt) === shadowHash(original.results[0].receipt)));
        const child = spawnSync(process.execPath, [fileURLToPath(new URL('standard-pr-correction-checkpoint-host-resume-fixture.mjs', import.meta.url)), resumeFile, lost.operation_id],
          { encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 1048576 });
        retainComposedChild(f.configuration.control_root, 'checkpoint-recovery-child', child);
        console.error(JSON.stringify({ checkpoint_recovery_child: true, pid: child.pid ?? null, status: child.status, signal: child.signal,
          error_code: child.error?.code ?? null, stdout_bytes: Buffer.byteLength(child.stdout ?? ''), stderr_bytes: Buffer.byteLength(child.stderr ?? '') }));
        assert.equal(child.status, 0, ((child.stdout ?? '') + (child.stderr ?? '')).slice(-16384));
        const proof = JSON.parse(child.stdout);
        assert.equal(proof.dispatcher_unknown_recovered_by_real_host, true); assert.equal(proof.new_native_allocations, 0);
        assert.equal(f.reopen().inspect().record.instance_sha256, proof.instance_sha256);
        assert.deepEqual(f.open().readOperation(lost.operation_id).results[0], original.results[0]);
        console.log(JSON.stringify({ standard_checkpoint_unknown_proof: proof, fault: 'actual owner unlink succeeded; acknowledgement lost; dispatcher signed unknown', owner: lost.owner }));
        result = { kind: 'operation', operation_id: lost.operation_id, status: proof.workflow_status };
      } else if (standardCheckpointAckLoss && frame.node_id === 'session_pr_correction_checkpoint') {
        const lost = await loseCheckpointReceipt({ targetRoot: f.configuration.target_root }, () => f.open().step({ write: true, authorization: auth }));
        const original = f.open().readOperation(lost.operation_id);
        assert.equal(original.phase, 'dispatching'); assert.deepEqual(original.results, []);
        const child = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('standard-pr-correction-checkpoint-host-resume-fixture.mjs', import.meta.url)), resumeFile, lost.operation_id],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 600000, maxBuffer: 1048576 }));
        assert.equal(child.missing_receipt_recovered_by_real_host, true); assert.equal(child.new_native_allocations, 0);
        assert.equal(f.reopen().inspect().record.instance_sha256, child.instance_sha256);
        const recovered = f.open().readOperation(lost.operation_id);
        for (const key of ['preview', 'intent', 'grant', 'owner']) assert.deepEqual(recovered[key], original[key]);
        assert.equal(recovered.results.length, 1); assert.equal(recovered.results[0].receipt.receipt_id, lost.attempted_receipt.receipt_id);
        assert.equal(recovered.results[0].output.observations.git.commit_sha, lost.output.observations.git.commit_sha);
        console.log(JSON.stringify({ standard_checkpoint_ack_loss_proof: child, effect: 'actual Git commit; interrupted receipt rename; cold real-host recovery' }));
        result = { kind: 'operation', operation_id: lost.operation_id, status: child.workflow_status };
      } else {
        if (fullCorrection) nativeAnswerSource = prepareComposedNativeAnswer({ nodeId: frame?.node_id, instance: state.record,
          readOperation: id => f.open().readOperation(id) });
        result = await f.open().step({ write: true, authorization: auth });
      }
      if (result.operation_id) {
        if (result.status === "waiting_for_human") {
          const binding = f.open().readOperation(result.operation_id).intent.binding_ref;
          let claim, ref;
          if (binding === "mode_decision") {
            ref = "standard-mode";
            claim = { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "standard-mode-committing",
              subject_sha256: "a".repeat(64), question_sha256: shadowHash(result.question), choice: "COMMITTING", evidence_refs: [{ ref: "fixture:operator-mode", sha256: "a".repeat(64) }] };
          } else if (binding === 'session_pr_correction_decision') {
            assert.equal(fullCorrection, true);
            ref = 'correction_' + result.operation_id;
            const beforeWait = f.open().inspect().record.instance_sha256, nativeCount = f.t.sessions.length;
            assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: 'missing-correction', write: true })).status, 'waiting_for_human');
            assert.equal(f.open().inspect().record.instance_sha256, beforeWait); assert.equal(f.t.sessions.length, nativeCount);
            claim = composedCorrectionChoice(result.question, result.operation_id);
          } else if (binding === "session_branch_integration_decision") {
            assert.ok(runsPromotion); assert.ok(result.question.choices.includes("integrate-to-session"));
            const beforeWait = f.open().inspect().record.instance_sha256, nativeCount = f.t.sessions.length;
            assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: "missing-session-integration", write: true })).status, "waiting_for_human");
            assert.equal(f.open().inspect().record.instance_sha256, beforeWait); assert.equal(f.t.sessions.length, nativeCount);
            ref = "session_integration_" + result.operation_id;
            claim = { contract_version: "human-session-branch-integration-decision.v1", source_kind: "human", authority_id: "fixture_operator",
              source_event_id: "standard:" + ref, subject_sha256: shadowHash(result.question.review), question_sha256: shadowHash(result.question), choice: "integrate-to-session",
              rationale: "Explicit fixture consent for the exact retained-cycle to canonical-session Git transaction",
              evidence_refs: [{ ref: "fixture:operator-session-integration", sha256: "a".repeat(64) }] };
          } else if (binding === "session_closure_decision") {
            assert.ok(runsPromotion); assert.ok(result.question.choices.includes("close"));
            const beforeWait = f.open().inspect().record.instance_sha256, nativeCount = f.t.sessions.length;
            assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: "missing-session-close", write: true })).status, "waiting_for_human");
            assert.equal(f.open().inspect().record.instance_sha256, beforeWait); assert.equal(f.t.sessions.length, nativeCount);
            ref = "session_closure_" + result.operation_id;
            claim = { contract_version: "human-session-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator",
              source_event_id: "standard:" + ref, subject_sha256: shadowHash(result.question.review), question_sha256: shadowHash(result.question), choice: "close",
              rationale: "Explicit fixture request after authenticated R05 and canonical admission", session_report: { summary: "Verified cycle retained",
                open_loops: [], blockers: [], next_entry_point: "Finish the governed session close chain" }, evidence_refs: [{ ref: "fixture:operator-session-close", sha256: "a".repeat(64) }] };
          } else if (binding === "baseline_promotion_decision") {
            assert.ok(runsPromotion); assert.ok(result.question.choices.includes("promote"));
            const beforeWait = f.open().inspect().record.instance_sha256, nativeCount = f.t.sessions.length;
            assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: "missing", write: true })).status, "waiting_for_human");
            assert.equal(f.open().inspect().record.instance_sha256, beforeWait); assert.equal(f.t.sessions.length, nativeCount);
            ref = "promotion_" + result.operation_id;
            claim = { contract_version: "human-baseline-promotion-decision.v1", source_kind: "human", authority_id: "fixture_operator",
              source_event_id: "standard:" + ref, subject_sha256: shadowHash(result.question.review), question_sha256: shadowHash(result.question), choice: "promote",
              rationale: "Explicit fixture choice after confirmed retained closure", promotion: { version: frame.node_id.startsWith('correction_') ? 'v0.4' : "v0.3", summary: "Retain the verified fixture outcome" },
              evidence_refs: [{ ref: "fixture:operator-promotion", sha256: "a".repeat(64) }] };
          } else {
            assert.equal(binding, "cycle_closure_decision"); assert.ok(runsClosure);
            const beforeWait = f.open().inspect().record.instance_sha256, nativeCount = f.t.sessions.length;
            assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: "missing", write: true })).status, "waiting_for_human");
            assert.equal(f.open().inspect().record.instance_sha256, beforeWait); assert.equal(f.t.sessions.length, nativeCount);
            const choice = resumed ? "retain" : "deferred";
            assert.ok(result.question.choices.includes(choice)); ref = "closure_" + result.operation_id;
            claim = { contract_version: "human-cycle-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator",
              source_event_id: "standard:" + ref, subject_sha256: shadowHash(result.question.review), question_sha256: shadowHash(result.question), choice,
              rationale: choice === "deferred" ? "Explicit fixture deferral before a cold process resumes" : "Explicit fixture choice after reviewing the current audit",
              risk_acceptances: [], evidence_refs: [{ ref: "fixture:operator-closure", sha256: "a".repeat(64) }] };
          }
          publish(ref, claim);
          await f.open().receiveDecision(result.operation_id, { sourceRef: ref, write: true });
          await f.open().acceptOperation(result.operation_id, { write: true });
        }
        const record = f.open().readOperation(result.operation_id), output = record.results.at(-1)?.output;
        console.log(JSON.stringify({ composed_step: record.intent.binding_ref, outcome: output?.outcome, reason: output?.observations?.reason_code,
          facts: output?.facts, coverage: output?.observations?.coverage }));
        if (output?.outcome === "deferred" && runsClosure && !resumed) {
          assert.equal(record.intent.binding_ref, "cycle_closure_decision"); assert.equal(output.effect_status, "no_effect"); assert.deepEqual(output.facts, {});
          const waiting = f.open().inspect(); assert.equal(waiting.cursor.status, "WAITING");
          const retained = waiting.record.events.filter(event => event.kind === "operation_intent").map(event => ({ id: event.intent.operation_id, sha256: shadowHash(f.open().readOperation(event.intent.operation_id)) }));
          const beforeNative = f.t.sessions.length;
          fs.writeFileSync(path.join(f.configuration.control_root, "standard-prefix-preservation.json"), JSON.stringify({
            contract_version: "fixture-standard-prefix-preservation.v1", model_sha256: waiting.record.model_sha256,
            event_prefix_count: waiting.record.events.length, event_prefix_sha256: shadowHash(waiting.record.events),
            operation_journals: retained, native_results_prior: beforeNative }));
          console.log(JSON.stringify({ composed_human_deferred: true, cursor: waiting.cursor.status, native_sessions: beforeNative, cold_resume_starting: true }));
          const childStartedAt = Date.now(), childTimeoutMs = Math.max(1, auth.global_deadline_ms - childStartedAt + 60000);
          const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--standard-composed-mode=" + mode, "--standard-composed-stop=" + standardComposedStop,
            "--standard-composed-resume=" + resumeFile, "--standard-composed-budget-ms=" + standardComposedBudgetMs,
            "--standard-composed-scenario=" + standardScenarioName,
            "--standard-composed-max-responses=" + standardScenario.max_responses, "--retain-on-failure",
            ...(standardHostTrace ? ['--standard-composed-host-trace'] : []), ...(standardCheckpointAckLoss ? ['--standard-composed-checkpoint-ack-loss'] : []),
            ...(retainAlways ? ['--retain-always'] : []),
            ...(standardCheckpointOwnerAckLoss ? ['--standard-composed-checkpoint-owner-ack-loss'] : [])],
          { encoding: "utf8", shell: false, windowsHide: true, timeout: childTimeoutMs, maxBuffer: 262144 });
          retainComposedChild(f.configuration.control_root, 'composed-cold-child', child);
          // Keep the subprocess failure distinct from the parent assertion.
          // These observations neither renew authority nor prove tree closure.
          console.error(JSON.stringify({ composed_cold_child: true, pid: child.pid ?? null, status: child.status, signal: child.signal,
            error_code: child.error?.code ?? null, timeout_ms: childTimeoutMs, elapsed_ms: Date.now() - childStartedAt,
            stdout_bytes: Buffer.byteLength(child.stdout ?? ''), stderr_bytes: Buffer.byteLength(child.stderr ?? '') }));
          assert.equal(child.status, 0, ((child.stdout ?? "") + (child.stderr ?? "")).slice(-16384)); process.stdout.write(child.stdout);
          const reports = child.stdout.split(/\r?\n/).filter(line => line.startsWith("{")).map(line => JSON.parse(line));
          const proof = reports.find(row => row.standard_composed_proof === true);
          assert.ok(proof); assert.equal(proof.native_prior_results, beforeNative); assert.equal(proof.cold_resume, true);
          childNativeSessions = proof.native_sessions_started;
          assert.equal(childNativeSessions + beforeNative, standardPreflight.responses_required); coldContinuation = true;
          f.reopen();
          for (const item of retained) assert.equal(shadowHash(f.open().readOperation(item.id)), item.sha256);
          const afterChild = f.open().inspect(); assert.deepEqual(afterChild.record.events.slice(0, waiting.record.events.length), waiting.record.events);
          assert.equal(f.t.sessions.length, beforeNative); break;
        }
        assert.equal(output?.outcome, "completed");
      } else {
        console.log(JSON.stringify({ composed_native: frame.node_id, status: result.status, journal_phase: result.journal_phase }));
        assert.equal(result.kind, "native"); assert.equal(result.journal_phase, "closed");
        f.reopen(); // Persisted native results determine the next occurrence.
      }
    }
    const final = f.open().inspect();
    if (runsPromotion && !stopsBeforeCorrectionChoice) assert.equal(final.cursor.status, "COMPLETED");
    else assert.equal(final.cursor.occurrences.find(row => row.status === "READY")?.node_id, standardComposedStop);
    assert.equal(final.record.model_sha256, loadStandardWorkflowAssets().source.model_sha256);
    const acceptedOperations = final.record.events.filter(event => event.kind === "operation_intent").map(event => f.open().readOperation(event.intent.operation_id));
    const correctionStart = acceptedOperations.findIndex(row => row.intent.binding_ref === 'session_pr_correction_decision');
    const firstCycleOperations = fullCorrection && correctionStart >= 0 ? acceptedOperations.slice(0, correctionStart) : acceptedOperations;
    const last = binding => firstCycleOperations.filter(row => row.intent.binding_ref === binding).at(-1)?.results.at(-1)?.output;
    assert.equal(last("drift_check_finalize").facts.drift_check_completed, true);
    if (standardComposedStop !== "cycle_admit") assert.equal(last("cycle_checkpoint_finalize").outcome, "completed");
    const expectedNative = standardPreflight.responses_required;
    assert.equal(f.t.sessions.length + childNativeSessions, expectedNative - priorNativeResults); assert.ok(f.t.sessions.every(row => row.closed));
    if (runsCycle) {
      for (const binding of ["cycle_plan_record", "cycle_implementation_enter", "cycle_validation_execute", "cycle_task_advance", "cycle_verification_enter", "cycle_audit_evaluate"])
        assert.equal(last(binding)?.outcome, "completed");
      assert.equal(final.cursor.status, runsPromotion && !stopsBeforeCorrectionChoice ? "COMPLETED" : "RUNNING");
      if (!runsClosure) assert.equal(acceptedOperations.filter(row => row.intent.binding_ref === "cycle_closure_decision").length, 0);
    }
    if (runsClosure) {
      assert.equal(last("cycle_closure_decision").facts.cycle_retention_requested, true);
      assert.equal(last("cycle_terminal_checkpoint").facts.cycle_terminal_checkpoint_completed, true);
      assert.equal(last("cycle_terminal_checkpoint").facts.cycle_close_completed, false);
      assert.equal(last("cycle_close_finalize").facts.cycle_close_completed, true); assert.equal(last("cycle_close_finalize").facts.cycle_retained, true);
      if (!runsPromotion) assert.equal(acceptedOperations.filter(row => row.intent.binding_ref === "baseline_promotion_decision").length, 0);
      assert.ok(acceptedOperations.some(row => row.intent.binding_ref === "cycle_closure_decision" && row.results.at(-1).output.outcome === "deferred"));
      if (!resumed) assert.equal(coldContinuation, true);
    }
    if (runsPromotion) {
      assert.equal(last("baseline_promotion_record").facts.baseline_recorded, true);
      assert.equal(last("baseline_promotion_checkpoint").facts.baseline_checkpoint_completed, true);
      assert.equal(last("baseline_promotion_checkpoint").facts.baseline_promotion_completed, false);
      assert.equal(last("baseline_promotion_finalize").facts.baseline_promotion_completed, true);
      assert.equal(last("session_preclose_checkpoint").facts.session_preclose_checkpoint_completed, true);
      assert.equal(last("session_preclose_checkpoint").facts.session_close_completed, false);
      assert.equal(last("session_closure_decision").facts.session_closure_requested, true);
      assert.equal(last("session_closure_decision").facts.session_close_completed, false);
      assert.equal(last("session_close_record").facts.session_close_report_recorded, true);
      assert.equal(last("session_close_record").facts.session_close_completed, false);
      assert.equal(last("session_close_checkpoint").facts.session_close_checkpoint_completed, true);
      assert.equal(last("session_close_finalize").facts.session_close_completed, true);
      assert.equal(last("session_delivery_checkpoint").facts.session_delivery_checkpoint_completed, true);
      assert.equal(last("session_branch_integration_decision").effect_status, "no_effect");
      assert.equal(last("session_branch_integration_decision").facts.session_branch_integration_requested, true);
      assert.equal(last("session_branch_integrate").facts.session_branch_integrated, true);
      assert.equal(last("session_branch_integrate").effect_status, "confirmed");
      assert.equal(last("session_pr_admit").facts.session_pr_admitted, true);
      assert.equal(last("session_pr_admit").effect_status, "no_effect");
      assert.equal(last("session_pr_admit").observations.reload.cache_written, false);
      assert.equal(last("session_push").outcome, "completed"); assert.equal(last("session_push").effect_status, "confirmed");
      assert.equal(last("session_push").facts.session_remote_head_confirmed, true);
      const pushedHead = fullCorrection ? last('session_pr_update_push').observations.git.remote_head : execFileSync("git", ["--git-dir=" + f.sessionPushRemoteRoot, "rev-parse", "refs/heads/S001-standard"],
        { encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 10000 }).trim();
      assert.equal(pushedHead, last("session_pr_update_push").observations.git.remote_head);
      assert.equal(last("session_push").observations.git.remote_head, last("session_pr_admit").observations.head);
      assert.equal(last("session_pr_open").outcome, "completed"); assert.equal(last("session_pr_open").effect_status, "confirmed");
      assert.deepEqual(last("session_pr_open").facts, { session_pr_open_confirmed: true });
      const provider = createGithubPrOpenTransportFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: f.configuration.control_root });
      assert.equal(provider.read().posts, 1); assert.equal(provider.read().pulls[0].head.sha, last("session_push").observations.git.remote_head);
      assert.equal(last("session_pr_open").observations.pull_request.node_id, provider.read().pulls[0].node_id);
      assert.equal(last("session_pr_record").outcome, "completed"); assert.equal(last("session_pr_record").effect_status, "confirmed");
      assert.deepEqual(last("session_pr_record").facts, { session_pr_lifecycle_recorded: true, session_pr_checkpoint_required: true });
      const lifecycle = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
      assert.match(lifecycle.read("sessions/S001.md", { required: true }).content, /pr_status: open/);
      assert.equal(last("session_pr_record").observations.checkpoint, "pending");
      assert.equal(last("session_pr_record").observations.push, "pending");
      assert.equal(last("session_pr_checkpoint").outcome, "completed");
      assert.equal(last("session_pr_checkpoint").facts.session_pr_checkpoint_completed, true);
      assert.equal(last("session_pr_update_push").outcome, "completed");
      assert.equal(last("session_pr_update_push").observations.pull_request.head_oid, pushedHead);
      assert.equal(last("session_pr_update_push").observations.inherited_review_evidence, "none");
      assert.equal(last("session_pr_update_push").observations.review, "pending");
      const review = last("session_pr_review_content_observe");
      assert.equal(review.outcome, "completed"); assert.equal(review.effect_status, "no_effect");
      assert.deepEqual(review.facts, { session_pr_review_evidence_available: true, session_pr_triage_required: true });
      assert.equal(review.observations.head_oid, pushedHead);
      assert.equal(review.observations.merge_authorization, "not-established");
      assert.equal(review.observations.evidence.pull_request.head_oid, pushedHead);
      const received = last("session_pr_review_receive");
      assert.equal(received.outcome, "completed"); assert.equal(received.effect_status, "no_effect");
      assert.deepEqual(received.facts, { session_pr_review_event_received: true, session_pr_triage_required: true });
      assert.equal(received.observations.payload.observation.observations.head_oid, pushedHead);
      const classified = last("session_pr_triage_evaluate");
      assert.equal(classified.outcome, "completed"); assert.equal(classified.effect_status, "no_effect");
      const correction = fullCorrection || standardScenarioName === "correction";
      assert.deepEqual(classified.facts, { session_pr_findings_classified: true, session_pr_corrections_required: correction, session_pr_responses_required: correction });
      assert.equal(classified.observations.triage_completion, "pending-effects-and-verification");
      assert.equal(classified.observations.merge_authorization, "not-established");
      if (correction && !fullCorrection) {
        const reopened = last("session_pr_correction_reopen");
        assert.equal(reopened.outcome, "completed", JSON.stringify(reopened)); assert.equal(reopened.effect_status, "confirmed");
        assert.deepEqual(reopened.facts, { session_pr_correction_context_open: true, session_pr_correction_cycle_required: true });
        const session = lifecycle.read("sessions/S001.md", { required: true }).content;
        assert.match(session, /^state: OPEN$/m); assert.match(session, /^session_closure_status: correction_pending$/m);
        assert.match(session, /^## Historical Process session closure before op_/m);
        assert.match(session, /^## Historical Process session closure completion before op_/m);
        assert.match(lifecycle.read("CURRENT-STATE.md", { required: true }).content, /^active_cycle: none$/m);
        for (const row of reopened.observations.postimages) {
          assert.equal(lifecycle.read(row.path, { required: true }).sha256, row.sha256);
          assert.equal(lifecycle.metadataHash(row.path), row.metadata_sha256);
        }
        assert.equal(reopened.observations.implementation_admission, "not-established");
        assert.equal(reopened.observations.merge_authorization, "not-established");
        const checkpointed = last("session_pr_correction_checkpoint"), oldHead = last("session_pr_update_push").observations.pull_request.head_oid;
        assert.equal(checkpointed.outcome, "completed", JSON.stringify(checkpointed));
        assert.equal(checkpointed.facts.session_pr_correction_checkpoint_completed, true);
        assert.equal(checkpointed.observations.remote_head, oldHead);
        assert.equal(checkpointed.observations.product_admission, "not-established");
        assert.equal(checkpointed.observations.cycle, "not-created");
        const localHead = execFileSync("git", ["-C", f.configuration.target_root, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim();
        if (mode === "db-only") {
          assert.equal(checkpointed.effect_status, "no_effect"); assert.equal(localHead, oldHead);
        } else {
          assert.equal(checkpointed.effect_status, "confirmed");
          assert.equal(checkpointed.observations.git.parent_sha, oldHead); assert.equal(checkpointed.observations.git.commit_sha, localHead);
        }
        const denied = await preWriteAdmit({ targetRoot: f.configuration.target_root, skill: "start-session", nativeRequest: {
          tool_name: "apply_patch", cwd: f.configuration.target_root, tool_input: { command: "*** Begin Patch\n*** Update File: product/app.mjs\n@@\n-export const value = 2;\n+export const value = 3;\n*** End Patch" } } });
        assert.equal(denied.write_decision.outcome, "deny");
        console.log(JSON.stringify({ standard_correction_host_proof: true, canonical_writes: "confirmed", received_and_triage_producers: "authenticated-host-and-native-fixture",
          correction_checkpoint: "confirmed-or-db-only-no-effect", product_write_admission: "denied-no-new-cycle", provider_transport: "fixture", native_transport: "fixture", full_standard: false }));
      }
      assert.equal(final.record.events.filter(row => row.kind === "control").length, fullCorrection ? 2 : 1);
      assert.equal(loadStandardWorkflowAssets().catalog.scope.complete_standard_workflow, false);
    }
    if (fullCorrection && !stopsBeforeCorrectionChoice) {
      const rows = acceptedOperations.slice(correctionStart), get = binding => rows.filter(row => row.intent.binding_ref === binding).at(-1);
      const selected = get('session_pr_correction_decision'), initialized = get('session_pr_correction_cycle_initialize');
      const candidate = selected.results.at(-1).output.observations.candidate_cycle;
      assert.deepEqual(Object.fromEntries(['cycle_id', 'title', 'objective'].map(key => [key, initialized.preview.input[key]])), candidate);
      assert.notEqual(candidate.cycle_id, parameters.cycle.cycle_id);
      assert.equal(Object.hasOwn(selected.preview.input, 'candidate_cycle'), false);
      assert.equal(selected.preview.input.contract_version, 'standard-pr-correction-review-input.v3');
      assert.equal(initialized.results.at(-1).output.facts.cycle_dor_ready, false);
      const required = ['session_pr_correction_cycle_initialize', 'branch_cycle_audit', 'cycle_checkpoint_finalize', 'session_start_finalize',
        'cycle_plan_evaluate', 'cycle_plan_record', 'cycle_readiness_evaluate', 'cycle_implementation_enter', 'cycle_task_work_evaluate',
        'cycle_validation_execute', 'cycle_task_advance', 'cycle_verification_enter', 'cycle_audit_evaluate', 'cycle_closure_decision',
        'cycle_terminal_checkpoint', 'cycle_close_finalize', 'baseline_promotion_finalize', 'session_close_admit', 'session_closure_decision',
        'session_close_record', 'session_close_finalize', 'session_branch_integrate', 'session_pr_redelivery_push', 'session_pr_review_receive', 'session_pr_triage_evaluate'];
      let prior = -1;
      for (const binding of required) {
        const record = get(binding); assert.ok(record, binding);
        assert.equal(record.results.at(-1).output.outcome, 'completed', binding);
        const at = rows.indexOf(record); assert.ok(at > prior, binding); prior = at;
      }
      const evaluated = get('cycle_plan_evaluate').results.at(-1).output.observations.proposal;
      assert.equal(evaluated.cycle_id, candidate.cycle_id); assert.equal(evaluated.objective, candidate.objective);
      assert.equal(evaluated.cycle_type, 'corrective'); assert.deepEqual(evaluated.tasks[0].test_refs, ['TEST-002']);
      assert.equal(get('cycle_readiness_evaluate').results.at(-1).output.facts.cycle_readiness_satisfied, true);
      assert.equal(get('cycle_validation_execute').results.at(-1).output.observations.checks[0].test_ref, 'TEST-002');
      assert.equal(get('cycle_close_finalize').results.at(-1).output.facts.cycle_retained, true);
      assert.equal(get('session_close_finalize').results.at(-1).output.facts.session_close_completed, true);
      const delivered = get('session_pr_redelivery_push').results.at(-1).output;
      assert.equal(delivered.facts.session_pr_head_confirmed, true);
      assert.notEqual(delivered.observations.pull_request.head_oid, last('session_pr_update_push').observations.pull_request.head_oid);
      const remote = execFileSync('git', ['--git-dir=' + f.sessionPushRemoteRoot, 'rev-parse', 'refs/heads/S001-standard'], { encoding: 'utf8', windowsHide: true }).trim();
      assert.equal(remote, delivered.observations.pull_request.head_oid);
      const triage = get('session_pr_triage_evaluate').results.at(-1).output;
      assert.equal(triage.facts.session_pr_corrections_required, false);
      assert.equal(triage.observations.merge_authorization, 'not-established');
      assert.equal(fs.readFileSync(path.join(f.configuration.product_root, 'app.mjs'), 'utf8'), 'export const value = 3;\n');
      const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
      const session = artifacts.read('sessions/S001.md', { required: true }).content;
      assert.match(session, /^## Historical Process session closure before op_/m);
      assert.match(session, /^## Historical Process session closure completion before op_/m);
      console.log(JSON.stringify({ standard_corrective_cycle_journey: true, selected_cycle: candidate, new_head: remote,
        causal_operations: required, provider_review_deliveries: 2, final_product_value: 3, same_published_model: true,
        human_native_provider: 'fixture', provider_replies_and_merge: 'NOT_RUN', full_standard_workflow: false }));
    }
    const replayWitness = () => {
      const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
      return shadowHash({ product: sha(fs.readFileSync(path.join(f.configuration.product_root, 'app.mjs'))),
        artifacts: ['CURRENT-STATE.md', 'snapshots/context-snapshot.md', 'sessions/S001.md', ...artifacts.cycles().map(row => row.path)]
          .map(name => ({ path: name, sha256: artifacts.read(name, { required: true }).sha256, metadata_sha256: artifacts.metadataHash(name) })),
        allocations: f.open().inspectAllocations(), validation_calls: fs.readFileSync(path.join(f.base, 'validation-control/calls.jsonl'), 'utf8'),
        provider: fs.readFileSync(path.join(f.configuration.control_root, 'pr-open-provider-fixture.json'), 'utf8') });
    };
    const replayBefore = fullCorrection && runsPromotion ? replayWitness() : null;
    let replayLast, replaySteps = 0;
    for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, model: final.record.model, policyPins: final.record.policy_pins,
      scopeId: final.record.scope_id, parameters: final.record.initial_parameters, facts: final.record.initial_facts, events: final.record.events })) {
      replayLast = row; replaySteps++;
    }
    assert.equal(replaySteps, final.record.events.length + 1);
    assert.equal(replayLast.instance_sha256, final.record.instance_sha256);
    if (replayBefore) assert.equal(replayWitness(), replayBefore);
    console.log(JSON.stringify({ standard_composed_proof: true, model_sha256: final.record.model_sha256, instance_sha256: final.record.instance_sha256,
      events: final.record.events.length, application_operations: acceptedOperations.length, native_sessions_started: f.t.sessions.length,
      scenario_sha256: standardPreflight.scenario_sha256, planned_responses: standardPreflight.responses_required,
      original_max_responses: auth.max_responses, original_deadline_ms: auth.global_deadline_ms,
      native_sessions_started_in_child: childNativeSessions, native_prior_results: priorNativeResults, cold_resume: Boolean(resumed),
      cold_continuation: coldContinuation, prior_operation_journals_preserved: coldContinuation, simulation_trace_mode: "streamed-bounded-rows", simulation_steps: replaySteps, terminal_ready_node: runsPromotion ? null : standardComposedStop, component_completed: runsPromotion, full_standard_workflow: false, workflow_status: final.cursor.status, model_calls: 0,
      verification_boundary: runsCycle ? "fixture-with-actual-Node-check" : "not-used", human_and_effect_authority: "fixture", session_push_transport: runsPromotion ? "actual-local-bare-git" : "not-used", pr_transport: runsPromotion ? "doubled-REST-reading-actual-bare-refs" : "not-used", replay_exact: true }));
  });
  await check("cycle closure contract: typed review and authenticated inbox preserve pending lifecycle", () => {
    const cases = [["verify-standard-cycle-closure-decision-fixtures.mjs"], ["verify-standard-cycle-closure-review-fixtures.mjs"],
      ...["files", "dual", "db-only"].map(mode => ["verify-standard-cycle-closure-inbox-fixtures.mjs", "--mode=" + mode])];
    for (const [name, ...args] of cases) {
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("./" + name, import.meta.url)), ...args], { encoding: "utf8", windowsHide: true, shell: false, timeout: 60000 });
      assert.equal(child.status, 0, (child.stdout + child.stderr).slice(-8192)); process.stdout.write(child.stdout);
    }
  });
  await check("cycle closure contract: authored IR binds the human port without a native resource", () => {
    const f = mixedFixture("files", { planning: true, readiness: true, work: true, validation: true, taskProgress: true, audit: true, closure: true, taskFinalValue: 3 });
    const before = fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"));
    const host = f.open(), preview = host.initialize({ parameters: { session: { session_id: "S001", session_branch: "S001-human", objective: "Model-bound human closure fixture" } } });
    const node = preview.record.model.nodes.find(row => row.id === "closure_decide");
    assert.equal(node.kind, "operation"); assert.equal(node.binding_ref, "cycle_closure_decision"); assert.equal(node.role_ref, undefined);
    assert.equal(f.t.sessions.length, 0); assert.equal(f.launches ?? 0, 0); assert.deepEqual(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs")), before);
  });
  await check("cycle audit contract: typed checklist and canonical inventory remain read-only components", () => {
    for (const name of ["verify-standard-cycle-audit-fixtures.mjs", "verify-standard-workflow-inventory-fixtures.mjs", "verify-standard-cycle-audit-context-fixtures.mjs"]) {
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("./" + name, import.meta.url))], { encoding: "utf8", windowsHide: true, shell: false, timeout: 60000 });
      assert.equal(child.status, 0, (child.stdout + child.stderr).slice(-8192)); process.stdout.write(child.stdout);
    }
  });
  await check("cycle tasks contract: ordered progress and typed work preserve historical parsing", () => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("./verify-standard-cycle-task-progress-fixtures.mjs", import.meta.url))], { encoding: "utf8", windowsHide: true, shell: false, timeout: 30000 });
    assert.equal(child.status, 0, (child.stdout + child.stderr).slice(-8192)); process.stdout.write(child.stdout);
  });
  await check("cycle validation contract: controlled checks, refusals and unknown effects", async () => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("./verify-standard-cycle-validation-fixtures.mjs", import.meta.url))], { encoding: "utf8", windowsHide: true, shell: false, timeout: 180000 });
    assert.equal(child.status, 0, (child.stdout + child.stderr).slice(-8192));
    process.stdout.write(child.stdout);
  });
  await verifyCycleVerificationContracts(check, cyclePlanProposal({ context_sha256: "a".repeat(64), context: { session_id: "S001", cycle_id: "C001", cycle_type: "feature", mode: "COMMITTING", original_objective: "Update the product", allowed_product_files: ["product/app.mjs"] }, evidence_refs: [{ ref: "audit:SPEC.md", sha256: "b".repeat(64) }] }));
  await verifyCyclePlanningContracts(check);
  await verifyCycleWorkContracts(check, { mixedFixture });
  await verifyCycleReadinessContracts(check);
  await check("cycle plan contract refuses a writable native planning profile before any session", async () => {
    const f = mixedFixture("files", { planning: true }), model = structuredClone(f.model);
    const node = model.nodes.find(row => row.id === "analyze"); model.policies.find(row => row.id === node.policy_ref).allowed_permissions.push("write:product");
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    assert.throws(() => f.open(), { code: "PROCESS_ACTIVITY_OUTPUT_BINDING_INVALID" }); assert.equal(f.t.sessions.length, 0);
  });
  await check("cycle close record contract: typed terminal facts and pure artifact rendering", () => {
    for (const name of ["verify-standard-cycle-close-contract-fixtures.mjs", "verify-standard-cycle-close-render-fixtures.mjs"]) {
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("./" + name, import.meta.url))], { encoding: "utf8", windowsHide: true, shell: false, timeout: 30000 });
      assert.equal(child.status, 0, (child.stdout + child.stderr).slice(-8192)); process.stdout.write(child.stdout);
    }
    const f = mixedFixture("files", { planning: true, readiness: true, work: true, validation: true, taskProgress: true, audit: true, closure: true, closeRecord: true, taskFinalValue: 3 });
    const preview = f.open().initialize({ parameters: { session: { session_id: "S001", session_branch: "S001-mixed", objective: "Execute real mixed bootstrap" } } }); assert.equal(preview.record.model.operation_pins.cycle_close_record, shadowHash(standardWorkflowOperationBindings().find(row => row.id === "cycle_close_record")));
    assert.equal(f.t.sessions.length, 0); assert.equal(f.launches ?? 0, 0);
  });
  await check("cycle close finalize contract: model resolves the terminal journal identity with fixed implementation pins", () => {
    const f = mixedFixture("files", { planning: true, readiness: true, work: true, validation: true, taskProgress: true, audit: true, closure: true, closeRecord: true, closeFinalize: true, taskFinalValue: 3 });
    const result = f.open().initialize({ parameters: { session: { session_id: "S001", session_branch: "S001-mixed", objective: "Execute real mixed bootstrap" } } });
    assert.equal(result.record.model.operation_pins.cycle_close_finalize, shadowHash(standardWorkflowOperationBindings().find(row => row.id === "cycle_close_finalize")));
    assert.deepEqual(result.record.model.data_bindings.inputs.find(row => row.node_id === "close_finalize").fields, { closure_operation_id: { source: "operation_id", node_id: "close_record" } });
    assert.equal(f.t.sessions.length, 0); assert.equal(f.launches ?? 0, 0);
  });
  if (selectedCycleCloseFinalizeMode) await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true, work: true, validation: true, taskProgress: true, audit: true, closure: true, closeRecord: true, closeFinalize: true });
  await verifyNativeAuthorizationEpochs(check, { readyResumeFixture, mixedFixture, bootstrapMixed });
  await verifyInitialNativeAuthorizationEpochs(check, { journalFixture, mixedFixture, bootstrapMixed });
  await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url) });
  await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true });
  await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true, work: true });
  await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true, work: true, validation: true });
  await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true, work: true, validation: true, verification: true });
  await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true, work: true, validation: true, taskProgress: true });
  await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true, work: true, validation: true, taskProgress: true, audit: true });
  if (selectedCycleClosureMode) await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true, work: true, validation: true, taskProgress: true, audit: true, closure: true });
  await verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script: fileURLToPath(import.meta.url), readiness: true, work: true, validation: true, taskProgress: true, audit: true, closure: true, closeRecord: true });
  for (const mode of ["files", "dual", "db-only"]) await check(`dataflow ${mode}: the IR resolves durable parameters and accepted result identities through real ports`, async () => {
    const f = finalizationFixture(mode, { dataBindings: true, inputSource: mode === "dual" ? "operation_input" : "operation_output" });
    const parameters = { session: { session_id: "S001", session_branch: "S001-mixed", objective: "Execute real mixed bootstrap" } };
    const initial = f.open().initialize({ parameters }); f.open().initialize({ parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const authorization = f.authorize(); authorization.global_deadline_ms += 1800000; authorization.workflow_deadline_ms += 1800000;
    const before = f.open().inspect(), results = [];
    await assert.rejects(f.open().step({ input: { forged: true } }), /PROCESS_INPUT_OVERRIDE_FORBIDDEN/);
    assert.equal(f.open().inspect().record.instance_sha256, before.record.instance_sha256);
    // No node order, input ID or routing choice in the driver: each fresh host
    // advances its model cursor until an authenticated human wait is reached.
    for (let step = 0; step < 32; step++) {
      const prior = f.open().inspect(), result = await f.open().step({ write: true, authorization }); results.push(result);
      if (result.kind === "native") assert.equal(result.journal_phase, "closed");
      assert.notEqual(f.open().inspect().record.instance_sha256, prior.record.instance_sha256, "model driver made no progress");
      if (result.status === "waiting_for_human") break;
    }
    const journals = results.filter(row => row.operation_id).map(row => f.open().readOperation(row.operation_id));
    const evaluation = journals.find(row => row.intent.binding_ref === "drift_report_evaluate");
    assert.equal(evaluation.preview.input_resolution.sources[0].source, "occurrence_id");
    const waiting = f.open().inspect();
    assert.equal(evaluation.preview.input.report_occurrence_id, waiting.record.events.find(row => row.kind === "result").occurrence_id);
    const journal = journals.find(row => row.intent.binding_ref === "drift_check_finalize");
    assert.equal(journal.preview.input.evaluation_operation_id, evaluation.operation_id);
    assert.equal(journal.preview.input_resolution.sources[0].operation_id, evaluation.operation_id);
    assert.equal(journal.results.at(-1).output.facts.drift_check_completed, true);
    assert.equal((await f.open().dispatchOperation(journal.operation_id, { write: true })).status, "retained_result"); assert.equal(f.t.sessions.length, 1);
    const human = results.at(-1); assert.equal(human.status, "waiting_for_human"); assert.equal(human.question.session_id, "S001");
    const captured = journals.find(row => row.intent.binding_ref === "mode_decision"); assert.equal(captured.preview.input.session_id, "S001");
    assert.equal(captured.preview.input_resolution.sources[0].source, mode === "dual" ? "operation_input" : "operation_output");
    assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
    assert.equal(waiting.cursor.status, "WAITING");
    assert.equal((await f.open().step()).kind, "human_wait");
    const simulation = simulateAgenticProcess({ instanceId: waiting.record.instance_id, scopeId: waiting.record.scope_id, model: waiting.record.model,
      policyPins: waiting.record.policy_pins, parameters: waiting.record.initial_parameters, events: waiting.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, waiting.record.instance_sha256);
  });
  for (const mode of ["files", "dual", "db-only"]) await check(`drift cycle ${mode}: authenticated recovery waits for Git reconciliation then initializes a real cycle with exact simulation`, async () => {
    const claims = new Map(), humanSource = { read: ({ sourceRef }) => claims.get(sourceRef) ?? null,
      verify: ({ source, sourceRef }) => claims.has(sourceRef) && shadowHash(claims.get(sourceRef)) === shadowHash(source)
        ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" } };
    const withCr = mode === "dual";
    const f = mixedFixture(mode, { drift: true, recovery: true, recoveryCycle: true, changeRequest: withCr, humanSource, answer({ params }) {
      const context = JSON.parse(params.input[0].text.split("\n").at(-1));
      return { outcome: "completed", summary: "Cycle recovery diagnostic fixture.", report: { contract_version: "standard-drift-report.v1", context_sha256: context.context_sha256,
        original_objective: context.context.original_objective, current_objective: "Implement the revised goal in a separately admitted cycle", drift_level: "severe", objective_changed: true,
        changes: ["Confirmed fixture goal change requiring a new cycle."], keep: ["Original traceability"], discard: [],
        split_recommendation: { new_cycle: true, new_branch: true, change_request_required: true, impact: "high" },
        recommendation: "human_arbitration", rationale: "Native wire fixture; actual admitted cycle and context ports.", evidence_refs: context.evidence_refs } };
    } });
    const auth = await bootstrapMixed(f), operations = createStandardWorkflowOperations({ targetRoot: f.configuration.target_root });
    const git = (...args) => { const value = spawnSync("git", ["-c", "core.hooksPath=NUL", ...args], { cwd: f.configuration.target_root, encoding: "utf8", shell: false }); assert.equal(value.status, 0, value.stderr.slice(-1024) || value.stdout.slice(-1024)); return value.stdout.trim(); };
    if (withCr) await prepareCompletionCycle(f, "OPEN");
    else { const modePlan = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
      assert.equal((await operations.applyMode(modePlan, { write: true, expectPlan: modePlan.plan_sha256 })).outcome, "completed");
      git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture committing session precondition"); }
    console.log(`STEP drift cycle ${mode}: real mode/cycle precondition prepared`);
    const native = await f.open().step({ write: true, authorization: auth }); assert.equal(native.journal_phase, "closed", JSON.stringify(native));
    await f.open().step({ write: true }); const waiting = await f.open().step({ write: true }); assert.equal(waiting.status, "waiting_for_human");
    claims.set("accept", { contract_version: "human-drift-recovery-decision.v1", source_kind: "human", authority_id: "fixture_operator",
      source_event_id: `cycle-${mode}`, subject_sha256: "a".repeat(64), question_sha256: shadowHash(waiting.question), choice: withCr ? "requirements_delta" : "new_cycle",
      evidence_refs: [{ ref: "fixture:operator/cycle", sha256: "a".repeat(64) }] });
    await f.open().receiveDecision(waiting.question.operation_id, { sourceRef: "accept", write: true }); await f.open().acceptOperation(waiting.question.operation_id, { write: true }); claims.clear();
    const recorded = await f.open().step({ write: true }); assert.equal(f.open().readOperation(recorded.operation_id).results.at(-1).output.effect_status, "confirmed");
    if (withCr) { const cr = await f.open().step({ write: true }); assert.equal(f.open().readOperation(cr.operation_id).results.at(-1).output.effect_status, "confirmed"); }
    const refreshed = await f.open().step({ write: true }), refreshOutput = f.open().readOperation(refreshed.operation_id).results.at(-1).output;
    assert.equal(refreshOutput.facts.drift_recovery_context_refreshed, true, JSON.stringify(refreshOutput));
    console.log(`STEP drift cycle ${mode}: authenticated recovery context refreshed`);
    let checked = await f.open().step({ write: true });
    if (mode !== "db-only") {
      const blocked = f.open().readOperation(checked.operation_id).results.at(-1).output;
      assert.equal(blocked.outcome, "blocked"); assert.equal(blocked.observations.reason_code, "STANDARD_RECOVERY_GIT_CHECKPOINT_REQUIRED"); assert.deepEqual(blocked.facts, {});
      assert.equal(f.open().inspect().cursor.status, "WAITING");
      // This is an external human Git action, not an application effect or a
      // claim that AIDN automatically approves/commits product changes.
      git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture external workflow checkpoint");
      const previous = checked.operation_id; checked = await f.open().step({ write: true }); assert.notEqual(checked.operation_id, previous);
    }
    const checkpointOutput = f.open().readOperation(checked.operation_id).results.at(-1).output;
    assert.equal(checkpointOutput.facts.drift_recovery_checkpoint_verified, true, JSON.stringify(checkpointOutput)); assert.equal(checkpointOutput.effect_status, "no_effect");
    assert.equal((await f.open().dispatchOperation(refreshed.operation_id, { write: true })).status, "retained_result");
    console.log(`STEP drift cycle ${mode}: external checkpoint observed; creation is ready`);
    let initialized;
    if (mode === "files") {
      const file = put(f.base, "cycle-restart.json", JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex") }));
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--recovery-record", file], { encoding: "utf8", shell: false, windowsHide: true, timeout: 300000 });
      assert.equal(child.status, 0, child.stderr); const value = JSON.parse(child.stdout); assert.equal(value.status, "WAITING"); assert.equal(value.launches, 0); assert.equal(value.sessions, 0); initialized = { operation_id: value.operation_id };
    } else initialized = await f.open().step({ write: true });
    const output = f.open().readOperation(initialized.operation_id).results.at(-1).output; assert.equal(output.effect_status, "confirmed", JSON.stringify(output));
    assert.equal(output.facts.drift_recovery_cycle_initialized, true); assert.equal(output.facts.cycle_dor_ready, false); assert.equal(output.facts.drift_check_completed, false);
    assert.equal(output.observations.causal_transition.before_context_sha256, checkpointOutput.observations.causal_transition.after_context_sha256);
    assert.equal(git("branch", "--show-current"), `spike/${f.cycleParameters.cycle_id}-admitted-recovery`);
    const after = f.open().inspect(); assert.equal(after.cursor.status, "WAITING");
    assert.equal((await f.open().dispatchOperation(initialized.operation_id, { write: true })).status, "retained_result");
    const simulated = simulateAgenticProcess({ instanceId: after.record.instance_id, model: after.record.model, parameters: after.record.initial_parameters,
      scopeId: after.record.scope_id, policyPins: after.record.policy_pins, events: after.record.events });
    assert.equal(simulated.trace.at(-1).instance_sha256, after.record.instance_sha256); assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
  });
  for (const mode of ["files", "dual", "db-only"]) await check(`drift CR ${mode}: IR consumes confirmed recovery and creates a pending CR through admitted canonical ports`, async () => {
    const claims = new Map(), humanSource = {
      read: ({ sourceRef }) => claims.get(sourceRef) ?? null,
      verify: ({ source, sourceRef }) => claims.has(sourceRef) && shadowHash(claims.get(sourceRef)) === shadowHash(source)
        ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" },
    };
    let permit = true;
    const f = mixedFixture(mode, { drift: true, recovery: true, changeRequest: true, humanSource,
      authorize: async ({ binding }) => ({ authorized: binding.id !== "drift_change_request_record" || permit, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) }),
      answer({ params }) {
        const context = JSON.parse(params.input[0].text.split("\n").at(-1));
        return { outcome: "completed", summary: "CR diagnostic fixture.", report: { contract_version: "standard-drift-report.v1", context_sha256: context.context_sha256,
          original_objective: context.context.original_objective, current_objective: context.context.original_objective + " with changed scope", drift_level: "severe", objective_changed: true,
          changes: ["Confirmed CR fixture scope expansion."], keep: ["Original scope"], discard: [],
          split_recommendation: { new_cycle: true, new_branch: true, change_request_required: true, impact: "high" },
          recommendation: "human_arbitration", rationale: "Fixture transport; real application writer.", evidence_refs: context.evidence_refs } };
      } });
    const auth = await bootstrapMixed(f), cycle = await prepareCompletionCycle(f, "OPEN");
    console.log(`STEP drift CR ${mode}: admitted active cycle prepared`);
    const native = await f.open().step({ write: true, authorization: auth }); assert.equal(native.journal_phase, "closed", JSON.stringify(native));
    console.log(`STEP drift CR ${mode}: native producer closed`);
    await f.open().step({ write: true }); const waiting = await f.open().step({ write: true }); assert.equal(waiting.status, "waiting_for_human");
    assert.ok(waiting.question.choices.includes("requirements_delta"));
    claims.set("accept", { contract_version: "human-drift-recovery-decision.v1", source_kind: "human", authority_id: "fixture_operator",
      source_event_id: `cr-${mode}`, subject_sha256: "a".repeat(64), question_sha256: shadowHash(waiting.question), choice: "requirements_delta",
      evidence_refs: [{ ref: "fixture:operator/cr", sha256: "a".repeat(64) }] });
    await f.open().receiveDecision(waiting.question.operation_id, { sourceRef: "accept", write: true });
    await f.open().acceptOperation(waiting.question.operation_id, { write: true }); claims.clear();
    const recorded = await f.open().step({ write: true }), findings = f.open().readOperation(recorded.operation_id).results.at(-1).output;
    assert.equal(findings.effect_status, "confirmed");
    const crPath = cycle.statusPath.replace("status.md", "change-requests.md"), before = cycle.artifacts.read(crPath);
    const preview = await f.open().step({ write: false }); assert.equal(preview.kind, "operation_preview");
    assert.equal(cycle.artifacts.read(crPath).sha256, before.sha256);
    permit = false; await assert.rejects(f.open().step({ write: true }), /STANDARD_HOST_AUTHORIZATION_REQUIRED/);
    assert.equal(cycle.artifacts.read(crPath).sha256, before.sha256); assert.equal(cycle.artifacts.ownerPending(), false); permit = true;
    console.log(`STEP drift CR ${mode}: accepted findings retained; exact CR preview is ready`);
    let completed;
    if (mode === "files") {
      const file = put(f.base, "cr-restart.json", JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex") }));
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--recovery-record", file], { encoding: "utf8", shell: false, windowsHide: true, timeout: 300000 });
      assert.equal(child.status, 0, child.stderr); const reopened = JSON.parse(child.stdout);
      assert.equal(reopened.status, "WAITING"); assert.equal(reopened.launches, 0); assert.equal(reopened.sessions, 0);
      assert.equal(f.open().inspect().record.instance_sha256, reopened.instance_sha256); completed = { operation_id: reopened.operation_id };
    } else completed = await f.open().step({ write: true });
    const output = f.open().readOperation(completed.operation_id).results.at(-1).output;
    assert.equal(output.outcome, "completed", JSON.stringify(output)); assert.equal(output.effect_status, "confirmed");
    assert.equal(output.facts.drift_change_request_recorded, true); assert.equal(output.facts.drift_check_completed, false);
    assert.equal(output.observations.decision, "pending"); assert.equal(output.observations.new_cycle_required, true);
    assert.equal(output.observations.causal_transition.before_context_sha256, findings.observations.causal_transition.after_context_sha256);
    const after = cycle.artifacts.read(crPath); assert.ok(after.content.startsWith(before.content));
    assert.match(after.content, /## CR-002/); assert.match(after.content, /- Decision: pending/); assert.match(after.content, /Confirmed CR fixture scope expansion/);
    assert.equal(cycle.artifacts.ownerPending(), false); const reopened = f.open().inspect(); assert.equal(reopened.cursor.status, "WAITING");
    assert.equal((await f.open().dispatchOperation(completed.operation_id, { write: true })).status, "retained_result"); assert.equal(cycle.artifacts.read(crPath).sha256, after.sha256);
    const simulated = simulateAgenticProcess({ instanceId: reopened.record.instance_id, model: reopened.record.model, parameters: reopened.record.initial_parameters,
      scopeId: reopened.record.scope_id, policyPins: reopened.record.policy_pins, events: reopened.record.events });
    assert.equal(simulated.trace.at(-1).instance_sha256, reopened.record.instance_sha256); assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
  });
  for (const mode of ["files", "dual", "db-only"]) await check(`drift recovery ${mode}: authenticated human review records actual findings without completing recovery`, async () => {
    const claims = new Map(), humanSource = {
      read: ({ sourceRef }) => claims.get(sourceRef) ?? null,
      verify: ({ source, sourceRef, question }) => sourceRef !== "forged" && shadowHash(claims.get(sourceRef)) === shadowHash(source) && source.question_sha256 === shadowHash(question)
        ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" },
    };
    const f = mixedFixture(mode, { drift: true, recovery: true, humanSource, answer({ params }) {
      const context = JSON.parse(params.input[0].text.split("\n").at(-1));
      return { outcome: "completed", summary: "Recovery diagnostic fixture.", report: { contract_version: "standard-drift-report.v1", context_sha256: context.context_sha256,
        original_objective: context.context.original_objective, current_objective: context.context.original_objective + " with changed scope", drift_level: "severe", objective_changed: true,
        changes: ["Confirmed fixture scope expansion."], keep: ["Original scope"], discard: [],
        split_recommendation: { new_cycle: true, new_branch: true, change_request_required: true, impact: "high" },
        recommendation: "human_arbitration", rationale: "Typed fixture diagnostic, not a live model verdict.", evidence_refs: context.evidence_refs } };
    } });
    const auth = await bootstrapMixed(f), native = await f.open().step({ write: true, authorization: auth }); assert.equal(native.journal_phase, "closed");
    console.log(`STEP drift recovery ${mode}: native producer closed`);
    const evaluated = await f.open().step({ write: true }); assert.equal(evaluated.kind, "operation");
    let waiting = await f.open().step({ write: true }); assert.equal(waiting.status, "waiting_for_human");
    console.log(`STEP drift recovery ${mode}: authenticated review is waiting`);
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }), beforeParking = artifacts.read("parking-lot.md").sha256,
      beforeCurrent = artifacts.read("CURRENT-STATE.md").sha256, id = waiting.question.operation_id;
    assert.equal(waiting.question.contract_version, "standard-drift-recovery-question.v1");
    assert.deepEqual(waiting.question.choices, ["new_cycle", "rollback", "refused", "deferred", "cancelled"]);
    assert.equal((await f.open().receiveDecision(id, { sourceRef: "missing", write: true })).status, "waiting_for_human");
    const claim = choice => ({ contract_version: "human-drift-recovery-decision.v1", source_kind: "human", authority_id: "fixture_operator",
      source_event_id: `recovery-${mode}-${choice}`, subject_sha256: "a".repeat(64), question_sha256: shadowHash(waiting.question), choice,
      evidence_refs: [{ ref: "fixture:operator/recovery", sha256: "a".repeat(64) }] });
    claims.set("forged", claim("new_cycle"));
    await assert.rejects(f.open().receiveDecision(id, { sourceRef: "forged", write: true }), /PROCESS_HUMAN_NOT_AUTHENTICATED/);
    claims.set("unoffered", claim("requirements_delta"));
    await assert.rejects(f.open().receiveDecision(id, { sourceRef: "unoffered", write: true }), /PROCESS_HUMAN_CHOICE_NOT_OFFERED/);
    claims.set("defer", claim("deferred"));
    await f.open().receiveDecision(id, { sourceRef: "defer", write: true }); await f.open().acceptOperation(id, { write: true });
    assert.equal(f.open().inspect().cursor.status, "WAITING"); assert.equal(artifacts.read("parking-lot.md").sha256, beforeParking);
    waiting = await f.open().step({ write: true }); assert.equal(waiting.status, "waiting_for_human"); assert.notEqual(waiting.question.operation_id, id);
    claims.set("accept", claim("new_cycle"));
    const nextId = waiting.question.operation_id;
    await f.open().receiveDecision(nextId, { sourceRef: "accept", write: true }); await f.open().acceptOperation(nextId, { write: true });
    console.log(`STEP drift recovery ${mode}: deferred review resumed and accepted`);
    const beforeRecord = f.open().inspect(); assert.equal(artifacts.read("parking-lot.md").sha256, beforeParking); assert.equal(artifacts.read("CURRENT-STATE.md").sha256, beforeCurrent);
    claims.clear(); // An accepted, MAC-retained choice survives source disappearance.
    let recorded;
    if (mode === "files") {
      const file = put(f.base, "recovery-restart.json", JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex") }));
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--recovery-record", file], { encoding: "utf8", shell: false, windowsHide: true, timeout: 300000 });
      assert.equal(child.status, 0, child.stderr); const reopened = JSON.parse(child.stdout);
      assert.equal(reopened.status, "WAITING"); assert.equal(reopened.launches, 0); assert.equal(reopened.sessions, 0);
      assert.equal(f.open().inspect().record.instance_sha256, reopened.instance_sha256); recorded = { operation_id: reopened.operation_id };
    } else recorded = await f.open().step({ write: true });
    const output = f.open().readOperation(recorded.operation_id).results.at(-1).output;
    assert.equal(output.outcome, "completed", JSON.stringify(output)); assert.equal(output.effect_status, "confirmed");
    assert.equal(output.facts.drift_recovery_recorded, true); assert.equal(output.facts.drift_check_completed, false); assert.equal(output.observations.recovery_execution, "pending");
    assert.notEqual(artifacts.read("parking-lot.md").sha256, beforeParking); assert.notEqual(artifacts.read("CURRENT-STATE.md").sha256, beforeCurrent);
    assert.equal(artifacts.ownerPending(), false); assert.match(artifacts.read("parking-lot.md").content, /Confirmed fixture scope expansion/);
    assert.equal(output.observations.causal_transition.before_context_sha256, waiting.question.review.context_sha256);
    assert.notEqual(output.observations.causal_transition.after_context_sha256, waiting.question.review.context_sha256);
    const after = f.open().inspect(); assert.equal(after.cursor.status, "WAITING"); assert.ok(after.cursor.occurrences.some(row => row.node_id === "recovery_action_pending"));
    assert.equal((await f.open().dispatchOperation(recorded.operation_id, { write: true })).status, "retained_result");
    const simulation = simulateAgenticProcess({ instanceId: after.record.instance_id, model: after.record.model, parameters: after.record.initial_parameters,
      scopeId: after.record.scope_id, policyPins: after.record.policy_pins, events: after.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, after.record.instance_sha256); assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
    const context = await readStandardDriftContext({ targetRoot: f.configuration.target_root, productRoot: f.configuration.product_root,
      productFiles: f.configuration.product_files, productSha256: f.open().previewNative().product_sha256 });
    assert.equal(context.context.git.other_changes.count, 0); assert.ok(context.evidence_refs.some(row => row.ref === "audit:parking-lot.md"));
    assert.notEqual(beforeRecord.record.instance_sha256, after.record.instance_sha256);
  });
  if (process.argv.includes("--drift-objective-mismatch-only")) await check(process.argv.includes("--drift-objective-construction-only")
    ? "drift objective mismatch: construction preflight builds both exact authorities without Native allocation"
    : process.argv.includes("--drift-objective-finalize-accept") ? "drift objective mismatch: exact accepted opinion reaches authenticated finalization and retained replay"
    : "drift objective mismatch: exact goals retain finalization refusal and prepare an authenticated signal review", async () => {
    // New projects only. This is a diagnostic reproduction, not an admission or
    // a semantic verdict about either objective. Native/Human are fixture ports.
    const sessionObjective = "Learn through an explicitly admitted bounded SPIKE";
    const cycleObjective = "Determine whether a bounded prototype is useful";
    for (const route of ["finalize", "recovery"]) {
      let humanReads = 0;
      const humanClaims = new Map();
      const finalizeOpinion = process.argv.includes("--drift-objective-finalize-accept"), acceptOpinion = finalizeOpinion || process.argv.includes("--drift-objective-human-accept");
      const options = route === "recovery" ? { finalize: false, recovery: true, objectiveFinalize: finalizeOpinion, humanSource: {
        read({ sourceRef, question }) { humanReads++; assert.equal(question.contract_version, "standard-drift-recovery-question.v2"); return humanClaims.get(sourceRef) ?? null; },
        verify({ source, sourceRef }) { assert.deepEqual(source, humanClaims.get(sourceRef)); return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) }; },
      } } : {};
      const f = finalizationFixture("files", options);
      Object.assign(f, { sessionObjective, cycleObjective });
      // Validate both exact authorities before allocating a Native fixture.
      // The recovery model has no finalize node and must have no finalize pin.
      f.open();
      if (process.argv.includes("--drift-objective-construction-only")) {
        assert.equal(f.t.sessions.length, 0);
        console.log(JSON.stringify({ drift_objective_model_preflight: route, outcome: "constructed", native_allocations: 0 }));
        continue;
      }
      const auth = await bootstrapMixed(f), c = await prepareCompletionCycle(f, "DONE");
      assert.match(c.artifacts.sessions().find(row => row.session_id === "S001").content, new RegExp(sessionObjective));
      const observed = await c.context();
      assert.equal(observed.context.original_objective, cycleObjective);
      assert.equal(observed.context.context_use, "cycle_completion");
      const native = await f.open().step({ write: true, authorization: auth });
      assert.equal(native.journal_phase, "closed", JSON.stringify(native));
      const occurrence = f.open().inspect().cursor.occurrences.find(row => row.node_id === "analyze").occurrence_id;
      const evaluated = await f.open().step({ write: true, input: f.model.data_bindings ? {} : { report_occurrence_id: occurrence } });
      const output = f.open().readOperation(evaluated.operation_id).results.at(-1).output;
      assert.equal(output.facts.drift_present, false);
      assert.equal(output.facts.drift_context_complete, true);
      assert.equal(output.facts.drift_recovery_required, false);
      const before = f.open().inspect().record.instance_sha256;
      if (route === "finalize") {
        const preview = await f.open().step({ write: false, input: { evaluation_operation_id: evaluated.operation_id } });
        assert.equal(preview.preview.prepared.can_apply, false);
        assert.equal(preview.preview.prepared.reason_code, "STANDARD_DRIFT_GATE_BLOCKED");
        assert.ok(preview.preview.prepared.gate.levels.level2.active_signals.includes("objective_delta"));
      } else {
        const preview = await f.open().step({ write: false });
        assert.equal(preview.preview.prepared.plan.contract_version, "standard-drift-recovery-plan.v2");
        assert.equal(f.open().inspect().record.instance_sha256, before);
        const waiting = await f.open().step({ write: true });
        assert.equal(waiting.status, "waiting_for_human"); assert.equal(humanReads, 0);
        assert.equal(waiting.question.contract_version, "standard-drift-recovery-question.v2");
        assert.equal(waiting.question.review.session_objective, sessionObjective);
        assert.equal(waiting.question.review.cycle_objective, cycleObjective);
        assert.deepEqual(waiting.question.choices, ["confirm_alignment", "request_diagnosis", "refused", "deferred", "cancelled"]);
        const parked = c.artifacts.read("parking-lot.md").sha256, current = c.artifacts.read("CURRENT-STATE.md").sha256;
        if (acceptOpinion) {
          const claim = { contract_version: "human-drift-recovery-decision.v2", source_kind: "human", authority_id: "fixture_operator",
            source_event_id: "fixture-objective-alignment-1", subject_sha256: shadowHash(waiting.question.review), question_sha256: shadowHash(waiting.question),
            choice: "confirm_alignment", rationale: "Fixture operator reviews this exact disagreement; signal discharge remains pending.",
            evidence_refs: [{ ref: "fixture:operator/objective", sha256: shadowHash(waiting.question.review) }] };
          humanClaims.set("accept", claim);
          await f.open().receiveDecision(waiting.operation_id, { write: true, sourceRef: "accept" });
          await f.open().acceptOperation(waiting.operation_id, { write: true });
          const decision = f.open().readOperation(waiting.operation_id).results.at(-1).output;
          assert.equal(decision.observations.signal_discharged, false); assert.deepEqual(decision.facts, { drift_check_completed: false });
          if (finalizeOpinion) {
            const closed = await f.open().step({ write: true }), finalized = f.open().readOperation(closed.operation_id).results.at(-1).output;
            assert.equal(finalized.effect_status, "confirmed", JSON.stringify(finalized));
            assert.equal(finalized.facts.drift_check_completed, true, JSON.stringify(finalized));
            assert.equal(finalized.observations.hook.invocation, "in_process_authenticated_objective_alignment");
            assert.equal(finalized.observations.hook.payload.objective_alignment.source_sha256, shadowHash(claim));
            assert.equal(finalized.observations.observed_event.objective_alignment_sha256,
              shadowHash(finalized.observations.hook.payload.objective_alignment));
            const record = f.open().readOperation(closed.operation_id);
            assert.equal(record.preview.prepared.plan.contract_version, "standard-drift-finalize-plan.v3");
            assert.equal((await f.open().dispatchOperation(closed.operation_id, { write: true })).status, "retained_result");
            assert.equal(f.open().readOperation(closed.operation_id).results.length, record.results.length);
          } else await assert.rejects(f.open().step({ write: false }), /STANDARD_RECOVERY_CONFIRMED_FINDINGS_REQUIRED/);
          const after = f.open().inspect(), simulation = simulateAgenticProcess({ instanceId: after.record.instance_id, model: after.record.model,
            parameters: after.record.initial_parameters, scopeId: after.record.scope_id, policyPins: after.record.policy_pins, events: after.record.events });
          assert.equal(simulation.trace.at(-1).instance_sha256, after.record.instance_sha256);
        }
        assert.equal(c.artifacts.read("parking-lot.md").sha256, parked); assert.equal(c.artifacts.read("CURRENT-STATE.md").sha256, current);
      }
      if (route === "finalize") assert.equal(f.open().inspect().record.instance_sha256, before);
      assert.equal(c.artifacts.ownerPending(), false);
      assert.equal(humanReads, route === "recovery" && acceptOpinion ? 1 : 0);
      assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
      console.log(JSON.stringify({ diagnosis: route === "recovery" && finalizeOpinion ? "AUTHENTICATED_FIXTURE_ALIGNMENT_FINALIZED" : "UNRESOLVED_SIGNAL_REPORT_DISAGREEMENT", route,
        session_objective: sessionObjective, cycle_objective: cycleObjective, target: f.configuration.target_root,
        status: route === "recovery" ? finalizeOpinion ? "FINALIZED_FIXTURE_ALIGNMENT" : "REVIEW_AVAILABLE_RESOLUTION_PENDING" : "BLOCKED", human_question_available: route === "recovery", drift_check_completed: route === "recovery" && finalizeOpinion,
        proof_class: "real-context-evaluation-finalization-and-recovery-ports-fixture-native", complete_standard: false }));
    }
  });
  for (const [mode, state] of [["files", "DONE"], ["dual", "NO_GO"], ["db-only", "DROPPED"]]) await check(`drift completion ${mode}: terminal owning context drives the authenticated report and real hook without reopening the cycle`, async () => {
    const f = finalizationFixture(mode), auth = await bootstrapMixed(f), c = await prepareCompletionCycle(f, state, mode === "db-only");
    const current = c.artifacts.read("CURRENT-STATE.md"), status = c.artifacts.read(c.statusPath), original = await c.context();
    assert.equal(original.context.context_use, "cycle_completion"); assert.equal(original.context.cycle_id, "C001");
    assert.equal(original.context.cycle_state, state); assert.equal(original.context.original_objective, c.objective);
    assert.notEqual(original.context.original_objective, "Execute real mixed bootstrap");
    assert.ok(original.evidence_refs.some(row => row.ref === "audit:" + c.briefPath)); assert.match(current.content, /^active_cycle: none$/m);
    const ordinary = await runReloadCheckUseCase({ targetRoot: f.configuration.target_root, args: { cache: ".aidn/runtime/cache/reload-state.json",
      stateMode: mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: false } });
    assert.equal(ordinary.decision, "stop", JSON.stringify(ordinary));
    if (mode === "db-only") {
      put(f.configuration.target_root, "docs/audit/" + c.briefPath, "POISONED_VISIBLE_COMPLETION\n");
      assert.equal((await c.context()).context.original_objective, c.objective);
    }
    if (mode === "files") {
      await c.change([[c.statusPath, status.content.replace(/^usage_matrix_scope:.*$/m, "usage_matrix_scope: shared").replace(/^usage_matrix_state:.*$/m, "usage_matrix_state: PARTIAL")]]);
      await assert.rejects(c.context(), error => error.code === "STANDARD_DRIFT_COMPLETION_ADMISSION_BLOCKED" && error.admission_reason === "CYCLE_CLOSE_USAGE_MATRIX_INCOMPLETE");
      await c.change([[c.statusPath, status.content]]);
      const branch = c.git("branch", "--show-current"); c.git("switch", "-c", "feature/C999-unowned-completion");
      await assert.rejects(c.context(), error => error.code === "STANDARD_DRIFT_COMPLETION_ADMISSION_BLOCKED" && error.admission_reason === "CYCLE_CLOSE_MAPPING_MISSING");
      c.git("switch", branch);
      await c.change([[c.statusPath, status.content.replace(/^state:.*$/m, "state: OPEN")]]);
      await assert.rejects(c.context(), /STANDARD_DRIFT_COMPLETION_CONTEXT_REQUIRED/);
      await c.change([[c.statusPath, status.content]]);
    }
    const native = await f.open().step({ write: true, authorization: auth });
    assert.equal(native.journal_phase, "closed", JSON.stringify({ phase: native.journal_phase, status: native.status, failure: native.first_failure }));
    const beforeEvaluation = f.open().inspect(), occurrence = beforeEvaluation.cursor.occurrences.find(row => row.node_id === "analyze").occurrence_id;
    const evaluated = await f.open().step({ write: true, input: { report_occurrence_id: occurrence } }), input = { evaluation_operation_id: evaluated.operation_id };
    const evaluation = f.open().readOperation(evaluated.operation_id).results.at(-1).output;
    assert.equal(evaluation.facts.drift_recovery_required, false); assert.equal(evaluation.observations.scope.context_use, "cycle_completion");
    if (mode === "files") {
      const brief = c.artifacts.read(c.briefPath); await c.change([[c.briefPath, brief.content.replace(c.objective, "A changed terminal cycle goal that requires a fresh diagnostic")]]);
      await assert.rejects(f.open().step({ input }), /STANDARD_DRIFT_REPORT_STALE/); await c.change([[c.briefPath, brief.content]]);
      assert.equal(f.open().inspect().record.instance_sha256, evaluated.record.instance_sha256);
    }
    const completed = await f.open().step({ write: true, input }), output = f.open().readOperation(completed.operation_id).results.at(-1).output;
    assert.equal(completed.cursor.status, "COMPLETED", JSON.stringify({ outcome: output.outcome, reason: output.observations.reason_code,
      levels: output.observations.gate?.levels, status: completed.cursor.status }));
    assert.equal(output.facts.drift_check_completed, true);
    assert.equal(c.artifacts.read("CURRENT-STATE.md").sha256, current.sha256); assert.equal(c.artifacts.read(c.statusPath).sha256, status.sha256);
    assert.equal((await f.open().dispatchOperation(completed.operation_id, { write: true })).status, "retained_result"); assert.equal(f.t.sessions.length, 1);
    const replay = simulateAgenticProcess({ instanceId: completed.record.instance_id, scopeId: completed.record.scope_id, model: completed.record.model,
      policyPins: completed.record.policy_pins, events: completed.record.events }); assert.equal(replay.trace.at(-1).instance_sha256, completed.record.instance_sha256);
    if (mode === "files") {
      const prefix = "cycles/C002-feature-unrelated/", otherStatus = status.content.replaceAll("C001", "C002")
        .replace(/^branch_name:.*$/m, "branch_name: feature/C002-unrelated").replace(/^state:.*$/m, "state: OPEN").replace(/^outcome:.*$/m, "outcome: ACTIVE");
      await c.change([[prefix + "status.md", otherStatus], [prefix + "brief.md", c.artifacts.read(c.briefPath).content
        .replaceAll("C001", "C002").replace(c.objective, "An unrelated cycle must never replace the branch owner")],
        ...["plan.md", "change-requests.md"].map(name => [prefix + name, c.artifacts.read(c.statusPath.replace("status.md", name)).content.replaceAll("C001", "C002")]),
        [current.path, current.content.replace(/^active_cycle:.*$/m, "active_cycle: C002")]]);
      await assert.rejects(c.context(), /STANDARD_DRIFT_COMPLETION_CONTEXT_REQUIRED/);
      await c.change([[current.path, current.content], [prefix + "status.md", otherStatus.replace(/^branch_name:.*$/m, "branch_name: " + c.git("branch", "--show-current"))]]);
      await assert.rejects(c.context(), error => error.code === "STANDARD_DRIFT_COMPLETION_ADMISSION_BLOCKED" && error.admission_reason === "CYCLE_CLOSE_MAPPING_AMBIGUOUS");
      assert.equal(f.open().inspect().record.instance_sha256, completed.record.instance_sha256);
    }
  });
  await check("drift finalization contract accepts only an evaluation identity and binds a fixed hook run", async () => {
    const f = fixture(), id = "op_" + "a".repeat(40), calls = [];
    assertStandardOperationInput("drift_check_finalize", { evaluation_operation_id: id });
    assert.throws(() => assertStandardOperationInput("drift_check_finalize", { evaluation_operation_id: id, override: true }), /INPUT_INVALID/);
    assert.throws(() => assertStandardOperationInput("drift_check_finalize", { evaluation_operation_id: "../other" }), /INPUT_INVALID/);
    const args = { skill: "drift-check", mode: "COMMITTING", runId: "process_drift_" + id, strict: true };
    const options = { args, targetRoot: f.configuration.target_root, perfDir: fileURLToPath(new URL("./", import.meta.url)),
      processAdapter: { runJsonNodeScript(file, argv) { calls.push({ file, argv }); return { ok: true, result: "ok" }; } } };
    assert.equal(runSkillHookUseCase(options).ok, true);
    assert.equal(path.basename(calls[0].file), "gating-evaluate.mjs"); assert.ok(calls[0].argv.includes("--complete-drift-check"));
    assert.equal(calls[0].argv[calls[0].argv.indexOf("--run-id") + 1], args.runId);
    assert.throws(() => runSkillHookUseCase({ ...options, args: { ...args, runId: "arbitrary; command" } }), /RUN_ID_INVALID/);
    assert.throws(() => runSkillHookUseCase({ ...options, args: { ...args, skill: "start-session" } }), /RUN_ID_INVALID/);
    assert.equal(calls.length, 1);
    for (const facts of [
      { drift_present: true, drift_context_complete: true, drift_recovery_required: true },
      { drift_present: false, drift_context_complete: false, drift_recovery_required: true },
      { drift_present: false, drift_context_complete: true, drift_recovery_required: true },
    ]) {
      const finalizer = createStandardDriftFinalization({ targetRoot: f.configuration.target_root,
        readEvaluation: async () => ({ output: { facts } }), readCurrent: () => { throw Error("UNEXPECTED_EFFECT"); } });
      const prepared = await finalizer.prepare({}, { evaluation_operation_id: id }, id);
      assert.equal(prepared.can_apply, false); assert.equal(prepared.reason_code, "STANDARD_DRIFT_RECOVERY_REQUIRED");
    }
  });
  for (const mode of ["files", "dual", "db-only"]) await check(`drift finalize ${mode}: real report persistence and own R05 hook close the model without another model call`, async () => {
    let deny = false;
    const f = finalizationFixture(mode, { authorize: async ({ binding }) => deny && binding.id === "drift_check_finalize" ? { authorized: false }
      : { authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) } });
    const { evaluated, input } = await readyFinalization(f), preview = await f.open().step({ input });
    assert.equal(preview.preview.prepared.can_apply, true, JSON.stringify(preview.preview.prepared));
    const events = path.join(f.configuration.target_root, ".aidn/runtime/perf/workflow-events.ndjson"), before = fs.existsSync(events) ? fs.readFileSync(events) : null;
    if (mode === "files") {
      const instructions = f.configuration.instructions.analyze;
      f.configuration.instructions.analyze += " Apply revised diagnostic criteria.";
      assert.equal(f.open().inspect().record.instance_sha256, evaluated.record.instance_sha256);
      await assert.rejects(f.open().step({ input }), /STANDARD_DRIFT_PRODUCER_CONFIGURATION_CHANGED/);
      f.configuration.instructions.analyze = instructions;
      deny = true; await assert.rejects(f.open().step({ write: true, input }), /AUTHORIZATION_REQUIRED/); deny = false;
      assert.equal(f.open().inspect().record.instance_sha256, evaluated.record.instance_sha256);
      assert.equal(fs.existsSync(events), before !== null);
    }
    const completed = await f.open().step({ write: true, input }); assert.equal(completed.cursor.status, "COMPLETED", JSON.stringify(completed));
    const output = f.open().readOperation(completed.operation_id).results.at(-1).output;
    assert.equal(output.facts.drift_check_completed, true); assert.equal(output.observations.hook.payload.result, "ok");
    const artifact = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).read(output.observations.report_path, { required: true });
    assert.equal(artifact.sha256, output.observations.report_sha256); assert.match(artifact.content, /"drift_level": "none"/);
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, "docs/audit", output.observations.report_path)), mode !== "db-only");
    const retained = fs.readFileSync(events), own = retained.toString("utf8").trim().split(/\r?\n/).map(line => JSON.parse(line)).filter(row => row.run_id === "process_drift_" + completed.operation_id);
    assert.equal(own.length, 1); assert.equal(own[0].event, "drift_check_completed");
    assert.equal((await f.open().dispatchOperation(completed.operation_id, { write: true })).status, "retained_result");
    assert.equal((await f.open().step({ write: true })).kind, "terminal"); assert.deepEqual(fs.readFileSync(events), retained); assert.equal(f.t.sessions.length, 1);
    const replay = simulateAgenticProcess({ instanceId: completed.record.instance_id, scopeId: completed.record.scope_id, model: completed.record.model, policyPins: completed.record.policy_pins, events: completed.record.events });
    assert.equal(replay.trace.at(-1).instance_sha256, completed.record.instance_sha256);
  });
  await check("drift finalization revoked: authority is rechecked before the first effect", async () => {
    let f, revoked = false;
    f = finalizationFixture("files", { authorize: async ({ binding }) => {
      if (binding.id === "drift_check_finalize" && createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).ownerPending()) {
        revoked = true; return { authorized: false };
      }
      return { authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) };
    } });
    const { input } = await readyFinalization(f), result = await f.open().step({ write: true, input });
    assert.equal(result.cursor.status, "WAITING"); const output = f.open().readOperation(result.operation_id).results.at(-1).output;
    assert.equal(output.outcome, "blocked"); assert.equal(output.effect_status, "no_effect"); assert.deepEqual(output.facts, {});
    assert.equal(output.observations.reason_code, "STANDARD_HOST_AUTHORIZATION_REQUIRED");
    assert.equal(revoked, true);
    assert.equal(createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).ownerPending(), false);
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/perf/workflow-events.ndjson")), false);
    assert.equal(f.t.sessions.length, 1);
  });
  await check("drift finalization unknown: real hook effects remain unresolved when their observation fails", async () => {
    const f = finalizationFixture(), { input } = await readyFinalization(f), file = path.join(f.configuration.target_root, ".aidn/runtime/perf/workflow-events.ndjson");
    const stat = fs.statSync, before = fs.existsSync(file) ? stat(file).size : 0;
    let result;
    fs.statSync = function(candidate, ...args) { const value = stat.call(this, candidate, ...args);
      if (String(candidate) === file && value.size > before) throw Object.assign(Error("FIXTURE_EVENT_OBSERVATION_FAILED"), { code: "EIO" }); return value; };
    try { result = await f.open().step({ write: true, input }); } finally { fs.statSync = stat; }
    const output = f.open().readOperation(result.operation_id).results.at(-1).output;
    assert.equal(result.cursor.status, "WAITING"); assert.equal(output.outcome, "reconciliation_required"); assert.equal(output.effect_status, "unknown"); assert.deepEqual(output.facts, {});
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
    assert.equal(artifacts.ownerPending(), true); assert.notEqual(artifacts.read(output.observations.report_path).sha256, null);
    assert.ok(fs.readFileSync(file, "utf8").includes("drift_check_completed"));
    const retained = fs.readFileSync(file); assert.equal((await f.open().step({ write: true })).kind, "reconciliation"); assert.deepEqual(fs.readFileSync(file), retained);
    assert.equal(f.t.sessions.length, 1);
  });
  await check("drift controlled Git forwards admitted product diffs and hashes private changes without disclosure", async () => {
    const repo = path.join(root, "diagnostic-git"), productRoot = path.join(repo, "product"); fs.mkdirSync(productRoot, { recursive: true });
    const command = args => spawnSync("git", ["-c", "core.hooksPath=NUL", ...args], { cwd: repo, encoding: "utf8", shell: false });
    assert.equal(command(["init", "-b", "dev"]).status, 0);
    put(productRoot, "app.mjs", "export const value = 1;\n"); const privateFile = put(repo, "private.txt", "initial\n");
    assert.equal(command(["add", "."]).status, 0);
    assert.equal(command(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]).status, 0);
    fs.writeFileSync(path.join(productRoot, "app.mjs"), "export const value = 2;\n"); fs.writeFileSync(privateFile, "PRIVATE_FIXTURE_CONTENT_A\n");
    const input = { root: repo, productRoot, productFiles: ["app.mjs"], deniedRoots: [privateFile] }, first = readControlledDriftGit(input);
    assert.match(first.diff, /value = 2/); assert.equal(JSON.stringify(first).includes("PRIVATE_FIXTURE_CONTENT"), false);
    assert.equal(JSON.stringify(first).includes("private.txt"), false); assert.equal(first.other_changes.count, 1);
    fs.writeFileSync(privateFile, "PRIVATE_FIXTURE_CONTENT_B\n"); const next = readControlledDriftGit(input);
    assert.equal(first.diff_sha256, next.diff_sha256); assert.notEqual(first.global_diff_sha256, next.global_diff_sha256);
    assert.throws(() => assertDiagnosticPathScope(privateFile, [repo]), /SCOPE_DENIED/);
    assert.throws(() => readControlledDriftGit({ ...input, productFiles: ["../private.txt"] }), /SCOPE_INVALID/);
    assert.throws(() => readControlledDriftGit({ ...input, deniedRoots: [productRoot] }), /SCOPE_DENIED/);
    assert.throws(() => readControlledDriftGit({ ...input, environment: { ...process.env, GIT_CONFIG_COUNT: "0" } }), /ENV_SCOPE_CONFLICT/);
  });
  await check("drift contract binds bounded reports and refuses inconsistent or invented evidence", async () => {
    const context = { context_sha256: "a".repeat(64), context: { original_objective: "Original goal", session_id: "S001", cycle_id: null,
      git: { diff_scope: "configured-product-files-only", other_changes: { count: 0 } } }, evidence_refs: [{ ref: "audit:SPEC.md", sha256: "b".repeat(64) }] };
    const report = { contract_version: "standard-drift-report.v1", context_sha256: context.context_sha256, original_objective: "Original goal", current_objective: "Original goal",
      drift_level: "none", objective_changed: false, changes: [], keep: ["Current scope"], discard: [], split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" },
      recommendation: "continue", rationale: "No scope deviation observed.", evidence_refs: context.evidence_refs };
    assertStandardDriftReport(report); assertNativeActivityAnswer({ outcome: "completed", summary: "Diagnostic", report }, report.contract_version, context.context_sha256);
    const evaluated = evaluateStandardDriftReport({ report, reference: { ref: "execution:report", sha256: "c".repeat(64) }, producer: {} }, context);
    assert.equal(evaluated.observations.skill_completion, "pending"); assert.equal(evaluated.facts.drift_present, false);
    assert.equal(evaluated.facts.drift_context_complete, true); assert.equal(evaluated.facts.drift_recovery_required, false);
    assert.equal(evaluated.facts.drift_check_completed, false);
    const partial = evaluateStandardDriftReport({ report, reference: { ref: "execution:report", sha256: "c".repeat(64) }, producer: {} },
      { ...context, context: { ...context.context, git: { other_changes: { count: 1 } } } });
    assert.equal(partial.facts.drift_present, false); assert.equal(partial.facts.drift_context_complete, false); assert.equal(partial.facts.drift_recovery_required, true);
    assert.throws(() => assertNativeActivityAnswer({ outcome: "completed", summary: "Only a summary" }, report.contract_version, context.context_sha256), /ANSWER_INVALID/);
    assert.throws(() => assertNativeActivityAnswer({ outcome: "completed", summary: "Wrong context", report: { ...report, context_sha256: "d".repeat(64) } }, report.contract_version, context.context_sha256), /ANSWER_INVALID/);
    assert.throws(() => assertNativeActivityAnswer({ outcome: "failed", summary: "Failed", report }, report.contract_version, context.context_sha256), /OUTPUT_NONCOMPLETION/);
    assertNativeActivityAnswer({ outcome: "rejected", summary: "Refused", report: null }, report.contract_version, context.context_sha256);
    assert.throws(() => assertNativeActivityAnswer({ outcome: "completed", summary: "Extra report", report }), /ANSWER_INVALID/);
    assert.throws(() => assertStandardDriftReport({ ...report, objective_changed: true }), /INCONSISTENT/);
    assert.throws(() => assertStandardDriftReport({ ...report, changes: ["Changed scope"] }), /INCONSISTENT/);
    assert.throws(() => assertStandardDriftReport({ ...report, rationale: "x".repeat(4097) }), /INVALID/);
    assert.throws(() => nativeActivityAnswerSchema("caller-selected-schema", context.context_sha256), /UNSUPPORTED/);
    assert.throws(() => evaluateStandardDriftReport({ report: { ...report, evidence_refs: [{ ref: "invented", sha256: "b".repeat(64) }] } }, context), /EVIDENCE_INVALID/);
    assert.throws(() => evaluateStandardDriftReport({ report }, { ...context, context_sha256: "e".repeat(64) }), /STALE/);
    const f = fixture(), authority = { profile: "standard-mixed.v1", read() { throw Error("UNEXPECTED_AUTHORITY_READ"); } };
    f.configuration.activity_outputs = { analyze: "standard-drift-report.v1" };
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration), /OUTPUT_CONTRACT_UNSUPPORTED/);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration, { processAuthority: authority }), /OUTPUT_BINDING_INVALID/);
    f.configuration.activity_outputs = { analyze: { schema: {} } };
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration, { processAuthority: authority }), /OUTPUT_BINDING_INVALID/);
  });
  for (const [stateMode, level] of [["files", "none"], ["dual", "mild"], ["db-only", "severe"]]) await check(`drift ${stateMode}: authenticated ${level} report routes through the real mixed host without completing R05`, async () => {
    const f = mixedFixture(stateMode, { drift: true, answer({ params }) {
      const context = JSON.parse(params.input[0].text.split("\n").at(-1));
      assert.equal(JSON.stringify(context).includes("PRIVATE_END_TO_END_FIXTURE"), false);
      assert.equal(params.outputSchema.properties.report.anyOf[1].properties.context_sha256.const, context.context_sha256);
      const report = { contract_version: "standard-drift-report.v1", context_sha256: context.context_sha256, original_objective: context.context.original_objective,
        current_objective: context.context.original_objective + (level === "none" ? "" : " with extended scope"), drift_level: level, objective_changed: level !== "none",
        changes: level === "none" ? [] : ["Fixture diagnostic observes scope expansion."], keep: ["Original scope"], discard: [],
        split_recommendation: { new_cycle: level !== "none", new_branch: level !== "none", change_request_required: level !== "none", impact: level === "none" ? "none" : level === "severe" ? "high" : "medium" },
        recommendation: level === "none" ? "continue" : level === "severe" ? "human_arbitration" : "new_cycle", rationale: "Fixture semantic answer; native transport is doubled.", evidence_refs: context.evidence_refs };
      return { outcome: "completed", summary: "Structured diagnostic produced.", report };
    } });
    let privateFile;
    if (stateMode === "files") {
      privateFile = put(f.configuration.target_root, "private.txt", "private fixture baseline\n");
      for (const args of [["add", "private.txt"], ["-c", "core.hooksPath=NUL", "commit", "-m", "private fixture baseline"]]) {
        const done = spawnSync("git", args, { cwd: f.configuration.target_root, encoding: "utf8", shell: false }); assert.equal(done.status, 0, done.stderr);
      }
      f.configuration.native.protected_roots = [privateFile];
    }
    const auth = await bootstrapMixed(f);
    if (privateFile) fs.writeFileSync(privateFile, "PRIVATE_END_TO_END_FIXTURE\n");
    const native = await f.open().step({ write: true, authorization: auth });
    assert.equal(native.journal_phase, "closed", JSON.stringify(native)); assert.equal(f.t.sessions.length, 1);
    const before = f.open().inspect(), occurrence = before.cursor.occurrences.find(row => row.node_id === "analyze").occurrence_id;
    if (stateMode === "files") {
      const product = path.join(f.dirs.product, "app.mjs"), original = fs.readFileSync(product);
      fs.appendFileSync(product, "// changed after diagnostic\n");
      await assert.rejects(f.open().step({ input: { report_occurrence_id: occurrence } }), /DRIFT_REPORT_STALE/);
      fs.writeFileSync(product, original);
      await assert.rejects(f.open().step({ input: { report_occurrence_id: occurrence, report: {} } }), /OPERATION_INPUT_INVALID/);
    }
    const result = await f.open().step({ write: true, input: { report_occurrence_id: occurrence } });
    assert.equal(result.cursor.status, "WAITING"); assert.equal(f.t.sessions.length, 1);
    assert.equal(result.cursor.occurrences.find(row => row.node_id === (level === "none" && !privateFile ? "finalization_pending" : "recovery_pending")).status, "WAITING");
    const journal = f.open().readOperation(result.operation_id);
    assert.equal(journal.results.at(-1).output.observations.skill_completion, "pending");
    assert.equal(journal.results.at(-1).output.observations.recovery_writes_authorized, false);
    assert.equal(journal.results.at(-1).output.facts.drift_context_complete, !privateFile);
    const replay = simulateAgenticProcess({ instanceId: result.record.instance_id, scopeId: result.record.scope_id, model: result.record.model, policyPins: result.record.policy_pins, events: result.record.events });
    assert.equal(replay.trace.at(-1).instance_sha256, result.record.instance_sha256);
    if (stateMode === "files") {
      const reference = result.record.events.find(row => row.kind === "result").result.evidence_refs.find(row => /-native-result\.json$/.test(row.ref));
      const file = path.join(f.dirs.control, "case", path.basename(reference.ref)), bytes = fs.readFileSync(file);
      fs.appendFileSync(file, "\n"); assert.throws(() => f.open().inspect(), /EVIDENCE_CHANGED/); fs.writeFileSync(file, bytes);
    }
  });
  for (const stateMode of ["files", "dual", "db-only"]) await check(`mixed ${stateMode}: real session bootstrap, native boundaries, signed control and durable review share one IR`, async () => {
    let claim = null;
    const controlSource = { async read() { return claim; }, async verify({ source }) { assert.deepEqual(source, claim); return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) }; } };
    const f = mixedFixture(stateMode, { controlSource, async beforeWorker(f) {
      assert.equal(createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).ownerPending(), true);
      await assert.rejects(f.open().step({ write: true }), /NATIVE_ALLOCATION_ACTIVE/);
      const blocked = await createStandardWorkflowOperations({ targetRoot: f.configuration.target_root }).prepareSession({ session_id: "S002", session_branch: "S002-other", objective: "Competing operation" });
      assert.equal(blocked.reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    } });
    const auth = await bootstrapMixed(f);
    assert.equal(f.t.sessions.length, 0); assert.equal(createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).sessions().length, 1);
    const first = await f.open().step({ write: true, authorization: auth }); assert.equal(first.kind, "native"); assert.equal(first.journal_phase, "closed", JSON.stringify(first));
    assert.equal(f.t.sessions.length, 1); assert.equal(createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).ownerPending(), false);
    const post = await f.open().step({ write: true }); assert.equal(post.kind, "operation"); assert.equal(post.cursor.status, "WAITING");
    const state = f.open().inspect(), frame = state.cursor.occurrences.find(row => row.node_id === "external_wait"), request = f.open().prepareControl({ expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id });
    claim = { contract_version: "process-control-source.v1", source_kind: "external", authority_id: "fixture_review", source_event_id: "review-1", subject_sha256: "a".repeat(64), request_sha256: shadowHash(request), event_key: "review_snapshot", payload_sha256: "b".repeat(64), evidence_refs: [{ ref: "provider:review-1", sha256: "c".repeat(64) }] };
    const captured = await f.open().captureControl({ expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id, sourceRef: "review", write: true });
    await f.open().deliverControl(captured.inbox_id, { write: true });
    let final;
    if (stateMode === "files") {
      const file = put(f.base, "mixed-restart.json", JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex"), authorization: { ...auth, authorized_at_ms: Date.now() } }));
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--mixed-continue", file], { encoding: "utf8", shell: false, timeout: 300000 });
      assert.equal(child.status, 0, child.stderr); const completed = JSON.parse(child.stdout);
      assert.equal(completed.native.journal_phase, "closed", JSON.stringify(completed)); assert.equal(completed.status, "COMPLETED");
      assert.equal(completed.sessions, 1); assert.equal(completed.closed, true); assert.equal(completed.leaked_key, false);
      final = f.open().inspect(); assert.equal(final.record.instance_sha256, completed.instance_sha256);
    } else {
      const second = await f.open().step({ write: true, authorization: { ...auth, authorized_at_ms: Date.now() } }); assert.equal(second.journal_phase, "closed", JSON.stringify(second));
      final = await f.open().step({ write: true }); assert.equal(final.cursor.status, "COMPLETED");
    }
    assert.equal(f.t.sessions.length, stateMode === "files" ? 1 : 2); assert.equal(f.open().inspectAllocations().allocations.length, 2);
    const replay = simulateAgenticProcess({ instanceId: final.record.instance_id, scopeId: final.record.scope_id, model: final.record.model, policyPins: final.record.policy_pins, events: final.record.events });
    assert.equal(replay.trace.at(-1).instance_sha256, final.record.instance_sha256);
    for (const row of replay.trace) assert.equal(agenticProcessPrefixSha256(final.record, row.step), row.instance_sha256);
    assert.throws(() => agenticProcessPrefixSha256(final.record, -1), /PREFIX_CHECKPOINT_INVALID/);
    const corrupt = structuredClone(final.record); corrupt.instance_sha256 = "0".repeat(64); assert.throws(() => agenticProcessPrefixSha256(corrupt, 0), /INSTANCE_INVALID/);
    assert.equal(f.open().readCheckpoint(2).state.resources.length, 2);
  });
  await check("mixed explicit grant refusal leaves session effects and native calls at zero", async () => {
    const f = mixedFixture("files", { authorize: async () => ({ authorized: false }) }), h = f.open(), initial = h.initialize({ write: false });
    h.initialize({ write: true, expectedResultSha256: initial.record.instance_sha256 });
    await f.open().step({ write: true }); await f.open().step({ write: true });
    const before = f.open().inspect().record.instance_sha256;
    await assert.rejects(f.open().step({ write: true, input: { session_id: "S001", session_branch: "S001-mixed", objective: "Refused mutation" } }), /AUTHORIZATION_REQUIRED/);
    assert.equal(f.open().inspect().record.instance_sha256, before); assert.equal(f.t.sessions.length, 0); assert.equal(f.open().inspectAllocations(), null);
    assert.equal(createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).sessions().length, 0);
  });
  await check("mixed interrupted native ownership blocks further business dispatch without PID takeover", async () => {
    const f = mixedFixture("files", { controllerFailure: true }), auth = await bootstrapMixed(f), result = await f.open().step({ write: true, authorization: auth });
    assert.equal(result.status, "WAITING_FOR_RECONCILIATION"); assert.equal(f.t.sessions.length, 0);
    assert.equal(createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).ownerPending(), true);
    await assert.rejects(f.open().step({ write: true }), /NATIVE_ALLOCATION_ACTIVE/);
    const blocked = await createStandardWorkflowOperations({ targetRoot: f.configuration.target_root }).prepareSession({ session_id: "S002", session_branch: "S002-other", objective: "Uncertain predecessor" });
    assert.equal(blocked.reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
  });
  await check("worker mixed private v2 authority stops at an operation boundary without native startup", async () => {
    const f = mixedFixture("files"), processAuthority = createStandardProcessAuthority({ configuration: f.configuration, model: f.model, readSigningKey: () => f.key });
    const actor = createJournaledNativeAllocation({ configuration: f.configuration, readSigningKey: () => f.key, processAuthority },
      { controllerFactory: journalController(f, f.t, { realWorker: true }) });
    const result = await actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(f.worker.status, 0, f.worker.stderr); assert.equal(result.journal_phase, "closed", JSON.stringify(result));
    assert.equal(f.t.sessions.length, 0); assert.equal(f.t.calls.length, 0);
    const checkpoint = actor.readCheckpoint(1).state;
    assert.equal(checkpoint.instance.events.length, 0); assert.equal(checkpoint.resources.length, 0);
    const cursor = inspectAgenticProcess(checkpoint.instance);
    assert.deepEqual(cursor.ready.map(id => cursor.occurrences.find(row => row.occurrence_id === id).node_id), ["reload"]);
    assert.equal(createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root }).ownerPending(), false);
    assert.equal(JSON.stringify({ result, journal: actor.inspect(), worker: f.worker }).includes(f.key.toString("base64")), false);
  });
  await check("worker private allocation IPC executes the fixed entry without native startup or retained key bytes", async () => {
    for (const badOwner of [false, true]) {
      const f = journalFixture({ realWorker: true, waitAtEntry: true, mutateAdmission(value) { if (badOwner) value.owner_id = "not-the-reserved-owner"; } });
      const result = await f.actor.run({ execute: true, authorization: f.authorize() });
      assert.equal(f.worker.status, badOwner ? 1 : 0, f.worker.stderr);
      assert.equal(result.status, badOwner ? "FAILED" : "WAITING", JSON.stringify(result));
      assert.equal(f.t.sessions.length, 0); assert.equal(f.t.calls.length, 0);
      if (badOwner) assert.equal(result.first_failure, "PROCESS_WORKER_ALLOCATION_CHANGED");
      else { assert.equal(f.actor.readCheckpoint(1).state.resources.length, 0); assert.equal(f.actor.inspect().allocations[0].consumption.responses_observed, 0); }
      const evidence = JSON.stringify({ result, journal: f.actor.inspect(), worker: f.worker });
      assert.equal(evidence.includes(f.key.toString("base64")), false); assert.equal(evidence.includes("key_base64"), false);
      for (const name of fs.readdirSync(f.dirs.control, { recursive: true }).filter(name => name.endsWith(".json")))
        assert.equal(fs.readFileSync(path.join(f.dirs.control, name), "utf8").includes(f.key.toString("base64")), false);
    }
  });
  await check("resume refuses a self-hashed control event without authenticated inbox provenance", async () => {
    const f = await readyResumeFixture({ uncaptured: true }), store = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }), before = store.read("case");
    const delivery = controlDelivery(f.request, f.claim), forged = advanceAgenticProcess(before.record, { event_id: "forged_control", kind: "control", occurrence_id: f.request.occurrence_id, delivery });
    store.compareAndSwap(forged, before.content_sha256);
    await assert.rejects(f.open().run({ execute: true, authorization: f.auth, resume: true }), /CONTROL_NOT_AUTHENTICATED/);
    assert.equal(f.launches, 1); assert.equal(f.actor.inspect().allocations.length, 1); assert.equal(f.t.sessions.length, 2);
  });
  await check("resume refuses changed head before delivery and after an accepted event", async () => {
    const f = await readyResumeFixture({ undelivered: true });
    const commit = () => { const result = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "new head"], { cwd: f.configuration.target_root, encoding: "utf8", shell: false }); assert.equal(result.status, 0, result.stderr); };
    commit(); await assert.rejects(f.actor.deliverControl(f.capture.inbox_id, { write: true }), /CONTROL_CONTEXT_CHANGED/);
    assert.equal(f.launches, 1); assert.equal(f.actor.inspect().allocations.length, 1);
    // Restore the original head explicitly, deliver, then advance it again.
    const reset = spawnSync("git", ["reset", "--soft", f.request.head], { cwd: f.configuration.target_root, encoding: "utf8", shell: false }); assert.equal(reset.status, 0, reset.stderr);
    await f.actor.deliverControl(f.capture.inbox_id, { write: true }); commit();
    await assert.rejects(f.open().run({ execute: true, authorization: f.auth, resume: true }), /CONTROL_CONTEXT_CHANGED/); assert.equal(f.launches, 1);
  });
  await check("resume requires the current dual projection before reserving another worker", async () => {
    const f = await readyResumeFixture({ stateMode: "dual" }), visible = path.join(f.configuration.target_root, "docs/audit/workflows/process-instances/case.json");
    fs.unlinkSync(visible);
    await assert.rejects(f.open().run({ execute: true, authorization: f.auth, resume: true }), /PROJECTION_RECONCILIATION_REQUIRED/);
    assert.equal(f.launches, 1); assert.equal(f.actor.inspect().allocations.length, 1);
    assert.equal((await f.open().deliverControl(f.capture.inbox_id, { write: true })).retained, true); assert.equal(fs.existsSync(visible), true);
  });
  await check("resume worker authenticates its exact reservation and does not accept a supplied owner", async () => {
    const f = await readyResumeFixture({ mutateAdmission(admission, f) { if (f.launches === 2) admission.owner_id = "other-owner"; } });
    const result = await f.open().run({ execute: true, authorization: f.auth, resume: true });
    assert.equal(result.status, "WAITING_FOR_RECONCILIATION"); assert.equal(result.first_failure, "PROCESS_WORKER_ALLOCATION_CHANGED");
    assert.equal(f.t.sessions.length, 2); assert.equal(f.actor.inspect().allocations.at(-1).phase, "reserved");
  });
  for (const stateMode of ["files", "dual", "db-only"]) await check(`resume ${stateMode}: authenticated event resumes owned native allocation with historical review exclusions and exact replay`, async () => {
    let claim = null, reads = 0, verifies = 0;
    const controlSource = {
      async read() { reads++; return claim; },
      async verify({ source }) { verifies++; assert.deepEqual(source, claim); return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) }; },
    };
    const f = journalFixture({ stateMode, wait: true, resumeReview: true, git: true, controlSource }), auth = f.authorize();
    auth.global_deadline_ms += 180000; auth.workflow_deadline_ms += 180000;
    const first = await f.actor.run({ execute: true, authorization: auth }); assert.equal(first.status, "WAITING", JSON.stringify(first));
    const snapshot = f.actor.readCheckpoint(1), oldWriter = snapshot.state.resources.find(row => row.executor.contributions.length).executor;
    const frame = inspectAgenticProcess(snapshot.state.instance).occurrences.find(row => row.node_id === "external_wait");
    const noEvent = await f.open().run({ execute: true, authorization: auth, resume: true }); assert.equal(noEvent.status, "WAITING"); assert.equal(noEvent.native_started, false); assert.equal(f.launches, 1);
    const request = f.actor.prepareControl(frame.occurrence_id);
    assert.equal((await f.actor.captureControl({ occurrenceId: frame.occurrence_id, sourceRef: "review", write: true })).status, "WAITING");
    assert.equal(f.actor.inspect().allocations.length, 1); assert.equal(f.launches, 1);
    claim = { contract_version: "process-control-source.v1", source_kind: "external", authority_id: "fixture_review", source_event_id: "review-1",
      subject_sha256: "a".repeat(64), request_sha256: shadowHash(request), event_key: "review_snapshot", payload_sha256: "b".repeat(64),
      evidence_refs: [{ ref: "provider:review-1", sha256: "c".repeat(64) }] };
    const captured = await f.open().captureControl({ occurrenceId: frame.occurrence_id, sourceRef: "review", write: true });
    const delivered = await f.open().deliverControl(captured.inbox_id, { write: true }); assert.ok(delivered.cursor.ready.length > 0);
    const beforeResume = f.actor.inspect(), nextAuth = { ...auth, authorized_at_ms: Date.now() };
    let second;
    if (stateMode === "files") {
      const input = put(f.base, "resume-input.json", JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex"), authorization: nextAuth }));
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--resume-allocation", input], { encoding: "utf8", shell: false, timeout: 120000 });
      assert.equal(child.status, 0, child.stderr); const evidence = JSON.parse(child.stdout); second = evidence.result;
      assert.equal(evidence.launches, 1); assert.equal(evidence.sessions, 1); assert.equal(evidence.closed, true); assert.equal(evidence.leaked_key, false);
    } else second = await f.open().run({ execute: true, authorization: nextAuth, resume: true });
    assert.equal(second.status, "COMPLETED", JSON.stringify(second)); assert.equal(second.journal_phase, "closed"); assert.equal(f.launches, stateMode === "files" ? 1 : 2);
    const journal = f.open().inspect(); assert.equal(journal.allocations.length, 2);
    assert.equal(journal.allocations[1].limits.max_responses, auth.max_responses - journal.allocations[0].consumption.responses_observed);
    assert.equal(journal.allocations[1].limits.max_bytes, auth.max_bytes - journal.allocations[0].consumption.storage_debit_bytes);
    assert.deepEqual(journal.allocations[0], beforeResume.allocations[0]);
    const final = f.open().readCheckpoint(2), state = final.state.instance, last = state.events.filter(row => row.kind === "assign").at(-1);
    assert.equal(final.state.resources.length, 3); assert.equal(final.state.results.length, 4); assert.equal(f.t.sessions.length, stateMode === "files" ? 2 : 3);
    assert.ok(last.request.reviewed_contributors.some(row => row.agent_id === oldWriter.agent_id && row.lineage_id === oldWriter.lineage_id));
    assert.ok(!snapshot.state.resources.some(row => row.executor.execution_id === last.decision.execution_id));
    assert.equal(final.state.resources.find(row => row.executor.execution_id === oldWriter.execution_id).executor.contributions.length, oldWriter.contributions.length);
    assert.equal(state.events.filter(row => row.kind === "control").length, 1);
    const simulated = simulateAgenticProcess({ instanceId: state.instance_id, model: state.model, policyPins: state.policy_pins, scopeId: state.scope_id, events: state.events });
    assert.equal(simulated.trace.at(-1).instance_sha256, state.instance_sha256);
    const providerReads = reads, providerVerifies = verifies;
    assert.equal((await f.open().deliverControl(captured.inbox_id, { write: true })).retained, true);
    assert.deepEqual([reads, verifies], [providerReads, providerVerifies]); assert.equal(f.launches, stateMode === "files" ? 1 : 2);
    const serialized = JSON.stringify({ journal, final, sessions: f.t.sessions.map(row => row.configuration) });
    assert.equal(serialized.includes(f.key.toString("base64")), false); assert.equal(serialized.includes("key_base64"), false);
    assert.ok(f.t.sessions.at(-1).cfg.permissions[Object.keys(f.t.sessions.at(-1).cfg.permissions)[0]].filesystem[f.dirs.control.replaceAll("\\", "/")] === "deny");
  });
  await check("journal preview retains no files, reservation or native allocation", async () => {
    const f = journalFixture(), view = f.actor.preview(); assert.equal(view.phase, "absent"); assert.equal(view.written, false);
    assert.throws(() => f.actor.prepareAuthorizationEpoch({ originalAuthorization: f.authorize() }), /NATIVE_EPOCH_HISTORY_REQUIRED/);
    assert.equal(f.actor.inspect(), null); assert.equal(f.launches, undefined); assert.equal(f.t.sessions.length, 0);
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, "docs/audit/workflows/native-allocations")), false);
    await assert.rejects(f.actor.run({ execute: true, authorization: { approved: true } }), /EXPLICIT_AUTHORIZATION_REQUIRED/);
  });
  await check("journal seals actual owned observations and reopens in a new Node process without effects", async () => {
    const f = journalFixture(), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "closed", JSON.stringify(result)); assert.equal(result.owned_result.status, "COMPLETED");
    const record = f.actor.inspect(), entry = record.allocations[0]; assertNativeAllocationJournal(record);
    assert.equal(entry.consumption.responses_observed, 3); assert.equal(entry.tree_closed, true); assert.equal(entry.phase, "closed");
    assert.ok(entry.consumption.storage_debit_bytes > result.owned_result.worker_result.storage_budget_debit_bytes);
    assert.equal(f.actor.readCheckpoint(1).state.results.length, 3);
    const file = put(f.base, "reopen.json", JSON.stringify({ configuration: f.configuration, key: f.key.toString("hex") }));
    const module = new URL("../../src/application/runtime/journaled-native-allocation.mjs", import.meta.url).href;
    const script = `import fs from 'node:fs'; import {createJournaledNativeAllocation} from ${JSON.stringify(module)};
      const c=JSON.parse(fs.readFileSync(process.argv[1])); const h=createJournaledNativeAllocation({configuration:c.configuration,readSigningKey:()=>Buffer.from(c.key,'hex')});
      console.log(JSON.stringify({journal:h.inspect(),checkpoint:h.readCheckpoint(1)}));`;
    const reopened = spawnSync(process.execPath, ["--input-type=module", "-e", script, file], { encoding: "utf8", shell: false });
    assert.equal(reopened.status, 0, reopened.stderr); assert.deepEqual(JSON.parse(reopened.stdout).journal, record);
    assert.equal(JSON.parse(reopened.stdout).checkpoint.state.parent_closed, true); assert.equal(f.launches, 1);
    const auth = f.authorize(); auth.global_deadline_ms = entry.limits.global_deadline_ms; auth.workflow_deadline_ms = entry.limits.workflow_deadline_ms;
    await assert.rejects(f.open().run({ execute: true, authorization: auth }), /EXISTING_INSTANCE_REQUIRES_RECONCILIATION/); assert.equal(f.launches, 1);
  });
  await check("journal reservation fences a competing launch before any native effect", async () => {
    const f = journalFixture({ async beforeWorker(f) {
      assert.equal(f.open().inspect().allocations[0].phase, "reserved");
      await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /RECONCILIATION_REQUIRED/);
      assert.equal(f.t.sessions.length, 0);
    } });
    const result = await f.actor.run({ execute: true, authorization: f.authorize() }); assert.equal(result.journal_phase, "closed", JSON.stringify(result)); assert.equal(f.launches, 1);
  });
  await check("journal retains an interrupted reservation and never infers owner death or retries", async () => {
    const f = journalFixture({ controllerFailure: true }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "reconciliation_required"); assert.equal(result.owned_result, null);
    assert.equal(f.open().inspect().allocations[0].phase, "reserved"); assert.equal(f.actor.preview().consumption.known, false);
    await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /RECONCILIATION_REQUIRED/); assert.equal(f.launches, 1);
  });
  await check("journal never promotes unknown tree termination to a successful allocation", async () => {
    const f = journalFixture({ treeUnknown: true }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.owned_result.worker_result.status, "COMPLETED"); assert.equal(result.journal_phase, "unresolved");
    assert.equal(result.status, "WAITING_FOR_RECONCILIATION"); assert.equal(result.retry, false);
    assert.equal(f.actor.inspect().allocations[0].tree_closed, false);
    await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /RECONCILIATION_REQUIRED/);
  });
  await check("journal rejected results stay failed with contributions retained and no fresh attempt", async () => {
    const f = journalFixture({ reject: true }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "failed", JSON.stringify(result)); assert.equal(f.actor.readCheckpoint(1).state.results.at(-1).result.outcome, "rejected");
    await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /TERMINAL_FAILURE/);
  });
  await check("journal refuses self-hashed records and changed signing capabilities", async () => {
    const f = journalFixture(); await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.throws(() => f.open(() => Buffer.alloc(32, 74)).inspect(), /NOT_AUTHENTICATED/);
    const record = f.actor.inspect(), file = path.join(f.configuration.target_root, "docs/audit", nativeJournalPath(record.journal_id));
    record.revision++; fs.writeFileSync(file, JSON.stringify(record)); assert.throws(() => f.actor.inspect(), /NOT_AUTHENTICATED/);
  });
  await check("journal authenticates checkpoint, owned closure and nested native evidence bytes after restart", async () => {
    for (const kind of ["checkpoint", "closure", "native-result"]) {
      const f = journalFixture(); await f.actor.run({ execute: true, authorization: f.authorize() }); const record = f.actor.inspect();
      const file = kind === "checkpoint" ? record.allocations[0].checkpoint.path : kind === "closure" ? record.allocations[0].closure_ref.path
        : path.join(f.dirs.control, "case", fs.readdirSync(path.join(f.dirs.control, "case")).find(name => name.endsWith("-native-result.json")));
      fs.appendFileSync(file, "\n"); assert.throws(() => f.open().readCheckpoint(1), /EVIDENCE_CHANGED/);
    }
  });
  await check("journal retains reconciliation when canonical state disappears after the native worker", async () => {
    const f = journalFixture({ afterWorker(f) { fs.unlinkSync(path.join(f.configuration.target_root, "docs/audit/workflows/process-instances/case.json")); } });
    const result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.owned_result.status, "COMPLETED"); assert.equal(result.journal_phase, "unresolved");
    assert.equal(f.actor.inspect().allocations[0].first_failure, "NATIVE_ALLOCATION_CANONICAL_CHANGED");
  });
  await check("journal refuses budget resets and malformed generation history", async () => {
    const f = journalFixture(); await f.actor.run({ execute: true, authorization: f.authorize() }); const record = f.actor.inspect();
    const auth = f.authorize(); auth.max_responses++; await assert.rejects(f.open().run({ execute: true, authorization: auth }), /LIMIT_INCREASE_UNAUTHORIZED/);
    const bad = structuredClone(record); bad.allocations[0].generation = 2; assert.throws(() => assertNativeAllocationJournal(bad), /GENERATION_INVALID/);
    const unknown = structuredClone(record); unknown.allocations[0].consumption = null; assert.throws(() => assertNativeAllocationJournal(unknown), /CLOSURE_UNCONFIRMED/);
    const excess = structuredClone(record); excess.allocations[0].consumption.storage_debit_bytes = excess.allocations[0].limits.max_bytes + 1;
    assert.throws(() => assertNativeAllocationJournal(excess), /CONSUMPTION_EXCEEDS_LIMIT/);
    const turn = f.authorize(); turn.global_deadline_ms = record.allocations[0].limits.global_deadline_ms;
    turn.workflow_deadline_ms = record.allocations[0].limits.workflow_deadline_ms; turn.max_turn_ms++;
    await assert.rejects(f.open().run({ execute: true, authorization: turn }), /LIMIT_INCREASE_UNAUTHORIZED/);
  });
  await check("journal event wait closes only the allocation and retains an uncompleted workflow", async () => {
    const f = journalFixture({ wait: true }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "closed", JSON.stringify(result)); assert.equal(result.status, "WAITING");
    assert.equal(inspectAgenticProcess(f.open().readCheckpoint(1).state.instance).status, "WAITING");
    assert.equal(f.actor.inspect().allocations[0].consumption.responses_observed, 3); assert.equal(f.launches, 1);
  });
  for (const stateMode of ["dual", "db-only"]) await check(`journal canonical SQLite/${stateMode} retains authenticated allocation and projection policy`, async () => {
    const f = journalFixture({ stateMode }), result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "closed", JSON.stringify(result)); const record = f.open().inspect();
    assert.equal(f.open().readCheckpoint(1).state.instance.instance_sha256, record.allocations[0].checkpoint.instance_sha256);
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, "docs/audit", nativeJournalPath(record.journal_id))), stateMode === "dual");
    assert.equal(record.allocations.length, 1); assert.equal(f.launches, 1);
  });
  await check("journal keeps actual completed worker outcome when canonical closure recording fails", async () => {
    const f = journalFixture({ stateMode: "db-only", async afterWorker(f) {
      const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite"));
      try { db.exec("CREATE TRIGGER refuse_native_closure BEFORE UPDATE ON artifacts WHEN NEW.path LIKE 'workflows/native-allocations/%' BEGIN SELECT RAISE(ABORT, 'fixture allocation closure refusal'); END;"); }
      finally { db.close(); }
    } });
    const result = await f.actor.run({ execute: true, authorization: f.authorize() });
    assert.equal(result.journal_phase, "reconciliation_required"); assert.equal(result.owned_result.status, "COMPLETED");
    assert.equal(result.status, "WAITING_FOR_RECONCILIATION"); assert.equal(result.retry, false);
    assert.equal(f.open().inspect().allocations[0].phase, "reserved");
    await assert.rejects(f.open().run({ execute: true, authorization: f.authorize() }), /RECONCILIATION_REQUIRED/); assert.equal(f.launches, 1);
  });
  function checkpoint(f, result) {
    assert.ok(result.native_checkpoint);
    const match = /^execution\/case\/([0-9]{5}-native-host-state\.json)$/.exec(result.native_checkpoint.ref); assert.ok(match);
    const data = fs.readFileSync(path.join(f.dirs.control, "case", match[1])); assert.equal(sha(data), result.native_checkpoint.sha256);
    const retained = JSON.parse(data); assertNativeHostState(retained.state);
    assert.equal(retained.state.instance.instance_sha256, result.instance_sha256);
    assert.equal(retained.responses_observed, result.responses_observed);
    assert.equal(new Set(retained.response_sha256).size, retained.responses_observed);
    assert.equal(retained.authorized_limits.configuration_sha256, shadowHash(f.configuration));
    assert.equal(retained.authorized_limits.global_deadline_ms, result.global_deadline_ms);
    assert.equal(retained.authorized_limits.workflow_deadline_ms, result.workflow_deadline_ms);
    assert.equal(retained.authorized_limits.max_responses, 6);
    assert.equal(retained.authorized_limits.max_bytes, 10 * 1024 * 1024);
    assert.equal(retained.resume_authority, "NOT_ESTABLISHED_SUPERVISOR_AND_AUTHENTICATED_JOURNAL_REQUIRED");
    assert.equal(JSON.stringify(retained).includes("developer_instructions"), false);
    return retained;
  }
  await check("checkpoint retains host-issued identities, contributions, results and observed accounting after closure", async () => {
    const f = fixture(), { result } = await run(f); assert.equal(result.status, "COMPLETED", JSON.stringify(result));
    const retained = checkpoint(f, result);
    assert.equal(retained.state.parent_closed, true); assert.equal(retained.state.resources.length, 2); assert.equal(retained.state.results.length, 3);
    assert.equal(retained.state.resources[0].executor.contributions.length, 2);
    assert.equal(retained.state.resources[1].executor.contributions.length, 0);
    assert.equal(retained.state.native_usage.thread_counters.length, 2);
    const missing = structuredClone(retained.state); missing.resources[0].executor.contributions = [];
    assert.throws(() => assertNativeHostState(missing), { code: "NATIVE_HOST_STATE_CONTRIBUTION_MISSING" });
  });
  await check("checkpoint preserves rejected results and writer lineage instead of manufacturing a successful resume", async () => {
    const f = fixture(), { result } = await run(f, { reject: true }); assert.equal(result.status, "FAILED");
    const retained = checkpoint(f, result);
    assert.equal(retained.state.results.at(-1).result.outcome, "rejected");
    assert.equal(retained.state.resources[0].executor.contributions.length, 2);
    assert.equal(inspectAgenticProcess(retained.state.instance).status, "FAILED");
  });
  await check("checkpoint retains a possible contributor after an interrupted native turn with no accepted result", async () => {
    const f = fixture(), { result } = await run(f, { foreignThread: true }); assert.equal(result.first_failure, "PROCESS_SESSION_FOREIGN_THREAD");
    const retained = checkpoint(f, result);
    assert.equal(retained.state.results.length, 0); assert.equal(retained.state.resources.length, 1);
    assert.equal(retained.state.resources[0].executor.contributions.length, 1);
    assert.equal(retained.state.instance.events.at(-1).kind, "assign");
    assert.equal(retained.state.native_usage.incomplete_turns_may_be_unknown, true);
  });
  await check("checkpoint refuses changed native evidence after closure instead of sealing a successful result", async () => {
    const f = fixture(), { result } = await run(f, { corruptEvidenceOnClose: true });
    assert.equal(result.status, "FAILED"); assert.equal(result.first_failure, "PROCESS_EXECUTION_EVIDENCE_CHANGED");
    assert.equal(result.native_checkpoint, null); assert.equal(result.responses_observed, 3);
  });
  await check("v2 native-only JSON executes real role ports and preserves exact replay without operation fallback", async () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path));
    model.contract_version = "agentic-process-model.v2"; model.operation_pins = {};
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const { result, sessions } = await run(f);
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(result.responses_observed, 3);
    assert.equal(sessions.length, 2); assert.equal(result.native_parent_closure.closed, true);
    const retained = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    assert.equal(retained.contract_version, "agentic-process-instance.v2"); assert.equal(retained.profile, "structured-agentic-process.v2");
    assert.equal(retained.events.filter(event => event.kind === "assign").length, 3);
    assert.equal(retained.events.filter(event => event.kind === "result").length, 3);
    const simulation = simulateAgenticProcess({ instanceId: retained.instance_id, model: retained.model, policyPins: retained.policy_pins,
      scopeId: retained.scope_id, events: retained.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, retained.instance_sha256);
  });
  await check("v2 native-only event wait closes resources and cannot restart its history as a pristine instance", async () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path)), originalEntry = model.entry;
    model.contract_version = "agentic-process-model.v2"; model.operation_pins = {}; model.entry = "with_wait";
    const activity = model.nodes.find(node => node.kind === "activity"), participant_ref = activity.participant_ref;
    model.nodes.push({ id: "with_wait", kind: "sequence", participant_ref, children: [originalEntry, "external_wait"] },
      { id: "external_wait", kind: "event", participant_ref, branches: [
        { flow_id: "review", node_id: "late_review", event_key: "review_snapshot" },
        { flow_id: "checks", node_id: "late_checks", event_key: "checks_snapshot" }] },
      { ...activity, id: "late_review" }, { ...activity, id: "late_checks" });
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const { result, sessions } = await run(f); assert.equal(result.status, "WAITING", JSON.stringify(result));
    assert.equal(result.responses_observed, 3); assert.equal(sessions.length, 2); assert.equal(result.native_parent_closure.closed, true);
    const retained = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    assert.equal(inspectAgenticProcess(retained).status, "WAITING");
    const t = transport(f);
    const reopened = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory });
    assert.equal(reopened.preview().written, false);
    await assert.rejects(reopened.run({ execute: true, authorization: f.authorize() }), /PROCESS_EXECUTION_EXISTING_INSTANCE_REQUIRES_RECONCILIATION/);
    assert.equal(t.sessions.length, 0);
  });
  await check("v2 native-only composition refuses raw control facts before startup", () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path)); model.contract_version = "agentic-process-model.v2"; model.operation_pins = {};
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const control = JSON.stringify({ contract_version: "agentic-process-control-scenario.v1", initial_facts: { approved: true }, events: [] });
    f.configuration.control_scenario = { path: put(f.base, "control.json", control), sha256: sha(control) };
    const t = transport(f);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory }), /PROCESS_EXECUTION_CONTROL_PROFILE_UNSUPPORTED/);
    assert.equal(t.sessions.length, 0); assert.deepEqual(fs.readdirSync(f.dirs.control), []);
  });
  await check("v2 native-only composition refuses raw control events before startup", () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path)); model.contract_version = "agentic-process-model.v2"; model.operation_pins = {};
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const control = JSON.stringify({ contract_version: "agentic-process-control-scenario.v1", initial_facts: {},
      events: [{ after_results: 0, event: { event_id: "raw-approval", kind: "facts", facts: { approved: true } } }] });
    f.configuration.control_scenario = { path: put(f.base, "control.json", control), sha256: sha(control) };
    const t = transport(f);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory }), /PROCESS_EXECUTION_CONTROL_PROFILE_UNSUPPORTED/);
    assert.equal(t.sessions.length, 0); assert.deepEqual(fs.readdirSync(f.dirs.control), []);
  });
  await check("native tool observations retain counts and hashes without commands, outputs, arguments or reasoning", () => {
    const observation = summarizeAgenticNativeToolItem({ type: "functionCallOutput", name: "exec", output: 'private-secret Process running with session ID 123' });
    assert.equal(observation.tool, "exec"); assert.equal(observation.poll_marker_observed, true);
    assert.equal(JSON.stringify(observation).includes("private-secret"), false);
    assert.equal(summarizeAgenticNativeToolItem({ type: "reasoning", content: ["private-secret"] }), null);
    assert.equal(summarizeAgenticNativeToolItem({ type: "dynamicToolCall", tool: { secret: "private-secret" }, arguments: { password: "private-secret" } }).tool, "other");
  });
  await check("broker replacement preserves bytes across distinct control/product roots and cleans failed atomic staging", () => {
    const base = fs.mkdtempSync(path.join(root, "broker-")), product = path.join(base, "product"), control = path.join(base, "control");
    fs.mkdirSync(product); fs.mkdirSync(control);
    const file = path.join(product, "app.mjs"), data = Buffer.from("export const value = 2;\n"); fs.writeFileSync(file, data);
    republishBrokerProductFile(file, data, { fsPort: { ...fs, renameSync(from, to) {
      if (path.dirname(from) !== path.dirname(to)) throw Object.assign(Error("cross-volume"), { code: "EXDEV" });
      fs.renameSync(from, to);
    } } });
    assert.deepEqual(fs.readFileSync(file), data); assert.deepEqual(fs.readdirSync(product), ["app.mjs"]);
    for (const code of ["EXDEV", "EACCES"]) {
      assert.throws(() => republishBrokerProductFile(file, Buffer.from("replacement"), { fsPort: { ...fs, renameSync() { throw Object.assign(Error("private path must not escape"), { code }); } } }),
        error => error.code === "PROCESS_EXECUTION_BROKER_REPUBLISH_FAILED" && error.fs_code === code && /^[a-f0-9]{64}$/.test(error.path_sha256) && !error.message.includes("private"));
      assert.deepEqual(fs.readFileSync(file), data); assert.deepEqual(fs.readdirSync(product), ["app.mjs"]);
    }
  });
  await check("explicit pinned host scenario drives XML event, two loop iterations, collections and calls without model polling", async () => {
    const f = fixture(), example = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
    example.policies[0].allowed_permissions.push("write:product");
    const model = compileBpmnProcess({ xml: fs.readFileSync(new URL("../../tests/fixtures/agentic-process/extended-delivery.bpmn", import.meta.url), "utf8"),
      modelId: "native-control-fixture", revision: 1, participantId: "delivery", roles: example.roles, policies: example.policies,
      processRef: "ExtendedDelivery" }).model;
    const modelPath = put(f.base, "extended-model.json", JSON.stringify(model));
    f.configuration.model = { path: modelPath, sha256: sha(fs.readFileSync(modelPath)) };
    f.configuration.instructions = Object.fromEntries(model.nodes.filter(n => n.kind === "activity").map(n => [n.id, n.policy_ref === "review" ? "Review without correcting the work." : "Change value to 2."]));
    const initial = createAgenticProcess({ instanceId: "case", model, scopeId: "fixture", policyPins: agenticPolicyPins(model), facts: { refinement_done: false } });
    const wait = inspectAgenticProcess(initial).occurrences.find(row => row.wait_reason === "event");
    const scenario = { contract_version: "agentic-process-control-scenario.v1", initial_facts: { refinement_done: false }, events: [
      { after_results: 0, event: { event_id: "host-message", kind: "message", occurrence_id: wait.occurrence_id, correlation_id: wait.correlation_id, event_key: "approved" } },
      { after_results: 2, event: { event_id: "host-facts", kind: "facts", facts: { refinement_done: true } } }] };
    assertAgenticControlScenario(scenario);
    for (const invalid of [{ ...scenario, events: [...scenario.events].reverse() },
      { ...scenario, events: [{ after_results: 0, event: { event_id: "spoof", kind: "assign" } }] }]) {
      assert.throws(() => assertAgenticControlScenario(invalid), /PROCESS_CONTROL_SCENARIO_INVALID/);
    }
    const scenarioPath = put(f.base, "control-scenario.json", JSON.stringify(scenario));
    f.configuration.control_scenario = { path: scenarioPath, sha256: sha(fs.readFileSync(scenarioPath)) };
    const t = transport(f), auth = { ...f.authorize(), max_responses: 20, global_deadline_ms: Date.now() + 120000, workflow_deadline_ms: Date.now() + 110000 };
    const composition = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory });
    assert.equal(composition.preview().written, false); assert.equal(t.sessions.length, 0);
    const result = await composition.run({ execute: true, authorization: auth });
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(result.responses_observed, 10);
    assert.equal(result.control_scenario.events_applied, 2); assert.deepEqual(t.sessions.map(s => s.turns), [9, 1]);
    const retained = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    assert.equal(retained.events.filter(e => e.kind === "message").length, 1);
    assert.equal(retained.events.filter(e => e.kind === "facts").length, 1);
    assert.equal(retained.events.filter(e => e.kind === "result").length, 10);
    assert.equal(t.sessions.every(s => s.closed), true);
    fs.appendFileSync(scenarioPath, " ");
    assert.throws(() => composition.preview(), /PROCESS_EXECUTION_INPUT_CHANGED/);
  });
  await check("Windows root-read requirement retains explicit private, author and home denials", () => {
    const original = path.join(root, "profile-project"), product = path.join(original, "app"), slash = p => p.replaceAll("\\", "/");
    put(product, "server.mjs", "// private original\n"); put(product, "tmp/input.txt", "temporary original\n"); put(original, "metadata/common.md", "original metadata\n");
    const profile = buildAgenticNativePermissionProfile({ platform: "win32",
      native: { home: "C:\\Users\\fixture\\.codex", tool_roots: ["C:\\Windows", "G:\\cohort\\runtime"], protected_roots: ["G:\\cohort\\old-author-control"] },
      targetRoot: original, productRoot: product, controlRoot: "G:\\cohort\\control", cwd: "G:\\cohort\\review\\snapshot", writable: false, review: true });
    assert.equal(profile.filesystem[":root"], "read"); assert.equal(profile.filesystem["G:/"], undefined);
    assert.equal(profile.filesystem["C:/Users"], undefined); assert.equal(profile.filesystem["C:/Users/fixture/.codex"], "deny");
    assert.equal(profile.filesystem["G:/cohort/old-author-control"], "deny");
    assert.equal(profile.filesystem[slash(original)], undefined); assert.equal(profile.filesystem["G:/cohort/control"], "deny");
    assert.equal(profile.filesystem[slash(product)], "deny");
    assert.equal(profile.filesystem[slash(path.join(product, "server.mjs"))], undefined);
    assert.equal(profile.filesystem[slash(path.join(original, "metadata"))], "deny");
    assert.equal(profile.filesystem["G:/cohort/review/snapshot"], "read"); assert.equal(profile.filesystem["G:/cohort/runtime"], "read");
    assert.equal(profile.network.enabled, false);
  });
  await check("typed native permission null defaults normalize without discarding unexpected permissions", () => {
    const expected = { extends: ":workspace", filesystem: { ":root": "deny", ":minimal": "read" }, network: { enabled: false } };
    const native = { ...expected, description: null, workspace_roots: null,
      filesystem: { ...expected.filesystem, glob_scan_max_depth: null },
      network: { ...expected.network, proxy_url: null, enable_socks5: null, socks_url: null, enable_socks5_udp: null,
        allow_upstream_proxy: null, dangerously_allow_non_loopback_proxy: null, dangerously_allow_all_unix_sockets: null,
        mode: null, domains: null, unix_sockets: null, allow_local_binding: null, mitm: null } };
    assert.deepEqual(normalizePermissionProfile(native), expected);
    assert.notDeepEqual(normalizePermissionProfile({ ...native, unknown_policy: null }), expected);
    assert.notDeepEqual(normalizePermissionProfile({ ...native, network: { ...native.network, proxy_url: "http://foreign.invalid" } }), expected);
    assert.notDeepEqual(normalizePermissionProfile({ ...native, filesystem: { ...native.filesystem, ":root": "write" } }), expected);
  });
  await check("project preview performs no writes or native startup; explicit pinned authorization required", async () => {
    const f = fixture(), before = fs.readdirSync(f.dirs.control), t = transport(f);
    const service = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory });
    assert.equal(service.preview().written, false); assert.deepEqual(fs.readdirSync(f.dirs.control), before); assert.equal(t.sessions.length, 0);
    await assert.rejects(() => service.run({ execute: true, authorization: {} }), /EXPLICIT_AUTHORIZATION_REQUIRED/);
    assert.equal(t.sessions.length, 0);
  });
  await check("native-only composition refuses the operation profile before native allocation", () => {
    const f = fixture(), model = { contract_version: "agentic-process-model.v2", model_id: "operations", revision: 1, participants: [{ id: "project" }], roles: [], policies: [],
      entry: "reload", operation_pins: { reload: "a".repeat(64) }, nodes: [{ id: "reload", kind: "operation", participant_ref: "project", binding_ref: "reload" }] };
    const text = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, text); f.configuration.model.sha256 = sha(text);
    const t = transport(f);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory }), /PROCESS_EXECUTION_MODEL_PROFILE_UNSUPPORTED/);
    assert.equal(t.sessions.length, 0); assert.deepEqual(fs.readdirSync(f.dirs.control), []);
  });
  await check("actual internal CLI preview and fixed worker EOF path stay offline and reject unauthenticated execution", () => {
    const f = fixture(), text = JSON.stringify(f.configuration), file = put(f.base, "configuration.json", text);
    const runner = fileURLToPath(new URL("../runtime/run-agentic-process.mjs", import.meta.url));
    const command = spawnSync(process.execPath, [runner, "--preview", "--configuration", file, "--configuration-sha256", sha(text)],
      { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(command.status, 0, command.stderr); assert.equal(JSON.parse(command.stdout).native_started, false);
    const publicCli = fileURLToPath(new URL("../../bin/aidn.mjs", import.meta.url));
    const ordinary = spawnSync(process.execPath, [publicCli, "runtime", "workflow-run", "--target", f.configuration.target_root,
      "--configuration", file, "--json"], { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(ordinary.status, 0, ordinary.stderr + ordinary.stdout);
    const selected = JSON.parse(ordinary.stdout);
    assert.equal(selected.engine, "agentic"); assert.equal(selected.preview.native_started, false); assert.equal(selected.written, false);
    assert.deepEqual(fs.readdirSync(f.dirs.control), []);
    const worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
    const refused = spawnSync(process.execPath, [worker], { input: JSON.stringify({ configuration: f.configuration, authorization: {} }),
      encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(refused.status, 1); assert.equal(JSON.parse(refused.stdout).first_failure, "PROCESS_EXECUTION_EXPLICIT_AUTHORIZATION_REQUIRED");
    assert.match(refused.stderr, /PROCESS_EXECUTION_EXPLICIT_AUTHORIZATION_REQUIRED/);
    assert.deepEqual(fs.readdirSync(f.dirs.control), []);
  });
  await check("abort during pre-turn observation and exhausted deadline prohibit turn/start", async () => {
    for (const expired of [false, true]) {
      const f = fixture(), controller = new AbortController(); let armed = false;
      const t = transport(f, { onConfigRead() { if (armed && !expired) controller.abort(); } });
      const model = JSON.parse(fs.readFileSync(f.configuration.model.path));
      const sessions = createAgenticCodexSessions({ native: f.configuration.native, targetRoot: f.configuration.target_root,
        productRoot: f.dirs.product, controlRoot: path.join(f.dirs.control, "case"), rpcFactory: t.rpcFactory,
        evidence: { async retain() { return { ref: "fixture/native", sha256: "a".repeat(64) }; }, diagnostic() {} },
        budget: { maxTurnMs: 1000, remainingBytes: () => 1000000, response() {} } });
      try {
        const session = await sessions.open({ role: model.roles[0], policy: model.policies.find(row => row.id === "work"),
          input: { developer_instructions: "Common fixture authority." }, deadline: Date.now() + (expired ? -1 : 60000) });
        armed = true;
        await assert.rejects(() => session.run({ instruction: "Never start this turn.", request_sha256: "b".repeat(64), signal: controller.signal }),
          expired ? /PROCESS_SESSION_DEADLINE/ : /PROCESS_SESSION_BUSY_OR_CANCELLED/);
        assert.equal(t.calls.filter(row => row.method === "turn/start").length, 0);
      } finally { assert.equal((await sessions.close()).closed, true); }
    }
  });
  await check("worker private before-turn authority runs after awaited native observation and refuses a paid turn", async () => {
    for (const fault of ["nominal", "revoked", "expired"]) {
      const f = fixture(); let observed = false, checked = false;
      const t = transport(f, { onConfigRead() { observed = true; } }), model = JSON.parse(fs.readFileSync(f.configuration.model.path));
      const sessions = createAgenticCodexSessions({ native: f.configuration.native, targetRoot: f.configuration.target_root,
        productRoot: f.dirs.product, controlRoot: path.join(f.dirs.control, "case"), rpcFactory: t.rpcFactory,
        evidence: { async retain() { return { ref: "fixture/native", sha256: "a".repeat(64) }; }, diagnostic() {} },
        budget: { maxTurnMs: 1000, remainingBytes: () => 1000000, response() {} } });
      try {
        const session = await sessions.open({ role: model.roles[0], policy: model.policies.find(row => row.id === "work"),
          input: { developer_instructions: "Common fixture authority." }, deadline: Date.now() + 60000 });
        observed = false;
        const execute = () => session.run({ instruction: "Fixture bounded turn.", request_sha256: "b".repeat(64), async beforeTurn() {
          assert.equal(observed, true); checked = true; await new Promise(resolve => setImmediate(resolve));
          if (fault !== "nominal") throw Object.assign(Error(), { code: fault === "revoked" ? "PROCESS_HUMAN_NOT_AUTHENTICATED" : "STANDARD_DRIFT_DIAGNOSIS_REQUEST_EXPIRED" });
        } });
        if (fault === "nominal") await execute(); else await assert.rejects(execute());
        assert.equal(checked, true); assert.equal(t.calls.filter(row => row.method === "turn/start").length, fault === "nominal" ? 1 : 0);
      } finally { assert.equal((await sessions.close()).closed, true); }
    }
  });
  await check("pre-aborted composition retains cancellation without canonical initialization or native allocation", async () => {
    const f = fixture(), { result, sessions, calls } = await run(f, { signal: AbortSignal.abort() });
    assert.equal(result.first_failure, "PROCESS_EXECUTION_CANCELLED"); assert.equal(result.status, "FAILED");
    assert.equal(result.responses_observed, 0); assert.equal(sessions.length, 0); assert.equal(calls.length, 0);
    assert.equal(result.instance_sha256, null);
  });
  await check("live metadata disappearance is zero retained bytes; permission errors and missing required roots still stop", async () => {
    for (const mode of ["child-ENOENT", "child-EACCES", "root-ENOENT"]) {
      const f = fixture(), output = path.join(f.dirs.control, "case"), transient = path.join(output, "transient.tmp"), original = fs.lstatSync;
      let injected = false;
      fs.lstatSync = function(file, ...args) {
        if (!injected && file === (mode === "root-ENOENT" ? output : transient) && fs.existsSync(transient)) {
          injected = true;
          if (mode === "child-ENOENT") fs.unlinkSync(transient);
          throw Object.assign(Error("fixture metadata race"), { code: mode.endsWith("EACCES") ? "EACCES" : "ENOENT" });
        }
        return original.call(this, file, ...args);
      };
      try {
        const { result } = await run(f, { transientStorage: true }); assert.equal(injected, true);
        if (mode === "child-ENOENT") {
          assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(result.responses_observed, 3);
          assert.ok(result.storage_observation.vanished_entries >= 1); assert.equal(result.storage_observation.first_read_failure, null);
        } else {
          assert.equal(result.first_failure, "PROCESS_EXECUTION_STORAGE_UNVERIFIABLE"); assert.equal(result.status, "FAILED");
          const diagnostic = result.storage_observation.first_read_failure;
          assert.equal(diagnostic.error_code, mode.endsWith("EACCES") ? "EACCES" : "ENOENT");
          assert.equal(diagnostic.operation, "lstatSync"); assert.equal(diagnostic.entry_sha256, sha(Buffer.from(mode === "root-ENOENT" ? output : transient)));
          assert.ok(Number.isSafeInteger(diagnostic.observed_at_ms)); assert.equal(Object.hasOwn(diagnostic, "path"), false);
          assert.equal(result.responses_observed, 1); assert.equal(result.consumption.thread_counters.length, 1);
        }
        assert.equal(result.native_parent_closure.closed, true);
      } finally { fs.lstatSync = original; }
    }
  });
  await check("unverifiable storage retains first failure, known usage and explicit unknown bytes on stdout", async () => {
    const { result } = await run(fixture(), { unverifiableStorage: true });
    assert.equal(result.first_failure, "PROCESS_EXECUTION_STORAGE_SYMLINK"); assert.equal(result.status, "FAILED");
    assert.equal(result.responses_observed, 1); assert.equal(result.consumption.thread_counters.length, 1);
    assert.equal(result.native_parent_closure.closed, true); assert.equal(result.bytes_retained, null);
    assert.equal(result.storage_budget_debit_bytes, null); assert.equal(result.seal, "STDOUT_ONLY_STORAGE_UNVERIFIABLE");
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
  });
  await check("failed footer write preserves the structured result and an earlier cancellation", async () => {
    for (const cancelled of [false, true]) {
      const f = fixture(), original = fs.writeFileSync;
      fs.writeFileSync = function(file, ...args) {
        if (file === path.join(f.dirs.control, "case/RESULT.json")) throw Object.assign(Error("fixture full disk"), { code: "ENOSPC" });
        return original.call(this, file, ...args);
      };
      try {
        const { result } = await run(f, cancelled ? { signal: AbortSignal.abort() } : {});
        assert.equal(result.first_failure, cancelled ? "PROCESS_EXECUTION_CANCELLED" : "PROCESS_EXECUTION_SEAL_WRITE_FAILED");
        assert.equal(result.status, "FAILED"); assert.equal(result.seal, "STDOUT_ONLY_WRITE_FAILED");
        assert.equal(result.native_parent_closure.closed, true); assert.ok(result.bytes_retained >= 0);
        if (!cancelled) { assert.equal(result.responses_observed, 3); assert.equal(result.consumption.thread_counters.length, 2); }
        assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
      } finally { fs.writeFileSync = original; }
    }
  });
  await check("default JSON creation enters the actual production host without replacing its pristine checkpoint", async () => {
    const f = fixture(), model = JSON.parse(fs.readFileSync(f.configuration.model.path));
    const service = createProjectWorkflowInstanceService({ targetRoot: f.configuration.target_root });
    const initial = service.initialize({ instanceId: f.configuration.instance_id, model, write: true });
    assert.equal(initial.record.events.length, 0);
    const { result, sessions } = await run(f);
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(sessions.length, 2);
    assert.equal(service.inspect(f.configuration.instance_id).cursor.status, "COMPLETED");
  });
  await check("real composition: same session across compatible roles; distinct independent reviewer and canonical results", async () => {
    const f = fixture(), { result, sessions } = await run(f);
    assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map(session => session.turns), [2, 1]); assert.equal(result.responses_observed, 3);
    const receipts = fs.readdirSync(path.join(f.dirs.control, "case")).filter(name => name.endsWith("-native-result.json"))
      .map(name => JSON.parse(fs.readFileSync(path.join(f.dirs.control, "case", name))));
    assert.equal(receipts.length, 3);
    assert(receipts.every(row => row.exchanges.native_responses === 1 && row.exchanges.observed_tool_items === 1));
    const observations = fs.readdirSync(path.join(f.dirs.control, "case")).filter(name => name.endsWith("-native-tool.json"))
      .map(name => fs.readFileSync(path.join(f.dirs.control, "case", name), "utf8"));
    assert.equal(observations.length, 3); assert(observations.every(text => !text.includes("private command/output")));
    assert.notEqual(sessions[0].configuration.cwd, sessions[1].configuration.cwd);
    assert.equal(fs.readFileSync(path.join(sessions[1].configuration.cwd, "app.mjs"), "utf8"), "export const value = 2;\n");
    const state = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    const assignments = state.events.filter(row => row.kind === "assign");
    assert.equal(assignments[0].decision.execution_id, assignments[1].decision.execution_id);
    assert.notEqual(assignments[1].decision.lineage_id, assignments[2].decision.lineage_id);
    assert.equal(state.events.filter(row => row.kind === "result").length, 3);
    const next = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: () => { throw Error("must not restart"); } });
    await assert.rejects(() => next.run({ execute: true, authorization: f.authorize() }), /EXISTING_INSTANCE_REQUIRES_RECONCILIATION/);
  });
  for (const backend of ["sqlite", "postgres"]) for (const mode of ["files", "dual", "db-only"])
    await check(`configured ${backend}/${mode}: real canonical CAS, review and projection contract`, async () => {
      const f = fixture(); persistenceFixture(f, backend, mode);
      const { result, sessions } = await run(f);
      assert.equal(result.status, "COMPLETED", JSON.stringify(result)); assert.equal(result.persistence.backend, backend);
      assert.deepEqual(sessions.map(session => session.turns), [2, 1]);
      assert.equal(sessions[0].configuration.env.AIDN_TEST_DB, backend === "postgres" ? f.environment.AIDN_TEST_DB : undefined);
      assert.equal(sessions[1].configuration.env.AIDN_TEST_DB, undefined);
      assert.equal(createCodexHostEnvironment(sessions[0].configuration.env).AIDN_TEST_DB, undefined);
      const store = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: mode, env: f.environment,
        ...(f.artifactStoreFactory ? { artifactStoreFactory: f.artifactStoreFactory } : {}) });
      const state = store.read("case"); assert.equal(state.record.events.filter(row => row.kind === "result").length, 3);
      assert.throws(() => store.compareAndSwap(state.record, "a".repeat(64)), /REVISION_CONFLICT/);
      const visible = path.join(f.configuration.target_root, "docs/audit/workflows/process-instances/case.json");
      assert.equal(fs.existsSync(visible), mode !== "db-only");
      if (backend === "postgres") {
        assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite")), false);
        const pg = JSON.parse(fs.readFileSync(f.pgState));
        assert.ok(pg.queries.some(sql => sql === "ROLLBACK")); assert.ok(pg.queries.some(sql => sql.includes("pg_advisory_xact_lock")));
        assert.equal(pg.queries.some(sql => /CREATE |ALTER |DROP |DELETE /i.test(sql)), false);
        assert.ok(result.persistence.canonical_payload_bytes_acknowledged > 0); assert.equal(result.persistence.server_physical_bytes, "NON_MESURE");
        assert.doesNotMatch(JSON.stringify(result), /fixture:fixture|never-connected/);
      }
    });
  await check("PostgreSQL outage refuses before native startup and never creates a SQLite fallback", async () => {
    const f = fixture(); persistenceFixture(f, "postgres", "files"); mutatePg(f, { unavailable: true });
    const t = transport(f), execution = createProjectAgenticProcessExecution(f.configuration,
      { rpcFactory: t.rpcFactory, artifactStoreFactory: f.artifactStoreFactory, environment: f.environment });
    assert.equal(execution.preview().persistence.backend, "postgres");
    await assert.rejects(() => execution.run({ execute: true, authorization: f.authorize() }), /ARTIFACT_POSTGRES_WORKER_UNAVAILABLE/);
    assert.equal(t.sessions.length, 0); assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite")), false);
  });
  for (const [options, reason] of [[{ reserved: true }, "ARTIFACT_EXECUTION_SCOPE_RESERVED"], [{ failBlob: true }, "ARTIFACT_POSTGRES_COMMAND_FAILED"],
    [{ failReadAfterWrite: true }, "PROCESS_EXECUTION_PROJECTION_RECONCILIATION_REQUIRED"]])
    await check("PostgreSQL canonical refusal retained before model: " + reason, async () => {
      const f = fixture(); persistenceFixture(f, "postgres", "dual"); mutatePg(f, options);
      const { result, sessions } = await run(f); assert.equal(result.status, "FAILED"); assert.equal(result.first_failure, reason, JSON.stringify(result));
      assert.equal(sessions.length, 0);
      const pg = JSON.parse(fs.readFileSync(f.pgState));
      assert.equal(pg.tables.artifacts.length, options.failReadAfterWrite ? 1 : 0);
      assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite")), false);
    });
  await check("changing a PostgreSQL project to SQLite during execution stops rather than accepting a foreign backend", async () => {
    const f = fixture(); persistenceFixture(f, "postgres", "db-only"); const { result } = await run(f, { backendDrift: true });
    assert.equal(result.status, "FAILED"); assert.equal(result.first_failure, "WORKFLOW_INSTANCE_PERSISTENCE_CHANGED");
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/index/workflow-index.sqlite")), false);
  });
  await check("bulk projection cannot overwrite or omit process checkpoints on either backend", () => {
    for (const directory of ["instances", "definitions", "process-instances"]) {
      const row = { path: `workflows/${directory}/case.json`, content_format: "utf8", content: "canonical" };
      assert.doesNotThrow(() => assertWorkflowRecordProjection([row], [row]));
      assert.throws(() => assertWorkflowRecordProjection([row], [{ ...row, content: "stale" }]), /PROJECTION_CONFLICT/);
      assert.throws(() => assertWorkflowRecordProjection([row], []), /PROJECTION_CONFLICT/);
    }
  });
  await check("actual PostgreSQL bulk projection path protects canonical process instances before row replacement", async () => {
    const f = fixture(), fake = createRuntimePersistenceFakePgClientFactory();
    const store = createPostgresRuntimeArtifactStore({ targetRoot: f.configuration.target_root,
      connectionString: "postgres://fixture:fixture@localhost/never-connected", clientFactory: fake.factory });
    const row = { path: "workflows/process-instances/case.json", content_format: "utf8", content: "canonical process checkpoint", kind: "agentic_process_instance" };
    const payload = { schema_version: 2, generated_at: "2030-01-01T00:00:00Z", cycles: [], sessions: [], artifacts: [row] };
    await store.writeIndexProjection({ payload });
    await assert.rejects(store.writeIndexProjection({ payload: { ...payload, artifacts: [{ ...row, content: "stale projection" }] } }), /PROJECTION_CONFLICT/);
    await assert.rejects(store.writeIndexProjection({ payload: { ...payload, artifacts: [] } }), /PROJECTION_CONFLICT/);
    assert.ok(fake.state.queryLog.some(query => query.sql.includes("path LIKE 'workflows/process-instances/%'")));
  });
  await check("SQLite local lock refusal does not promote it to PostgreSQL or replay an abandoned writer", async () => {
    const f = fixture(); persistenceFixture(f, "sqlite", "files");
    put(f.configuration.target_root, "docs/audit/workflows/process-instances/case.json.lock", "retained lock, owner unknown");
    const { result, sessions } = await run(f);
    assert.equal(result.first_failure, "WORKFLOW_INSTANCE_LOCK_RECONCILIATION_REQUIRED"); assert.equal(sessions.length, 0);
  });
  await check("only trusted runtime/admission hosts receive PostgreSQL credentials; no model shell, review, pins or configuration contain them", async () => {
    const f = fixture(); persistenceFixture(f, "postgres", "db-only");
    const env = { ...f.environment, PGPASSWORD: "fixture-password", PGSSLMODE: "require", NODE_OPTIONS: "--bad-injection" };
    const pin = agenticProcessPersistence({ targetRoot: f.configuration.target_root, env });
    const workerEnv = createAgenticProcessWorkerEnvironment({ targetRoot: f.configuration.target_root, expectedBinding: pin.binding_sha256, env });
    assert.equal(workerEnv.AIDN_TEST_DB, env.AIDN_TEST_DB); assert.equal(workerEnv.PGPASSWORD, "fixture-password");
    assert.equal(workerEnv.PGSSLMODE, "require"); assert.equal(workerEnv.NODE_OPTIONS, undefined);
    assert.equal(createCodexHostEnvironment(workerEnv).AIDN_TEST_DB, undefined); assert.equal(createCodexHostEnvironment(workerEnv).PGPASSWORD, undefined);
    assert.doesNotMatch(JSON.stringify(pin), /fixture-password|fixture:fixture/);
    assert.throws(() => createAgenticProcessWorkerEnvironment({ targetRoot: f.configuration.target_root, expectedBinding: "a".repeat(64), env }), /PERSISTENCE_CHANGED/);
    assert.throws(() => createAgenticProcessWorkerEnvironment({ targetRoot: f.configuration.target_root, expectedBinding: pin.binding_sha256,
      env: { ...env, AIDN_TEST_DB: "" } }), /CONNECTION_UNAVAILABLE/);
    const worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
    f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)),
      helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
    const authorization = f.authorize(); let captured;
    await runOwnedAgenticProcess({ configuration: f.configuration, authorization, execute: true }, { environment: env, controllerFactory: () => ({
      async checkAvailability() { return { available: true }; },
      async run(request, { onEvent }) {
        captured = request; assert.equal(request.env.AIDN_TEST_DB, env.AIDN_TEST_DB); assert.equal(request.env.NODE_OPTIONS, undefined);
        assert.doesNotMatch(request.stdin, /fixture-password|fixture:fixture/);
        const spec = JSON.parse(request.stdin); assert.equal(spec.persistenceBinding, pin.binding_sha256);
        await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify({ contract_version: "agentic-process-execution-result.v1", status: "COMPLETED",
          first_failure: null, global_deadline_ms: spec.authorization.global_deadline_ms })) });
        return { outcome: "completed", termination_state: "confirmed", termination_proof: { active_processes: 0 } };
      },
    }) });
    assert.ok(captured);
    let invoked = false;
    const expired = createProjectArtifactStore({ targetRoot: f.configuration.target_root, env, deadlineMs: Date.now() - 1,
      workerRunner() { invoked = true; throw Error("must not execute"); } });
    assert.throws(() => expired.getArtifact("workflows/process-instances/case.json"), /DEADLINE_EXCEEDED/); assert.equal(invoked, false);
  });
  for (const [name, options, reason] of [
    ["foreign thread", { foreignThread: true }, "PROCESS_SESSION_FOREIGN_THREAD"],
    ["foreign turn", { foreignTurn: true }, "PROCESS_SESSION_FOREIGN_TURN"],
    ["missing usage", { noUsage: true }, "PROCESS_SESSION_CAPTURE_INCOMPLETE"],
    ["changed profile", { badProfile: true }, "PROCESS_SESSION_EFFECTIVE_PROFILE_CHANGED"],
    ["unavailable sandbox refuses provisioning", { backendMissing: true }, "PROCESS_SESSION_SANDBOX_NOT_PREEXISTING"],
    ["profile forbidden by managed requirements", { profileDenied: true }, "PROCESS_SESSION_PERMISSION_PROFILE_UNAVAILABLE"],
    ["unexpected native hooks", { foreignHook: true }, "PROCESS_SESSION_HOOKS_CHANGED"],
    ["assignment cannot replace native pre-write admission", { noAdmission: true }, "PROCESS_SESSION_ADMISSION_HOOKS_REQUIRED"],
    ["corrected reviewed artifact", { mutateReview: true }, "PROCESS_BINDING_UNAVAILABLE"],
    ["mutated read-only review snapshot", { mutateSnapshot: true }, "PROCESS_BINDING_UNAVAILABLE"],
    ["revoked activation", { revoke: true }, "PROCESS_AUTHORITY_UNAVAILABLE"],
    ["unconfirmed direct-child closure", { closeFailure: true }, "PROCESS_HOST_CLOSE_UNCONFIRMED"],
    ["response cap prohibits the next activity", { maxResponses: 1 }, "PROCESS_EXECUTION_RESPONSE_LIMIT"],
    ["per-turn timeout", { silence: true }, "PROCESS_SESSION_DEADLINE"],
  ]) await check("stop without retry and retain partial: " + name, async () => {
    const { result, sessions } = await run(fixture(), options);
    assert.equal(result.status, "FAILED"); assert.equal(result.first_failure, reason, JSON.stringify(result));
    assert.ok(sessions.length <= 2); assert.equal(result.retry, false);
  });
  await check("authenticated rejection remains terminal failure, never replaced by a favorable retry", async () => {
    const f = fixture(), { result } = await run(f, { reject: true }); assert.equal(result.status, "FAILED");
    const state = createAgenticProcessStore({ targetRoot: f.configuration.target_root, stateMode: "files" }).read("case").record;
    assert.equal(state.events.at(-1).result.outcome, "rejected"); assert.equal(result.responses_observed, 3);
  });
  await check("unexpected native storage overflow preserves first reason and structured stdout partial instead of masking it with seal failure", async () => {
    const { result } = await run(fixture(), { storage: true });
    assert.equal(result.first_failure, "PROCESS_EXECUTION_STORAGE_LIMIT");
    assert.equal(result.seal, "STDOUT_ONLY_STORAGE_LIMIT"); assert.ok(result.bytes_retained > 10 * 1024 * 1024);
    assert.equal(result.consumption.thread_counters.length, 1);
  });
  await check("pinned criteria and physical tool roots cannot silently change", () => {
    const f = fixture(); put(f.base, "criteria.md", "weaker criteria");
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration), /INPUT_CHANGED/);
    const other = fixture(); other.configuration.native.tool_roots.push(other.base);
    assert.throws(() => createProjectAgenticProcessExecution(other.configuration), /TOOL_ROOT_OVERLAP/);
  });
  await check("expired budgets and altered implementation pins refuse before native allocation", async () => {
    const f = fixture(), t = transport(f), service = createProjectAgenticProcessExecution(f.configuration, { rpcFactory: t.rpcFactory });
    const auth = f.authorize(); auth.global_deadline_ms = auth.authorized_at_ms - 1;
    await assert.rejects(() => service.run({ execute: true, authorization: auth }), /EXPLICIT_AUTHORIZATION_REQUIRED/);
    assert.equal(t.sessions.length, 0);
    f.configuration.implementation_sha256 = "a".repeat(64);
    assert.throws(() => createProjectAgenticProcessExecution(f.configuration), /IMPLEMENTATION_CHANGED/);
  });
  await check("owned reservation cannot spend the closure reserve and still launch a worker", async () => {
    const f = fixture(), worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
    f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)),
      helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
    const originalDate = Date.now, descriptor = Object.getOwnPropertyDescriptor(performance, "now"), originalMono = performance.now.bind(performance);
    let offset = 0, launched = false, reserved = false;
    try {
      Date.now = () => originalDate() + offset;
      Object.defineProperty(performance, "now", { configurable: true, value: () => originalMono() + offset });
      await assert.rejects(runOwnedAgenticProcess({ configuration: f.configuration, authorization: f.authorize(), execute: true }, {
        controllerFactory: () => ({ async checkAvailability() { return { available: true }; }, async run() { launched = true; throw Error("must not launch"); } }),
        allocationObserver: { beforeLaunch() { reserved = true; offset = 45000; return { generation: 1 }; }, afterClosure() { throw Error("no closure exists"); } },
      }), /CLOSURE_RESERVE/);
      assert.equal(reserved, true); assert.equal(launched, false);
    } finally { Date.now = originalDate; if (descriptor) Object.defineProperty(performance, "now", descriptor); else delete performance.now; }
  });
  await check("owned entry transmits the original deadline and requires process-tree termination proof", async () => {
    for (const confirmed of [true, false]) {
      const f = fixture(), worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
      f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)), helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
      const auth = f.authorize(); auth.authorized_at_ms -= 12000; let sent;
      const result = await runOwnedAgenticProcess({ configuration: f.configuration, authorization: auth, execute: true }, { controllerFactory: () => ({
        async checkAvailability() { return { available: true }; },
        async run(request, { onEvent }) { sent = JSON.parse(request.stdin); assert.ok(request.maxDurationMs <= auth.global_deadline_ms - Date.now());
          await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify({ contract_version: "agentic-process-execution-result.v1", status: "COMPLETED", first_failure: null, storage_budget_debit_bytes: 0, global_deadline_ms: sent.authorization.global_deadline_ms })) });
          return { outcome: "completed", termination_state: confirmed ? "confirmed" : "unknown", termination_proof: confirmed ? { active_processes: 0 } : null }; },
      }) });
      assert.equal(sent.authorization.global_deadline_ms, auth.global_deadline_ms);
      assert.equal(result.first_failure, confirmed ? null : "PROCESS_EXECUTION_TREE_CLOSE_UNCONFIRMED");
      assert.ok(result.elapsed_global_ms >= 12000);
    }
  });
  await check("owned footer preserves stdout-only worker results, unknown bytes and closure write failures", async () => {
    for (const mode of ["STDOUT_ONLY_STORAGE_LIMIT", "STDOUT_ONLY_STORAGE_UNVERIFIABLE", "STDOUT_ONLY_WRITE_FAILED", "outer-write-failure", "outer-first-failure", "unknown-bytes", "outer-stat-failure"]) {
      const f = fixture(), worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
      f.configuration.controller = { node_sha256: sha(fs.readFileSync(process.execPath)), worker_sha256: sha(fs.readFileSync(worker)), helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
      const auth = f.authorize(), originalWrite = fs.writeFileSync, originalExists = fs.existsSync;
      let closureWrites = 0;
      fs.writeFileSync = function(file, ...args) {
        if (file === path.join(f.dirs.control, "case-CLOSURE.json")) { closureWrites++; throw Object.assign(Error("fixture full disk"), { code: "ENOSPC" }); }
        return originalWrite.call(this, file, ...args);
      };
      fs.existsSync = function(file) {
        if (mode === "outer-stat-failure" && file === path.join(f.dirs.control, "case/RESULT.json")) throw Object.assign(Error("fixture unreadable"), { code: "EACCES" });
        return originalExists.call(this, file);
      };
      try {
        const prior = mode === "outer-first-failure" ? null : "PROCESS_EXECUTION_CANCELLED";
        const payload = { contract_version: "agentic-process-execution-result.v1", status: prior ? "FAILED" : "COMPLETED", first_failure: prior,
          global_deadline_ms: auth.global_deadline_ms, storage_budget_debit_bytes: mode === "unknown-bytes" || mode === "STDOUT_ONLY_STORAGE_UNVERIFIABLE" ? null : 100,
          responses_observed: 1, consumption: { observed_tokens: 42 }, ...(mode.startsWith("STDOUT_ONLY") ? { seal: mode } : {}) };
        const result = await runOwnedAgenticProcess({ configuration: f.configuration, authorization: auth, execute: true }, { controllerFactory: () => ({
          async checkAvailability() { return { available: true }; },
          async run(request, { onEvent }) { await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(payload)) });
            return { outcome: "completed", termination_state: "confirmed", termination_proof: { active_processes: 0 } }; },
        }) });
        assert.equal(result.first_failure, prior ?? "PROCESS_EXECUTION_SEAL_WRITE_FAILED"); assert.equal(result.status, "FAILED");
        assert.deepEqual(result.worker_result, payload); assert.equal(result.process_tree.termination_proof.active_processes, 0);
        assert.equal(result.seal, mode.startsWith("STDOUT_ONLY") ? mode : ["unknown-bytes", "outer-stat-failure"].includes(mode) ? "STDOUT_ONLY_STORAGE_UNVERIFIABLE" : "STDOUT_ONLY_WRITE_FAILED");
        assert.equal(closureWrites, mode.startsWith("outer-") && mode !== "outer-stat-failure" ? 1 : 0);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
      } finally { fs.writeFileSync = originalWrite; fs.existsSync = originalExists; }
    }
  });
  await check("real RPC parser correlates numeric reply IDs, rejects foreign IDs and stops on malformed notification", async () => {
    for (const mode of ["valid", "foreign", "notification"]) {
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { queueMicrotask(() => child.emit("close", 0)); return true; };
      const rpc = createAgenticCodexRpc({ executable: process.execPath, sha256: sha(fs.readFileSync(process.execPath)), args: [], cwd: root,
        env: {}, deadline: Date.now() + 10000, spawnProcess: () => child, onNotification() { throw Object.assign(Error("bad turn"), { code: "PROCESS_SESSION_FOREIGN_TURN" }); } });
      child.stdin.on("data", data => { const request = JSON.parse(data);
        child.stdout.write(JSON.stringify(mode === "notification" ? { method: "item/completed", params: {} } : { id: mode === "foreign" ? "call-id" : request.id, result: { ok: true } }) + "\n"); });
      if (mode === "valid") assert.deepEqual(await rpc.request("initialize", {}), { ok: true });
      else await assert.rejects(() => rpc.request("initialize", {}), mode === "foreign" ? /FOREIGN_REPLY/ : /FOREIGN_TURN/);
      assert.equal((await rpc.close()).closed, true);
    }
  });
  completed = true;
  console.log(JSON.stringify({ ok: true, checks, proof_class: "offline-production-composition-with-fake-native-wire", model_calls: 0, native_client: "NOT_RUN", native_process_tree: "NOT_RUN" }));
} finally {
  if (retainAlways || !completed && process.argv.includes("--retain-on-failure")) {
    const report = path.join(root, "retained-fixture.json");
    fs.writeFileSync(report, JSON.stringify({ proof_class: "offline-diagnostic-only", completed, pid: process.pid,
      observed_at_utc: new Date().toISOString(), root, business_roots: businessRoots }, null, 2));
    console.error("Fixture retained for diagnosis/restart: " + report);
  } else {
    const physicalRoot = fs.realpathSync(root);
    if (path.dirname(physicalRoot) !== fs.realpathSync(os.tmpdir()) || !path.basename(physicalRoot).startsWith("aidn-agentic-execution-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(physicalRoot, { recursive: true, force: true });
  for (const businessRoot of businessRoots) {
    const physical = fs.realpathSync(businessRoot);
    if (path.dirname(physical) !== fs.realpathSync(os.tmpdir()) || !path.basename(physical).startsWith("aidn-standard-fresh-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(physical, { recursive: true, force: true });
  }
  }
}
