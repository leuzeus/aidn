import bindingSchema from "../contracts/workflow-definition/workflow-segment-binding.v1.schema.json" with { type: "json" };
import definitionSchema from "../contracts/workflow-definition/workflow-definition.v1.schema.json" with { type: "json" };
import contextSchema from "../contracts/workflow-definition/workflow-shadow-context.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { normalizeAgentExecutionPlan, fingerprintAgentExecutionValue } from "../agents/agent-execution-contracts.mjs";
import { compileShadowWorkflow } from "./workflow-shadow-compiler.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const profile = { contractKind: "workflow-definition" };
const valid = (value, schema) => validateJsonSchema(value, schema, "$", profile).length === 0;
const content = ({ binding_sha256, ...rest }) => rest;

// A run-local selection, not a macro cursor or an admission. All inputs are
// explicit; this module cannot read a project, reserve a run or invoke a handler.
export function bindWorkflowSegment({ definition, context, stepId, canonical, revision = 1 }) {
  if (!Number.isSafeInteger(revision) || revision < 1) fail("WORKFLOW_SEGMENT_BINDING_INVALID");
  const result = compileShadowWorkflow(definition, context);
  if (!result.ok) fail("WORKFLOW_SEGMENT_COMPILATION_INVALID");
  const compiled = result.compilation;
  if (!compiled.steps.some(step => step.id === stepId && step.kind === "agent_segment")) fail("WORKFLOW_SEGMENT_STEP_INVALID");
  const value = {
    contract_version: "workflow-segment-binding.v1", selection: "explicit_segment", revision,
    definition: structuredClone(definition), context: structuredClone(context), step_id: stepId,
    canonical_sha256: fingerprintAgentExecutionValue(canonical),
    definition_sha256: compiled.definition.sha256, compilation_sha256: compiled.compilation_sha256,
    compiler_version: compiled.compiler_version, registry: structuredClone(compiled.registry),
  };
  const binding = { ...value, binding_sha256: shadowHash(value) };
  assertWorkflowSegmentBinding(binding);
  return freezeShadow(binding);
}

// Historical status/cancel/cleanup must remain possible with retained evidence,
// even after compiler/registry updates. Structural and content pins still apply.
export function assertWorkflowSegmentBinding(binding) {
  if (checkShadowJson(binding) || !valid(binding, bindingSchema)
    || !valid(binding.definition, definitionSchema) || !valid(binding.context, contextSchema)) fail("WORKFLOW_SEGMENT_BINDING_INVALID");
  if (shadowHash(content(binding)) !== binding.binding_sha256) fail("WORKFLOW_SEGMENT_BINDING_CHANGED");
  const selected = binding.definition.steps.filter(step => step.id === binding.step_id);
  if (selected.length !== 1 || selected[0].kind !== "agent_segment") fail("WORKFLOW_SEGMENT_STEP_INVALID");
  return binding;
}

export function requiresWorkflowSegmentCompilation(command, snapshot) {
  return command === "agent-run" || command === "agent-run-resume" && !snapshot?.cancel_request;
}

export function previewWorkflowSegment(binding, inputPlan, { compile = true } = {}) {
  assertWorkflowSegmentBinding(binding);
  // Reuse the existing scope, DAG, limits and fingerprint authority unchanged.
  const plan = normalizeAgentExecutionPlan(inputPlan);
  if (fingerprintAgentExecutionValue(plan.canonical) !== binding.canonical_sha256) fail("WORKFLOW_SEGMENT_CANONICAL_CHANGED");
  if (compile) {
    const result = compileShadowWorkflow(binding.definition, binding.context);
    if (!result.ok) fail("WORKFLOW_SEGMENT_COMPILATION_INVALID");
    const current = result.compilation;
    if (current.compilation_sha256 !== binding.compilation_sha256 || current.definition.sha256 !== binding.definition_sha256
      || current.compiler_version !== binding.compiler_version || shadowHash(current.registry) !== shadowHash(binding.registry)) fail("WORKFLOW_SEGMENT_COMPILATION_CHANGED");
  }
  return freezeShadow({
    contract_version: "workflow-segment-selection.v1", selection: "explicit_segment",
    binding_sha256: binding.binding_sha256, binding_revision: binding.revision,
    definition: { workflow_id: binding.definition.workflow_id, revision: binding.definition.revision, sha256: binding.definition_sha256 },
    compiler_version: binding.compiler_version, registry: structuredClone(binding.registry),
    context_sha256: shadowHash(binding.context), compilation_sha256: binding.compilation_sha256,
    canonical_sha256: binding.canonical_sha256, step_id: binding.step_id, plan_sha256: plan.plan_sha256,
    validation: compile ? "compiled" : "retained", macro_progress: "not_evaluated",
    authority: "existing_agent_run_admission",
  });
}
