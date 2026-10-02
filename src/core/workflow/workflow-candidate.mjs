import candidateSchema from "../contracts/workflow-definition/workflow-candidate.v1.schema.json" with { type: "json" };
import previewSchema from "../contracts/workflow-definition/workflow-candidate-preview.v1.schema.json" with { type: "json" };
import projectionSchema from "../contracts/workflow-definition/workflow-projection.v1.schema.json" with { type: "json" };
import compilationSchema from "../contracts/workflow-definition/workflow-compilation.v1.schema.json" with { type: "json" };
import definitionSchema from "../contracts/workflow-definition/workflow-definition.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { compileShadowWorkflow } from "./workflow-shadow-compiler.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";
import { isWorkflowInstanceStepSupported, workflowInstanceFail as fail } from "./workflow-instance.mjs";

const profile = { contractKind: "workflow-definition" };
const valid = (value, schema) => validateJsonSchema(value, schema, "$", profile).length === 0;
const copy = value => structuredClone(value);
const seal = value => freezeShadow({ ...value, proposal_sha256: shadowHash(value) });
const effect = step => !["human_decision", "terminal"].includes(step.kind);
const control = step => step.kind === "human_decision" || step.admission_boundary;

function reachable(graph, start, { withoutNode = null, withoutEdge = null } = {}) {
  const seen = new Set(start === withoutNode ? [] : [start]);
  for (const id of seen) for (const edge of graph.transitions) {
    if (edge.from !== id || edge.id === withoutEdge) continue;
    for (const next of [edge.to, edge.on_exhausted].filter(Boolean)) if (next !== withoutNode) seen.add(next);
  }
  return seen;
}

// A conservative ceiling on declared capabilities and control paths. Actual
// filesystem/tool/network rights still come exclusively from existing admission.
function permissionChanges(base, next) {
  const reasons = [], add = (code, id) => reasons.push({ code, id });
  const oldSteps = new Map(base.steps.map(step => [step.id, step]));
  const newSteps = new Map(next.steps.map(step => [step.id, step]));
  for (const step of next.steps) {
    const old = oldSteps.get(step.id);
    if (!isWorkflowInstanceStepSupported(step)) add("HANDLER_UNAVAILABLE", step.id);
    if (effect(step) && (!old || old.primitive_ref !== step.primitive_ref)) add("CAPABILITY_ADDED", step.id);
    if (old && (old.kind !== step.kind || old.primitive_ref !== step.primitive_ref
      || shadowHash(old.rule_refs) !== shadowHash(step.rule_refs))) add("AUTHORITY_CHANGED", step.id);
  }
  for (const step of base.steps.filter(control)) if (!newSteps.has(step.id)) add("CONTROL_REMOVED", step.id);
  for (const edge of next.transitions.filter(edge => edge.max_traversals !== undefined)) {
    const old = base.transitions.find(item => item.id === edge.id);
    if (!old || old.max_traversals === undefined || edge.max_traversals > old.max_traversals
      || edge.from !== old.from || edge.to !== old.to || edge.on_exhausted !== old.on_exhausted) add("RETURN_CAPABILITY_EXTENDED", edge.id);
  }
  // Preserve prerequisite outcome edges that dominate each existing effect.
  for (const step of base.steps.filter(effect).filter(step => newSteps.has(step.id))) {
    for (const edge of base.transitions.filter(edge => control(oldSteps.get(edge.from)))) {
      if (reachable(base, base.entry, { withoutEdge: edge.id }).has(step.id)) continue;
      const current = next.transitions.find(item => item.id === edge.id);
      if (!current || current.from !== edge.from || current.outcome !== edge.outcome
        || reachable(next, next.entry, { withoutEdge: edge.id }).has(step.id)) add("PREREQUISITE_BYPASSED", edge.id);
    }
    // Preserve mandatory human checks after each individual effect outcome.
    for (const edge of base.transitions.filter(edge => edge.from === step.id)) {
      const current = next.transitions.find(item => item.from === step.id && item.outcome === edge.outcome);
      if (!current) continue;
      for (const gate of base.steps.filter(control)) {
        const oldReach = reachable(base, edge.to, { withoutNode: gate.id });
        if (base.steps.some(row => row.kind === "terminal" && oldReach.has(row.id))) continue;
        const newReach = reachable(next, current.to, { withoutNode: gate.id });
        if (next.steps.some(row => row.kind === "terminal" && newReach.has(row.id))) add("POSTCONDITION_BYPASSED", gate.id);
      }
    }
  }
  return [...new Map(reasons.map(reason => [reason.code + ":" + reason.id, reason])).values()]
    .sort((a, b) => a.code + a.id < b.code + b.id ? -1 : a.code + a.id > b.code + b.id ? 1 : 0);
}

function diff(before, after) {
  const old = new Map(before.map(row => [row.id, shadowHash(row)])), next = new Map(after.map(row => [row.id, shadowHash(row)]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().filter(id => old.get(id) !== next.get(id)).map(id => ({
    id, change: !old.has(id) ? "added" : !next.has(id) ? "removed" : "changed", before_sha256: old.get(id) ?? null, after_sha256: next.get(id) ?? null,
  }));
}

function build(base, definition, compilation, explanation) {
  if (base.definition.workflow_id !== definition.workflow_id || definition.revision !== base.definition.revision + 1)
    fail("WORKFLOW_CANDIDATE_REVISION_INVALID");
  if (compilation.definition.workflow_id !== definition.workflow_id || compilation.definition.revision !== definition.revision
    || shadowHash(base.context) !== shadowHash(compilation.context)) fail("WORKFLOW_CANDIDATE_CONTEXT_CHANGED");
  const reasons = permissionChanges(base, compilation);
  return seal({ contract_version: "workflow-candidate.v1", authority: "proposal", execution_available: false, written: false,
    workflow_id: definition.workflow_id, definition: copy(definition), compilation: copy(compilation), explanation,
    base: { definition_sha256: base.definition.sha256, compilation_sha256: base.compilation_sha256, revision: base.definition.revision },
    diff: { steps: diff(base.steps, compilation.steps), transitions: diff(base.transitions, compilation.transitions), entry_changed: base.entry !== compilation.entry },
    permissions: { within_ceiling: reasons.length === 0, reasons } });
}

export function proposeWorkflowCandidate({ baseDefinition, definition, context, explanation }) {
  if (checkShadowJson({ baseDefinition, definition, context, explanation }) || typeof explanation !== "string" || !explanation.trim()) fail("WORKFLOW_CANDIDATE_INPUT_INVALID");
  const base = compileShadowWorkflow(baseDefinition, context), next = compileShadowWorkflow(definition, context);
  if (!base.ok || !next.ok) fail("WORKFLOW_CANDIDATE_INVALID");
  const proposal = build(base.compilation, definition, next.compilation, explanation);
  assertWorkflowCandidate(proposal, base.compilation);
  return proposal;
}

// Retained history validation uses its retained baseline compilation. Fresh
// activation separately recompiles; historical reads never migrate a proposal.
export function assertWorkflowCandidate(proposal, baseCompilation) {
  if (checkShadowJson({ proposal, baseCompilation }) || !valid(proposal, candidateSchema)
    || !valid(proposal.definition, definitionSchema) || !valid(proposal.compilation, compilationSchema)
    || !valid(baseCompilation, compilationSchema)) fail("WORKFLOW_CANDIDATE_INVALID");
  const { compilation_sha256, ...compiled } = proposal.compilation;
  if (shadowHash(compiled) !== compilation_sha256 || shadowHash(build(baseCompilation, proposal.definition, proposal.compilation, proposal.explanation)) !== shadowHash(proposal))
    fail("WORKFLOW_CANDIDATE_CHANGED");
  return proposal;
}

export function renderWorkflowCandidate(proposal, baseCompilation) {
  assertWorkflowCandidate(proposal, baseCompilation);
  const graph = proposal.compilation;
  const markdown = ["# Workflow " + proposal.workflow_id, "", "Revision: " + proposal.definition.revision,
    "Compilation: " + graph.compilation_sha256, "Proposal: " + proposal.proposal_sha256, "",
    "| Step ID | Primitive | Kind |", "| --- | --- | --- |",
    ...graph.steps.map(step => `| ${step.id} | ${step.primitive_ref} | ${step.kind} |`), "",
    "| Transition ID | From | Outcome | To | Bound / exhausted |", "| --- | --- | --- | --- | --- |",
    ...graph.transitions.map(edge => `| ${edge.id} | ${edge.from} | ${edge.outcome} | ${edge.to} | ${edge.max_traversals ?? ""} ${edge.on_exhausted ?? ""} |`), ""].join("\n");
  // Prefix syntax identifiers to avoid Mermaid keywords such as `end`; labels
  // retain the exact compiler identities and no generated prose is interpolated.
  const mermaid = ["flowchart TD", ...graph.steps.map(step => `  step_${step.id}["${step.id}: ${step.primitive_ref}"]`),
    ...graph.transitions.flatMap(edge => [`  step_${edge.from} -->|"${edge.id}: ${edge.outcome}"| step_${edge.to}`,
      ...(edge.on_exhausted ? [`  step_${edge.from} -.->|"${edge.id}: exhausted ${edge.max_traversals}"| step_${edge.on_exhausted}`] : [])]), ""].join("\n");
  const projection = { contract_version: "workflow-projection.v1", renderer_version: "workflow-projection-renderer.v1",
    proposal_sha256: proposal.proposal_sha256, compilation_sha256: graph.compilation_sha256, markdown, mermaid };
  if (checkShadowJson(projection)) fail("WORKFLOW_PROJECTION_LIMIT");
  const result = { ...projection, projection_sha256: shadowHash(projection) };
  if (!valid(result, projectionSchema)) fail("WORKFLOW_PROJECTION_INVALID");
  return freezeShadow(result);
}

export function checkWorkflowProjection(proposal, baseCompilation, projection) {
  if (checkShadowJson(projection)) return false;
  return shadowHash(renderWorkflowCandidate(proposal, baseCompilation)) === shadowHash(projection);
}

export function previewWorkflowCandidate({ proposal, baseCompilation, baseline, scope, quiescent = true }) {
  if (checkShadowJson({ proposal, baseCompilation, baseline, scope })) fail("WORKFLOW_CANDIDATE_INPUT_INVALID");
  const projection = renderWorkflowCandidate(proposal, baseCompilation);
  const value = { contract_version: "workflow-candidate-preview.v1", written: false,
    proposal: copy(proposal), baseline: copy(baseline), scope: copy(scope), projection,
    quiescent, activation_eligible: quiescent && proposal.permissions.within_ceiling };
  const result = { ...value, preview_sha256: shadowHash(value) };
  if (!valid(result, previewSchema)) fail("WORKFLOW_CANDIDATE_PREVIEW_INVALID");
  return freezeShadow(result);
}
