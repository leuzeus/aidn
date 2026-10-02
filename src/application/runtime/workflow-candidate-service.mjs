import { proposeWorkflowCandidate, previewWorkflowCandidate } from "../../core/workflow/workflow-candidate.mjs";
import { activateWorkflowCandidate, assertWorkflowSelection } from "../../core/workflow/workflow-selection.mjs";
import { assertCurrentWorkflowCompilation, inspectWorkflowInstance, workflowInstanceFail as fail } from "../../core/workflow/workflow-instance.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { compileShadowWorkflow, getWorkflowShadowRegistry } from "../../core/workflow/workflow-shadow-compiler.mjs";

// The baseline is canonical state, never an authority supplied by a generated
// suggestion. Candidate bytes and explanation remain untrusted input.
export function createWorkflowCandidateService({ selections, instances, readAuthority, initializeInstance }) {
  function baseline(workflowId, baseInstanceId) {
    const retained = selections.read(workflowId);
    if (retained.record) {
      const selection = assertWorkflowSelection(retained.record), last = selection.activations.at(-1).proposal;
      return { retained, definition: last.definition, compilation: last.compilation, scope: selection.scope, seed: selection.seed,
        ref: { kind: "selection", id: workflowId, sha256: selection.selection_sha256 }, quiescent: true };
    }
    if (!baseInstanceId) fail("WORKFLOW_CANDIDATE_BASELINE_REQUIRED");
    const instance = instances.read(baseInstanceId).instance;
    if (!instance || instance.definition.workflow_id !== workflowId) fail("WORKFLOW_CANDIDATE_BASELINE_INVALID");
    assertCurrentWorkflowCompilation(instance);
    return { retained, definition: instance.definition, compilation: instance.compilation, scope: instance.scope,
      seed: { instance_id: instance.instance_id, instance_sha256: instance.instance_sha256, definition: instance.definition, compilation: instance.compilation },
      ref: { kind: "instance", id: instance.instance_id, sha256: instance.instance_sha256 }, quiescent: inspectWorkflowInstance(instance).status === "terminal" };
  }
  function preview(input) {
    if (checkShadowJson(input) || !input || !input.definition || typeof input.explanation !== "string") fail("WORKFLOW_CANDIDATE_INPUT_INVALID");
    const base = baseline(input.definition.workflow_id, input.baseInstanceId);
    const proposal = proposeWorkflowCandidate({ baseDefinition: base.definition, definition: input.definition,
      context: base.compilation.context, explanation: input.explanation });
    return { base, preview: previewWorkflowCandidate({ proposal, baseCompilation: base.compilation, baseline: base.ref, scope: base.scope, quiescent: base.quiescent }) };
  }
  function authority(base) {
    const current = readAuthority();
    if (shadowHash(current.scope) !== shadowHash(base.scope) || current.stateMode !== base.compilation.context.state_mode
      || current.productVersion !== base.compilation.context.product_version) fail("WORKFLOW_CANDIDATE_AUTHORITY_CHANGED");
  }
  return Object.freeze({
    generationInput({ workflowId, baseInstanceId = null }) {
      const base = baseline(workflowId, baseInstanceId);
      return { authority: "reference_only", written: false, execution_available: false, baseline: base.ref,
        definition: structuredClone(base.definition), context: structuredClone(base.compilation.context),
        registry: structuredClone(getWorkflowShadowRegistry()), response_fields: ["definition", "explanation"],
        requirements: ["Preserve workflow identity and increment revision once.", "Use registered primitives and outcome types.",
          "Explain the proposed change; the explanation grants no rights.", "New capabilities, removed controls and increased returns cannot be activated."] };
    },
    propose(input) {
      const result = preview(input);
      return result.preview;
    },
    activate({ definition, explanation, baseInstanceId = null, expectedPreviewSha256, review, write = false }) {
      if (typeof write !== "boolean" || !expectedPreviewSha256) fail("WORKFLOW_CANDIDATE_EXPLICIT_REVIEW_REQUIRED");
      const input = { definition, explanation, baseInstanceId }, first = preview(input);
      if (first.preview.preview_sha256 !== expectedPreviewSha256) fail("WORKFLOW_CANDIDATE_PREVIEW_CHANGED");
      if (!first.base.quiescent) fail("WORKFLOW_CANDIDATE_BASELINE_ACTIVE");
      if (!first.preview.proposal.permissions.within_ceiling) fail("WORKFLOW_CANDIDATE_PERMISSION_EXTENSION");
      authority(first.base);
      const selection = activateWorkflowCandidate({ previous: first.base.retained.record, seed: first.base.seed,
        scope: first.base.scope, proposal: first.preview.proposal, review });
      if (!write) return { written: false, selection };
      const confirmed = preview(input); authority(confirmed.base);
      if (confirmed.preview.preview_sha256 !== expectedPreviewSha256 || !confirmed.base.quiescent) fail("WORKFLOW_CANDIDATE_PREVIEW_CHANGED");
      const result = selections.compareAndSwap(selection, confirmed.base.retained.content_sha256);
      if (result.projection === "pending") {
        try { selections.materialize(selection.workflow_id, { write: true }); result.projection = "materialized"; }
        catch { result.projection = "reconciliation_required"; }
      }
      const { record, ...rest } = result;
      return { ...rest, selection: record };
    },
    inspect(workflowId) {
      const selection = selections.read(workflowId).record;
      if (!selection) fail("WORKFLOW_SELECTION_NOT_FOUND");
      assertWorkflowSelection(selection);
      return selection;
    },
    initializeSelected({ workflowId, instanceId, expectedSelectionSha256, write = false, expectedResultSha256 = null }) {
      const selection = selections.read(workflowId).record;
      if (!selection || !expectedSelectionSha256 || selection.selection_sha256 !== expectedSelectionSha256) fail("WORKFLOW_SELECTION_CHANGED");
      assertWorkflowSelection(selection);
      const active = selection.activations.at(-1).proposal;
      authority({ scope: selection.scope, compilation: active.compilation });
      const current = compileShadowWorkflow(active.definition, active.compilation.context);
      if (!current.ok || current.compilation.compilation_sha256 !== active.compilation.compilation_sha256) fail("WORKFLOW_SELECTION_COMPILATION_CHANGED");
      return initializeInstance({ instanceId, definition: active.definition, context: active.compilation.context, write, expectedResultSha256 });
    },
  });
}
