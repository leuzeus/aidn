import { assertSpikeQuestion, assertHumanSpikeDecision, observeHumanSpikeDecision, assertSpikeDecisionOutput } from "../../core/workflow/standard-spike-decision.mjs";
import { assertPrCorrectionQuestion, assertHumanPrCorrectionDecision, observeHumanPrCorrectionDecision, assertPrCorrectionDecisionOutput } from "../../core/workflow/standard-pr-correction-decision.mjs";
import { assertSessionClosureQuestion, assertHumanSessionClosureDecision, observeHumanSessionClosureDecision, assertSessionClosureDecisionOutput } from "../../core/workflow/standard-session-closure-decision.mjs";
import { assertBaselinePromotionQuestion, assertHumanBaselinePromotionDecision, observeHumanBaselinePromotionDecision } from "../../core/workflow/standard-baseline-promotion-decision.mjs";
import { assertCycleClosureQuestion, assertHumanCycleClosureDecision, observeHumanCycleClosureDecision } from "../../core/workflow/standard-cycle-closure-decision.mjs";
import { assertHumanModeDecision, assertModeQuestion, assertRecoveryQuestion, assertHumanRecoveryDecision, decisionInboxId } from "../../core/workflow/process-decision-inbox.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { assertModeWorkQuestion, assertHumanModeWorkDecision, observeHumanModeWorkDecision, assertModeWorkDecisionOutput } from "../../core/workflow/standard-mode-work-continuation.mjs";
import { postMergeDecisionOperation, postMergeQuestionVersion, postMergeDecisionQuestion, assertHumanPostMergeDecision, postMergeDecisionOutput } from "../../core/workflow/standard-pr-post-merge-decision.mjs";
import { mergeConsentOperation, mergeConsentQuestion, assertHumanMergeConsent, mergeConsentOutput } from "../../core/workflow/standard-pr-merge-consent.mjs";
import { resolutionExceptionOperation, resolutionExceptionQuestion, assertHumanResolutionException, resolutionExceptionOutput } from "../../core/workflow/standard-pr-resolution-exception.mjs";
import { externalMergeDisposition, externalMergeQuestionVersion, externalMergeQuestion, assertHumanExternalMergeDisposition,
  externalMergeDispositionOutput } from "../../core/workflow/standard-pr-external-merge.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const choices = ["THINKING", "EXPLORING", "COMMITTING", "refused", "deferred", "cancelled"];
export function createStandardHumanDecisions({ inbox, signer, source, projectionRequired }) {
  const spike = record => record.intent.binding_ref === "spike_conversion_decision";
  const modeWork = record => record.intent.binding_ref === "mode_work_continue_decision";
  const correction = record => record.intent.binding_ref === "session_pr_correction_decision";
  const integration = record => record.intent.binding_ref === "session_branch_integration_decision";
  const sessionClosure = record => record.intent.binding_ref === "session_closure_decision";
  const recovery = record => ["drift_recovery_decision", "drift_completion_decision"].includes(record.intent.binding_ref);
  const promotion = record => record.intent.binding_ref === "baseline_promotion_decision";
  const closure = record => record.intent.binding_ref === "cycle_closure_decision";
  const resolutionException = record => record.intent.binding_ref === resolutionExceptionOperation;
  const question = record => {
    if (record.intent.binding_ref === externalMergeDisposition) return externalMergeQuestion(record);
    if (record.intent.binding_ref === postMergeDecisionOperation) return postMergeDecisionQuestion(record);
    if (record.intent.binding_ref === mergeConsentOperation) return mergeConsentQuestion(record);
    if (resolutionException(record)) return resolutionExceptionQuestion(record);
    if (!["spike_conversion_decision", "mode_work_continue_decision", "session_pr_correction_decision", "session_branch_integration_decision", "session_closure_decision", "mode_decision", "drift_recovery_decision", "drift_completion_decision", "cycle_closure_decision", "baseline_promotion_decision"].includes(record.intent.binding_ref)) fail("PROCESS_HUMAN_OPERATION_REQUIRED");
    if (spike(record)) return assertSpikeQuestion({ contract_version: "standard-spike-question.v1", operation_id: record.operation_id,
      instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
      session_id: record.preview.prepared.review.analysis.session_id, review_operation_id: record.preview.input.review_operation_id,
      review: structuredClone(record.preview.prepared.review), choices: [...record.preview.prepared.choices] });
    if (modeWork(record)) return assertModeWorkQuestion({ contract_version: "standard-mode-work-question.v1", operation_id: record.operation_id,
      instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
      session_id: record.preview.prepared.review.session_id, review_operation_id: record.preview.input.review_operation_id,
      review: structuredClone(record.preview.prepared.review), choices: [...record.preview.prepared.choices] });
    if (correction(record)) return assertPrCorrectionQuestion({ contract_version: record.preview.prepared.plan.contract_version === "standard-pr-correction-review-plan.v3" ? "standard-pr-correction-question.v3" : record.preview.prepared.plan.contract_version === "standard-pr-correction-review-plan.v2" ? "standard-pr-correction-question.v2" : "standard-pr-correction-question.v1",
      ...(record.preview.prepared.plan.contract_version === "standard-pr-correction-review-plan.v3" ? { cycle_constraints: structuredClone(record.preview.prepared.plan.cycle_constraints) } : {}),
      ...(record.preview.prepared.plan.contract_version === "standard-pr-correction-review-plan.v2" ? { candidate_cycle: structuredClone(record.preview.prepared.plan.candidate_cycle) } : {}), operation_id: record.operation_id,
      instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
      session_id: record.preview.prepared.plan.review.session_id, review: structuredClone(record.preview.prepared.plan.review), choices: [...record.preview.prepared.plan.choices] });
    if (integration(record)) return assertSessionBranchIntegrationQuestion({ contract_version: "standard-session-branch-integration-question.v1", operation_id: record.operation_id,
      instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
      session_id: record.preview.prepared.plan.review.session_id, review: structuredClone(record.preview.prepared.plan.review), choices: [...record.preview.prepared.plan.choices] });
    if (sessionClosure(record)) return assertSessionClosureQuestion({ contract_version: "standard-session-closure-question.v1", operation_id: record.operation_id,
      instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
      session_id: record.preview.prepared.plan.review.session_id, review: structuredClone(record.preview.prepared.plan.review), choices: [...record.preview.prepared.plan.choices] });
    if (promotion(record)) return assertBaselinePromotionQuestion({ contract_version: "standard-baseline-promotion-question.v1", operation_id: record.operation_id,
      instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
      session_id: record.preview.prepared.plan.review.session_id, review: structuredClone(record.preview.prepared.plan.review), choices: [...record.preview.prepared.plan.choices] });
    if (closure(record)) return assertCycleClosureQuestion({ contract_version: "standard-cycle-closure-question.v1", operation_id: record.operation_id,
      instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
      session_id: record.preview.prepared.plan.review.session_id, review: structuredClone(record.preview.prepared.plan.review), choices: [...record.preview.prepared.plan.choices] });
    return recovery(record) ? assertRecoveryQuestion({ contract_version: ["standard-drift-recovery-plan.v2", "standard-drift-recovery-plan.v3"].includes(record.preview.prepared.plan.contract_version)
      ? "standard-drift-recovery-question.v2" : "standard-drift-recovery-question.v1", operation_id: record.operation_id,
    instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
    session_id: record.preview.prepared.plan.session_id, review: structuredClone(record.preview.prepared.plan),
    choices: [...(record.preview.prepared.plan.choices ?? record.preview.prepared.plan.options.map(row => row.choice)), "refused", "deferred", "cancelled"] })
    : assertModeQuestion({ contract_version: "standard-mode-question.v1", operation_id: record.operation_id, instance_id: record.intent.instance_id,
    scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
    session_id: record.preview.input.session_id, choices: [...choices] });
  };
  function read(id) {
    const value = inbox.read(id); if (!value.record) fail("PROCESS_DECISION_SOURCE_NOT_FOUND");
    signer.verify(value.record); return value;
  }
  function write(body, before) {
    const record = signer.seal(body), result = inbox.compareAndSwap(record, before);
    if (result.projection === "pending") inbox.materialize(record.inbox_id, { write: true });
    return record;
  }
  async function bounded(method, input, signal) {
    if (typeof source?.[method] !== "function") fail("PROCESS_HUMAN_AUTHORITY_UNAVAILABLE");
    const stop = new AbortController(), combined = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    if (combined.aborted) fail("PROCESS_HUMAN_AUTHORITY_ABORTED");
    let timer, onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(Object.assign(new Error("PROCESS_HUMAN_AUTHORITY_ABORTED"), { code: "PROCESS_HUMAN_AUTHORITY_ABORTED" }));
      combined.addEventListener("abort", onAbort, { once: true });
    });
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reject(Object.assign(new Error("PROCESS_HUMAN_AUTHORITY_TIMEOUT"), { code: "PROCESS_HUMAN_AUTHORITY_TIMEOUT" })); stop.abort(); }, 5000); });
    try {
      const value = await Promise.race([Promise.resolve().then(() => source[method]({ ...structuredClone(input), signal: combined })), timeout, aborted]);
      if (combined.aborted) fail("PROCESS_HUMAN_AUTHORITY_ABORTED");
      if (value !== null && checkShadowJson(value)) fail("PROCESS_HUMAN_AUTHORITY_INVALID");
      return structuredClone(value);
    } finally { clearTimeout(timer); combined.removeEventListener("abort", onAbort); stop.abort(); }
  }
  async function verify(claim, sourceRef, request, signal, historical = false) {
    if (request.contract_version === "standard-spike-question.v1") assertHumanSpikeDecision(claim, request);
    else if (request.contract_version === "standard-mode-work-question.v1") assertHumanModeWorkDecision(claim, request);
    else if (request.contract_version === externalMergeQuestionVersion) assertHumanExternalMergeDisposition(claim, request);
    else if (request.contract_version === postMergeQuestionVersion) assertHumanPostMergeDecision(claim, request);
    else if (request.contract_version === "standard-pr-merge-consent-question.v1") assertHumanMergeConsent(claim, request);
    else if (request.contract_version === "standard-pr-review-resolution-exception-question.v1") assertHumanResolutionException(claim, request);
    else if (["standard-pr-correction-question.v1", "standard-pr-correction-question.v2", "standard-pr-correction-question.v3"].includes(request.contract_version)) assertHumanPrCorrectionDecision(claim, request);
    else if (request.contract_version === "standard-session-branch-integration-question.v1") assertHumanSessionBranchIntegrationDecision(claim, request);
    else if (request.contract_version === "standard-session-closure-question.v1") assertHumanSessionClosureDecision(claim, request);
    else if (request.contract_version === "standard-baseline-promotion-question.v1") assertHumanBaselinePromotionDecision(claim, request);
    else if (request.contract_version === "standard-cycle-closure-question.v1") assertHumanCycleClosureDecision(claim, request);
    else if (["standard-drift-recovery-question.v1", "standard-drift-recovery-question.v2"].includes(request.contract_version)) assertHumanRecoveryDecision(claim, request); else assertHumanModeDecision(claim);
    if (claim.question_sha256 !== shadowHash(request)) fail("PROCESS_HUMAN_QUESTION_CHANGED");
    if (!request.choices.includes(claim.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
    const proof = await bounded("verify", { source: claim, sourceRef, question: request, historical }, signal);
    if (proof?.outcome !== "verified" || proof.authority_id !== claim.authority_id || proof.source_sha256 !== shadowHash(claim)) fail("PROCESS_HUMAN_NOT_AUTHENTICATED");
  }
  function captured(record) {
    const result = record.results.at(-1), observation = result?.output?.observations;
    if (!observation?.inbox_id) fail("PROCESS_HUMAN_CAPTURE_MISSING");
    const retained = read(observation.inbox_id).record;
    if (retained.operation_id !== record.operation_id || retained.source.question_sha256 !== shadowHash(question(record))
      || observation.source_ref !== retained.source_ref || observation.source_sha256 !== shadowHash(retained.source) || observation.choice !== retained.source.choice
      || record.decision_claim_sha256 !== undefined && record.decision_claim_sha256 !== shadowHash({ source_ref: retained.source_ref, source: retained.source })
      || retained.phase === "receipted" && retained.receipt_sha256 !== shadowHash(result.receipt)) fail("PROCESS_HUMAN_CAPTURE_CHANGED");
    return retained;
  }
  return Object.freeze({ question, captured,
    verifyReserved: (record, capture, signal) => verify(capture.source, capture.source_ref, question(record), signal),
    readSource(ref) {
      const match = /^aidn:decision-source\/(decision_[a-f0-9]{40})$/.exec(ref);
      if (!match) fail("PROCESS_HUMAN_SOURCE_REF_INVALID");
      return structuredClone(read(match[1]).record.source);
    },
    async reserve(record, sourceRef, { signal, assertCurrent, claimDecision } = {}) {
      if (typeof sourceRef !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(sourceRef)) fail("PROCESS_HUMAN_SOURCE_REF_INVALID");
      const request = question(record), claim = await bounded("read", { sourceRef, question: request }, signal);
      if (claim === null) return null;
      await verify(claim, sourceRef, request, signal);
      await assertCurrent?.();
      const id = decisionInboxId(claim), before = inbox.read(id);
      if (before.record) {
        signer.verify(before.record);
        if (before.record.operation_id !== record.operation_id || shadowHash(before.record.source) !== shadowHash(claim)) fail("PROCESS_HUMAN_SOURCE_ALREADY_USED");
        claimDecision?.(claim);
        if (projectionRequired) inbox.materialize(id, { write: true });
        return before.record;
      }
      const version = record.intent.binding_ref === externalMergeDisposition ? "process-decision-inbox.v16"
        : record.intent.binding_ref === postMergeDecisionOperation ? "process-decision-inbox.v15"
        : record.intent.binding_ref === mergeConsentOperation ? "process-decision-inbox.v14" : resolutionException(record) ? "process-decision-inbox.v13" : spike(record) ? "process-decision-inbox.v11" : modeWork(record) ? "process-decision-inbox.v10" : correction(record) ? (claim.contract_version === "human-pr-correction-decision.v3" ? "process-decision-inbox.v9" : claim.contract_version === "human-pr-correction-decision.v2" ? "process-decision-inbox.v8" : "process-decision-inbox.v7") : integration(record) ? "process-decision-inbox.v6" : sessionClosure(record) ? "process-decision-inbox.v5" : promotion(record) ? "process-decision-inbox.v4" : closure(record) ? "process-decision-inbox.v3" : recovery(record) ? (claim.contract_version === "human-drift-recovery-decision.v2" ? "process-decision-inbox.v12" : "process-decision-inbox.v2") : "process-decision-inbox.v1";
      claimDecision?.(claim);
      return write({ contract_version: version, inbox_id: id, operation_id: record.operation_id, source_ref: sourceRef,
        source: claim, phase: "reserved", receipt_sha256: null }, null);
    },
    acknowledge(id, receipt) {
      const before = read(id), record = before.record;
      if (record.phase === "receipted") {
        if (record.receipt_sha256 !== shadowHash(receipt)) fail("PROCESS_HUMAN_CAPTURE_CHANGED");
        if (projectionRequired) inbox.materialize(id, { write: true });
        return;
      }
      const { authentication, key_id, ...body } = record;
      write({ ...body, phase: "receipted", receipt_sha256: shadowHash(receipt) }, before.content_sha256);
    },
    async verifyCaptured(record, signal, { historical = false, acknowledged = false } = {}) {
      const value = captured(record);
      if (acknowledged && value.phase !== "receipted") fail("PROCESS_HUMAN_CAPTURE_MISSING");
      await verify(value.source, value.source_ref, question(record), signal, historical);
    },
    output(record, capture) {
      const request = question(record);
      if (record.intent.binding_ref === externalMergeDisposition) return externalMergeDispositionOutput(request, capture);
      if (record.intent.binding_ref === postMergeDecisionOperation) return postMergeDecisionOutput(request, capture, record.preview.input.allow_fast_forward === true);
      if (record.intent.binding_ref === mergeConsentOperation) return mergeConsentOutput(request, capture);
      if (resolutionException(record)) return resolutionExceptionOutput(request, capture);
      if (spike(record)) {
        const observed = observeHumanSpikeDecision({ question: request, decision: capture.source });
        return assertSpikeDecisionOutput({ contract_version: "standard-spike-decision-output.v1", operation_ref: "spike_conversion_decision", ...observed,
          observations: { ...observed.observations, inbox_id: capture.inbox_id, source_ref: capture.source_ref },
          evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] });
      }
      if (modeWork(record)) {
        const observed = observeHumanModeWorkDecision({ question: request, decision: capture.source });
        return assertModeWorkDecisionOutput({ contract_version: "standard-mode-work-decision-output.v1", operation_ref: "mode_work_continue_decision", ...observed,
          observations: { ...observed.observations, inbox_id: capture.inbox_id, source_ref: capture.source_ref },
          evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] });
      }
      if (correction(record)) {
        const observed = observeHumanPrCorrectionDecision({ question: request, decision: capture.source });
        return assertPrCorrectionDecisionOutput({ contract_version: request.contract_version === "standard-pr-correction-question.v3" ? "standard-pr-correction-decision-output.v3" : request.contract_version === "standard-pr-correction-question.v2" ? "standard-pr-correction-decision-output.v2" : "standard-pr-correction-decision-output.v1", operation_ref: "session_pr_correction_decision", ...observed,
          observations: { ...observed.observations, inbox_id: capture.inbox_id, source_ref: capture.source_ref },
          evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] });
      }
      if (integration(record)) {
        const observed = observeHumanSessionBranchIntegrationDecision({ question: request, decision: capture.source });
        return assertSessionBranchIntegrationDecisionOutput({ contract_version: "standard-session-branch-integration-decision-output.v1", operation_ref: "session_branch_integration_decision", ...observed,
          observations: { ...observed.observations, inbox_id: capture.inbox_id, source_ref: capture.source_ref },
          evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] });
      }
      if (sessionClosure(record)) {
        const { choice, ...observed } = observeHumanSessionClosureDecision({ question: request, decision: capture.source });
        return assertSessionClosureDecisionOutput({ contract_version: "standard-session-closure-decision-output.v1", operation_ref: "session_closure_decision", ...observed,
          observations: { ...observed.observations, inbox_id: capture.inbox_id, source_ref: capture.source_ref },
          evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] });
      }
      if (promotion(record)) {
        const { choice, ...observed } = observeHumanBaselinePromotionDecision({ question: request, decision: capture.source });
        return { contract_version: "standard-baseline-promotion-decision-output.v1", operation_ref: "baseline_promotion_decision", ...observed,
          observations: { ...observed.observations, inbox_id: capture.inbox_id, source_ref: capture.source_ref, choice: capture.source.choice },
          evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] };
      }
      if (closure(record)) {
        const { choice, ...observed } = observeHumanCycleClosureDecision({ question: request, decision: capture.source });
        return { contract_version: "standard-cycle-closure-decision-output.v1", operation_ref: "cycle_closure_decision", ...observed,
          observations: { ...observed.observations, inbox_id: capture.inbox_id, source_ref: capture.source_ref, choice: capture.source.choice },
          evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] };
      }
      const choice = capture.source.choice, isRecovery = recovery(record);
      const objective = isRecovery && ["standard-drift-recovery-plan.v2", "standard-drift-recovery-plan.v3"].includes(record.preview.prepared.plan.contract_version);
      const accepted = (isRecovery ? (record.preview.prepared.plan.choices ?? record.preview.prepared.plan.options.map(row => row.choice)) : ["THINKING", "EXPLORING", "COMMITTING"]).includes(choice);
      const outcome = accepted ? "completed" : choice === "refused" ? "rejected" : choice;
      return { contract_version: isRecovery ? "standard-drift-recovery-output.v1" : "standard-operation-output.v3",
        operation_ref: isRecovery ? record.intent.binding_ref : "mode_decision", outcome, effect_status: "no_effect",
        observations: { inbox_id: capture.inbox_id, source_ref: capture.source_ref, source_sha256: shadowHash(capture.source), choice,
          ...(objective ? { review_kind: "objective_signal_disagreement", review_resolution_pending: true, signal_discharged: false } : {}) },
        facts: !accepted ? {} : record.intent.binding_ref === "drift_completion_decision" ? { drift_completion_reviewed: choice === "confirm_alignment" } : objective ? { drift_check_completed: false, drift_route_ready: choice === "confirm_alignment", drift_diagnosis_requested: choice === "request_diagnosis" } : isRecovery ? { drift_route_ready: false, drift_diagnosis_requested: false, drift_recovery_chosen: true, drift_recovery_requirements_delta: choice === "requirements_delta",
          drift_recovery_new_cycle: choice === "new_cycle", drift_recovery_rollback: choice === "rollback", drift_recovery_required: true, drift_check_completed: false }
          : { mode_thinking: choice === "THINKING", mode_exploring: choice === "EXPLORING", mode_committing: choice === "COMMITTING",
            cycle_work_requested: choice === "COMMITTING" },
        evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] };
    },
  });
}
import { assertSessionBranchIntegrationQuestion, assertHumanSessionBranchIntegrationDecision, observeHumanSessionBranchIntegrationDecision, assertSessionBranchIntegrationDecisionOutput } from "../../core/workflow/standard-session-branch-integration-decision.mjs";
