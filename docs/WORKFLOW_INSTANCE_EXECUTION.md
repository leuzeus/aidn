# Durable workflow instance candidate

The internal `createProjectWorkflowInstanceService({ targetRoot })` composition
in `src/application/runtime/workflow-instance-composition.mjs` is an explicit
consumer of ADR-0018. It performs no automatic workflow selection.
Definitions remain descriptive, and existing default execution is unchanged.

The experimental [workflow console](WORKFLOW_CONSOLE.md) now provides CLI and
dashboard consumers of this service, with the same admission and recovery rules.

For reviewed candidate definitions and explicit selection for future instances,
see [workflow candidate review](WORKFLOW_CANDIDATE_REVIEW.md). Existing instances
retain their pins. Bulk DB index projection cannot replace a canonical workflow
record with stale visible content.

## Preparation and checkpoints

1. Supply a validated definition and explicit shadow context to `initialize`.
   Without `write: true` the result is a preview. The target must already have
   valid project activation; initialization does not install or authorize it.
2. Retain `instance_sha256`. Human `decide` calls require that expected hash,
   a registered outcome and nonempty evidence references with SHA-256 values.
   Preview remains read-only; applying appends one canonical checkpoint.
3. At `agent_segment`, prepare a run using the existing
   [segment binding procedure](WORKFLOW_SEGMENT_EXECUTION.md). Supply the exact
   configuration and normalized plan paths to `prepareSegment`. This records
   the intent; it does not start execution or create a new plan.
4. Request `segment` with `command: agent-run` for the existing lifecycle
   preview **after** persisting the intent. Execution additionally requires
   `execute: true`, `syncRelay: true` and its exact `expectPlan` action hash.
   PostgreSQL, native prerequisites and current admission remain mandatory for
   agent segments. Human-only traversal requires no PostgreSQL.
5. After completion, `reconcile` observes the existing run and previews the next
   checkpoint. `write: true` applies it with compare-and-swap. Uncertain effects
   remain pending; inspection and reconciliation never dispatch an executor.

All methods operating on an existing instance take `instanceId`; mutations and
segment actions additionally take `expectedSha256`. `inspect` returns retained
state and a derived cursor. `segment` also supports existing status, resume and
cancel, preserving their explicit execution flags and action hashes. There is
no arbitrary module, shell, expression or handler name supplied by a definition.

## Recovery matrix

| Interruption or conflict | Retained evidence | Recovery |
| --- | --- | --- |
| Human decision committed, caller lost response | Event and increased canonical revision | Inspect; old expected hash rejects a second write. |
| Intent committed, effect not observed | Same run/configuration/plan pins | Status first; explicit approved start only if existing lifecycle admission permits that same run. |
| Effect ran, macro result not recorded | Intent plus supervisor journals | Reconcile status; never launch a replacement run. |
| Supervisor reports uncertainty | Pending intent and detailed run status | Existing explicit resume/cancel and their proof requirements; no macro transition. |
| Concurrent checkpoint | Canonical content hash changed | Reload; do not overwrite another decision. |
| Process died during file commit | Atomic previous/new JSON and adjacent lock | Retain lock evidence, inspect JSON and independently establish writer termination before explicit maintenance. No automatic lock recovery API. |
| Dual projection failed | Canonical DB checkpoint already committed | Explicitly call the store's `materialize(id, { write: true })`; never repeat the decision. |
| Definition/compiler/context changed | Pinned historical instance | Inspect/status/cancel still available; no automatic migration or new productive dispatch. |
| Unsupported registered handler | Cursor `handler_unavailable` | Supply an implemented, governed handler in a later change; no manual success substitution. |

Canonical artifacts use `workflows/instances/<id>.json` relative to the audit
root. Files mode uses `docs/audit`; DB modes use the existing artifact store.
An explicitly configured PostgreSQL backend stays canonical in every mode.
SQLite must already have its normal schema; this feature never initializes or
migrates a backend. Retain configuration and plan files, effect proof files and
supervisor journals; the instance stores references and does not purge them.
The initial bound is 256 events per instance, with explicit refusal on overflow.
