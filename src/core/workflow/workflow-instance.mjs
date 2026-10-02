import schema from "../contracts/workflow-definition/workflow-instance.v1.schema.json" with { type: "json" };
import compilationSchema from "../contracts/workflow-definition/workflow-compilation.v1.schema.json" with { type: "json" };
import definitionSchema from "../contracts/workflow-definition/workflow-definition.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { compileShadowWorkflow } from "./workflow-shadow-compiler.mjs";
import { previewWorkflowSegment } from "./workflow-segment-binding.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";

export const workflowInstanceFail = code => { throw Object.assign(new Error(code), { code }); };
const fail = workflowInstanceFail;
const copy = value => structuredClone(value);
const content = ({ instance_sha256, ...value }) => value;
const supported = step => ["approval", "review", "agent_segment", "terminal"].includes(step.primitive_ref);
const valid = (value, contract) => validateJsonSchema(value, contract, "$", { contractKind: "workflow-definition" }).length === 0;

function seal(value) {
  const instance = { ...value, instance_sha256: shadowHash(value) };
  assertWorkflowInstance(instance);
  return freezeShadow(instance);
}

export function createWorkflowInstance({ instanceId, definition, context, scope }) {
  if (checkShadowJson({ instanceId, definition, context, scope })) fail("WORKFLOW_INSTANCE_INVALID");
  const result = compileShadowWorkflow(definition, context);
  if (!result.ok) fail("WORKFLOW_INSTANCE_COMPILATION_INVALID");
  return seal({ contract_version: "workflow-instance.v1", instance_id: instanceId, revision: 1,
    definition: copy(definition), compilation: copy(result.compilation), scope: copy(scope), events: [] });
}

// Replay retained typed events only. No compiler, runtime, clock or effects.
function replay(instance) {
  const graph = instance.compilation;
  let step = graph.steps.find(row => row.id === graph.entry), pending = null;
  const traversals = new Map(), runs = new Set();
  for (const event of instance.events) {
    if (!step || !supported(step) || event.step_id !== step.id || step.kind === "terminal") fail("WORKFLOW_INSTANCE_HISTORY_INVALID");
    if (event.kind === "segment_intent") {
      if (pending || step.kind !== "agent_segment" || runs.has(event.run_id)) fail("WORKFLOW_INSTANCE_RUN_REUSED");
      pending = event; runs.add(event.run_id); continue;
    }
    if (event.kind === "human") {
      if (pending || step.kind !== "human_decision") fail("WORKFLOW_INSTANCE_DECISION_INVALID");
    } else {
      if (!pending || pending.run_id !== event.run_id || event.status.run_id !== pending.run_id
        || event.status.plan_sha256 !== pending.plan_sha256 || shadowHash(event.status) !== event.status_sha256
        || workflowSegmentOutcome(event.status) !== event.outcome) fail("WORKFLOW_INSTANCE_RESULT_INVALID");
      pending = null;
    }
    const edge = graph.transitions.find(row => row.from === step.id && row.outcome === event.outcome);
    if (!edge) fail("WORKFLOW_INSTANCE_OUTCOME_INVALID");
    const count = traversals.get(edge.id) ?? 0;
    const next = edge.max_traversals !== undefined && count >= edge.max_traversals ? edge.on_exhausted : edge.to;
    traversals.set(edge.id, count + 1);
    step = graph.steps.find(row => row.id === next);
  }
  if (!step) fail("WORKFLOW_INSTANCE_HISTORY_INVALID");
  return { step_id: step.id, kind: step.kind, primitive_ref: step.primitive_ref,
    status: pending ? "reconciliation_required" : step.kind === "terminal" ? "terminal" : supported(step) ? "waiting" : "handler_unavailable",
    terminal_result: step.terminal_result ?? null, pending: pending ? copy(pending) : null,
    traversals: Object.fromEntries(traversals) };
}

export function assertWorkflowInstance(instance) {
  if (checkShadowJson(instance) || !valid(instance, schema) || !valid(instance.definition, definitionSchema)
    || !valid(instance.compilation, compilationSchema)) fail("WORKFLOW_INSTANCE_INVALID");
  const { compilation_sha256, ...compiled } = instance.compilation;
  if (shadowHash(content(instance)) !== instance.instance_sha256 || shadowHash(compiled) !== compilation_sha256
    || instance.revision !== instance.events.length + 1) fail("WORKFLOW_INSTANCE_CHANGED");
  replay(instance);
  return instance;
}

export function inspectWorkflowInstance(instance) { assertWorkflowInstance(instance); return freezeShadow(replay(instance)); }

export function assertCurrentWorkflowCompilation(instance) {
  assertWorkflowInstance(instance);
  const result = compileShadowWorkflow(instance.definition, instance.compilation.context);
  if (!result.ok || result.compilation.compilation_sha256 !== instance.compilation.compilation_sha256) fail("WORKFLOW_INSTANCE_COMPILATION_CHANGED");
}

function append(instance, event, { productive = true } = {}) {
  assertWorkflowInstance(instance);
  if (productive) assertCurrentWorkflowCompilation(instance);
  if (checkShadowJson(event)) fail("WORKFLOW_INSTANCE_EVENT_INVALID");
  return seal({ ...content(instance), revision: instance.revision + 1, events: [...instance.events, copy(event)] });
}

export function decideWorkflowInstance(instance, { outcome, evidence }) {
  const cursor = inspectWorkflowInstance(instance);
  if (cursor.status === "handler_unavailable") fail("WORKFLOW_INSTANCE_HANDLER_UNAVAILABLE");
  return append(instance, { kind: "human", step_id: cursor.step_id, outcome, evidence });
}

export function prepareWorkflowInstanceSegment(instance, { plan, configuration, configurationPath, planPath }) {
  const cursor = inspectWorkflowInstance(instance);
  if (cursor.status !== "waiting" || cursor.kind !== "agent_segment") fail("WORKFLOW_INSTANCE_SEGMENT_NOT_READY");
  if (configuration?.contract_version !== "agent-run-configuration.v2") fail("WORKFLOW_INSTANCE_BINDING_REQUIRED");
  const binding = previewWorkflowSegment(configuration.workflow, plan);
  if (plan.supervision?.configuration_sha256 !== shadowHash(configuration)) fail("WORKFLOW_INSTANCE_CONFIGURATION_CHANGED");
  if (plan.canonical.runtime_scope_id !== instance.scope.runtime_scope_id
    || shadowHash(plan.canonical.activation) !== shadowHash(instance.scope.activation)) fail("WORKFLOW_INSTANCE_CANONICAL_CHANGED");
  if (binding.step_id !== cursor.step_id || binding.compilation_sha256 !== instance.compilation.compilation_sha256)
    fail("WORKFLOW_INSTANCE_BINDING_CHANGED");
  return append(instance, { kind: "segment_intent", step_id: cursor.step_id, run_id: configuration.run_id,
    plan_sha256: binding.plan_sha256, configuration_sha256: shadowHash(configuration), binding_sha256: binding.binding_sha256,
    configuration_path: configurationPath, plan_path: planPath });
}

// Execution, acceptance, integration, validation and cleanup remain distinct.
// A successful macro edge requires the supervisor's accepted, integrated proof.
export function workflowSegmentOutcome(status) {
  if (["failed", "cancelled"].includes(status?.execution_status)) return "failed";
  if (status?.execution_status === "completed" && status.validation?.status === "passed"
    && status.validation.sha === status.integration?.sha && status.integration?.pending === 0
    && status.validation.evidence_sha256 && status.attempts?.length
    && status.attempts.every(row => status.attempts.some(other => other.task_id === row.task_id && other.acceptance === "accepted"))) return "completed";
  fail("WORKFLOW_INSTANCE_RECONCILIATION_REQUIRED");
}

export function reconcileWorkflowInstanceSegment(instance, status) {
  const cursor = inspectWorkflowInstance(instance);
  if (!cursor.pending) fail("WORKFLOW_INSTANCE_NO_PENDING_SEGMENT");
  return append(instance, { kind: "segment_result", step_id: cursor.step_id, run_id: cursor.pending.run_id,
    outcome: workflowSegmentOutcome(status), status: copy(status), status_sha256: shadowHash(status) }, { productive: false });
}
