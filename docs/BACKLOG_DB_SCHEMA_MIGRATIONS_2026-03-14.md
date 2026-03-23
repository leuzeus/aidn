# Backlog DB Schema Migrations - 2026-03-14

## Goal

Track the concrete work needed so `aidn` stops overwriting SQLite runtime state during update, reinstall, reinitialization, and mode transitions, and instead applies explicit, traceable schema migrations.

Reference plan:

- `docs/PLAN_DB_SCHEMA_MIGRATIONS_2026-03-14.md`

## Backlog Items

### DSM-01 - Define Migration Vocabulary And Scope

Status: completed
Priority: high

Why:

- the repository must distinguish schema migration from projection sync and durable runtime state

Done when:

- one explicit vocabulary exists for:
  - schema migration
  - projection refresh
  - durable DB-first state
  - rebuildable index state

Progress note:

- the plan now defines the shared vocabulary explicitly and separates schema migration, projection sync, durable DB-first state, and rebuildable index state
- this distinction is now used to scope the first implementation slice and keep it narrower than the full no-loss remediation

### DSM-02 - Add `schema_migrations` Registry

Status: completed
Priority: high

Why:

- schema evolution must be ordered and traceable

Done when:

- SQLite contains a dedicated `schema_migrations` table
- each applied migration is recorded with:
  - `migration_id`
  - `applied_at`
  - `engine_version`
  - `checksum`

Progress note:

- SQLite now records applied schema migrations in `schema_migrations`
- baseline adoption of an existing DB and fresh bootstrap both write `0001_workflow_index_baseline_v2`

### DSM-03 - Add Central Schema Runner

Status: completed
Priority: high

Why:

- all DB entry points need one shared migration lifecycle

Done when:

- one shared helper exists, for example `ensureWorkflowDbSchema()`
- it can:
  - bootstrap base schema
  - discover pending migrations
  - apply them transactionally
  - return migration status

Progress note:

- `src/lib/sqlite/workflow-db-schema-lib.mjs` now provides `ensureWorkflowDbSchema()`
- the runner bootstraps the current baseline schema, records migration metadata, and returns backup / applied migration information

### DSM-04 - Wire Runner Into All DB Entry Points

Status: completed
Priority: high

Why:

- migrations are useless if some DB-opening code paths bypass them

Done when:

- the schema runner is used by:
  - `src/lib/index/index-store.mjs`
  - `src/adapters/runtime/artifact-store.mjs`
  - `src/lib/sqlite/index-sqlite-lib.mjs`
  - other runtime DB stores if present

Progress note:

- the runner is now wired into:
  - `src/lib/index/index-store.mjs`
  - `src/adapters/runtime/artifact-store.mjs`
  - `tools/runtime/artifact-store.mjs`
  - `src/lib/sqlite/index-sqlite-lib.mjs`
  - `src/application/runtime/repair-layer-query-use-case.mjs`

### DSM-05 - Add Backup Before Risky Upgrade

Status: completed
Priority: high

Why:

- failed migrations must be recoverable

Done when:

- a migration path can emit a timestamped SQLite backup before structural change
- the backup location is returned in migration status output

Progress note:

- existing SQLite files without `schema_migrations` now receive a timestamped pre-migration backup before baseline adoption
- verifier coverage confirms backup creation on legacy DB adoption and no backup on fresh bootstrap

### DSM-06 - Remove Destructive Reset From Durable Tables

Status: completed
Priority: high

Why:

- full-table delete/reinsert is the main no-loss violation today

Done when:

- the main SQLite write path no longer truncates durable tables by default
- rebuild behavior is limited to explicitly rebuildable ownership scopes only

Progress note:

- full SQLite sync now preserves DB-first runtime/backlog artifacts that can legitimately exist without a materialized `docs/audit/*` file in `db-only`
- the SQLite writer now reconciles `artifacts` with ownership-aware behavior:
  - stale rebuildable artifact rows are removed
  - protected DB-first artifact rows are not blindly deleted
  - projected artifact rows are refreshed via `upsert` instead of relying on full-table wipe
- `repair_decisions` now follow the same reconcile pattern:
  - stale rows are removed by key
  - current rows are refreshed via `upsert`
  - existing accepted/rejected overrides survive full sync without physical row replacement
- broad table reset still exists for explicitly rebuildable projection tables, but the currently identified durable tables are no longer truncated by default

### DSM-07 - Define Table Ownership Policy

Status: completed
Priority: high

Why:

- the code cannot migrate safely until each table is classified by lifecycle

Done when:

- one documented ownership map exists for:
  - rebuildable projection tables
  - durable runtime tables
  - hybrid / ambiguous tables requiring redesign

Progress note:

- the current implementation now treats DB-first runtime/root artifacts and session backlogs as a first preserved ownership class during full sync
- `docs/PLAN_DB_SCHEMA_MIGRATIONS_2026-03-14.md` now records the interim table-by-table ownership map across rebuildable projection tables, durable tables, and mixed zones still carrying design debt
- the code now enforces that policy directly for the known durable zones in `artifacts` and `repair_decisions`

### DSM-08 - Make `mode-migrate` A Real Migration Flow

Status: completed
Priority: medium

Why:

- current mode migration behaves mostly like sync/rebuild

Done when:

- `mode-migrate` runs schema migration first
- it reports:
  - schema status
  - data sync status
  - repair status
- it no longer implies destructive DB reset

Progress note:

- `mode-migrate` now inspects schema status before execution, runs the shared migration runner explicitly, and reports schema status after migration
- the JSON result now exposes `schema_status_before`, `schema_migration_result`, `schema_status_after`, plus the existing sync and repair-layer results
- verifier coverage confirms the explicit `schema_migrate` step and zero pending migrations after transition to `db-only`

### DSM-09 - Add DB Migration CLI Surface

Status: completed
Priority: medium

Why:

- operators need explicit visibility similar to frameworks like Laravel

Done when:

- CLI supports commands such as:
  - `aidn runtime db-status`
  - `aidn runtime db-migrate`
  - `aidn runtime db-backup`

Progress note:

- `aidn runtime db-status` now reports DB existence, schema version, applied migrations, and pending migrations without mutating the DB
- `aidn runtime db-migrate` now applies pending migrations explicitly and reports backup / applied migration details
- `aidn runtime db-backup` now emits a standalone timestamped SQLite backup on demand

### DSM-10 - Decide Single-DB vs Two-DB Architecture

Status: completed
Priority: medium

Why:

- mixed ownership inside one SQLite file is the root structural ambiguity

Done when:

- one explicit architecture decision is recorded:
  - single DB with ownership zones
- or:
  - split DBs (`workflow-index.sqlite` + `workflow-state.sqlite`)

Progress note:

- the current product line now records an explicit decision for a single SQLite file with ownership zones
- the main reason is repository-wide coupling to `workflow-index.sqlite` across install, runtime CLI, repair-layer flows, and verifiers
- a future split into `workflow-index.sqlite` + `workflow-state.sqlite` remains acceptable as a later redesign, but is no longer the active migration target

### DSM-11 - Add Upgrade Fixtures For Existing Repositories

Status: completed
Priority: high

Why:

- the remediation only matters if already-installed repositories upgrade safely

Done when:

- fixtures cover:
  - old schema to new schema
  - reinstall without DB loss
  - reinit without DB loss
  - `dual` and `db-only`
  - `gowire`-like upgrade paths

Progress note:

- legacy schema adoption is now covered by `verify-db-schema-migrations-fixtures.mjs`
- `mode-migrate` transition to `db-only` is covered with explicit schema migration and repair-layer verification in `verify-mode-migrate-repair-layer-fixtures.mjs`
- reinstall no-loss for a DB-first artifact in `db-only` is now covered by `verify-install-db-only-preserves-db-first-artifacts-fixtures.mjs`
- reinitialization no-loss in `db-only` is now covered by `verify-reinit-db-only-preserves-db-first-artifacts-fixtures.mjs`
- a `gowire`-like client upgrade path is now covered by `verify-gowire-like-db-only-upgrade-preserves-db-first-artifacts-fixtures.mjs`
- `dual` / `db-only` install baselines remain covered by `verify-selfhost-workspace-fixtures.mjs`

### DSM-12 - Add No-Loss Verification Gates

Status: completed
Priority: high

Why:

- the repository needs durable proof that future updates do not reintroduce resets

Done when:

- verifiers fail if:
  - migration bypass occurs
  - durable rows disappear across reinstall/reinit
  - backup is missing on risky migration
  - schema version changes without migration record

Progress note:

- the repository now has explicit gates for:
  - migration registry / backup adoption (`verify-db-schema-migrations-fixtures.mjs`)
  - explicit CLI migration surface (`verify-db-runtime-cli-fixtures.mjs`)
  - DB-first artifact preservation across full sync (`verify-sync-db-first-preserves-db-first-artifacts-fixtures.mjs`)
  - repair decision preservation without physical row replacement (`verify-sync-db-first-preserves-repair-decisions-fixtures.mjs`)
  - reinstall preservation in `db-only` (`verify-install-db-only-preserves-db-first-artifacts-fixtures.mjs`)
  - reinitialization preservation in `db-only` (`verify-reinit-db-only-preserves-db-first-artifacts-fixtures.mjs`)
  - `gowire`-like client upgrade preservation in `db-only` (`verify-gowire-like-db-only-upgrade-preserves-db-first-artifacts-fixtures.mjs`)
- together with `verify-selfhost-workspace-fixtures.mjs`, this closes the current no-loss gate set for the existing single-DB design

## Recommended Execution Order

1. `DSM-01`
2. `DSM-02`
3. `DSM-03`
4. `DSM-04`
5. `DSM-05`
6. `DSM-07`
7. `DSM-06`
8. `DSM-08`
9. `DSM-09`
10. `DSM-11`
11. `DSM-12`
12. `DSM-10`

## First Safe Slice

The first slice should be:

- `DSM-02`
- `DSM-03`
- `DSM-04`
- `DSM-05`

This delivers:

- explicit migration registry
- one reusable migration runner
- consistent schema handling across DB entry points
- recovery backup before risky upgrades

without yet forcing the full ownership redesign.
