import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadStandardWorkflowAssets, createStandardWorkflowExecution, STANDARD_WORKFLOW_MODEL_PATH } from "./standard-workflow-composition.mjs";
import { createStandardHostAuthority } from "../../adapters/runtime/standard-host-authority.mjs";
import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { assertStandardValidationProfileLayout } from "./standard-validation-profile-layout.mjs";
import { agenticProcessImplementationPins } from "./agentic-process-implementation-pins.mjs";
import { iterateAgenticProcessSimulation } from "../../core/workflow/agentic-process-simulation.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { standardEntryPoint } from "../../core/workflow/standard-workflow-entry-selection.mjs";
import { processFrameNode } from "../../core/workflow/process-call-model.mjs";
import { externalMergeControlRef } from "../../core/workflow/standard-pr-external-merge.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import requestSchema from "../../core/contracts/workflow-definition/standard-workflow-execution.v1.schema.json" with { type: "json" };
import actionSchema from "../../core/contracts/workflow-definition/standard-workflow-action.v1.schema.json" with { type: "json" };
import resultSchema from "../../core/contracts/workflow-definition/standard-workflow-entry-result.v1.schema.json" with { type: "json" };
import callActionSchema from "../../core/contracts/workflow-definition/standard-workflow-call-action.v1.schema.json" with { type: "json" };
import callResultSchema from "../../core/contracts/workflow-definition/standard-workflow-call-result.v1.schema.json" with { type: "json" };
import { isStandardNativeEntryAction, isStandardNativeEntryKind, standardNativeEntryActionSchema, standardNativeEntryActionVersionFor, standardNativeEntryOperatorSources,
  standardNativeEntryContext, prepareStandardNativeRecovery, prepareStandardNativeEpoch, assertStandardNativeEntryAction,
  standardNativeEntryRequirements, applyStandardNativeEntryAction, standardNativeEntryResult } from "./standard-workflow-native-entry.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pin = file => ({ path: file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") });

export function standardWorkflowControlOccurrence(state) {
  const frames = state.cursor.occurrences.filter(row => row.status === "WAITING" && row.wait_reason === "event"
    && processFrameNode(state.record.model, row)?.kind === "event");
  if (frames.length !== 1) fail("STANDARD_ENTRY_CONTROL_WAIT_REQUIRED");
  return frames[0].occurrence_id;
}

// Selecting STANDARD is distinct from selecting the agentic engine. User graphs
// and historical instances keep their existing routes. Neither a model nor a
// request can inject an actor, authority callback or controller implementation.
export function resolveStandardWorkflowConfiguration(request) {
  if (checkShadowJson(request) || validateJsonSchema(request, requestSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_ENTRY_CONFIGURATION_INVALID");
  standardEntryPoint(request.parameters);
  assertStandardValidationProfileLayout({ execution: request.execution, profileRef: request.validation_profile });
  const assets = loadStandardWorkflowAssets();
  const execution = structuredClone(request.execution);
  if (["model", "skills", "activity_outputs", "implementation_sha256", "control_scenario"].some(key => Object.hasOwn(execution, key))) fail("STANDARD_ENTRY_HOST_FIELD_FORBIDDEN");
  const skills = Object.fromEntries([...new Set(assets.catalog.activities.flatMap(row => row.skill_sources.map(source => source.path)))].map(name =>
    [name.match(/aidn-([^/]+)\/SKILL[.]md$/)[1], pin(path.join(packageRoot, name))]));
  const configuration = { ...execution, instructions: execution.instructions ?? {}, contract_version: "agentic-process-execution.v1", model: pin(path.join(packageRoot, STANDARD_WORKFLOW_MODEL_PATH)), skills,
    activity_outputs: Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, row.output_contract])),
    implementation_sha256: agenticProcessImplementationPins().sha256 };
  return { configuration, parameters: { ...structuredClone(request.parameters), entry_point: structuredClone(request.parameters.entry_point ?? "session") }, modelSource: assets.source, validationProfile: request.validation_profile ?? null };
}

export async function runStandardWorkflowEntry({ request, actionFile = null, preparedAction = null, decisionSource = null, controlSource = null, observation = null,
  authorization = null, execute = false, expectPlan = null, environment = process.env, signal } = {}, { providerTransport } = {}) {
  const resolved = resolveStandardWorkflowConfiguration(request), { configuration, parameters, modelSource, validationProfile } = resolved;
  const authority = createStandardHostAuthority({ configuration, environment,
    windowsOperatorAuthoritySha256: request.windows_operator_authority_sha256 }, { providerTransport, useProvider: observation === null });
  const provider = authority.githubProvider;
  const compose = (authorize, dispositionSource, nativeSources) => {
    let host;
    const handoffResourceSource = authority.createHandoffResourceSource({
      readInventory: () => host.prepareReconciliationInventory({ expectedSha256: host.inspectDiagnostic().record.instance_sha256 }),
      readNativeHistory: () => host.inspectNativeClosureEvidence(),
      observeNativeActivity: () => host.inspectNativeResourceActivity(),
      observeOperationActivity: () => host.inspectOperationResourceActivity(),
    });
    host = createStandardWorkflowExecution({ configuration, readSigningKey: () => authority.keyId() === null ? Buffer.alloc(32) : authority.readKey(),
    authorize, environment, validationProfile, humanSource: authority.humanSource, controlSource: authority.controlSource,
    nativeAuthorizationSource: authority.nativeAuthorizationSource, dispositionSource,
    nativeOwnerDispositionSource: nativeSources.owner, nativeReconciliationSource: nativeSources.reconciliation,
    sessionPushPort: provider?.sessionPushPort, sessionPullRequestPort: provider?.sessionPullRequestPort,
    sessionReviewPort: provider?.sessionReviewPort, sessionReviewEventPort: provider?.sessionReviewEventPort, handoffResourceSource });
    return host;
  };
  return runStandardWorkflowAction({ request, configuration, parameters, modelSource, actionFile, preparedAction, decisionSource, controlSource,
    observation, authorization, execute, expectPlan, signal }, { authority, compose });
}

// Composition supplies these ports. Request data cannot select them.
export async function runStandardWorkflowAction({ request, configuration, parameters, modelSource, actionFile = null, preparedAction = null,
  decisionSource = null, controlSource = null, observation = null, authorization = null, execute = false, expectPlan = null, signal }, { authority, compose }) {
  if (typeof execute !== "boolean") fail("STANDARD_ENTRY_ACTION_INVALID");
  if ([decisionSource, controlSource, observation].filter(value => value !== null).length > 1 || observation && !["replay", "simulate"].includes(observation)
    || execute && observation) fail("STANDARD_ENTRY_ACTION_CONFLICT");
  if (actionFile && preparedAction !== null) fail("STANDARD_ENTRY_ACTION_CONFLICT");
  const candidate = actionFile ? readAgentRunFile(path.resolve(actionFile), { maxBytes: 4194304 }).value : preparedAction;
  if (candidate === null && actionFile || candidate !== null && (checkShadowJson(candidate) || validateJsonSchema(candidate,
    isStandardNativeEntryAction(candidate) ? standardNativeEntryActionSchema(candidate) : candidate?.contract_version === callActionSchema["x-aidn-contract-version"] ? callActionSchema : actionSchema,
    "$", { contractKind: "workflow-definition" }).length)) fail("STANDARD_ENTRY_ACTION_INVALID");
  const supplied = candidate === null ? null : structuredClone(candidate);
  if (execute && (!supplied || expectPlan !== shadowHash(supplied))) fail("STANDARD_ENTRY_EXACT_ACTION_REQUIRED");
  if (execute && signal?.aborted) fail("STANDARD_ENTRY_ABORTED");
  let permittedOperation = null, permittedDisposition = null, permittedNative = null;
  const nativeSources = standardNativeEntryOperatorSources(authority, () => permittedNative);
  const dispositionSource = typeof authority.authorizeDisposition === "function" && typeof authority.verifyDisposition === "function" ? {
    authorize: ({ request }) => authority.authorizeDisposition(request, permittedDisposition),
    verify: ({ request, grant }) => authority.verifyDisposition(request, grant, permittedDisposition),
    assertCurrent: ({ request, grant }) => { authority.verifyDisposition(request, grant, permittedDisposition); },
  } : null;
  const host = compose(input => authority.authorizeOperation(input, permittedOperation), dispositionSource, nativeSources);
  let state = null, nativeRecovery = false;
  try { state = host.inspect(); } catch (cause) {
    if (cause.code === "STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE" && (supplied === null || isStandardNativeEntryAction(supplied))
      && !decisionSource && !controlSource && !observation) { state = host.inspectDiagnostic(); nativeRecovery = true; }
    else if (cause.code !== "PROCESS_INSTANCE_NOT_FOUND") throw cause;
  }
  const initial = state ? null : host.initialize({ parameters });
  if (!state && (decisionSource || controlSource || observation)) fail("STANDARD_ENTRY_INSTANCE_REQUIRED");
  if (state && authority.keyId() === null) fail("STANDARD_HOST_RETAINED_KEY_REQUIRED");
  if (state && shadowHash(state.record.initial_parameters ?? {}) !== shadowHash(parameters)) fail("STANDARD_ENTRY_PARAMETERS_CHANGED");
  const context = { request_sha256: shadowHash(request), configuration_sha256: shadowHash(configuration), model_source_sha256: shadowHash(modelSource),
    instance_sha256: state?.record.instance_sha256 ?? null, native: host.previewNative(), key_id: authority.keyId(), trust_sha256: authority.trustSha() };
  const checkpointRecoveryAction = operationId => {
    const record = host.readOperation(operationId), receipt = record.results.at(-1)?.receipt;
    if (record.intent.binding_ref !== "session_pr_correction_checkpoint") return null;
    if (record.phase === "receipted" && receipt?.outcome === "completed" && receipt.effect_status === "confirmed")
      return { kind: "dispatch", payload: { operation_id: operationId, journal_sha256: shadowHash(record) } };
    if (!(record.phase === "dispatching" && record.results.length === 0 || record.phase === "receipted"
        && receipt?.outcome === "reconciliation_required" && receipt.effect_status === "unknown")) return null;
    if (signal?.aborted) fail("STANDARD_ENTRY_ABORTED");
    const { observation } = host.prepareProcessOwnerObservation({ expectedSha256: state.record.instance_sha256, operationId });
    if (observation.owner_status !== "original_process_absent") return { kind: "observe", payload: { status: "WAITING",
      reason: observation.owner_status === "original_process_active" ? "checkpoint_original_process_active" : "checkpoint_original_process_unresolved" } };
    return { kind: "dispatch", payload: { operation_id: operationId, journal_sha256: shadowHash(record) } };
  };
  const currentKind = async () => {
    if (authority.keyId() === null) return { kind: "prepare_host", payload: {} };
    if (!state) return { kind: "initialize", payload: { instance_sha256: initial.record.instance_sha256 } };
    if (observation) return { kind: observation, payload: {} };
    if (nativeRecovery) return prepareStandardNativeRecovery(host, state);
    if (controlSource === externalMergeControlRef) {
      const merge = await host.previewExternalMerge({ expectedSha256: state.record.instance_sha256,
        occurrenceId: standardWorkflowControlOccurrence(state), signal });
      return merge.merge_subject_sha256 ? { kind: "control", payload: { ...merge, source_ref: controlSource } }
        : { kind: "observe", payload: { status: "WAITING", reason: "external_merge_open" } };
    }
    if (controlSource) {
      return { kind: "control", payload: { request: host.prepareControl({ expectedSha256: state.record.instance_sha256,
        occurrenceId: standardWorkflowControlOccurrence(state) }), source_ref: controlSource } };
    }
    if (dispositionSource && typeof host.prepareAcceptedOperationControl === "function") {
      const retainedControl = host.prepareAcceptedOperationControl({ expectedSha256: state.record.instance_sha256 });
      if (retainedControl) return { kind: "operation_disposition_accept", payload: retainedControl };
    }
    const next = await host.step({ write: false, expectedInstanceSha256: state.record.instance_sha256, decisionSelected: decisionSource !== null, signal });
    if (decisionSource) {
      if (next.kind !== "human_wait") fail("STANDARD_ENTRY_HUMAN_WAIT_REQUIRED");
      return { kind: "decision", payload: { operation_id: next.operation_id, question: host.prepareDecision(next.operation_id), source_ref: decisionSource } };
    }
    if (next.kind === "call") return { kind: "call", payload: { ...next.transition, instance_id: state.record.instance_id,
      model_sha256: state.record.model_sha256 } };
    if (next.kind === "question_recovery") return { kind: "question_recovery", payload: { recovery_plan: next.plan } };
    if (next.kind === "operation_wait" && next.operation_id) {
      const recovery = checkpointRecoveryAction(next.operation_id);
      if (recovery) return recovery;
    }
    if (next.kind === "reconciliation") {
      const pending = state.cursor.occurrences.find(frame => frame.status === "WAITING"
        && frame.operation?.intent?.binding_ref === "session_pr_correction_checkpoint"
        && frame.operation.receipt?.outcome === "reconciliation_required" && frame.operation.receipt.effect_status === "unknown");
      if (pending) {
        const recovery = checkpointRecoveryAction(pending.operation.intent.operation_id);
        if (recovery) return recovery;
      }
    }
    if (next.kind === "operation_wait" && dispositionSource && next.operation_id) {
      const pending = state.cursor.occurrences.find(frame => frame.status === "WAITING"
        && frame.operation?.intent?.operation_id === next.operation_id
        && frame.operation.intent.binding_ref === "handoff_packet_publish" && !frame.operation.receipt);
      if (pending) {
        const record = host.readOperation(next.operation_id);
        const plan = await host.prepareOperationDisposition(next.operation_id, { expectedSha256: state.record.instance_sha256, signal });
        if (["process-operation-disposition-plan.v4", "process-operation-disposition-plan.v5"].includes(plan.contract_version)) {
          const beforeEffect = plan.contract_version === "process-operation-disposition-plan.v5";
          if (plan.assessment !== (beforeEffect ? "known_before_effect_handoff_publication" : "known_partial_handoff_publication")) fail("STANDARD_ENTRY_DISPOSITION_PLAN_REQUIRED");
          const latest = record.results.at(-1)?.receipt;
          if (!latest) return { kind: "operation_disposition", payload: { disposition_plan: plan } };
          if (!(beforeEffect ? latest.outcome === "blocked" && latest.effect_status === "no_effect"
            : ["completed", "reconciliation_required"].includes(latest.outcome))) fail("STANDARD_ENTRY_DISPOSITION_RECEIPT_CHANGED");
          return { kind: "operation_disposition_accept", payload: { operation_id: next.operation_id, journal_sha256: shadowHash(record), receipt_sha256: shadowHash(latest) } };
        }
      }
    }
    if (next.kind === "reconciliation" && dispositionSource) {
      const frames = state.cursor.occurrences.filter(frame => frame.status === "WAITING"
        && ["session_pr_correction_reopen", "session_pr_incident_close", "handoff_packet_publish"].includes(frame.operation?.intent?.binding_ref)
        && frame.operation.receipt?.outcome === "reconciliation_required" && frame.operation.receipt.effect_status === "unknown");
      if (frames.length === 1) {
        const id = frames[0].operation.intent.operation_id, record = host.readOperation(id);
        if (record.results[0]?.receipt?.outcome === "reconciliation_required"
          && record.results[0]?.receipt?.effect_status === "unknown") {
          const plan = await host.prepareOperationDisposition(id, { expectedSha256: state.record.instance_sha256, signal });
          if (["session_pr_incident_close", "handoff_packet_publish"].includes(record.intent.binding_ref)) {
            if (plan.assessment !== (record.intent.binding_ref === "handoff_packet_publish" ? "known_partial_handoff_publication" : "known_partial_incident_close")) fail("STANDARD_ENTRY_DISPOSITION_PLAN_REQUIRED");
            const latest = record.results.at(-1).receipt;
            const accepted = state.record.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(latest));
            if (accepted) return { kind: "operation_disposition", payload: { disposition_plan: plan } };
            if (record.results.length < (plan.contract_version === "process-operation-disposition-plan.v4" ? 1 : 2)
              || !["completed", "reconciliation_required"].includes(latest.outcome))
              fail("STANDARD_ENTRY_DISPOSITION_RECEIPT_CHANGED");
            return { kind: "operation_disposition_accept", payload: { operation_id: id, journal_sha256: shadowHash(record), receipt_sha256: shadowHash(latest) } };
          }
          if (plan.assessment !== "confirmed_reopen") fail("STANDARD_ENTRY_DISPOSITION_PLAN_REQUIRED");
          if (record.results.length === 1) return { kind: "operation_disposition", payload: { disposition_plan: plan } };
          const receipt = record.results[1]?.receipt;
          if (record.results.length !== 2 || receipt.effect_status !== "confirmed" || receipt.output_sha256 !== plan.output_sha256)
            fail("STANDARD_ENTRY_DISPOSITION_RECEIPT_CHANGED");
          return { kind: "operation_disposition_accept", payload: { operation_id: id, journal_sha256: shadowHash(record), receipt_sha256: shadowHash(receipt) } };
        }
      }
    }
    if (next.kind === "operation_preview") return { kind: "operation", payload: { preview: next.preview } };
    if (["human_wait", "operation_wait"].includes(next.kind)) return { kind: "dispatch", payload: { operation_id: next.operation_id,
      journal_sha256: shadowHash(host.readOperation(next.operation_id)), ...(next.kind === "human_wait" ? { question: host.prepareDecision(next.operation_id) } : {}) } };
    if (next.kind === "native_preview") {
      const epoch = prepareStandardNativeEpoch(host, authorization);
      if (epoch) return epoch;
      return { kind: "native", payload: { authorization_sha256: authorization ? shadowHash(authorization) : null } };
    }
    return { kind: "observe", payload: { status: next.status, reason: next.kind } };
  };
  let action;
  if (supplied) {
    const suppliedContext = isStandardNativeEntryAction(supplied) ? standardNativeEntryContext(supplied.context) : supplied.context;
    const currentContext = isStandardNativeEntryAction(supplied) ? standardNativeEntryContext(context) : context;
    if (shadowHash(suppliedContext) !== shadowHash(currentContext)) fail("STANDARD_ENTRY_PRECONDITIONS_CHANGED");
    action = supplied;
    // Stage revalidates the original exact prepared plan, bindings, CAS,
    // live snapshot and resolved data. Do not regenerate its timestamps.
    const applyExternalMerge = execute && action.kind === "control" && action.payload.source_ref === externalMergeControlRef;
    if (isStandardNativeEntryAction(action)) {
      if (decisionSource || controlSource || observation) fail("STANDARD_ENTRY_ACTION_CONFLICT");
    } else if (applyExternalMerge) {
      if (controlSource !== externalMergeControlRef || !state
        || shadowHash(host.prepareControl({ expectedSha256: state.record.instance_sha256,
          occurrenceId: standardWorkflowControlOccurrence(state) })) !== shadowHash(action.payload.request))
        fail("STANDARD_ENTRY_ACTION_CHANGED");
    } else if (!["operation", "question_recovery", "operation_disposition"].includes(action.kind)
      && shadowHash(await currentKind()) !== shadowHash({ kind: action.kind, payload: action.payload })) fail("STANDARD_ENTRY_ACTION_CHANGED");
    if (["operation", "question_recovery", "operation_disposition"].includes(action.kind) && (decisionSource || controlSource || observation || !state
      || (action.payload.preview ?? action.payload.recovery_plan ?? action.payload.disposition_plan)?.instance_sha256 !== state.record.instance_sha256))
      fail("STANDARD_ENTRY_ACTION_CHANGED");
  } else {
    const next = await currentKind();
    action = { contract_version: next.kind === "call" ? callActionSchema["x-aidn-contract-version"]
      : isStandardNativeEntryKind(next.kind) ? standardNativeEntryActionVersionFor(next) : "standard-workflow-action.v1", context, ...next };
    if (next.kind === "call" && validateJsonSchema(action, callActionSchema, "$", { contractKind: "workflow-definition" }).length)
      fail("STANDARD_ENTRY_ACTION_INVALID");
  }
  const payloadKeys = { prepare_host: [], initialize: ["instance_sha256"], operation: ["preview"], decision: ["operation_id", "question", "source_ref"],
    question_recovery: ["recovery_plan"], operation_disposition: ["disposition_plan"],
    native_owner_retire: ["plan"], native_allocation_reconcile: ["preparation", "source_ref"], native_authorization_epoch: ["request", "source_ref"],
    operation_disposition_accept: ["operation_id", "journal_sha256", "receipt_sha256"], control: ["request", "source_ref"], native: ["authorization_sha256"], observe: ["status", "reason"], replay: [], simulate: [],
    call: ["transition", "occurrence_id", "event_id", "result_sha256", "instance_id", "model_sha256"] };
  if (action.kind === "control" && action.payload.source_ref === externalMergeControlRef)
    payloadKeys.control = ["request", "source_ref", "merge_subject_sha256"];
  if (action.kind === "dispatch") payloadKeys.dispatch = Object.hasOwn(action.payload, "question") ? ["operation_id", "journal_sha256", "question"] : ["operation_id", "journal_sha256"];
  if (Object.keys(action.payload).sort().join(",") !== payloadKeys[action.kind].sort().join(",")) fail("STANDARD_ENTRY_ACTION_INVALID");
  const output = { preview: action, action_sha256: shadowHash(action), can_apply: !["observe", "replay", "simulate"].includes(action.kind) && (action.kind !== "native" || authorization !== null), written: false, result: null,
    requirements: action.kind === "native" && !authorization ? ["EXPLICIT_EXECUTION_AUTHORIZATION_REQUIRED"] : [] };
  if (isStandardNativeEntryAction(action)) {
    assertStandardNativeEntryAction(action, state, authority);
    output.requirements.push(...standardNativeEntryRequirements(action, nativeSources));
    output.can_apply = output.requirements.length === 0;
  }
  if (action.kind === "dispatch" && action.payload.question) {
    output.can_apply = false;
    output.requirements.push("AUTHENTICATED_HUMAN_DECISION_REQUIRED");
  }
  if (action.kind === "replay" || action.kind === "simulate") {
    const record = state.record;
    let last;
    for (const row of iterateAgenticProcessSimulation({ instanceId: record.instance_id, model: record.model, policyPins: record.policy_pins,
      scopeId: record.scope_id, parameters: record.initial_parameters, facts: record.initial_facts, events: record.events })) last = row;
    if (last.instance_sha256 !== record.instance_sha256) fail("STANDARD_ENTRY_REPLAY_CHANGED");
    output.result = { status: record.status, instance_sha256: last.instance_sha256, cursor: last.cursor, evidence_kind: "synthetic", native_started: false, written: false };
  }
  if (!execute) return output;
  if (!output.can_apply) fail("STANDARD_ENTRY_NO_EFFECT_AVAILABLE");
  if (signal?.aborted) fail("STANDARD_ENTRY_ABORTED");
  if (isStandardNativeEntryAction(action)) {
    const subject = action.payload.plan ?? action.payload.preparation?.request ?? action.payload.request;
    permittedNative = { action: action.kind, scope_id: state.record.scope_id, instance_sha256: state.record.instance_sha256,
      subject_sha256: shadowHash(subject), action_sha256: expectPlan, key_id: context.key_id, trust_sha256: context.trust_sha256 };
    const details = await applyStandardNativeEntryAction(host, action, signal);
    output.result = standardNativeEntryResult(host, action, details);
    output.written = output.result.written; output.can_apply = false;
    return output;
  } else if (action.kind === "prepare_host") {
    authority.ensureKey();
    output.result = { status: "HOST_READY", key_id: authority.keyId(), instance_created: false, native_started: false };
    output.written = true;
  } else if (action.kind === "initialize") {
    if (authority.githubProvider) {
      await authority.githubProvider.verifyIdentity(signal);
      if (authority.keyId() !== context.key_id || authority.trustSha() !== context.trust_sha256) fail("STANDARD_ENTRY_PRECONDITIONS_CHANGED");
    }
    output.result = host.initialize({ parameters, write: true, expectedResultSha256: action.payload.instance_sha256 });
    output.written = true;
  } else if (action.kind === "operation" || action.kind === "dispatch" || action.kind === "decision") {
    const preview = action.kind === "operation" ? action.payload.preview : host.readOperation(action.payload.operation_id).preview;
    permittedOperation = shadowHash(preview);
    let id = action.payload.operation_id;
    const beforeJournal = id ? shadowHash(host.readOperation(id)) : null;
    if (action.kind === "operation") id = (await host.stageOperation(preview, { write: true, expectedPreviewSha256: permittedOperation })).operation_id;
    const retainedCheckpoint = action.kind === "dispatch" ? host.readOperation(id) : null;
    const checkpointReceipt = retainedCheckpoint?.results.at(-1)?.receipt;
    const recoverCheckpoint = retainedCheckpoint?.intent.binding_ref === "session_pr_correction_checkpoint"
      && (retainedCheckpoint.phase === "dispatching" && retainedCheckpoint.results.length === 0 || retainedCheckpoint.phase === "receipted"
        && checkpointReceipt?.outcome === "reconciliation_required" && checkpointReceipt.effect_status === "unknown");
    const result = action.kind === "decision" ? await host.receiveDecision(id, { sourceRef: action.payload.source_ref, write: true, signal })
      : recoverCheckpoint ? await host.reconcileCorrectionCheckpoint(id, { write: true, signal })
      : await host.dispatchOperation(id, { write: true, signal });
    output.result = ["receipted", "retained_result"].includes(result.status) ? { ...result, accepted: await host.acceptOperation(id, { write: true, signal }) } : result;
    output.written = beforeJournal !== shadowHash(host.readOperation(id)) || host.inspect().record.instance_sha256 !== state.record.instance_sha256;
  } else if (action.kind === "question_recovery") {
    const plan = action.payload.recovery_plan;
    permittedOperation = shadowHash(plan);
    const result = await host.applyQuestionRecovery(plan, { write: true, expectedPlanSha256: permittedOperation, signal });
    output.result = { ...result, accepted: await host.acceptOperation(plan.operation_id, { write: true, signal }) };
    output.written = true;
  } else if (action.kind === "operation_disposition" || action.kind === "operation_disposition_accept") {
    if (!dispositionSource) fail("STANDARD_ENTRY_DISPOSITION_AUTHORITY_REQUIRED");
    const plan = action.payload.disposition_plan;
    if (action.kind === "operation_disposition" && !["confirmed_reopen", "known_partial_incident_close", "known_partial_handoff_publication", "known_before_effect_handoff_publication"].includes(plan?.assessment)) fail("STANDARD_ENTRY_DISPOSITION_PLAN_REQUIRED");
    permittedDisposition = { action: action.kind, scope_id: state.record.scope_id, instance_sha256: state.record.instance_sha256,
      subject_sha256: plan ? shadowHash(plan) : action.payload.receipt_sha256, action_sha256: expectPlan,
      key_id: context.key_id, trust_sha256: context.trust_sha256 };
    if (plan) {
      const result = await host.applyOperationDisposition(plan, { write: true, expectedPlanSha256: permittedDisposition.subject_sha256, signal });
      output.result = result; output.written = result.written;
    } else {
      const id = action.payload.operation_id, record = host.readOperation(id), receipt = record.results.at(-1)?.receipt;
      if (!receipt || shadowHash(record) !== action.payload.journal_sha256 || shadowHash(receipt) !== action.payload.receipt_sha256)
        fail("STANDARD_ENTRY_DISPOSITION_RECEIPT_CHANGED");
      const accepted = await host.acceptOperation(id, { write: true, receiptId: receipt.receipt_id, signal });
      output.result = { receipt, accepted };
      output.written = accepted.written === true || accepted.record.instance_sha256 !== state.record.instance_sha256;
    }
  } else if (action.kind === "control") {
    const result = await host.captureControl({ expectedSha256: state.record.instance_sha256, occurrenceId: action.payload.request.occurrence_id,
      sourceRef: action.payload.source_ref, expectedSubjectSha256: action.payload.merge_subject_sha256, write: true, signal });
    output.result = result.status === "reserved" ? await host.deliverControl(result.inbox_id, { write: true }) : result;
    output.written = result.status === "reserved";
  } else if (action.kind === "call") {
    if (authority.keyId() !== context.key_id || authority.trustSha() !== context.trust_sha256) fail("STANDARD_ENTRY_PRECONDITIONS_CHANGED");
    const changed = await host.applyCall(action.payload, { write: true, expectedSha256: context.instance_sha256 });
    output.written = changed.written;
    output.can_apply = false;
    output.result = { contract_version: callResultSchema["x-aidn-contract-version"], action_kind: "call",
      process_status: changed.cursor.status, workflow_completed: changed.cursor.status === "COMPLETED",
      operation_outcome: null, effect_status: null, written: output.written, native_started: false,
      details: { ...action.payload, projection: changed.projection ?? null } };
    if (validateJsonSchema(output.result, callResultSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_ENTRY_RESULT_INVALID");
    return output;
  } else if (action.kind === "native") {
    if (!authorization || shadowHash(authorization) !== action.payload.authorization_sha256) fail("STANDARD_ENTRY_NATIVE_AUTHORIZATION_REQUIRED");
    output.result = await host.step({ write: true, authorization, signal, expectedInstanceSha256: context.instance_sha256 }); output.written = true;
  }
  output.can_apply = false;
  const failedAllocation = action.kind === "native" && output.result.status === "FAILED" && output.result.journal_phase === "failed";
  let current = null;
  if (action.kind !== "prepare_host") {
    try { current = host.inspect(); }
    catch (cause) {
      if (!failedAllocation || cause.code !== "STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE") throw cause;

      // Return the failed action's evidence through the read-only authenticated
      // cursor. The ordinary execution exclusion still guards the next action.
      current = host.inspectDiagnostic();
      const journal = current.native.journal;
      const allocation = journal?.allocations.at(-1);
      if (allocation?.phase !== "failed" || allocation.tree_closed !== true
        || allocation.generation !== output.result.generation || journal.journal_id !== output.result.journal_id
        || shadowHash(journal) !== output.result.journal_sha256) throw cause;
    }
  }
  const receipt = output.result?.receipt ?? null;
  const outcome = receipt?.outcome ?? null;
  // A successfully processed command is distinct from the workflow's state.
  // Waiting/refusal/defer/cancel/UNKNOWN never become a completed workflow.
  output.result = { contract_version: "standard-workflow-entry-result.v1", action_kind: action.kind,
    process_status: current?.cursor.status ?? null, workflow_completed: !failedAllocation && current?.cursor.status === "COMPLETED",
    operation_outcome: outcome, effect_status: receipt?.effect_status ?? null, written: output.written,
    native_started: action.kind === "native" ? null : false, details: output.result };
  if (validateJsonSchema(output.result, resultSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_ENTRY_RESULT_INVALID");
  return output;
}
