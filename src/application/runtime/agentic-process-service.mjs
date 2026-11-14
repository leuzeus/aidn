import { createAgenticProcess, inspectAgenticProcess, advanceAgenticProcess, assertProcessResult } from "../../core/workflow/agentic-process.mjs";
import { processFrameModel, processFrameNode } from "../../core/workflow/process-call-model.mjs";
import { resolveProcessCallData } from "../../core/workflow/process-call-data.mjs";
import { processFail as fail, processId } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { decideAgentReuse } from "./agent-reuse-decision-service.mjs";
import { assertProcessOperationBinding, assertProcessOperationIntent, assertProcessOperationReceipt, assertProcessControlEvent } from "../../core/workflow/process-operation-contracts.mjs";
import { checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { readAgenticProcessStoreInspection } from "../../adapters/runtime/agentic-process-store.mjs";

// Host-composed trusted ports, never modules/attestations selected by a model.
// This service records admission and accepted results; it launches no executor.
export function createAgenticProcessService({ store, readAuthority, readBinding, assignmentAuthority, resultAuthority, operationAuthority, controlAuthority,
  adapters, roster, adapterHealth, now = Date.now, authorityTimeoutMs = 1000 }) {
  if (!Number.isSafeInteger(authorityTimeoutMs) || authorityTimeoutMs < 1 || authorityTimeoutMs > 5000) fail("PROCESS_AUTHORITY_TIMEOUT_INVALID");
  function current(instanceId, expectedSha256) {
    const previous = store.read(instanceId);
    if (!previous.record) fail("PROCESS_INSTANCE_NOT_FOUND");
    if (!expectedSha256 || previous.record.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
    return previous;
  }
  function authority(instance) {
    let observed;
    try { observed = readAuthority(); } catch { fail("PROCESS_AUTHORITY_UNAVAILABLE"); }
    if (observed?.scope_id !== instance.scope_id || observed.model_sha256 !== instance.model_sha256
      || !observed.policy_pins || shadowHash(observed.policy_pins) !== shadowHash(instance.policy_pins)) fail("PROCESS_AUTHORITY_CHANGED");
  }
  function commit(instance, previous, write, expectedResultSha256) {
    if (typeof write !== "boolean") fail("PROCESS_EXPLICIT_WRITE_REQUIRED");
    authority(instance);
    if (expectedResultSha256 != null && expectedResultSha256 !== instance.instance_sha256) fail("PROCESS_PREVIEW_CHANGED");
    if (!write || instance.instance_sha256 === previous.record?.instance_sha256)
      return { written: false, record: instance, cursor: inspectAgenticProcess(instance) };
    const retained = store.compareAndSwap(instance, previous.content_sha256);
    if (retained.projection === "pending") {
      try { store.materialize(instance.instance_id, { write: true }); retained.projection = "materialized"; }
      catch { retained.projection = "reconciliation_required"; }
    }
    return { ...retained, cursor: inspectAgenticProcess(instance) };
  }
  function frameFor(instance, occurrenceId) {
    const frame = inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId);
    if (!frame || processFrameNode(instance.model, frame)?.kind !== "activity") fail("PROCESS_ACTIVITY_NOT_FOUND");
    return frame;
  }
  function requestFor(instance, frame) {
    authority(instance);
    const node = processFrameNode(instance.model, frame);
    const policy = processFrameModel(instance.model, frame).policies.find(row => row.id === node.policy_ref), role = processFrameModel(instance.model, frame).roles.find(row => row.id === node.role_ref);
    let binding;
    try { binding = readBinding({ instance_id: instance.instance_id, occurrence_id: frame.occurrence_id,
      participant_ref: node.participant_ref, scope_id: instance.scope_id }); } catch { fail("PROCESS_BINDING_UNAVAILABLE"); }
    if (!binding || typeof binding !== "object") fail("PROCESS_BINDING_UNAVAILABLE");
    return { contract_version: "agent-reuse-request.v1", activity_id: frame.occurrence_id, scope_id: instance.scope_id,
      revision: binding.revision, artifact_sha256: binding.artifact_sha256, criteria_sha256: binding.criteria_sha256,
      assurance_profile: policy.assurance_profile, mode: policy.mode, role: role.role, action: role.action,
      independent_review: policy.independent_review, context_isolation_required: policy.context_isolation_required,
      required_permissions: structuredClone(policy.required_permissions), allowed_permissions: structuredClone(policy.allowed_permissions),
      allowed_context_sha256: structuredClone(binding.allowed_context_sha256), reviewed_contributors: structuredClone(binding.reviewed_contributors) };
  }
  const select = (request, phase, requiredSkills, expectedExecutionId = null) => decideAgentReuse({ request, authority: assignmentAuthority,
    recommendation: { role: request.role, action: request.action, mode: request.mode }, scope: { scope_id: request.scope_id },
    adapters, roster, adapterHealth, phase, expectedExecutionId, requiredSkills, now, timeoutMs: authorityTimeoutMs });
  const skillsFor = (instance, frame) => {
    const node = processFrameNode(instance.model, frame);
    return processFrameModel(instance.model, frame).roles.find(row => row.id === node.role_ref).skills;
  };
  function refusal(previous, occurrenceId, eventId, stage, decision, write, expectedResultSha256) {
    const instance = advanceAgenticProcess(previous.record, { event_id: eventId, kind: "refusal", occurrence_id: occurrenceId,
      stage, reason_code: decision.reason_code, request_sha256: decision.request_sha256 });
    return { ...commit(instance, previous, write, expectedResultSha256),
      status: stage === "assignment" ? "WAITING_FOR_ELIGIBLE_EXECUTOR" : "RESULT_NOT_ACCEPTED", decision };
  }
  async function readAuthenticatedResult(resultId, frame) {
    if (!resultAuthority || typeof resultAuthority.read !== "function" || typeof resultAuthority.verify !== "function") fail("PROCESS_RESULT_AUTHORITY_UNAVAILABLE");
    const stop = new AbortController(); let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { stop.abort(); reject(Object.assign(new Error("PROCESS_RESULT_AUTHORITY_TIMEOUT"), { code: "PROCESS_RESULT_AUTHORITY_TIMEOUT" })); }, authorityTimeoutMs); });
    const bounded = operation => Promise.race([Promise.resolve().then(operation), timeout]);
    try {
      const result = structuredClone(await bounded(() => resultAuthority.read({ result_id: resultId, request: structuredClone(frame.assignment.request), signal: stop.signal })));
      assertProcessResult(result, frame.assignment);
      if (result.result_id !== resultId) fail("PROCESS_RESULT_ID_CHANGED");
      const proof = await bounded(() => resultAuthority.verify({ result: structuredClone(result), request: structuredClone(frame.assignment.request), signal: stop.signal }));
      if (proof?.outcome !== "verified" || proof.result_sha256 !== shadowHash(result)
        || proof.request_sha256 !== shadowHash(frame.assignment.request) || proof.execution_id !== result.execution_id
        || proof.authority_id !== frame.assignment.decision.authority_id) fail("PROCESS_RESULT_NOT_AUTHENTICATED");
      return result;
    } catch (error) {
      const codes = ["PROCESS_RESULT_AUTHORITY_TIMEOUT", "PROCESS_RESULT_BINDING_CHANGED", "PROCESS_RESULT_ID_CHANGED", "PROCESS_RESULT_NOT_AUTHENTICATED"];
      fail(codes.includes(error?.code) ? error.code : "PROCESS_RESULT_AUTHORITY_UNAVAILABLE");
    } finally { clearTimeout(timer); stop.abort(); }
  }
  // Bounded observation/authentication only. Neither method executes an operation
  // or accepts a receipt supplied in the request. The host owns the fixed port.
  async function authorityObservation(port, callback, prefix = "PROCESS_OPERATION") {
    const stop = new AbortController(); let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { stop.abort(); reject(Object.assign(new Error(prefix + "_AUTHORITY_TIMEOUT"), { code: prefix + "_AUTHORITY_TIMEOUT" })); }, authorityTimeoutMs); });
    const invoke = async (method, input) => {
      if (typeof port?.[method] !== "function") fail(prefix + "_AUTHORITY_UNAVAILABLE");
      const observed = await Promise.race([Promise.resolve().then(() => port[method]({ ...structuredClone(input), signal: stop.signal })), timeout]);
      if (checkShadowJson(observed)) fail(prefix + "_AUTHORITY_INVALID");
      return structuredClone(observed);
    };
    try { return await callback(invoke); }
    catch (cause) {
      fail(/^PROCESS_(OPERATION|CONTROL|CALL|INPUT)_[A-Z_]+$/.test(cause?.code ?? "") ? cause.code : prefix + "_AUTHORITY_UNAVAILABLE");
    } finally { clearTimeout(timer); stop.abort(); }
  }
  function operationFrame(instance, occurrenceId) {
    authority(instance);
    const frame = inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId);
    const node = frame && processFrameNode(instance.model, frame);
    if (node?.kind !== "operation") fail("PROCESS_OPERATION_NOT_FOUND");
    return { frame, node };
  }
  async function transitionCall({ instanceId, expectedSha256, occurrenceId, eventId, write = false, expectedResultSha256 = null }, returning) {
    if (!processId(eventId)) fail("PROCESS_CALL_REQUEST_INVALID");
    const previous = current(instanceId, expectedSha256), instance = previous.record;
    authority(instance);
    const kind = returning ? "call_return" : "call_enter";
    const retained = instance.events.find(row => row.event_id === eventId);
    if (retained) {
      if (retained.kind !== kind || retained.occurrence_id !== occurrenceId) fail("PROCESS_EVENT_ID_CONFLICT");
      return commit(instance, previous, write, expectedResultSha256);
    }
    const cursor = inspectAgenticProcess(instance), records = new Map();
    const data = await authorityObservation(operationAuthority, async invoke => {
      for (let count = 0; count <= 32; count++) {
        try { return resolveProcessCallData({ instance, cursor, occurrenceId, returning, readOperation: id => records.get(id) }); }
        catch (error) {
          if (error.code !== "PROCESS_CALL_WITNESS_REQUIRED") throw error;
          if (count === 32 || records.has(error.operation_id)) fail("PROCESS_CALL_WITNESS_INVALID");
          const record = await invoke("readCallOperation", { instance, operation_id: error.operation_id });
          records.set(error.operation_id, record);
        }
      }
      fail("PROCESS_CALL_WITNESS_INVALID");
    });
    return commit(advanceAgenticProcess(instance, { event_id: eventId, kind, occurrence_id: occurrenceId, ...data }), previous, write, expectedResultSha256);
  }
  return Object.freeze({
    enterCall: request => transitionCall(request, false),
    returnCall: request => transitionCall(request, true),
    inspect(instanceId) {
      const inspected = readAgenticProcessStoreInspection(store, instanceId);
      if (inspected) {
        if (!inspected.record) fail("PROCESS_INSTANCE_NOT_FOUND");
        return inspected;
      }
      const previous = store.read(instanceId);
      if (!previous.record) fail("PROCESS_INSTANCE_NOT_FOUND");
      return { ...previous, cursor: inspectAgenticProcess(previous.record) };
    },
    initialize({ instanceId, model, facts = {}, parameters, write = false, expectedResultSha256 = null }) {
      const previous = store.read(instanceId);
      if (previous.record) fail("PROCESS_INSTANCE_ALREADY_EXISTS");
      let observed;
      try { observed = readAuthority(); } catch { fail("PROCESS_AUTHORITY_UNAVAILABLE"); }
      if (!observed?.policy_pins || !observed.scope_id) fail("PROCESS_AUTHORITY_UNAVAILABLE");
      const instance = createAgenticProcess({ instanceId, model, facts, parameters, scopeId: observed.scope_id, policyPins: observed.policy_pins });
      return commit(instance, previous, write, expectedResultSha256);
    },
    // A timer/message is delivered by the trusted host, not polled by an agent.
    // Model JSON cannot choose its event adapter or authenticate a sender.
    signal({ instanceId, expectedSha256, event, write = false, expectedResultSha256 = null }) {
      if (!["facts", "message", "cancel"].includes(event?.kind)) fail("PROCESS_CONTROL_EVENT_REQUIRED");
      const previous = current(instanceId, expectedSha256);
      if (previous.record.contract_version === "agentic-process-instance.v2" && event.kind !== "cancel") fail("PROCESS_AUTHENTICATED_CONTROL_REQUIRED");
      return commit(advanceAgenticProcess(previous.record, event), previous, write, expectedResultSha256);
    },
    async prepareOperation({ instanceId, expectedSha256, occurrenceId, eventId, write = false, expectedResultSha256 = null }) {
      if (!processId(eventId)) fail("PROCESS_OPERATION_REQUEST_INVALID");
      const previous = current(instanceId, expectedSha256), { frame, node } = operationFrame(previous.record, occurrenceId);
      const retained = previous.record.events.find(row => row.event_id === eventId);
      if (retained?.kind === "operation_intent" && retained.occurrence_id === occurrenceId)
        return commit(previous.record, previous, write, expectedResultSha256);
      if (!(frame.status === "READY" || frame.status === "WAITING" && ["blocked", "deferred"].includes(frame.operation?.receipt?.outcome))) fail("PROCESS_OPERATION_ORDER_INVALID");
      const { intent } = await authorityObservation(operationAuthority, async invoke => {
        const observed = await invoke("prepare", { instance: previous.record, occurrence: frame, binding_ref: node.binding_ref });
        assertProcessOperationBinding(observed.binding);
        assertProcessOperationIntent(observed.intent, { instance: previous.record, node, occurrenceId: frame.occurrence_id, model: processFrameModel(previous.record.model, frame) });
        if (observed.binding.id !== node.binding_ref || shadowHash(observed.binding) !== observed.intent.binding_sha256
          || !["read-only", "preview"].includes(observed.binding.effect_class) && observed.intent.authorization_sha256 === null) fail("PROCESS_OPERATION_INTENT_BINDING_CHANGED");
        const proof = await invoke("verifyIntent", { binding: observed.binding, intent: observed.intent, instance: previous.record, occurrence: frame });
        if (proof.outcome !== "verified" || proof.authority_id !== observed.intent.authority_id
          || proof.intent_sha256 !== shadowHash(observed.intent) || proof.binding_sha256 !== shadowHash(observed.binding)) fail("PROCESS_OPERATION_INTENT_NOT_AUTHENTICATED");
        return observed;
      });
      return commit(advanceAgenticProcess(previous.record, { kind: "operation_intent", event_id: eventId, occurrence_id: occurrenceId, intent }), previous, write, expectedResultSha256);
    },
    async acceptOperation({ instanceId, expectedSha256, occurrenceId, eventId, receiptId, write = false, expectedResultSha256 = null }) {
      if (!processId(eventId) || !processId(receiptId)) fail("PROCESS_OPERATION_REQUEST_INVALID");
      const previous = current(instanceId, expectedSha256), { frame } = operationFrame(previous.record, occurrenceId);
      const retained = previous.record.events.find(row => row.event_id === eventId);
      if (retained?.kind === "operation_result" && retained.occurrence_id === occurrenceId && retained.receipt.receipt_id === receiptId)
        return commit(previous.record, previous, write, expectedResultSha256);
      if (frame.status !== "WAITING" || !frame.operation || frame.operation.receipt && frame.operation.receipt.outcome !== "reconciliation_required") fail("PROCESS_OPERATION_ORDER_INVALID");
      const receipt = await authorityObservation(operationAuthority, async invoke => {
        const observed = await invoke("readReceipt", { receipt_id: receiptId, instance: previous.record, occurrence: frame, intent: frame.operation.intent });
        assertProcessOperationReceipt(observed, frame.operation.intent);
        if (observed.receipt_id !== receiptId) fail("PROCESS_OPERATION_RECEIPT_BINDING_CHANGED");
        const proof = await invoke("verifyReceipt", { receipt: observed, instance: previous.record, occurrence: frame, intent: frame.operation.intent });
        if (proof.outcome !== "verified" || proof.authority_id !== observed.authority_id
          || proof.intent_sha256 !== shadowHash(frame.operation.intent) || proof.receipt_sha256 !== shadowHash(observed)) fail("PROCESS_OPERATION_RESULT_NOT_AUTHENTICATED");
        return observed;
      });
      return commit(advanceAgenticProcess(previous.record, { kind: "operation_result", event_id: eventId, occurrence_id: occurrenceId, receipt }), previous, write, expectedResultSha256);
    },
    async deliverControl({ instanceId, expectedSha256, occurrenceId, eventId, deliveryId, write = false, expectedResultSha256 = null }) {
      if (!processId(eventId) || !processId(deliveryId)) fail("PROCESS_CONTROL_REQUEST_INVALID");
      const previous = current(instanceId, expectedSha256);
      authority(previous.record);
      const retained = previous.record.events.find(row => row.event_id === eventId);
      if (retained?.kind === "control" && retained.occurrence_id === occurrenceId && retained.delivery.delivery_id === deliveryId)
        return commit(previous.record, previous, write, expectedResultSha256);
      const occurrence = inspectAgenticProcess(previous.record).occurrences.find(row => row.occurrence_id === occurrenceId);
      const node = occurrence && processFrameNode(previous.record.model, occurrence);
      if (previous.record.contract_version !== "agentic-process-instance.v2" || node?.kind !== "event" || occurrence.status !== "WAITING") fail("PROCESS_CONTROL_ORDER_INVALID");
      const delivery = await authorityObservation(controlAuthority, async invoke => {
        const observed = await invoke("read", { delivery_id: deliveryId, instance: previous.record, occurrence });
        assertProcessControlEvent(observed, { instance: previous.record, occurrence });
        if (observed.delivery_id !== deliveryId) fail("PROCESS_CONTROL_BINDING_CHANGED");
        const proof = await invoke("verify", { delivery: observed, instance: previous.record, occurrence });
        if (proof.outcome !== "verified" || proof.authority_id !== observed.authority_id || proof.delivery_sha256 !== shadowHash(observed)) fail("PROCESS_CONTROL_NOT_AUTHENTICATED");
        return observed;
      }, "PROCESS_CONTROL");
      return commit(advanceAgenticProcess(previous.record, { event_id: eventId, kind: "control", occurrence_id: occurrenceId, delivery }), previous, write, expectedResultSha256);
    },
    async assign({ instanceId, expectedSha256, occurrenceId, eventId, write = false, expectedResultSha256 = null }) {
      const previous = current(instanceId, expectedSha256), frame = frameFor(previous.record, occurrenceId);
      const retained = previous.record.events.find(row => row.event_id === eventId);
      if (retained?.kind === "assign" && retained.occurrence_id === occurrenceId)
        return { ...commit(previous.record, previous, write, expectedResultSha256), decision: retained.decision };
      if (frame.status !== "READY") fail("PROCESS_ASSIGNMENT_ORDER_INVALID");
      const request = requestFor(previous.record, frame), decision = await select(request, "assignment", skillsFor(previous.record, frame));
      if (decision.decision === "wait") return refusal(previous, occurrenceId, eventId, "assignment", decision, write, expectedResultSha256);
      const instance = advanceAgenticProcess(previous.record, { event_id: eventId, kind: "assign", occurrence_id: occurrenceId, request, decision });
      return { ...commit(instance, previous, write, expectedResultSha256), decision };
    },
    async accept({ instanceId, expectedSha256, occurrenceId, eventId, resultId, write = false, expectedResultSha256 = null }) {
      const previous = current(instanceId, expectedSha256), frame = frameFor(previous.record, occurrenceId);
      const retained = previous.record.events.find(row => row.event_id === eventId);
      if (retained?.kind === "result" && retained.occurrence_id === occurrenceId && retained.result.result_id === resultId)
        return commit(previous.record, previous, write, expectedResultSha256);
      if (frame.status !== "RUNNING" || !frame.assignment) fail("PROCESS_RESULT_ORDER_INVALID");
      const request = requestFor(previous.record, frame);
      if (shadowHash(request) !== shadowHash(frame.assignment.request)) fail("PROCESS_REVIEWED_REVISION_CHANGED");
      const result = await readAuthenticatedResult(resultId, frame);
      // Re-observe after result authentication. Corrections, context changes or
      // expired evidence cannot be hidden behind an earlier assignment.
      if (shadowHash(requestFor(previous.record, frame)) !== shadowHash(request)) fail("PROCESS_REVIEWED_REVISION_CHANGED");
      const decision = await select(request, "verdict", skillsFor(previous.record, frame), frame.assignment.decision.execution_id);
      if (decision.decision === "wait") return refusal(previous, occurrenceId, eventId, "verdict", decision, write, expectedResultSha256);
      if (["execution_id", "agent_id", "lineage_id", "session_id", "adapter_id", "authority_id"]
        .some(key => decision[key] !== frame.assignment.decision[key])) {
        return refusal(previous, occurrenceId, eventId, "verdict", { ...decision, decision: "wait", reason_code: "RESULT_EXECUTION_IDENTITY_CHANGED" }, write, expectedResultSha256);
      }
      if (shadowHash(requestFor(previous.record, frame)) !== shadowHash(request)) fail("PROCESS_REVIEWED_REVISION_CHANGED");
      const instance = advanceAgenticProcess(previous.record, { event_id: eventId, kind: "result", occurrence_id: occurrenceId, result });
      return commit(instance, previous, write, expectedResultSha256);
    },
  });
}
