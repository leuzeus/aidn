import { randomUUID } from "node:crypto";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createStandardDriftFinalization } from "./standard-drift-finalization.mjs";
import { createStandardDriftRecovery } from "./standard-drift-recovery.mjs";
import { createStandardDriftChangeRequest } from "./standard-drift-change-request.mjs";
import { createStandardDriftCycle } from "./standard-drift-cycle.mjs";
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
export function createStandardWorkflowOperationHost({ targetRoot, model: suppliedModel, modelSource = null, readSigningKey, authorize, humanSource, controlSource, now = Date.now, processAuthority }) {
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
      if (record.preview.binding.executor_kind === "human") await human.verifyCaptured(record, signal);
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
      const prepared = binding.id === "drift_report_evaluate" ? await processAuthority?.evaluateDriftReport(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : ["drift_recovery_context_refresh", "drift_recovery_checkpoint_observe", "drift_recovery_cycle_initialize"].includes(binding.id) ? await recoveryCycle?.prepare(state.record, binding.id, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_change_request_record" ? await changeRequest?.prepare(state.record, input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_recovery_decision" ? await recovery?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "drift_recovery_record" ? await (async () => { const body = { ...await recoveryDecision(state.record, input), prepared_at_ms: now() };
          return { ...body, can_apply: true, plan_sha256: shadowHash(body) }; })()
        : binding.id === "drift_check_finalize" ? await driftFinalization?.prepare(state.record, input, operationJournalId(state.record, occurrenceId)) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE")
        : binding.id === "session_initialize" ? await operations.prepareSession(input)
        : binding.id === "session_mode_apply" ? await operations.prepareMode(decisionInput(state.record, input))
        : binding.id === "session_start_finalize" ? await operations.prepareStart(input)
        : binding.id === "cycle_context_refresh" ? await operations.prepareCycleContext(input)
        : binding.id === "cycle_initialize" ? await operations.prepareCycle(input) : null;
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
        else if (record.intent.binding_ref === "cycle_admit") output = await operations.admitCycle(record.preview.input);
        else if (record.intent.binding_ref === "branch_cycle_audit") output = await operations.auditCycle(record.preview.input);
        else if (record.intent.binding_ref === "drift_report_evaluate") output = await processAuthority?.evaluateDriftReport(state.record, record.preview.input) ?? fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
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
        } else if (record.intent.binding_ref === "cycle_context_refresh") output = await operations.refreshCycleContext(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        else if (record.intent.binding_ref === "cycle_initialize") output = await operations.initializeCycle(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
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
      if (record.preview.binding.executor_kind !== "human" || !["mode_decision", "drift_recovery_decision"].includes(record.intent.binding_ref)) fail("PROCESS_HUMAN_OPERATION_REQUIRED");
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
      const capture = await human.reserve(record, sourceRef);
      if (!capture) return { status: "waiting_for_human", question: human.question(record) };
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      if (record.intent.binding_ref === "drift_recovery_decision") await recovery.assertFresh(state.record, record.preview.prepared.plan);
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
