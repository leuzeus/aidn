import { MODE_WORK_CONTRACT, evaluateStandardModeWork } from "../../core/workflow/standard-mode-work.mjs";
import { observeModeWorkReport, modeWorkContinuationChoices, assertModeWorkObservationOutput } from "../../core/workflow/standard-mode-work-continuation.mjs";
import { readStandardModeWorkContext } from "./standard-mode-work-context.mjs";
import { readStandardCycleCloseContext } from "./standard-cycle-close-context.mjs";
import { PR_TRIAGE_CONTRACT } from "../../core/workflow/standard-pr-triage.mjs";
import { buildStandardPrTriageContext } from "./standard-pr-triage-context.mjs";
import { CYCLE_AUDIT_CONTRACT } from "../../core/workflow/standard-cycle-audit.mjs";
import { buildStandardCycleAuditContext } from "./standard-cycle-audit-context.mjs";
import { readWorkflowProjectAuthority, readWorkflowProjectExecutionAuthority } from "./workflow-instance-composition.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings, assertStandardWorkflowImplementation } from "./standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
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
import { evaluateStandardCycleReadiness } from "../../core/workflow/standard-cycle-readiness.mjs";
import { runStartSessionAdmitUseCase } from "./start-session-admit-use-case.mjs";
import { readStandardCyclePlanContext, evaluateStandardCyclePlan } from "./standard-cycle-plan-context.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { assertStandardWorkflowModelSource, assertStandardWorkflowActivityOutputs } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { assertStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { agenticProcessPrefixSha256, inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { processModels, processFrameNode } from "../../core/workflow/process-call-model.mjs";
import { assertAgenticProcessModel, agenticPolicyPins } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, freezeShadow, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import previewSchema from "../../core/contracts/workflow-definition/standard-operation-preview.v1.schema.json" with { type: "json" };
import path from "node:path";
import { resolveProcessOperationInput } from "../../core/workflow/process-input-resolution.mjs";
import { CYCLE_WORK_CONTRACT, CYCLE_TASK_WORK_CONTRACT, assertWorkProductSnapshot, observeStandardCycleWork, observeStandardCycleTaskWork } from "../../core/workflow/standard-cycle-work.mjs";
import { deriveStandardCycleTaskCursor, renderStandardTaskProgress } from "../../core/workflow/standard-cycle-task-progress.mjs";
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
export function createStandardProcessAuthority({ configuration: suppliedConfiguration, model: supplied, modelSource = null, readSigningKey, humanSource = null, readProductSha256, environment = process.env, nativeReservation = null }) {
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
    return { ...(source ? { model_source: source } : {}), context: operations.observeScope(),
      documents: ["CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "baseline/current.md", "snapshots/context-snapshot.md"]
        .map(path => ({ path, sha256: artifacts.read(path, { required: true }).sha256 })),
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
      if (!diagnostic && latest && latest.phase !== "closed") {
        if (!reservation || latest.phase !== "reserved" || latest.owner_id !== reservation.owner_id || latest.generation !== reservation.generation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE");
      } else if (reservation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_CHANGED");
      const entry = reservation || diagnostic && latest?.phase === "reserved" ? journal.allocations.at(-2) : latest;
      if (entry) {
        if (!diagnostic && entry.phase !== "closed") fail("STANDARD_PROCESS_NATIVE_RECONCILIATION_REQUIRED");
        native = readNativeAllocationCheckpoint(entry, configuration, { scopeId: authority.scope_id, modelSha256: authority.model_sha256 }).state;
        if (!diagnostic && !native.parent_closed) fail("STANDARD_PROCESS_NATIVE_RECONCILIATION_REQUIRED");
        covered = native.instance.events.length;
        if (instance.events.length < covered || shadowHash(instance.events.slice(0, covered)) !== shadowHash(native.instance.events)) fail("STANDARD_PROCESS_NATIVE_HISTORY_CHANGED");
      }
    } else if (reservation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_CHANGED");
    const seen = new Map(), frames = new Map(cursor.occurrences.map(row => [row.occurrence_id, row]));
    for (const [index, event] of instance.events.entries()) {
      if (["assign", "result", "refusal"].includes(event.kind)) {
        if (!native || index >= covered || shadowHash(event) !== shadowHash(native.instance.events[index])) fail("STANDARD_PROCESS_NATIVE_HISTORY_NOT_AUTHENTICATED");
      } else if (["operation_intent", "operation_result"].includes(event.kind)) {
        const id = event.intent?.operation_id ?? event.receipt.operation_id;
        if (!seen.has(id)) {
          const record = operationStore.read(id).record; signer.verify(record); signer.verify(record.preview);
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
    return { native, journal };
  }
  function inspectDiagnostic(instance) {
    const { native, journal } = authenticateHistory(instance, {}, true);
    // Failed observations stay failed even with a closed OS tree. Reading does
    // not release an owner, reconcile resources or establish effect admission.
    return structuredClone({ journal, checkpoint: native, written: false, native_started: false });
  }
  async function withNativeOwner(intent, action) {
    const result = await artifacts.withLocalEffectOwner(shadowHash({ authority: read(), ...intent }), async () => {
      const value = await action();
      return { value, effect_status: value.journal_phase === "closed" ? "confirmed" : value.native_started === false ? "no_effect" : "unknown" };
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
    if (review.contract_version === "standard-drift-recovery-plan.v1") fail("STANDARD_DRIFT_RECOVERY_EXECUTION_REQUIRED");
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
    if (Date.now() < review.prepared_at_ms || Date.now() - review.prepared_at_ms > 300000) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_EXPIRED");
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
    if (Date.now() < review.prepared_at_ms || Date.now() - review.prepared_at_ms > 300000) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_EXPIRED");
  }
  async function admitNativeActivity(instance, occurrenceId) {
    if (inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId)?.node_id === "closure_drift_report"
      && model.nodes.some(row => row.id === "closure_drift_loop" && row.kind === "loop"))
      await assertDriftDiagnosisRequest(instance, occurrenceId);
  }
  async function prepareActivityOutput({ contractRef, productSha256, instance, occurrenceId, productSnapshot }) {
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
  function readActivityOutput(instance, occurrenceId, contractRef = DRIFT_REPORT_CONTRACT, authenticationOptions = {}) {
    const state = authenticate(instance, authenticationOptions), event = instance.events.find(row => row.kind === "result" && row.occurrence_id === occurrenceId);
    if (!state || !event || event.result.outcome !== "completed") fail("STANDARD_DRIFT_AUTHENTICATED_RESULT_REQUIRED");
    const frame = inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId), node = frame && processFrameNode(model, frame);
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
      return intent?.intent.binding_ref === "mode_work_continue_decision";
    });
    let continuation;
    if (decisionEvent) {
      const selected = acceptedOperation(instance, decisionEvent.receipt.operation_id, "mode_work_continue_decision", auth);
      const capture = human.captured(selected.record);
      if (capture.source.choice !== "continue_analysis" || selected.output.facts.mode_work_continue_requested !== true)
        fail("STANDARD_MODE_WORK_CONTINUATION_REQUIRED");
      continuation = { operation_id: selected.record.operation_id, source_sha256: shadowHash(capture.source), question_sha256: capture.source.question_sha256,
        review_sha256: selected.output.observations.review_sha256, choice: capture.source.choice,
        information_only: true, product_effects_authorized: false, retention_authorized: false, native_authority_renewed: false,
        decision: structuredClone(capture.source), prior_report: structuredClone(selected.record.preview.prepared.review.report),
        prior_producer: structuredClone(selected.record.preview.prepared.review.producer), prior_reference: structuredClone(selected.record.preview.prepared.review.reference) };
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
  function prepareModeWorkContinuation(instance, input) {
    assertStandardOperationInput("mode_work_continue_decision", input);
    const accepted = acceptedOperation(instance, input.review_operation_id, "mode_work_observe");
    assertModeWorkObservationOutput(accepted.output);
    const fresh = observeModeWork(instance, accepted.record.preview.input);
    if (shadowHash(fresh) !== shadowHash(accepted.output)) fail("STANDARD_MODE_WORK_REVIEW_STALE");
    if (!["waiting", "retain_requested"].includes(fresh.observations.review.report.disposition)) fail("STANDARD_MODE_WORK_CONTINUATION_NOT_REQUIRED");
    return { review: fresh.observations.review, choices: [...modeWorkContinuationChoices] };
  }
  function assertModeWorkContinuationFresh(instance, input, prepared) {
    if (shadowHash(prepareModeWorkContinuation(instance, input)) !== shadowHash(prepared)) fail("STANDARD_MODE_WORK_REVIEW_STALE");
  }
  async function evaluateDriftReport(instance, input) {
    assertStandardOperationInput("drift_report_evaluate", input);
    return evaluateStandardDriftReport(readActivityOutput(instance, input.report_occurrence_id),
      await prepareActivityOutput({ contractRef: DRIFT_REPORT_CONTRACT, productSha256: readProductSha256?.() }));
  }
  async function evaluateCyclePlan(instance, input) {
    assertStandardOperationInput("cycle_plan_evaluate", input);
    return evaluateStandardCyclePlan(readActivityOutput(instance, input.report_occurrence_id, CYCLE_PLAN_CONTRACT),
      await prepareActivityOutput({ contractRef: CYCLE_PLAN_CONTRACT, productSha256: readProductSha256?.() }));
  }
  async function readCyclePlanEvaluation(instance, input) {
    assertStandardOperationInput("cycle_plan_record", input); authenticate(instance);
    const retained = operationStore.read(input.evaluation_operation_id).record; signer.verify(retained);
    const result = retained.results.at(-1);
    if (retained.intent.binding_ref !== "cycle_plan_evaluate" || retained.intent.scope_id !== instance.scope_id || retained.intent.instance_id !== instance.instance_id
      || retained.phase !== "receipted" || result?.receipt.outcome !== "completed"
      || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt))) fail("STANDARD_CYCLE_PLAN_EVALUATION_REQUIRED");
    const context = await prepareActivityOutput({ contractRef: CYCLE_PLAN_CONTRACT, productSha256: readProductSha256?.() });
    const output = evaluateStandardCyclePlan(readActivityOutput(instance, retained.preview.input.report_occurrence_id, CYCLE_PLAN_CONTRACT), context);
    if (shadowHash(output) !== shadowHash(result.output)) fail("STANDARD_CYCLE_PLAN_EVALUATION_STALE");
    return { output, evaluation_sha256: shadowHash(result.output), context: context.context, context_sha256: context.context_sha256 };
  }
  async function readDriftEvaluation(instance, input) {
    assertStandardOperationInput("drift_check_finalize", input); authenticate(instance);
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
  function acceptedOperation(instance, id, binding, authenticationOptions = {}) {
    authenticate(instance, authenticationOptions);
    const record = operationStore.read(id).record; signer.verify(record);
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
    const context = { ...observed.context, metadata_pins: observed.context.documents.map(row => ({ ref: row.ref, sha256: artifacts.metadataHash(row.ref.slice(6)) })) };
    return { ...observed, context, context_sha256: shadowHash(context) };
  }
  async function evaluateCycleReadiness(instance, input) {
    assertStandardOperationInput("cycle_readiness_evaluate", input);
    const recorded = acceptedOperation(instance, input.record_operation_id, "cycle_plan_record");
    if (recorded.output.effect_status !== "confirmed" || recorded.output.facts.cycle_plan_recorded !== true) fail("STANDARD_CYCLE_READINESS_RECORD_REQUIRED");
    const evaluated = acceptedOperation(instance, recorded.record.preview.input.evaluation_operation_id, "cycle_plan_evaluate");
    const native = readActivityOutput(instance, evaluated.record.preview.input.report_occurrence_id, CYCLE_PLAN_CONTRACT);
    if (shadowHash(native.report) !== shadowHash(evaluated.output.observations.proposal)) fail("STANDARD_CYCLE_READINESS_RECORD_REQUIRED");
    const observed = await prepareActivityOutput({ contractRef: CYCLE_PLAN_CONTRACT, productSha256: readProductSha256?.() });
    if (recorded.output.observations.causal_transition.after_context_sha256 !== observed.context_sha256
      || recorded.record.preview.prepared.plan.changes.some(row => !observed.context.documents.some(doc => doc.ref === "audit:" + row.path && doc.sha256 === row.after_sha256)))
      fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
    const context = readinessContext(observed), proposal = native.report;
    const admitted = await createStandardWorkflowOperations({ targetRoot: configuration.target_root }).auditCycle({ session_id: proposal.session_id, cycle_id: proposal.cycle_id });
    const start = await runStartSessionAdmitUseCase({ targetRoot: configuration.target_root, mode: "COMMITTING" });
    return evaluateStandardCycleReadiness({ proposal, recordSha256: shadowHash(recorded.output), recordOperationId: input.record_operation_id,
      context: context.context, contextSha256: context.context_sha256, branchAdmitted: admitted.outcome === "completed" && start.ok === true && start.action === "resume_current_cycle" });
  }
  async function readCycleReadinessEvaluation(instance, input) {
    assertStandardOperationInput("cycle_implementation_enter", input);
    const verified = acceptedOperation(instance, input.evaluation_operation_id, "cycle_readiness_evaluate");
    const output = await evaluateCycleReadiness(instance, verified.record.preview.input);
    if (output.facts.cycle_readiness_satisfied !== true || shadowHash(output) !== shadowHash(verified.output)) fail("STANDARD_CYCLE_READINESS_EVALUATION_STALE");
    const observed = await observeCycleReadinessContext();
    if (observed.context_sha256 !== output.observations.context_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
    return { output, evaluation_sha256: shadowHash(output), context: observed.context, context_sha256: observed.context_sha256 };
  }
  const observeCycleReadinessContext = async (productSha256 = readProductSha256?.()) => readinessContext(await readStandardCyclePlanContext({ targetRoot: configuration.target_root, productSha256, productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment, readinessTransition: true }));
  function taskPhase(instance, id, auth = {}) {
    const phase = acceptedOperation(instance, id, "cycle_implementation_enter", auth);
    if (phase.output.effect_status !== "confirmed" || phase.output.facts.cycle_implementation_started !== true) fail("STANDARD_CYCLE_WORK_PHASE_REQUIRED");
    const ready = acceptedOperation(instance, phase.record.preview.input.evaluation_operation_id, "cycle_readiness_evaluate", auth);
    const recorded = acceptedOperation(instance, ready.record.preview.input.record_operation_id, "cycle_plan_record", auth);
    const evaluated = acceptedOperation(instance, recorded.record.preview.input.evaluation_operation_id, "cycle_plan_evaluate", auth);
    return { phase, proposal: readActivityOutput(instance, evaluated.record.preview.input.report_occurrence_id, CYCLE_PLAN_CONTRACT, auth).report };
  }
  function taskAdvances(instance, phaseId, auth = {}) {
    const result = [];
    for (const event of instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_task_advance")) {
      if (!instance.events.some(row => row.kind === "operation_result" && row.receipt.operation_id === event.intent.operation_id && row.receipt.outcome === "completed")) continue;
      const advanced = acceptedOperation(instance, event.intent.operation_id, "cycle_task_advance", auth), details = advanced.output.observations;
      if (details.implementation_operation_id !== phaseId) continue;
      const selected = acceptedOperation(instance, details.task_operation_id, "cycle_task_select", auth);
      const evaluated = acceptedOperation(instance, details.evaluation_operation_id, "cycle_validation_evaluate", auth);
      const validation = acceptedOperation(instance, evaluated.record.preview.input.validation_operation_id, "cycle_validation_execute", auth);
      const work = acceptedOperation(instance, validation.record.preview.input.work_operation_id, "cycle_task_work_evaluate", auth);
      if (selected.output.observations.context_sha256 !== details.selection_context_sha256 || selected.output.observations.task?.id !== details.task_id || selected.output.observations.previous_progress_operation_id !== details.previous_progress_operation_id
        || selected.output.observations.implementation_operation_id !== phaseId || work.output.observations.task_operation_id !== details.task_operation_id
        || details.validation_operation_id !== validation.record.operation_id || details.work_operation_id !== work.record.operation_id
        || advanced.record.preview.input.evaluation_operation_id !== details.evaluation_operation_id
        || details.causal_transition.before_context_sha256 !== evaluated.output.observations.context_sha256) fail("STANDARD_TASK_PROGRESS_CHAIN_CHANGED");
      result.push({ operation_id: event.intent.operation_id, output: advanced.output });
    }
    return result;
  }
  function taskCursor(instance, phaseId, phase, proposal, contextSha256, auth = {}) {
    return deriveStandardCycleTaskCursor({ proposal, implementationOperationId: phaseId, phaseContextSha256: phase.output.observations.causal_transition.after_context_sha256,
      advances: taskAdvances(instance, phaseId, auth), contextSha256 });
  }
  async function evaluateCycleTaskSelection(instance, input, auth = {}, productSha256 = readProductSha256?.()) {
    assertStandardOperationInput("cycle_task_select", input);
    const { phase, proposal } = taskPhase(instance, input.implementation_operation_id, auth), observed = await observeCycleReadinessContext(productSha256);
    const cursor = taskCursor(instance, input.implementation_operation_id, phase, proposal, observed.context_sha256, auth);
    const brief = observed.context.documents.find(row => row.ref === "audit:" + observed.context.cycle_path + "/brief.md");
    const original = renderStandardCyclePlan(proposal, observed.context.cycle_path, { "brief.md": brief.content })[observed.context.cycle_path + "/plan.md"];
    if (artifacts.read(observed.context.cycle_path + "/plan.md", { required: true }).content !== renderStandardTaskProgress({ originalPlan: original, proposal, completedTaskIds: cursor.completed_task_ids })) fail("STANDARD_TASK_PROGRESS_PLAN_CHANGED");
    return { contract_version: "standard-cycle-task-output.v1", operation_ref: "cycle_task_select", outcome: "completed", effect_status: "no_effect",
      facts: { cycle_task_selected: !cursor.complete, cycle_tasks_finished: cursor.complete }, observations: { ...cursor, task_count: proposal.tasks.length, cycle_path: observed.context.cycle_path },
      evidence_refs: observed.context.documents.filter(row => ["audit:CURRENT-STATE.md", "audit:" + observed.context.cycle_path + "/plan.md", "audit:" + observed.context.cycle_path + "/status.md"].includes(row.ref)).map(({ ref, sha256 }) => ({ ref, sha256 })) };
  }
  async function prepareTaskWorkActivity({ instance, occurrenceId, productSha256, productSnapshot }) {
    const auth = nativeReservation ? { reservation: nativeReservation } : {};
    authenticate(instance, auth); assertWorkProductSnapshot(productSnapshot);
    const resolution = resolveProcessOperationInput({ instance, occurrenceId, readOperation: id => { const row = operationStore.read(id).record; signer.verify(row); return row; } });
    if (Object.keys(resolution.input).join(",") !== "task_operation_id" || shadowHash(productSnapshot) !== productSha256) fail("STANDARD_CYCLE_WORK_INPUT_INVALID");
    const selected = acceptedOperation(instance, resolution.input.task_operation_id, "cycle_task_select", auth);
    const fresh = await evaluateCycleTaskSelection(instance, selected.record.preview.input, auth, productSha256), task = fresh.observations.task;
    if (shadowHash(fresh) !== shadowHash(selected.output) || !task || task.intent !== "implementation" || task.paths.some(row => row.operations.some(op => !["update", "add", "delete"].includes(op)))) fail("STANDARD_CYCLE_TASK_WORK_SOURCE_STALE");
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
    const id = resolution.input.implementation_operation_id, phase = acceptedOperation(instance, id, "cycle_implementation_enter", auth);
    if (phase.output.effect_status !== "confirmed" || phase.output.facts.cycle_implementation_started !== true) fail("STANDARD_CYCLE_WORK_PHASE_REQUIRED");
    const ready = acceptedOperation(instance, phase.record.preview.input.evaluation_operation_id, "cycle_readiness_evaluate", auth);
    const recorded = acceptedOperation(instance, ready.record.preview.input.record_operation_id, "cycle_plan_record", auth);
    const evaluated = acceptedOperation(instance, recorded.record.preview.input.evaluation_operation_id, "cycle_plan_evaluate", auth);
    const proposal = readActivityOutput(instance, evaluated.record.preview.input.report_occurrence_id, CYCLE_PLAN_CONTRACT, auth).report;
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
    assertStandardOperationInput(contractRef === CYCLE_TASK_WORK_CONTRACT ? "cycle_task_work_evaluate" : "cycle_work_evaluate", input);
    const authenticated = readActivityOutput(instance, input.report_occurrence_id, contractRef);
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
  function acceptedWorkSnapshot(instance, workId, { auth = {}, productSha256 } = {}) {
    const binding = operationStore.read(workId).record?.intent.binding_ref;
    if (!["cycle_work_evaluate", "cycle_task_work_evaluate"].includes(binding)) fail("STANDARD_VALIDATION_WORK_REQUIRED");
    const evaluated = acceptedOperation(instance, workId, binding, auth), output = evaluated.output;
    if (output.facts.cycle_work_observed !== true) fail("STANDARD_VALIDATION_WORK_REQUIRED");
    const contractRef = binding === "cycle_task_work_evaluate" ? CYCLE_TASK_WORK_CONTRACT : CYCLE_WORK_CONTRACT;
    const native = readActivityOutput(instance, evaluated.record.preview.input.report_occurrence_id, contractRef, auth);
    if (shadowHash(native.producer) !== shadowHash(output.observations.producer)) fail("STANDARD_VALIDATION_WORK_STALE");
    const ref = output.evidence_refs.find(row => row.ref.endsWith("-artifact-output.json")), journal = allocations.read(nativeJournalId(instance)).record;
    const observed = readAgentRunFile(nativeEvidenceFile(configuration, ref, journal.allocations.length), { sha256: ref.sha256, maxBytes: 1048576 }).value;
    if (observed.occurrence_id !== evaluated.record.preview.input.report_occurrence_id || shadowHash(observed.files) !== observed.artifact_sha256 || observed.artifact_sha256 !== (productSha256 ?? readProductSha256?.())) fail("STANDARD_VALIDATION_WORK_STALE");
    let validation_test_refs;
    if (binding === "cycle_task_work_evaluate") {
      const selected = acceptedOperation(instance, output.observations.task_operation_id, "cycle_task_select", auth);
      const { proposal } = taskPhase(instance, output.observations.implementation_operation_id, auth);
      validation_test_refs = selected.output.observations.ordinal === proposal.tasks.length ? proposal.tests.map(row => row.id) : output.observations.task.test_refs;
    }
    return { evaluated, binding, output, evaluation_sha256: shadowHash(output), files: observed.files, product_root: configuration.product_root, ...(validation_test_refs ? { validation_test_refs } : {}) };
  }
  async function readCycleWorkEvaluation(instance, input) {
    assertStandardOperationInput("cycle_validation_execute", input);
    const work = acceptedWorkSnapshot(instance, input.work_operation_id);
    const output = await evaluateCycleWork(instance, work.evaluated.record.preview.input, work.binding === "cycle_task_work_evaluate" ? CYCLE_TASK_WORK_CONTRACT : CYCLE_WORK_CONTRACT);
    if (shadowHash(output) !== work.evaluation_sha256) fail("STANDARD_VALIDATION_WORK_STALE");
    return work;
  }
  function cycleValidationSubject(instance, work, auth = {}) {
    const phaseId = work.output.observations.implementation_operation_id, phase = acceptedOperation(instance, phaseId, "cycle_implementation_enter", auth);
    const ready = acceptedOperation(instance, phase.record.preview.input.evaluation_operation_id, "cycle_readiness_evaluate", auth);
    const recorded = acceptedOperation(instance, ready.record.preview.input.record_operation_id, "cycle_plan_record", auth);
    const evaluated = acceptedOperation(instance, recorded.record.preview.input.evaluation_operation_id, "cycle_plan_evaluate", auth);
    const proposal = readActivityOutput(instance, evaluated.record.preview.input.report_occurrence_id, CYCLE_PLAN_CONTRACT, auth).report;
    const observedTasks = new Set();
    for (const event of instance.events.filter(row => row.kind === "operation_intent" && ["cycle_work_evaluate", "cycle_task_work_evaluate"].includes(row.intent.binding_ref))) {
      const accepted = instance.events.some(row => row.kind === "operation_result" && row.receipt.operation_id === event.intent.operation_id && row.receipt.outcome === "completed");
      if (!accepted) continue;
      const prior = acceptedOperation(instance, event.intent.operation_id, event.intent.binding_ref, auth), facts = prior.output;
      if (facts.facts.cycle_work_observed !== true || facts.observations.implementation_operation_id !== phaseId || facts.observations.scope_sha256 !== work.output.observations.scope_sha256) continue;
      const task = proposal.tasks.find(row => row.id === facts.observations.task.id);
      if (!task || shadowHash(task) !== shadowHash(facts.observations.task)) fail("STANDARD_VERIFICATION_TASK_SOURCE_CHANGED");
      const report = readActivityOutput(instance, prior.record.preview.input.report_occurrence_id, event.intent.binding_ref === "cycle_task_work_evaluate" ? CYCLE_TASK_WORK_CONTRACT : CYCLE_WORK_CONTRACT, auth);
      if (report.report.task !== task.task || shadowHash(report.producer) !== shadowHash(facts.observations.producer)) fail("STANDARD_VERIFICATION_TASK_SOURCE_CHANGED");
      observedTasks.add(task.id);
    }
    return { phaseId, phase, proposal, observedTasks };
  }
  async function readCycleVerificationExecution(instance, input, auth = {}, productSha256) {
    if (!input || Object.keys(input).join(",") !== "implementation_operation_id" || !/^op_[a-f0-9]{40}$/.test(input.implementation_operation_id ?? "")) fail("STANDARD_AUDIT_INPUT_INVALID");
    authenticate(instance, auth);
    const admission = await preWriteAdmit({ targetRoot: configuration.target_root, skill: "cycle-close" });
    if (admission.ok !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status)) fail("STANDARD_AUDIT_ADMISSION_BLOCKED");
    const currentProduct = () => productSha256 ?? readProductSha256?.();
    const context = await observeCycleVerificationContext(currentProduct());
    if (context.context.cycle_state !== "VERIFYING") fail("STANDARD_AUDIT_VERIFICATION_REQUIRED");
    const candidates = [];
    for (const event of instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_verification_enter")) {
      if (!instance.events.some(row => row.kind === "operation_result" && row.receipt.operation_id === event.intent.operation_id && row.receipt.outcome === "completed")) continue;
      const verification = acceptedOperation(instance, event.intent.operation_id, "cycle_verification_enter", auth), details = verification.output.observations;
      if (verification.output.facts.cycle_verification_started !== true || verification.output.effect_status !== "confirmed"
        || details.causal_transition?.after_context_sha256 !== context.context_sha256) continue;
      const evaluation = acceptedOperation(instance, verification.record.preview.input.evaluation_operation_id, "cycle_validation_evaluate", auth);
      const validation = acceptedOperation(instance, evaluation.record.preview.input.validation_operation_id, "cycle_validation_execute", auth);
      const work = acceptedWorkSnapshot(instance, validation.record.preview.input.work_operation_id, { auth, productSha256: context.context.product_sha256 });
      if (work.output.observations.implementation_operation_id !== input.implementation_operation_id) continue;
      const subject = cycleValidationSubject(instance, work, auth);
      if (details.evaluation_operation_id !== evaluation.record.operation_id || details.scope_sha256 !== work.output.observations.scope_sha256
        || details.causal_transition.before_context_sha256 !== evaluation.output.observations.context_sha256
        || details.causal_transition.evaluation_sha256 !== shadowHash(evaluation.output)
        || verification.record.preview.prepared.plan.evaluation_sha256 !== shadowHash(evaluation.output)
        || verification.record.preview.prepared.plan.context_sha256 !== details.causal_transition.before_context_sha256) fail("STANDARD_AUDIT_VERIFICATION_BRIDGE_CHANGED");
      if (evaluation.record.preview.input.progress_operation_id) {
        const progress = acceptedOperation(instance, evaluation.record.preview.input.progress_operation_id, "cycle_task_advance", auth);
        if (progress.output.observations.validation_operation_id !== validation.record.operation_id
          || progress.output.observations.work_operation_id !== work.evaluated.record.operation_id
          || progress.output.observations.causal_transition.after_context_sha256 !== details.causal_transition.before_context_sha256) fail("STANDARD_AUDIT_VERIFICATION_BRIDGE_CHANGED");
        const cursor = taskCursor(instance, subject.phaseId, subject.phase, subject.proposal, details.causal_transition.before_context_sha256, auth);
        if (!cursor.complete || cursor.previous_progress_operation_id !== progress.record.operation_id) fail("STANDARD_AUDIT_TASKS_INCOMPLETE");
      }
      candidates.push({ verification, evaluation, source: { ...validation, work, proposal: subject.proposal, observed_task_ids: [...subject.observedTasks] },
        context: context.context, context_sha256: context.context_sha256 });
    }
    if (candidates.length !== 1) fail("STANDARD_AUDIT_VERIFICATION_AMBIGUOUS");
    if ((await observeCycleVerificationContext(currentProduct())).context_sha256 !== context.context_sha256) fail("STANDARD_AUDIT_SOURCE_CHANGED");
    return candidates[0];
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
  function readCycleAuditActivity(instance, input) {
    assertStandardOperationInput("cycle_audit_evaluate", input);
    const authenticated = readActivityOutput(instance, input.report_occurrence_id, CYCLE_AUDIT_CONTRACT);
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
    const selection = acceptedOperation(instance, context.audit_operation_id, "cycle_audit_select");
    return { authenticated, context, selection, evidence_refs: [authenticated.reference, retained.ref, observed.ref] };
  }
  function readCycleCloseValidation(instance, input) {
    const native = readCycleAuditActivity(instance, input), machine = native.context.validation;
    const validation = acceptedOperation(instance, machine.validation_operation_id, "cycle_validation_execute");
    const work = acceptedWorkSnapshot(instance, validation.record.preview.input.work_operation_id);
    const evaluation = acceptedOperation(instance, machine.evaluation_operation_id, "cycle_validation_evaluate");
    if (evaluation.record.preview.input.validation_operation_id !== validation.record.operation_id || machine.work_complete !== true
      || machine.product_sha256 !== native.context.product_sha256) fail("STANDARD_CYCLE_CLOSE_VALIDATION_REQUIRED");
    return { ...validation, work, native, machine, evaluation };
  }
  async function readCycleValidationExecution(instance, input) {
    assertStandardOperationInput("cycle_validation_evaluate", input);
    const validation = acceptedOperation(instance, input.validation_operation_id, "cycle_validation_execute");
    const progress = input.progress_operation_id ? acceptedOperation(instance, input.progress_operation_id, "cycle_task_advance") : null;
    const work = progress ? acceptedWorkSnapshot(instance, validation.record.preview.input.work_operation_id) : await readCycleWorkEvaluation(instance, validation.record.preview.input);
    const { phaseId, phase, proposal, observedTasks } = cycleValidationSubject(instance, work);
    const context = await observeCycleReadinessContext();
    if (progress) {
      const details = progress.output.observations;
      if (progress.output.effect_status !== "confirmed" || details.validation_operation_id !== input.validation_operation_id || details.work_operation_id !== validation.record.preview.input.work_operation_id
        || details.implementation_operation_id !== phaseId || details.scope_sha256 !== work.output.observations.scope_sha256
        || details.causal_transition.after_context_sha256 !== context.context_sha256) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
      if (taskCursor(instance, phaseId, phase, proposal, context.context_sha256).previous_progress_operation_id !== input.progress_operation_id) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
    }
    const selected = work.output.observations.task_operation_id ? acceptedOperation(instance, work.output.observations.task_operation_id, "cycle_task_select").output.observations : null;
    return { ...validation, work, proposal, task_selection: selected, progress_operation_id: input.progress_operation_id ?? null,
      observed_task_ids: [...observedTasks], context: context.context, context_sha256: context.context_sha256 };
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
  return Object.freeze({ profile: "standard-mixed.v1", observeProduct: () => { const value = readProductSha256?.(); if (!/^[a-f0-9]{64}$/.test(value ?? "")) fail("STANDARD_PROMOTION_PRODUCT_AUTHORITY_REQUIRED"); return value; }, read, readExecutionAuthority, snapshot, authenticate, authenticateOperationHost, inspectDiagnostic, withNativeOwner, prepareActivityOutput, preflightModeWork, evaluateModeWork, observeModeWork, prepareModeWorkContinuation, assertModeWorkContinuationFresh, readPrTriageActivity, evaluateDriftReport, readDriftEvaluation, admitReadyDriftDiagnosis,
    verifyNativeHumanSource, admitNativeActivity, evaluateCyclePlan, readCyclePlanEvaluation, observeCyclePlanContext, evaluateCycleReadiness, readCycleReadinessEvaluation, observeCycleReadinessContext, evaluateCycleWork, readCycleWorkEvaluation, readCycleValidationExecution, readCycleVerificationExecution, observeCycleAuditContext, observeCycleCloseContext, readCycleAuditActivity, readCycleCloseValidation, evaluateCycleTaskSelection, evaluateCycleTaskWork: (instance, input) => evaluateCycleWork(instance, input, CYCLE_TASK_WORK_CONTRACT), observeCycleVerificationContext, observeDriftContext, modelSource: source });
}
