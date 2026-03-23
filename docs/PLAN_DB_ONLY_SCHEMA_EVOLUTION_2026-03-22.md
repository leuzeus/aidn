# Plan - DB-Only Schema Evolution

Date: 2026-03-22
Status: proposed
Scope: optimize the SQLite data model used by `db-only` while preserving `dual` compatibility and guaranteeing artifact rematerialization from the database.

## Problem Statement

The current SQLite schema is functionally sufficient for `db-only`, but it is still optimized more as a generic payload store than as an AI-oriented runtime consultation store.

Observed constraints:

- `db-only` must remain a DB-first consultation mode
- `dual` must remain fully supported
- artifacts must stay reconstructible from SQLite alone
- any schema change must go through additive migrations with data backfill

The main issue is not correctness anymore. It is structure efficiency:

- hot runtime reads still tend to reconstruct broad SQLite payloads
- `artifacts` mixes lookup metadata and large payload fields
- hot workflow artifacts are not exposed through a dedicated fast-access structure
- artifact classification is still too path-dependent for the most common runtime queries

## Hard Invariants

Any schema evolution must preserve the following invariants.

### 1. `dual` remains first-class

The system must continue to support:

- write-through file + SQLite flows
- file repair from SQLite
- DB repair from file when applicable

Schema optimization for `db-only` must not degrade `dual`.

### 2. SQLite remains reconstructible

SQLite must remain sufficient to rematerialize operational artifacts, including at least:

- `CURRENT-STATE.md`
- `RUNTIME-STATE.md`
- `HANDOFF-PACKET.md`
- `AGENT-ROSTER.md`
- `AGENT-HEALTH-SUMMARY.md`
- `AGENT-SELECTION-SUMMARY.md`
- `MULTI-AGENT-STATUS.md`
- `COORDINATION-SUMMARY.md`

This means the schema must retain the rendered content or an equivalent deterministic reconstruction source.

### 3. Migrations are additive first

The baseline migration must not be rewritten.

Evolution must be done through:

- new migration ids in the migration registry
- data backfill during migration
- dual-read compatibility during transition
- dual-write compatibility where storage layout is being split

### 4. Materialization must stay stable

`artifact-store materialize` must continue to work across:

- fresh databases
- legacy databases adopted into migrations
- partially transitioned databases

The materialization path must depend on a stable read contract, not on fragile physical table assumptions.

## Current Structural Weaknesses

### 1. The schema is not optimized for hot runtime lookups

The current model is good at storing artifacts, but not ideal for repeatedly answering:

- what is the current runtime state
- what is the active handoff packet
- what is the active agent roster
- what is the current multi-agent status

These are hot reads and should not require broad payload reconstruction.

### 2. `artifacts` mixes hot and cold data

The same row currently carries:

- lookup metadata
- relationship anchors
- rendered content
- canonical JSON payload

That is convenient, but not optimal for an AI runtime that mostly needs fast routing and only occasionally needs full payload bytes.

### 3. Hot artifacts lack a dedicated read model

The system has enough information to reconstruct operational artifacts, but it lacks a compact index for the most frequently consulted runtime artifacts.

### 4. Storage layout and materialization contract are too tightly coupled

If the payload layout changes, rematerialization risks becoming harder unless it is moved behind a stable reader or view contract.

## Target Architecture

The optimized model should separate three concerns.

### 1. Reconstructible artifact source of truth

One layer must remain lossless and materializable.

That source of truth must carry:

- artifact identity
- classification
- content or deterministic render source
- canonical payload where relevant
- integrity metadata

### 2. Hot runtime lookup layer

One layer should serve the most common AI/runtime queries with O(1) or near-O(1) access:

- current state
- runtime state
- handoff packet
- agent roster
- agent summaries
- coordination summary

This layer is an accelerator, not a replacement for reconstructible storage.

### 3. Stable materialization contract

The rematerialization path should consume a stable logical projection, even if physical storage moves across tables.

## Migration Strategy

### Phase 1 - Add Hot Runtime Heads

Add a `runtime_heads` table as a derived lookup structure for the most frequently consulted artifacts.

Purpose:

- accelerate AI/runtime reads
- avoid full payload reconstruction for hot workflow artifacts
- preserve the current `artifacts` table untouched as reconstructible source

This phase is low risk because it only adds and backfills.

### Phase 2 - Split Payload Blobs From Hot Metadata

Add an `artifact_blobs` table and backfill payload columns from `artifacts`.

Purpose:

- reduce hot-row width in `artifacts`
- separate lookup metadata from large content
- preserve full reconstructibility

During transition:

- readers must support both layouts
- writers must dual-write
- rematerialization must use a stable unified reader

### Phase 3 - Add Stable Materialization View

Add a view such as `v_materializable_artifacts` that exposes:

- path
- classification
- content fields
- canonical payload
- hash/size metadata
- session/cycle anchors

This gives one stable rematerialization surface regardless of underlying storage layout.

### Phase 4 - Normalize Hot Artifact Classification

Promote explicit `subtype` usage for hot operational artifacts and add targeted indexes.

This reduces dependence on path heuristics and makes runtime query logic more declarative.

### Phase 5 - Retire Legacy Blob Reads

Only after broad validation:

- stop reading legacy payload columns from `artifacts`
- keep compatibility window long enough to cover migrated client repos

Physical cleanup can remain deferred if SQLite limitations make column removal not worth the risk.

## Proposed Migration Sequence

### `0002_runtime_heads`

Add:

- `runtime_heads`
- indexes for `artifact_path`
- indexes for `session_id/cycle_id`

Backfill:

- derive head rows from `artifacts` using `subtype` first, then controlled `path` fallback

No existing data is moved or deleted.

### `0003_artifact_blobs_split`

Add:

- `artifact_blobs`

Backfill:

- copy payload fields from `artifacts` into `artifact_blobs`
- skip rows already backfilled so reruns stay idempotent

Transition policy:

- dual-read
- dual-write
- no destructive cleanup yet

### `0004_materialization_contract`

Add:

- `v_materializable_artifacts`

Purpose:

- unify materialization reads across pre-split and post-split schemas

### `0005_hot_subtypes_and_indexes`

Add:

- subtype normalization for hot runtime artifacts
- composite indexes to support runtime reads

Examples:

- `artifacts(subtype, updated_at)`
- `artifacts(session_id, subtype)`
- `artifacts(cycle_id, subtype)`

## Data Migration Requirements

Every migration that changes data shape must satisfy these rules.

### 1. Backup before adoption

Use the existing backup behavior in the migration layer before applying pending migrations on non-empty SQLite databases.

### 2. Backfill must be idempotent

Re-running migration logic must not:

- duplicate data
- rewrite newer rows incorrectly
- lose payload bytes

### 3. Validation must be structural and behavioral

Structural validation:

- row counts
- nullable/non-nullable expectations
- index creation

Behavioral validation:

- hot runtime reads still resolve correctly
- rematerialization still works
- `dual` repair flows still work

### 4. Compatibility window is required

During the transition from `artifacts`-embedded payloads to split blobs:

- old readers must keep working
- new readers must prefer the new layout
- writes must maintain both layouts until the transition is complete

## Verification Plan

The migration work is complete only when the following are verified.

### 1. Schema migration fixtures

Extend [tools/perf/verify-db-schema-migrations-fixtures.mjs](G:/projets/aidn/tools/perf/verify-db-schema-migrations-fixtures.mjs) to cover:

- fresh DB bootstrap
- legacy DB adoption
- additive migration chain `0001 -> 0002 -> 0003 -> 0004 -> 0005`

### 2. Rematerialization contract tests

Validate:

- `artifact-store materialize` works after each migration stage
- materialized artifact hashes remain stable where content is unchanged
- hot artifacts can be reconstructed from SQLite without disk originals

### 3. `dual` compatibility tests

Validate:

- write-through still updates DB and file surfaces coherently
- deleting projected files and rematerializing from SQLite succeeds
- switching from `db-only` to `dual` still allows a full artifact rebuild

### 4. Real target validation

Validate against a real installed target such as `gowire`:

- DB migration runs cleanly
- readiness remains green
- selected operational artifacts can be rematerialized from SQLite

## Recommended Execution Order

1. implement `0002_runtime_heads`
2. wire hot readers to use `runtime_heads`
3. implement `0003_artifact_blobs_split`
4. move materialization behind a stable unified read contract
5. add `0004_materialization_contract`
6. normalize hot subtypes and indexes in `0005`
7. expand migration and rematerialization tests
8. validate on a real client repository

## Success Criteria

This plan succeeds when:

- `db-only` reads are measurably cheaper for hot runtime artifacts
- `dual` remains behaviorally unchanged for users
- SQLite alone remains sufficient to reconstruct operational artifacts
- migration adoption is safe on existing client databases
- no schema optimization introduces a new dependency on projected files
