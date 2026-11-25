import { createRetainedPostMergeDecisionSource } from './standard-retained-post-merge-decision-source.mjs';
import { retainedPostMergeDecisionContinuation } from '../../core/workflow/standard-retained-post-merge-decision.mjs';
import { createRetainedSessionIntegrationSource } from './standard-retained-session-integration-source.mjs';
import { createRetainedSessionPrOpenSource } from './standard-retained-session-pr-open-source.mjs';
import { retainedMergeCaptureContinuation } from '../../core/workflow/standard-retained-merge-capture.mjs';
import { createRetainedMergeCaptureSource } from './standard-retained-merge-capture-source.mjs';
import { createRetainedPostMergeSource } from './standard-retained-post-merge-source.mjs';
import { retainedPostMergeContinuation } from '../../core/workflow/standard-retained-post-merge.mjs';
import { retainedExternalMergeContinuation } from '../../core/workflow/standard-retained-external-merge.mjs';
import { createRetainedExternalMergeSource } from './standard-retained-external-merge-source.mjs';
import { retainedSessionPrOpenContinuation } from '../../core/workflow/standard-retained-session-pr-open.mjs';
import { retainedSessionIntegrationContinuation } from '../../core/workflow/standard-retained-session-integration.mjs';
import { readRetainedSessionCycleHistory as readSessionCycleHistory } from './standard-retained-session-cycle-history.mjs';
import { createRetainedSessionDeliverySource } from './standard-retained-session-delivery-source.mjs';
import { retainedSessionDeliveryContinuation } from '../../core/workflow/standard-retained-session-delivery.mjs';
import { createRetainedSessionCheckpointSource } from './standard-retained-session-checkpoint-source.mjs';
import { retainedSessionCheckpointContinuation } from '../../core/workflow/standard-retained-session-checkpoint.mjs';
import { createRetainedVerificationSource } from "./standard-retained-verification-source.mjs";
import { createRetainedAuditNativeOwnerAssertion } from "./retained-audit-native-owner.mjs";
import { retainedVerificationAdmit, assertRetainedVerificationOutput, retainedVerificationContinuation } from "../../core/workflow/standard-retained-verification.mjs";
import { retainedAuditContinuation } from "../../core/workflow/standard-retained-audit.mjs";
import auditInputV1 from "../../core/contracts/workflow-definition/standard-cycle-audit-evaluate-input.v1.schema.json" with { type: "json" };
import { createRetainedAuditSource } from "./standard-retained-audit-source.mjs";
import { createRetainedClosureSource } from "./standard-retained-closure-source.mjs";
import { retainedClosureContinuation } from "../../core/workflow/standard-retained-closure.mjs";
import { createRetainedCompletionSource } from './standard-retained-completion-source.mjs';
import { retainedCompletionContinuation } from '../../core/workflow/standard-retained-completion.mjs';
import { retainObjectiveAlignment } from '../../core/workflow/standard-drift-retained-objective.mjs';
import { createRetainedPromotionSource } from './standard-retained-promotion-source.mjs';
import { retainedPromotionContinuation } from '../../core/workflow/standard-retained-promotion.mjs';
import { createNativeReconciliationHistoryReader } from "./native-reconciliation-history.mjs";
import { createRetainedValidationSource } from "./standard-retained-validation-source.mjs";
import { retainedValidationAdmit, retainedTaskWork, workPhaseSelect, retainedValidationPins, assertRetainedValidationOutput, assertRetainedValidationProof } from "../../core/workflow/standard-retained-validation.mjs";
import { MODE_WORK_CONTRACT, evaluateStandardModeWork } from "../../core/workflow/standard-mode-work.mjs";
import { assertObjectiveReview } from "../../core/workflow/standard-drift-objective-review.mjs";
import { observeModeWorkReport, modeWorkContinuationChoices, modeWorkHandoffChoices, assertModeWorkObservationOutput } from "../../core/workflow/standard-mode-work-continuation.mjs";
import { readStandardModeWorkContext } from "./standard-mode-work-context.mjs";
import { readStandardCycleCloseContext } from "./standard-cycle-close-context.mjs";
import { PR_TRIAGE_CONTRACT } from "../../core/workflow/standard-pr-triage.mjs";
import { buildStandardPrTriageContext } from "./standard-pr-triage-context.mjs";
import { CYCLE_AUDIT_CONTRACT } from "../../core/workflow/standard-cycle-audit.mjs";
import { buildStandardCycleAuditContext } from "./standard-cycle-audit-context.mjs";
import { readWorkflowProjectAuthority, readWorkflowProjectExecutionAuthority } from "./workflow-instance-composition.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings, assertStandardWorkflowImplementation } from "./standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { operationJournalPath, createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createProcessControlInboxStore } from "../../adapters/runtime/process-control-inbox-store.mjs";
import { createProcessDecisionInboxStore } from "../../adapters/runtime/process-decision-inbox-store.mjs";
import { createNativeAllocationJournalStore } from "../../adapters/runtime/native-allocation-journal-store.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { postMergeRecoveryResult } from "../../core/workflow/standard-pr-post-merge-decision.mjs";
import { createStandardHumanDecisions } from "./standard-workflow-human-decisions.mjs";
import { nativeJournalId } from "../../core/workflow/native-allocation-journal.mjs";
import { readNativeAllocationCheckpoint, nativeEvidenceFile, nativeAllocationOutputId } from "./native-allocation-evidence.mjs";
import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { readStandardDriftContext, evaluateStandardDriftReport, captureStandardDriftContextFence } from "./standard-drift-report.mjs";
import { DRIFT_REPORT_CONTRACT, nativeActivityOutputSkill, assertNativeActivityAnswer } from "../../core/workflow/native-activity-output.mjs";
import { CYCLE_PLAN_CONTRACT } from "../../core/workflow/standard-cycle-planning.mjs";
import { CYCLE_PREWORK_CONTRACT } from "../../core/workflow/standard-cycle-prework.mjs";
import { createStandardCyclePreworkAuthority } from "./standard-cycle-prework-authority.mjs";
import { evaluateStandardCycleReadiness } from "../../core/workflow/standard-cycle-readiness.mjs";
import { runStartSessionAdmitUseCase } from "./start-session-admit-use-case.mjs";
import { readStandardCyclePlanContext, evaluateStandardCyclePlan } from "./standard-cycle-plan-context.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { assertStandardWorkflowModelSource, assertStandardWorkflowActivityOutputs } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { agenticProcessPrefixSha256, inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { processModels, processFrameNode } from "../../core/workflow/process-call-model.mjs";
import { assertAgenticProcessModel, agenticPolicyPins } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, freezeShadow, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import previewSchema from "../../core/contracts/workflow-definition/standard-operation-preview.v1.schema.json" with { type: "json" };
import { createRetainedSessionClosureSource } from './standard-retained-session-closure-source.mjs';
import { retainedSessionClosureContinuation } from '../../core/workflow/standard-retained-session-closure.mjs';
import path from "node:path";
import { resolveProcessOperationInput } from "../../core/workflow/process-input-resolution.mjs";
import { CYCLE_WORK_CONTRACT, CYCLE_TASK_WORK_CONTRACT, assertWorkProductSnapshot, observeStandardCycleWork, observeStandardCycleTaskWork } from "../../core/workflow/standard-cycle-work.mjs";
import { deriveStandardCycleTaskCursor, deriveStandardCanonicalResumeTaskCursor, renderStandardTaskProgress } from "../../core/workflow/standard-cycle-task-progress.mjs";
import { canonicalCycleResumeAdmissionOperations, ownedCanonicalCycleResumeAdmitOperation, canonicalCycleResumeObserveOperation, assertCanonicalResumeOutput, evaluateCanonicalResumeReadiness, assertCanonicalResumeObserveInput, assertCanonicalResumeObserveOutput } from "../../core/workflow/standard-canonical-cycle-resume.mjs";
import { assertCycleExecutionSourceSelection } from "../../core/workflow/standard-cycle-source-selection.mjs";
import { projectStandardCanonicalCycleProgress } from "../../core/workflow/standard-canonical-plan-projection.mjs";
import { renderStandardCyclePlan } from "../../core/workflow/standard-cycle-planning.mjs";
import { cycleWorkBoundary } from "./standard-drift-recovery.mjs";
import { assertStandardResolvedPreview } from "./standard-process-inputs.mjs";
import { assertProcessOperationBinding } from "../../core/workflow/process-operation-contracts.mjs";
import { assertResolvedProcessInput } from "../../core/workflow/process-data-contracts.mjs";
import { fileURLToPath } from "node:url";

const fail = code => { throw Object.assign(new Error(code), { code }); };
function assertHistoricalPreviewInput(preview, model) {
  // Contract names select retained data schemas in this fixed namespace, never
  // modules or paths from the process. Versioned v1 normalizations stay explicit.
  const contract = preview.binding.input_contract;
  if (!/^[a-z][a-z0-9_-]{0,110}\.v[1-9][0-9]*$/.test(contract)) fail("STANDARD_OPERATION_INPUT_INVALID");
  const schema = readAgentRunFile(fileURLToPath(new URL(`../../core/contracts/workflow-definition/${contract}.schema.json`, import.meta.url))).value;
  if (validateJsonSchema(preview.input, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OPERATION_INPUT_INVALID");
  if (!model.data_bindings) { if (Object.hasOwn(preview, "input_resolution")) fail("PROCESS_RESOLVED_INPUT_UNDECLARED"); return; }
  const value = assertResolvedProcessInput(preview.input_resolution);
  let input = value.input;
  if (contract === "standard-session-initialize-input.v1") input = { ...input, mode: input.mode ?? "UNKNOWN" };
  if (contract === "standard-cycle-initialize-input.v1") input = { ...input, objective: input.objective.replace(/\s+/gu, " ").trim() };
  if (value.instance_sha256 !== preview.instance_sha256 || value.occurrence_id !== preview.occurrence_id
    || value.bindings_sha256 !== shadowHash(model.data_bindings) || shadowHash(input) !== shadowHash(preview.input)) fail("PROCESS_RESOLVED_INPUT_CHANGED");
}
// New mixed instances have one authority. Legacy operation/native scopes remain
// unchanged; no caller-authored module, key, scope or history is accepted.
export function createStandardProcessAuthority({ configuration: suppliedConfiguration, model: supplied, modelSource = null, readSigningKey, humanSource = null, readProductSha256, readProductSnapshot, environment = process.env, nativeReservation = null }) {
  if (checkShadowJson(suppliedConfiguration)) fail("STANDARD_PROCESS_CONFIGURATION_INVALID");
  const configuration = freezeShadow(structuredClone(suppliedConfiguration));
  const model = freezeShadow(structuredClone(supplied)); assertAgenticProcessModel(model);
  if (model.contract_version !== "agentic-process-model.v2") fail("STANDARD_PROCESS_PROFILE_UNSUPPORTED");
  const modelsByHash = new Map(processModels(model).map(component => [shadowHash(component), component]));
  const source = modelSource === null ? null : freezeShadow(structuredClone(assertStandardWorkflowModelSource(modelSource, model)));
  if (source) assertStandardWorkflowActivityOutputs(source, model, configuration.activity_outputs);
  const signer = createOperationJournalSigner(readSigningKey), initial = readWorkflowProjectAuthority({ targetRoot: configuration.target_root });
  const options = { targetRoot: configuration.target_root, stateMode: initial.stateMode, env: environment };
  const operations = createStandardWorkflowOperations({ targetRoot: configuration.target_root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root });
  const bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row]));
  function assertCurrentBindings() {
    for (const component of processModels(model)) for (const node of component.nodes.filter(row => row.kind === "operation")) if (!bindings.has(node.binding_ref)
      || component.operation_pins[node.binding_ref] !== shadowHash(bindings.get(node.binding_ref))) fail("STANDARD_PROCESS_BINDING_CHANGED");
  }
  const operationStore = createProcessOperationJournalStore(options), controls = createProcessControlInboxStore(options), allocations = createNativeAllocationJournalStore(options), instances = createAgenticProcessStore(options);
  const retainedSource = createRetainedValidationSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedVerificationSource = createRetainedVerificationSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedAuditSource = createRetainedAuditSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedClosureSource = createRetainedClosureSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedCompletionSource = createRetainedCompletionSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedSessionCheckpointSource = createRetainedSessionCheckpointSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedSessionDeliverySource = createRetainedSessionDeliverySource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedSessionIntegrationSource = createRetainedSessionIntegrationSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedExternalMergeSource = createRetainedExternalMergeSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedMergeCaptureSource = createRetainedMergeCaptureSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedPostMergeDecisionSource = createRetainedPostMergeDecisionSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const postMergeSourceFor = point => point?.kind === 'retained_post_merge_decision' ? retainedPostMergeDecisionSource : retainedPostMergeSource;
  const postMergeContinuationFor = proof => proof.recorded_decision_operation_id ? retainedPostMergeDecisionContinuation(proof) : retainedPostMergeContinuation(proof);
  const retainedPostMergeSource = createRetainedPostMergeSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedSessionPrOpenSource = createRetainedSessionPrOpenSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedSessionClosureSource = createRetainedSessionClosureSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const retainedPromotionSource = createRetainedPromotionSource({ configuration, environment, createAuthority: createStandardProcessAuthority });
  const nativeReconciliationHistory = createNativeReconciliationHistoryReader({ ...options, configuration, signer, artifacts, environment });
  const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, source: humanSource, projectionRequired: false });
  function read() {
    return readExecutionAuthority().authority;
  }
  function readExecutionAuthority() {
    assertCurrentBindings();
    return readAuthorityObservation();
  }
  function readAuthorityObservation() {
    assertStandardWorkflowImplementation();
    const { project, persistence } = readWorkflowProjectExecutionAuthority({ targetRoot: configuration.target_root, env: environment });
    if (project.stateMode !== initial.stateMode) fail("STANDARD_PROCESS_AUTHORITY_CHANGED");
    return { persistence, authority: { scope_id: shadowHash({ project: project.scope, persistence: persistence.binding_sha256,
      process_host: { version: 1, profile: "standard-mixed.v1", state_mode: project.stateMode, key_id: signer.keyId,
        model_sha256: shadowHash(model), model_source_sha256: source === null ? null : shadowHash(source) } }),
      model_sha256: shadowHash(model), policy_pins: agenticPolicyPins(model) } };
  }
  function snapshot(productSha256 = readProductSha256?.()) {
    if (!/^[a-f0-9]{64}$/.test(productSha256 ?? "")) fail("STANDARD_PROCESS_PRODUCT_OBSERVATION_REQUIRED");
    const documentPaths = ["CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "baseline/current.md", "snapshots/context-snapshot.md"];
    return { ...(source ? { model_source: source } : {}), context: operations.observeScope(),
      documents: artifacts.readMany(documentPaths, { required: documentPaths }).map(({ path, sha256 }) => ({ path, sha256 })),
      native: { configuration_sha256: shadowHash(configuration), product_sha256: productSha256 } };
  }
  function authenticate(instance, options = {}) {
    return authenticateHistory(instance, options, false).native;
  }
  // The operation host checks the same scope tuple as history authentication.
  // Read it here once, with the host's existing scope refusal code.
  function authenticateOperationHost(instance) {
    authenticateHistory(instance, {}, false, "STANDARD_HOST_AUTHORITY_CHANGED");
  }
  // Only the diagnostic port selects this private mode. Execution options,
  // process JSON, grants and model facts cannot weaken allocation exclusion.
  function authenticateHistory(instance, { reservation = null, productSha256, checkControlContext = false, forNative = false } = {},
    diagnostic = false, scopeMismatch = "STANDARD_PROCESS_AUTHORITY_CHANGED") {
    // Inspection validates and replays the supplied prefix. Use that cursor
    // within this synchronous check, then discard it with the observations.
    const cursor = inspectAgenticProcess(instance);
    // Diagnostic authentication uses the immutable model and signed historical
    // bindings. Only execution requires that model's pins to match today's code.
    // This private selection is never taken from caller options or process JSON.
    const authority = diagnostic ? readAuthorityObservation().authority : read();
    if (instance.scope_id !== authority.scope_id || instance.model_sha256 !== authority.model_sha256
      || shadowHash(instance.policy_pins) !== shadowHash(authority.policy_pins)) fail(scopeMismatch);
    if (instance.instance_id !== configuration.instance_id || Object.keys(instance.initial_facts).length) fail("STANDARD_PROCESS_AUTHORITY_CHANGED");
    const journal = allocations.read(nativeJournalId(instance)).record;
    let native = null, covered = 0;
    if (journal) {
      signer.verify(journal); const latest = journal.allocations.at(-1);
      if (journal.instance_id !== instance.instance_id || journal.scope_id !== instance.scope_id || journal.model_sha256 !== instance.model_sha256)
        fail("STANDARD_PROCESS_NATIVE_HISTORY_CHANGED");
      if (diagnostic && journal.allocations.some(entry => entry.configuration_sha256 !== shadowHash(configuration))) fail("STANDARD_PROCESS_NATIVE_HISTORY_CHANGED");
      const latestResolution = !diagnostic && latest?.phase !== 'closed' && latest ? nativeReconciliationHistory.resolution(journal, latest) : null;
      if (!diagnostic && latest && latest.phase !== "closed" && !latestResolution) {
        if (!reservation || latest.phase !== "reserved" || latest.owner_id !== reservation.owner_id || latest.generation !== reservation.generation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE");
      } else if (reservation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_CHANGED");
      const entry = reservation || diagnostic && latest?.phase === "reserved" ? journal.allocations.at(-2) : latest;
      if (entry) {
        if (!diagnostic && entry.phase !== "closed" && !(entry === latest ? latestResolution : nativeReconciliationHistory.resolution(journal, entry)))
          fail("STANDARD_PROCESS_NATIVE_RECONCILIATION_REQUIRED");
        native = readNativeAllocationCheckpoint(entry, configuration, { scopeId: authority.scope_id, modelSha256: authority.model_sha256 }).state;
        if (!diagnostic && !native.parent_closed) fail("STANDARD_PROCESS_NATIVE_RECONCILIATION_REQUIRED");
        covered = native.instance.events.length;
        if (instance.events.length < covered || shadowHash(instance.events.slice(0, covered)) !== shadowHash(native.instance.events)) fail("STANDARD_PROCESS_NATIVE_HISTORY_CHANGED");
      }
    } else if (reservation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_CHANGED");
    const seen = new Map(), frames = new Map(cursor.occurrences.map(row => [row.occurrence_id, row]));
    const journalIds = operationStore.readMany && [...new Set(instance.events.flatMap(event =>
      event.kind === "operation_intent" ? [event.intent.operation_id] : event.kind === "operation_result" ? [event.receipt.operation_id] : []))];
    const observedRecords = journalIds && new Map(operationStore.readMany(journalIds).map(({ record }, index) => [journalIds[index], record]));
    for (const [index, event] of instance.events.entries()) {
      if (["assign", "result", "refusal"].includes(event.kind)) {
        if (!native || index >= covered || shadowHash(event) !== shadowHash(native.instance.events[index])) fail("STANDARD_PROCESS_NATIVE_HISTORY_NOT_AUTHENTICATED");
      } else if (["operation_intent", "operation_result"].includes(event.kind)) {
        const id = event.intent?.operation_id ?? event.receipt.operation_id;
        if (!seen.has(id)) {
          const record = observedRecords ? observedRecords.get(id) : operationStore.read(id).record;
          signer.verify(record); signer.verify(record.preview);
          const frame = frames.get(event.occurrence_id);
          if (!frame) fail("PROCESS_OCCURRENCE_UNKNOWN");
          const component = frame.model_sha256 === undefined ? model : modelsByHash.get(frame.model_sha256);
          if (!component) fail("PROCESS_CALL_TARGET_CHANGED");
          assertProcessOperationBinding(record.preview.binding);
          if (validateJsonSchema(record.preview, previewSchema, "$", { contractKind: "workflow-definition" }).length
            || record.preview.binding.id !== record.intent.binding_ref
            || shadowHash(record.preview.binding) !== component.operation_pins[record.intent.binding_ref]
            || !diagnostic && shadowHash(bindings.get(record.intent.binding_ref)) !== shadowHash(record.preview.binding)
            || ["instance_id", "instance_sha256", "scope_id", "model_sha256", "occurrence_id"].some(key => record.preview[key] !== record.intent[key])
            || record.intent.binding_sha256 !== shadowHash(record.preview.binding)
            || record.intent.input_sha256 !== shadowHash(record.preview.input)
            || record.intent.preconditions_sha256 !== shadowHash({ snapshot: record.preview.snapshot, prepared: record.preview.prepared })) fail("STANDARD_PROCESS_OPERATION_NOT_AUTHENTICATED");
          if (diagnostic) assertHistoricalPreviewInput(record.preview, component);
          else { assertStandardOperationInput(record.intent.binding_ref, record.preview.input); assertStandardResolvedPreview(record.preview, model); }
          if (record.preview.binding.executor_kind === "human" && record.results.length) {
            const recovery = postMergeRecoveryResult(record);
            if (recovery) signer.verify(recovery.output.observations.plan);
            else human.captured(record);
          }
          seen.set(id, record);
        }
        const record = seen.get(id);
        if (forNative && record.phase === "dispatching") fail("STANDARD_PROCESS_OPERATION_RECONCILIATION_REQUIRED");
        if (event.kind === "operation_intent" && shadowHash(record.intent) !== shadowHash(event.intent)
          || event.kind === "operation_result" && !record.results.some(row => shadowHash(row.receipt) === shadowHash(event.receipt))) fail("STANDARD_PROCESS_OPERATION_NOT_AUTHENTICATED");
      } else if (event.kind === "control") {
        const capture = controls.read(event.delivery.delivery_id).record; signer.verify(capture);
        if (capture.request.instance_sha256 !== agenticProcessPrefixSha256(instance, index) || shadowHash(capture.delivery) !== shadowHash(event.delivery)) fail("STANDARD_PROCESS_CONTROL_NOT_AUTHENTICATED");
        if (checkControlContext && index >= covered && capture.request.context_sha256 !== shadowHash(snapshot(productSha256))) fail("STANDARD_PROCESS_CONTROL_CONTEXT_CHANGED");
        if (capture.phase === "delivered" && capture.delivered_instance_sha256 !== agenticProcessPrefixSha256(instance, index + 1)) fail("STANDARD_PROCESS_CONTROL_NOT_AUTHENTICATED");
      } else if (["call_enter", "call_return"].includes(event.kind)) {
        // The common reducer has recomputed these values and source hashes from
        // the pinned model, exact call scope and earlier accepted receipts.
        // All earlier receipt origins are authenticated above; a call adds no
        // authority, effect, resource allocation or accounting reset.
      } else fail("STANDARD_PROCESS_HISTORY_NOT_AUTHENTICATED");
    }
    return { native, journal, cursor, records: seen, authority };
  }
  function inspectDiagnostic(instance) {
    const { native, journal } = authenticateHistory(instance, {}, true);
    // Failed observations stay failed even with a closed OS tree. Reading does
    // not release an owner, reconcile resources or establish effect admission.
    return structuredClone({ journal, checkpoint: native, written: false, native_started: false });
  }
  function observeNativeDiagnostic(instance) {
    const { native, journal, authority } = authenticateHistory(instance, {}, true);
    if (!journal?.allocations.length || journal.allocations.at(-1).phase === "closed") fail("NATIVE_ALLOCATION_ASSESSMENT_UNRESOLVED_REQUIRED");
    // The existing pure product reader avoids constructing a Native executor
    // just to inspect a historical model whose implementation pins changed.
    if (typeof readProductSnapshot !== "function") fail("STANDARD_PROCESS_PRODUCT_OBSERVATION_REQUIRED");
    return structuredClone({ instance, authority, context: { ...snapshot(shadowHash(readProductSnapshot())),
      diagnostic_native_journal_sha256: shadowHash(journal) }, diagnosticJournalSha256: shadowHash(journal),
      written: false, native_started: false });
  }
  async function withNativeOwner(intent, action) {
    const result = await artifacts.withLocalEffectOwner(shadowHash({ authority: read(), ...intent }), async () => {
      const value = await action();
      const activatedEpoch = value.status === 'authorized' && value.written === true && value.native_started === false;
      return { value, effect_status: value.journal_phase === 'closed' || activatedEpoch ? 'confirmed' : value.native_started === false ? 'no_effect' : 'unknown' };
    });
    return result.value;
  }
  async function assertDriftDiagnosisRequest(instance, occurrenceId) {
    const auth = nativeReservation ? { reservation: nativeReservation } : {};
    authenticate(instance, auth);
    const frames = inspectAgenticProcess(instance).occurrences;
    const frame = frames.find(row => row.occurrence_id === occurrenceId);
    if (!frame || frame.node_id !== "closure_drift_report") fail("STANDARD_DRIFT_DIAGNOSIS_OCCURRENCE_REQUIRED");
    const previous = frames.filter(row => row.node_id === frame.node_id && row.occurrence_id !== occurrenceId);
    // The first diagnostic still passes the ordinary fresh preWriteAdmit below.
    // Only an accepted, authenticated request may admit a subsequent occurrence.
    if (!previous.length) return;
    const id = instance.events.filter(event => event.kind === "operation_intent" && ["drift_recovery_decision", "drift_completion_decision"].includes(event.intent.binding_ref)).at(-1)?.intent.operation_id;
    if (!id) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_REQUIRED");
    const binding = instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id).intent.binding_ref;
    const selected = acceptedOperation(instance, id, binding, auth);
    const review = selected.record.preview.prepared.plan, capture = human.captured(selected.record);
    if (review.contract_version === "standard-drift-recovery-plan.v1") {
      if (capture.source.choice !== "rollback") fail("STANDARD_DRIFT_RECOVERY_EXECUTION_REQUIRED");
      const appliedIntent = instance.events.findLast(row => row.intent?.binding_ref === "drift_recovery_rollback_apply")?.intent;
      if (!appliedIntent) fail("STANDARD_DRIFT_RECOVERY_EXECUTION_REQUIRED");
      const applied = acceptedOperation(instance, appliedIntent.operation_id, "drift_recovery_rollback_apply", auth);
      const recorded = acceptedOperation(instance, applied.record.preview.input.recovery_record_operation_id, "drift_recovery_record", auth);
      const evaluation = acceptedOperation(instance, review.evaluation_operation_id, "drift_report_evaluate", auth);
      if (applied.output.effect_status !== "confirmed" || applied.output.facts.drift_recovery_rollback_applied !== true
        || recorded.record.preview.input.decision_operation_id !== id
        || applied.output.observations.recovery_record_operation_id !== recorded.record.operation_id
        || applied.output.observations.before_context_sha256 !== recorded.output.observations.causal_transition?.after_context_sha256
        || evaluation.record.preview.input.report_occurrence_id !== previous.at(-1).occurrence_id)
        fail("STANDARD_DRIFT_RECOVERY_EXECUTION_REQUIRED");
      const current = await observeDriftContext();
      if (current.context_sha256 !== applied.output.observations.after_context_sha256) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE");
      authenticate(instance, auth);
      return;
    }
    assertObjectiveReview(review);
    const evaluation = acceptedOperation(instance, review.evaluation_operation_id, "drift_report_evaluate", auth);
    if (!["standard-drift-recovery-plan.v2", "standard-drift-recovery-plan.v3"].includes(review.contract_version) || capture.source.choice !== "request_diagnosis"
      || !previous.some(row => row.occurrence_id === evaluation.record.preview.input.report_occurrence_id)
      || evaluation.record.preview.input.report_occurrence_id !== previous.at(-1).occurrence_id
      || (binding === "drift_recovery_decision" ? selected.output.facts.drift_diagnosis_requested !== true : selected.output.facts.drift_completion_reviewed !== false)) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_REQUIRED");
    const current = await prepareActivityOutput({ contractRef: DRIFT_REPORT_CONTRACT, productSha256: readProductSha256?.() });
    if (current.context_sha256 !== review.context_sha256) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE");
    const assertContextCurrent = captureStandardDriftContextFence({ targetRoot: configuration.target_root, observed: current,
      productRoot: configuration.product_root, productFiles: configuration.product_files, readProductSha256,
      deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment });
    // Current human authentication is separate from the unchanged Native grant,
    // new allocation admission, and cumulative Native budget accounting.
    await human.verifyCaptured(selected.record);
    assertContextCurrent();
    authenticate(instance, auth);
  }
  async function admitReadyDriftDiagnosis(instance) {
    const cursor = inspectAgenticProcess(instance);
    for (const id of cursor.ready) {
      const frame = cursor.occurrences.find(row => row.occurrence_id === id);
      if (frame?.node_id === "closure_drift_report" && model.nodes.some(row => row.id === "closure_drift_loop"))
        await assertDriftDiagnosisRequest(instance, id);
    }
  }
  async function verifyNativeHumanSource(request, reservation, signal) {
    const journal = allocations.read(reservation.journal_id).record; signer.verify(journal);
    const latest = journal.allocations.at(-1);
    if (latest?.phase !== "reserved" || latest.owner_id !== reservation.owner_id || latest.generation !== reservation.generation)
      fail("STANDARD_PROCESS_NATIVE_ALLOCATION_CHANGED");
    const record = operationStore.read(request.operation_id).record; signer.verify(record); signer.verify(record.preview);
    if (!["drift_recovery_decision", "drift_completion_decision"].includes(record.intent.binding_ref)) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_REQUIRED");
    const capture = human.captured(record), review = record.preview.prepared.plan;
    assertObjectiveReview(review);
    const instance = instances.read(journal.instance_id).record, result = record.results.at(-1);
    const latestReview = instance?.events.filter(row => row.kind === "operation_intent"
      && ["drift_recovery_decision", "drift_completion_decision"].includes(row.intent.binding_ref)).at(-1);
    if (record.intent.instance_id !== journal.instance_id || record.intent.scope_id !== journal.scope_id || capture.source.choice !== "request_diagnosis"
      || instance?.scope_id !== journal.scope_id || instance?.model_sha256 !== journal.model_sha256 || latestReview?.intent.operation_id !== record.operation_id
      || shadowHash(latestReview.intent) !== shadowHash(record.intent) || result?.output.outcome !== "completed"
      || !instance.events.some(row => row.kind === "operation_result" && row.receipt.operation_id === record.operation_id && shadowHash(row.receipt) === shadowHash(result.receipt))
      || !["standard-drift-recovery-plan.v2", "standard-drift-recovery-plan.v3"].includes(review.contract_version)
      || shadowHash(capture.source) !== request.source_sha256 || shadowHash(human.question(record)) !== request.question_sha256)
      fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_REQUIRED");
    await human.verifyCaptured(record, signal);
    const current = allocations.read(reservation.journal_id).record; signer.verify(current);
    if (shadowHash(current) !== shadowHash(journal) || shadowHash(operationStore.read(request.operation_id).record) !== shadowHash(record)
      || instances.read(journal.instance_id).record?.instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_PROCESS_NATIVE_ALLOCATION_CHANGED");
  }
  async function admitNativeActivity(instance, occurrenceId) {
    if (inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId)?.node_id === "closure_drift_report"
      && model.nodes.some(row => row.id === "closure_drift_loop" && row.kind === "loop"))
      await assertDriftDiagnosisRequest(instance, occurrenceId);
  }
  async function prepareActivityOutput({ contractRef, productSha256, instance, occurrenceId, productSnapshot }) {
    if (contractRef === CYCLE_PREWORK_CONTRACT) return prework.prepareActivity(instance, occurrenceId);
    if (contractRef === MODE_WORK_CONTRACT) {
      if (!Array.isArray(productSnapshot) || shadowHash(productSnapshot) !== productSha256 || productSha256 !== readProductSha256?.()) fail("STANDARD_MODE_WORK_PRODUCT_CHANGED");
      return prepareModeWorkActivity(instance, occurrenceId);
    }
    if (contractRef === PR_TRIAGE_CONTRACT) return preparePrTriageActivity({ instance, occurrenceId, productSha256, productSnapshot });
    if (contractRef === CYCLE_AUDIT_CONTRACT) return prepareAuditActivity({ instance, occurrenceId, productSha256, productSnapshot });
    if (contractRef === CYCLE_WORK_CONTRACT) return prepareWorkActivity({ instance, occurrenceId, productSha256, productSnapshot });
    if (contractRef === CYCLE_TASK_WORK_CONTRACT) return prepareTaskWorkActivity({ instance, occurrenceId, productSha256, productSnapshot });
    if (contractRef === DRIFT_REPORT_CONTRACT && instance && occurrenceId
      && inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId)?.node_id === "closure_drift_report"
      && model.nodes.some(row => row.id === "closure_drift_loop" && row.kind === "loop")) await assertDriftDiagnosisRequest(instance, occurrenceId);
    const skill = nativeActivityOutputSkill(contractRef);
    if (!skill) fail("PROCESS_ACTIVITY_OUTPUT_CONTRACT_UNSUPPORTED");
    // A proposal for an existing cycle is read-only. The whole cycle-create
    // admission intentionally requires clean Git before creating a new cycle.
    // Keep that rule; use the actual branch audit admission for this component.
    const admissionSkill = contractRef === CYCLE_PLAN_CONTRACT ? "branch-cycle-audit" : skill;
    read(); const admission = await preWriteAdmit({ targetRoot: configuration.target_root, skill: admissionSkill });
    if (admission.ok !== true || admission.activation?.active !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status))
      fail(contractRef === CYCLE_PLAN_CONTRACT ? "STANDARD_CYCLE_PLAN_ADMISSION_BLOCKED" : "STANDARD_DRIFT_ADMISSION_BLOCKED");
    return { ...await (contractRef === CYCLE_PLAN_CONTRACT ? readStandardCyclePlanContext : readStandardDriftContext)({ targetRoot: configuration.target_root, productSha256, productRoot: configuration.product_root,
      productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment }),
      admission: { status: admission.admission_status, observation_sha256: shadowHash(admission) } };
  }
  function readActivityOutput(instance, occurrenceId, contractRef = DRIFT_REPORT_CONTRACT, authenticationOptions = {}, history = null) {
    const state = history ? history.native : authenticate(instance, authenticationOptions);
    const event = instance.events.find(row => row.kind === "result" && row.occurrence_id === occurrenceId);
    if (!state || !event || event.result.outcome !== "completed") fail("STANDARD_DRIFT_AUTHENTICATED_RESULT_REQUIRED");
    const frame = (history?.cursor ?? inspectAgenticProcess(instance)).occurrences.find(row => row.occurrence_id === occurrenceId), node = frame && processFrameNode(model, frame);
    if (configuration.activity_outputs?.[node?.id] !== contractRef) fail("STANDARD_DRIFT_AUTHENTICATED_RESULT_REQUIRED");
    const retained = state.results.find(row => row.result.result_id === event.result.result_id);
    if (!retained || shadowHash(retained.result) !== shadowHash(event.result)) fail("STANDARD_DRIFT_AUTHENTICATED_RESULT_REQUIRED");
    const references = event.result.evidence_refs.filter(row => /-native-result\.json$/.test(row.ref));
    if (references.length !== 1) fail("STANDARD_DRIFT_AUTHENTICATED_RESULT_REQUIRED");
    const journal = allocations.read(nativeJournalId(instance)).record;
    const producer = journal.allocations.find(entry => references[0].ref.startsWith(`execution/${nativeAllocationOutputId(configuration.instance_id, entry.generation)}/`));
    if (!producer || producer.configuration_sha256 !== shadowHash(configuration)) fail("STANDARD_DRIFT_PRODUCER_CONFIGURATION_CHANGED");
    const data = readAgentRunFile(nativeEvidenceFile(configuration, references[0], journal.allocations.length), { maxBytes: 262144 });
    const answer = data.value;
    if (data.sha256 !== references[0].sha256 || answer.request_sha256 !== event.result.request_sha256 || answer.output_contract !== contractRef)
      fail("STANDARD_DRIFT_AUTHENTICATED_RESULT_REQUIRED");
    assertNativeActivityAnswer(answer.answer, contractRef, answer.output_context_sha256);
    if (answer.answer.outcome !== "completed") fail("STANDARD_DRIFT_AUTHENTICATED_RESULT_REQUIRED");
    return { report: answer.answer.report, reference: references[0], producer: { instance_id: instance.instance_id, model_sha256: instance.model_sha256,
      occurrence_id: occurrenceId, result_id: event.result.result_id } };
  }
  const observeModeWorkContext = () => readStandardModeWorkContext({ targetRoot: configuration.target_root, productSha256: readProductSha256?.(), productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment });
  async function preflightModeWork(instance, input) {
    assertStandardOperationInput("mode_work_preflight", input); authenticate(instance);
    const observed = observeModeWorkContext(), admission = await preWriteAdmit({ targetRoot: configuration.target_root, skill: "context-reload" });
    const fresh = observeModeWorkContext();
    if (fresh.context_sha256 !== observed.context_sha256) fail("STANDARD_MODE_WORK_CONTEXT_CHANGED");
    if (observed.context.session_id !== input.session_id || observed.context.mode !== input.mode) fail("STANDARD_MODE_WORK_MODE_REQUIRED");
    const ready = admission.ok === true && admission.activation?.active === true && ["admitted", "admitted_with_warnings"].includes(admission.admission_status);
    return { contract_version: "standard-mode-work-output.v1", operation_ref: "mode_work_preflight", outcome: ready ? "completed" : "blocked", effect_status: "no_effect",
      facts: ready ? { mode_work_ready: true } : {}, observations: { session_id: input.session_id, mode: input.mode, context_sha256: fresh.context_sha256,
        admission_status: admission.admission_status, reason_code: ready ? "STANDARD_MODE_WORK_READY" : "STANDARD_MODE_WORK_ADMISSION_BLOCKED" }, evidence_refs: fresh.evidence_refs };
  }
  function prepareModeWorkActivity(instance, occurrenceId) {
    const auth = nativeReservation ? { reservation: nativeReservation } : {};
    authenticate(instance, auth);
    const id = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "mode_work_preflight").at(-1)?.intent.operation_id;
    if (!id) fail("STANDARD_MODE_WORK_PREFLIGHT_REQUIRED");
    const accepted = acceptedOperation(instance, id, "mode_work_preflight", auth), current = observeModeWorkContext();
    if (accepted.output.facts.mode_work_ready !== true || accepted.record.preview.input.session_id !== current.context.session_id
      || accepted.record.preview.input.mode !== current.context.mode) fail("STANDARD_MODE_WORK_PREFLIGHT_REQUIRED");
    // Bind a followup to the NEW accepted human decision preceding this
    // activity. Later decisions never change the context of an older result.
    const assignment = instance.events.findIndex(event => event.kind === "assign" && event.occurrence_id === occurrenceId);
    const prefix = assignment >= 0 ? instance.events.slice(0, assignment) : instance.events;
    const decisionEvent = prefix.filter(event => event.kind === "operation_result").findLast(event => {
      const intent = prefix.find(row => row.kind === "operation_intent" && row.intent.operation_id === event.receipt.operation_id);
      return intent?.intent.binding_ref === "mode_work_continue_decision"
        || intent?.intent.binding_ref === "spike_conversion_decision" && event.receipt.facts.mode_work_continue_requested === true;
    });
    let continuation;
    if (decisionEvent) {
      const binding = prefix.find(row => row.kind === "operation_intent" && row.intent.operation_id === decisionEvent.receipt.operation_id).intent.binding_ref;
      const selected = acceptedOperation(instance, decisionEvent.receipt.operation_id, binding, auth);
      const capture = human.captured(selected.record);
      const priorReview = binding === "spike_conversion_decision" ? selected.record.preview.prepared.review.analysis : selected.record.preview.prepared.review;
      if (capture.source.choice !== "continue_analysis" || selected.output.facts.mode_work_continue_requested !== true)
        fail("STANDARD_MODE_WORK_CONTINUATION_REQUIRED");
      if (capture.source.contract_version === "human-mode-work-decision.v2"
        && (selected.output.observations.current_context_sha256 !== shadowHash(modeWorkDecisionContext(current))
          || shadowHash(selected.record.preview.prepared.current_context) !== selected.output.observations.current_context_sha256))
        fail("STANDARD_MODE_WORK_REVIEW_STALE");
      continuation = { operation_id: selected.record.operation_id, source_sha256: shadowHash(capture.source), question_sha256: capture.source.question_sha256,
        review_sha256: selected.output.observations.review_sha256, choice: capture.source.choice,
        information_only: true, product_effects_authorized: false, retention_authorized: false, native_authority_renewed: false,
        decision: structuredClone(capture.source), prior_report: structuredClone(priorReview.report),
        prior_producer: structuredClone(priorReview.producer), prior_reference: structuredClone(priorReview.reference) };
    }
    const context = { ...current.context, preflight_operation_id: id, ...(continuation ? { continuation } : {}) };
    if (Buffer.byteLength(JSON.stringify(context)) > 262144) fail("STANDARD_MODE_WORK_CONTEXT_TOO_LARGE");
    return { ...current, context, context_sha256: shadowHash(context) };
  }
  async function evaluateModeWork(instance, input) {
    assertStandardOperationInput("mode_work_evaluate", input);
    return evaluateStandardModeWork(readActivityOutput(instance, input.report_occurrence_id, MODE_WORK_CONTRACT), prepareModeWorkActivity(instance, input.report_occurrence_id));
  }
  function observeModeWork(instance, input) {
    assertStandardOperationInput("mode_work_observe", input);
    return observeModeWorkReport(readActivityOutput(instance, input.report_occurrence_id, MODE_WORK_CONTRACT), prepareModeWorkActivity(instance, input.report_occurrence_id));
  }
  const modeWorkDecisionContext = current => ({ session_id: current.context.session_id, mode: current.context.mode,
    context_sha256: current.context_sha256, product_sha256: current.context.product_sha256,
    head: current.context.git.head, branch: current.context.git.branch });
  function prepareModeWorkContinuation(instance, input, { version = 2 } = {}) {
    assertStandardOperationInput("mode_work_continue_decision", input);
    const accepted = acceptedOperation(instance, input.review_operation_id, "mode_work_observe");
    assertModeWorkObservationOutput(accepted.output);
    if (accepted.output.outcome !== "completed") fail("STANDARD_MODE_WORK_REVIEW_STALE");
    if (version === 2) {
      // The accepted report is immutable history. Current context is a separate
      // subject; publishing a packet must not rebase an old Native report.
      const review = accepted.output.observations.review, current = modeWorkDecisionContext(observeModeWorkContext());
      if (current.session_id !== review.session_id || current.mode !== review.mode) fail("STANDARD_MODE_WORK_REVIEW_STALE");
      if (!["waiting", "retain_requested"].includes(review.report.disposition)) fail("STANDARD_MODE_WORK_CONTINUATION_NOT_REQUIRED");
      return { review, current_context: current, choices: [...modeWorkHandoffChoices] };
    }
    const fresh = observeModeWork(instance, accepted.record.preview.input);
    if (shadowHash(fresh) !== shadowHash(accepted.output)) fail("STANDARD_MODE_WORK_REVIEW_STALE");
    if (!["waiting", "retain_requested"].includes(fresh.observations.review.report.disposition)) fail("STANDARD_MODE_WORK_CONTINUATION_NOT_REQUIRED");
    return { review: fresh.observations.review, choices: [...modeWorkContinuationChoices] };
  }
  function assertModeWorkContinuationFresh(instance, input, prepared) {
    if (shadowHash(prepareModeWorkContinuation(instance, input, { version: prepared.current_context ? 2 : 1 })) !== shadowHash(prepared)) fail("STANDARD_MODE_WORK_REVIEW_STALE");
  }
  async function evaluateDriftReport(instance, input) {
    assertStandardOperationInput("drift_report_evaluate", input);
    return evaluateStandardDriftReport(readActivityOutput(instance, input.report_occurrence_id),
      await prepareActivityOutput({ contractRef: DRIFT_REPORT_CONTRACT, productSha256: readProductSha256?.() }));
  }
  function readPreworkNativeActivity(instance, occurrenceId, contract = CYCLE_PREWORK_CONTRACT, { auth = {}, history = null } = {}) {
    if (contract !== CYCLE_PREWORK_CONTRACT) fail("STANDARD_PREWORK_NATIVE_CONTEXT_REQUIRED");
    const authenticated = readActivityOutput(instance, occurrenceId, contract, auth, history);
    const event = instance.events.find(row => row.kind === "result" && row.occurrence_id === occurrenceId);
    const references = event.result.evidence_refs.filter(row => row.ref.endsWith("-activity-context.json"));
    if (references.length !== 1) fail("STANDARD_PREWORK_NATIVE_CONTEXT_REQUIRED");
    const journal = allocations.read(nativeJournalId(instance)).record;
    const retained = readAgentRunFile(nativeEvidenceFile(configuration, references[0], journal.allocations.length),
      { sha256: references[0].sha256, maxBytes: 1048576 });
    const index = instance.events.findIndex(row => row.kind === "assign" && row.occurrence_id === occurrenceId);
    if (index < 0 || retained.value.occurrence_id !== occurrenceId) fail("STANDARD_PREWORK_NATIVE_CONTEXT_REQUIRED");
    const prefix = { ...instance, revision: index + 1, events: instance.events.slice(0, index), instance_sha256: agenticProcessPrefixSha256(instance, index) };
    const resolution = resolveProcessOperationInput({ instance: prefix, occurrenceId, readOperation: id => {
      const record = operationStore.read(id).record; signer.verify(record); return record; } });
    return { authenticated, context: retained.value, reference: references[0], input: resolution.input };
  }
  async function observePreworkContext() {
    read(); const admission = await preWriteAdmit({ targetRoot: configuration.target_root, skill: "branch-cycle-audit" });
    read();
    if (admission.ok !== true || admission.activation?.active !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status))
      fail("STANDARD_PREWORK_ADMISSION_BLOCKED");
    return observeCycleVerificationContext();
  }
  async function selectCyclePrework(instance, input) {
    assertStandardOperationInput("cycle_prework_select", input); return prework.select(instance);
  }
  async function selectOwnedCyclePlanning(instance, input) {
    assertStandardOperationInput("cycle_owned_planning_select", input); return prework.selectOwnedPlanning(instance, input);
  }
  async function evaluateCyclePrework(instance, input) {
    assertStandardOperationInput("cycle_prework_evaluate", input); return prework.evaluate(instance, input);
  }
  async function evaluateCyclePlan(instance, input) {
    assertStandardOperationInput("cycle_plan_evaluate", input);
    return evaluateStandardCyclePlan(readActivityOutput(instance, input.report_occurrence_id, CYCLE_PLAN_CONTRACT),
      await prepareActivityOutput({ contractRef: CYCLE_PLAN_CONTRACT, productSha256: readProductSha256?.() }));
  }
  async function readCyclePlanEvaluation(instance, input, options = {}) {
    assertStandardOperationInput("cycle_plan_record", input); authenticate(instance);
    const retained = operationStore.read(input.evaluation_operation_id).record; signer.verify(retained);
    if (retained.intent.binding_ref === "cycle_prework_evaluate") {
      const evaluation = await prework.readEvaluation(instance, input, options);
      if (evaluation.output.facts.cycle_plan_record_required !== true) fail("STANDARD_PREWORK_CANONICAL_PLAN_REPLACEMENT_REFUSED");
      return evaluation;
    }
    const result = retained.results.at(-1);
    if (retained.intent.binding_ref !== "cycle_plan_evaluate" || retained.intent.scope_id !== instance.scope_id || retained.intent.instance_id !== instance.instance_id
      || retained.phase !== "receipted" || result?.receipt.outcome !== "completed"
      || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail("STANDARD_CYCLE_PLAN_EVALUATION_REQUIRED");
    const context = await prepareActivityOutput({ contractRef: CYCLE_PLAN_CONTRACT, productSha256: readProductSha256?.() });
    const output = evaluateStandardCyclePlan(readActivityOutput(instance, retained.preview.input.report_occurrence_id, CYCLE_PLAN_CONTRACT), context);
    if (shadowHash(output) !== shadowHash(result.output)) fail("STANDARD_CYCLE_PLAN_EVALUATION_STALE");
    return { output, evaluation_sha256: shadowHash(result.output), context: context.context, context_sha256: context.context_sha256 };
  }
  async function readDriftEvaluation(instance, input, retainedOptions = {}) {
    assertStandardOperationInput("drift_check_finalize", input); authenticate(instance);
    if (instance.initial_parameters?.entry_point?.kind === 'retained_promotion') {
      const entry = instance.events.find(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
      if (input.evaluation_operation_id === entry?.intent.operation_id) {
        const retained = await readRetainedPromotion(instance, retainedOptions, true);
        return retained.evaluation;
      }
    }
    const retained = operationStore.read(input.evaluation_operation_id).record; signer.verify(retained);
    const result = retained.results.at(-1);
    if (retained.intent.binding_ref !== "drift_report_evaluate" || retained.intent.scope_id !== instance.scope_id || retained.intent.instance_id !== instance.instance_id
      || retained.phase !== "receipted" || result?.receipt.outcome !== "completed"
      || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail("STANDARD_DRIFT_EVALUATION_REQUIRED");
    const context = await prepareActivityOutput({ contractRef: DRIFT_REPORT_CONTRACT, productSha256: readProductSha256?.() });
    const output = evaluateStandardDriftReport(readActivityOutput(instance, retained.preview.input.report_occurrence_id), context);
    if (shadowHash(output) !== shadowHash(result.output)) fail("STANDARD_DRIFT_EVALUATION_STALE");
    return { output, evaluation_sha256: shadowHash(result.output), context: context.context, context_sha256: context.context_sha256 };
  }
  // Read-only historical capability for a fixed continuation reader. It verifies
  // the original signed prefix and closed Native evidence, then evaluates that
  // report against today's canonical documents. It cannot dispatch old bindings.
  async function readRecordedDriftEvaluation(instance, input) {
    assertStandardOperationInput('drift_check_finalize', input);
    const history = authenticateHistory(instance, {}, true);
    if (!history.journal?.allocations.length || history.journal.allocations.some(row => row.phase !== 'closed' || row.tree_closed !== true))
      fail('STANDARD_RETAINED_PROMOTION_NATIVE_UNSETTLED');
    const retained = acceptedOperation(instance, input.evaluation_operation_id, 'drift_report_evaluate', {}, history);
    const context = await readStandardDriftContext({ targetRoot: configuration.target_root, productSha256: readProductSha256?.(), productRoot: configuration.product_root,
      productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment });
    const output = evaluateStandardDriftReport(readActivityOutput(instance, retained.record.preview.input.report_occurrence_id, DRIFT_REPORT_CONTRACT, {}, history), context);
    if (shadowHash(output) !== shadowHash(retained.output)) fail('STANDARD_RETAINED_PROMOTION_EVALUATION_CHANGED');
    return { output, evaluation_sha256: shadowHash(output), context: context.context, context_sha256: context.context_sha256 };
  }
  function acceptedOperation(instance, id, binding, authenticationOptions = {}, history = null) {
    const observed = history?.records.get(id);
    if (!observed) authenticate(instance, authenticationOptions);
    const record = observed ?? operationStore.read(id).record;
    signer.verify(record);
    const result = record.results.at(-1);
    if (record.intent.binding_ref !== binding || record.intent.scope_id !== instance.scope_id || record.intent.instance_id !== instance.instance_id
      || record.phase !== "receipted" || result?.receipt.outcome !== "completed"
      || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail("STANDARD_CYCLE_READINESS_AUTHENTICATED_RESULT_REQUIRED");
    return { record, output: result.output };
  }
  function prTriageSelection(instance, resolution, auth = {}) {
    if (Object.keys(resolution.input).join(",") !== "selection_operation_id") fail("STANDARD_PR_TRIAGE_INPUT_INVALID");
    const selection = acceptedOperation(instance, resolution.input.selection_operation_id, "session_pr_triage_select", auth);
    const latest = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "session_pr_triage_select").at(-1);
    const received = acceptedOperation(instance, selection.record.preview.input.received_operation_id, "session_pr_review_receive", auth);
    if (latest?.intent.operation_id !== selection.record.operation_id
      || selection.output.observations.received_output_sha256 !== shadowHash(received.output)
      || selection.output.observations.payload_sha256 !== shadowHash(received.output.observations.payload)) fail("STANDARD_PR_TRIAGE_SELECTION_CHANGED");
    return selection;
  }
  function preparePrTriageActivity({ instance, occurrenceId, productSha256, productSnapshot }) {
    const auth = nativeReservation ? { reservation: nativeReservation } : {};
    authenticate(instance, auth);
    const resolution = resolveProcessOperationInput({ instance, occurrenceId,
      readOperation: id => { const record = operationStore.read(id).record; signer.verify(record); return record; } });
    const selection = prTriageSelection(instance, resolution, auth);
    return buildStandardPrTriageContext({ selection, resolution, productSha256, productSnapshot, scope: snapshot(productSha256) });
  }
  function readPrTriageActivity(instance, input) {
    assertStandardOperationInput("session_pr_triage_evaluate", input);
    const authenticated = readActivityOutput(instance, input.report_occurrence_id, PR_TRIAGE_CONTRACT);
    const event = instance.events.find(row => row.kind === "result" && row.occurrence_id === input.report_occurrence_id);
    const journal = allocations.read(nativeJournalId(instance)).record;
    const get = suffix => {
      const refs = event.result.evidence_refs.filter(row => row.ref.endsWith(suffix));
      if (refs.length !== 1) fail("STANDARD_PR_TRIAGE_NATIVE_EVIDENCE_REQUIRED");
      return { value: readAgentRunFile(nativeEvidenceFile(configuration, refs[0], journal.allocations.length),
        { sha256: refs[0].sha256, maxBytes: 1048576 }).value, ref: refs[0] };
    };
    const retained = get("-activity-context.json"), observed = get("-artifact-output.json"), context = retained.value.context;
    const index = instance.events.findIndex(row => row.kind === "assign" && row.occurrence_id === input.report_occurrence_id);
    if (index < 0) fail("STANDARD_PR_TRIAGE_NATIVE_EVIDENCE_REQUIRED");
    const prefix = { ...instance, revision: index + 1, events: instance.events.slice(0, index), instance_sha256: agenticProcessPrefixSha256(instance, index) };
    const resolution = resolveProcessOperationInput({ instance: prefix, occurrenceId: input.report_occurrence_id,
      readOperation: id => { const record = operationStore.read(id).record; signer.verify(record); return record; } });
    const selection = prTriageSelection(instance, resolution);
    const expected = buildStandardPrTriageContext({ selection, resolution, productSha256: readProductSha256?.(),
      productSnapshot: observed.value.files, scope: snapshot() });
    if (retained.value.occurrence_id !== input.report_occurrence_id || observed.value.occurrence_id !== input.report_occurrence_id
      || observed.value.artifact_sha256 !== context.product_sha256 || observed.value.artifact_sha256 !== shadowHash(observed.value.files)
      || retained.value.context_sha256 !== authenticated.report.context_sha256 || expected.context_sha256 !== authenticated.report.context_sha256
      || shadowHash(context) !== expected.context_sha256) fail("STANDARD_PR_TRIAGE_NATIVE_SOURCE_CHANGED");
    return { authenticated, context, selection, evidence_refs: [authenticated.reference, retained.ref, observed.ref] };
  }
  function readinessContext(observed) {
    const documents = observed.context.documents;
    const selected = artifacts.describe();
    const paths = documents.map(row => row.ref.slice(6));
    let metadataPins;
    if (selected.backend === "postgres") {
      const rows = artifacts.readMany(paths, { includeMetadata: true });
      if (rows.some(row => row.source !== "postgres") || shadowHash(artifacts.describe()) !== shadowHash(selected))
        fail("STANDARD_CANONICAL_BACKEND_CONFLICT");
      if (rows.some((row, index) => row.path !== paths[index] || row.sha256 !== documents[index].sha256))
        fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
      metadataPins = documents.map((row, index) => ({ ref: row.ref, sha256: rows[index].metadata_sha256 }));
    } else {
      metadataPins = documents.map((row, index) => ({ ref: row.ref, sha256: artifacts.metadataHash(paths[index]) }));
    }
    const context = { ...observed.context, metadata_pins: metadataPins };
    return { ...observed, context, context_sha256: shadowHash(context) };
  }
  async function evaluateCycleReadiness(instance, input, options = {}) {
    assertStandardOperationInput("cycle_readiness_evaluate", input);
    const origin = instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === input.record_operation_id)?.intent.binding_ref;
    if (canonicalCycleResumeAdmissionOperations.includes(origin)) {
      const adopted = canonicalResumeOrigin(instance, input.record_operation_id), output = adopted.output, source = output.observations;
      if (!["OPEN", "IMPLEMENTING"].includes(source.canonical_phase)
        || source.phase_transition_required !== (source.canonical_phase === "OPEN")) fail("STANDARD_CANONICAL_RESUME_IMPLEMENTATION_CHECKPOINT_REQUIRED");
      const assertSource = observed => {
        const names = source.canonical.map(row => row.path), rows = artifacts.readMany(names, { required: names, includeMetadata: true }),
          pins = rows.map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
        if (source.context_sha256 !== observed.context_sha256 || source.operation_scope_sha256 !== shadowHash(operations.observeScope())
          || source.canonical_binding_sha256 !== shadowHash(artifacts.describe()) || shadowHash(source.canonical) !== shadowHash(pins)
          || observed.context.cycle_state !== source.canonical_phase || observed.context.cycle_path !== source.cycle_path
          || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
      };
      const before = await observeCycleReadinessContext(); assertSource(before);
      const admitted = await operations.auditCycle({ session_id: source.session_id, cycle_id: source.cycle_id }),
        start = await runStartSessionAdmitUseCase({ targetRoot: configuration.target_root, mode: "COMMITTING" }),
        fresh = await observeCycleReadinessContext(); assertSource(fresh);
      const projection = projectStandardCanonicalCycleProgress(fresh);
      if (shadowHash(projection.proposal) !== shadowHash(source.proposal) || shadowHash(projection.completed_task_ids) !== shadowHash(source.imported_completed_task_ids)
        || artifactContentHash(projection.original_plan) !== source.original_plan_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
      const initialAudit = await prework.canonicalWitness(instance, input.record_operation_id, options);
      const checked = evaluateCanonicalResumeReadiness({ projection, context: fresh.context,
        branchAdmitted: admitted.outcome === "completed" && start.ok === true && start.action === "resume_current_cycle" });
      return assertStandardOperationOutput({ contract_version: "standard-cycle-readiness-output.v1", operation_ref: "cycle_readiness_evaluate",
        outcome: checked.satisfied ? "completed" : "blocked", effect_status: "no_effect", facts: checked.satisfied ? { cycle_readiness_satisfied: true } : {},
        observations: { checks: checked.checks, record_operation_id: input.record_operation_id, record_sha256: shadowHash(output), context_sha256: fresh.context_sha256,
          cycle_path: source.cycle_path, scope_sha256: source.scope_sha256, implementation: "not_authorized",
          planning_source: { kind: "canonical_progress", operation_id: input.record_operation_id, output_sha256: shadowHash(output) }, initial_audit: initialAudit },
        evidence_refs: source.canonical.map(row => ({ ref: "audit:" + row.path, sha256: row.sha256 })) });
    }
    if (origin === "cycle_plan_adopt") {
      const recorded = acceptedOperation(instance, input.record_operation_id, "cycle_plan_adopt"), output = assertStandardOperationOutput(recorded.output), source = output.observations;
      if (output.effect_status !== "no_effect" || output.facts.canonical_cycle_plan_available !== true || source.source_kind !== "canonical_plan"
        || source.imported_completed_task_ids.length || !source.proposal) fail("STANDARD_CYCLE_READINESS_RECORD_REQUIRED");
      const assertSource = observed => {
        const rows = artifacts.readMany(source.canonical.map(row => row.path), { required: source.canonical.map(row => row.path), includeMetadata: true });
        const pins = rows.map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
        const context = observed.context, plan = context.documents.find(row => row.ref === `audit:${source.cycle_path}/plan.md`);
        if (source.context_sha256 !== observed.context_sha256 || source.scope_sha256 !== shadowHash(operations.observeScope())
          || source.canonical_binding_sha256 !== shadowHash(artifacts.describe()) || shadowHash(source.canonical) !== shadowHash(pins)
          || source.original_plan_sha256 !== artifactContentHash(plan?.content ?? "") || context.cycle_path !== source.cycle_path
          || context.mode !== "COMMITTING" || context.cycle_state !== "OPEN"
          || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
          fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
      };
      const observed = await observeCycleReadinessContext(); assertSource(observed);
      const proposal = source.proposal, admitted = await operations.auditCycle({ session_id: proposal.session_id, cycle_id: proposal.cycle_id });
      const start = await runStartSessionAdmitUseCase({ targetRoot: configuration.target_root, mode: "COMMITTING" });
      const fresh = await observeCycleReadinessContext(); assertSource(fresh);
      if (fresh.context_sha256 !== observed.context_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
      const evaluated = evaluateStandardCycleReadiness({ proposal, recordSha256: shadowHash(output), recordOperationId: input.record_operation_id,
        context: fresh.context, contextSha256: fresh.context_sha256, branchAdmitted: admitted.outcome === "completed" && start.ok === true && start.action === "resume_current_cycle" });
      evaluated.observations.planning_source = { kind: "canonical_plan", operation_id: input.record_operation_id, output_sha256: shadowHash(output) };
      evaluated.observations.initial_audit = await prework.canonicalWitness(instance, input.record_operation_id, options);
      return assertStandardOperationOutput(evaluated);
    }
    const recorded = acceptedOperation(instance, input.record_operation_id, "cycle_plan_record");
    if (recorded.output.effect_status !== "confirmed" || recorded.output.facts.cycle_plan_recorded !== true) fail("STANDARD_CYCLE_READINESS_RECORD_REQUIRED");
    const evaluationId = recorded.record.preview.input.evaluation_operation_id, evaluated = prework.accepted(instance, evaluationId);
    if (evaluated.output.observations.subject.kind !== "fresh_cycle") fail("STANDARD_PREWORK_CANONICAL_PLAN_REPLACEMENT_REFUSED");
    const observed = await observeCyclePlanContext(), postimages = recorded.output.observations.canonical_postimages;
    if (recorded.output.observations.causal_transition.before_context_sha256 !== evaluated.context_sha256
      || recorded.output.observations.causal_transition.after_context_sha256 !== observed.context_sha256
      || !Array.isArray(postimages) || postimages.length !== observed.context.documents.length
      || recorded.record.preview.prepared.plan.changes.some(row => !observed.context.documents.some(doc => doc.ref === "audit:" + row.path && doc.sha256 === row.after_sha256)))
      fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
    const context = readinessContext(observed), proposal = evaluated.output.observations.proposal;
    const assertPostimages = fresh => {
      const pins = fresh.context.documents.map((doc, index) => ({ path: doc.ref.slice(6), sha256: doc.sha256, metadata_sha256: fresh.context.metadata_pins[index].sha256 }));
      if (shadowHash(pins) !== shadowHash(postimages) || fresh.context_sha256 !== context.context_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
    };
    assertPostimages(context);
    const admitted = await operations.auditCycle({ session_id: proposal.session_id, cycle_id: proposal.cycle_id });
    const start = await runStartSessionAdmitUseCase({ targetRoot: configuration.target_root, mode: "COMMITTING" });
    const fresh = await observeCycleReadinessContext(); assertPostimages(fresh);
    const output = evaluateStandardCycleReadiness({ proposal, recordSha256: shadowHash(recorded.output), recordOperationId: input.record_operation_id,
      context: fresh.context, contextSha256: fresh.context_sha256, branchAdmitted: admitted.outcome === "completed" && start.ok === true && start.action === "resume_current_cycle" });
    output.observations.initial_audit = prework.witness(instance, evaluationId);
    return assertStandardOperationOutput(output);
  }
  async function readCycleReadinessEvaluation(instance, input, options = {}) {
    options.assertOwner?.();
    assertStandardOperationInput("cycle_implementation_enter", input);
    const verified = acceptedOperation(instance, input.evaluation_operation_id, "cycle_readiness_evaluate");
    if (verified.output.observations.planning_source?.kind === "canonical_progress") {
      const origin = canonicalResumeOrigin(instance, verified.record.preview.input.record_operation_id);
      if (origin.output.observations.work_intent !== "continue_implementation") fail("STANDARD_CANONICAL_RESUME_INTEGRATION_ONLY");
    }
    const output = await evaluateCycleReadiness(instance, verified.record.preview.input, options);
    if (output.facts.cycle_readiness_satisfied !== true || shadowHash(output) !== shadowHash(verified.output)) fail("STANDARD_CYCLE_READINESS_EVALUATION_STALE");
    const observed = await observeCycleReadinessContext();
    if (observed.context_sha256 !== output.observations.context_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
    options.assertOwner?.();
    return { output, evaluation_sha256: shadowHash(output), context: observed.context, context_sha256: observed.context_sha256,
      ...(["canonical_plan", "canonical_progress"].includes(output.observations.planning_source?.kind) ? { first_plan_step: (() => {
        const proposal = cyclePlanningProposal(instance, verified);
        if (output.observations.planning_source.kind === "canonical_plan") return proposal.tasks[0].task;
        const origin = canonicalResumeOrigin(instance, verified.record.preview.input.record_operation_id);
        return proposal.tasks[origin.output.observations.imported_completed_task_ids.length]?.task ?? "Run final verification and audit before explicit closure";
      })() } : {}) };
  }
  const observeCycleReadinessContext = async (productSha256 = readProductSha256?.()) => readinessContext(await readStandardCyclePlanContext({ targetRoot: configuration.target_root, productSha256, productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment, readinessTransition: true }));
  function canonicalResumeOrigin(instance, id, auth = {}, history = null) {
    const binding = instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id)?.intent.binding_ref;
    if (!canonicalCycleResumeAdmissionOperations.includes(binding)) fail("STANDARD_CANONICAL_RESUME_ADMISSION_REQUIRED");
    const adopted = acceptedOperation(instance, id, binding, auth, history), output = assertCanonicalResumeOutput(adopted.output);
    if (output.operation_ref !== binding || output.outcome !== "completed" || output.effect_status !== "no_effect" || output.facts.canonical_cycle_resume_available !== true
      || output.observations.admission_operation_id !== id || output.observations.readiness_satisfied !== true)
      fail("STANDARD_CANONICAL_RESUME_ADMISSION_REQUIRED");
    return adopted;
  }
  function cyclePlanningProposal(instance, ready, auth = {}, history = null) {
    const audit = prework.assertWitness(instance, ready.output.observations.initial_audit, { auth, history });
    const checkedProposal = proposal => {
      if (shadowHash(proposal) !== shadowHash(audit.output.observations.proposal)) fail("STANDARD_PREWORK_WITNESS_CHANGED");
      return proposal;
    };
    const id = ready.record.preview.input.record_operation_id;
    const origin = instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id)?.intent.binding_ref;
    if (canonicalCycleResumeAdmissionOperations.includes(origin)) {
      const adopted = canonicalResumeOrigin(instance, id, auth, history), source = adopted.output.observations;
      if (ready.output.facts.cycle_readiness_satisfied !== true || ready.output.observations.cycle_path !== source.cycle_path
        || ready.output.observations.scope_sha256 !== source.scope_sha256
        || shadowHash(ready.output.observations.planning_source ?? null) !== shadowHash({ kind: "canonical_progress", operation_id: id, output_sha256: shadowHash(adopted.output) }))
        fail("STANDARD_CYCLE_READINESS_RECORD_REQUIRED");
      if (audit.output.observations.subject.origin_operation_id !== id) fail("STANDARD_PREWORK_WITNESS_CHANGED");
      return checkedProposal(source.proposal);
    }
    if (origin === "cycle_plan_adopt") {
      const adopted = acceptedOperation(instance, id, "cycle_plan_adopt", auth, history), output = assertStandardOperationOutput(adopted.output);
      const source = output.observations, selected = ready.output.observations.planning_source;
      if (output.effect_status !== "no_effect" || output.facts.canonical_cycle_plan_available !== true || source.source_kind !== "canonical_plan"
        || source.imported_completed_task_ids.length || !source.proposal || ready.output.facts.cycle_readiness_satisfied !== true
        || ready.output.observations.cycle_path !== source.cycle_path
        || shadowHash(selected ?? null) !== shadowHash({ kind: "canonical_plan", operation_id: id, output_sha256: shadowHash(output) }))
        fail("STANDARD_CYCLE_READINESS_RECORD_REQUIRED");
      // The accepted DoR and phase bind this origin. Current task contexts and
      // signed advances validate subsequent changes; the original OPEN pins
      // are not falsely reapplied after those legitimate CAS transitions.
      if (audit.output.observations.subject.origin_operation_id !== id) fail("STANDARD_PREWORK_WITNESS_CHANGED");
      return checkedProposal(source.proposal);
    }
    const recorded = acceptedOperation(instance, id, "cycle_plan_record", auth, history);
    if (recorded.record.preview.input.evaluation_operation_id !== audit.record.operation_id) fail("STANDARD_PREWORK_WITNESS_CHANGED");
    return checkedProposal(audit.output.observations.proposal);
  }
  function taskPhase(instance, id, auth = {}, history = null) {
    const binding = instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id)?.intent.binding_ref;
    if (binding === retainedValidationAdmit) {
      const phase = acceptedRetainedPhase(instance, id, auth, history), proof = phase.output.observations.proof;
      return { phase, proposal: proof.proposal, phaseContextSha256: proof.context_sha256, canonicalResume: null, resumeSource: null };
    }
    let phase, proposal, resume = null, phaseContextSha256;
    if (canonicalCycleResumeAdmissionOperations.includes(binding)) {
      phase = canonicalResumeOrigin(instance, id, auth, history);
      if (phase.output.facts.cycle_resume_phase_admitted !== true || !["IMPLEMENTING", "VERIFYING"].includes(phase.output.observations.canonical_phase))
        fail("STANDARD_CANONICAL_RESUME_OPEN_TRANSITION_REQUIRED");
      resume = phase; proposal = phase.output.observations.proposal; phaseContextSha256 = phase.output.observations.context_sha256;
      // Read-only canonical DATA cannot project the current pending task into
      // CURRENT-STATE. Unfinished work needs the existing authorized DoR effect.
      if (phase.output.observations.imported_completed_task_ids.length < proposal.tasks.length)
        fail("STANDARD_CANONICAL_RESUME_IMPLEMENTATION_CHECKPOINT_REQUIRED");
    } else {
      phase = acceptedOperation(instance, id, "cycle_implementation_enter", auth, history);
      if (phase.output.effect_status !== "confirmed" || phase.output.facts.cycle_implementation_started !== true) fail("STANDARD_CYCLE_WORK_PHASE_REQUIRED");
      const ready = acceptedOperation(instance, phase.record.preview.input.evaluation_operation_id, "cycle_readiness_evaluate", auth, history);
      proposal = cyclePlanningProposal(instance, ready, auth, history); phaseContextSha256 = phase.output.observations.causal_transition.after_context_sha256;
      const recordId = ready.record.preview.input.record_operation_id,
        recordBinding = instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === recordId)?.intent.binding_ref;
      if (canonicalCycleResumeAdmissionOperations.includes(recordBinding)) resume = canonicalResumeOrigin(instance, recordId, auth, history);
    }
    return { phase, proposal, phaseContextSha256,
      canonicalResume: resume ? { source_operation_id: resume.record.operation_id, source_sha256: shadowHash(resume.output), completed_task_ids: resume.output.observations.imported_completed_task_ids } : null,
      resumeSource: resume ? { operation_id: resume.record.operation_id, output_sha256: shadowHash(resume.output), canonical_phase: resume.output.observations.canonical_phase,
        ...(resume.output.operation_ref === ownedCanonicalCycleResumeAdmitOperation ? { entry_operation_id: resume.output.observations.entry_operation_id }
          : { focus_checkpoint_operation_id: resume.output.observations.focus_checkpoint_operation_id }), source_sha256: resume.output.observations.source_sha256,
        continuity_action: resume.output.observations.continuity_action, work_intent: resume.output.observations.work_intent } : null };
  }
  function taskAdvances(instance, phaseId, auth = {}, history = null) {
    const result = [];
    for (const event of instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_task_advance")) {
      if (!instance.events.some(row => row.kind === "operation_result" && row.receipt.operation_id === event.intent.operation_id && row.receipt.outcome === "completed")) continue;
      const advanced = acceptedOperation(instance, event.intent.operation_id, "cycle_task_advance", auth, history), details = advanced.output.observations;
      if (details.implementation_operation_id !== phaseId) continue;
      const selected = acceptedOperation(instance, details.task_operation_id, "cycle_task_select", auth, history);
      const evaluated = acceptedOperation(instance, details.evaluation_operation_id, "cycle_validation_evaluate", auth, history);
      const validation = acceptedOperation(instance, evaluated.record.preview.input.validation_operation_id, "cycle_validation_execute", auth, history);
      const workId = validation.record.preview.input.work_operation_id, workBinding = operationStore.read(workId).record?.intent.binding_ref;
      if (!["cycle_task_work_evaluate", retainedTaskWork].includes(workBinding)) fail("STANDARD_TASK_PROGRESS_CHAIN_CHANGED");
      const work = acceptedOperation(instance, workId, workBinding, auth, history);
      if (selected.output.observations.context_sha256 !== details.selection_context_sha256 || selected.output.observations.task?.id !== details.task_id || selected.output.observations.previous_progress_operation_id !== details.previous_progress_operation_id
        || selected.output.observations.implementation_operation_id !== phaseId || work.output.observations.task_operation_id !== details.task_operation_id
        || details.validation_operation_id !== validation.record.operation_id || details.work_operation_id !== work.record.operation_id
        || advanced.record.preview.input.evaluation_operation_id !== details.evaluation_operation_id
        || details.causal_transition.before_context_sha256 !== evaluated.output.observations.context_sha256) fail("STANDARD_TASK_PROGRESS_CHAIN_CHANGED");
      result.push({ operation_id: event.intent.operation_id, output: advanced.output });
    }
    return result;
  }
  function taskCursor(instance, phaseId, subject, contextSha256, auth = {}, history = null) {
    const options = { proposal: subject.proposal, implementationOperationId: phaseId, phaseContextSha256: subject.phaseContextSha256,
      advances: taskAdvances(instance, phaseId, auth, history), contextSha256 };
    return subject.canonicalResume ? deriveStandardCanonicalResumeTaskCursor({ ...options, canonicalResume: subject.canonicalResume }) : deriveStandardCycleTaskCursor(options);
  }
  async function evaluateCycleTaskSelection(instance, input, auth = {}, productSha256 = readProductSha256?.()) {
    assertStandardOperationInput("cycle_task_select", input);
    const subject = taskPhase(instance, input.implementation_operation_id, auth), { proposal } = subject,
      observed = await (subject.canonicalResume ? observeCycleVerificationContext(productSha256) : observeCycleReadinessContext(productSha256));
    const cursor = taskCursor(instance, input.implementation_operation_id, subject, observed.context_sha256, auth);
    const brief = observed.context.documents.find(row => row.ref === "audit:" + observed.context.cycle_path + "/brief.md");
    const original = renderStandardCyclePlan(proposal, observed.context.cycle_path, { "brief.md": brief.content })[observed.context.cycle_path + "/plan.md"];
    if (artifacts.read(observed.context.cycle_path + "/plan.md", { required: true }).content !== renderStandardTaskProgress({ originalPlan: original, proposal, completedTaskIds: cursor.completed_task_ids })) fail("STANDARD_TASK_PROGRESS_PLAN_CHANGED");
    return { contract_version: "standard-cycle-task-output.v1", operation_ref: "cycle_task_select", outcome: "completed", effect_status: "no_effect",
      facts: { cycle_task_selected: !cursor.complete, cycle_tasks_finished: cursor.complete }, observations: { ...cursor,
        ...(subject.resumeSource ? { canonical_resume_origin: subject.resumeSource } : {}), task_count: proposal.tasks.length, cycle_path: observed.context.cycle_path },
      evidence_refs: observed.context.documents.filter(row => ["audit:CURRENT-STATE.md", "audit:" + observed.context.cycle_path + "/plan.md", "audit:" + observed.context.cycle_path + "/status.md"].includes(row.ref)).map(({ ref, sha256 }) => ({ ref, sha256 })) };
  }
  async function selectCycleExecutionSource(instance, input) {
    assertStandardOperationInput("cycle_execution_source_select", input);
    const current = () => {
      if (instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256 || artifacts.ownerPending())
        fail("STANDARD_CYCLE_EXECUTION_SOURCE_CHANGED");
    };
    current();
    const originBinding = instance.events.find(row => row.kind === "operation_intent" && row.intent.operation_id === input.record_operation_id)?.intent.binding_ref;
    if (!["cycle_plan_record", "cycle_plan_adopt", ...canonicalCycleResumeAdmissionOperations].includes(originBinding))
      fail("STANDARD_CYCLE_PLAN_RECORD_REQUIRED");
    const origin = acceptedOperation(instance, input.record_operation_id, originBinding);
    if (origin.output.operation_ref !== originBinding) fail("STANDARD_CYCLE_PLAN_RECORD_REQUIRED");
    let phaseId = null;
    const entries = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_implementation_enter"
      && instance.events.some(result => result.kind === "operation_result" && result.receipt.operation_id === row.intent.operation_id && result.receipt.outcome === "completed"));
    for (const entry of entries.toReversed()) {
      const phase = acceptedOperation(instance, entry.intent.operation_id, "cycle_implementation_enter"),
        ready = acceptedOperation(instance, phase.record.preview.input.evaluation_operation_id, "cycle_readiness_evaluate");
      if (ready.record.preview.input.record_operation_id === input.record_operation_id) { phaseId = phase.record.operation_id; break; }
    }
    if (!phaseId && canonicalCycleResumeAdmissionOperations.includes(originBinding)) phaseId = input.record_operation_id;
    if (!phaseId) fail("STANDARD_CYCLE_WORK_PHASE_REQUIRED");
    const subject = taskPhase(instance, phaseId), selected = await evaluateCycleTaskSelection(instance, { implementation_operation_id: phaseId });
    current();
    const cursor = selected.observations, remaining = subject.proposal.tasks.slice(cursor.completed_task_ids.length).map(row => row.id);
    return assertCycleExecutionSourceSelection({ contract_version: "standard-cycle-execution-source-output.v1", operation_ref: "cycle_execution_source_select",
      outcome: "completed", effect_status: "no_effect", facts: { cycle_execution_source_selected: true,
        cycle_work_tasks_pending: remaining.length > 0, cycle_work_product_ready: remaining.length === 0 },
      observations: { record_operation_id: input.record_operation_id, implementation_operation_id: phaseId,
        implementation_source_kind: phaseId === input.record_operation_id ? "canonical_progress" : "implementation_entry",
        phase_source_sha256: shadowHash(subject.phase.record), context_sha256: cursor.context_sha256, scope_sha256: cursor.scope_sha256,
        cycle_path: cursor.cycle_path, task_count: cursor.task_count, completed_task_ids: cursor.completed_task_ids,
        remaining_task_ids: remaining, imported_completed_task_ids: cursor.imported_completed_task_ids ?? [],
        implementation_authorized: false, current_native_work_evidence: false, current_validation_evidence: false },
      evidence_refs: [...selected.evidence_refs, { ref: "audit:" + operationJournalPath(origin.record.operation_id), sha256: shadowHash(origin.record) }] });
  }
  async function prepareTaskWorkActivity({ instance, occurrenceId, productSha256, productSnapshot }) {
    const auth = nativeReservation ? { reservation: nativeReservation } : {};
    authenticate(instance, auth); assertWorkProductSnapshot(productSnapshot);
    const resolution = resolveProcessOperationInput({ instance, occurrenceId, readOperation: id => { const row = operationStore.read(id).record; signer.verify(row); return row; } });
    if (Object.keys(resolution.input).join(",") !== "task_operation_id" || shadowHash(productSnapshot) !== productSha256) fail("STANDARD_CYCLE_WORK_INPUT_INVALID");
    const selected = acceptedOperation(instance, resolution.input.task_operation_id, "cycle_task_select", auth);
    const fresh = await evaluateCycleTaskSelection(instance, selected.record.preview.input, auth, productSha256), task = fresh.observations.task;
    if (shadowHash(fresh) !== shadowHash(selected.output) || !task || task.intent !== "implementation" || task.paths.some(row => row.operations.some(op => !["update", "add", "delete"].includes(op)))) fail("STANDARD_CYCLE_TASK_WORK_SOURCE_STALE");
    if (fresh.observations.canonical_resume_origin?.work_intent === "integration_only") fail("STANDARD_CANONICAL_RESUME_INTEGRATION_ONLY");
    const admission = await preWriteAdmit({ targetRoot: configuration.target_root, skill: "start-session" });
    if (admission.ok !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status)) fail("STANDARD_CYCLE_WORK_ADMISSION_BLOCKED");
    const observed = await observeCycleReadinessContext(productSha256);
    if (observed.context_sha256 !== fresh.observations.context_sha256) fail("STANDARD_CYCLE_TASK_WORK_SOURCE_STALE");
    const prefix = path.relative(configuration.target_root, configuration.product_root).replaceAll("\\", "/");
    if (prefix.startsWith("../") || path.isAbsolute(prefix)) fail("STANDARD_CYCLE_WORK_SCOPE_INVALID");
    const context = { contract_version: "standard-cycle-task-work-context.v1", task_operation_id: resolution.input.task_operation_id,
      implementation_operation_id: fresh.observations.implementation_operation_id, task_ordinal: fresh.observations.ordinal, task_count: fresh.observations.task_count,
      input_resolution: resolution, scope_sha256: fresh.observations.scope_sha256, task, source_context: observed.context, product_prefix: prefix, product_snapshot: productSnapshot,
      boundary_sha256: cycleWorkBoundary({ root: artifacts.root, context: observed.context, environment }, task.paths.map(row => row.path)) };
    return { context, context_sha256: shadowHash(context) };
  }
  async function prepareWorkActivity({ instance, occurrenceId, productSha256, productSnapshot }) {
    const auth = nativeReservation ? { reservation: nativeReservation } : {};
    authenticate(instance, auth); assertWorkProductSnapshot(productSnapshot);
    const resolution = resolveProcessOperationInput({ instance, occurrenceId, readOperation: id => { const row = operationStore.read(id).record; signer.verify(row); return row; } });
    if (Object.keys(resolution.input).join(",") !== "implementation_operation_id" || shadowHash(productSnapshot) !== productSha256) fail("STANDARD_CYCLE_WORK_INPUT_INVALID");
    const id = resolution.input.implementation_operation_id, subject = taskPhase(instance, id, auth);
    if (subject.canonicalResume) fail("STANDARD_CANONICAL_RESUME_TASK_SELECTION_REQUIRED");
    const phase = subject.phase;
    if (phase.output.effect_status !== "confirmed" || phase.output.facts.cycle_implementation_started !== true) fail("STANDARD_CYCLE_WORK_PHASE_REQUIRED");
    const ready = acceptedOperation(instance, phase.record.preview.input.evaluation_operation_id, "cycle_readiness_evaluate", auth);
    const proposal = cyclePlanningProposal(instance, ready, auth);
    const observed = await observeCycleReadinessContext(productSha256), task = proposal.tasks[0];
    if (observed.context.mode !== "COMMITTING" || observed.context.cycle_state !== "IMPLEMENTING"
      || phase.output.observations.causal_transition.after_context_sha256 !== observed.context_sha256
      || phase.record.preview.prepared.plan.scope_sha256 !== shadowHash(proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })))
      || task.intent !== "implementation" || task.paths.some(row => row.operations.some(op => !["update", "add", "delete"].includes(op)))) fail("STANDARD_CYCLE_WORK_SOURCE_STALE");
    const admission = await preWriteAdmit({ targetRoot: configuration.target_root, skill: "start-session" });
    if (admission.ok !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status)) fail("STANDARD_CYCLE_WORK_ADMISSION_BLOCKED");
    const prefix = path.relative(configuration.target_root, configuration.product_root).replaceAll("\\", "/");
    if (prefix.startsWith("../") || path.isAbsolute(prefix)) fail("STANDARD_CYCLE_WORK_SCOPE_INVALID");
    const context = { contract_version: "standard-cycle-work-context.v1", implementation_operation_id: id, input_resolution: resolution,
      scope_sha256: phase.record.preview.prepared.plan.scope_sha256, task, source_context: observed.context, product_prefix: prefix, product_snapshot: productSnapshot,
      boundary_sha256: cycleWorkBoundary({ root: artifacts.root, context: observed.context, environment }, task.paths.map(row => row.path)) };
    return { context, context_sha256: shadowHash(context) };
  }
  async function evaluateCycleWork(instance, input, contractRef = CYCLE_WORK_CONTRACT) {
    return evaluateCycleWorkEvidence(instance, input, contractRef);
  }
  async function evaluateCycleWorkEvidence(instance, input, contractRef, history = null) {
    assertStandardOperationInput(contractRef === CYCLE_TASK_WORK_CONTRACT ? "cycle_task_work_evaluate" : "cycle_work_evaluate", input);
    const authenticated = readActivityOutput(instance, input.report_occurrence_id, contractRef, {}, history);
    const event = instance.events.find(row => row.kind === "result" && row.occurrence_id === input.report_occurrence_id);
    const journal = allocations.read(nativeJournalId(instance)).record;
    const get = suffix => {
      const refs = event.result.evidence_refs.filter(row => row.ref.endsWith(suffix));
      if (refs.length !== 1 || refs[0].ref.split("/")[1] !== authenticated.reference.ref.split("/")[1]) fail("STANDARD_CYCLE_WORK_EVIDENCE_REQUIRED");
      const file = readAgentRunFile(nativeEvidenceFile(configuration, refs[0], journal.allocations.length), { maxBytes: 1048576 });
      if (file.sha256 !== refs[0].sha256) fail("STANDARD_CYCLE_WORK_EVIDENCE_REQUIRED");
      return { value: file.value, ref: refs[0] };
    };
    const source = get("-activity-context.json"), output = get("-artifact-output.json"), context = source.value.context;
    if (source.value.occurrence_id !== input.report_occurrence_id || output.value.occurrence_id !== input.report_occurrence_id || context.input_resolution.occurrence_id !== input.report_occurrence_id
      || source.value.context_sha256 !== authenticated.report.context_sha256 || shadowHash(output.value.files) !== output.value.artifact_sha256
      || output.value.artifact_sha256 !== readProductSha256?.()) fail("STANDARD_CYCLE_WORK_SOURCE_STALE");
    const observed = await observeCycleReadinessContext(output.value.artifact_sha256);
    return (contractRef === CYCLE_TASK_WORK_CONTRACT ? observeStandardCycleTaskWork : observeStandardCycleWork)({ report: authenticated.report, context, contextSha256: source.value.context_sha256, after: output.value.files,
      boundarySha256: cycleWorkBoundary({ root: artifacts.root, context: observed.context, environment }, context.task.paths.map(row => row.path)),
      producer: authenticated.producer, evidenceRefs: [authenticated.reference, source.ref, output.ref] });
  }
  // Read-only historical evaluation. It selects the same private diagnostic
  // authentication as retained-resource inspection, never an execution flag.
  // A caller receives evidence of prior work, not an activity result for a new
  // instance, an implementation grant or permission to bypass UNKNOWN.
  async function inspectRetainedCycleTaskWork(instance, workId) {
    const history = authenticateHistory(instance, {}, true);
    if (!history.journal?.allocations.length || !history.native?.parent_closed
      || history.journal.allocations.some(row => row.phase !== "closed" || row.tree_closed !== true))
      fail("STANDARD_RETAINED_WORK_NATIVE_UNSETTLED");
    const current = () => {
      if (instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
        fail("STANDARD_RETAINED_WORK_INSTANCE_CHANGED");
      if (shadowHash(allocations.read(nativeJournalId(instance)).record) !== shadowHash(history.journal))
        fail("STANDARD_RETAINED_WORK_NATIVE_UNSETTLED");
    };
    current();
    const work = acceptedOperation(instance, workId, "cycle_task_work_evaluate", {}, history);
    const fresh = await evaluateCycleWorkEvidence(instance, work.record.preview.input, CYCLE_TASK_WORK_CONTRACT, history);
    if (fresh.facts.cycle_work_observed !== true || shadowHash(fresh) !== shadowHash(work.output))
      fail("STANDARD_RETAINED_WORK_CHANGED");
    const subject = taskPhase(instance, work.output.observations.implementation_operation_id, {}, history);
    const selected = acceptedOperation(instance, work.output.observations.task_operation_id, "cycle_task_select", {}, history);
    if (subject.proposal.tasks.length !== 1 || selected.output.observations.ordinal !== 1
      || selected.output.observations.completed_task_ids.length || subject.canonicalResume?.completed_task_ids.length
      || subject.resumeSource?.work_intent === "integration_only"
      || instance.events.some(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_task_advance"))
      fail("STANDARD_RETAINED_WORK_PHASE_UNSUPPORTED");
    const observed = await observeCycleReadinessContext();
    if (observed.context.cycle_state !== "IMPLEMENTING" || observed.context.mode !== "COMMITTING"
      || selected.output.observations.context_sha256 !== subject.phaseContextSha256
      || shadowHash(fresh.observations.task) !== shadowHash(selected.output.observations.task)
      || shadowHash(fresh.observations.task) !== shadowHash(subject.proposal.tasks[0])
      || fresh.observations.scope_sha256 !== shadowHash(subject.proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths }))))
      fail("STANDARD_RETAINED_WORK_CONTEXT_CHANGED");
    const files = currentProductSnapshot(); current();
    if (shadowHash(operationStore.read(workId).record) !== shadowHash(work.record)) fail("STANDARD_RETAINED_WORK_CHANGED");
    return { instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
      work_operation_id: workId, work_journal_sha256: shadowHash(work.record), output_sha256: shadowHash(work.output),
      output: work.output, product_snapshot: files, product_sha256: shadowHash(files),
      original_native_producer: fresh.observations.producer, proposal: subject.proposal,
      context: observed.context, context_sha256: observed.context_sha256,
      validation_test_refs: subject.proposal.tests.map(row => row.id),
      contributors: history.native.resources.map(row => row.executor).filter(row => row.contributions.some(c => c.scope_id === instance.scope_id))
        .map(({ agent_id, lineage_id }) => ({ agent_id, lineage_id })),
      written: false, native_started: false,
      current_native_work_evidence: false, implementation_authorized: false, workflow_resumed: false };
  }
  function retainedEntry(instance) {
    const entry = instance.initial_parameters?.entry_point;
    if (entry?.kind !== "retained_validation") fail("STANDARD_RETAINED_VALIDATION_ENTRY_REQUIRED");
    return entry;
  }
  const continuationFor = proof => ({ source_instance_id: proof.original_instance_id, source_instance_sha256: proof.original_instance_sha256,
    recovery_operation_id: proof.recovery_operation_id, recovery_sha256: proof.recovery_sha256,
    work_operation_id: proof.work_operation_id, proof_sha256: shadowHash(proof) });
  async function retainedValidationEntry(instance, parameters, admission) {
    authenticate(instance);
    const proof = assertRetainedValidationProof(await retainedSource.inspect(retainedEntry(instance))), selected = admission.observations.selected_cycle;
    if (artifacts.ownerPending() || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_RETAINED_VALIDATION_OWNER_UNSETTLED");
    if (!selected || selected.state !== "IMPLEMENTING" || selected.cycle_id !== proof.proposal.cycle_id
      || parameters.session.session_id !== proof.proposal.session_id || selected.cycle_path !== proof.context.cycle_path
      || selected.branch !== proof.context.branch) fail("STANDARD_RETAINED_VALIDATION_FOCUS_CHANGED");
    return continuationFor(proof);
  }
  function retainedEntryRecord(instance, auth = {}, history = null) {
    const ids = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "workflow_entry_select");
    if (ids.length !== 1) fail("STANDARD_RETAINED_VALIDATION_ENTRY_REQUIRED");
    const entry = acceptedOperation(instance, ids[0].intent.operation_id, "workflow_entry_select", auth, history);
    if (entry.output.observations.entry_point !== "retained_validation" || entry.output.facts.retained_validation_requested !== true)
      fail("STANDARD_RETAINED_VALIDATION_ENTRY_REQUIRED");
    return entry;
  }
  async function admitRetainedValidation(instance) {
    const entry = retainedEntryRecord(instance), proof = assertRetainedValidationProof(await retainedSource.inspect(retainedEntry(instance)));
    if (shadowHash(continuationFor(proof)) !== shadowHash(entry.output.observations.continuation) || artifacts.ownerPending()
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_RETAINED_VALIDATION_SOURCE_CHANGED");
    const admission = await preWriteAdmit({ targetRoot: configuration.target_root, skill: "start-session" });
    if (admission.ok !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status)) fail("STANDARD_RETAINED_VALIDATION_ADMISSION_BLOCKED");
    if (shadowHash(await retainedSource.inspect(retainedEntry(instance))) !== shadowHash(proof)) fail("STANDARD_RETAINED_VALIDATION_SOURCE_CHANGED");
    return assertRetainedValidationOutput({ contract_version: "standard-retained-validation-admission-output.v1", operation_ref: retainedValidationAdmit,
      outcome: "completed", effect_status: "no_effect", facts: { cycle_retained_validation_admitted: true },
      observations: { proof, proof_sha256: shadowHash(proof), entry_operation_id: entry.record.operation_id,
        implementation_authorized: false, current_native_work_evidence: false, current_validation_evidence: false },
      evidence_refs: [{ ref: "audit:workflows/validation-launch-recoveries/" + proof.recovery_operation_id + ".json", sha256: proof.recovery_sha256 },
        { ref: "audit:" + operationJournalPath(proof.work_operation_id), sha256: proof.work_journal_sha256 }] });
  }
  function acceptedRetainedPhase(instance, id, auth = {}, history = null) {
    const phase = acceptedOperation(instance, id, retainedValidationAdmit, auth, history), output = assertRetainedValidationOutput(phase.output), proof = output.observations.proof;
    const entry = retainedEntryRecord(instance, auth, history);
    if (output.observations.entry_operation_id !== entry.record.operation_id
      || shadowHash(continuationFor(proof)) !== shadowHash(entry.output.observations.continuation)) fail("STANDARD_RETAINED_VALIDATION_SOURCE_CHANGED");
    retainedSource.assertPinned(retainedEntry(instance), retainedValidationPins(proof));
    return phase;
  }

  function verificationEntry(instance) {
    const entry = instance.initial_parameters?.entry_point;
    if (entry?.kind !== "retained_verification") fail("STANDARD_RETAINED_VERIFICATION_ENTRY_REQUIRED");
    return entry;
  }
  async function retainedVerificationEntry(instance, parameters, admission) {
    authenticate(instance);
    const { proof } = await retainedVerificationSource.inspect(verificationEntry(instance)), selected = admission.observations.selected_cycle;
    if (artifacts.ownerPending() || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_RETAINED_VERIFICATION_OWNER_UNSETTLED");
    if (!selected || selected.state !== "VERIFYING" || selected.cycle_id !== proof.context.cycle_id
      || parameters.session.session_id !== proof.context.session_id || selected.cycle_path !== proof.context.cycle_path
      || selected.branch !== proof.context.branch) fail("STANDARD_RETAINED_VERIFICATION_FOCUS_CHANGED");
    return retainedVerificationContinuation(proof);
  }
  function verificationEntryRecord(instance, auth = {}, history = null) {
    const rows = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "workflow_entry_select");
    if (rows.length !== 1) fail("STANDARD_RETAINED_VERIFICATION_ENTRY_REQUIRED");
    const entry = acceptedOperation(instance, rows[0].intent.operation_id, "workflow_entry_select", auth, history);
    if (entry.output.observations.entry_point !== "retained_verification" || entry.output.facts.retained_verification_requested !== true)
      fail("STANDARD_RETAINED_VERIFICATION_ENTRY_REQUIRED");
    return entry;
  }
  async function admitRetainedVerification(instance) {
    const entry = verificationEntryRecord(instance), { proof } = await retainedVerificationSource.inspect(verificationEntry(instance));
    if (shadowHash(retainedVerificationContinuation(proof)) !== shadowHash(entry.output.observations.continuation)
      || artifacts.ownerPending() || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_RETAINED_VERIFICATION_SOURCE_CHANGED");
    return assertRetainedVerificationOutput({ contract_version: "standard-retained-verification-admission-output.v1", operation_ref: retainedVerificationAdmit,
      outcome: "completed", effect_status: "no_effect", facts: { cycle_retained_verification_admitted: true },
      observations: { proof, proof_sha256: shadowHash(proof), entry_operation_id: entry.record.operation_id,
        implementation_authorized: false, current_native_work_evidence: false, current_validation_evidence: false },
      evidence_refs: [{ ref: "audit:" + operationJournalPath(proof.audit_operation_id), sha256: proof.audit_journal_sha256 },
        { ref: "audit:" + operationJournalPath(proof.verification_operation_id), sha256: proof.verification_journal_sha256 }] });
  }
  function acceptedRetainedVerification(instance, id, auth = {}, history = null) {
    const phase = acceptedOperation(instance, id, retainedVerificationAdmit, auth, history), output = assertRetainedVerificationOutput(phase.output), proof = output.observations.proof;
    const entry = verificationEntryRecord(instance, auth, history);
    if (output.observations.entry_operation_id !== entry.record.operation_id
      || shadowHash(retainedVerificationContinuation(proof)) !== shadowHash(entry.output.observations.continuation)) fail("STANDARD_RETAINED_VERIFICATION_SOURCE_CHANGED");
    retainedVerificationSource.assertPinned(verificationEntry(instance), proof); return phase;
  }
  async function retainedVerificationBridge(instance, phaseId, auth = {}, productSha256, history = null, currentOwner = null) {
    const phase = acceptedRetainedVerification(instance, phaseId, auth, history);
    const assertCurrentOwner = nativeReservation && auth.reservation === nativeReservation
      ? createRetainedAuditNativeOwnerAssertion({ configuration, instance, reservation: nativeReservation, signer, artifacts,
        readJournal: () => allocations.read(nativeJournalId(instance)).record,
        readInstance: () => instances.read(instance.instance_id).record, readAuthority: read }) : currentOwner;
    const retained = await retainedVerificationSource.inspect(verificationEntry(instance), { assertCurrentOwner });
    if (shadowHash(retained.proof) !== phase.output.observations.proof_sha256
      || retained.proof.product_sha256 !== (productSha256 ?? readProductSha256?.())) fail("STANDARD_RETAINED_VERIFICATION_SOURCE_CHANGED");
    return retained.bridge;
  }

  async function selectWorkPhase(instance) {
    const kind = instance.initial_parameters?.entry_point?.kind, retained = kind === "retained_validation", verified = kind === "retained_verification";
    const binding = verified ? retainedVerificationAdmit : retained ? retainedValidationAdmit : "cycle_execution_source_select";
    const candidates = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === binding);
    if (candidates.length !== 1) fail("STANDARD_WORK_PHASE_SELECTION_REQUIRED");
    const id = candidates[0].intent.operation_id, source = verified ? acceptedRetainedVerification(instance, id)
      : retained ? acceptedRetainedPhase(instance, id) : acceptedOperation(instance, id, binding);
    return assertRetainedValidationOutput({ contract_version: "standard-work-phase-selection-output.v2", operation_ref: workPhaseSelect,
      outcome: "completed", effect_status: "no_effect", facts: { cycle_work_retained_validation: retained, cycle_work_retained_verification: verified,
        cycle_work_tasks_pending: !retained && !verified && source.output.facts.cycle_work_tasks_pending,
        cycle_work_product_ready: !retained && !verified && source.output.facts.cycle_work_product_ready },
      observations: { implementation_operation_id: retained || verified ? id : source.output.observations.implementation_operation_id,
        source_operation_id: id, source_sha256: shadowHash(source.record) }, evidence_refs: source.output.evidence_refs });
  }
  async function observeRetainedTaskWork(instance, input, { assertOwner = null } = {}) {
    assertStandardOperationInput(retainedTaskWork, input);
    const phase = acceptedRetainedPhase(instance, input.implementation_operation_id), proof = phase.output.observations.proof;
    if (assertOwner) assertOwner(); else if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    const selected = acceptedOperation(instance, input.task_operation_id, "cycle_task_select");
    const fresh = await evaluateCycleTaskSelection(instance, { implementation_operation_id: input.implementation_operation_id });
    if (shadowHash(selected.output) !== shadowHash(fresh) || fresh.observations.complete || fresh.observations.ordinal !== 1
      || fresh.observations.context_sha256 !== proof.context_sha256 || shadowHash(fresh.observations.task) !== shadowHash(proof.proposal.tasks[0])
      || shadowHash(await retainedSource.inspect(retainedEntry(instance))) !== shadowHash(proof)) fail("STANDARD_RETAINED_VALIDATION_SOURCE_CHANGED");
    return assertRetainedValidationOutput({ contract_version: "standard-retained-task-work-output.v1", operation_ref: retainedTaskWork,
      outcome: "completed", effect_status: "no_effect", facts: { cycle_work_observed: true, cycle_validation_required: true },
      observations: { ...input, source_kind: "retained_native_work", source: retainedValidationPins(proof), task: proof.proposal.tasks[0],
        producer: proof.output.observations.producer, scope_sha256: proof.output.observations.scope_sha256, after_product_sha256: proof.product_sha256,
        product_snapshot: proof.product_snapshot, validation_test_refs: proof.validation_test_refs,
        validation: "not_executed", implementation_authorized: false, current_native_work_evidence: false,
        authorship: "retained_native_producer_not_current_activity" }, evidence_refs: phase.output.evidence_refs });
  }
  function retainedContributors(instance) {
    if (instance.initial_parameters?.entry_point?.kind === "retained_verification") {
      const id = instance.events.find(row => row.kind === "operation_intent" && row.intent.binding_ref === retainedVerificationAdmit)?.intent.operation_id;
      return structuredClone(acceptedRetainedVerification(instance, id, nativeReservation ? { reservation: nativeReservation } : {}).output.observations.proof.contributors);
    }
    if (instance.initial_parameters?.entry_point?.kind !== "retained_validation") return [];
    const id = instance.events.find(row => row.kind === "operation_intent" && row.intent.binding_ref === retainedValidationAdmit)?.intent.operation_id;
    return structuredClone(acceptedRetainedPhase(instance, id, nativeReservation ? { reservation: nativeReservation } : {}).output.observations.proof.contributors);
  }
  function currentProductSnapshot() {
    if (typeof readProductSnapshot !== "function") fail("STANDARD_CANONICAL_RESUME_PRODUCT_AUTHORITY_REQUIRED");
    const before = readProductSha256?.(), files = readProductSnapshot();
    assertWorkProductSnapshot(files);
    if (shadowHash(files) !== before || before !== readProductSha256?.()) fail("STANDARD_CANONICAL_RESUME_PRODUCT_CHANGED");
    return structuredClone(files);
  }
  async function observeCanonicalResumeProduct(instance, input, { assertOwner = null } = {}) {
    assertCanonicalResumeObserveInput(input); authenticate(instance);
    const current = () => {
      if (instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail("STANDARD_CANONICAL_RESUME_PROCESS_CHANGED");
      if (assertOwner !== null) {
        if (typeof assertOwner !== "function") fail("STANDARD_CANONICAL_RESUME_OWNER_AUTHORITY_REQUIRED");
        assertOwner();
      } else if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    };
    current();
    const subject = taskPhase(instance, input.implementation_operation_id);
    if (!subject.canonicalResume) fail("STANDARD_CANONICAL_RESUME_ADMISSION_REQUIRED");
    const before = await observeCycleVerificationContext(); current();
    if (!["IMPLEMENTING", "VERIFYING"].includes(before.context.cycle_state)) fail("STANDARD_CANONICAL_RESUME_PHASE_REQUIRED");
    const cursor = taskCursor(instance, input.implementation_operation_id, subject, before.context_sha256);
    if (!cursor.complete) fail("STANDARD_CANONICAL_RESUME_WORK_INCOMPLETE");
    const files = currentProductSnapshot(), admitted = await preWriteAdmit({ targetRoot: configuration.target_root,
      skill: before.context.cycle_state === "VERIFYING" ? "cycle-close" : "start-session" });
    if (admitted.ok !== true || !["admitted", "admitted_with_warnings"].includes(admitted.admission_status)) fail("STANDARD_CANONICAL_RESUME_PRODUCT_ADMISSION_BLOCKED");
    current();
    const after = await observeCycleVerificationContext(), currentFiles = currentProductSnapshot(); current();
    if (before.context_sha256 !== after.context_sha256 || shadowHash(files) !== shadowHash(currentFiles)
      || shadowHash(files) !== after.context.product_sha256) fail("STANDARD_CANONICAL_RESUME_PRODUCT_CHANGED");
    const observedTasks = collectObservedTasks(instance, input.implementation_operation_id, subject.proposal, cursor.scope_sha256);
    if (subject.canonicalResume.completed_task_ids.some(id => observedTasks.has(id))) fail("STANDARD_CANONICAL_RESUME_WORK_OVERLAP");
    const origin = canonicalResumeOrigin(instance, subject.resumeSource.operation_id);
    current();
    return assertCanonicalResumeObserveOutput({ contract_version: "standard-canonical-cycle-resume-observe-output.v1", operation_ref: canonicalCycleResumeObserveOperation,
      outcome: "completed", effect_status: "no_effect", facts: { cycle_resume_product_observed: true, cycle_validation_required: true },
      observations: { source_kind: "canonical_resume_product", implementation_operation_id: input.implementation_operation_id,
        resume_operation_id: subject.resumeSource.operation_id, resume_output_sha256: subject.resumeSource.output_sha256,
        context_sha256: after.context_sha256, scope_sha256: cursor.scope_sha256, product_sha256: shadowHash(files), product_snapshot: files,
        canonical_phase: after.context.cycle_state, imported_completed_task_ids: subject.canonicalResume.completed_task_ids,
        current_observed_task_ids: subject.proposal.tasks.filter(row => observedTasks.has(row.id)).map(row => row.id), work_complete: true,
        authorship: "canonical_data_and_current_snapshot_not_native_writer_attestation", implementation_authorized: false, current_native_work_evidence: false },
      evidence_refs: [...after.context.documents.map(({ ref, sha256 }) => ({ ref, sha256 })),
        { ref: "audit:" + operationJournalPath(origin.record.operation_id), sha256: shadowHash(origin.record) }, { ref: "product:snapshot", sha256: shadowHash(files) }] });
  }
  function acceptedWorkSnapshot(instance, workId, { auth = {}, productSha256, history = null } = {}) {
    const binding = operationStore.read(workId).record?.intent.binding_ref;
    if (binding === retainedTaskWork) {
      const evaluated = acceptedOperation(instance, workId, binding, auth, history), output = assertRetainedValidationOutput(evaluated.output),
        phase = acceptedRetainedPhase(instance, output.observations.implementation_operation_id, auth, history), proof = phase.output.observations.proof;
      const selected = acceptedOperation(instance, output.observations.task_operation_id, "cycle_task_select", auth, history);
      if (shadowHash(output.observations.source) !== shadowHash(retainedValidationPins(proof))
        || shadowHash(output.observations.task) !== shadowHash(selected.output.observations.task)
        || selected.output.observations.implementation_operation_id !== phase.record.operation_id
        || shadowHash(output.observations.producer) !== shadowHash(proof.output.observations.producer)
        || shadowHash(output.observations.product_snapshot) !== proof.product_sha256 || proof.product_sha256 !== (productSha256 ?? readProductSha256?.()))
        fail("STANDARD_RETAINED_VALIDATION_SOURCE_CHANGED");
      return { evaluated, binding, output, evaluation_sha256: shadowHash(output), files: proof.product_snapshot,
        product_root: configuration.product_root, validation_test_refs: proof.validation_test_refs };
    }
    if (binding === canonicalCycleResumeObserveOperation) {
      const evaluated = acceptedOperation(instance, workId, binding, auth, history), output = assertCanonicalResumeObserveOutput(evaluated.output),
        subject = taskPhase(instance, output.observations.implementation_operation_id, auth, history), origin = subject.resumeSource,
        files = currentProductSnapshot();
      if (!origin || output.observations.resume_operation_id !== origin.operation_id || output.observations.resume_output_sha256 !== origin.output_sha256
        || output.observations.scope_sha256 !== shadowHash(subject.proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })))
        || shadowHash(output.observations.imported_completed_task_ids) !== shadowHash(subject.canonicalResume.completed_task_ids)
        || shadowHash(output.observations.product_snapshot) !== shadowHash(files) || shadowHash(files) !== (productSha256 ?? readProductSha256?.()))
        fail("STANDARD_CANONICAL_RESUME_PRODUCT_CHANGED");
      return { evaluated, binding, output, evaluation_sha256: shadowHash(output), files, product_root: configuration.product_root,
        validation_test_refs: subject.proposal.tests.map(row => row.id) };
    }
    if (!["cycle_work_evaluate", "cycle_task_work_evaluate"].includes(binding)) fail("STANDARD_VALIDATION_WORK_REQUIRED");
    const evaluated = acceptedOperation(instance, workId, binding, auth, history), output = evaluated.output;
    if (output.facts.cycle_work_observed !== true) fail("STANDARD_VALIDATION_WORK_REQUIRED");
    const contractRef = binding === "cycle_task_work_evaluate" ? CYCLE_TASK_WORK_CONTRACT : CYCLE_WORK_CONTRACT;
    const native = readActivityOutput(instance, evaluated.record.preview.input.report_occurrence_id, contractRef, auth, history);
    if (shadowHash(native.producer) !== shadowHash(output.observations.producer)) fail("STANDARD_VALIDATION_WORK_STALE");
    const ref = output.evidence_refs.find(row => row.ref.endsWith("-artifact-output.json")), journal = allocations.read(nativeJournalId(instance)).record;
    const observed = readAgentRunFile(nativeEvidenceFile(configuration, ref, journal.allocations.length), { sha256: ref.sha256, maxBytes: 1048576 }).value;
    if (observed.occurrence_id !== evaluated.record.preview.input.report_occurrence_id || shadowHash(observed.files) !== observed.artifact_sha256 || observed.artifact_sha256 !== (productSha256 ?? readProductSha256?.())) fail("STANDARD_VALIDATION_WORK_STALE");
    let validation_test_refs;
    if (binding === "cycle_task_work_evaluate") {
      const selected = acceptedOperation(instance, output.observations.task_operation_id, "cycle_task_select", auth, history);
      const { proposal } = taskPhase(instance, output.observations.implementation_operation_id, auth, history);
      validation_test_refs = selected.output.observations.ordinal === proposal.tasks.length ? proposal.tests.map(row => row.id) : output.observations.task.test_refs;
    }
    return { evaluated, binding, output, evaluation_sha256: shadowHash(output), files: observed.files, product_root: configuration.product_root, ...(validation_test_refs ? { validation_test_refs } : {}) };
  }
  async function readCycleWorkEvaluation(instance, input, options = {}) {
    assertStandardOperationInput("cycle_validation_execute", input);
    const work = acceptedWorkSnapshot(instance, input.work_operation_id);
    const output = work.binding === retainedTaskWork ? await observeRetainedTaskWork(instance, work.evaluated.record.preview.input, options) : work.binding === canonicalCycleResumeObserveOperation
      ? await observeCanonicalResumeProduct(instance, work.evaluated.record.preview.input, options)
      : await evaluateCycleWork(instance, work.evaluated.record.preview.input, work.binding === "cycle_task_work_evaluate" ? CYCLE_TASK_WORK_CONTRACT : CYCLE_WORK_CONTRACT);
    if (shadowHash(output) !== work.evaluation_sha256) fail("STANDARD_VALIDATION_WORK_STALE");
    return work;
  }
  function collectObservedTasks(instance, phaseId, proposal, scopeSha256, auth = {}, history = null) {
    const observedTasks = new Set();
    for (const event of instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === retainedTaskWork)) {
      if (!instance.events.some(row => row.kind === "operation_result" && row.receipt.operation_id === event.intent.operation_id && row.receipt.outcome === "completed")) continue;
      const work = acceptedWorkSnapshot(instance, event.intent.operation_id, { auth, history });
      if (work.output.observations.implementation_operation_id !== phaseId) continue;
      if (work.output.observations.scope_sha256 !== scopeSha256 || proposal.tasks.length !== 1
        || shadowHash(work.output.observations.task) !== shadowHash(proposal.tasks[0])) fail("STANDARD_VERIFICATION_TASK_SOURCE_CHANGED");
      observedTasks.add(proposal.tasks[0].id);
    }
    for (const event of instance.events.filter(row => row.kind === "operation_intent" && ["cycle_work_evaluate", "cycle_task_work_evaluate"].includes(row.intent.binding_ref))) {
      const accepted = instance.events.some(row => row.kind === "operation_result" && row.receipt.operation_id === event.intent.operation_id && row.receipt.outcome === "completed");
      if (!accepted) continue;
      const prior = acceptedOperation(instance, event.intent.operation_id, event.intent.binding_ref, auth, history), facts = prior.output;
      if (facts.facts.cycle_work_observed !== true || facts.observations.implementation_operation_id !== phaseId || facts.observations.scope_sha256 !== scopeSha256) continue;
      const task = proposal.tasks.find(row => row.id === facts.observations.task.id);
      if (!task || shadowHash(task) !== shadowHash(facts.observations.task)) fail("STANDARD_VERIFICATION_TASK_SOURCE_CHANGED");
      const report = readActivityOutput(instance, prior.record.preview.input.report_occurrence_id,
        event.intent.binding_ref === "cycle_task_work_evaluate" ? CYCLE_TASK_WORK_CONTRACT : CYCLE_WORK_CONTRACT, auth, history);
      if (report.report.task !== task.task || shadowHash(report.producer) !== shadowHash(facts.observations.producer)) fail("STANDARD_VERIFICATION_TASK_SOURCE_CHANGED");
      observedTasks.add(task.id);
    }
    return observedTasks;
  }
  function cycleValidationSubject(instance, work, auth = {}, retainedHistory = null) {
    const phaseId = work.output.observations.implementation_operation_id;
    // One selected PostgreSQL history observation still authenticates this
    // synchronous subject. Subsequent callers acquire their own observation.
    const history = retainedHistory ?? (operationStore.readMany ? authenticateHistory(instance, auth) : null), subject = taskPhase(instance, phaseId, auth, history),
      observedTasks = collectObservedTasks(instance, phaseId, subject.proposal, work.output.observations.scope_sha256, auth, history),
      importedTasks = new Set(subject.canonicalResume?.completed_task_ids ?? []);
    if ([...importedTasks].some(id => observedTasks.has(id))) fail("STANDARD_CANONICAL_RESUME_WORK_OVERLAP");
    return { phaseId, ...subject, observedTasks, importedTasks };
  }
  async function readCycleVerificationHistory(instance, input, auth = {}, productSha256, history = null) {
    if (!input || Object.keys(input).join(",") !== "implementation_operation_id" || !/^op_[a-f0-9]{40}$/.test(input.implementation_operation_id ?? "")) fail("STANDARD_AUDIT_INPUT_INVALID");
    if (!history) authenticate(instance, auth);
    const admission = await preWriteAdmit({ targetRoot: configuration.target_root, skill: "cycle-close" });
    if (admission.ok !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status)) fail("STANDARD_AUDIT_ADMISSION_BLOCKED");
    const currentProduct = () => productSha256 ?? readProductSha256?.();
    const context = await observeCycleVerificationContext(currentProduct());
    if (context.context.cycle_state !== "VERIFYING") fail("STANDARD_AUDIT_VERIFICATION_REQUIRED");
    const candidates = [];
    for (const event of instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_verification_enter")) {
      if (!instance.events.some(row => row.kind === "operation_result" && row.receipt.operation_id === event.intent.operation_id && row.receipt.outcome === "completed")) continue;
      const verification = acceptedOperation(instance, event.intent.operation_id, "cycle_verification_enter", auth, history), details = verification.output.observations;
      if (verification.output.facts.cycle_verification_started !== true || verification.output.effect_status !== "confirmed"
        || details.causal_transition?.after_context_sha256 !== context.context_sha256) continue;
      const evaluation = acceptedOperation(instance, verification.record.preview.input.evaluation_operation_id, "cycle_validation_evaluate", auth, history);
      const validation = acceptedOperation(instance, evaluation.record.preview.input.validation_operation_id, "cycle_validation_execute", auth, history);
      const work = acceptedWorkSnapshot(instance, validation.record.preview.input.work_operation_id, { auth, productSha256: context.context.product_sha256, history });
      if (work.output.observations.implementation_operation_id !== input.implementation_operation_id) continue;
      const subject = cycleValidationSubject(instance, work, auth, history);
      if (details.evaluation_operation_id !== evaluation.record.operation_id || details.scope_sha256 !== work.output.observations.scope_sha256
        || details.causal_transition.before_context_sha256 !== evaluation.output.observations.context_sha256
        || details.causal_transition.evaluation_sha256 !== shadowHash(evaluation.output)
        || verification.record.preview.prepared.plan.evaluation_sha256 !== shadowHash(evaluation.output)
        || verification.record.preview.prepared.plan.context_sha256 !== details.causal_transition.before_context_sha256) fail("STANDARD_AUDIT_VERIFICATION_BRIDGE_CHANGED");
      if (evaluation.record.preview.input.progress_operation_id) {
        const progress = acceptedOperation(instance, evaluation.record.preview.input.progress_operation_id, "cycle_task_advance", auth, history);
        if (progress.output.observations.validation_operation_id !== validation.record.operation_id
          || progress.output.observations.work_operation_id !== work.evaluated.record.operation_id
          || progress.output.observations.causal_transition.after_context_sha256 !== details.causal_transition.before_context_sha256) fail("STANDARD_AUDIT_VERIFICATION_BRIDGE_CHANGED");
        const cursor = taskCursor(instance, subject.phaseId, subject, details.causal_transition.before_context_sha256, auth, history);
        if (!cursor.complete || cursor.previous_progress_operation_id !== progress.record.operation_id) fail("STANDARD_AUDIT_TASKS_INCOMPLETE");
      }
      candidates.push({ verification, evaluation, source: { ...validation, work, proposal: subject.proposal, observed_task_ids: [...subject.observedTasks],
        ...(subject.canonicalResume ? { imported_task_ids: [...subject.importedTasks], canonical_resume_source: subject.resumeSource } : {}) },
        context: context.context, context_sha256: context.context_sha256 });
    }
    if (candidates.length !== 1) fail("STANDARD_AUDIT_VERIFICATION_AMBIGUOUS");
    if ((await observeCycleVerificationContext(currentProduct())).context_sha256 !== context.context_sha256) fail("STANDARD_AUDIT_SOURCE_CHANGED");
    return candidates[0];
  }

  async function readCycleVerificationExecution(instance, input, auth = {}, productSha256) {
    if (instance.initial_parameters?.entry_point?.kind === "retained_audit"
      && !instance.events.some(row => row.kind === "operation_intent" && row.intent.operation_id === input.implementation_operation_id)) {
      const retained = await retainedAuditForCurrent(instance);
      if (shadowHash(input) === shadowHash(retained.native.selection.record.preview.input)) return retained.bridge;
    }
    if (instance.initial_parameters?.entry_point?.kind === "retained_verification") {
      assertStandardOperationInput("cycle_audit_select", input);
      return retainedVerificationBridge(instance, input.implementation_operation_id, auth, productSha256);
    }
    return readCycleVerificationHistory(instance, input, auth, productSha256);
  }
  async function inspectRetainedCycleVerification(instance, selectionId, { assertCurrentOwner = null } = {}) {
    // Bounded to the existing single-task retained-validation origin. Only this
    // private reader chooses historical authentication; execution never does.
    if (instance.initial_parameters?.entry_point?.kind !== "retained_validation") fail("STANDARD_RETAINED_VERIFICATION_ORIGIN_UNSUPPORTED");
    const history = authenticateHistory(instance, {}, true), product = currentProductSnapshot();
    const stable = () => {
      if (assertCurrentOwner !== null) {
        if (typeof assertCurrentOwner !== "function" || assertCurrentOwner() !== undefined) fail("STANDARD_PROCESS_AUDIT_OWNER_CHANGED");
      } else if (artifacts.ownerPending()) fail("STANDARD_RETAINED_VERIFICATION_SOURCE_CHANGED");
      if (instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256
        || shadowHash(currentProductSnapshot()) !== shadowHash(product)) fail("STANDARD_RETAINED_VERIFICATION_SOURCE_CHANGED");
    };
    stable();
    const journal = allocations.read(nativeJournalId(instance)).record;
    if (!journal || journal.allocations.some(row => row.tree_closed !== true
      || row.phase !== "closed" && !nativeReconciliationHistory.resolution(journal, row))) fail("STANDARD_RETAINED_VERIFICATION_CLOSURE_REQUIRED");
    const cursor = inspectAgenticProcess(instance);
    if (cursor.occurrences.some(frame => frame.status === "RUNNING" && processFrameNode(instance.model, frame)?.kind === "activity"))
      fail("STANDARD_RETAINED_VERIFICATION_SOURCE_ACTIVE");
    for (const event of instance.events.filter(row => row.kind === "operation_intent")) {
      const record = operationStore.read(event.intent.operation_id).record;
      if (record?.phase !== "receipted" || record.results.at(-1)?.receipt.effect_status === "unknown")
        fail("STANDARD_RETAINED_VERIFICATION_EFFECT_UNSETTLED");
    }
    if (instance.events.findLast(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_audit_select")?.intent.operation_id !== selectionId)
      fail("STANDARD_RETAINED_VERIFICATION_SELECTION_CHANGED");
    const selection = acceptedOperation(instance, selectionId, "cycle_audit_select", {}, history);
    const bridge = await readCycleVerificationHistory(instance, selection.record.preview.input, {}, shadowHash(product), history);
    const material = observeCycleAuditContext(bridge, selection.output.observations.validation);
    if (material.context_sha256 !== selection.output.observations.audit_context_sha256
      || bridge.verification.record.operation_id !== selection.output.observations.verification_operation_id) fail("STANDARD_RETAINED_VERIFICATION_SELECTION_CHANGED");
    const phase = acceptedRetainedPhase(instance, selection.record.preview.input.implementation_operation_id, {}, history);
    stable();
    if (shadowHash(allocations.read(nativeJournalId(instance)).record) !== shadowHash(journal)) fail("STANDARD_RETAINED_VERIFICATION_SOURCE_CHANGED");
    return { bridge, selection, material, contributors: phase.output.observations.proof.contributors,
      product_sha256: shadowHash(product), native_journal_sha256: shadowHash(journal) };
  }

  function readRecordedCycleValidation(instance, proof) {
    if (instance.initial_parameters?.entry_point?.kind !== "retained_validation"
      || proof.original_instance_id !== instance.instance_id || proof.original_instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_RETAINED_VERIFICATION_ORIGIN_UNSUPPORTED");
    const history = authenticateHistory(instance, {}, true), product = currentProductSnapshot();
    const selection = acceptedOperation(instance, proof.audit_operation_id, "cycle_audit_select", {}, history);
    const verification = acceptedOperation(instance, proof.verification_operation_id, "cycle_verification_enter", {}, history);
    const evaluation = acceptedOperation(instance, proof.evaluation_operation_id, "cycle_validation_evaluate", {}, history);
    const validation = acceptedOperation(instance, proof.validation_operation_id, "cycle_validation_execute", {}, history);
    const work = acceptedWorkSnapshot(instance, validation.record.preview.input.work_operation_id, { history, productSha256: shadowHash(product) });
    if (shadowHash(product) !== proof.product_sha256 || shadowHash(work.files) !== proof.product_sha256
      || selection.output.observations.audit_context_sha256 !== proof.audit_context_sha256
      || selection.output.observations.verification_operation_id !== verification.record.operation_id
      || verification.output.observations.causal_transition?.after_context_sha256 !== proof.context_sha256
      || verification.record.preview.input.evaluation_operation_id !== evaluation.record.operation_id
      || evaluation.record.preview.input.validation_operation_id !== validation.record.operation_id
      || evaluation.output.facts.cycle_work_complete !== true || evaluation.output.facts.cycle_checks_passed !== true
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_CYCLE_CLOSE_VALIDATION_REQUIRED");
    return { ...validation, work, evaluation, verification };
  }
  const inspectRetainedCycleAudit = (instance, failedId, options) => inspectRetainedCycleAuditSource(instance, failedId, options, false);
  const readRecordedCycleAudit = (instance, failedId) => inspectRetainedCycleAuditSource(instance, failedId, {}, true);
  async function inspectRetainedCycleAuditSource(instance, failedId, { assertCurrentOwner = null } = {}, recorded = false) {
    if (instance.initial_parameters?.entry_point?.kind !== "retained_verification") fail("STANDARD_RETAINED_AUDIT_ORIGIN_UNSUPPORTED");
    const history = authenticateHistory(instance, {}, true), product = currentProductSnapshot();
    const stable = () => {
      if (assertCurrentOwner !== null) {
        if (typeof assertCurrentOwner !== "function" || assertCurrentOwner() !== undefined) fail("STANDARD_PROCESS_AUDIT_OWNER_CHANGED");
      } else if (!recorded && artifacts.ownerPending()) fail("STANDARD_RETAINED_AUDIT_SOURCE_CHANGED");
      if (instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256
        || shadowHash(currentProductSnapshot()) !== shadowHash(product)) fail("STANDARD_RETAINED_AUDIT_SOURCE_CHANGED");
    };
    stable();
    const journal = allocations.read(nativeJournalId(instance)).record;
    if (!journal?.allocations.length || journal.allocations.some(row => row.phase !== "closed" || row.tree_closed !== true))
      fail("STANDARD_RETAINED_AUDIT_CLOSURE_REQUIRED");
    if (history.cursor.occurrences.some(frame => frame.status === "RUNNING" && processFrameNode(instance.model, frame)?.kind === "activity"))
      fail("STANDARD_RETAINED_AUDIT_SOURCE_ACTIVE");
    const intents = instance.events.filter(row => row.kind === "operation_intent");
    if (intents.at(-1)?.intent.operation_id !== failedId) fail("STANDARD_RETAINED_AUDIT_BOUNDARY_CHANGED");
    for (const event of intents) {
      const record = history.records.get(event.intent.operation_id), receipt = record?.results.at(-1)?.receipt;
      if (record?.phase !== "receipted" || !receipt || receipt.effect_status === "unknown") fail("STANDARD_RETAINED_AUDIT_EFFECT_UNSETTLED");
    }
    const failed = history.records.get(failedId), result = failed?.results.at(-1);
    if (failed?.intent.binding_ref !== "cycle_audit_evaluate" || result?.receipt.outcome !== "blocked" || result.receipt.effect_status !== "no_effect"
      || result.output.observations.reason_code !== "NATIVE_OWNER_RETIRED_WITNESS_CHANGED"
      || !instance.events.some(row => row.kind === "operation_result" && shadowHash(row.receipt) === shadowHash(result.receipt)))
      fail("STANDARD_RETAINED_AUDIT_BOUNDARY_CHANGED");
    const native = readCycleAuditActivityAuthenticated(instance, failed.preview.input, history);
    const phaseId = native.selection.record.preview.input.implementation_operation_id;
    const phase = acceptedRetainedVerification(instance, phaseId, {}, history), verificationProof = phase.output.observations.proof;
    const frame = history.cursor.occurrences.find(row => row.occurrence_id === failed.preview.input.report_occurrence_id), assigned = frame?.assignment;
    if (frame?.status !== "COMPLETED" || assigned?.request.independent_review !== true || assigned.request.context_isolation_required !== true
      || assigned.request.role !== "auditor" || assigned.request.action !== "audit" || assigned.decision.write_authorization !== false
      || assigned.request.allowed_permissions.some(permission => permission !== "read:product")
      || verificationProof.contributors.some(row => row.agent_id === assigned.decision.agent_id || row.lineage_id === assigned.decision.lineage_id
        || !assigned.request.reviewed_contributors.some(excluded => shadowHash(excluded) === shadowHash(row))))
      fail("STANDARD_RETAINED_AUDIT_INDEPENDENCE_REQUIRED");
    if (recorded) {
      const source = retainedVerificationSource.readRecordedValidation(verificationEntry(instance), verificationProof), machine = native.context.validation;
      const { audit_operation_id, input_resolution, ...baseContext } = native.context;
      if (shadowHash(baseContext) !== verificationProof.audit_context_sha256
        || native.selection.output.observations.audit_context_sha256 !== verificationProof.audit_context_sha256
        || native.context.source_context_sha256 !== verificationProof.context_sha256
        || machine.validation_operation_id !== source.record.operation_id || machine.evaluation_operation_id !== source.evaluation.record.operation_id
        || machine.work_complete !== true || machine.product_sha256 !== shadowHash(product)
        || native.selection.output.observations.verification_operation_id !== source.verification.record.operation_id)
        fail("STANDARD_CYCLE_CLOSE_VALIDATION_REQUIRED");
      stable(); if (shadowHash(allocations.read(nativeJournalId(instance)).record) !== shadowHash(journal)) fail("STANDARD_RETAINED_AUDIT_SOURCE_CHANGED");
      return { native, source, context: verificationProof.context, verification_proof: verificationProof };
    }
    const bridge = await retainedVerificationBridge(instance, phaseId, {}, shadowHash(product), history, assertCurrentOwner);
    const material = observeCycleAuditContext(bridge, native.context.validation);
    const { audit_operation_id, input_resolution, ...baseContext } = native.context;
    if (material.context_sha256 !== shadowHash(baseContext) || material.context_sha256 !== native.selection.output.observations.audit_context_sha256
      || bridge.verification.record.operation_id !== native.selection.output.observations.verification_operation_id)
      fail("STANDARD_RETAINED_AUDIT_CONTEXT_CHANGED");
    stable(); if (shadowHash(allocations.read(nativeJournalId(instance)).record) !== shadowHash(journal)) fail("STANDARD_RETAINED_AUDIT_SOURCE_CHANGED");
    return { native, bridge, verification_proof: verificationProof };
  }
  async function retainedAuditEntry(instance, parameters, admission) {
    authenticate(instance);
    const { proof } = await retainedAuditSource.inspect(instance.initial_parameters.entry_point), selected = admission.observations.selected_cycle;
    if (artifacts.ownerPending() || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256
      || !selected || selected.state !== "VERIFYING" || selected.cycle_id !== proof.context.cycle_id || selected.cycle_path !== proof.context.cycle_path
      || selected.branch !== proof.context.branch || parameters.session.session_id !== proof.context.session_id) fail("STANDARD_RETAINED_AUDIT_FOCUS_CHANGED");
    return retainedAuditContinuation(proof);
  }
  async function retainedClosureEntry(instance, parameters, admission, options) {
    authenticate(instance);
    const { proof } = await retainedClosureSource.inspect(parameters.entry_point, options), selected = admission.observations.selected_cycle;
    if (artifacts.ownerPending() || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256
      || !selected || selected.state !== 'VERIFYING' || selected.cycle_id !== proof.context.cycle_id || selected.cycle_path !== proof.context.cycle_path
      || selected.branch !== proof.context.branch || parameters.session.session_id !== proof.context.session_id) fail('STANDARD_RETAINED_CLOSURE_FOCUS_CHANGED');
    return retainedClosureContinuation(proof);
  }
  const readRetainedClosureDecision = (instance, input, options) => readRetainedClosureSource(instance, input, options, false);
  async function retainedCompletionEntry(instance, parameters, options) {
    authenticate(instance);
    const source = await retainedCompletionSource.inspect(parameters.entry_point, options);
    if (parameters.session.session_id !== source.proof.session_id || parameters.cycle?.cycle_id !== source.proof.cycle_id
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_COMPLETION_FOCUS_CHANGED');
    return retainedCompletionContinuation(source.proof);
  }
  async function readRetainedCompletion(instance, options, withObjectiveAlignment = false) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_completion' || entries.length !== 1) fail('STANDARD_RETAINED_COMPLETION_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const source = await (withObjectiveAlignment ? retainedCompletionSource.readObjectiveAlignment : retainedCompletionSource.readRecorded)(instance.initial_parameters.entry_point, options);
    if (selected.output.facts.retained_completion_requested !== true || selected.output.observations.entry_point !== 'retained_completion'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedCompletionContinuation(source.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_COMPLETION_SOURCE_CHANGED');
    return source;
  }
  async function readRetainedObjectiveAlignment(instance, input, verified, options) {
    if (instance.initial_parameters?.entry_point?.kind === 'retained_promotion') {
      const retained = await readRetainedPromotion(instance, options, 'alignment');
      return retainObjectiveAlignment(retained.alignment, input, verified);
    }
    const retained = await readRetainedCompletion(instance, options, true);
    return retained.alignment === null ? null : retainObjectiveAlignment(retained.alignment, input, verified);
  }
  async function readRetainedSessionCycleHistory(instance, { readValidation } = {}) {
    const source = await readRetainedSessionDelivery(instance);
    const history = await readSessionCycleHistory({ configuration, environment, createAuthority: createStandardProcessAuthority, source, readValidation });
    if (shadowHash((await readRetainedSessionDelivery(instance)).proof) !== shadowHash(source.proof)) fail('STANDARD_SESSION_INTEGRATION_HISTORY_CHANGED');
    return history;
  }
  async function retainedPostMergeEntry(instance, parameters, options) {
    authenticate(instance);
    const retained = await postMergeSourceFor(parameters.entry_point).inspect(parameters.entry_point, options);
    if (retained.proof.session_id !== parameters.session?.session_id || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_RETAINED_POST_MERGE_FOCUS_CHANGED');
    return postMergeContinuationFor(retained.proof);
  }
  function readRetainedPostMerge(instance) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (!['retained_post_merge','retained_post_merge_decision'].includes(instance.initial_parameters?.entry_point?.kind) || entries.length !== 1) fail('STANDARD_RETAINED_POST_MERGE_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const retained = postMergeSourceFor(instance.initial_parameters.entry_point).readRecorded(instance.initial_parameters.entry_point);
    if (selected.output.observations.entry_point !== instance.initial_parameters.entry_point.kind
      || shadowHash(selected.output.observations.continuation) !== shadowHash(postMergeContinuationFor(retained.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_POST_MERGE_SOURCE_CHANGED');
    return retained;
  }
  function postMergeReviewPort(fallback) {
    if (!['retained_post_merge','retained_post_merge_decision'].includes(instances.read(configuration.instance_id).record?.initial_parameters?.entry_point?.kind)) return fallback;
    const names = ['prepareFastForward', 'applyFastForward', 'recoverFastForward', 'prepare', 'apply', 'recover',
      'verifyCompletedSource', 'readMergedSession', 'observeAlignment'];
    return { ...fallback, postMergeFetch: Object.fromEntries(names.map(name => [name, (...args) => {
      const instance = instances.read(configuration.instance_id).record;
      const port = ['retained_post_merge','retained_post_merge_decision'].includes(instance?.initial_parameters?.entry_point?.kind)
        ? readRetainedPostMerge(instance).reviewPort.postMergeFetch : fallback?.postMergeFetch;
      if (typeof port?.[name] !== 'function') fail('STANDARD_PR_POST_MERGE_ALIGNMENT_HOST_REQUIRED');
      return port[name](...args);
    }])) };
  }
  async function retainedMergeCaptureEntry(instance, parameters, options) {
    authenticate(instance);
    const retained = await retainedMergeCaptureSource.inspect(parameters.entry_point, options);
    if (retained.proof.session_id !== parameters.session?.session_id || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_RETAINED_MERGE_CAPTURE_FOCUS_CHANGED');
    return retainedMergeCaptureContinuation(retained.proof);
  }
  function readRetainedMergeCapture(instance) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_external_merge_capture' || entries.length !== 1) fail('STANDARD_RETAINED_MERGE_CAPTURE_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const retained = retainedMergeCaptureSource.readRecorded(instance.initial_parameters.entry_point);
    if (selected.output.facts.retained_external_merge_capture_requested !== true || selected.output.observations.entry_point !== 'retained_external_merge_capture'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedMergeCaptureContinuation(retained.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_MERGE_CAPTURE_SOURCE_CHANGED');
    return { ...retained, entry: selected };
  }
  async function retainedExternalMergeEntry(instance, parameters, options) {
    authenticate(instance);
    const retained = await retainedExternalMergeSource.inspect(parameters.entry_point, options);
    if (retained.proof.session_id !== parameters.session?.session_id || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_RETAINED_EXTERNAL_MERGE_FOCUS_CHANGED');
    return retainedExternalMergeContinuation(retained.proof);
  }
  function readRetainedExternalMerge(instance) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_external_merge' || entries.length !== 1) fail('STANDARD_RETAINED_EXTERNAL_MERGE_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const retained = retainedExternalMergeSource.readRecorded(instance.initial_parameters.entry_point);
    if (selected.output.facts.retained_external_merge_requested !== true || selected.output.observations.entry_point !== 'retained_external_merge'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedExternalMergeContinuation(retained.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_EXTERNAL_MERGE_SOURCE_CHANGED');
    return retained;
  }
  async function retainedSessionPrOpenEntry(instance, parameters, options) {
    authenticate(instance);
    const retained = await retainedSessionPrOpenSource.inspect(parameters.entry_point, options);
    if (retained.proof.session_id !== parameters.session?.session_id || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_RETAINED_SESSION_PR_OPEN_FOCUS_CHANGED');
    return retainedSessionPrOpenContinuation(retained.proof);
  }
  function readRetainedSessionPrOpen(instance) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_session_pr_open' || entries.length !== 1) fail('STANDARD_RETAINED_SESSION_PR_OPEN_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const retained = retainedSessionPrOpenSource.readRecorded(instance.initial_parameters.entry_point);
    if (selected.output.facts.retained_session_pr_open_requested !== true || selected.output.observations.entry_point !== 'retained_session_pr_open'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedSessionPrOpenContinuation(retained.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_SESSION_PR_OPEN_SOURCE_CHANGED');
    return retained;
  }
  async function retainedSessionIntegrationEntry(instance, parameters, options) {
    authenticate(instance);
    const source = await retainedSessionIntegrationSource.inspect(parameters.entry_point, options);
    if (source.proof.session_id !== parameters.session?.session_id || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_RETAINED_SESSION_INTEGRATION_FOCUS_CHANGED');
    return retainedSessionIntegrationContinuation(source.proof);
  }
  async function readRetainedSessionIntegration(instance, options) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_session_integration' || entries.length !== 1) fail('STANDARD_RETAINED_SESSION_INTEGRATION_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const source = await retainedSessionIntegrationSource.readRecorded(instance.initial_parameters.entry_point, options);
    if (selected.output.facts.retained_session_integration_requested !== true || selected.output.observations.entry_point !== 'retained_session_integration'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedSessionIntegrationContinuation(source.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_SESSION_INTEGRATION_SOURCE_CHANGED');
    return source;
  }
  async function retainedSessionDeliveryEntry(instance, parameters) {
    authenticate(instance);
    const source = await retainedSessionDeliverySource.inspect(parameters.entry_point);
    if (source.proof.session_id !== parameters.session?.session_id || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_RETAINED_SESSION_DELIVERY_FOCUS_CHANGED');
    return retainedSessionDeliveryContinuation(source.proof);
  }
  async function readRetainedSessionDelivery(instance) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_session_delivery' || entries.length !== 1) fail('STANDARD_RETAINED_SESSION_DELIVERY_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const source = await retainedSessionDeliverySource.readRecorded(instance.initial_parameters.entry_point);
    if (selected.output.facts.retained_session_delivery_requested !== true || selected.output.observations.entry_point !== 'retained_session_delivery'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedSessionDeliveryContinuation(source.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_SESSION_DELIVERY_SOURCE_CHANGED');
    return source;
  }
  async function retainedSessionCheckpointEntry(instance, parameters) {
    authenticate(instance);
    const source = await retainedSessionCheckpointSource.inspect(parameters.entry_point);
    if (source.proof.session_id !== parameters.session?.session_id || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_RETAINED_SESSION_CHECKPOINT_FOCUS_CHANGED');
    return retainedSessionCheckpointContinuation(source.proof);
  }
  async function readRetainedSessionCheckpoint(instance) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_session_checkpoint' || entries.length !== 1) fail('STANDARD_RETAINED_SESSION_CHECKPOINT_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const source = await retainedSessionCheckpointSource.readRecorded(instance.initial_parameters.entry_point);
    if (selected.output.facts.retained_session_checkpoint_requested !== true || selected.output.observations.entry_point !== 'retained_session_checkpoint'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedSessionCheckpointContinuation(source.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_SESSION_CHECKPOINT_SOURCE_CHANGED');
    return source;
  }
  async function retainedSessionClosureEntry(instance, parameters) {
    authenticate(instance);
    const source = await retainedSessionClosureSource.inspect(parameters.entry_point);
    if (source.proof.session_id !== parameters.session?.session_id || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_RETAINED_SESSION_CLOSURE_FOCUS_CHANGED');
    return retainedSessionClosureContinuation(source.proof);
  }
  async function readRetainedSessionClosure(instance, { fresh = false } = {}) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_session_closure' || entries.length !== 1) fail('STANDARD_RETAINED_SESSION_CLOSURE_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const source = await (fresh ? retainedSessionClosureSource.inspect : retainedSessionClosureSource.readRecorded)(instance.initial_parameters.entry_point);
    if (selected.output.facts.retained_session_closure_requested !== true || selected.output.observations.entry_point !== 'retained_session_closure'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedSessionClosureContinuation(source.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_SESSION_CLOSURE_SOURCE_CHANGED');
    return source;
  }
  async function retainedPromotionEntry(instance, parameters, options) {
    authenticate(instance);
    const source = await retainedPromotionSource.inspect(parameters.entry_point, options);
    if (source.proof.session_id !== parameters.session?.session_id || source.proof.cycle_id !== parameters.cycle?.cycle_id
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_PROMOTION_FOCUS_CHANGED');
    return retainedPromotionContinuation(source.proof);
  }
  async function readRetainedPromotion(instance, options, evaluation = false) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_promotion' || entries.length !== 1) fail('STANDARD_RETAINED_PROMOTION_ENTRY_REQUIRED');
    const selected = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const source = await (evaluation === 'alignment' ? retainedPromotionSource.readAlignment
      : evaluation ? retainedPromotionSource.readEvaluation : retainedPromotionSource.readRecorded)(instance.initial_parameters.entry_point, options);
    if (selected.output.facts.retained_promotion_requested !== true || selected.output.observations.entry_point !== 'retained_promotion'
      || shadowHash(selected.output.observations.continuation) !== shadowHash(retainedPromotionContinuation(source.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_PROMOTION_SOURCE_CHANGED');
    return source;
  }
  const readRecordedClosureDecision = (instance, input, options) => readRetainedClosureSource(instance, input, options, true);
  async function readRetainedClosureSource(instance, input, options, recorded) {
    authenticate(instance);
    const entries = instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
    if (entries.length !== 1 || instance.initial_parameters?.entry_point?.kind !== 'retained_closure'
      || input.decision_operation_id !== instance.initial_parameters.entry_point.decision_operation_id) fail('STANDARD_RETAINED_CLOSURE_ENTRY_REQUIRED');
    const entry = acceptedOperation(instance, entries[0].intent.operation_id, 'workflow_entry_select');
    const observed = await (recorded ? retainedClosureSource.readRecorded : retainedClosureSource.inspect)(instance.initial_parameters.entry_point, options);
    if (entry.output.facts.retained_closure_requested !== true || entry.output.observations.entry_point !== 'retained_closure'
      || shadowHash(entry.output.observations.continuation) !== shadowHash(retainedClosureContinuation(observed.proof))
      || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256) fail('STANDARD_RETAINED_CLOSURE_SOURCE_CHANGED');
    return observed;
  }
  async function retainedAuditForCurrent(instance) {
    authenticate(instance);
    const rows = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "workflow_entry_select");
    if (rows.length !== 1 || instance.initial_parameters?.entry_point?.kind !== "retained_audit") fail("STANDARD_RETAINED_AUDIT_ENTRY_REQUIRED");
    const entry = acceptedOperation(instance, rows[0].intent.operation_id, "workflow_entry_select");
    const retained = await retainedAuditSource.inspect(instance.initial_parameters.entry_point);
    if (entry.output.observations.entry_point !== "retained_audit" || entry.output.facts.retained_audit_requested !== true
      || shadowHash(entry.output.observations.continuation) !== shadowHash(retainedAuditContinuation(retained.proof))
      || artifacts.ownerPending() || instances.read(instance.instance_id).record.instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_RETAINED_AUDIT_SOURCE_CHANGED");
    return retained;
  }
  async function selectCycleAuditReport(instance) {
    authenticate(instance);
    const cursor = inspectAgenticProcess(instance), candidates = instance.events.filter(row => row.kind === "result" && row.result.outcome === "completed"
      && configuration.activity_outputs?.[cursor.occurrences.find(frame => frame.occurrence_id === row.occurrence_id)?.node_id] === CYCLE_AUDIT_CONTRACT);
    const latest = candidates.at(-1);
    let native;
    if (latest) native = readCycleAuditActivityAuthenticated(instance, { report_occurrence_id: latest.occurrence_id });
    else native = (await retainedAuditForCurrent(instance)).native;
    return native;
  }
  async function prepareAuditActivity({ instance, occurrenceId, productSha256, productSnapshot }) {
    const auth = nativeReservation ? { reservation: nativeReservation } : {};
    authenticate(instance, auth); assertWorkProductSnapshot(productSnapshot);
    if (shadowHash(productSnapshot) !== productSha256) fail("STANDARD_AUDIT_PRODUCT_REQUIRED");
    const resolution = resolveProcessOperationInput({ instance, occurrenceId, readOperation: id => { const record = operationStore.read(id).record; signer.verify(record); return record; } });
    if (Object.keys(resolution.input).join(",") !== "audit_operation_id") fail("STANDARD_AUDIT_INPUT_INVALID");
    const selection = acceptedOperation(instance, resolution.input.audit_operation_id, "cycle_audit_select", auth);
    const bridge = await readCycleVerificationExecution(instance, selection.record.preview.input, auth, productSha256);
    const material = observeCycleAuditContext(bridge, selection.output.observations.validation);
    if (material.context_sha256 !== selection.output.observations.audit_context_sha256
      || bridge.verification.record.operation_id !== selection.output.observations.verification_operation_id) fail("STANDARD_AUDIT_SELECTION_STALE");
    const context = { ...material.context, audit_operation_id: selection.record.operation_id, input_resolution: resolution };
    return { context, context_sha256: shadowHash(context) };
  }
  function readCycleAuditActivityAuthenticated(instance, input, history = null) {
    if (checkShadowJson(input) || validateJsonSchema(input, auditInputV1, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_AUDIT_INPUT_INVALID");
    const authenticated = readActivityOutput(instance, input.report_occurrence_id, CYCLE_AUDIT_CONTRACT, {}, history);
    const event = instance.events.find(row => row.kind === "result" && row.occurrence_id === input.report_occurrence_id), journal = allocations.read(nativeJournalId(instance)).record;
    const get = suffix => {
      const references = event.result.evidence_refs.filter(row => row.ref.endsWith(suffix));
      if (references.length !== 1) fail("STANDARD_AUDIT_NATIVE_EVIDENCE_REQUIRED");
      return { value: readAgentRunFile(nativeEvidenceFile(configuration, references[0], journal.allocations.length), { sha256: references[0].sha256, maxBytes: 1048576 }).value, ref: references[0] };
    };
    const retained = get("-activity-context.json"), observed = get("-artifact-output.json"), context = retained.value.context;
    if (retained.value.occurrence_id !== input.report_occurrence_id || observed.value.occurrence_id !== input.report_occurrence_id
      || context.input_resolution?.occurrence_id !== input.report_occurrence_id || context.input_resolution.input.audit_operation_id !== context.audit_operation_id
      || retained.value.context_sha256 !== authenticated.report.context_sha256 || shadowHash(context) !== authenticated.report.context_sha256
      || shadowHash(observed.value.files) !== observed.value.artifact_sha256 || observed.value.artifact_sha256 !== context.product_sha256
      || observed.value.artifact_sha256 !== readProductSha256?.()) fail("STANDARD_AUDIT_NATIVE_SOURCE_CHANGED");
    const selection = acceptedOperation(instance, context.audit_operation_id, "cycle_audit_select", {}, history);
    return { authenticated, context, selection, evidence_refs: [authenticated.reference, retained.ref, observed.ref] };
  }
  async function readCycleAuditActivity(instance, input) {
    if (input && !Object.keys(input).length) return selectCycleAuditReport(instance);
    if (instance.initial_parameters?.entry_point?.kind === "retained_audit"
      && !instance.events.some(row => row.kind === "result" && row.occurrence_id === input.report_occurrence_id)) {
      const retained = await retainedAuditForCurrent(instance);
      if (input.report_occurrence_id !== retained.proof.report_occurrence_id) fail("STANDARD_RETAINED_AUDIT_REPORT_CHANGED");
      return retained.native;
    }
    return readCycleAuditActivityAuthenticated(instance, input);
  }
  async function readCycleCloseValidation(instance, input) {
    const native = await readCycleAuditActivity(instance, input), machine = native.context.validation;
    if (native.authenticated.producer.instance_id !== instance.instance_id) {
      const retained = await retainedAuditForCurrent(instance), bridge = retained.bridge;
      if (shadowHash(native) !== shadowHash(retained.native) || bridge.source.record.operation_id !== machine.validation_operation_id
        || bridge.evaluation.record.operation_id !== machine.evaluation_operation_id || machine.work_complete !== true
        || machine.product_sha256 !== native.context.product_sha256) fail("STANDARD_CYCLE_CLOSE_VALIDATION_REQUIRED");
      return { ...bridge.source, native, machine, evaluation: bridge.evaluation };
    }
    if (instance.initial_parameters?.entry_point?.kind === "retained_verification") {
      const bridge = await retainedVerificationBridge(instance, native.selection.record.preview.input.implementation_operation_id);
      if (bridge.source.record.operation_id !== machine.validation_operation_id || bridge.evaluation.record.operation_id !== machine.evaluation_operation_id
        || machine.work_complete !== true || machine.product_sha256 !== native.context.product_sha256) fail("STANDARD_CYCLE_CLOSE_VALIDATION_REQUIRED");
      return { ...bridge.source, native, machine, evaluation: bridge.evaluation };
    }
    const validation = acceptedOperation(instance, machine.validation_operation_id, "cycle_validation_execute");
    const work = acceptedWorkSnapshot(instance, validation.record.preview.input.work_operation_id);
    const evaluation = acceptedOperation(instance, machine.evaluation_operation_id, "cycle_validation_evaluate");
    if (evaluation.record.preview.input.validation_operation_id !== validation.record.operation_id || machine.work_complete !== true
      || machine.product_sha256 !== native.context.product_sha256) fail("STANDARD_CYCLE_CLOSE_VALIDATION_REQUIRED");
    return { ...validation, work, native, machine, evaluation };
  }
  async function readCycleValidationExecution(instance, input, options = {}) {
    assertStandardOperationInput("cycle_validation_evaluate", input);
    const validation = acceptedOperation(instance, input.validation_operation_id, "cycle_validation_execute");
    const progress = input.progress_operation_id ? acceptedOperation(instance, input.progress_operation_id, "cycle_task_advance") : null;
    const work = progress ? acceptedWorkSnapshot(instance, validation.record.preview.input.work_operation_id) : await readCycleWorkEvaluation(instance, validation.record.preview.input, options);
    const subject = cycleValidationSubject(instance, work), { phaseId, proposal, observedTasks, importedTasks } = subject;
    const context = await (subject.canonicalResume ? observeCycleVerificationContext() : observeCycleReadinessContext());
    if (progress) {
      const details = progress.output.observations;
      if (progress.output.effect_status !== "confirmed" || details.validation_operation_id !== input.validation_operation_id || details.work_operation_id !== validation.record.preview.input.work_operation_id
        || details.implementation_operation_id !== phaseId || details.scope_sha256 !== work.output.observations.scope_sha256
        || details.causal_transition.after_context_sha256 !== context.context_sha256) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
      if (taskCursor(instance, phaseId, subject, context.context_sha256).previous_progress_operation_id !== input.progress_operation_id) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
    }
    const selected = work.output.observations.task_operation_id ? acceptedOperation(instance, work.output.observations.task_operation_id, "cycle_task_select").output.observations : null;
    return { ...validation, work, proposal, task_selection: selected, progress_operation_id: input.progress_operation_id ?? null,
      observed_task_ids: [...observedTasks], ...(subject.canonicalResume ? { imported_task_ids: [...importedTasks], canonical_resume_source: subject.resumeSource } : {}),
      context: context.context, context_sha256: context.context_sha256 };
  }
  const observeDriftContext = () => readStandardDriftContext({ targetRoot: configuration.target_root, productSha256: readProductSha256?.(), productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment });
  const observeCyclePlanContext = () => readStandardCyclePlanContext({ targetRoot: configuration.target_root, productSha256: readProductSha256?.(), productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment });
  const observeCycleVerificationContext = async (productSha256 = readProductSha256?.()) => readinessContext(await readStandardCyclePlanContext({ targetRoot: configuration.target_root, productSha256, productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment,
    readinessTransition: true, verificationTransition: true }));
  const observeCycleAuditContext = (bridge, validation) => buildStandardCycleAuditContext({ targetRoot: configuration.target_root, environment,
    deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], bridge, validation });
  const observeCycleCloseContext = () => readStandardCycleCloseContext({ targetRoot: configuration.target_root, productSha256: readProductSha256?.(), productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment });
  const rollbackProductScope = () => ({
    productPaths: configuration.product_files.map(name => path.relative(configuration.target_root, path.resolve(configuration.product_root, name)).replaceAll("\\", "/")),
    deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home],
  });
  const prework = createStandardCyclePreworkAuthority({
    active: (instance, { nativePreparation = false } = {}) => {
      if (nativePreparation && !nativeReservation) fail("STANDARD_PREWORK_NATIVE_RESERVATION_REQUIRED");
      return authenticate(instance, nativeReservation ? { reservation: nativeReservation } : {});
    },
    readCurrent: id => instances.read(id).record,
    readAccepted: (instance, id, binding, options = {}) => acceptedOperation(instance, id, binding,
      options.auth ?? (nativeReservation ? { reservation: nativeReservation } : {}), options.history ?? null),
    observeContext: observePreworkContext, observeScope: operations.observeScope, artifacts, readProductSha256,
    readActivityInput: (instance, occurrenceId) => resolveProcessOperationInput({ instance, occurrenceId, readOperation: id => {
      const record = operationStore.read(id).record; signer.verify(record); return record; } }).input,
    readNativeActivity: readPreworkNativeActivity,
  });
  return Object.freeze({ profile: "standard-mixed.v1", rollbackProductScope, observeProduct: () => { const value = readProductSha256?.(); if (!/^[a-f0-9]{64}$/.test(value ?? "")) fail("STANDARD_PROMOTION_PRODUCT_AUTHORITY_REQUIRED"); return value; }, read, readExecutionAuthority, snapshot, authenticate, authenticateOperationHost, inspectDiagnostic, observeNativeDiagnostic, withNativeOwner, prepareActivityOutput, preflightModeWork, evaluateModeWork, observeModeWork, prepareModeWorkContinuation, assertModeWorkContinuationFresh, readPrTriageActivity, evaluateDriftReport, readDriftEvaluation, admitReadyDriftDiagnosis,
    verifyNativeHumanSource, admitNativeActivity, readRetainedSessionCycleHistory, retainedPostMergeEntry, readRetainedPostMerge, postMergeReviewPort, retainedMergeCaptureEntry, readRetainedMergeCapture, retainedExternalMergeEntry, readRetainedExternalMerge, retainedSessionPrOpenEntry, readRetainedSessionPrOpen, retainedSessionIntegrationEntry, readRetainedSessionIntegration, retainedSessionDeliveryEntry, readRetainedSessionDelivery, retainedSessionCheckpointEntry, readRetainedSessionCheckpoint, retainedSessionClosureEntry, readRetainedSessionClosure, retainedAuditEntry, retainedClosureEntry, retainedCompletionEntry, readRetainedCompletion, retainedPromotionEntry, readRetainedPromotion, readRetainedObjectiveAlignment, readRecordedDriftEvaluation, readRetainedClosureDecision, readRecordedClosureDecision, readRecordedCycleAudit, readRecordedCycleValidation, inspectRetainedCycleAudit, retainedVerificationEntry, admitRetainedVerification, retainedValidationEntry, admitRetainedValidation, selectWorkPhase, observeRetainedTaskWork, retainedContributors,
    selectOwnedCyclePlanning, selectCyclePrework, evaluateCyclePrework, evaluateCyclePlan, readCyclePlanEvaluation, observeCyclePlanContext, evaluateCycleReadiness, readCycleReadinessEvaluation, observeCycleReadinessContext, evaluateCycleWork, readCycleWorkEvaluation, inspectRetainedCycleTaskWork, readCycleValidationExecution, readCycleVerificationExecution, inspectRetainedCycleVerification, observeCycleAuditContext, observeCycleCloseContext, readCycleAuditActivity, readCycleCloseValidation, evaluateCycleTaskSelection, selectCycleExecutionSource, evaluateCycleTaskWork: (instance, input) => evaluateCycleWork(instance, input, CYCLE_TASK_WORK_CONTRACT), observeCanonicalResumeProduct, observeCycleVerificationContext, observeDriftContext, modelSource: source });
}
