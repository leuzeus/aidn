# Backlog - Runtime PostgreSQL Relational Parity

Date: 2026-04-08
Status: in-progress, codebase-advanced
Scope: executable backlog for making `runtime.persistence.backend=postgres` a true relational replacement for `workflow-index.sqlite`, while applying SOLID remediation to the runtime persistence area and preserving current workflow/runtime invariants.

Reference plan:

- `docs/PLAN_RUNTIME_POSTGRES_RELATIONAL_PARITY_2026-04-08.md`

Reference related plans:

- `docs/PLAN_RUNTIME_DB_BACKEND_ABSTRACTION_2026-04-05.md`
- `docs/PLAN_WORKTREE_POSTGRESQL_2026-03-27.md`
- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`

Reference migration guide:

- `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`

Validation context:

- repository analysis in `G:\projets\aidn`
- real rebuild and drift validation in `G:\projets\gowire`
- recovered artifact corpus in `G:\projets\last_artefact_gowire`

## Progress Snapshot

As of 2026-04-09:

- P0 contract/port/SOLID foundation is materially implemented
- canonical PostgreSQL runtime reads/writes are relational and no longer depend on `runtime_snapshots`
- snapshot-v1 PostgreSQL migration/backfill exists and drains legacy `runtime_snapshots` rows
- runtime admin commands expose canonical relational semantics and compatibility status
- db-first shared-state reads support PostgreSQL canonical runtime when `localProjectionPolicy=none`
- active migration/docs/CLI vocabulary now describes PostgreSQL as relational-canonical and `runtime_snapshots` as legacy compatibility only
- SQLite now exposes symmetric `adoption_events` through schema migration `0006_sqlite_adoption_events`
- PostgreSQL adoption now blocks SQLite sources that reuse one logical `cycle_id` across multiple cycle directories
- runtime CLI now exposes `persistence-source-diagnose` to report duplicated logical `cycle_id` values before any PostgreSQL transfer
- runtime CLI now exposes `persistence-source-normalize` to replay an approved cycle-identity rename mapping on the canonical `docs/audit` source corpus
- real `gowire` source diagnostics confirm 3 blocking logical cycle identity collisions: `C004`, `C005`, `C032`
- a non-destructive normalization proposal exists for `gowire`:
  - `C004-spike-root-structure-investigation` -> `C020-spike-root-structure-investigation`
  - `C005-structural-root-simplification-lot1` -> `C021-structural-root-simplification-lot1`
  - `C032-corrective-component-review-hardening` -> `C034-corrective-component-review-hardening`
- the normalized recovery copy validates end-to-end:
  - SQLite source diagnostics converge to `diagnostic_status=ready`
  - PostgreSQL smoke on `aidn_smoke` converges to `storage_policy=relational-canonical`
  - adoption planner/result converge to `target-matches-source`
- concrete 2026-04-10 CLI replay on `G:\projets\gowire\.aidn\runtime\recovery\2026-04-10-cli-normalized-workspace` is now recorded:
  - `persistence-source-normalize` rewrote `39` files and renamed `3` cycle directories
  - `index-sync --store dual-sqlite --with-content` rebuilt `89` cycles / `74` sessions / `891` artifacts
  - `persistence-adopt --backend postgres --connection-ref env:AIDN_PG_SMOKE_URL` applied successfully on `aidn_smoke`
  - the immediate follow-up dry-run converged to `action=noop` with `reason_code=target-matches-source`
  - target inspection converged to `compatibility_status=relational-ready` with `canonical_payload_rows=1` and `legacy_snapshot_rows=0`
- concrete 2026-04-10 `localProjectionPolicy=none` replay on `G:\projets\gowire\.aidn\runtime\recovery\2026-04-10-postgres-none-smoke` is now recorded:
  - config switched to `runtime.stateMode=db-only`, `runtime.persistence.backend=postgres`, `runtime.persistence.localProjectionPolicy=none`
  - the local `workflow-index.sqlite` projection was removed after adoption
  - `persistence-status` converged to `projection_scope=runtime-canonical`, `compatibility_status=relational-ready`, `action=noop`
  - `project-runtime-state` converged to `shared_state_backend.projection_scope=runtime-canonical` and `current_state_source=postgres`
  - `db-only-readiness` passed with `projection_scope=runtime-canonical` and `current_state_source=postgres`
- concrete 2026-04-10 promoted-copy replay on `G:\projets\gowire-promoted-live-copy-2026-04-10` is now recorded:
  - `artifact-store materialize` rebuilt the promoted copy corpus from the restored live SQLite source (`891` selected artifacts)
  - `persistence-source-normalize` + `index-sync --store dual-sqlite --with-content` converged to `diagnostic_status=ready` with `89` cycles / `74` sessions / `891` artifacts
  - because `index-sync` had already populated the relational target for that `scope_key`, the PostgreSQL scope was backed up then purged before adoption replay
  - `persistence-adopt --backend postgres --connection-ref env:AIDN_PG_URL` then applied successfully on the promoted copy
  - the immediate follow-up dry-run converged to `action=noop` with `reason_code=target-matches-source`
  - final target inspection converged to `compatibility_status=relational-ready` with `canonical_payload_rows=1` and `legacy_snapshot_rows=0`
- concrete 2026-04-10 double-validation replay on `G:\projets\gowire-promoted-live-copy-2026-04-10-validation-2` is now recorded:
  - the second promoted copy was rebuilt independently from the live `.aidn` payload
  - initial diagnostics reproduced the same source blockers as live: `source-cycle-identity-ambiguous` + `source-scope-drift`
  - `persistence-source-normalize` again converged with `directories_renamed=3`
  - `index-sync --store dual-sqlite --with-content` again rebuilt `89` cycles / `74` sessions / `891` artifacts
  - source diagnostics again converged to `diagnostic_status=ready`
  - the same transient PostgreSQL `payload-drift` was reproduced for the new `scope_key`, then cleared via backup + scope purge
  - `persistence-adopt --backend postgres --connection-ref env:AIDN_PG_URL` again applied successfully
  - the immediate follow-up dry-run again converged to `action=noop` with `reason_code=target-matches-source`
  - final target inspection again converged to `compatibility_status=relational-ready` with `canonical_payload_rows=1` and `legacy_snapshot_rows=0`
- concrete 2026-04-10 live replay on `G:\projets\gowire` is now recorded:
  - SQLite, PostgreSQL, and local audit backups were captured before any live rewrite
  - `artifact-store materialize` rebuilt the live `docs/audit` corpus from SQLite
  - `persistence-source-normalize` replayed the approved mapping directly on live and converged with `directories_renamed=3`
  - `index-sync --store dual-sqlite --with-content` rebuilt live as `89` cycles / `74` sessions / `891` artifacts
  - live source diagnostics then converged to `diagnostic_status=ready`
  - the same transient PostgreSQL `payload-drift` was reproduced on the live `scope_key`, then cleared via backup + scope purge
  - `persistence-adopt --backend postgres --connection-ref env:AIDN_PG_URL` applied successfully on live
  - the immediate follow-up dry-run converged to `action=noop` with `reason_code=target-matches-source`
  - final live target inspection converged to `compatibility_status=relational-ready` with `canonical_payload_rows=1` and `legacy_snapshot_rows=0`
- the approved normalization path is now productized as a runtime CLI workflow instead of remaining an implicit manual rewrite
- live PostgreSQL smoke passes on `postgres://root:***@192.168.1.173:5433/aidn_smoke`
- live PostgreSQL smoke fixture now covers the post-transfer `localProjectionPolicy=none` cutover and validates runtime-canonical reads from PostgreSQL
- remaining open work is concentrated in:
  - deciding whether to keep `runtime.persistence.localProjectionPolicy=keep-local-sqlite` on live, or to schedule a dedicated live `localProjectionPolicy=none` cutover

## Delivery Rules

- do not regress `files | dual | db-only`
- do not externalize `docs/audit/*`, `AGENTS.md`, or `.codex/*`
- keep shared coordination and runtime persistence as separate contracts and schemas
- do not claim PostgreSQL parity while canonical reads still depend on SQLite-only structure
- land SOLID remediation in the same execution path, not as optional cleanup later
- block on ambiguous migration inputs rather than auto-merging runtime sources

## Priority Legend

- **P0**: blocking architecture and contract slices
- **P1**: core runtime persistence implementation
- **P2**: migration, hardening, and real-world validation
- **P3**: rollout polish, documentation, and cleanup

## P0 - Contract Freeze And SOLID Foundation

### RPRP-1. Freeze The Meaning Of `runtime.persistence.backend`
**Priority:** P0  
**Status:** completed

Goal:

- define that `runtime.persistence.backend=postgres` means PostgreSQL is the canonical relational runtime backend, not a reduced snapshot sidecar

Done when:

- docs and CLI language no longer imply a weaker meaning
- PostgreSQL runtime parity target is explicit and testable

### RPRP-2. Inventory Canonical SQLite Runtime Structures
**Priority:** P0  
**Status:** completed

Goal:

- create the authoritative list of SQLite runtime tables, views, indexes, and metadata surfaces that define canonical runtime persistence today

Dependencies:

- RPRP-1

Done when:

- every canonical runtime entity is mapped
- each structure is classified as canonical, optimization, admin, or compatibility-only

### RPRP-3. Freeze PostgreSQL Table Policy
**Priority:** P0  
**Status:** completed

Goal:

- decide the final policy for:
  - `runtime_snapshots`
  - `runtime_heads`
  - `adoption_events`
  - `schema_migrations`

Dependencies:

- RPRP-2

Done when:

- canonical tables are distinguished from optimization/admin tables
- `runtime_snapshots` is no longer ambiguous as source-of-truth vs cache/migration artifact

### RPRP-4. Extract Backend-Neutral Canonical Runtime Persistence Ports
**Priority:** P0  
**Status:** completed

Goal:

- define one backend-neutral contract for canonical runtime relational persistence

Dependencies:

- RPRP-1
- RPRP-2

Done when:

- there are explicit ports for:
  - canonical runtime relational reads/writes
  - runtime schema/admin operations
  - backend adoption/migration planning
  - optional admin event recording

### RPRP-5. Remove Direct SQLite Dependencies From Canonical Application Reads
**Priority:** P0  
**Status:** completed

Goal:

- eliminate DIP violations in canonical runtime and Codex read paths

Dependencies:

- RPRP-4

Done when:

- canonical application services no longer import SQLite helpers directly
- backend choice is resolved through ports/factories

### RPRP-6. Split Oversized Runtime Persistence Responsibilities
**Priority:** P0  
**Status:** completed

Goal:

- enforce SRP in the runtime persistence area before widening PostgreSQL support

Dependencies:

- RPRP-4

Done when:

- schema definition/migration, canonical reads/writes, adoption planning, and observability are separated into clear modules
- snapshot-era compatibility logic is isolated from the canonical relational path

## P1 - Relational PostgreSQL Runtime Parity

### RPRP-7. Define PostgreSQL Runtime Relational Schema v2
**Priority:** P1  
**Status:** completed

Goal:

- define a PostgreSQL schema that mirrors the semantic content of `workflow-index.sqlite`

Dependencies:

- RPRP-2
- RPRP-3

Done when:

- PostgreSQL DDL exists for all canonical runtime entities
- key/index/constraint mapping is explicit
- runtime parity can be evaluated table-by-table

### RPRP-8. Implement PostgreSQL Relational Runtime Writer
**Priority:** P1  
**Status:** completed

Goal:

- replace snapshot-only canonical writes with relational writes in PostgreSQL

Dependencies:

- RPRP-4
- RPRP-7

Done when:

- PostgreSQL canonical writes persist relational runtime entities, not only `payload_json`
- `runtime_snapshots` is no longer required as canonical storage

### RPRP-9. Implement PostgreSQL Relational Runtime Reader
**Priority:** P1  
**Status:** completed

Goal:

- make canonical runtime reads work from PostgreSQL without SQLite fallback

Dependencies:

- RPRP-7
- RPRP-8

Done when:

- runtime state, repair-layer data, hot heads, and rematerialization inputs can be read canonically from PostgreSQL
- canonical reads no longer depend on local SQLite presence

### RPRP-10. Preserve Adapter Substitutability Across SQLite And PostgreSQL
**Priority:** P1  
**Status:** completed

Goal:

- enforce LSP for canonical runtime persistence

Dependencies:

- RPRP-8
- RPRP-9

Done when:

- SQLite and PostgreSQL satisfy the same canonical runtime contract
- callers do not need backend-specific branches for correct behavior

### RPRP-11. Make `runtime_heads` Backend-Symmetric
**Priority:** P1  
**Status:** completed

Goal:

- preserve hot lookup performance without creating backend-specific semantics

Dependencies:

- RPRP-3
- RPRP-8
- RPRP-9

Done when:

- `runtime_heads` is either:
  - implemented symmetrically across backends
  - or fully hidden as an internal optimization behind one port contract

### RPRP-12. Add SQLite-Symmetric Adoption/Admin Events
**Priority:** P1  
**Status:** completed

Goal:

- eliminate unnecessary admin asymmetry around backend adoption traces

Dependencies:

- RPRP-3
- RPRP-6

Done when:

- `adoption_events` exists with an equivalent role in SQLite
- or an alternative symmetric admin mechanism is implemented and documented

## P1 - Runtime Command And Config Semantics

### RPRP-13. Align Runtime Admin Commands With Canonical Backend Meaning
**Priority:** P1  
**Status:** completed

Goal:

- make runtime admin commands describe the actual backend of record

Dependencies:

- RPRP-4
- RPRP-9

Done when:

- `persistence-status`, `persistence-migrate`, `persistence-backup`, `db-status`, and `db-migrate` reflect canonical backend semantics accurately
- no command implies PostgreSQL parity while still operating canonically on SQLite only

### RPRP-14. Make `localProjectionPolicy` Real
**Priority:** P1  
**Status:** completed

Goal:

- turn local SQLite from hidden source-of-truth into optional compatibility projection only

Dependencies:

- RPRP-8
- RPRP-9
- RPRP-13

Done when:

- `keep-local-sqlite` works as projection
- `none` works without canonical runtime dependence on local SQLite
- verified by shared-state/db-first fixtures for:
  - existing `local-compat` PostgreSQL shared-runtime behavior
  - canonical PostgreSQL `runtime-canonical` reads with `localProjectionPolicy=none`

## P2 - Migration And Data Safety

### RPRP-15. Add PostgreSQL Snapshot-v1 To Relational-v2 Migration
**Priority:** P2  
**Status:** completed

Goal:

- migrate existing PostgreSQL installs from `runtime_snapshots/runtime_heads` storage to the relational schema

Dependencies:

- RPRP-7
- RPRP-8
- RPRP-9

Done when:

- one explicit migration path exists from snapshot-v1 to relational-v2
- backup and verification are part of the flow

### RPRP-16. Add SQLite To PostgreSQL Relational Transfer
**Priority:** P2  
**Status:** completed

Goal:

- transfer canonical runtime state from SQLite into relational PostgreSQL without collapsing it into one JSONB payload

Dependencies:

- RPRP-8
- RPRP-9
- RPRP-15

Done when:

- adoption planner and execution support relational transfer end-to-end
- post-transfer parity checks are relational, not only snapshot digest checks

### RPRP-17. Block Ambiguous Source/Target States Explicitly
**Priority:** P2  
**Status:** completed

Goal:

- preserve migration safety when both backends contain conflicting runtime state

Dependencies:

- RPRP-15
- RPRP-16

Done when:

- ambiguous states produce explicit blocked outcomes
- no automatic merge path exists for conflicting canonical sources

### RPRP-18. Handle Recovered Data Ambiguities Exposed By Gowire
**Priority:** P2  
**Status:** completed

Goal:

- decide and enforce the policy for duplicated logical `cycle_id` values across multiple cycle directories

Dependencies:

- RPRP-2
- RPRP-7

Done when:

- uniqueness semantics are explicit across both backends
- migration logic handles or blocks duplicated cycle identity deterministically
- runtime CLI can surface the ambiguous logical `cycle_id` values and their conflicting directories without requiring a live PostgreSQL target

## P2 - Verification And Real Validation

### RPRP-19. Add Table-Parity Fixture Coverage
**Priority:** P2  
**Status:** completed

Goal:

- verify SQLite/PostgreSQL parity table-by-table for canonical runtime state

Dependencies:

- RPRP-8
- RPRP-9

Done when:

- fixtures compare row counts, key sets, and hot lookup semantics across backends
- parity is not reduced to comparing one payload digest only

### RPRP-20. Add Migration Fixture Coverage
**Priority:** P2  
**Status:** completed

Goal:

- lock migration safety for:
  - PostgreSQL snapshot-v1 -> relational-v2
  - SQLite -> PostgreSQL relational transfer

Dependencies:

- RPRP-15
- RPRP-16
- RPRP-17

Done when:

- fixture coverage exists for success, blocked-conflict, partial-target, and rollback-safe cases

### RPRP-21. Add Real Smoke Validation On Gowire
**Priority:** P2  
**Status:** in-progress

Goal:

- validate canonical PostgreSQL runtime behavior on the real `gowire` repository

Dependencies:

- RPRP-14
- RPRP-18
- RPRP-19

Done when:

- `gowire` can run with PostgreSQL as canonical runtime backend
- local SQLite can be optional or disabled according to policy
- real parity checks pass after rebuild/adoption

Current evidence:

- dedicated recovery workspace replay passed on 2026-04-10 with normalization, rebuild, PostgreSQL transfer, and post-transfer `noop`
- dedicated recovery workspace replay also passed on 2026-04-10 with `localProjectionPolicy=none` and runtime-canonical PostgreSQL reads after local SQLite removal
- read-only validation on the current live `gowire` workspace shows the remaining blocker is still the un-applied cycle-identity normalization, not a PostgreSQL parity failure
- the remaining gap is rollout execution on a promoted copy of the live workspace

## P3 - Rollout, Cleanup, And Documentation

### RPRP-22. Update Runtime Migration Documentation
**Priority:** P3  
**Status:** completed

Goal:

- document the new meaning of PostgreSQL runtime persistence and the upgrade path from the snapshot model

Dependencies:

- RPRP-15
- RPRP-16

Done when:

- migration docs cover stay-on-SQLite, adopt-PostgreSQL-relational, rollback expectations, and local projection policies

### RPRP-23. Deprecate Snapshot-Era Canonical Language
**Priority:** P3  
**Status:** completed

Goal:

- remove or rewrite documentation and code comments that still imply snapshot-only PostgreSQL runtime persistence is equivalent to SQLite parity

Dependencies:

- RPRP-8
- RPRP-22

Done when:

- docs, CLI help, and status output use one consistent backend vocabulary

### RPRP-24. Remove Canonical Dependence On `runtime_snapshots`
**Priority:** P3  
**Status:** completed

Goal:

- finish the deprecation of `runtime_snapshots` as source-of-truth

Dependencies:

- RPRP-15
- RPRP-19

Done when:

- `runtime_snapshots` is either removed or downgraded to a non-canonical cache/export artifact
- no canonical runtime path requires it

## SOLID Exit Criteria

This backlog is not complete if parity exists but the runtime persistence area remains architecturally unsound.

Completion requires:

- SRP: schema, admin, migration, and canonical persistence are separated clearly
- OCP: backend support extends through stable ports/adapters, not through application-layer branching
- LSP: SQLite and PostgreSQL satisfy the same canonical runtime contract
- ISP: consumers depend only on the interfaces they actually need
- DIP: canonical application services no longer depend directly on SQLite helpers

## Recommended Execution Order

1. RPRP-1 through RPRP-6
2. RPRP-7 through RPRP-14
3. RPRP-15 through RPRP-18
4. RPRP-19 through RPRP-21
5. RPRP-22 through RPRP-24

## Acceptance Summary

The backlog is complete only when:

1. `runtime.persistence.backend=postgres` means PostgreSQL is the canonical relational runtime backend
2. PostgreSQL covers the same canonical runtime entities as `workflow-index.sqlite`
3. SQLite is optional compatibility projection only
4. migration from existing PostgreSQL snapshot installs is supported and verified
5. real validation passes on `gowire`
6. SOLID remediation is visible in the runtime persistence architecture, not just in documentation
