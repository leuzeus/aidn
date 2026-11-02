import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { agenticProcessPersistence } from "./agentic-process-persistence.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings, assertStandardWorkflowImplementation } from "./standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createProcessControlInboxStore } from "../../adapters/runtime/process-control-inbox-store.mjs";
import { createProcessDecisionInboxStore } from "../../adapters/runtime/process-decision-inbox-store.mjs";
import { createNativeAllocationJournalStore } from "../../adapters/runtime/native-allocation-journal-store.mjs";
import { createStandardHumanDecisions } from "./standard-workflow-human-decisions.mjs";
import { nativeJournalId } from "../../core/workflow/native-allocation-journal.mjs";
import { readNativeAllocationCheckpoint } from "./native-allocation-evidence.mjs";
import { assertStandardWorkflowModelSource } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { assertStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { assertAgenticProcessInstance, agenticProcessPrefixSha256 } from "../../core/workflow/agentic-process.mjs";
import { assertAgenticProcessModel, agenticPolicyPins } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, freezeShadow, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import previewSchema from "../../core/contracts/workflow-definition/standard-operation-preview.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
// New mixed instances have one authority. Legacy operation/native scopes remain
// unchanged; no caller-authored module, key, scope or history is accepted.
export function createStandardProcessAuthority({ configuration: suppliedConfiguration, model: supplied, modelSource = null, readSigningKey, readProductSha256, environment = process.env }) {
  if (checkShadowJson(suppliedConfiguration)) fail("STANDARD_PROCESS_CONFIGURATION_INVALID");
  const configuration = freezeShadow(structuredClone(suppliedConfiguration));
  const model = freezeShadow(structuredClone(supplied)); assertAgenticProcessModel(model);
  if (model.contract_version !== "agentic-process-model.v2") fail("STANDARD_PROCESS_PROFILE_UNSUPPORTED");
  const source = modelSource === null ? null : freezeShadow(structuredClone(assertStandardWorkflowModelSource(modelSource, model)));
  const signer = createOperationJournalSigner(readSigningKey), initial = readWorkflowProjectAuthority({ targetRoot: configuration.target_root });
  const options = { targetRoot: configuration.target_root, stateMode: initial.stateMode, env: environment };
  const operations = createStandardWorkflowOperations({ targetRoot: configuration.target_root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root });
  const bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row]));
  for (const node of model.nodes.filter(row => row.kind === "operation")) if (!bindings.has(node.binding_ref)
    || model.operation_pins[node.binding_ref] !== shadowHash(bindings.get(node.binding_ref))) fail("STANDARD_PROCESS_BINDING_CHANGED");
  const operationStore = createProcessOperationJournalStore(options), controls = createProcessControlInboxStore(options), allocations = createNativeAllocationJournalStore(options);
  const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, projectionRequired: false });
  function read() {
    assertStandardWorkflowImplementation();
    const project = readWorkflowProjectAuthority({ targetRoot: configuration.target_root }), persistence = agenticProcessPersistence({ targetRoot: configuration.target_root, env: environment });
    if (project.stateMode !== initial.stateMode) fail("STANDARD_PROCESS_AUTHORITY_CHANGED");
    return { scope_id: shadowHash({ project: project.scope, persistence: persistence.binding_sha256,
      process_host: { version: 1, profile: "standard-mixed.v1", state_mode: project.stateMode, key_id: signer.keyId,
        model_sha256: shadowHash(model), model_source_sha256: source === null ? null : shadowHash(source) } }),
      model_sha256: shadowHash(model), policy_pins: agenticPolicyPins(model) };
  }
  function snapshot(productSha256 = readProductSha256?.()) {
    if (!/^[a-f0-9]{64}$/.test(productSha256 ?? "")) fail("STANDARD_PROCESS_PRODUCT_OBSERVATION_REQUIRED");
    return { ...(source ? { model_source: source } : {}), context: operations.observeScope(),
      documents: ["CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "baseline/current.md", "snapshots/context-snapshot.md"]
        .map(path => ({ path, sha256: artifacts.read(path, { required: true }).sha256 })),
      native: { configuration_sha256: shadowHash(configuration), product_sha256: productSha256 } };
  }
  function authenticate(instance, { reservation = null, productSha256, checkControlContext = false, forNative = false } = {}) {
    assertAgenticProcessInstance(instance); const authority = read();
    if (instance.scope_id !== authority.scope_id || instance.model_sha256 !== authority.model_sha256 || shadowHash(instance.policy_pins) !== shadowHash(authority.policy_pins)
      || Object.keys(instance.initial_facts).length) fail("STANDARD_PROCESS_AUTHORITY_CHANGED");
    const journal = allocations.read(nativeJournalId(instance)).record;
    let native = null, covered = 0;
    if (journal) {
      signer.verify(journal); const latest = journal.allocations.at(-1);
      if (latest.phase !== "closed") {
        if (!reservation || latest.phase !== "reserved" || latest.owner_id !== reservation.owner_id || latest.generation !== reservation.generation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE");
      } else if (reservation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_CHANGED");
      const entry = reservation ? journal.allocations.at(-2) : latest;
      if (entry) {
        if (entry.phase !== "closed") fail("STANDARD_PROCESS_NATIVE_RECONCILIATION_REQUIRED");
        native = readNativeAllocationCheckpoint(entry, configuration, { scopeId: authority.scope_id, modelSha256: authority.model_sha256 }).state;
        if (!native.parent_closed) fail("STANDARD_PROCESS_NATIVE_RECONCILIATION_REQUIRED");
        covered = native.instance.events.length;
        if (instance.events.length < covered || shadowHash(instance.events.slice(0, covered)) !== shadowHash(native.instance.events)) fail("STANDARD_PROCESS_NATIVE_HISTORY_CHANGED");
      }
    } else if (reservation) fail("STANDARD_PROCESS_NATIVE_ALLOCATION_CHANGED");
    const seen = new Map();
    for (const [index, event] of instance.events.entries()) {
      if (["assign", "result", "refusal"].includes(event.kind)) {
        if (!native || index >= covered || shadowHash(event) !== shadowHash(native.instance.events[index])) fail("STANDARD_PROCESS_NATIVE_HISTORY_NOT_AUTHENTICATED");
      } else if (["operation_intent", "operation_result"].includes(event.kind)) {
        const id = event.intent?.operation_id ?? event.receipt.operation_id;
        if (!seen.has(id)) {
          const record = operationStore.read(id).record; signer.verify(record); signer.verify(record.preview);
          if (validateJsonSchema(record.preview, previewSchema, "$", { contractKind: "workflow-definition" }).length
            || shadowHash(bindings.get(record.intent.binding_ref)) !== shadowHash(record.preview.binding)) fail("STANDARD_PROCESS_OPERATION_NOT_AUTHENTICATED");
          assertStandardOperationInput(record.intent.binding_ref, record.preview.input);
          if (record.intent.binding_ref === "mode_decision" && record.results.length) human.captured(record);
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
      } else fail("STANDARD_PROCESS_HISTORY_NOT_AUTHENTICATED");
    }
    return native;
  }
  async function withNativeOwner(intent, action) {
    const result = await artifacts.withLocalEffectOwner(shadowHash({ authority: read(), ...intent }), async () => {
      const value = await action();
      return { value, effect_status: value.journal_phase === "closed" ? "confirmed" : value.native_started === false ? "no_effect" : "unknown" };
    });
    return result.value;
  }
  return Object.freeze({ profile: "standard-mixed.v1", read, snapshot, authenticate, withNativeOwner, modelSource: source });
}
