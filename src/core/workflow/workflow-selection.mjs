import selectionSchema from "../contracts/workflow-definition/workflow-selection.v1.schema.json" with { type: "json" };
import definitionSchema from "../contracts/workflow-definition/workflow-definition.v1.schema.json" with { type: "json" };
import compilationSchema from "../contracts/workflow-definition/workflow-compilation.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash, freezeShadow } from "./shadow-json.mjs";
import { assertWorkflowCandidate, previewWorkflowCandidate } from "./workflow-candidate.mjs";
import { workflowInstanceFail as fail } from "./workflow-instance.mjs";

const valid = (value, schema) => validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length === 0;
const content = ({ selection_sha256, ...value }) => value;

export function assertWorkflowSelection(selection) {
  if (checkShadowJson(selection) || !valid(selection, selectionSchema) || !valid(selection.seed.definition, definitionSchema)
    || !valid(selection.seed.compilation, compilationSchema)) fail("WORKFLOW_SELECTION_INVALID");
  const { compilation_sha256, ...compiled } = selection.seed.compilation;
  if (shadowHash(content(selection)) !== selection.selection_sha256 || shadowHash(compiled) !== compilation_sha256
    || selection.revision !== selection.activations.length || selection.workflow_id !== selection.seed.definition.workflow_id) fail("WORKFLOW_SELECTION_CHANGED");
  let base = selection.seed.compilation;
  for (const [index, { proposal, review }] of selection.activations.entries()) {
    assertWorkflowCandidate(proposal, base);
    const prior = { ...content(selection), revision: index, activations: selection.activations.slice(0, index) };
    const baseline = index ? { kind: "selection", id: selection.workflow_id, sha256: shadowHash(prior) }
      : { kind: "instance", id: selection.seed.instance_id, sha256: selection.seed.instance_sha256 };
    const preview = previewWorkflowCandidate({ proposal, baseCompilation: base, baseline, scope: selection.scope });
    if (!proposal.permissions.within_ceiling || review.preview_sha256 !== preview.preview_sha256) fail("WORKFLOW_SELECTION_REVIEW_INVALID");
    base = proposal.compilation;
  }
  return selection;
}

export function activateWorkflowCandidate({ previous = null, seed, scope, proposal, review }) {
  if (previous) assertWorkflowSelection(previous);
  if (checkShadowJson({ seed, scope, proposal, review })) fail("WORKFLOW_SELECTION_INVALID");
  const value = previous ? content(previous) : { contract_version: "workflow-selection.v1", workflow_id: proposal.workflow_id,
    revision: 0, seed: structuredClone(seed), scope: structuredClone(scope), activations: [] };
  if (shadowHash(value.scope) !== shadowHash(scope)) fail("WORKFLOW_SELECTION_SCOPE_CHANGED");
  const next = { ...value, revision: value.revision + 1, activations: [...value.activations, { proposal: structuredClone(proposal), review: structuredClone(review) }] };
  const selection = { ...next, selection_sha256: shadowHash(next) };
  assertWorkflowSelection(selection);
  return freezeShadow(selection);
}
