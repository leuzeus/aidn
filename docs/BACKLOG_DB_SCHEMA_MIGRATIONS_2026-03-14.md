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

Status: proposed
Priority: high

Why:

- full-table delete/reinsert is the main no-loss violation today

Done when:

- the main SQLite write path no longer truncates durable tables by default
- rebuild behavior is limited to explicitly rebuildable ownership scopes only

### DSM-07 - Define Table Ownership Policy

Status: proposed
Priority: high

Why:

- the code cannot migrate safely until each table is classified by lifecycle

Done when:

- one documented ownership map exists for:
  - rebuildable projection tables
  - durable runtime tables
  - hybrid / ambiguous tables requiring redesign

### DSM-08 - Make `mode-migrate` A Real Migration Flow

Status: proposed
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

### DSM-09 - Add DB Migration CLI Surface

Status: proposed
Priority: medium

Why:

- operators need explicit visibility similar to frameworks like Laravel

Done when:

- CLI supports commands such as:
  - `aidn runtime db-status`
  - `aidn runtime db-migrate`
  - `aidn runtime db-backup`

### DSM-10 - Decide Single-DB vs Two-DB Architecture

Status: proposed
Priority: medium

Why:

- mixed ownership inside one SQLite file is the root structural ambiguity

Done when:

- one explicit architecture decision is recorded:
  - single DB with ownership zones
- or:
  - split DBs (`workflow-index.sqlite` + `workflow-state.sqlite`)

### DSM-11 - Add Upgrade Fixtures For Existing Repositories

Status: proposed
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

### DSM-12 - Add No-Loss Verification Gates

Status: proposed
Priority: high

Why:

- the repository needs durable proof that future updates do not reintroduce resets

Done when:

- verifiers fail if:
  - migration bypass occurs
  - durable rows disappear across reinstall/reinit
  - backup is missing on risky migration
  - schema version changes without migration record

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
