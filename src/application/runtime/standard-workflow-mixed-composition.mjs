import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createStandardProcessAuthority } from "./standard-process-authority.mjs";
import { createStandardWorkflowOperationHost } from "./standard-workflow-operation-host.mjs";
import { createJournaledNativeAllocation } from "./journaled-native-allocation.mjs";
import { standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { shadowHash, freezeShadow, checkShadowJson } from "../../core/workflow/shadow-json.mjs";

import { processModels, processFrameNode } from "../../core/workflow/process-call-model.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };

// Both mixed-host stepping and ordinary action application use this port.
export function standardWorkflowCallPort(operations, instanceId) {
  function dispatch({ transition, occurrence_id, event_id }, { expectedSha256, write, expectedResultSha256 }) {
    const method = transition === "call_entry" ? "enterCall" : transition === "call_return" ? "returnCall" : null;
    if (!method) fail("STANDARD_HOST_CALL_TRANSITION_INVALID");
    return operations[method]({ instanceId, expectedSha256, occurrenceId: occurrence_id, eventId: event_id, write, expectedResultSha256 });
  }
  return Object.freeze({
    async step(state, frame, write) {
      const transition = { transition: frame.wait_reason, occurrence_id: frame.occurrence_id, event_id: `call_${state.record.revision}` };
      const changed = await dispatch(transition, { expectedSha256: state.record.instance_sha256, write });
      return { kind: "call", status: changed.cursor.status, ...changed,
        transition: { ...transition, result_sha256: changed.record.instance_sha256 } };
    },
    apply(transition, { expectedSha256, write }) {
      if (write !== true || !/^[a-f0-9]{64}$/.test(transition.result_sha256)) fail("STANDARD_HOST_CALL_EXACT_WRITE_REQUIRED");
      return dispatch(transition, { expectedSha256, write, expectedResultSha256: transition.result_sha256 });
    },
  });
}
// The common reducer owns control flow. This adapter selects a port for the
// cursor's ready leaf; it contains no standard-workflow routing decisions.
export function createStandardWorkflowMixedHost({ configuration: suppliedConfiguration, modelSource = null, readSigningKey, authorize, humanSource, controlSource,
  environment = process.env, validationProfile = null, sessionPushPort = null, sessionPullRequestPort = null, sessionReviewPort = null, sessionReviewEventPort = null, dispositionSource = null, nativeAuthorizationSource }, { controllerFactory, validationBoundaryFactory } = {}) {
  if (checkShadowJson(suppliedConfiguration)) fail("STANDARD_PROCESS_CONFIGURATION_INVALID");
  const configuration = freezeShadow(structuredClone(suppliedConfiguration));
  const model = readAgentRunFile(configuration.model.path, { sha256: configuration.model.sha256 }).value;
  if (!processModels(model).some(component => component.nodes.some(node => node.kind === "operation"))) fail("STANDARD_PROCESS_MIXED_MODEL_REQUIRED");
  let native;
  const processAuthority = createStandardProcessAuthority({ configuration, model, modelSource, readSigningKey, humanSource, environment,
    readProductSha256: () => nativeHost().preview().product_sha256 });
  function nativeHost() {
    return native ??= createJournaledNativeAllocation({ configuration, readSigningKey, environment, processAuthority, nativeAuthorizationSource }, { controllerFactory });
  }
  const bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row]));
  // Preserve eager validation for current models. Historical diagnostic reads
  // need no execution composition; any later native use still calls read().
  if (processModels(model).every(component => component.nodes.filter(node => node.kind === "operation").every(node => bindings.has(node.binding_ref)
    && component.operation_pins[node.binding_ref] === shadowHash(bindings.get(node.binding_ref))))) nativeHost();
  const operations = createStandardWorkflowOperationHost({ targetRoot: configuration.target_root, model, modelSource, readSigningKey,
    authorize, humanSource, controlSource, processAuthority, validationProfile, sessionPushPort, sessionPullRequestPort, sessionReviewPort, sessionReviewEventPort,
    reconciliationConfiguration: configuration, dispositionSource }, { validationBoundaryFactory });
  const inspect = () => operations.inspect(configuration.instance_id);
  const callTransition = standardWorkflowCallPort(operations, configuration.instance_id);
  const nodeFor = frame => processFrameNode(model, frame);
  async function finishOperation(id, signal) {
    const output = await operations.dispatch(id, { write: true, signal });
    if (!["receipted", "retained_result"].includes(output.status)) return { kind: "operation", operation_id: id, ...output };
    const accepted = await operations.accept(id, { write: true });
    return { kind: "operation", operation_id: id, status: accepted.cursor.status, ...accepted };
  }
  return Object.freeze({
    initialize: input => operations.initialize({ ...input, instanceId: configuration.instance_id }),
    inspect,
    inspectDiagnostic: () => operations.inspectDiagnostic(configuration.instance_id),
    prepareReconciliationInventory: input => operations.prepareReconciliationInventory(configuration.instance_id, input),
    prepareOperationDisposition: (id, input) => operations.prepareOperationDisposition(id, input),
    applyOperationDisposition: (plan, input) => operations.applyOperationDisposition(plan, input),
    previewNative: () => nativeHost().preview(),
    inspectAllocations: () => nativeHost().inspect(),
    readCheckpoint: generation => nativeHost().readCheckpoint(generation),
    prepareNativeAuthorizationEpoch: input => nativeHost().prepareAuthorizationEpoch(input),
    activateNativeAuthorizationEpoch: (request, input) => nativeHost().activateAuthorizationEpoch(request, input),
    prepareOperation: input => operations.preview({ ...input, instanceId: configuration.instance_id }),
    reprepareExpiredOperation: (id, input) => operations.reprepareExpiredOperation(id, input),
    stageOperation: (preview, input) => operations.stage(preview, input),
    dispatchOperation: (id, input) => operations.dispatch(id, input),
    reconcileCorrectionCheckpoint: (id, input) => operations.reconcileCorrectionCheckpoint(id, input),
    acceptOperation: (id, input) => operations.accept(id, input),
    readOperation: id => operations.readJournal(id),
    prepareDecision: id => operations.prepareDecision(id),
    receiveDecision: (id, input) => operations.receiveDecision(id, input),
    prepareControl: input => operations.prepareControl({ ...input, instanceId: configuration.instance_id }),
    captureControl: input => operations.captureControl({ ...input, instanceId: configuration.instance_id }),
    deliverControl: (id, input) => operations.deliverControl(id, input),
    readControl: id => operations.readControl(id),
    applyCall: callTransition.apply,
    async step({ write = false, input = {}, authorization, signal, expectedInstanceSha256 = null } = {}) {
      if (typeof write !== "boolean") fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      if (model.data_bindings && (checkShadowJson(input) || !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length)) fail("PROCESS_INPUT_OVERRIDE_FORBIDDEN");
      const state = inspect(), cursor = state.cursor;
      if (expectedInstanceSha256 !== null && state.record.instance_sha256 !== expectedInstanceSha256)
        fail("STANDARD_ENTRY_PRECONDITIONS_CHANGED");
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(cursor.status)) return { kind: "terminal", ...state, written: false, status: cursor.status };
      const call = cursor.occurrences.find(frame => frame.status === "WAITING" && ["call_entry", "call_return"].includes(frame.wait_reason));
      if (call) return callTransition.step(state, call, write);
      const ready = cursor.ready.map(id => cursor.occurrences.find(row => row.occurrence_id === id));
      const operation = ready.find(frame => nodeFor(frame).kind === "operation")
        // inspect() validates the entire cursor first. Ineligible occurrences
        // cannot supply this pending operation and need no model lookup here.
        ?? cursor.occurrences.find(frame => frame.status === "WAITING"
          && ["blocked", "deferred"].includes(frame.operation?.receipt?.outcome) && nodeFor(frame).kind === "operation");
      if (operation) {
        if (operation.operation?.receipt?.outcome === "blocked") {
          const id = operation.operation.intent.operation_id, record = operations.readJournal(id);
          if (record.results.at(-1)?.output.observations?.reason_code === "STANDARD_PLAN_EXPIRED")
            return { kind: "operation_reprepare_required", status: "WAITING", written: false, operation_id: id };
        }
        const preview = await operations.preview({ instanceId: configuration.instance_id, expectedSha256: state.record.instance_sha256,
          occurrenceId: operation.occurrence_id, input });
        if (!write) return { kind: "operation_preview", status: cursor.status, written: false, preview };
        const staged = await operations.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
        return finishOperation(staged.operation_id, signal);
      }
      const pending = cursor.occurrences.filter(frame => nodeFor(frame).kind === "operation" && frame.status === "WAITING" && frame.operation && !frame.operation.receipt);
      const deterministic = pending.find(frame => bindings.get(nodeFor(frame).binding_ref).executor_kind !== "human");
      if (deterministic) {
        if (!write) return { kind: "operation_wait", written: false, status: "WAITING", operation_id: deterministic.operation.intent.operation_id };
        return finishOperation(deterministic.operation.intent.operation_id, signal);
      }
      if (cursor.occurrences.some(frame => frame.operation?.receipt?.outcome === "reconciliation_required")) return { kind: "reconciliation", status: "WAITING", written: false };
      if (ready.some(frame => nodeFor(frame).kind === "activity")) {
        if (!write) return { kind: "native_preview", status: cursor.status, ...nativeHost().preview() };
        return { kind: "native", ...await nativeHost().run({ execute: true, authorization, signal, resume: (nativeHost().inspect()?.allocations.length ?? 0) > 0 }) };
      }
      if (pending.length) {
        if (!write) return { kind: "human_wait", written: false, status: "WAITING", operation_id: pending[0].operation.intent.operation_id };
        return finishOperation(pending[0].operation.intent.operation_id, signal);
      }
      return { kind: "wait", status: cursor.status, written: false, record: state.record, cursor };
    },
  });
}
