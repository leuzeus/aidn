# ADR-0019 - Reviewed workflow candidates and projections

## Status

Proposed; internal opt-in composition extending ADR-0016 through ADR-0018.
SPEC remains the rule authority. Default execution and public CLI selection
remain unchanged. Source fixtures do not qualify an installed native executor.

ADR-0020 subsequently exposes these services through the experimental console
CLI and local dashboard. Selection remains explicit and existing instances stay
pinned; no default workflow is replaced.

## Decision

An assistant can propose a definition and explanation from `generationInput`:
the current canonical baseline, pinned context and reference-only primitive
registry. This package does not invoke a model or execute generated text. The
candidate must pass the deterministic closed definition schema and compiler.
It retains the same workflow identity and increments the definition revision
once. The explanation is untrusted prose and grants no rights.

The internal `workflow-candidate.v1` contract retains the compilation, baseline
hashes, deterministic step/transition diff and a conservative permission ceiling.
New effect steps, changed authorities, removed controls, bypassed prerequisite
outcomes or mandatory postconditions, and expanded bounded returns prevent
activation. Unsupported handlers remain explicit refusals. Adding a human
prerequisite or reducing a return bound can remain within the ceiling. This
structural check never grants filesystem, tool or network rights; actual segment
admission and current project activation remain required.

`workflow-candidate-preview.v1` binds the proposal to its canonical baseline,
scope, quiescence and generated `workflow-projection.v1`. Markdown and Mermaid
use the compiled step and transition identities, including bounded exhaustion
edges. The projection hash covers renderer version, proposal, compilation and
rendered content. Regeneration detects stale or altered projections even if
someone recomputes their content hash. BPMN remains its separately maintained
view; no general BPMN renderer or interpreter is introduced.

Activation requires an explicit approval of the exact preview hash, nonempty
review evidence references and hashes, current matching authorization, and
`write: true`. The service repeats baseline/authority reads before canonical
content compare-and-swap. Initial activation uses an existing terminal canonical
instance as its seed. Later proposals use the latest retained selection. A
proposal or visible diagram can never supply its own authoritative baseline.

`workflow_selection` is a governed canonical artifact at
`workflows/definitions/<workflow-id>.json`. Its closed `workflow-selection.v1`
record retains the seed and ordered proposal/review history, with at most 16
activations and the existing strict JSON bounds. Reads validate each retained
review against its historical preview; they never recompile history against a
new registry. New proposals and productive instance initialization compile
against the current registry. Overflow fails explicitly without truncation.

The selection applies only to explicit future `initializeSelected` requests
with its expected selection hash. Existing instances retain their definition,
compilation and segment pins. A concurrent later selection cannot silently
rebind an already initialized instance. Activation neither starts a run nor
changes the default workflow. Review evidence is retained caller evidence;
this internal API does not authenticate a human identity or invent consent.

Persistence reuses ADR-0018's file lock/atomic replacement and existing artifact
CAS stores. PostgreSQL remains optional for human-only workflows, canonical
when configured, and mandatory for agent segments. Its current reservation
fence applies to selection writes. No new table, schema migration or background
worker is added. Dual projection failure reports a committed selection requiring
materialization; the caller must not repeat the activation.

Bulk index projection cannot roll back an existing canonical workflow instance
or selection from visible JSON. SQLite preserves omitted workflow records in
DB modes and rejects conflicting content inside its write transaction. Files
mode retains its normal visible-file-to-index projection. PostgreSQL bulk
projection requires exact retained workflow records in its input and rejects
both omission and changed content before replacing canonical rows. The existing
bulk bootstrap may still initialize schema; dedicated workflow CAS never does.
The refusal is `ARTIFACT_WORKFLOW_PROJECTION_CONFLICT`; repair the input from
canonical state rather than importing a stale visible copy.

## Validation and limits

`perf:verify-workflow-candidate` covers invalid suggestions, permission expansion,
closed contracts, deterministic identities/diffs, stale projections and previews,
exact review, revocation, files/SQLite persistence, retained history, new-instance
selection and unchanged existing instances. It also checks index preservation
and stale projection refusal. The required PostgreSQL suite covers selection
CAS, reconnect, reservation fencing and transaction rollback on stale or missing
bulk projection input. Native Codex and external pilot qualification remain
separate, unexecuted evidence. No client session or installation is created in
the package source repository.
