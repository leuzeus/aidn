import { createStandardSessionBranchIntegration } from "./standard-session-branch-integration.mjs";
import { createStandardSessionBranchIntegrationAuthority } from "./standard-session-branch-integration-authority.mjs";
import { createStandardSessionPrOpen } from "./standard-session-pr-open.mjs";
import { createStandardSessionPush } from "./standard-session-push.mjs";
import { createStandardSessionPrAdmission } from "./standard-session-pr-admission.mjs";
import { createStandardSessionClosureAuthority } from "./standard-session-closure-authority.mjs";
import { createStandardSessionClosureReview } from "./standard-session-closure-review.mjs";
import { createStandardSessionCloseRecord } from "./standard-session-close-record.mjs";
import { createStandardSessionCloseCheckpoint } from "./standard-session-close-checkpoint.mjs";
import { createStandardSessionPrecloseCheckpoint } from "./standard-session-preclose-checkpoint.mjs";
import { createStandardSessionDeliveryCheckpoint } from "./standard-session-delivery-checkpoint.mjs";
import { sessionClosePaths } from "../../core/workflow/standard-session-close-render.mjs";
import { createStandardSessionCloseHook } from "./standard-session-close-hook.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { createStandardBaselinePromotionCheckpoint } from "./standard-baseline-promotion-checkpoint.mjs";
import { baselinePromotionPaths } from "../../core/workflow/standard-baseline-promotion.mjs";
import { createStandardCycleTerminalCheckpoint } from "./standard-cycle-terminal-checkpoint.mjs";
import { createStandardWorkflowGitCheckpoint } from "./standard-workflow-git-checkpoint.mjs";
import { createStandardBaselinePromotionHook } from "./standard-baseline-promotion-hook.mjs";
import { createStandardBaselinePromotionAuthority } from "./standard-baseline-promotion-authority.mjs";
import { createStandardBaselinePromotion, baselinePromotionSourceMaterialSha256 } from "./standard-baseline-promotion.mjs";
import { createStandardBaselinePromotionReview } from "./standard-baseline-promotion-review.mjs";
import { createStandardCycleCloseHook } from "./standard-cycle-close-hook.mjs";
import { createStandardCycleCloseRecord } from "./standard-cycle-close-record.mjs";
import { createStandardCycleClosureReview } from "./standard-cycle-closure-review.mjs";
import { observeStandardCycleAudit } from "../../core/workflow/standard-cycle-audit.mjs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createStandardDriftFinalization } from "./standard-drift-finalization.mjs";
import { createStandardDriftRecovery } from "./standard-drift-recovery.mjs";
import { createStandardDriftChangeRequest } from "./standard-drift-change-request.mjs";
import { createStandardDriftCycle } from "./standard-drift-cycle.mjs";
import { createStandardCyclePlanRecord } from "./standard-cycle-plan-record.mjs";
import { createStandardCycleImplementation } from "./standard-cycle-implementation.mjs";
import { createStandardCycleValidation } from "./standard-cycle-validation.mjs";
import { createStandardCycleTaskAdvance } from "./standard-cycle-task-advance.mjs";
import { createStandardCycleVerification } from "./standard-cycle-verification.mjs";
import { evaluateStandardCycleValidation } from "../../core/workflow/standard-cycle-verification.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { agenticProcessPersistence } from "./agentic-process-persistence.mjs";
import { createAgenticProcessService } from "./agentic-process-service.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createProcessDecisionInboxStore } from "../../adapters/runtime/process-decision-inbox-store.mjs";
import { createProcessControlInboxStore } from "../../adapters/runtime/process-control-inbox-store.mjs";
import { createStandardHumanDecisions } from "./standard-workflow-human-decisions.mjs";
import { createStandardControlInbox } from "./standard-workflow-control-inbox.mjs";
import { assertControlRequest } from "../../core/workflow/process-control-inbox.mjs";
import { createAgenticProcess, advanceAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { assertAgenticProcessModel, agenticPolicyPins, processId } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, freezeShadow } from "../../core/workflow/shadow-json.mjs";
import { createOperationJournalSigner, operationJournalId, operationOutputRef } from "../../core/workflow/process-operation-journal.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { assertProcessOperationBinding } from "../../core/workflow/process-operation-contracts.mjs";
import { assertStandardWorkflowModelSource } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import previewSchema from "../../core/contracts/workflow-definition/standard-operation-preview.v1.schema.json" with { type: "json" };
import { processParameterOptions } from "../../core/workflow/process-data-contracts.mjs";
import { resolveStandardProcessInput, assertStandardResolvedPreview } from "./standard-process-inputs.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const receiptId = id => "receipt_" + id.slice(3);
function controlCheckpoint(instance, eventId) {
  let replay = createAgenticProcess({ instanceId: instance.instance_id, model: instance.model, policyPins: instance.policy_pins,
    scopeId: instance.scope_id, facts: instance.initial_facts, ...processParameterOptions(instance) });
  for (const event of instance.events) {
    replay = advanceAgenticProcess(replay, event);
    if (event.event_id === eventId) return replay.instance_sha256;
  }
  fail("PROCESS_CONTROL_EVENT_UNAVAILABLE");
}
// Fixed local business adapters plus the common reducer/store. This host owns
// neither model routing nor human decisions. Signing/authorization capabilities
// must come from a trusted outer host, never authored JSON or a model tool.
export function createStandardWorkflowOperationHost({ targetRoot, model: suppliedModel, modelSource = null, readSigningKey, authorize, humanSource, controlSource, now = Date.now, processAuthority, validationProfile = null, sessionPushPort = null, sessionPullRequestPort = null }, { validationBoundaryFactory } = {}) {
  if (processAuthority != null && (processAuthority.profile !== "standard-mixed.v1" || typeof processAuthority.authenticate !== "function")) fail("STANDARD_HOST_CONFIGURATION_INVALID");
  const model = freezeShadow(structuredClone(suppliedModel)); assertAgenticProcessModel(model);
  const driftFinalization = processAuthority ? createStandardDriftFinalization({ targetRoot, now,
    readEvaluation: (instance, input) => processAuthority.readDriftEvaluation(instance, input), readCurrent: id => current(id).record }) : null;
  const recovery = processAuthority ? createStandardDriftRecovery({ targetRoot, now,
    readEvaluation: (instance, input) => processAuthority.readDriftEvaluation(instance, input),
    observeContext: () => processAuthority.observeDriftContext(), readCurrent: id => current(id).record }) : null;
  const changeRequest = processAuthority ? createStandardDriftChangeRequest({ targetRoot, now,
    readRecovery: (instance, input) => recordedRecovery(instance, input),
    observeContext: () => processAuthority.observeDriftContext(), readCurrent: id => current(id).record }) : null;
  const source = modelSource === null ? null : freezeShadow(structuredClone(assertStandardWorkflowModelSource(modelSource, model)));
  if (model.contract_version !== "agentic-process-model.v2" || typeof authorize !== "function") fail("STANDARD_HOST_CONFIGURATION_INVALID");
  if (controlSource != null && (typeof controlSource.read !== "function" || typeof controlSource.verify !== "function")) fail("STANDARD_HOST_CONTROL_CONFIGURATION_INVALID");
  const operations = createStandardWorkflowOperations({ targetRoot, now }), artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const cyclePlanRecord = processAuthority ? createStandardCyclePlanRecord({ targetRoot, now,
    readEvaluation: (instance, input) => processAuthority.readCyclePlanEvaluation(instance, input),
    observeContext: () => processAuthority.observeCyclePlanContext(), readCurrent: id => current(id).record }) : null;
  const cycleImplementation = processAuthority ? createStandardCycleImplementation({ targetRoot, now,
    readEvaluation: (instance, input) => processAuthority.readCycleReadinessEvaluation(instance, input),
    observeContext: () => processAuthority.observeCycleReadinessContext(), readCurrent: id => current(id).record }) : null;
  const cycleValidation = processAuthority ? createStandardCycleValidation({ targetRoot, now, profileRef: validationProfile,
    readWork: (instance, input) => processAuthority.readCycleWorkEvaluation(instance, input), readCurrent: id => current(id).record }, { boundaryFactory: validationBoundaryFactory }) : null;
  async function evaluateValidation(instance, input) {
    const source = await processAuthority.readCycleValidationExecution(instance, input), evidence = await cycleValidation.readResult(source);
    return { output: evaluateStandardCycleValidation({ source, evidence, validationOperationId: input.validation_operation_id }), source, evidence };
  }
  async function auditSource(instance, input) {
    const bridge = await processAuthority.readCycleVerificationExecution(instance, input), source = bridge.source;
    const evidence = await cycleValidation.readResult(source);
    // Recompute machine coverage against the same signed original subject hash.
    // Its owned VERIFYING metadata transition is authenticated separately above;
    // this historical hash is never presented as the current context authority.
    const original = evaluateStandardCycleValidation({ source: { ...source,
      progress_operation_id: bridge.evaluation.record.preview.input.progress_operation_id ?? null,
      context: { cycle_path: bridge.context.cycle_path }, context_sha256: bridge.evaluation.output.observations.context_sha256 },
      evidence, validationOperationId: source.record.operation_id });
    if (shadowHash(original) !== shadowHash(bridge.evaluation.output) || original.facts.cycle_work_complete !== true) fail("STANDARD_AUDIT_MACHINE_EVIDENCE_STALE");
    const validation = { contract_version: "standard-cycle-audit-machine-evidence.v1", validation_operation_id: source.record.operation_id,
      evaluation_operation_id: bridge.evaluation.record.operation_id, work_complete: original.facts.cycle_work_complete,
      checks_passed: original.facts.cycle_checks_passed, product_sha256: evidence.plan.product_sha256, profile_sha256: evidence.plan.profile_sha256,
      proof_class: evidence.plan.proof_class, status: evidence.manifest.status, checks: evidence.checks, evidence_refs: evidence.evidence_refs };
    const material = processAuthority.observeCycleAuditContext(bridge, validation);
    return { bridge, validation, material };
  }
  async function evaluateAuditSelection(instance, input) {
    assertStandardOperationInput("cycle_audit_select", input);
    const verified = await auditSource(instance, input), { bridge, material, validation } = verified;
    return { contract_version: "standard-cycle-audit-selection-output.v1", operation_ref: "cycle_audit_select", outcome: "completed", effect_status: "no_effect",
      facts: { cycle_audit_source_selected: true }, observations: { implementation_operation_id: input.implementation_operation_id,
        verification_operation_id: bridge.verification.record.operation_id, context_sha256: bridge.context_sha256,
        audit_context_sha256: material.context_sha256, validation }, evidence_refs: material.context.evidence_refs };
  }
  async function inspectAudit(instance, input) {
    const native = processAuthority.readCycleAuditActivity(instance, input), current = await auditSource(instance, native.selection.record.preview.input);
    const { audit_operation_id: selectionId, input_resolution: resolution, ...baseContext } = native.context;
    if (shadowHash(baseContext) !== current.material.context_sha256 || current.material.context_sha256 !== native.selection.output.observations.audit_context_sha256
      || current.bridge.verification.record.operation_id !== native.selection.output.observations.verification_operation_id) fail("STANDARD_AUDIT_CONTEXT_STALE");
    const output = observeStandardCycleAudit({ report: native.authenticated.report, context: native.context, contextSha256: shadowHash(native.context),
      producer: native.authenticated.producer, evidenceRefs: [...native.evidence_refs, ...current.validation.evidence_refs] });
    return { output, native, current };
  }
  const evaluateAudit = async (instance, input) => (await inspectAudit(instance, input)).output;
  async function readAcceptedAudit(instance, input) {
    const record = retained(input.audit_operation_id).record, receipt = record.results.at(-1)?.receipt;
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "cycle_audit_evaluate").at(-1);
    if (latest?.intent.operation_id !== record.operation_id || record.intent.binding_ref !== "cycle_audit_evaluate"
      || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id || record.phase !== "receipted"
      || receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_CLOSURE_ACCEPTED_AUDIT_REQUIRED");
    const verified = await inspectAudit(instance, record.preview.input);
    if (shadowHash(verified.output) !== shadowHash(record.results.at(-1).output)) fail("STANDARD_CLOSURE_AUDIT_CHANGED");
    return { ...verified, record };
  }
  const closureReview = processAuthority ? createStandardCycleClosureReview({ readAudit: readAcceptedAudit }) : null;
  async function readAcceptedClosureDecision(instance, input) {
    const record = retained(input.decision_operation_id).record, result = record.results.at(-1);
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "cycle_closure_decision").at(-1);
    if (latest?.intent.operation_id !== record.operation_id || record.intent.binding_ref !== "cycle_closure_decision"
      || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id || record.phase !== "receipted"
      || result?.receipt.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail("STANDARD_CYCLE_CLOSE_ACCEPTED_DECISION_REQUIRED");
    // The accepted, signed inbox proof survives provider disappearance. It is
    // neither a fresh effect grant nor a substitute for current audit evidence.
    const decision = human.captured(record).source, question = human.question(record);
    const verified = await closureReview.readFresh(instance, record.preview.prepared.plan);
    return { question, decision, report: verified.native.authenticated.report };
  }
  const cycleCloseRecord = processAuthority ? createStandardCycleCloseRecord({ targetRoot, now,
    readDecision: readAcceptedClosureDecision, observeContext: () => processAuthority.observeCycleCloseContext(), readCurrent: id => current(id).record }) : null;
  async function readAcceptedTerminalRecord(instance, input) {
    function accepted(id, binding) {
      const record = retained(id).record, result = record.results.at(-1);
      const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1);
      if (latest?.intent.operation_id !== id || record.intent.binding_ref !== binding || record.intent.instance_id !== instance.instance_id
        || record.intent.scope_id !== instance.scope_id || record.phase !== "receipted" || result?.receipt.outcome !== "completed"
        || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail("STANDARD_CYCLE_CLOSE_RECORDED_SOURCE_REQUIRED");
      return { record, output: result.output };
    }
    const closed = accepted(input.closure_operation_id, "cycle_close_record"), plan = closed.record.preview.prepared.plan;
    const selected = accepted(plan.input.decision_operation_id, "cycle_closure_decision");
    const question = human.question(selected.record), decision = human.captured(selected.record).source;
    const audit = accepted(selected.record.preview.prepared.plan.audit_operation_id, "cycle_audit_evaluate");
    const physical = processAuthority.readCycleCloseValidation(instance, audit.record.preview.input), evidence = await cycleValidation.readResult(physical);
    const report = physical.native.authenticated.report, machine = physical.machine;
    if (shadowHash({ question, decision, report }) !== plan.decision_material_sha256 || question.review.audit_output_sha256 !== shadowHash(audit.output)
      || question.review.report_sha256 !== shadowHash(report) || closed.output.effect_status !== "confirmed" || closed.output.facts.cycle_terminal_recorded !== true
      || closed.output.facts.cycle_close_completed !== false || evidence.plan.product_sha256 !== machine.product_sha256 || evidence.plan.profile_sha256 !== machine.profile_sha256
      || evidence.manifest.status !== machine.status || shadowHash(evidence.checks) !== shadowHash(machine.checks)
      || shadowHash(evidence.evidence_refs) !== shadowHash(machine.evidence_refs)) fail("STANDARD_CYCLE_CLOSE_RECORDED_PROVENANCE_CHANGED");
    return { record_operation_id: closed.record.operation_id, plan, output: closed.output };
  }
  const terminalCheckpoint = processAuthority && model.nodes.some(node => node.binding_ref === "cycle_terminal_checkpoint")
    ? createStandardCycleTerminalCheckpoint({ targetRoot, now, readRecorded: readAcceptedTerminalRecord,
      observeContext: () => processAuthority.observeCycleCloseContext(), readCurrent: id => current(id).record }) : null;
  const cycleCloseHook = processAuthority ? createStandardCycleCloseHook({ targetRoot, now,
    readRecorded: readAcceptedTerminalRecord, observeContext: () => processAuthority.observeCycleCloseContext(), readCurrent: id => current(id).record }) : null;
  function acceptedForPromotion(instance, id, binding, reason = "STANDARD_PROMOTION_ACCEPTED_SOURCE_REQUIRED") {
    const record = retained(id).record, result = record.results.at(-1);
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1);
    if (latest?.intent.operation_id !== id || record.intent.binding_ref !== binding || record.intent.instance_id !== instance.instance_id
      || record.intent.scope_id !== instance.scope_id || record.phase !== "receipted" || result?.receipt.outcome !== "completed"
      || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail(reason);
    return { record, output: result.output };
  }
  const sessionClosureAuthority = processAuthority ? createStandardSessionClosureAuthority({ targetRoot,
    readAcceptedOperation: acceptedForPromotion, readEvaluation: (instance, input) => processAuthority.readDriftEvaluation(instance, input) }) : null;
  const sessionClosureReview = sessionClosureAuthority ? createStandardSessionClosureReview({ readSource: (instance, input) => sessionClosureAuthority.readSource(instance, input) }) : null;
  async function readAcceptedSessionClosureDecision(instance, input) {
    const selected = acceptedForPromotion(instance, input.decision_operation_id, "session_closure_decision", "STANDARD_SESSION_CLOSE_DECISION_REQUIRED");
    await sessionClosureReview.assertFresh(instance, selected.record.preview.prepared.plan);
    return { question: human.question(selected.record), decision: human.captured(selected.record).source };
  }
  const sessionCloseRecord = processAuthority ? createStandardSessionCloseRecord({ targetRoot, now,
    readDecision: readAcceptedSessionClosureDecision, readCurrent: id => current(id).record }) : null;
  function readAcceptedSessionCloseRecord(instance, input) {
    const recorded = acceptedForPromotion(instance, input.record_operation_id, "session_close_record", "STANDARD_SESSION_CLOSE_RECORDED_SOURCE_REQUIRED");
    const plan = recorded.record.preview.prepared.plan, selected = acceptedForPromotion(instance, plan.input.decision_operation_id, "session_closure_decision");
    const question = human.question(selected.record), decision = human.captured(selected.record).source;
    if (shadowHash({ question, decision }) !== plan.decision_material_sha256 || recorded.output.effect_status !== "confirmed"
      || recorded.output.facts.session_close_report_recorded !== true || recorded.output.facts.session_close_completed !== false
      || selected.output.facts.session_closure_requested !== true || decision.choice !== "close") fail("STANDARD_SESSION_CLOSE_RECORDED_SOURCE_REQUIRED");
    const postimages = recorded.output.observations.postimages;
    if (postimages?.length !== 3 || plan.changes.some(change => !postimages.some(row => row.path === change.path && row.sha256 === change.after_sha256)))
      fail("STANDARD_SESSION_CLOSE_POSTIMAGE_CHANGED");
    for (const row of postimages) if (artifacts.read(row.path, { required: true }).sha256 !== row.sha256 || artifacts.metadataHash(row.path) !== row.metadata_sha256)
      fail("STANDARD_SESSION_CLOSE_POSTIMAGE_CHANGED");
    return { recorded, plan, question, decision };
  }
  function readSessionCheckpointSource(instance, input) {
    const source = readAcceptedSessionCloseRecord(instance, input), review = source.question.review;
    const owner = analyzeStructuredArtifact(artifacts.read(review.session_path, { required: true }).content).key_values;
    const currentState = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
    if (owner.state !== "OPEN" || currentState.active_session !== review.session_id || currentState.active_cycle !== "none"
      || owner.session_closure_status !== "checkpoint_pending") fail("STANDARD_SESSION_CHECKPOINT_OWNER_CHANGED");
    const ownedPaths = artifacts.cycles().filter(row => analyzeStructuredArtifact(row.content).key_values.session_owner === review.session_id).map(row => row.path.slice(0, -10));
    const fixed = [review.session_path, "CURRENT-STATE.md", "RUNTIME-STATE.md", "snapshots/context-snapshot.md", "baseline/current.md", "baseline/history.md", "index.md"];
    const writers = new Set(["session_initialize", "session_mode_apply", "cycle_context_refresh", "cycle_initialize", "cycle_plan_record", "cycle_implementation_enter",
      "cycle_task_advance", "cycle_verification_enter", "cycle_close_record", "cycle_close_finalize", "baseline_promotion_record", "baseline_promotion_finalize", "session_close_record"]);
    const approved = new Map(), journals = [];
    for (const event of instance.events.filter(row => row.kind === "operation_result" && row.receipt.outcome === "completed")) {
      const record = retained(event.receipt.operation_id).record;
      if (!writers.has(record.intent.binding_ref)) continue;
      const result = record.results.find(row => shadowHash(row.receipt) === shadowHash(event.receipt));
      if (record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id || result?.output.effect_status !== "confirmed"
        || record.preview.binding.executor_kind !== "deterministic") fail("STANDARD_SESSION_CHECKPOINT_WRITER_REQUIRED");
      journals.push({ operation_id: record.operation_id, output_sha256: shadowHash(result.output) });
      for (const row of result.output.evidence_refs) if (row.ref.startsWith("docs/audit/")) {
        const name = row.ref.slice(11);
        if (!fixed.includes(name) && !ownedPaths.some(parent => name.startsWith(parent + "/"))) fail("STANDARD_SESSION_CHECKPOINT_WRITER_SCOPE_INVALID");
        approved.set(name, row.sha256);
      }
    }
    const admission = acceptedForPromotion(instance, review.admission_operation_id, "session_close_admit").output.observations.admission;
    const completionCycle = ["cycle", "intermediate"].includes(classifyAidnBranch(review.branch)) ? admission.mapped_cycle : null;
    if (completionCycle && (!["DONE", "NO_GO", "DROPPED"].includes(completionCycle.state) || completionCycle.session_owner !== review.session_id))
      fail("STANDARD_SESSION_CHECKPOINT_TERMINAL_OWNER_REQUIRED");
    return { record_operation_id: input.record_operation_id, session_id: review.session_id, branch: review.branch, parent_head: review.head,
      completion_cycle_id: completionCycle?.cycle_id ?? null, material_sha256: shadowHash({ plan: source.plan, journals }),
      postimages: [...approved.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256, metadata_sha256: artifacts.metadataHash(path) })) };
  }
  const sessionCloseCheckpoint = processAuthority ? createStandardSessionCloseCheckpoint({ targetRoot, now, readSource: readSessionCheckpointSource,
    readCurrent: id => current(id).record }) : null;
  // The final closure/promotion CAS happens after its earlier Git checkpoint.
  // Commit only their authenticated latest business postimages before asking
  // R05 to assess the session. Do not suppress its scope/integrity signals.
  async function readSessionPrecloseSource(instance, input) {
    const closed = acceptedForPromotion(instance, input.closure_operation_id, "cycle_close_finalize", "STANDARD_SESSION_PRECLOSE_CLOSURE_REQUIRED");
    const closePlan = closed.record.preview.prepared.plan, terminal = await readAcceptedTerminalRecord(instance, closePlan.input);
    const sessionId = closePlan.scope.session_id, cycleId = closePlan.scope.cycle_id;
    const selected = artifacts.sessions().filter(row => row.session_id === sessionId);
    if (selected.length !== 1 || closed.output.effect_status !== "confirmed" || closed.output.facts.cycle_close_completed !== true
      || !["DONE", "NO_GO", "DROPPED"].includes(closed.output.observations.target_state)
      || terminal.record_operation_id !== closePlan.input.closure_operation_id) fail("STANDARD_SESSION_PRECLOSE_CLOSURE_REQUIRED");
    const observed = closed.output.observations, eventFile = ".aidn/runtime/perf/workflow-events.ndjson";
    if (observed.event_file !== eventFile) fail("STANDARD_SESSION_PRECLOSE_CLOSURE_EVIDENCE_CHANGED");
    const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, eventFile)), { json: false, maxBytes: 4194304 }).value;
    const offset = observed.event_offset, end = Number.isSafeInteger(offset) ? bytes.indexOf(10, offset) : -1;
    if (!Number.isSafeInteger(offset) || offset < 0 || end < offset || offset && bytes[offset - 1] !== 10)
      fail("STANDARD_SESSION_PRECLOSE_CLOSURE_EVIDENCE_CHANGED");
    const event = JSON.parse(bytes.subarray(offset, end).toString("utf8"));
    if (shadowHash(event) !== shadowHash(observed.event) || event.event !== "checkpoint_summary"
      || event.run_id !== "process_close_" + closed.record.operation_id.slice(3)) fail("STANDARD_SESSION_PRECLOSE_CLOSURE_EVIDENCE_CHANGED");
    const session = analyzeStructuredArtifact(selected[0].content).key_values;
    const currentState = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
    if (session.state !== "OPEN" || currentState.active_session !== sessionId || currentState.active_cycle !== "none")
      fail("STANDARD_SESSION_PRECLOSE_OWNER_CHANGED");
    const owned = artifacts.cycles().filter(row => analyzeStructuredArtifact(row.content).key_values.session_owner === sessionId);
    if (owned.length > 48 || owned.some(row => !["DONE", "NO_GO", "DROPPED"].includes(analyzeStructuredArtifact(row.content).key_values.state)))
      fail("STANDARD_SESSION_PRECLOSE_UNRESOLVED_CYCLES");
    const terminalCycle = owned.filter(row => row.cycle_id === cycleId);
    if (terminalCycle.length !== 1 || analyzeStructuredArtifact(terminalCycle[0].content).key_values.state !== observed.target_state)
      fail("STANDARD_SESSION_PRECLOSE_CLOSURE_EVIDENCE_CHANGED");
    const fixed = [selected[0].path, "CURRENT-STATE.md", "RUNTIME-STATE.md", "snapshots/context-snapshot.md", "baseline/current.md", "baseline/history.md", "index.md"];
    const ownedPaths = owned.map(row => row.path.slice(0, -10));
    const writers = new Set(["session_initialize", "session_mode_apply", "cycle_context_refresh", "cycle_initialize", "cycle_plan_record", "cycle_implementation_enter",
      "cycle_task_advance", "cycle_verification_enter", "cycle_close_record", "cycle_close_finalize", "baseline_promotion_record", "baseline_promotion_finalize"]);
    const approved = new Map(), journals = [];
    for (const event of instance.events.filter(row => row.kind === "operation_result" && row.receipt.outcome === "completed")) {
      const record = retained(event.receipt.operation_id).record;
      if (!writers.has(record.intent.binding_ref)) continue;
      const result = record.results.find(row => shadowHash(row.receipt) === shadowHash(event.receipt));
      if (record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id || result?.output.effect_status !== "confirmed"
        || record.preview.binding.executor_kind !== "deterministic") fail("STANDARD_SESSION_PRECLOSE_WRITER_REQUIRED");
      journals.push({ operation_id: record.operation_id, output_sha256: shadowHash(result.output) });
      for (const row of result.output.evidence_refs) if (row.ref.startsWith("docs/audit/")) {
        const name = row.ref.slice(11);
        if (!fixed.includes(name) && !ownedPaths.some(parent => name.startsWith(parent + "/"))) fail("STANDARD_SESSION_PRECLOSE_WRITER_SCOPE_INVALID");
        approved.set(name, row.sha256);
      }
    }
    const prior = instance.events.filter(row => row.kind === "operation_result" && row.receipt.outcome === "completed")
      .map(row => retained(row.receipt.operation_id).record).filter(row => ["cycle_terminal_checkpoint", "baseline_promotion_checkpoint"].includes(row.intent.binding_ref)).at(-1);
    if (!prior) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_REQUIRED");
    const checkpoint = acceptedForPromotion(instance, prior.operation_id, prior.intent.binding_ref);
    const git = checkpoint.output.observations.git, head = git?.commit_sha ?? git?.head;
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head ?? "") || checkpoint.output.effect_status !== "confirmed")
      fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_REQUIRED");
    return { closure_operation_id: input.closure_operation_id, session_id: sessionId, branch: closePlan.scope.branch, parent_head: head,
      completion_cycle_id: cycleId, material_sha256: shadowHash({ closure: closed.output, terminal, checkpoint: checkpoint.output, journals }),
      postimages: [...approved.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256, metadata_sha256: artifacts.metadataHash(path) })) };
  }
  const sessionPrecloseCheckpoint = processAuthority ? createStandardSessionPrecloseCheckpoint({ targetRoot, now, readSource: readSessionPrecloseSource,
    readCurrent: id => current(id).record }) : null;
  function readSessionCloseHookSource(instance, input) {
    const recorded = readAcceptedSessionCloseRecord(instance, input), review = recorded.question.review;
    const checkpoint = acceptedForPromotion(instance, input.checkpoint_operation_id, "session_close_checkpoint", "STANDARD_SESSION_CLOSE_CHECKPOINT_REQUIRED");
    const cp = checkpoint.record.preview.prepared.plan, source = readSessionCheckpointSource(instance, input);
    const startId = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "session_start_finalize").at(-1)?.intent.operation_id;
    if (!startId || cp.input.record_operation_id !== input.record_operation_id || cp.source_sha256 !== shadowHash(source)) fail("STANDARD_SESSION_CLOSE_CHECKPOINT_REQUIRED");
    const start = acceptedForPromotion(instance, startId, "session_start_finalize", "STANDARD_SESSION_CLOSE_START_REQUIRED");
    if (start.record.preview.input.session_id !== review.session_id) fail("STANDARD_SESSION_CLOSE_START_REQUIRED");
    return { record_operation_id: input.record_operation_id, checkpoint_operation_id: input.checkpoint_operation_id,
      session_id: review.session_id, session_path: review.session_path, mode: review.mode, branch: review.branch,
      record_plan_sha256: shadowHash(recorded.plan), record_output_sha256: shadowHash(recorded.recorded.output),
      start_output: start.output, checkpoint_output: checkpoint.output };
  }
  const sessionCloseHook = processAuthority ? createStandardSessionCloseHook({ targetRoot, now, readSource: readSessionCloseHookSource,
    readCurrent: id => current(id).record }) : null;
  async function readSessionDeliverySource(instance, input) {
    const closed = acceptedForPromotion(instance, input.finalization_operation_id, "session_close_finalize", "STANDARD_SESSION_DELIVERY_FINALIZATION_REQUIRED");
    const plan = closed.record.preview.prepared.plan, output = closed.output, observed = output.observations;
    if (output.effect_status !== "confirmed" || output.facts.session_close_completed !== true || plan.operation_id !== input.finalization_operation_id
      || observed.run_id !== plan.run_id || observed.event_file !== ".aidn/runtime/perf/workflow-events.ndjson") fail("STANDARD_SESSION_DELIVERY_FINALIZATION_REQUIRED");
    const checkpoint = acceptedForPromotion(instance, plan.input.checkpoint_operation_id, "session_close_checkpoint");
    if (checkpoint.output.facts.session_close_checkpoint_completed !== true || checkpoint.output.observations.record_operation_id !== plan.input.record_operation_id
      || (checkpoint.output.observations.git?.commit_sha ?? checkpoint.output.observations.git?.head) !== plan.head) fail("STANDARD_SESSION_DELIVERY_CHECKPOINT_REQUIRED");
    const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, observed.event_file)), { json: false, maxBytes: 4194304 }).value;
    const offset = observed.event_offset, end = Number.isSafeInteger(offset) ? bytes.indexOf(10, offset) : -1;
    if (!Number.isSafeInteger(offset) || offset < 0 || end < offset || offset && bytes[offset - 1] !== 10) fail("STANDARD_SESSION_DELIVERY_EVENT_CHANGED");
    const event = JSON.parse(bytes.subarray(offset, end).toString("utf8"));
    if (shadowHash(event) !== shadowHash(observed.event) || event.event !== "hook_session_close" || event.run_id !== plan.run_id || event.result !== "ok"
      || event.mode !== plan.mode || event.branch !== plan.branch) fail("STANDARD_SESSION_DELIVERY_EVENT_CHANGED");
    const session = analyzeStructuredArtifact(artifacts.read(plan.session_path, { required: true }).content).key_values;
    const currentState = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
    if (session.state !== "CLOSED" || session.session_closure_status !== "completed" || currentState.active_session !== plan.session_id
      || currentState.active_cycle !== "none" || currentState.session_closure_status !== "completed") fail("STANDARD_SESSION_DELIVERY_OWNER_CHANGED");
    const names = sessionClosePaths(plan.session_path), postimages = names.map(name => {
      const refs = output.evidence_refs.filter(row => row.ref === "docs/audit/" + name), prior = plan.documents.find(row => row.path === name);
      if (refs.length !== 1 || !prior || artifacts.read(name, { required: true }).sha256 !== refs[0].sha256
        || artifacts.metadataHash(name) !== prior.metadata_sha256) fail("STANDARD_SESSION_DELIVERY_POSTIMAGE_CHANGED");
      return { path: name, sha256: refs[0].sha256, metadata_sha256: prior.metadata_sha256 };
    });
    if (shadowHash(observed.committed) !== shadowHash(names)) fail("STANDARD_SESSION_DELIVERY_POSTIMAGE_CHANGED");
    return { finalization_operation_id: input.finalization_operation_id, session_id: plan.session_id, session_path: plan.session_path,
      branch: plan.branch, parent_head: plan.head, material_sha256: shadowHash({ finalization: output, checkpoint: checkpoint.output }), postimages };
  }
  const sessionDeliveryCheckpoint = processAuthority ? createStandardSessionDeliveryCheckpoint({ targetRoot, now, readSource: readSessionDeliverySource,
    readCurrent: id => current(id).record }) : null;
  const integrationAuthority = processAuthority ? createStandardSessionBranchIntegrationAuthority({ targetRoot,
    readAcceptedOperation: acceptedForPromotion, readDeliverySource: readSessionDeliverySource }) : null;
  const sessionBranchIntegration = integrationAuthority ? createStandardSessionBranchIntegration({ targetRoot, now,
    readSource: (instance, input) => integrationAuthority.readSource(instance, input), readCurrent: id => current(id).record,
    async readDecision(instance, input) {
      const selected = acceptedForPromotion(instance, input.decision_operation_id, "session_branch_integration_decision", "STANDARD_SESSION_INTEGRATION_DECISION_REQUIRED");
      await human.verifyCaptured(selected.record);
      const capture = human.captured(selected.record), question = human.question(selected.record), output = selected.output;
      if (output.effect_status !== "no_effect" || output.facts.session_branch_integration_requested !== true || output.observations.choice !== "integrate-to-session"
        || output.observations.source_sha256 !== shadowHash(capture.source) || output.observations.question_sha256 !== shadowHash(question)
        || output.observations.review_sha256 !== shadowHash(question.review)) fail("STANDARD_SESSION_INTEGRATION_DECISION_REQUIRED");
      return { decision_operation_id: input.decision_operation_id, choice: capture.source.choice,
        source_sha256: shadowHash(capture.source), plan: selected.record.preview.prepared.plan };
    } }) : null;
  const sessionPrAdmission = integrationAuthority ? createStandardSessionPrAdmission({ targetRoot,
    async readIntegration(instance, input) {
      const selected = acceptedForPromotion(instance, input.integration_operation_id, "session_branch_integrate", "STANDARD_SESSION_PR_INTEGRATION_REQUIRED");
      const plan = selected.record.preview.prepared.plan;
      const canonical = await integrationAuthority.readSource(instance, { contract_version: "standard-session-branch-integration-review-input.v1",
        delivery_operation_id: plan.review.delivery_operation_id, closure_operation_id: plan.review.closure_operation_id });
      const { git, ...prior } = plan.review;
      if (shadowHash(canonical) !== shadowHash(prior)) fail("STANDARD_SESSION_PR_CONTEXT_CHANGED");
      return { integration_operation_id: input.integration_operation_id, plan_sha256: shadowHash(plan), plan, output: selected.output, canonical };
    } }) : null;
  async function readSessionPrAdmission(instance, input) {
    const selected = acceptedForPromotion(instance, input.admission_operation_id, "session_pr_admit", "STANDARD_SESSION_PUSH_ADMISSION_REQUIRED");
    const fresh = await sessionPrAdmission.prepare(instance, selected.record.preview.input);
    if (!fresh.can_apply || fresh.integration_source_sha256 !== selected.record.preview.prepared.integration_source_sha256)
      fail("STANDARD_SESSION_PUSH_ADMISSION_CHANGED");
    return { admission_operation_id: input.admission_operation_id, output: selected.output,
      integration_source_sha256: fresh.integration_source_sha256 };
  }
  const sessionPush = sessionPrAdmission && sessionPushPort ? createStandardSessionPush({ targetRoot, now, pushPort: sessionPushPort,
    readCurrent: id => current(id).record, readAdmission: readSessionPrAdmission }) : null;
  const sessionPrOpen = sessionPush && sessionPullRequestPort ? createStandardSessionPrOpen({ targetRoot, now, pullRequestPort: sessionPullRequestPort,
    readCurrent: id => current(id).record,
    async readPush(instance, input) {
      const selected = acceptedForPromotion(instance, input.push_operation_id, "session_push", "STANDARD_SESSION_PR_OPEN_PUSH_REQUIRED");
      const plan = selected.record.preview.prepared.plan, admission = await readSessionPrAdmission(instance, plan.input);
      if (shadowHash(admission) !== plan.admission_sha256 || selected.output.facts.session_remote_head_confirmed !== true)
        fail("STANDARD_SESSION_PR_OPEN_PUSH_CHANGED");
      const git = await sessionPushPort.inspect(plan.git.branch), result = selected.output.observations.git;
      if (git.head !== git.remote_head || git.head !== plan.git.head || git.local_sha256 !== plan.git.local_sha256
        || shadowHash({ ...git, changed: result.changed, effect_status: result.effect_status }) !== shadowHash(result)) fail("STANDARD_SESSION_PR_OPEN_REMOTE_CHANGED");
      return { push_operation_id: input.push_operation_id, output: selected.output, admission: admission.output,
        admission_source_sha256: shadowHash(admission) };
    } }) : null;
  const sessionGitCheckpoint = model.nodes.some(node => node.binding_ref === "session_git_checkpoint") ? createStandardWorkflowGitCheckpoint({ targetRoot, now, readCurrent: id => current(id).record,
    readContext(instance, input) {
      const context = acceptedForPromotion(instance, input.context_operation_id, "cycle_context_refresh", "STANDARD_GIT_ACCEPTED_CONTEXT_REQUIRED");
      const startId = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "session_start_finalize").at(-1)?.intent.operation_id;
      if (!startId) fail("STANDARD_GIT_ACCEPTED_START_REQUIRED");
      const start = acceptedForPromotion(instance, startId, "session_start_finalize", "STANDARD_GIT_ACCEPTED_START_REQUIRED");
      if (start.record.preview.input.session_id !== context.record.preview.prepared.plan.input.session_id) fail("STANDARD_GIT_ACCEPTED_START_REQUIRED");
      return { context_plan: context.record.preview.prepared.plan, context_output: context.output, start_operation_id: startId, start_output: start.output };
    } }) : null;
  const promotionAuthority = processAuthority ? createStandardBaselinePromotionAuthority({ targetRoot,
    readAcceptedOperation: acceptedForPromotion, readTerminalRecord: readAcceptedTerminalRecord,
    human: { question: record => human.question(record), captured: record => human.captured(record) } }) : null;
  const baselinePromotion = processAuthority ? createStandardBaselinePromotion({ targetRoot, now,
    readRequest: (instance, input) => promotionAuthority.readRequest(instance, input),
    observeProduct: () => processAuthority.observeProduct(), readCurrent: id => current(id).record }) : null;
  const promotionReview = processAuthority ? createStandardBaselinePromotionReview({
    readClosure: (instance, input) => promotionAuthority.readClosure(instance, input), promotion: baselinePromotion, now }) : null;

  async function readAcceptedBaselineRecord(instance, input) {
    const selected = acceptedForPromotion(instance, input.record_operation_id, "baseline_promotion_record"), plan = selected.record.preview.prepared.plan;
    const source = await promotionAuthority.readRequest(instance, plan.input);
    if (baselinePromotionSourceMaterialSha256(source) !== plan.source_material_sha256
      || selected.output.effect_status !== "confirmed" || selected.output.facts.baseline_recorded !== true || selected.output.facts.baseline_promotion_completed !== false)
      fail("STANDARD_PROMOTION_HOOK_RECORD_REQUIRED");
    return { record_operation_id: selected.record.operation_id, plan, output: selected.output };
  }
  async function readAcceptedPromotionCheckpointSource(instance, input) {
    const promoted = await readAcceptedBaselineRecord(instance, { record_operation_id: input.record_operation_id });
    const closure = acceptedForPromotion(instance, input.closure_operation_id, "cycle_close_finalize"), closedPlan = closure.record.preview.prepared.plan;
    const checkpoint = acceptedForPromotion(instance, input.terminal_checkpoint_operation_id, "cycle_terminal_checkpoint"), checkpointPlan = checkpoint.record.preview.prepared.plan;
    if (promoted.plan.request.closure_operation_id !== input.closure_operation_id
      || closedPlan.input.closure_operation_id !== checkpointPlan.input.closure_operation_id
      || checkpointPlan.cycle_id !== promoted.plan.request.cycle_id || checkpointPlan.cycle_path !== promoted.plan.request.cycle_path
      || closure.output.effect_status !== "confirmed" || closure.output.facts.cycle_close_completed !== true || closure.output.facts.cycle_retained !== true
      || checkpoint.output.effect_status !== "confirmed" || checkpoint.output.facts.cycle_terminal_checkpoint_completed !== true
      || checkpointPlan.target_state !== "DONE") fail("STANDARD_PROMOTION_CHECKPOINT_PROVENANCE_REQUIRED");
    const approved = new Map();
    for (const ref of closure.output.evidence_refs) if (ref.ref.startsWith("docs/audit/")) approved.set(ref.ref.slice(11), ref.sha256);
    for (const row of promoted.plan.changes) approved.set(row.path, row.after_sha256);
    const expected = [...baselinePromotionPaths, promoted.plan.request.cycle_path + "/status.md"].sort();
    if (shadowHash([...approved.keys()].sort()) !== shadowHash(expected)) fail("STANDARD_PROMOTION_CHECKPOINT_POSTIMAGES_REQUIRED");
    const git = checkpoint.output.observations.git;
    return { request: promoted.plan.request, session_id: checkpointPlan.session_id,
      source_material_sha256: shadowHash({ promoted, closure: { plan: closedPlan, output: closure.output }, checkpoint: { plan: checkpointPlan, output: checkpoint.output } }),
      record_context_sha256: promoted.output.observations.causal_transition.after_context_sha256,
      completion_boundary_sha256: promoted.output.observations.causal_transition.completion_boundary_sha256,
      parent_head: git.commit_sha ?? git.head, approved_postimages: [...approved.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })) };
  }
  const baselinePromotionCheckpoint = processAuthority && model.nodes.some(node => node.binding_ref === "baseline_promotion_checkpoint")
    ? createStandardBaselinePromotionCheckpoint({ targetRoot, now, readSource: readAcceptedPromotionCheckpointSource,
      promotion: baselinePromotion, readCurrent: id => current(id).record }) : null;
  const baselinePromotionHook = processAuthority ? createStandardBaselinePromotionHook({ targetRoot, now,
    readRecorded: readAcceptedBaselineRecord, promotion: baselinePromotion, readCurrent: id => current(id).record }) : null;

  async function readValidationEvaluation(instance, input, operation = "cycle_verification_enter") {
      assertStandardOperationInput(operation, input);
      const record = retained(input.evaluation_operation_id).record, result = record.results.at(-1);
      if (record.intent.binding_ref !== "cycle_validation_evaluate" || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || record.phase !== "receipted" || result?.receipt.outcome !== "completed"
        || !instance.events.some(row => row.kind === "operation_result" && shadowHash(row.receipt) === shadowHash(result.receipt))) fail("STANDARD_VERIFICATION_EVALUATION_REQUIRED");
      const verified = await evaluateValidation(instance, record.preview.input);
      if (shadowHash(verified.output) !== shadowHash(result.output)) fail("STANDARD_VERIFICATION_EVALUATION_STALE");
      return { output: verified.output, evaluation_sha256: shadowHash(verified.output), context: verified.source.context, context_sha256: verified.source.context_sha256, source: verified.source, evidence: verified.evidence };
  }
  const cycleVerification = processAuthority ? createStandardCycleVerification({ targetRoot, now,
    readEvaluation: readValidationEvaluation, observeContext: () => processAuthority.observeCycleVerificationContext(), readCurrent: id => current(id).record }) : null;
  const cycleTaskAdvance = processAuthority ? createStandardCycleTaskAdvance({ targetRoot, now,
    readEvaluation: (instance, input) => readValidationEvaluation(instance, input, "cycle_task_advance"),
    observeContext: () => processAuthority.observeCycleReadinessContext(), readCurrent: id => current(id).record }) : null;
  const recoveryCycle = processAuthority ? createStandardDriftCycle({ targetRoot, operations, now,
    readSource: (instance, operation, input) => cycleRecoverySource(instance, operation, input),
    observeContext: () => processAuthority.observeDriftContext(), readCurrent: id => current(id).record }) : null;
  const bindings = new Map(standardWorkflowOperationBindings().map(value => [value.id, value]));
  for (const node of model.nodes.filter(node => node.kind === "operation"))
    if (!bindings.has(node.binding_ref) || model.operation_pins[node.binding_ref] !== shadowHash(bindings.get(node.binding_ref))) fail("STANDARD_HOST_BINDING_CHANGED");
  const signer = createOperationJournalSigner(readSigningKey), generation = randomUUID(), initial = readWorkflowProjectAuthority({ targetRoot });
  const options = { targetRoot, stateMode: initial.stateMode }, store = createAgenticProcessStore(options), journal = createProcessOperationJournalStore(options);
  const projectionRequired = initial.stateMode === "dual" || initial.stateMode === "files" && agenticProcessPersistence({ targetRoot }).backend === "postgres";
  const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, source: humanSource,
    projectionRequired });
  const controls = createStandardControlInbox({ store: createProcessControlInboxStore(options), signer, source: controlSource,
    projectionRequired });
  function readAuthority() {
    if (processAuthority) return processAuthority.read();
    const project = readWorkflowProjectAuthority({ targetRoot }), persistence = agenticProcessPersistence({ targetRoot });
    if (project.stateMode !== initial.stateMode) fail("STANDARD_HOST_STATE_MODE_CHANGED");
    return { scope_id: shadowHash({ project: project.scope, persistence: persistence.binding_sha256,
      operation_host: { version: 1, state_mode: project.stateMode, key_id: signer.keyId, ...(source ? { model_source_sha256: shadowHash(source) } : {}),
        ...(controlSource ? { control_inbox_version: 1 } : {}) } }), model_sha256: shadowHash(model), policy_pins: agenticPolicyPins(model) };
  }
  function scope(instance) {
    const authority = readAuthority();
    if (instance.scope_id !== authority.scope_id || instance.model_sha256 !== authority.model_sha256
      || shadowHash(instance.policy_pins) !== shadowHash(authority.policy_pins)) fail("STANDARD_HOST_AUTHORITY_CHANGED");
  }
  function snapshot() {
    if (processAuthority) return processAuthority.snapshot();
    return { ...(source ? { model_source: source } : {}), context: operations.observeScope(), documents: ["CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "baseline/current.md", "snapshots/context-snapshot.md"]
      .map(path => { const row = artifacts.read(path, { required: true }); return { path, sha256: row.sha256 }; }) };
  }
  function validatePreview(preview) {
    if (validateJsonSchema(preview, previewSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_HOST_PREVIEW_INVALID");
    signer.verify(preview); assertProcessOperationBinding(preview.binding); assertStandardOperationInput(preview.binding.id, preview.input);
    assertStandardResolvedPreview(preview, model);
    if (shadowHash(bindings.get(preview.binding.id)) !== shadowHash(preview.binding)) fail("STANDARD_HOST_BINDING_CHANGED");
    return preview;
  }
  function retained(id) {
    const value = journal.read(id);
    if (!value.record) fail("PROCESS_JOURNAL_NOT_FOUND");
    signer.verify(value.record); validatePreview(value.record.preview);
    if (value.record.preview.binding.executor_kind === "human" && value.record.results.length) human.captured(value.record);
    return value;
  }
  function persist(body, expected) {
    const record = signer.seal(body), result = journal.compareAndSwap(record, expected);
    if (result.projection === "pending") {
      try { journal.materialize(record.operation_id, { write: true }); }
      catch { fail("PROCESS_JOURNAL_PROJECTION_RECONCILIATION_REQUIRED"); }
    }
    return record;
  }
  async function grantFor(preview, signal) {
    if (["read-only", "preview"].includes(preview.binding.effect_class)) return null;
    const controller = new AbortController(); let timer;
    const pending = Promise.resolve().then(() => authorize({ binding: structuredClone(preview.binding), input: structuredClone(preview.input),
      preview_sha256: shadowHash(preview), prepared: structuredClone(preview.prepared), scope_id: preview.scope_id, signal: signal ?? controller.signal }));
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("STANDARD_HOST_AUTHORIZATION_TIMEOUT"), { code: "STANDARD_HOST_AUTHORIZATION_TIMEOUT" })); }, 5000); });
    let grant;
    try { grant = await Promise.race([pending, timeout]); } finally { clearTimeout(timer); controller.abort(); }
    if (!grant || Object.keys(grant).sort().join(",") !== "authority_id,authorized,grant_sha256,principal_sha256" || grant.authorized !== true
      || !processId(grant.authority_id) || ![grant.principal_sha256, grant.grant_sha256].every(value => /^[a-f0-9]{64}$/.test(value))) fail("STANDARD_HOST_AUTHORIZATION_REQUIRED");
    return grant;
  }
  async function verifyGrant(record, signal) {
    if (shadowHash(await grantFor(record.preview, signal)) !== shadowHash(record.grant)) fail("STANDARD_HOST_AUTHORIZATION_CHANGED");
  }
  let service;
  const authority = {
    prepare({ instance, occurrence }) {
      const record = retained(operationJournalId(instance, occurrence.occurrence_id)).record;
      if (record.phase !== "staged" || record.intent.instance_sha256 !== instance.instance_sha256) fail("PROCESS_OPERATION_INTENT_BINDING_CHANGED");
      return { binding: record.preview.binding, intent: record.intent };
    },
    async verifyIntent({ intent, binding, instance, signal }) {
      scope(instance); const record = retained(intent.operation_id).record; await verifyGrant(record, signal);
      if (shadowHash(intent) !== shadowHash(record.intent) || shadowHash(binding) !== shadowHash(record.preview.binding)) fail("PROCESS_OPERATION_INTENT_NOT_AUTHENTICATED");
      return { outcome: "verified", authority_id: intent.authority_id, intent_sha256: shadowHash(intent), binding_sha256: shadowHash(binding) };
    },
    readReceipt({ receipt_id, intent }) {
      const record = retained(intent.operation_id).record, result = record.results.at(-1);
      if (record.phase !== "receipted" || result?.receipt.receipt_id !== receipt_id || shadowHash(record.intent) !== shadowHash(intent)) fail("PROCESS_OPERATION_RECEIPT_UNAVAILABLE");
      return result.receipt;
    },
    async verifyReceipt({ receipt, intent, instance, signal }) {
      scope(instance); const record = retained(intent.operation_id).record; await verifyGrant(record, signal);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(instance, record.preview.prepared.plan);
      if (record.preview.binding.executor_kind === "human") await human.verifyCaptured(record, signal);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(instance, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(instance, record.preview.prepared.plan);
      if (shadowHash(record.results.at(-1)?.receipt) !== shadowHash(receipt) || shadowHash(record.intent) !== shadowHash(intent)) fail("PROCESS_OPERATION_RESULT_NOT_AUTHENTICATED");
      return { outcome: "verified", authority_id: receipt.authority_id, receipt_sha256: shadowHash(receipt), intent_sha256: shadowHash(intent) };
    },
  };
  const controlAuthority = controlSource ? {
    read({ delivery_id }) { return controls.read(delivery_id).delivery; },
    async verify({ delivery, signal }) {
      const capture = controls.read(delivery.delivery_id);
      if (shadowHash(snapshot()) !== capture.request.context_sha256) fail("PROCESS_CONTROL_CONTEXT_CHANGED");
      const verified = await controls.verifyDelivery(delivery.delivery_id, signal);
      if (shadowHash(snapshot()) !== capture.request.context_sha256 || shadowHash(verified) !== shadowHash(delivery)) fail("PROCESS_CONTROL_CONTEXT_CHANGED");
      return { outcome: "verified", authority_id: delivery.authority_id, delivery_sha256: shadowHash(delivery) };
    },
  } : undefined;
  service = createAgenticProcessService({ store, readAuthority, operationAuthority: authority, controlAuthority, authorityTimeoutMs: 5000 });
  const current = id => {
    const value = service.inspect(id); scope(value.record);
    if (processAuthority) { processAuthority.authenticate(value.record); return value; }
    if (Object.keys(value.record.initial_facts).length) fail("STANDARD_HOST_AUTHENTICATED_FACTS_REQUIRED");
    // Replay proves structure, not origin. Reopening a host must authenticate
    // every earlier operation result against its durable host journal as well.
    const seen = new Map();
    for (const event of value.record.events) {
      if (["facts", "message", "assign", "result"].includes(event.kind)) fail("STANDARD_HOST_HISTORY_AUTHORITY_REQUIRED");
      if (event.kind === "control") {
        const capture = controls.read(event.delivery.delivery_id);
        if (shadowHash(capture.delivery) !== shadowHash(event.delivery)
          || capture.phase === "delivered" && capture.delivered_instance_sha256 !== controlCheckpoint(value.record, event.event_id)) fail("STANDARD_HOST_CONTROL_HISTORY_NOT_AUTHENTICATED");
        continue;
      }
      const id = event.kind === "operation_intent" ? event.intent.operation_id : event.kind === "operation_result" ? event.receipt.operation_id : null;
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, retained(id).record);
      const record = seen.get(id);
      if (event.kind === "operation_intent" && shadowHash(event.intent) !== shadowHash(record.intent)
        || event.kind === "operation_result" && !record.results.some(result => shadowHash(result.receipt) === shadowHash(event.receipt))) fail("STANDARD_HOST_RESULT_HISTORY_NOT_AUTHENTICATED");
    }
    return value;
  };
  function requireWrite(write, expected, actual) { if (write !== true || expected !== actual) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED"); }
  function controlRequest({ instanceId, expectedSha256, occurrenceId }) {
    if (!controlSource) fail("PROCESS_CONTROL_AUTHORITY_UNAVAILABLE");
    const state = current(instanceId);
    if (state.record.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
    const frame = state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId), node = frame && model.nodes.find(row => row.id === frame.node_id);
    if (node?.kind !== "event" || frame.status !== "WAITING") fail("PROCESS_CONTROL_ORDER_INVALID");
    const context = snapshot();
    return assertControlRequest({ contract_version: "process-control-request.v1", scope_id: state.record.scope_id,
      instance_id: state.record.instance_id, instance_sha256: state.record.instance_sha256, model_sha256: state.record.model_sha256,
      instance_revision: state.record.revision, occurrence_id: occurrenceId, correlation_id: frame.correlation_id,
      event_keys: node.branches.map(row => row.event_key), context_sha256: shadowHash(context), branch: context.context.branch, head: context.context.head });
  }
  function decisionInput(instance, input) {
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "mode_decision").at(-1);
    if (!latest || latest.intent.operation_id !== input.decision_operation_id) fail("STANDARD_MODE_DECISION_REQUIRED");
    const record = retained(input.decision_operation_id).record, receipt = record.results.at(-1)?.receipt;
    if (receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_MODE_DECISION_NOT_ACCEPTED");
    const source = human.captured(record).source;
    if (!["THINKING", "EXPLORING", "COMMITTING"].includes(source.choice)) fail("STANDARD_MODE_DECISION_REQUIRED");
    if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_MODE_DECISION_STALE");
    return { session_id: record.preview.input.session_id, mode: source.choice };
  }
  function resultReceipt(record, output) {
    assertStandardOperationOutput(output);
    return { contract_version: "process-operation-receipt.v1", receipt_id: receiptId(record.operation_id), operation_id: record.operation_id,
      intent_sha256: shadowHash(record.intent), authority_id: record.intent.authority_id, outcome: output.outcome, effect_status: output.effect_status,
      output_sha256: shadowHash(output), facts: output.facts,
      // Physical proof filenames belong to the authenticated output document.
      // The reducer receipt carries its bounded logical reference, not a second
      // copy constrained by the receipt URI grammar.
      evidence_refs: [{ ref: operationOutputRef(record.operation_id), sha256: shadowHash(output) }] };
  }
  async function recoveryDecision(instance, input) {
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "drift_recovery_decision").at(-1);
    if (!latest || latest.intent.operation_id !== input.decision_operation_id) fail("STANDARD_RECOVERY_DECISION_REQUIRED");
    const record = retained(input.decision_operation_id).record, receipt = record.results.at(-1)?.receipt;
    if (receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_RECOVERY_DECISION_NOT_ACCEPTED");
    const choice = human.captured(record).source.choice, review = record.preview.prepared.plan;
    if (!review.options.some(row => row.choice === choice)) fail("STANDARD_RECOVERY_CHOICE_REQUIRED");
    await recovery.assertFresh(instance, review);
    return { review, choice, decision_operation_id: input.decision_operation_id };
  }
  function recordedRecovery(instance, input, allowedChoices = ["requirements_delta"]) {
    const latest = binding => instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1)?.intent.operation_id;
    const accepted = (id, binding) => {
      const record = retained(id).record, receipt = record.results.at(-1)?.receipt;
      if (record.phase !== "receipted" || record.intent.binding_ref !== binding || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_CHANGE_REQUEST_ACCEPTED_RECOVERY_REQUIRED");
      return record;
    };
    if (latest("drift_recovery_record") !== input.recovery_record_operation_id) fail("STANDARD_CHANGE_REQUEST_ACCEPTED_RECOVERY_REQUIRED");
    const record = accepted(input.recovery_record_operation_id, "drift_recovery_record"), output = record.results.at(-1).output;
    const decision = accepted(record.preview.input.decision_operation_id, "drift_recovery_decision"), review = decision.preview.prepared.plan;
    const choice = human.captured(decision).source.choice;
    if (latest("drift_recovery_decision") !== decision.operation_id || latest("drift_report_evaluate") !== review.evaluation_operation_id
      || output.effect_status !== "confirmed" || output.facts.drift_recovery_recorded !== true
      || !allowedChoices.includes(choice) || output.observations.choice !== choice
      || shadowHash(record.preview.prepared.review) !== shadowHash(review)) fail("STANDARD_CHANGE_REQUEST_ACCEPTED_RECOVERY_REQUIRED");
    const evaluation = accepted(review.evaluation_operation_id, "drift_report_evaluate").results.at(-1).output;
    if (shadowHash(evaluation) !== review.evaluation_sha256 || evaluation.facts.drift_context_complete !== true || evaluation.facts.drift_present !== true
      || output.observations.causal_transition?.before_context_sha256 !== review.context_sha256) fail("STANDARD_CHANGE_REQUEST_ACCEPTED_RECOVERY_REQUIRED");
    return { record_operation_id: record.operation_id, choice, review, report: evaluation.observations.report, transition: output.observations.causal_transition };
  }
  function cycleRecoverySource(instance, operation, input) {
    function accepted(id, binding, effect = "confirmed") {
      const record = retained(id).record, output = record.results.at(-1)?.output, receipt = record.results.at(-1)?.receipt;
      const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1);
      if (latest?.intent.operation_id !== id || record.intent.binding_ref !== binding || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || record.phase !== "receipted" || receipt?.outcome !== "completed" || output?.effect_status !== effect
        || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_RECOVERY_CYCLE_SOURCE_REQUIRED");
      return { record, output };
    }
    function base(id) {
      const record = retained(id).record;
      if (record.intent.binding_ref === "drift_recovery_record") return recordedRecovery(instance, { recovery_record_operation_id: id }, ["new_cycle"]);
      const cr = accepted(id, "drift_change_request_record"), selected = recordedRecovery(instance, cr.record.preview.input);
      if (cr.output.facts.drift_change_request_recorded !== true || cr.output.observations.new_cycle_required !== true
        || cr.output.observations.recovery_record_operation_id !== selected.record_operation_id
        || cr.output.observations.causal_transition?.before_context_sha256 !== selected.transition.after_context_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_REQUIRED");
      return { ...selected, source_operation_id: id, transition: cr.output.observations.causal_transition };
    }
    if (operation === "drift_recovery_context_refresh") return base(input.recovery_operation_id);
    function contextSource(id) {
      const refreshed = accepted(id, "drift_recovery_context_refresh"), selected = base(refreshed.record.preview.input.recovery_operation_id);
      if (refreshed.output.facts.drift_recovery_context_refreshed !== true
        || refreshed.record.preview.prepared.plan.source_sha256 !== shadowHash(selected)
        || refreshed.output.observations.causal_transition?.before_context_sha256 !== selected.transition.after_context_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_REQUIRED");
      return { ...selected, source_operation_id: id, transition: refreshed.output.observations.causal_transition };
    }
    if (operation === "drift_recovery_checkpoint_observe") return contextSource(input.context_operation_id);
    const checked = accepted(input.checkpoint_operation_id, "drift_recovery_checkpoint_observe", "no_effect"), selected = contextSource(checked.record.preview.input.context_operation_id);
    if (checked.output.facts.drift_recovery_checkpoint_verified !== true || checked.record.preview.prepared.plan.source_sha256 !== shadowHash(selected)
      || checked.output.observations.causal_transition?.before_context_sha256 !== selected.transition.after_context_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_REQUIRED");
    return { ...selected, source_operation_id: input.checkpoint_operation_id, transition: checked.output.observations.causal_transition };
  }
  async function commitIntent(id, { write = false } = {}) {
    if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
    const record = retained(id).record, state = current(record.intent.instance_id);
    const existing = state.record.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id);
    if (existing) {
      if (shadowHash(existing.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_INTENT_CHANGED");
      return state;
    }
    if (record.phase !== "staged" || state.record.instance_sha256 !== record.intent.instance_sha256
      || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
    return service.prepareOperation({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256,
      occurrenceId: record.intent.occurrence_id, eventId: "intent_" + id.slice(3), write: true });
  }
  return Object.freeze({
    initialize(input) {
      if (input.facts && Object.keys(input.facts).length) fail("STANDARD_HOST_AUTHENTICATED_FACTS_REQUIRED");
      return service.initialize({ ...input, model, facts: {} });
    },
    inspect: id => current(id),
    prepareControl: input => structuredClone(controlRequest(input)),
    async captureControl({ instanceId, expectedSha256, occurrenceId, sourceRef, write = false }) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const request = controlRequest({ instanceId, expectedSha256, occurrenceId });
      const capture = await controls.reserve(request, sourceRef);
      if (!capture) return { status: "waiting_for_control", request };
      // A retained capture survives races/crashes, but may not wake a changed
      // instance or business context. Such a capture needs explicit reconciliation.
      const currentRequest = controlRequest({ instanceId, expectedSha256, occurrenceId });
      if (shadowHash(currentRequest) !== shadowHash(request)) fail("PROCESS_CONTROL_CONTEXT_CHANGED");
      return { status: "reserved", inbox_id: capture.inbox_id, delivery_sha256: shadowHash(capture.delivery) };
    },
    async deliverControl(id, { write = false } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      if (!controlSource) fail("PROCESS_CONTROL_AUTHORITY_UNAVAILABLE");
      const capture = controls.read(id), state = current(capture.request.instance_id), eventId = "control_" + id.slice(8);
      const retainedEvent = state.record.events.find(row => row.event_id === eventId);
      if (retainedEvent) {
        if (retainedEvent.kind !== "control" || shadowHash(retainedEvent.delivery) !== shadowHash(capture.delivery)) fail("STANDARD_HOST_CONTROL_HISTORY_NOT_AUTHENTICATED");
        controls.acknowledge(id, controlCheckpoint(state.record, eventId));
        let projection = "not_requested";
        if (projectionRequired) {
          try { store.materialize(state.record.instance_id, { write: true }); projection = "materialized"; }
          catch { projection = "reconciliation_required"; }
        }
        return { ...state, retained: true, projection };
      }
      if (capture.phase !== "reserved" || state.record.instance_sha256 !== capture.request.instance_sha256) fail("PROCESS_CONTROL_INSTANCE_CHANGED");
      const result = await service.deliverControl({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256,
        occurrenceId: capture.request.occurrence_id, deliveryId: capture.delivery.delivery_id, eventId, write: true });
      controls.acknowledge(id, result.record.instance_sha256);
      return result;
    },
    readControl: id => structuredClone(controls.read(id)),
    async preview({ instanceId, expectedSha256, occurrenceId, input = {} }) {
      const state = current(instanceId);
      if (state.record.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
      const occurrence = state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId);
      const node = occurrence && model.nodes.find(row => row.id === occurrence.node_id), binding = bindings.get(node?.binding_ref);
      if (!binding || !(occurrence.status === "READY" || occurrence.status === "WAITING" && ["blocked", "deferred"].includes(occurrence.operation?.receipt?.outcome))) fail("PROCESS_OPERATION_ORDER_INVALID");
      const resolved = resolveStandardProcessInput({ instance: state.record, occurrenceId, input, readOperation: id => retained(id).record });
      input = resolved.input;
      assertStandardOperationInput(binding.id, input);
      const prepared = binding.id === "baseline_promotion_checkpoint" ? await baselinePromotionCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PROMOTION_CHECKPOINT_AUTHORITY_REQUIRED")
        : binding.id === "cycle_terminal_checkpoint" ? await terminalCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_TERMINAL_CHECKPOINT_AUTHORITY_REQUIRED")
        : binding.id === "session_git_checkpoint" ? await sessionGitCheckpoint.prepare(state.record, input, operationJournalId(state.record, occurrenceId))
        : binding.id === "drift_report_evaluate" ? await processAuthority?.evaluateDriftReport(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : ["drift_recovery_context_refresh", "drift_recovery_checkpoint_observe", "drift_recovery_cycle_initialize"].includes(binding.id) ? await recoveryCycle?.prepare(state.record, binding.id, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_change_request_record" ? await changeRequest?.prepare(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "session_close_finalize" ? await sessionCloseHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_CLOSE_HOOK_AUTHORITY_REQUIRED")
        : binding.id === "session_pr_open" ? await sessionPrOpen?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PR_OPEN_TRANSPORT_REQUIRED")
        : binding.id === "session_push" ? await sessionPush?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PUSH_TRANSPORT_REQUIRED")
        : binding.id === "session_pr_admit" ? await sessionPrAdmission?.prepare(state.record, input) ?? fail("STANDARD_SESSION_PR_AUTHORITY_REQUIRED")
        : binding.id === "session_branch_integration_decision" ? await sessionBranchIntegration?.prepareDecision(state.record, input) ?? fail("STANDARD_SESSION_INTEGRATION_AUTHORITY_REQUIRED")
        : binding.id === "session_branch_integrate" ? await sessionBranchIntegration?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_INTEGRATION_AUTHORITY_REQUIRED")
        : binding.id === "session_delivery_checkpoint" ? await sessionDeliveryCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_DELIVERY_AUTHORITY_REQUIRED")
        : binding.id === "session_preclose_checkpoint" ? await sessionPrecloseCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_AUTHORITY_REQUIRED")
        : binding.id === "session_close_checkpoint" ? await sessionCloseCheckpoint?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_SESSION_CHECKPOINT_AUTHORITY_REQUIRED")
        : binding.id === "session_close_record" ? await sessionCloseRecord?.prepare(state.record, input) ?? fail("STANDARD_SESSION_CLOSE_AUTHORITY_REQUIRED")
        : binding.id === "session_closure_decision" ? await sessionClosureReview?.prepare(state.record, input) ?? fail("STANDARD_SESSION_CLOSURE_AUTHORITY_REQUIRED")
        : binding.id === "baseline_promotion_decision" ? await promotionReview?.prepare(state.record, input) ?? fail("STANDARD_PROMOTION_REVIEW_AUTHORITY_REQUIRED")
        : binding.id === "baseline_promotion_finalize" ? await baselinePromotionHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_PROMOTION_HOOK_AUTHORITY_REQUIRED")
        : binding.id === "baseline_promotion_record" ? await baselinePromotion?.prepare(state.record, input) ?? fail("STANDARD_PROMOTION_AUTHORITY_REQUIRED")
        : binding.id === "cycle_close_finalize" ? await cycleCloseHook?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_CYCLE_CLOSE_HOOK_AUTHORITY_REQUIRED")
        : binding.id === "cycle_close_record" ? await cycleCloseRecord?.prepare(state.record, input) ?? fail("STANDARD_CYCLE_CLOSE_AUTHORITY_REQUIRED")
        : binding.id === "cycle_closure_decision" ? await closureReview?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_CLOSURE_AUDIT_AUTHORITY_REQUIRED")
        : binding.id === "drift_recovery_decision" ? await recovery?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_recovery_record" ? await (async () => { const body = { ...await recoveryDecision(state.record, input), prepared_at_ms: now() };
          return { ...body, can_apply: true, plan_sha256: shadowHash(body) }; })()
        : binding.id === "drift_check_finalize" ? await driftFinalization?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "session_initialize" ? await operations.prepareSession(input)
        : binding.id === "session_mode_apply" ? await operations.prepareMode(decisionInput(state.record, input))
        : binding.id === "session_start_finalize" ? await operations.prepareStart(input)
        : binding.id === "cycle_context_refresh" ? await operations.prepareCycleContext(input)
        : binding.id === "cycle_initialize" ? await operations.prepareCycle(input)
        : binding.id === "cycle_checkpoint_finalize" ? await operations.prepareCycleCheckpoint(input)
        : binding.id === "cycle_plan_record" ? await cyclePlanRecord?.prepare(state.record, input) ?? fail("STANDARD_CYCLE_PLAN_AUTHORITY_UNAVAILABLE")
        : binding.id === "cycle_implementation_enter" ? await cycleImplementation?.prepare(state.record, input) ?? fail("STANDARD_CYCLE_READINESS_AUTHORITY_UNAVAILABLE")
        : binding.id === "cycle_validation_execute" ? await cycleValidation?.prepare(state.record, input) ?? fail("STANDARD_VALIDATION_AUTHORITY_UNAVAILABLE")
        : binding.id === "cycle_verification_enter" ? await cycleVerification?.prepare(state.record, input) ?? fail("STANDARD_VERIFICATION_AUTHORITY_UNAVAILABLE")
        : binding.id === "cycle_task_advance" ? await cycleTaskAdvance?.prepare(state.record, input) ?? fail("STANDARD_TASK_PROGRESS_AUTHORITY_UNAVAILABLE") : null;
      return signer.seal({ contract_version: "standard-operation-preview.v1", instance_id: instanceId, instance_sha256: expectedSha256,
        scope_id: state.record.scope_id, model_sha256: state.record.model_sha256, occurrence_id: occurrenceId, binding,
        input: ["session_initialize", "cycle_initialize"].includes(binding.id) ? prepared?.plan?.input ?? input : input,
        ...(resolved.input_resolution ? { input_resolution: resolved.input_resolution } : {}), prepared, snapshot: snapshot(), prepared_at_ms: now() });
    },
    async stage(preview, { write = false, expectedPreviewSha256 } = {}) {
      preview = structuredClone(preview);
      validatePreview(preview); requireWrite(write, expectedPreviewSha256, shadowHash(preview));
      const state = current(preview.instance_id), age = now() - preview.prepared_at_ms;
      if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_HOST_PREVIEW_EXPIRED");
      if (state.record.instance_sha256 !== preview.instance_sha256 || shadowHash(snapshot()) !== shadowHash(preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      if (model.data_bindings && shadowHash(resolveStandardProcessInput({ instance: state.record, occurrenceId: preview.occurrence_id,
        readOperation: id => retained(id).record }).input_resolution) !== shadowHash(preview.input_resolution)) fail("PROCESS_RESOLVED_INPUT_CHANGED");
      const grant = await grantFor(preview), id = operationJournalId(state.record, preview.occurrence_id);
      const intent = { contract_version: "process-operation-intent.v1", operation_id: id, binding_ref: preview.binding.id, binding_sha256: shadowHash(preview.binding),
        input_sha256: shadowHash(preview.input), preconditions_sha256: shadowHash({ snapshot: preview.snapshot, prepared: preview.prepared }),
        authorization_sha256: grant === null ? null : shadowHash(grant), authority_id: "standard_operation_host", scope_id: preview.scope_id,
        instance_id: preview.instance_id, instance_sha256: preview.instance_sha256, model_sha256: preview.model_sha256,
        occurrence_id: preview.occurrence_id, instance_revision: state.record.revision };
      const previous = journal.read(id);
      if (previous.record) {
        signer.verify(previous.record);
        if (shadowHash(previous.record.preview) !== shadowHash(preview) || shadowHash(previous.record.intent) !== shadowHash(intent)) fail("PROCESS_JOURNAL_ALREADY_STAGED");
      } else persist({ contract_version: "process-operation-journal.v1", operation_id: id, revision: 1, phase: "staged", preview,
        intent, grant, owner: null, results: [] }, null);
      const result = await commitIntent(id, { write: true });
      return { ...result, operation_id: id };
    },
    commitIntent,
    async dispatch(id, { write = false } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const before = retained(id), record = before.record, state = current(record.intent.instance_id);
      if (record.phase === "receipted") return { status: "retained_result", receipt: record.results.at(-1).receipt };
      if (record.phase !== "staged") return { status: "reconciliation_required", operation_id: id };
      const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
      if (frame?.status !== "WAITING" || !frame.operation || frame.operation.receipt || shadowHash(frame.operation.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_CANONICAL_INTENT_REQUIRED");
      if (record.preview.binding.executor_kind === "human") {
        if (record.intent.binding_ref === "drift_recovery_decision") await recovery.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "baseline_promotion_decision") await promotionReview.assertFresh(state.record, record.preview.prepared.plan);
        return { status: "waiting_for_human", question: human.question(record) };
      }
      await verifyGrant(record);
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      const { authentication, key_id, ...body } = record;
      const claimed = persist({ ...body, phase: "dispatching", revision: record.revision + 1, owner: { generation, pid: process.pid } }, before.content_sha256);
      let output;
      try {
        if (current(record.intent.instance_id).record.instance_sha256 !== state.record.instance_sha256)
          throw Object.assign(new Error("STANDARD_HOST_PROCESS_CHANGED"), { code: "STANDARD_HOST_PROCESS_CHANGED", effect_status: "no_effect" });
        if (record.intent.binding_ref === "context_reload") output = await operations.reload(record.preview.input);
        else if (record.intent.binding_ref === "session_admit") output = await operations.admitSession(record.preview.input);
        else if (record.intent.binding_ref === "session_close_admit") output = await operations.admitSessionClose(record.preview.input);
        else if (record.intent.binding_ref === "session_close_record") output = await sessionCloseRecord.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_pr_open") output = await sessionPrOpen.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_push") output = await sessionPush.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_pr_admit") output = await sessionPrAdmission.observe(state.record, record.preview.input);
        else if (record.intent.binding_ref === "session_branch_integrate") output = await sessionBranchIntegration.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_delivery_checkpoint") output = await sessionDeliveryCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_preclose_checkpoint") output = await sessionPrecloseCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_close_checkpoint") output = await sessionCloseCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_close_finalize") output = await sessionCloseHook.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_admit") output = await operations.admitCycle(record.preview.input);
        else if (record.intent.binding_ref === "branch_cycle_audit") output = await operations.auditCycle(record.preview.input);
        else if (record.intent.binding_ref === "drift_report_evaluate") output = await processAuthority?.evaluateDriftReport(state.record, record.preview.input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_plan_evaluate") output = await processAuthority?.evaluateCyclePlan(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_PLAN_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_readiness_evaluate") output = await processAuthority?.evaluateCycleReadiness(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_READINESS_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_work_evaluate") output = await processAuthority?.evaluateCycleWork(state.record, record.preview.input) ?? fail("STANDARD_CYCLE_WORK_AUTHORITY_UNAVAILABLE");
        else if (record.intent.binding_ref === "cycle_validation_evaluate") output = (await evaluateValidation(state.record, record.preview.input)).output;
        else if (record.intent.binding_ref === "cycle_audit_evaluate") output = await evaluateAudit(state.record, record.preview.input);
        else if (record.intent.binding_ref === "cycle_audit_select") output = await evaluateAuditSelection(state.record, record.preview.input);
        else if (record.intent.binding_ref === "cycle_task_select") output = await processAuthority.evaluateCycleTaskSelection(state.record, record.preview.input);
        else if (record.intent.binding_ref === "cycle_task_work_evaluate") output = await processAuthority.evaluateCycleTaskWork(state.record, record.preview.input);
        else if (record.intent.binding_ref === "drift_change_request_record") output = await changeRequest.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (!record.preview.prepared?.can_apply) output = { contract_version: record.preview.binding.output_contract, operation_ref: record.intent.binding_ref,
          outcome: "blocked", effect_status: "no_effect", facts: {}, observations: record.preview.prepared ?? {}, evidence_refs: [] };
        else if (["drift_recovery_context_refresh", "drift_recovery_checkpoint_observe", "drift_recovery_cycle_initialize"].includes(record.intent.binding_ref)) output = await recoveryCycle.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "drift_check_finalize") output = await driftFinalization.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "drift_recovery_record") {
          try {
            const selected = await recoveryDecision(state.record, record.preview.input);
            if (shadowHash(selected.review) !== shadowHash(record.preview.prepared.review) || selected.choice !== record.preview.prepared.choice) fail("STANDARD_RECOVERY_DECISION_CHANGED");
          } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
          output = await recovery.apply(state.record, record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        }
        else if (record.intent.binding_ref === "session_initialize") output = await operations.initializeSession(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        else if (record.intent.binding_ref === "session_mode_apply") {
          if (shadowHash(decisionInput(state.record, record.preview.input)) !== shadowHash(record.preview.prepared.plan.input)) fail("STANDARD_MODE_DECISION_CHANGED");
          output = await operations.applyMode(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        } else if (record.intent.binding_ref === "baseline_promotion_checkpoint") output = await baselinePromotionCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_terminal_checkpoint") output = await terminalCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "session_git_checkpoint") output = await sessionGitCheckpoint.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_context_refresh") output = await operations.refreshCycleContext(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        else if (record.intent.binding_ref === "cycle_initialize") output = await operations.initializeCycle(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        else if (record.intent.binding_ref === "baseline_promotion_finalize") output = await baselinePromotionHook.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "baseline_promotion_record") output = await baselinePromotion.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_close_finalize") output = await cycleCloseHook.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_close_record") output = await cycleCloseRecord.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_plan_record") output = await cyclePlanRecord.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_implementation_enter") output = await cycleImplementation.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_validation_execute") output = await cycleValidation.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_verification_enter") output = await cycleVerification.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_task_advance") output = await cycleTaskAdvance.apply(state.record, record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record) });
        else if (record.intent.binding_ref === "cycle_checkpoint_finalize") output = await operations.finalizeCycleCheckpoint(record.preview.prepared,
          { write: true, expectPlan: record.preview.prepared.plan_sha256, assertAuthorized: () => verifyGrant(record),
            assertCurrent: () => { if (current(state.record.instance_id).record.instance_sha256 !== state.record.instance_sha256) fail("STANDARD_CYCLE_CHECKPOINT_PROCESS_CHANGED"); } });
        else output = await operations.finalizeStart(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        if (record.preview.binding.effect_class === "read-only" && shadowHash(snapshot()) !== shadowHash(record.preview.snapshot))
          throw Object.assign(new Error("STANDARD_HOST_PRECONDITIONS_CHANGED"), { effect_status: "no_effect" });
      } catch (cause) {
        const noEffect = record.preview.binding.effect_class === "read-only" || cause.effect_status === "no_effect" || cause.code === "STANDARD_PLAN_EXPIRED";
        output = { contract_version: record.preview.binding.output_contract, operation_ref: record.intent.binding_ref,
          outcome: noEffect ? "blocked" : "reconciliation_required", effect_status: noEffect ? "no_effect" : "unknown", facts: {},
          observations: { reason_code: /^[A-Z][A-Z0-9_]+$/.test(cause.code ?? "") ? cause.code : "STANDARD_HOST_DISPATCH_UNCONFIRMED" }, evidence_refs: [] };
      }
      const receipt = resultReceipt(record, output);
      const retainedClaim = retained(id);
      if (shadowHash(retainedClaim.record) !== shadowHash(claimed)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      const { authentication: oldMac, key_id: oldKey, ...claimedBody } = claimed;
      persist({ ...claimedBody, phase: "receipted", revision: claimed.revision + 1, results: [{ output, receipt }] }, retainedClaim.content_sha256);
      return { status: "receipted", receipt };
    },
    async receiveDecision(id, { sourceRef, write = false } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const before = retained(id), record = before.record, state = current(record.intent.instance_id);
      if (record.preview.binding.executor_kind !== "human" || !["session_branch_integration_decision", "session_closure_decision", "mode_decision", "drift_recovery_decision", "cycle_closure_decision", "baseline_promotion_decision"].includes(record.intent.binding_ref)) fail("PROCESS_HUMAN_OPERATION_REQUIRED");
      if (record.phase === "receipted") {
        const capture = human.captured(record);
        if (capture.source_ref !== sourceRef) fail("PROCESS_HUMAN_DECISION_ALREADY_CAPTURED");
        human.acknowledge(capture.inbox_id, record.results.at(-1).receipt);
        return { status: "retained_result", receipt: record.results.at(-1).receipt };
      }
      const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
      if (frame?.status !== "WAITING" || !frame.operation || frame.operation.receipt || shadowHash(frame.operation.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_CANONICAL_INTENT_REQUIRED");
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      if (record.intent.binding_ref === "drift_recovery_decision") await recovery.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "baseline_promotion_decision") await promotionReview.assertFresh(state.record, record.preview.prepared.plan);
      const capture = await human.reserve(record, sourceRef);
      if (!capture) return { status: "waiting_for_human", question: human.question(record) };
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      if (record.intent.binding_ref === "drift_recovery_decision") await recovery.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "cycle_closure_decision") await closureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_closure_decision") await sessionClosureReview.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "session_branch_integration_decision") await sessionBranchIntegration.assertFresh(state.record, record.preview.prepared.plan);
      if (record.intent.binding_ref === "baseline_promotion_decision") await promotionReview.assertFresh(state.record, record.preview.prepared.plan);
      const { authentication, key_id, ...body } = record;
      const claimed = record.phase === "staged" ? persist({ ...body, phase: "dispatching", revision: record.revision + 1, owner: { generation, pid: process.pid } }, before.content_sha256) : record;
      const output = human.output(claimed, capture), receipt = resultReceipt(claimed, output), latest = retained(id);
      if (shadowHash(latest.record) !== shadowHash(claimed)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      const { authentication: oldMac, key_id: oldKey, ...claimedBody } = claimed;
      persist({ ...claimedBody, phase: "receipted", revision: claimed.revision + 1, results: [{ output, receipt }] }, latest.content_sha256);
      human.acknowledge(capture.inbox_id, receipt);
      return { status: "receipted", receipt };
    },
    async accept(id, { write = false } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const record = retained(id).record, state = current(record.intent.instance_id);
      const receipt = record.results.at(-1)?.receipt;
      if (!receipt) fail("PROCESS_OPERATION_RECEIPT_UNAVAILABLE");
      return service.acceptOperation({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: record.intent.occurrence_id,
        eventId: "result_" + id.slice(3), receiptId: receipt.receipt_id, write: true });
    },
    readJournal: id => structuredClone(retained(id).record),
    readDecisionSource: ref => human.readSource(ref),
    readOutput(ref) {
      const match = /^aidn:operation-output\/(op_[a-f0-9]{40})\/(0|[1-9][0-9]?)$/.exec(ref);
      if (!match || Number(match[2]) >= 32) fail("PROCESS_JOURNAL_OUTPUT_REF_INVALID");
      const result = retained(match[1]).record.results[Number(match[2])];
      if (!result) fail("PROCESS_JOURNAL_OUTPUT_UNAVAILABLE");
      return structuredClone(result.output);
    },
  });
}
