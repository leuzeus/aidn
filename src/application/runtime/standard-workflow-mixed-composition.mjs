import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createStandardProcessAuthority } from "./standard-process-authority.mjs";
import { createStandardWorkflowOperationHost } from "./standard-workflow-operation-host.mjs";
import { createJournaledNativeAllocation } from "./journaled-native-allocation.mjs";
import { standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { shadowHash, freezeShadow, checkShadowJson } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// The common reducer owns control flow. This adapter selects a port for the
// cursor's ready leaf; it contains no standard-workflow routing decisions.
export function createStandardWorkflowMixedHost({ configuration: suppliedConfiguration, modelSource = null, readSigningKey, authorize, humanSource, controlSource,
  environment = process.env }, { controllerFactory } = {}) {
  if (checkShadowJson(suppliedConfiguration)) fail("STANDARD_PROCESS_CONFIGURATION_INVALID");
  const configuration = freezeShadow(structuredClone(suppliedConfiguration));
  const model = readAgentRunFile(configuration.model.path, { sha256: configuration.model.sha256 }).value;
  if (!model.nodes.some(node => node.kind === "operation")) fail("STANDARD_PROCESS_MIXED_MODEL_REQUIRED");
  let native;
  const processAuthority = createStandardProcessAuthority({ configuration, model, modelSource, readSigningKey, environment,
    readProductSha256: () => native.preview().product_sha256 });
  native = createJournaledNativeAllocation({ configuration, readSigningKey, environment, processAuthority }, { controllerFactory });
  const operations = createStandardWorkflowOperationHost({ targetRoot: configuration.target_root, model, modelSource, readSigningKey,
    authorize, humanSource, controlSource, processAuthority });
  const bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row]));
  const inspect = () => operations.inspect(configuration.instance_id);
  const nodeFor = frame => model.nodes.find(node => node.id === frame.node_id);
  async function finishOperation(id) {
    const output = await operations.dispatch(id, { write: true });
    if (!["receipted", "retained_result"].includes(output.status)) return { kind: "operation", operation_id: id, ...output };
    const accepted = await operations.accept(id, { write: true });
    return { kind: "operation", operation_id: id, status: accepted.cursor.status, ...accepted };
  }
  return Object.freeze({
    initialize: input => operations.initialize({ ...input, instanceId: configuration.instance_id }),
    inspect,
    previewNative: () => native.preview(),
    inspectAllocations: () => native.inspect(),
    readCheckpoint: generation => native.readCheckpoint(generation),
    prepareOperation: input => operations.preview({ ...input, instanceId: configuration.instance_id }),
    stageOperation: (preview, input) => operations.stage(preview, input),
    dispatchOperation: (id, input) => operations.dispatch(id, input),
    acceptOperation: (id, input) => operations.accept(id, input),
    readOperation: id => operations.readJournal(id),
    receiveDecision: (id, input) => operations.receiveDecision(id, input),
    prepareControl: input => operations.prepareControl({ ...input, instanceId: configuration.instance_id }),
    captureControl: input => operations.captureControl({ ...input, instanceId: configuration.instance_id }),
    deliverControl: (id, input) => operations.deliverControl(id, input),
    async step({ write = false, input = {}, authorization, signal } = {}) {
      if (typeof write !== "boolean") fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const state = inspect(), cursor = state.cursor;
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(cursor.status)) return { kind: "terminal", ...state, written: false, status: cursor.status };
      const ready = cursor.ready.map(id => cursor.occurrences.find(row => row.occurrence_id === id));
      const operation = ready.find(frame => nodeFor(frame).kind === "operation");
      if (operation) {
        const preview = await operations.preview({ instanceId: configuration.instance_id, expectedSha256: state.record.instance_sha256,
          occurrenceId: operation.occurrence_id, input });
        if (!write) return { kind: "operation_preview", status: cursor.status, written: false, preview };
        const staged = await operations.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
        return finishOperation(staged.operation_id);
      }
      const pending = cursor.occurrences.filter(frame => nodeFor(frame).kind === "operation" && frame.status === "WAITING" && frame.operation && !frame.operation.receipt);
      const deterministic = pending.find(frame => bindings.get(nodeFor(frame).binding_ref).executor_kind !== "human");
      if (deterministic) {
        if (!write) return { kind: "operation_wait", written: false, status: "WAITING", operation_id: deterministic.operation.intent.operation_id };
        return finishOperation(deterministic.operation.intent.operation_id);
      }
      if (cursor.occurrences.some(frame => frame.operation?.receipt?.outcome === "reconciliation_required")) return { kind: "reconciliation", status: "WAITING", written: false };
      if (ready.some(frame => nodeFor(frame).kind === "activity")) {
        if (!write) return { kind: "native_preview", status: cursor.status, ...native.preview() };
        return { kind: "native", ...await native.run({ execute: true, authorization, signal, resume: native.inspect() !== null }) };
      }
      if (pending.length) {
        if (!write) return { kind: "human_wait", written: false, status: "WAITING", operation_id: pending[0].operation.intent.operation_id };
        return finishOperation(pending[0].operation.intent.operation_id);
      }
      return { kind: "wait", status: cursor.status, written: false, record: state.record, cursor };
    },
  });
}
