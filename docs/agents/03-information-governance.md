# 03 Information Governance

## Purpose

AIDN governs information concepts, not just files.

The source of truth, metadata, lifecycle status, and scope of each concept must stay explicit across files, runtime stores, projections, and contracts.

## Core Rules

- source of truth is concept-specific
- metadata is governed, not incidental
- lifecycle status is part of the contract for governed concepts
- concepts can be governed, subsumed, or excluded
- files / dual / db-only are supported modes and must remain distinguishable
- every exposed concept declares owner, lifecycle, scope, retention, projections, migration, and replacement
- projections, fixtures, caches, and exports are never canonical by implication
- proof distinguishes package source, scaffold, fixture corpus, installed client, and external pilot
- PostgreSQL remains optional and shared synchronization remains opt-in
- owner, retention, migration, replacement, and evidence targets are
  concept-specific policy data; generic fallback text is not acceptable evidence
- governance diagnostics enforce bidirectional closure: every source-of-truth and
  metadata policy is exposed by a governed concept, and every public JSON/effect
  surface links back to governed concepts

## Modes

- `files`: checkout-bound Markdown and project files are authoritative
- `dual`: runtime DB/index is canonical for runtime state and Markdown projection is required
- `db-only`: runtime DB is canonical; minimal re-anchor Markdown anchors may stay visible, while detailed Markdown projections are materialized on demand

## New Concept Rule

Do not introduce a new information concept until you have checked:

- `src/core/source-of-truth/source-of-truth-policy.mjs`
- `src/core/metadata/metadata-policy.mjs`
- governance diagnostics
- `docs/ADR/ADR-0006-information-model.md`
- JSON contracts, if the concept appears in public output

## Concepts To Watch

| Concept | Status | Notes |
|---|---|---|
| project | governed | Project identity and policy surface. |
| project_activation | governed | Repository authorization revision plus validated worktree preparation; separate from workflow state and native client trust. |
| workspace | governed | Workspace identity and worktree identity are explicit. |
| runtime_project_context | governed | Durable runtime scope identity is distinct from legacy absolute-path evidence. |
| session | governed | Session state has a lifecycle and source of truth. |
| cycle | governed | Use the cycle state and cycle status policies. |
| artifact | governed | Artifact inventory and scope are governed. |
| runtime_state | governed | Runtime state is a governed digest surface. |
| handoff_packet | governed | Handoff packet is a governed digest surface. |
| decision | governed | Decision and arbitration records are explicitly governed. |
| incident | governed | Incidents carry lifecycle and ownership rules. |
| coordination_record | governed | Coordination records are a first-class governed family. |
| coordination_summary | governed | Coordination summary is a governed projection. |
| execution_run | governed, `model_only` | Frozen bounded plan and coordinator context; future PostgreSQL authority, no runtime instances. |
| delegated_task | governed, `model_only` | Run-local task identity, exact file operations and acceptance contract; no synthetic session. |
| execution_attempt | governed, `model_only` | One attempt owns its delegation and result references; execution, acceptance, integration and cleanup remain distinct. |
| baseline | local-first artifact family | Governed as local-first and checkout-bound unless explicitly projected. |
| snapshot | local-first artifact family | Governed as local-first and checkout-bound unless explicitly projected. |
| gate_result | excluded | CI telemetry, not governed product state. |
| migration_run | excluded | Operational telemetry, not a governed product concept. |
| reference_data | excluded | Test corpus and fixture material, not live workflow state. |
| setup_project_registry | excluded | Host-local project address book; installation receipts, config and packages remain authoritative. |

## Practical Guidance

If a concept already has a parent surface or an orthogonal telemetry layer, do not promote it without an explicit policy update and an ADR check.

Keep the source-of-truth policy, metadata policy, and governance diagnostics in sync with the information model.

ADR-0014 introduces internal supervision contracts only. `model_only` marks
complete policy coverage without advertising operational availability. Do not
invent observed artifacts or store instances for these concepts. PostgreSQL is
optional globally, but exclusive for the future supervised execution path;
there is no SQLite, file or in-memory authority fallback. Local transcripts
remain local with bounded hash/size references in shared results and no automatic
purge in V1.
