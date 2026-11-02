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
import { readNativeAllocationCheckpoint, nativeEvidenceFile, nativeAllocationOutputId } from "./native-allocation-evidence.mjs";
import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { readStandardDriftContext, evaluateStandardDriftReport } from "./standard-drift-report.mjs";
import { DRIFT_REPORT_CONTRACT, nativeActivityOutputSkill, assertNativeActivityAnswer } from "../../core/workflow/native-activity-output.mjs";
import { CYCLE_PLAN_CONTRACT } from "../../core/workflow/standard-cycle-planning.mjs";
import { readStandardCyclePlanContext, evaluateStandardCyclePlan } from "./standard-cycle-plan-context.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { assertStandardWorkflowModelSource } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { assertStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { assertAgenticProcessInstance, agenticProcessPrefixSha256, inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { assertAgenticProcessModel, agenticPolicyPins } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, freezeShadow, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import previewSchema from "../../core/contracts/workflow-definition/standard-operation-preview.v1.schema.json" with { type: "json" };
import { assertStandardResolvedPreview } from "./standard-process-inputs.mjs";

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
          assertStandardResolvedPreview(record.preview, model);
          if (record.preview.binding.executor_kind === "human" && record.results.length) human.captured(record);
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
  async function prepareActivityOutput({ contractRef, productSha256 }) {
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
  function readActivityOutput(instance, occurrenceId, contractRef = DRIFT_REPORT_CONTRACT) {
    const state = authenticate(instance), event = instance.events.find(row => row.kind === "result" && row.occurrence_id === occurrenceId);
    if (!state || !event || event.result.outcome !== "completed") fail("STANDARD_DRIFT_AUTHENTICATED_RESULT_REQUIRED");
    const frame = inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId), node = model.nodes.find(row => row.id === frame?.node_id);
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
  const observeDriftContext = () => readStandardDriftContext({ targetRoot: configuration.target_root, productSha256: readProductSha256?.(), productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment });
  const observeCyclePlanContext = () => readStandardCyclePlanContext({ targetRoot: configuration.target_root, productSha256: readProductSha256?.(), productRoot: configuration.product_root,
    productFiles: configuration.product_files, deniedRoots: [...(configuration.native.protected_roots ?? []), configuration.control_root, configuration.review_root, configuration.native.home], environment });
  return Object.freeze({ profile: "standard-mixed.v1", read, snapshot, authenticate, withNativeOwner, prepareActivityOutput, evaluateDriftReport, readDriftEvaluation,
    evaluateCyclePlan, readCyclePlanEvaluation, observeCyclePlanContext, observeDriftContext, modelSource: source });
}
