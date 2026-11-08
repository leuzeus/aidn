import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadStandardWorkflowAssets, createStandardWorkflowExecution, STANDARD_WORKFLOW_MODEL_PATH } from "./standard-workflow-composition.mjs";
import { createStandardHostAuthority } from "../../adapters/runtime/standard-host-authority.mjs";
import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { agenticProcessImplementationPins } from "./agentic-process-implementation-pins.mjs";
import { iterateAgenticProcessSimulation } from "../../core/workflow/agentic-process-simulation.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { processFrameNode } from "../../core/workflow/process-call-model.mjs";
import { externalMergeControlRef } from "../../core/workflow/standard-pr-external-merge.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import requestSchema from "../../core/contracts/workflow-definition/standard-workflow-execution.v1.schema.json" with { type: "json" };
import actionSchema from "../../core/contracts/workflow-definition/standard-workflow-action.v1.schema.json" with { type: "json" };
import resultSchema from "../../core/contracts/workflow-definition/standard-workflow-entry-result.v1.schema.json" with { type: "json" };
import callActionSchema from "../../core/contracts/workflow-definition/standard-workflow-call-action.v1.schema.json" with { type: "json" };
import callResultSchema from "../../core/contracts/workflow-definition/standard-workflow-call-result.v1.schema.json" with { type: "json" };

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
  const assets = loadStandardWorkflowAssets();
  const execution = structuredClone(request.execution);
  if (["model", "skills", "activity_outputs", "implementation_sha256", "control_scenario"].some(key => Object.hasOwn(execution, key))) fail("STANDARD_ENTRY_HOST_FIELD_FORBIDDEN");
  const skills = Object.fromEntries([...new Set(assets.catalog.activities.flatMap(row => row.skill_sources.map(source => source.path)))].map(name =>
    [name.match(/aidn-([^/]+)\/SKILL[.]md$/)[1], pin(path.join(packageRoot, name))]));
  const configuration = { ...execution, instructions: execution.instructions ?? {}, contract_version: "agentic-process-execution.v1", model: pin(path.join(packageRoot, STANDARD_WORKFLOW_MODEL_PATH)), skills,
    activity_outputs: Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, row.output_contract])),
    implementation_sha256: agenticProcessImplementationPins().sha256 };
  return { configuration, parameters: structuredClone(request.parameters), modelSource: assets.source, validationProfile: request.validation_profile ?? null };
}

export async function runStandardWorkflowEntry({ request, actionFile = null, preparedAction = null, decisionSource = null, controlSource = null, observation = null,
  authorization = null, execute = false, expectPlan = null, environment = process.env, signal } = {}, { providerTransport } = {}) {
  const resolved = resolveStandardWorkflowConfiguration(request), { configuration, parameters, modelSource, validationProfile } = resolved;
  const authority = createStandardHostAuthority({ configuration, environment }, { providerTransport, useProvider: observation === null });
  const provider = authority.githubProvider;
  const compose = authorize => createStandardWorkflowExecution({ configuration, readSigningKey: () => authority.keyId() === null ? Buffer.alloc(32) : authority.readKey(),
    authorize, environment, validationProfile, humanSource: authority.humanSource, controlSource: authority.controlSource,
    nativeAuthorizationSource: authority.nativeAuthorizationSource,
    sessionPushPort: provider?.sessionPushPort, sessionPullRequestPort: provider?.sessionPullRequestPort,
    sessionReviewPort: provider?.sessionReviewPort, sessionReviewEventPort: provider?.sessionReviewEventPort });
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
    candidate?.contract_version === callActionSchema["x-aidn-contract-version"] ? callActionSchema : actionSchema,
    "$", { contractKind: "workflow-definition" }).length)) fail("STANDARD_ENTRY_ACTION_INVALID");
  const supplied = candidate === null ? null : structuredClone(candidate);
  if (execute && (!supplied || expectPlan !== shadowHash(supplied))) fail("STANDARD_ENTRY_EXACT_ACTION_REQUIRED");
  let permittedOperation = null;
  const host = compose(input => authority.authorizeOperation(input, permittedOperation));
  let state = null;
  try { state = host.inspect(); } catch (cause) { if (cause.code !== "PROCESS_INSTANCE_NOT_FOUND") throw cause; }
  const initial = state ? null : host.initialize({ parameters });
  if (!state && (decisionSource || controlSource || observation)) fail("STANDARD_ENTRY_INSTANCE_REQUIRED");
  if (state && authority.keyId() === null) fail("STANDARD_HOST_RETAINED_KEY_REQUIRED");
  if (state && shadowHash(state.record.initial_parameters ?? {}) !== shadowHash(parameters)) fail("STANDARD_ENTRY_PARAMETERS_CHANGED");
  const context = { request_sha256: shadowHash(request), configuration_sha256: shadowHash(configuration), model_source_sha256: shadowHash(modelSource),
    instance_sha256: state?.record.instance_sha256 ?? null, native: host.previewNative(), key_id: authority.keyId(), trust_sha256: authority.trustSha() };
  const currentKind = async () => {
    if (authority.keyId() === null) return { kind: "prepare_host", payload: {} };
    if (!state) return { kind: "initialize", payload: { instance_sha256: initial.record.instance_sha256 } };
    if (observation) return { kind: observation, payload: {} };
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
    const next = await host.step({ write: false, expectedInstanceSha256: state.record.instance_sha256, decisionSelected: decisionSource !== null, signal });
    if (decisionSource) {
      if (next.kind !== "human_wait") fail("STANDARD_ENTRY_HUMAN_WAIT_REQUIRED");
      return { kind: "decision", payload: { operation_id: next.operation_id, question: host.prepareDecision(next.operation_id), source_ref: decisionSource } };
    }
    if (next.kind === "call") return { kind: "call", payload: { ...next.transition, instance_id: state.record.instance_id,
      model_sha256: state.record.model_sha256 } };
    if (next.kind === "question_recovery") return { kind: "question_recovery", payload: { recovery_plan: next.plan } };
    if (next.kind === "operation_preview") return { kind: "operation", payload: { preview: next.preview } };
    if (["human_wait", "operation_wait"].includes(next.kind)) return { kind: "dispatch", payload: { operation_id: next.operation_id,
      journal_sha256: shadowHash(host.readOperation(next.operation_id)), ...(next.kind === "human_wait" ? { question: host.prepareDecision(next.operation_id) } : {}) } };
    if (next.kind === "native_preview") return { kind: "native", payload: { authorization_sha256: authorization ? shadowHash(authorization) : null } };
    return { kind: "observe", payload: { status: next.status, reason: next.kind } };
  };
  let action;
  if (supplied) {
    if (shadowHash(supplied.context) !== shadowHash(context)) fail("STANDARD_ENTRY_PRECONDITIONS_CHANGED");
    action = supplied;
    // Stage revalidates the original exact prepared plan, age, bindings, CAS,
    // live snapshot and resolved data. Do not regenerate its timestamps.
    const applyExternalMerge = execute && action.kind === "control" && action.payload.source_ref === externalMergeControlRef;
    if (applyExternalMerge) {
      if (controlSource !== externalMergeControlRef || !state
        || shadowHash(host.prepareControl({ expectedSha256: state.record.instance_sha256,
          occurrenceId: standardWorkflowControlOccurrence(state) })) !== shadowHash(action.payload.request))
        fail("STANDARD_ENTRY_ACTION_CHANGED");
    } else if (!["operation", "question_recovery"].includes(action.kind)
      && shadowHash(await currentKind()) !== shadowHash({ kind: action.kind, payload: action.payload })) fail("STANDARD_ENTRY_ACTION_CHANGED");
    if (["operation", "question_recovery"].includes(action.kind) && (decisionSource || controlSource || observation || !state
      || (action.payload.preview ?? action.payload.recovery_plan)?.instance_sha256 !== state.record.instance_sha256))
      fail("STANDARD_ENTRY_ACTION_CHANGED");
  } else {
    const next = await currentKind();
    action = { contract_version: next.kind === "call" ? callActionSchema["x-aidn-contract-version"] : "standard-workflow-action.v1", context, ...next };
    if (next.kind === "call" && validateJsonSchema(action, callActionSchema, "$", { contractKind: "workflow-definition" }).length)
      fail("STANDARD_ENTRY_ACTION_INVALID");
  }
  const payloadKeys = { prepare_host: [], initialize: ["instance_sha256"], operation: ["preview"], decision: ["operation_id", "question", "source_ref"],
    question_recovery: ["recovery_plan"], control: ["request", "source_ref"], native: ["authorization_sha256"], observe: ["status", "reason"], replay: [], simulate: [],
    call: ["transition", "occurrence_id", "event_id", "result_sha256", "instance_id", "model_sha256"] };
  if (action.kind === "control" && action.payload.source_ref === externalMergeControlRef)
    payloadKeys.control = ["request", "source_ref", "merge_subject_sha256"];
  if (action.kind === "dispatch") payloadKeys.dispatch = Object.hasOwn(action.payload, "question") ? ["operation_id", "journal_sha256", "question"] : ["operation_id", "journal_sha256"];
  if (Object.keys(action.payload).sort().join(",") !== payloadKeys[action.kind].sort().join(",")) fail("STANDARD_ENTRY_ACTION_INVALID");
  const output = { preview: action, action_sha256: shadowHash(action), can_apply: !["observe", "replay", "simulate"].includes(action.kind) && (action.kind !== "native" || authorization !== null), written: false, result: null,
    requirements: action.kind === "native" && !authorization ? ["EXPLICIT_EXECUTION_AUTHORIZATION_REQUIRED"] : [] };
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
  if (action.kind === "prepare_host") {
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
    const result = action.kind === "decision" ? await host.receiveDecision(id, { sourceRef: action.payload.source_ref, write: true, signal })
      : await host.dispatchOperation(id, { write: true, signal });
    output.result = ["receipted", "retained_result"].includes(result.status) ? { ...result, accepted: await host.acceptOperation(id, { write: true, signal }) } : result;
    output.written = beforeJournal !== shadowHash(host.readOperation(id)) || host.inspect().record.instance_sha256 !== state.record.instance_sha256;
  } else if (action.kind === "question_recovery") {
    const plan = action.payload.recovery_plan;
    permittedOperation = shadowHash(plan);
    const result = await host.applyQuestionRecovery(plan, { write: true, expectedPlanSha256: permittedOperation, signal });
    output.result = { ...result, accepted: await host.acceptOperation(plan.operation_id, { write: true, signal }) };
    output.written = true;
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
  const current = action.kind === "prepare_host" ? null : host.inspect();
  const receipt = output.result?.receipt ?? null;
  const outcome = receipt?.outcome ?? null;
  // A successfully processed command is distinct from the workflow's state.
  // Waiting/refusal/defer/cancel/UNKNOWN never become a completed workflow.
  output.result = { contract_version: "standard-workflow-entry-result.v1", action_kind: action.kind,
    process_status: current?.cursor.status ?? null, workflow_completed: current?.cursor.status === "COMPLETED",
    operation_outcome: outcome, effect_status: receipt?.effect_status ?? null, written: output.written,
    native_started: action.kind === "native" ? null : false, details: output.result };
  if (validateJsonSchema(output.result, resultSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_ENTRY_RESULT_INVALID");
  return output;
}
