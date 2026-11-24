import { retainedVerificationAdmit } from "../../core/workflow/standard-retained-verification.mjs";
import { standardOperationReliability } from "../workflow/installed-operation-reliability.mjs";
import { prIncidentCloseOperation } from "../../core/workflow/standard-pr-incident-close.mjs";
import { handoffResourceOperation } from "../../core/workflow/standard-handoff-resource-operation.mjs";
import { handoffPublicationOperation } from "../../core/workflow/standard-handoff-operation.mjs";
import { postMergeDecisionOperation } from "../../core/workflow/standard-pr-post-merge-decision.mjs";
import { postMergeAlignmentOperation, postMergeMeasureOperation } from "../../core/workflow/standard-pr-post-merge-fetch.mjs";
import { postMergeWaitOperation } from "../../core/workflow/standard-pr-merge-execute.mjs";
import { checksOperation, mergeConsentOperation } from "../../core/workflow/standard-pr-merge-consent.mjs";
import { resolutionExceptionOperation } from "../../core/workflow/standard-pr-resolution-exception.mjs";
import { externalMergeDisposition, externalMergeObservationVersion } from "../../core/workflow/standard-pr-external-merge.mjs";
import { recoveryCycleSelection } from "../../core/workflow/standard-drift-recovery-cycle-selection.mjs";
import { cycleEntryChoiceOperation } from "../../core/workflow/standard-cycle-entry-choice.mjs";
import { cycleEntryChoiceRecordOperation } from "../../core/workflow/standard-cycle-entry-choice-record.mjs";
import { cycleEntryChoiceCheckpointOperation } from "../../core/workflow/standard-cycle-entry-choice-checkpoint.mjs";
import { cycleEntryChoiceActivationOperation } from "../../core/workflow/standard-cycle-entry-choice-activation.mjs";
import { cycleEntrySelectedCheckpointOperation } from "../../core/workflow/standard-cycle-entry-selected-checkpoint.mjs";
import { cycleEntrySelectedFocusOperation } from "../../core/workflow/standard-cycle-entry-selected-focus.mjs";
import { cycleEntryFocusCheckpointOperation } from "../../core/workflow/standard-cycle-entry-focus-checkpoint.mjs";
import { canonicalCycleResumeAdmitOperation, canonicalCycleResumeObserveOperation, ownedCanonicalCycleResumeAdmitOperation } from "../../core/workflow/standard-canonical-cycle-resume.mjs";
import { cycleExecutionSourceSelectOperation } from "../../core/workflow/standard-cycle-source-selection.mjs";
import { ownedCyclePlanningSelectOperation } from "../../core/workflow/standard-owned-cycle-planning.mjs";
import { workflowEntrySelectOperation, standardEntryPoint, selectStandardEntry } from "../../core/workflow/standard-workflow-entry-selection.mjs";
import { retainedValidationAdmit, retainedTaskWork, workPhaseSelect } from "../../core/workflow/standard-retained-validation.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { operationJournalId } from "../../core/workflow/process-operation-journal.mjs";
import { assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";

// Installed by the host after it constructs the authenticated business ports.
export function createStandardOperationProvider({
    baselinePromotion, baselinePromotionCheckpoint, baselinePromotionHook, canonicalPlanAdoption,
    canonicalResumeAdmission, changeRequest, checkpointCompletion, checksMayObserveMerge,
    closureReview, current, cycleCloseHook, cycleCloseRecord, cycleEntryChoiceActivation,
    cycleEntryChoiceCheckpoint, cycleEntryChoiceContext, cycleEntryChoiceRecord,
    cycleEntryFocusCheckpoint, cycleEntrySelectedCheckpoint, cycleEntrySelectedFocus,
    cycleImplementation, cyclePlanRecord, cycleTaskAdvance, cycleValidation, cycleVerification,
    decisionInput, driftFinalization, driftRoute, evaluateAudit, evaluateAuditSelection,
    evaluateValidation, externalDisposition, fail, handoffGitCheckpoint, handoffPreparation,
    handoffPublication, handoffResourceObservation, mergeObservationInput, now, objectiveCompletion,
    operations, ownedResumeAdmission, postMerge, postMergeDecision, prCorrectionCheckpoint,
    prCorrectionCycle, prCorrectionReopen, prCorrectionReview, prIncidentClose, prTriage,
    predecessorFor, pretriageRoute, processAuthority, promotionReview, recovery, recoveryCycle,
    recoveryCycleSubject, recoveryDecision, retained, reviewEffects, rollback, selectCompletedClose,
    selectCyclePlan, sessionBranchIntegration, sessionCloseCheckpoint, sessionCloseHook,
    sessionCloseRecord, sessionClosureReview, sessionDeliveryCheckpoint, sessionGitCheckpoint,
    sessionPrAdmission, sessionPrCheckpoint, sessionPrConsent, sessionPrEffects, sessionPrMerge,
    sessionPrMergeEffect, sessionPrOpen, sessionPrPremerge, sessionPrRecord, sessionPrRedeliveryPush,
    sessionPrReply, sessionPrResolution, sessionPrReview, sessionPrReviewContent,
    sessionPrReviewReceiver, sessionPrUpdatePush, sessionPrecloseCheckpoint, sessionPush, snapshot,
    spike, terminalCheckpoint, verifyGrant, verifyGrantCurrent, entryContinuation, retainedClosureEntry, prepareCycleCloseRecord,
}) {
  async function selectEntry(state) {
    const instance = state.record, parameters = instance.initial_parameters ?? {};
    const assertCurrent = () => {
      if (current(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail("STANDARD_ENTRY_PROCESS_CHANGED");
    };
    assertCurrent();
    const point = standardEntryPoint(parameters), admission = point !== "session"
      ? await operations.admitCycleEntry({ contract_version: "standard-cycle-entry-input.v1", session_id: parameters.session?.session_id, cycle_id: null }) : null;
    assertCurrent();
    const continuation = admission?.outcome === "completed" && admission.facts.cycle_entry_resume_allowed
      ? await (point === "retained_closure" ? retainedClosureEntry(instance, parameters, admission) : point === "retained_audit" ? processAuthority.retainedAuditEntry(instance, parameters, admission) : point === "retained_verification" ? processAuthority.retainedVerificationEntry(instance, parameters, admission) : point === "retained_validation" ? processAuthority.retainedValidationEntry(instance, parameters, admission)
        : entryContinuation?.(instance, parameters, admission) ?? fail("STANDARD_ENTRY_CONTINUATION_AUTHORITY_REQUIRED")) : null;
    assertCurrent();
    return selectStandardEntry(parameters, admission, continuation);
  }
  const previews = new Map([
    [retainedVerificationAdmit, async ({ state }) => processAuthority.admitRetainedVerification(state.record)],
    [retainedValidationAdmit, async ({ state }) => processAuthority.admitRetainedValidation(state.record)],
    [workPhaseSelect, async ({ state }) => processAuthority.selectWorkPhase(state.record)],
    [retainedTaskWork, async ({ state, input }) => processAuthority.observeRetainedTaskWork(state.record, input)],
    [workflowEntrySelectOperation, async ({ state }) => selectEntry(state)],
    ["baseline_promotion_checkpoint", async ({ state, input, occurrenceId }) => {
      return await baselinePromotionCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PROMOTION_CHECKPOINT_AUTHORITY_REQUIRED");
    }],
    ["cycle_terminal_checkpoint", async ({ state, input, occurrenceId }) => {
      return await terminalCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_TERMINAL_CHECKPOINT_AUTHORITY_REQUIRED");
    }],
    ["session_git_checkpoint", async ({ state, input, occurrenceId }) => {
      return await sessionGitCheckpoint.prepare(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    ["spike_conversion_admit", async ({ state, input }) => {
      return await spike.admit(state.record, input);
    }],
    ["spike_conversion_decision", async ({ state, input, binding }) => {
      return await spike.prepareDecision(state.record, input, { analysisContinuation: binding.output_contract === "standard-spike-decision-output.v2" });
    }],
    ["spike_cycle_initialize", async ({ state, input }) => {
      return await spike.prepareInitialize(state.record, input);
    }],
    ["spike_conversion_finalize", async ({ state, input }) => {
      return await spike.prepareFinalize(state.record, input);
    }],
    ["spike_experiment_admit", async ({ state, input }) => {
      return await spike.experimentAdmission(state.record, input);
    }],
    ["spike_experiment_execution_admit", async ({ state, input }) => {
      return await spike.experimentExecutionAdmission(state.record, input);
    }],
    ["cycle_plan_select", async ({ state }) => {
      return await selectCyclePlan(state.record);
    }],
    [cycleExecutionSourceSelectOperation, async ({ state, input }) => {
      return await processAuthority?.selectCycleExecutionSource?.(state.record, input) ?? fail("STANDARD_CYCLE_EXECUTION_SOURCE_AUTHORITY_REQUIRED");
    }],
    ["cycle_plan_adopt", async ({ state, input }) => {
      return await canonicalPlanAdoption?.(state.record, input) ?? fail("STANDARD_CANONICAL_PLAN_AUTHORITY_UNAVAILABLE");
    }],
    [canonicalCycleResumeAdmitOperation, async ({ state, input, occurrenceId }) => {
      return await canonicalResumeAdmission?.(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_CANONICAL_RESUME_AUTHORITY_REQUIRED");
    }],
    [ownedCanonicalCycleResumeAdmitOperation, async ({ state, input, occurrenceId }) => {
      return await ownedResumeAdmission?.(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_OWNED_RESUME_AUTHORITY_REQUIRED");
    }],
    [ownedCyclePlanningSelectOperation, async ({ state, input }) => {
      return await processAuthority?.selectOwnedCyclePlanning?.(state.record, input) ?? fail("STANDARD_OWNED_PLANNING_AUTHORITY_REQUIRED");
    }],
    [canonicalCycleResumeObserveOperation, async ({ state, input }) => {
      return await processAuthority?.observeCanonicalResumeProduct?.(state.record, input) ?? fail("STANDARD_CANONICAL_RESUME_PRODUCT_AUTHORITY_REQUIRED");
    }],
    ["mode_work_preflight", async ({ state, input }) => {
      return await processAuthority?.preflightModeWork(state.record, input) ?? fail("STANDARD_MODE_WORK_AUTHORITY_REQUIRED");
    }],
    ["mode_work_observe", async ({ state, input }) => {
      return await processAuthority?.observeModeWork(state.record, input) ?? fail("STANDARD_MODE_WORK_AUTHORITY_REQUIRED");
    }],
    ["mode_work_continue_decision", async ({ state, input }) => {
      return await processAuthority?.prepareModeWorkContinuation(state.record, input) ?? fail("STANDARD_MODE_WORK_AUTHORITY_REQUIRED");
    }],
    ["mode_work_evaluate", async ({ state, input }) => {
      return await processAuthority?.evaluateModeWork(state.record, input) ?? fail("STANDARD_MODE_WORK_AUTHORITY_REQUIRED");
    }],
    ["drift_followup_select", async ({ state, input }) => {
      return await driftRoute?.select(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["drift_report_evaluate", async ({ state, input }) => {
      return await processAuthority?.evaluateDriftReport(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ...["drift_recovery_context_refresh", "drift_recovery_checkpoint_observe", "drift_recovery_cycle_initialize"].map(id => [id, async ({ state, binding, input }) => {
      return await recoveryCycle?.prepare(state.record, binding.id, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }]),
    ["drift_change_request_record", async ({ state, input }) => {
      return await changeRequest?.prepare(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["drift_recovery_rollback_apply", async ({ state, input }) => {
      return await rollback?.prepare(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["session_close_finalize", async ({ state, input, occurrenceId }) => {
      return await sessionCloseHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_CLOSE_HOOK_AUTHORITY_REQUIRED");
    }],
    ["session_pr_checkpoint", async ({ state, input, occurrenceId }) => {
      return await sessionPrCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_SUCCESSOR_AUTHORITY_REQUIRED");
    }],
    ["session_pr_redelivery_push", async ({ state, input, occurrenceId }) => {
      return await sessionPrRedeliveryPush?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_REDELIVERY_AUTHORITY_REQUIRED");
    }],
    ["session_pr_update_push", async ({ state, input, occurrenceId }) => {
      return await sessionPrUpdatePush?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_SUCCESSOR_AUTHORITY_REQUIRED");
    }],
    ["session_pr_triage_select", async ({ state, input }) => {
      return await prTriage?.select(state.record, input) ?? fail("STANDARD_PR_TRIAGE_AUTHORITY_REQUIRED");
    }],
    ["session_pr_triage_evaluate", async ({ state, input }) => {
      return await prTriage?.evaluate(state.record, input) ?? fail("STANDARD_PR_TRIAGE_AUTHORITY_REQUIRED");
    }],
    ["session_pr_correction_cycle_initialize", async ({ state, input }) => {
      return await prCorrectionCycle?.prepare(state.record, input) ?? fail("STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED");
    }],
    ["session_pr_correction_decision", async ({ state, input, occurrenceId }) => {
      return await prCorrectionReview?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED");
    }],
    ["session_pr_correction_checkpoint", async ({ state, input, occurrenceId }) => {
      return await prCorrectionCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED");
    }],
    ["session_pr_correction_reopen", async ({ state, input }) => {
      return await prCorrectionReopen?.prepare(state.record, input) ?? fail("STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED");
    }],
    ["session_pr_review_reply_select", async ({ state, input }) => {
      return sessionPrReply.prepareSelection(state.record, input);
    }],
    ["session_pr_review_resolution_select", async ({ state, input }) => {
      return sessionPrResolution.prepareSelection(state.record, input);
    }],
    [resolutionExceptionOperation, async ({ state, input }) => {
      return await sessionPrResolution.prepareException(state.record, input);
    }],
    ["handoff_summary_prepare", async ({ state, input, occurrenceId }) => {
      return await handoffPreparation.prepareSummary(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    ["handoff_git_checkpoint", async ({ state, input, occurrenceId }) => {
      return await handoffGitCheckpoint.prepare(state.record, { summary_operation_id: input.summary_operation_id }, operationJournalId(state.record, occurrenceId));
    }],
    ["handoff_prepare", async ({ state, input, occurrenceId }) => {
      return await handoffPreparation.prepareCheckpoint(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    ["handoff_admit", async () => {
      return { can_apply: true };
    }],
    [handoffResourceOperation, async ({ state, input, signal }) => {
      return handoffResourceObservation.prepare(state.record, input, { signal });
    }],
    [handoffPublicationOperation, async ({ state, input, occurrenceId, signal }) => {
      return await handoffPublication.prepare(state.record, input, occurrenceId, { signal });
    }],
    [prIncidentCloseOperation, async ({ state, input }) => {
      return await prIncidentClose.prepare(state.record, input);
    }],
    ...[...reviewEffects.keys()].map(id => [id, async ({ binding, state, input, occurrenceId }) => {
      return await reviewEffects.get(binding.id).prepare(state.record, input, operationJournalId(state.record, occurrenceId));
    }]),
    ["session_pr_review_effects_verify", async ({ state, input }) => {
      return sessionPrEffects.prepare(state.record, input);
    }],
    ["session_pr_premerge_observe", async ({ state, input }) => {
      return sessionPrPremerge.prepare(state.record, input);
    }],
    ...[postMergeAlignmentOperation, postMergeMeasureOperation].map(id => [id, async ({ state, input }) => {
      return postMerge.prepareAlignment(state.record, input);
    }]),
    [postMergeDecisionOperation, async ({ state, input, occurrence }) => {
      return await postMergeDecision.prepare(state.record, input, predecessorFor(occurrence));
    }],
    [postMergeWaitOperation, async () => {
      return { can_apply: true };
    }],
    ["session_pr_review_event_route", async ({ state, occurrenceId }) => {
      return pretriageRoute(state, occurrenceId);
    }],
    ["session_pr_merge_basis", async ({ state, input, occurrenceId }) => {
      return externalDisposition.prepareBasis(state, input, occurrenceId);
    }],
    [externalMergeDisposition, async ({ state, input, occurrenceId }) => {
      return externalDisposition.prepare(state.record, input, occurrenceId);
    }],
    [checksOperation, async ({ input, state }) => {
      return checksMayObserveMerge(input)
      ? sessionPrPremerge.prepare(state.record, mergeObservationInput(input)) : { can_apply: true };
    }],
    [mergeConsentOperation, async ({ state, input, binding }) => {
      return await sessionPrConsent.prepare(state.record, input, { legacy: binding.output_contract === "standard-pr-merge-consent-output.v1" });
    }],
    ["session_pr_merge_observe", async ({ state, input }) => {
      return sessionPrMerge.prepare(state.record, input);
    }],
    ["session_pr_review_receive", async ({ state, input }) => {
      return await sessionPrReviewReceiver?.prepare(state.record, input) ?? fail("STANDARD_PR_RECEIVE_AUTHORITY_REQUIRED");
    }],
    ["session_pr_review_content_observe", async ({ state, input }) => {
      return await sessionPrReviewContent?.prepare(state.record, input) ?? fail("STANDARD_PR_REVIEW_AUTHORITY_REQUIRED");
    }],
    ["session_pr_review_observe", async ({ state, input }) => {
      return await sessionPrReview?.prepare(state.record, input) ?? fail("STANDARD_PR_REVIEW_AUTHORITY_REQUIRED");
    }],
    ["session_pr_record", async ({ state, input }) => {
      return await sessionPrRecord?.prepare(state.record, input) ?? fail("STANDARD_PR_RECORD_AUTHORITY_REQUIRED");
    }],
    ["session_pr_open", async ({ state, input, occurrenceId }) => {
      return await sessionPrOpen?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PR_OPEN_TRANSPORT_REQUIRED");
    }],
    ["session_push", async ({ state, input, occurrenceId }) => {
      return await sessionPush?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PUSH_TRANSPORT_REQUIRED");
    }],
    ["session_pr_admit", async ({ state, input }) => {
      return await sessionPrAdmission?.prepare(state.record, input) ?? fail("STANDARD_SESSION_PR_AUTHORITY_REQUIRED");
    }],
    ["session_branch_integration_decision", async ({ state, input }) => {
      return await sessionBranchIntegration?.prepareDecision(state.record, input) ?? fail("STANDARD_SESSION_INTEGRATION_AUTHORITY_REQUIRED");
    }],
    ["session_branch_integrate", async ({ state, input, occurrenceId }) => {
      return await sessionBranchIntegration?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_INTEGRATION_AUTHORITY_REQUIRED");
    }],
    ["session_delivery_checkpoint", async ({ state, input, occurrenceId }) => {
      return await sessionDeliveryCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_DELIVERY_AUTHORITY_REQUIRED");
    }],
    ["session_preclose_checkpoint", async ({ state, input, occurrenceId }) => {
      return await sessionPrecloseCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_AUTHORITY_REQUIRED");
    }],
    ["session_close_checkpoint", async ({ state, input, occurrenceId }) => {
      return await sessionCloseCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_CHECKPOINT_AUTHORITY_REQUIRED");
    }],
    ["session_close_record", async ({ state, input }) => {
      return await sessionCloseRecord?.prepare(state.record, input) ?? fail("STANDARD_SESSION_CLOSE_AUTHORITY_REQUIRED");
    }],
    ["session_closure_decision", async ({ state, input }) => {
      return await sessionClosureReview?.prepare(state.record, input) ?? fail("STANDARD_SESSION_CLOSURE_AUTHORITY_REQUIRED");
    }],
    ["baseline_promotion_decision", async ({ state, input }) => {
      return await promotionReview?.prepare(state.record, input) ?? fail("STANDARD_PROMOTION_REVIEW_AUTHORITY_REQUIRED");
    }],
    ["baseline_promotion_finalize", async ({ state, input, occurrenceId }) => {
      return await baselinePromotionHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PROMOTION_HOOK_AUTHORITY_REQUIRED");
    }],
    ["baseline_promotion_record", async ({ state, input }) => {
      return await baselinePromotion?.prepare(state.record, input) ?? fail("STANDARD_PROMOTION_AUTHORITY_REQUIRED");
    }],
    ["cycle_close_completed_select", async ({ state }) => {
      return selectCompletedClose(state.record);
    }],
    ["cycle_close_finalize", async ({ state, input, occurrenceId }) => {
      return await cycleCloseHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_CYCLE_CLOSE_HOOK_AUTHORITY_REQUIRED");
    }],
    ["cycle_close_record", async ({ state }) => {
      return await prepareCycleCloseRecord?.(state.record) ?? fail("STANDARD_CYCLE_CLOSE_AUTHORITY_REQUIRED");
    }],
    ["cycle_closure_decision", async ({ state, input, occurrenceId }) => {
      return await closureReview?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_CLOSURE_AUDIT_AUTHORITY_REQUIRED");
    }],
    ["drift_completion_select", async ({ state }) => {
      return await driftRoute?.completion(state.record) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["drift_completion_decision", async ({ state, occurrenceId }) => {
      return await recovery?.prepareRenewal(state.record, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    [cycleEntryChoiceOperation, async ({ state, input }) => {
      return await cycleEntryChoiceContext.prepare(state.record, input);
    }],
    [cycleEntryChoiceRecordOperation, async ({ state, input, occurrenceId }) => {
      return await cycleEntryChoiceRecord.prepare(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    [cycleEntryChoiceCheckpointOperation, async ({ state, input, occurrenceId }) => {
      return await cycleEntryChoiceCheckpoint.prepare(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    [cycleEntryChoiceActivationOperation, async ({ state, input, occurrenceId }) => {
      return await cycleEntryChoiceActivation.prepare(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    [cycleEntrySelectedCheckpointOperation, async ({ state, input, occurrenceId }) => {
      return await cycleEntrySelectedCheckpoint.prepare(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    [cycleEntrySelectedFocusOperation, async ({ state, input, occurrenceId }) => {
      return await cycleEntrySelectedFocus.prepare(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    [cycleEntryFocusCheckpointOperation, async ({ state, input, occurrenceId }) => {
      return await cycleEntryFocusCheckpoint.prepare(state.record, input, operationJournalId(state.record, occurrenceId));
    }],
    [recoveryCycleSelection, async ({ state, input }) => {
      return { can_apply: true, subject: await recoveryCycleSubject(state.record, input) };
    }],
    ["drift_recovery_decision", async ({ state, input, occurrenceId }) => {
      return await recovery?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["drift_recovery_record", async ({ state, input }) => {
      return await (async () => { const body = { ...await recoveryDecision(state.record, input), prepared_at_ms: now() };
      return { ...body, can_apply: true, plan_sha256: shadowHash(body) }; })();
    }],
    ["drift_check_finalize", async ({ state, input, occurrenceId }) => {
      return await driftFinalization?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["session_initialize", async ({ input }) => {
      return await operations.prepareSession(input);
    }],
    ["session_mode_apply", async ({ state, input }) => {
      return await operations.prepareMode(decisionInput(state.record, input));
    }],
    ["session_start_finalize", async ({ input, state }) => {
      return await operations.prepareStart(input, { readObjectiveCompletion: processAuthority ? () => objectiveCompletion.read(state.record) : null });
    }],
    ["cycle_context_refresh", async ({ input }) => {
      return await operations.prepareCycleContext(input);
    }],
    ["cycle_initialize", async ({ input }) => {
      return await operations.prepareCycle(input);
    }],
    ["cycle_checkpoint_finalize", async ({ input, state }) => {
      return await operations.prepareCycleCheckpoint(input, { readObjectiveCompletion: checkpointCompletion(state.record, input) });
    }],
    ["cycle_plan_record", async ({ state, input }) => {
      return await cyclePlanRecord?.prepare(state.record, input) ?? fail("STANDARD_CYCLE_PLAN_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_implementation_enter", async ({ state, input }) => {
      return await cycleImplementation?.prepare(state.record, input) ?? fail("STANDARD_CYCLE_READINESS_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_validation_execute", async ({ state, input }) => {
      return await cycleValidation?.prepare(state.record, input) ?? fail("STANDARD_VALIDATION_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_verification_enter", async ({ state, input }) => {
      return await cycleVerification?.prepare(state.record, input) ?? fail("STANDARD_VERIFICATION_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_task_advance", async ({ state, input }) => {
      return await cycleTaskAdvance?.prepare(state.record, input) ?? fail("STANDARD_TASK_PROGRESS_AUTHORITY_UNAVAILABLE");
    }],
  ]);
  const observations = new Map([
    [retainedVerificationAdmit, async ({ state }) => processAuthority.admitRetainedVerification(state.record)],
    [retainedValidationAdmit, async ({ state }) => processAuthority.admitRetainedValidation(state.record)],
    [workPhaseSelect, async ({ state }) => processAuthority.selectWorkPhase(state.record)],
    [retainedTaskWork, async ({ state, record }) => processAuthority.observeRetainedTaskWork(state.record, record.preview.input)],
    [workflowEntrySelectOperation, async ({ state }) => selectEntry(state)],
    [handoffResourceOperation, async ({ resourceCapture }) => {
      return resourceCapture.output;
    }],
    ...["handoff_summary_prepare", "handoff_prepare"].map(id => [id, async ({ record, state, signal }) => {
      const apply = record.intent.binding_ref === "handoff_summary_prepare" ? handoffPreparation.applySummary : handoffPreparation.applyCheckpoint;
      return await apply(state.record, record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256, signal,
        assertAuthorized: () => verifyGrant(record, signal), assertCurrent: () => { if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256) fail("STANDARD_HANDOFF_PREPARATION_PROCESS_CHANGED"); } });
    }]),
    ["handoff_git_checkpoint", async ({ state, record, signal }) => {
      return await handoffGitCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal) });
    }],
    ["handoff_admit", async ({ state, record }) => {
      return await handoffPreparation.inspectAdmission(state.record, record.preview.input);
    }],
    ["context_reload", async ({ record }) => {
      return await operations.reload(record.preview.input);
    }],
    ["session_admit", async ({ record }) => {
      return await operations.admitSession(record.preview.input);
    }],
    ["session_entry_admit", async ({ record }) => {
      return await operations.admitSessionEntry(record.preview.input);
    }],
    ["cycle_entry_observe", async ({ record }) => {
      return await operations.observeCycleEntry(record.preview.input);
    }],
    ["cycle_entry_admit", async ({ record }) => {
      return await operations.admitCycleEntry(record.preview.input);
    }],
    [cycleEntryChoiceRecordOperation, async ({ state, record, signal }) => {
      return await cycleEntryChoiceRecord.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal) });
    }],
    [cycleEntryChoiceCheckpointOperation, async ({ state, record, signal }) => {
      return await cycleEntryChoiceCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal) });
    }],
    [cycleEntryChoiceActivationOperation, async ({ state, record, signal }) => {
      return await cycleEntryChoiceActivation.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal) });
    }],
    [cycleEntrySelectedCheckpointOperation, async ({ state, record, signal }) => {
      return await cycleEntrySelectedCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal) });
    }],
    [cycleEntrySelectedFocusOperation, async ({ state, record, signal }) => {
      return await cycleEntrySelectedFocus.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal) });
    }],
    [cycleEntryFocusCheckpointOperation, async ({ state, record, signal }) => {
      return await cycleEntryFocusCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal) });
    }],
    ["session_close_admit", async ({ record }) => {
      return await operations.admitSessionClose(record.preview.input);
    }],
    ["session_close_record", async ({ state, record }) => {
      return await sessionCloseRecord.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_pr_checkpoint", async ({ state, record }) => {
      return await sessionPrCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_pr_redelivery_push", async ({ state, record }) => {
      return await sessionPrRedeliveryPush.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_pr_update_push", async ({ state, record }) => {
      return await sessionPrUpdatePush.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_pr_record", async ({ state, record }) => {
      return await sessionPrRecord.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_pr_open", async ({ state, record }) => {
      return await sessionPrOpen.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_push", async ({ state, record }) => {
      return await sessionPush.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_pr_admit", async ({ state, record }) => {
      return await sessionPrAdmission.observe(state.record, record.preview.input);
    }],
    ["session_pr_triage_select", async ({ state, record, signal }) => {
      return await prTriage.select(state.record, record.preview.input, { signal });
    }],
    ["session_pr_triage_evaluate", async ({ state, record, signal }) => {
      return await prTriage.evaluate(state.record, record.preview.input, { signal });
    }],
    ["session_pr_correction_cycle_initialize", async ({ state, record, signal }) => {
      return await prCorrectionCycle.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal), signal });
    }],
    ["session_pr_correction_checkpoint", async ({ state, record, signal }) => {
      return await prCorrectionCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record), signal });
    }],
    ["session_pr_correction_reopen", async ({ state, record, signal }) => {
      return await prCorrectionReopen.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record, signal), signal });
    }],
    ["session_pr_review_reply_select", async ({ state, record, signal }) => {
      return await sessionPrReply.select(state.record, record.preview.input,
      record.preview.prepared, { signal });
    }],
    ["session_pr_review_resolution_select", async ({ state, record, signal }) => {
      return await sessionPrResolution.select(state.record, record.preview.input,
      record.preview.prepared, { signal });
    }],
    [handoffPublicationOperation, async ({ state, record, id, signal }) => {
      return await handoffPublication.apply(state.record, record.preview.input, record.preview.prepared,
      { operationId: id, signal, assertAuthorized: () => verifyGrant(record, signal), assertAuthorizedCurrent: () => verifyGrantCurrent(record, signal) });
    }],
    [prIncidentCloseOperation, async ({ state, record, id, signal, claimed }) => {
      return await prIncidentClose.apply(state.record, record.preview.input,
      record.preview.prepared, { operationId: id, assertAuthorized: async () => {
        await verifyGrant(record, signal);
        if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256
          || shadowHash(retained(id).record) !== shadowHash(claimed))
          throw Object.assign(Error("STANDARD_PR_INCIDENT_CLOSE_OWNER_CHANGED"), { code: "STANDARD_PR_INCIDENT_CLOSE_OWNER_CHANGED", effect_status: "no_effect" });
      } });
    }],
    ...[...reviewEffects.keys()].map(id => [id, async ({ record, state, signal, id, claimed }) => {
      return await reviewEffects.get(record.intent.binding_ref).apply(state.record, record.preview.input,
      record.preview.prepared, { signal, operationId: id, assertAuthorized: async () => {
        await verifyGrant(record, signal);
        if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256
          || shadowHash(retained(id).record) !== shadowHash(claimed)
          || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot))
          throw Object.assign(Error("STANDARD_PR_REVIEW_EFFECT_OWNER_CHANGED"), { code: "STANDARD_PR_REVIEW_EFFECT_OWNER_CHANGED", effect_status: "no_effect" });
      } });
    }]),
    ["session_pr_review_effects_verify", async ({ state, record, signal }) => {
      return await sessionPrEffects.observe(state.record, record.preview.input,
      { signal, sourceSha256: record.preview.prepared.source_sha256, outputContract: record.preview.binding.output_contract });
    }],
    ["session_pr_review_event_route", async ({ state, record }) => {
      const selected = pretriageRoute(state, record.intent.occurrence_id);
      if (shadowHash(selected) !== shadowHash(record.preview.prepared)) fail("STANDARD_PR_REVIEW_WAIT_CHANGED");
      return { contract_version: "standard-pr-review-event-route-output.v1", operation_ref: record.intent.binding_ref,
        outcome: "completed", effect_status: "no_effect", facts: { session_pr_pretriage_external: selected.external },
        observations: {}, evidence_refs: [] };
    }],
    ["session_pr_merge_basis", async ({ state, record }) => {
      const selected = externalDisposition.prepareBasis(state, record.preview.input, record.intent.occurrence_id);
      if (shadowHash(selected) !== shadowHash(record.preview.prepared)) fail("STANDARD_PR_MERGE_BASIS_CHANGED");
      return { contract_version: "standard-pr-merge-basis-output.v2", operation_ref: "session_pr_merge_basis",
        outcome: "completed", effect_status: "no_effect", facts: { session_pr_incident_tracking_required: selected.incident_tracking_required }, evidence_refs: [],
        observations: { merge_operation_id: selected.merge_operation_id } };
    }],
    ["session_pr_premerge_observe", async ({ state, record, signal }) => {
      return await sessionPrPremerge.observe(state.record, record.preview.input,
      { signal, sourceSha256: record.preview.prepared.source_sha256,
        externalOperation: record.preview.input.contract_version === "standard-session-pr-merge-observe-input.v2"
          ? record.intent.binding_ref : undefined });
    }],
    [checksOperation, async ({ record, state, signal }) => {
      const input = record.preview.input;
      const observed = checksMayObserveMerge(input) ? await sessionPrPremerge.observe(state.record, mergeObservationInput(input),
        { signal, sourceSha256: record.preview.prepared.source_sha256, externalOperation: checksOperation }) : null;
      if (observed?.contract_version === externalMergeObservationVersion) return observed;
      else if (observed && observed.outcome !== "completed") return assertStandardOperationOutput({
        contract_version: "standard-pr-checks-accept-output.v1", operation_ref: checksOperation,
        outcome: observed.outcome, effect_status: "no_effect", facts: {}, evidence_refs: [],
        observations: { reason_code: observed.observations.reason_code },
      });
      else return await sessionPrConsent.acceptChecks(state.record, input, signal);
    }],
    ...[postMergeAlignmentOperation, postMergeMeasureOperation].map(id => [id, async ({ state, record, signal }) => {
      return await postMerge.observeAlignment(
      state.record, record.preview.input, record.preview.prepared, { signal, operation: record.intent.binding_ref });
    }]),
    [postMergeWaitOperation, async ({ state, record }) => {
      return sessionPrMergeEffect.waitForSync(state.record, record.preview.input);
    }],
    ["session_pr_merge_observe", async ({ state, record, signal }) => {
      return await sessionPrMerge.observe(state.record, record.preview.input,
      { signal, sourceSha256: record.preview.prepared.source_sha256 });
    }],
    ["session_pr_review_receive", async ({ state, record, signal }) => {
      return await sessionPrReviewReceiver.observe(state.record, record.preview.input, { signal });
    }],
    ["session_pr_review_content_observe", async ({ state, record, signal }) => {
      return await sessionPrReviewContent.observe(state.record, record.preview.input, { signal });
    }],
    ["session_pr_review_observe", async ({ state, record, signal }) => {
      return await sessionPrReview.observe(state.record, record.preview.input, { signal });
    }],
    ["session_branch_integrate", async ({ state, record }) => {
      return await sessionBranchIntegration.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_delivery_checkpoint", async ({ state, record }) => {
      return await sessionDeliveryCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_preclose_checkpoint", async ({ state, record }) => {
      return await sessionPrecloseCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_close_checkpoint", async ({ state, record }) => {
      return await sessionCloseCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_close_finalize", async ({ state, record }) => {
      return await sessionCloseHook.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_admit", async ({ record }) => {
      return await operations.admitCycle(record.preview.input);
    }],
    ["branch_cycle_audit", async ({ record }) => {
      return await operations.auditCycle(record.preview.input);
    }],
    ["drift_completion_select", async ({ state }) => {
      return await driftRoute?.completion(state.record) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_close_completed_select", async ({ state }) => {
      return selectCompletedClose(state.record);
    }],
    ["drift_followup_select", async ({ state, record }) => {
      return await driftRoute?.select(state.record, record.preview.input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["drift_report_evaluate", async ({ state, record }) => {
      return await processAuthority?.evaluateDriftReport(state.record, record.preview.input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_prework_select", async ({ state, record }) => {
      return await processAuthority?.selectCyclePrework(state.record, record.preview.input) ?? fail("STANDARD_PREWORK_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_prework_evaluate", async ({ state, record }) => {
      return await processAuthority?.evaluateCyclePrework(state.record, record.preview.input) ?? fail("STANDARD_PREWORK_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_plan_evaluate", async ({ state, record }) => {
      return await processAuthority?.evaluateCyclePlan(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_PLAN_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_readiness_evaluate", async ({ state, record }) => {
      return await processAuthority?.evaluateCycleReadiness(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_READINESS_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_work_evaluate", async ({ state, record }) => {
      return await processAuthority?.evaluateCycleWork(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_WORK_AUTHORITY_UNAVAILABLE");
    }],
    ["cycle_validation_evaluate", async ({ state, record }) => {
      return (await evaluateValidation(state.record, record.preview.input)).output;
    }],
    ["cycle_audit_evaluate", async ({ state, record }) => {
      return await evaluateAudit(state.record, record.preview.input);
    }],
    ["spike_conversion_admit", async ({ state, record }) => {
      return await spike.admit(state.record, record.preview.input, { analysisContinuation: record.preview.binding.revision >= 2 });
    }],
    ["spike_conversion_select", async ({ state, record }) => {
      return await spike.selectConversion(state.record, record.preview.input);
    }],
    ["spike_experiment_admit", async ({ state, record }) => {
      return await spike.experimentAdmission(state.record, record.preview.input);
    }],
    ["spike_experiment_execution_admit", async ({ state, record }) => {
      return await spike.experimentExecutionAdmission(state.record, record.preview.input);
    }],
    ["cycle_plan_select", async ({ state }) => {
      return await selectCyclePlan(state.record);
    }],
    [cycleExecutionSourceSelectOperation, async ({ state, record }) => {
      return await processAuthority?.selectCycleExecutionSource?.(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_EXECUTION_SOURCE_AUTHORITY_REQUIRED");
    }],
    ["cycle_plan_adopt", async ({ state, record }) => {
      return await canonicalPlanAdoption?.(state.record, record.preview.input) ?? fail("STANDARD_CANONICAL_PLAN_AUTHORITY_UNAVAILABLE");
    }],
    [canonicalCycleResumeAdmitOperation, async ({ state, record }) => {
      return await canonicalResumeAdmission?.(state.record, record.preview.input, record.operation_id) ?? fail("STANDARD_CANONICAL_RESUME_AUTHORITY_REQUIRED");
    }],
    [ownedCanonicalCycleResumeAdmitOperation, async ({ state, record }) => {
      return await ownedResumeAdmission?.(state.record, record.preview.input, record.operation_id) ?? fail("STANDARD_OWNED_RESUME_AUTHORITY_REQUIRED");
    }],
    [ownedCyclePlanningSelectOperation, async ({ state, record }) => {
      return await processAuthority?.selectOwnedCyclePlanning?.(state.record, record.preview.input) ?? fail("STANDARD_OWNED_PLANNING_AUTHORITY_REQUIRED");
    }],
    [canonicalCycleResumeObserveOperation, async ({ state, record }) => {
      return await processAuthority?.observeCanonicalResumeProduct?.(state.record, record.preview.input) ?? fail("STANDARD_CANONICAL_RESUME_PRODUCT_AUTHORITY_REQUIRED");
    }],
    ["spike_cycle_initialize", async ({ state, record }) => {
      return await spike.initialize(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["spike_conversion_finalize", async ({ state, record }) => {
      return await spike.finalize(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["mode_work_preflight", async ({ state, record }) => {
      return await processAuthority.preflightModeWork(state.record, record.preview.input);
    }],
    ["mode_work_observe", async ({ state, record }) => {
      return await processAuthority.observeModeWork(state.record, record.preview.input);
    }],
    ["mode_work_evaluate", async ({ state, record }) => {
      return await processAuthority.evaluateModeWork(state.record, record.preview.input);
    }],
    ["cycle_audit_select", async ({ state, record }) => {
      return await evaluateAuditSelection(state.record, record.preview.input);
    }],
    ["cycle_task_select", async ({ state, record }) => {
      return await processAuthority.evaluateCycleTaskSelection(state.record, record.preview.input);
    }],
    ["cycle_task_work_evaluate", async ({ state, record }) => {
      return await processAuthority.evaluateCycleTaskWork(state.record, record.preview.input);
    }],
    ["drift_change_request_record", async ({ state, record }) => {
      return await changeRequest.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
  ]);
  const applications = new Map([
    ...["drift_recovery_context_refresh", "drift_recovery_checkpoint_observe", "drift_recovery_cycle_initialize"].map(id => [id, async ({ state, record }) => {
      return await recoveryCycle.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }]),
    ["drift_recovery_rollback_apply", async ({ state, record }) => {
      return await rollback.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["drift_check_finalize", async ({ state, record }) => {
      return await driftFinalization.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["drift_recovery_record", async ({ state, record }) => {
      try {
        const selected = await recoveryDecision(state.record, record.preview.input);
        if (shadowHash(selected.review) !== shadowHash(record.preview.prepared.review) || selected.choice !== record.preview.prepared.choice) fail("STANDARD_RECOVERY_DECISION_CHANGED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return await recovery.apply(state.record, record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_initialize", async ({ record }) => {
      return await operations.initializeSession(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
    }],
    ["session_mode_apply", async ({ state, record }) => {
      if (shadowHash(decisionInput(state.record, record.preview.input)) !== shadowHash(record.preview.prepared.plan.input)) fail("STANDARD_MODE_DECISION_CHANGED");
      return await operations.applyMode(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
    }],
    ["baseline_promotion_checkpoint", async ({ state, record }) => {
      return await baselinePromotionCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_terminal_checkpoint", async ({ state, record }) => {
      return await terminalCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["session_git_checkpoint", async ({ state, record }) => {
      return await sessionGitCheckpoint.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_context_refresh", async ({ record }) => {
      return await operations.refreshCycleContext(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
    }],
    ["cycle_initialize", async ({ record }) => {
      return await operations.initializeCycle(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
    }],
    ["baseline_promotion_finalize", async ({ state, record }) => {
      return await baselinePromotionHook.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["baseline_promotion_record", async ({ state, record }) => {
      return await baselinePromotion.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_close_finalize", async ({ state, record }) => {
      return await cycleCloseHook.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_close_record", async ({ state, record }) => {
      return await cycleCloseRecord.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_plan_record", async ({ state, record }) => {
      return await cyclePlanRecord.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_implementation_enter", async ({ state, record }) => {
      return await cycleImplementation.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_validation_execute", async ({ state, record }) => {
      return await cycleValidation.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_verification_enter", async ({ state, record }) => {
      return await cycleVerification.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_task_advance", async ({ state, record }) => {
      return await cycleTaskAdvance.apply(state.record, record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
    }],
    ["cycle_checkpoint_finalize", async ({ record, state }) => {
      return await operations.finalizeCycleCheckpoint(record.preview.prepared,
      { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record),
        readObjectiveCompletion: checkpointCompletion(state.record, record.preview.input),
        assertCurrent: () => { if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256) fail("STANDARD_CYCLE_CHECKPOINT_PROCESS_CHANGED"); } });
    }],
    ["session_start_finalize", async ({ record, state }) => {
      return await operations.finalizeStart(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256,
      readObjectiveCompletion: processAuthority ? () => objectiveCompletion.read(state.record) : null, assertAuthorized: () => verifyGrant(record),
      assertCurrent: () => { if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256) fail("STANDARD_START_PROCESS_CHANGED"); } });
    }],
  ]);
  return { id: "aidn-standard", revision: 2, operations: standardWorkflowOperationBindings().map(binding => ({
    binding, reliability: standardOperationReliability(binding),
    prepare: previews.get(binding.id) ?? (() => null),
    dispatch: observations.get(binding.id) ?? (async context => {
      const { record } = context;
      if (!record.preview.prepared?.can_apply) return { contract_version: record.preview.binding.output_contract, operation_ref: record.intent.binding_ref,
          outcome: "blocked", effect_status: "no_effect", facts: {}, observations: record.preview.prepared ?? {}, evidence_refs: [] };
      const apply = applications.get(binding.id);
      if (!apply) fail("STANDARD_HOST_BINDING_CHANGED");
      return apply(context);
    }),
  })) };
}
