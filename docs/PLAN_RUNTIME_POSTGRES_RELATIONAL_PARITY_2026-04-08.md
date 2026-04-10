# Plan - Runtime PostgreSQL Relational Parity

Date: 2026-04-08
Status: proposed, codebase-validated
Scope: correct the current runtime PostgreSQL model so `runtime.persistence.backend=postgres` becomes a real relational replacement for `workflow-index.sqlite`, instead of a reduced JSONB snapshot backend.

Reference plans:

- `docs/PLAN_RUNTIME_DB_BACKEND_ABSTRACTION_2026-04-05.md`
- `docs/PLAN_WORKTREE_POSTGRESQL_2026-03-27.md`
- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`

Reference migration guide:

- `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`

Validation context:

- product repository inspection in `G:\projets\aidn`
- real recovery/rebuild validation on `G:\projets\gowire`
- recovered artifact corpus from `G:\projets\last_artefact_gowire`

## Problem Statement

The current PostgreSQL runtime persistence implementation does not satisfy the meaning implied by:

- `runtime.persistence.backend=postgres`

Today PostgreSQL stores:

- `schema_migrations`
- `runtime_snapshots`
- `runtime_heads`
- `adoption_events`

SQLite still stores the real relational runtime index:

- `artifacts`
- `artifact_blobs`
- `cycles`
- `file_map`
- `tags`
- `artifact_tags`
- `sessions`
- `artifact_links`
- `session_links`
- `session_cycle_links`
- `repair_decisions`
- other runtime support tables and metadata

This means the current PostgreSQL backend is not a relational replacement for `workflow-index.sqlite`. It is a reduced snapshot model with a compatibility SQLite projection still carrying the richer runtime structure.

That mismatch produces three concrete problems:

1. backend semantics are misleading: `postgres` sounds canonical, but canonical relational reads still depend on SQLite shape and SQLite-compatible projections
2. parity is not testable table-by-table because the two backends do not represent the same runtime state model
3. operational drift becomes harder to reason about because PostgreSQL and SQLite can both look "healthy" while storing different structural representations

## Codebase-Validated Baseline

The current implementation intentionally defines PostgreSQL runtime persistence with only four tables in:

- `src/application/runtime/postgres-runtime-persistence-contract-service.mjs`

The current SQL bootstrap for PostgreSQL runtime persistence is:

- `tools/perf/sql/runtime-artifacts-postgres.sql`

The current PostgreSQL adapter writes:

- one canonical payload snapshot in `runtime_snapshots.payload_json`
- a small hot lookup projection in `runtime_heads`
- explicit adoption traces in `adoption_events`

The current write path is implemented in:

- `src/adapters/runtime/postgres-runtime-artifact-store.mjs`

The current migration guide explicitly preserves a local SQLite projection when PostgreSQL is selected:

- `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`

On `G:\projets\gowire`, current runtime config is:

- `runtime.persistence.backend=postgres`
- `runtime.persistence.localProjectionPolicy=keep-local-sqlite`

This is operationally consistent with the current code, but not with the desired end state.

## Desired End State

When `runtime.persistence.backend=postgres`:

1. PostgreSQL is the canonical runtime index backend
2. PostgreSQL exposes a relational schema equivalent in semantics to `workflow-index.sqlite`
3. runtime reads, repair-layer reads, runtime heads, fileless rematerialization, and admin status/migrate flows can operate canonically from PostgreSQL
4. SQLite becomes optional compatibility projection only
5. `localProjectionPolicy=none` becomes safe and supported

The backend choice must mean:

- `sqlite`: canonical runtime state is stored in SQLite
- `postgres`: canonical runtime state is stored in PostgreSQL

It must not mean:

- PostgreSQL stores a summarized snapshot while SQLite still carries the real relational runtime model

## Hard Invariants

Any correction must preserve the following:

1. `docs/audit/*`, `AGENTS.md`, `.codex/*`, and other checkout-bound files remain checkout-bound
2. shared coordination remains a separate contract and schema from runtime artifact persistence
3. `files | dual | db-only` remain state-mode semantics, not backend semantics
4. existing SQLite users keep a non-breaking path
5. PostgreSQL adoption remains explicit, inspectable, and reversible
6. backend migration must not silently merge conflicting sources

## SOLID Requirements

This plan is not complete if PostgreSQL parity is achieved by layering more backend-specific exceptions onto the current runtime code.

The correction must explicitly improve the runtime persistence area against the SOLID principles:

### Single Responsibility Principle

- schema definition, schema migration, relational reads/writes, adoption planning, and observability must not stay collapsed inside a few oversized modules
- snapshot-era compatibility code must be isolated from the canonical relational backend path

### Open/Closed Principle

- backend-aware runtime services must extend through stable ports/adapters, not by spreading new `if sqlite / if postgres` branching through use cases
- adding or evolving a backend must not require rewriting the application layer

### Liskov Substitution Principle

- SQLite and PostgreSQL runtime adapters must satisfy the same behavioral contract for canonical runtime persistence
- a caller using the runtime persistence port must not need to know which backend is underneath to get correct canonical behavior

### Interface Segregation Principle

- separate contracts are required for:
  - canonical relational runtime reads/writes
  - schema/admin operations
  - adoption/migration planning
  - optional observability/admin event recording
- no consumer should depend on snapshot-specific or SQLite-specific methods it does not need

### Dependency Inversion Principle

- runtime and Codex application services must depend on backend-neutral runtime persistence ports
- direct imports of SQLite-specific readers/helpers in canonical read paths must be removed or isolated behind adapters

## Scope Clarification

This plan is about runtime artifact persistence parity, not shared coordination parity.

In scope:

- runtime relational tables
- runtime read/write/admin contracts
- backend adoption and migration
- optional local projection policy
- parity verification

Out of scope:

- moving checkout-bound markdown into PostgreSQL
- replacing shared coordination schema ownership
- changing workflow state-mode semantics

## Current Structural Gap

### PostgreSQL-only runtime tables

The following tables exist only because the current PostgreSQL runtime model is snapshot-oriented:

- `runtime_snapshots`
- `adoption_events`

`runtime_heads` exists for hot lookup optimization, but today it is implemented as part of the snapshot design rather than as a clearly backend-symmetric runtime optimization layer.

### SQLite-only runtime tables

The following runtime structures remain canonical only in SQLite:

- `artifacts`
- `artifact_blobs`
- `cycles`
- `file_map`
- `tags`
- `artifact_tags`
- `sessions`
- `artifact_links`
- `session_links`
- `session_cycle_links`
- `repair_decisions`
- SQLite metadata tables/views supporting schema, rematerialization, and repair reads

This is the architectural gap to close.

## Recommended Architecture

### Layer 1 - Canonical Runtime Schema Parity

Define a PostgreSQL runtime schema that mirrors the semantic content of `workflow-index.sqlite`.

Minimum expectation:

- every canonical runtime entity represented relationally in SQLite is represented relationally in PostgreSQL
- the primary keys, uniqueness rules, and lookup indexes are intentionally mapped, not approximated
- hot lookup support remains derivable in both backends

### Layer 2 - Admin/Observability Parity

Classify runtime tables into:

- canonical runtime tables
- derived runtime optimization tables
- admin/observability tables

Recommended classification:

- canonical: `artifacts`, `artifact_blobs`, `cycles`, `file_map`, `tags`, `artifact_tags`, `sessions`, `artifact_links`, `session_links`, `session_cycle_links`, `repair_decisions`
- optimization: `runtime_heads` if kept
- admin: `schema_migrations`, `adoption_events`

`runtime_snapshots` should not remain the canonical runtime storage model once relational parity exists.

### Layer 3 - Backend-Neutral Read/Write Contract

The application layer must read and write through backend-neutral contracts that assume a relational runtime store, not a JSON snapshot store.

This means:

- no canonical read path depending directly on `readIndexFromSqlite(...)`
- no canonical PostgreSQL path depending on `runtime_snapshots.payload_json`
- parity readers for runtime state, repair-layer state, and hot heads

## Table Policy Decisions

### `schema_migrations`

Keep in both backends with the same role:

- schema bootstrap and upgrade registry

### `runtime_heads`

Keep only if both backends expose it with the same semantics:

- derived hot lookup table keyed by logical head name

If parity cannot be made exact, convert it into:

- a backend-specific optimization layer hidden behind one port contract

### `adoption_events`

Keep as an admin table, but make the policy explicit.

Recommended direction:

- add equivalent adoption-event support to SQLite so backend migration/admin observability is symmetric

Alternative:

- keep it PostgreSQL-only but classify it as a non-canonical admin table outside the parity requirement

The first option is preferred because it improves migration traceability and removes one unnecessary backend asymmetry.

### `runtime_snapshots`

Deprecate as canonical storage.

Allowed end states:

- removed entirely after migration
- retained only as optional cache/export materialization

Forbidden end state:

- remaining the source of truth while relational parity is claimed

## Execution Plan

### Phase 1 - Freeze the parity target

Produce a canonical runtime schema map:

- SQLite table/view inventory
- PostgreSQL target inventory
- per-table key/index/constraint mapping
- classification into canonical vs optimization vs admin

Done when:

- there is no ambiguity about what "PostgreSQL replaces workflow-index.sqlite" means

### Phase 2 - Introduce PostgreSQL relational schema v2

Add a new PostgreSQL runtime schema revision that includes the canonical relational runtime tables.

Requirements:

- explicit DDL for all canonical runtime entities
- explicit indexes for hot readers
- schema migration path from current `aidn_runtime` v1
- clear compatibility rules for `runtime_heads`

Done when:

- PostgreSQL can store the same runtime graph as SQLite without collapsing it into one JSONB payload

### Phase 3 - Refactor adapters and ports

Split backend-neutral responsibilities into:

- runtime artifact relational reader/writer
- runtime admin/migration interface
- adoption planner/transfer interface

Then update the adapters:

- SQLite adapter remains relational
- PostgreSQL adapter becomes relational
- snapshot-specific logic becomes migration-only or cache-only

SOLID completion requirements for this phase:

- canonical runtime use cases depend only on backend-neutral ports
- no new backend branching is introduced into application services where an adapter boundary is expected
- migration/admin concerns do not leak into canonical read/write ports

Done when:

- application services stop importing SQLite readers directly for canonical runtime persistence

### Phase 4 - Migrate existing PostgreSQL runtime state

Add migration from current PostgreSQL snapshot storage to the new relational schema.

Migration input sources:

- current `runtime_snapshots.payload_json`
- current `runtime_heads`
- existing SQLite source when needed for recovery

Migration requirements:

- backup before mutation
- digest/row-count verification after migration
- explicit blocked state if source data is ambiguous

Done when:

- current PostgreSQL users can upgrade without losing runtime state

### Phase 5 - Make local SQLite projection truly optional

After relational parity exists, honor:

- `localProjectionPolicy=keep-local-sqlite`
- `localProjectionPolicy=none`

Requirements:

- runtime reads still work when no local SQLite file is present
- repair-layer and fileless rematerialization can read canonically from PostgreSQL
- status/migrate/backup commands describe the true backend of record

Done when:

- a PostgreSQL-backed repo can run without depending canonically on `.aidn/runtime/index/workflow-index.sqlite`

### Phase 6 - Align admin semantics

Decide and implement one consistent admin policy for:

- `adoption_events`
- `schema_migrations`
- runtime health/status reporting

Recommended direction:

- keep `schema_migrations` and `adoption_events` in both backends
- classify them as admin tables, not workflow-runtime domain tables

Done when:

- backend differences are intentional and documented, not accidental

## Verification Strategy

### Table parity verification

Add fixture coverage proving that, for the same runtime payload:

- SQLite and PostgreSQL expose equivalent row counts
- primary entities map equivalently
- hot lookup behavior matches
- repair-layer reads match

### Migration verification

Add fixture coverage for:

- PostgreSQL snapshot v1 -> PostgreSQL relational v2
- SQLite -> PostgreSQL relational transfer
- rollback safety after failed migration

### Real smoke validation

Repeat real validation on `G:\projets\gowire` with:

- canonical PostgreSQL backend
- no canonical dependence on local SQLite
- row-count parity checks
- rematerialization checks from PostgreSQL-backed runtime state

## Data Quality Risk Exposed By Gowire

The `gowire` recovered corpus revealed duplicated `cycle_id` ownership across multiple directories:

- `C004`
- `C005`
- `C032`

This is not caused by PostgreSQL. It is a source-data ambiguity that the relational parity work must handle explicitly.

Required decision:

- either allow multiple cycle directories for one logical `cycle_id`
- or normalize/repair the recovered corpus before canonical migration

This decision must be made before declaring parity complete, because it affects uniqueness rules in both backends.

## Delivery Risks

1. accidental continuation of snapshot semantics under a relational label
2. backend-neutral ports that still hide SQLite-only assumptions
3. migration code that silently chooses between conflicting SQLite and PostgreSQL sources
4. local-projection removal before PostgreSQL readers are truly complete
5. data ambiguities in recovered repositories such as `gowire`

## Acceptance Criteria

This plan is complete only when all of the following are true:

1. `runtime.persistence.backend=postgres` means PostgreSQL is the canonical relational runtime backend
2. PostgreSQL schema covers the same canonical runtime entities as `workflow-index.sqlite`
3. SQLite is optional compatibility projection, not hidden source of truth
4. `persistence-status` no longer depends on comparing a PostgreSQL snapshot model to a richer SQLite model
5. migration from existing PostgreSQL runtime snapshot installs is supported and verified
6. real repository validation passes on `gowire`
7. the runtime persistence area has explicit backend-neutral ports aligned with SOLID responsibilities
8. canonical runtime application services no longer depend directly on SQLite helpers
9. admin, migration, and canonical persistence concerns are separated clearly enough that the backend can evolve without application-layer rewrites

## Recommended Next Deliverables

1. `docs/BACKLOG_RUNTIME_POSTGRES_RELATIONAL_PARITY_2026-04-08.md`
2. PostgreSQL runtime schema v2 DDL
3. backend-neutral runtime relational ports
4. migration fixture set for snapshot-v1 to relational-v2
5. real smoke checklist for `gowire`
