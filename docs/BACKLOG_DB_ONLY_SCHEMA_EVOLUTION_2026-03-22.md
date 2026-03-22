# Backlog DB-Only Schema Evolution - 2026-03-22

## Goal

Track the concrete work needed to optimize the SQLite schema for `db-only` without breaking `dual` and while preserving artifact rematerialization from the database.

Reference plan:

- `docs/PLAN_DB_ONLY_SCHEMA_EVOLUTION_2026-03-22.md`

## Backlog Items

### DBS-01 - Formalize The Reconstruction Contract

Status: proposed
Priority: high

Why:

- schema optimization is unsafe unless the reconstructible artifact contract is explicit

Done when:

- docs define which artifacts must remain rematerializable from SQLite
- docs state that `runtime_heads` is an accelerator only
- docs state that `dual` remains a required compatibility mode

### DBS-02 - Add Migration `0002_runtime_heads`

Status: proposed
Priority: high

Why:

- hot runtime lookups currently require broader SQLite payload reconstruction than needed

Done when:

- `workflow-db-schema-lib` registers `0002_runtime_heads`
- migration adds `runtime_heads` table and indexes
- migration runs safely on fresh and legacy DBs

### DBS-03 - Backfill `runtime_heads`

Status: proposed
Priority: high

Why:

- the table is only useful if existing hot artifacts are discoverable immediately after migration

Done when:

- backfill derives head rows from existing `artifacts`
- subtype is preferred over path heuristics when available
- rerunning the migration remains idempotent

### DBS-04 - Route Hot Runtime Readers Through `runtime_heads`

Status: proposed
Priority: high

Why:

- read performance will not improve if hot consumers still scan broad payload structures

Done when:

- the main hot readers for current/runtime/handoff/agent summary artifacts can consult `runtime_heads`
- fallback to the reconstructible artifact store remains available

### DBS-05 - Add Migration `0003_artifact_blobs_split`

Status: proposed
Priority: high

Why:

- `artifacts` currently mixes hot metadata and cold payload fields

Done when:

- migration adds `artifact_blobs`
- migration is additive and non-destructive
- migration preserves reconstructible payload fields

### DBS-06 - Backfill `artifact_blobs`

Status: proposed
Priority: high

Why:

- old databases need their payload rows migrated without loss

Done when:

- each existing artifact payload is copied into `artifact_blobs`
- no payload duplication or loss occurs on rerun
- sha/size continuity is preserved

### DBS-07 - Add Dual-Read Compatibility For Split Blobs

Status: proposed
Priority: high

Why:

- migrated and non-migrated repositories must remain readable during rollout

Done when:

- readers prefer `artifact_blobs` when present
- readers fall back to legacy payload columns in `artifacts`
- mixed-layout DBs remain readable

### DBS-08 - Add Dual-Write Compatibility For Split Blobs

Status: proposed
Priority: high

Why:

- writers must not create a split-brain transition window

Done when:

- artifact writers write both legacy and new payload layouts during transition
- write-through remains correct in `dual`
- DB-first writes remain correct in `db-only`

### DBS-09 - Add A Stable Materialization Read Contract

Status: proposed
Priority: high

Why:

- rematerialization must not depend on internal table layout details

Done when:

- a unified reader or SQL view exposes materializable artifacts consistently
- `artifact-store materialize` uses that contract
- rematerialization works across old and new schema layouts

### DBS-10 - Add Migration `0004_materialization_contract`

Status: proposed
Priority: medium

Why:

- a durable materialization surface reduces coupling between storage layout and runtime code

Done when:

- migration adds `v_materializable_artifacts` or equivalent stable surface
- materialization code no longer depends on direct legacy-column assumptions

### DBS-11 - Normalize Hot Artifact Subtypes

Status: proposed
Priority: medium

Why:

- too many hot artifacts are still found primarily through `path` heuristics

Done when:

- hot operational artifacts have explicit normalized `subtype`
- runtime queries can rely on subtype-first resolution for common cases

### DBS-12 - Add Hot Composite Indexes

Status: proposed
Priority: medium

Why:

- new structures still need index support tailored to actual runtime queries

Done when:

- indexes exist for hot artifact access patterns
- index additions are justified by real query usage

### DBS-13 - Extend Schema Migration Test Coverage

Status: proposed
Priority: high

Why:

- migration safety has to be proven, not assumed

Done when:

- `verify-db-schema-migrations-fixtures` covers the new migration chain
- tests cover fresh bootstrap and legacy adoption
- tests verify preserved artifact rows and expected schema state

### DBS-14 - Add Rematerialization Round-Trip Tests

Status: proposed
Priority: high

Why:

- the core contract is reconstructibility from SQLite

Done when:

- tests validate `file -> db -> materialize`
- tests compare hashes or deterministic content
- tests cover hot operational artifacts and append-style artifacts

### DBS-15 - Add `dual` Compatibility Regression Tests

Status: proposed
Priority: high

Why:

- `dual` is a hard compatibility requirement

Done when:

- tests prove write-through still works
- tests prove deleting projected files and rematerializing from SQLite succeeds
- tests prove `db-only -> dual` transition remains functional

### DBS-16 - Validate On `gowire`

Status: proposed
Priority: medium

Why:

- the migration has to hold on a real installed target, not only on fixtures

Done when:

- migration runs cleanly on `gowire`
- readiness remains green
- selected workflow artifacts can be rematerialized from SQLite

## Recommended Execution Order

1. `DBS-01`
2. `DBS-02`
3. `DBS-03`
4. `DBS-04`
5. `DBS-05`
6. `DBS-06`
7. `DBS-07`
8. `DBS-08`
9. `DBS-09`
10. `DBS-10`
11. `DBS-11`
12. `DBS-12`
13. `DBS-13`
14. `DBS-14`
15. `DBS-15`
16. `DBS-16`

## First Safe Slice

The first safe slice should be:

- `DBS-01`
- `DBS-02`
- `DBS-03`
- `DBS-04`
- `DBS-13`

This delivers:

- an explicit reconstruction contract
- a low-risk additive migration
- fast access to hot runtime artifacts
- early validation on fresh and legacy databases

## Deferred Until Proven Safe

These items should not happen in the first slice:

- removing legacy payload columns from `artifacts`
- stopping dual-write before migration rollout is validated
- making `runtime_heads` authoritative for rematerialization

Those changes should only be revisited after migration, round-trip, and `dual` regression coverage is green.
