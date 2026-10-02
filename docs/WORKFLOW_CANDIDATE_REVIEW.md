# Workflow candidate review

The internal `createProjectWorkflowCandidateService({ targetRoot })` in
`src/application/runtime/workflow-candidate-composition.mjs` implements
[ADR-0019](ADR/ADR-0019-reviewed-workflow-candidates.md). It uses an already
activated target's canonical artifacts. It adds no public CLI command and does
not install AIDN, call a model, authorize tools or start execution.

## Proposal and review

1. Call `generationInput({ workflowId, baseInstanceId })` to obtain the canonical
   baseline, definition, pinned context and reference-only primitive registry.
   For the first selection, the seed must be a canonical instance of that
   workflow; activation requires that instance to be terminal. Subsequent
   proposals use the current selection and can omit `baseInstanceId`.
2. An assistant supplies `{ definition, explanation }`. Keep the workflow ID
   and increment its revision once. Pass this object and `baseInstanceId`, when
   needed, to `propose`. Invalid definitions are refused. Valid proposals expose
   a deterministic diff, permission reasons, quiescence and `activation_eligible`.
3. Review the proposal, explanation, diff and the preview's Markdown/Mermaid
   projection. Both views use the compilation's IDs. Retain `preview_sha256`.
   `checkWorkflowProjection(proposal, baseCompilation, projection)` detects a
   stale or altered rendered view by deterministic regeneration.
4. Record an actual review as `{ decision: "approve", preview_sha256, evidence:
   [{ ref, sha256 }] }`. Evidence identifies the review being retained; it is
   not an automatically generated approval. A changed baseline, explanation,
   projection or scope requires a new preview and review.
5. Call `activate` with the same definition/explanation/seed, the review and
   `expectedPreviewSha256`. Without `write: true` this remains a preview.
   Applying verifies current authorization and writes by canonical content CAS.
   An invalid or permission-expanding suggestion cannot be approved into use.
6. Inspect the retained selection with `inspect(workflowId)`. To initialize a
   future instance, explicitly call `initializeSelected({ workflowId, instanceId,
   expectedSelectionSha256, write: true })`. Existing instances keep their pins.
   Continue using the [instance procedure](WORKFLOW_INSTANCE_EXECUTION.md) for
   decisions and supervisor dispatch; selecting a definition does not run it.

Structural eligibility does not prove current activation or native availability.
Handlers beyond approval, review, agent segment and terminal remain unavailable
in this composition. Adding capabilities or widening permissions needs a separate
governed implementation change; a generated suggestion cannot do so.

## Persistence and recovery

Selections use `workflows/definitions/<workflow-id>.json` relative to the audit
root. Files mode is canonical unless PostgreSQL is explicitly configured. Dual
JSON is derived after the canonical commit; db-only creates no detailed visible
projection. After `projection: reconciliation_required`, use the selection
store's explicit `materialize(workflowId, { write: true })`; do not repeat the
activation. File lock reconciliation follows the instance procedure.

Bulk index writes reject stale workflow record content. SQLite DB modes preserve
omitted workflow instances/selections; PostgreSQL requires the exact canonical
records in the projection input and refuses their omission. On
`ARTIFACT_WORKFLOW_PROJECTION_CONFLICT`, read the canonical records and rebuild
the input. Do not replace them from a visible diagram or old JSON projection.

The initial selection history is bounded to 16 activations and the shared JSON
limits; exceeding either is an explicit refusal. Evidence shown by fixtures is
separate from native executor or external pilot qualification.
