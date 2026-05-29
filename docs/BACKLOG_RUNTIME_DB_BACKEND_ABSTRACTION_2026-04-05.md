# Backlog - Runtime SQLite/PostgreSQL Backend Abstraction

Date: 2026-04-05
Status: proposed
Scope: executable backlog for introducing a real runtime artifact backend abstraction (`sqlite | postgres`), remediating current SOLID issues in the persistence layer, and adding install-time adoption/transfer from an existing SQLite runtime when PostgreSQL is explicitly requested.

Reference plan:

- `docs/PLAN_RUNTIME_DB_BACKEND_ABSTRACTION_2026-04-05.md`

Reference previous scope:

- `docs/PLAN_WORKTREE_POSTGRESQL_2026-03-27.md`
- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`

## Delivery Rules

- do not regress `files | dual | db-only`
- do not externalize `docs/audit/*`, `AGENTS.md`, or `.codex/*`
- do not overload `artifactImportStore` or `indexStoreMode` with canonical backend meaning
- land SOLID remediation before introducing the PostgreSQL artifact adapter
- block on ambiguous partial migrations instead of auto-merging source and target state

## Priority Legend

- **P0**: architecture-defining and blocking
- **P1**: core implementation slices
- **P2**: hardening and migration safety
- **P3**: rollout and documentation

## P0 - Contract Freeze And SOLID Remediation

### RDBA-1. Freeze Runtime Persistence Vocabulary
**Priority:** P0  
**Status:** proposed

Goal:

- define the meaning of:
  - canonical runtime artifact backend
  - local projection/cache policy
  - shared coordination backend
  - backend adoption/transfer

Done when:

- the config and CLI vocabulary no longer conflates backend choice with state mode or projection mode
- later backlog items can refer to one stable terminology set

### RDBA-2. Add Dedicated Runtime Persistence Config Contract
**Priority:** P0  
**Status:** proposed

Goal:

- introduce a dedicated config shape for runtime artifact backend selection

Dependencies:

- RDBA-1

Done when:

- `.aidn/config.json` can express runtime artifact backend choice explicitly
- current `runtime.stateMode` remains unchanged
- current `install.artifactImportStore` remains projection/import oriented

### RDBA-3. Extract Backend-Neutral Runtime Persistence Ports
**Priority:** P0  
**Status:** proposed

Goal:

- replace the current asymmetric write-only/read-only split with ports that match the real runtime persistence problem

Dependencies:

- RDBA-1

Done when:

- there are explicit contracts for:
  - runtime artifact reads/writes
  - runtime schema/admin operations
  - adoption planning/transfer
- the application layer can depend on those ports instead of SQLite helpers

### RDBA-4. Remove Direct SQLite Dependencies From Application Services
**Priority:** P0  
**Status:** proposed

Goal:

- remediate the current DIP violation before adding a second artifact backend

Dependencies:

- RDBA-3

Done when:

- runtime and codex use cases no longer import `readIndexFromSqlite(...)`, `DatabaseSync`, or SQLite schema helpers directly for canonical runtime persistence
- backend selection happens through ports/factories

## P1 - SQLite Compatibility Baseline

### RDBA-5. Implement SQLite Runtime Artifact Adapter
**Priority:** P1  
**Status:** proposed

Goal:

- wrap current SQLite logic behind the new runtime persistence ports

Dependencies:

- RDBA-3
- RDBA-4

Done when:

- SQLite preserves current behavior for:
  - artifact persistence
  - runtime heads
  - reconstructible blobs
  - repair-layer canonical tables
  - schema inspection and migration

### RDBA-6. Add Backend Resolver For Runtime Artifact Persistence
**Priority:** P1  
**Status:** proposed

Goal:

- centralize selection of the effective runtime artifact backend

Dependencies:

- RDBA-2
- RDBA-5

Done when:

- one resolver computes the effective runtime artifact backend from CLI, env, config, and compatibility fallback
- callers stop hardcoding SQLite file paths as the canonical backend choice

### RDBA-7. Make Runtime Admin Commands Backend-Aware
**Priority:** P1  
**Status:** proposed

Goal:

- stop exposing generic `db-*` commands that are SQLite-only in behavior

Dependencies:

- RDBA-5
- RDBA-6

Done when:

- the canonical runtime admin contract exposes backend-aware status/migrate/backup semantics
- current `db-*` commands are either upgraded or preserved as explicit compatibility aliases

## P1 - PostgreSQL Runtime Artifact Support

### RDBA-8. Define PostgreSQL Runtime Artifact Schema
**Priority:** P1  
**Status:** proposed

Goal:

- create an explicit PostgreSQL schema for the remaining runtime persistence scope still tied to SQLite

Dependencies:

- RDBA-3
- RDBA-5

Done when:

- the PostgreSQL artifact schema scope is documented clearly
- it is distinct from shared coordination schema ownership
- required tables/indexes/views for artifact/runtime-head/blob semantics are explicit

### RDBA-9. Implement PostgreSQL Runtime Artifact Adapter
**Priority:** P1  
**Status:** proposed

Goal:

- make runtime artifact persistence work on PostgreSQL through the same ports used by SQLite

Dependencies:

- RDBA-6
- RDBA-8

Done when:

- runtime artifact reads/writes work with PostgreSQL
- schema inspection/health is available for PostgreSQL artifact persistence
- the adapter is swappable through the backend resolver

### RDBA-10. Preserve Shared Coordination Boundary
**Priority:** P1  
**Status:** proposed

Goal:

- ensure PostgreSQL runtime artifact support does not collapse into the existing shared coordination contract

Dependencies:

- RDBA-8
- RDBA-9

Done when:

- shared coordination and runtime artifact persistence remain separate contracts and schemas
- worktree/shared-coordination flows continue to behave as today

## P1 - Adoption And Transfer

### RDBA-11. Add Source/Target Adoption Planner
**Priority:** P1  
**Status:** proposed

Goal:

- inspect source SQLite and target PostgreSQL and compute whether adoption is required

Dependencies:

- RDBA-3
- RDBA-6
- RDBA-9

Done when:

- the planner can emit:
  - `noop`
  - `bootstrap-target`
  - `migrate-target`
  - `transfer-from-sqlite`
  - `repair-target`
  - `blocked-conflict`

### RDBA-12. Detect Missing PostgreSQL Tables Or Empty Target State
**Priority:** P1  
**Status:** proposed

Goal:

- implement the specific migration trigger requested by the user

Dependencies:

- RDBA-11

Done when:

- explicit PostgreSQL selection inspects the target artifact schema
- missing required tables or empty canonical rows trigger transfer planning when SQLite source data exists
- ambiguous partial target states are surfaced as blocking conflicts

### RDBA-13. Implement Explicit SQLite -> PostgreSQL Transfer
**Priority:** P1  
**Status:** proposed

Goal:

- add the actual transfer/backfill path once the planner says it is safe

Dependencies:

- RDBA-11
- RDBA-12

Done when:

- transfer can bootstrap/migrate the target schema first
- transfer writes canonical runtime artifact data into PostgreSQL
- transfer records verifiable post-conditions and adoption metadata

## P1 - Install And Reconfiguration Integration

### RDBA-14. Integrate Backend Planning Into Install Flow
**Priority:** P1  
**Status:** proposed

Goal:

- make install aware of backend adoption instead of only import-store projection choices

Dependencies:

- RDBA-2
- RDBA-11
- RDBA-13

Done when:

- install can request `sqlite` or `postgres` as the canonical runtime artifact backend
- install detects an existing SQLite runtime before mutating target state
- install produces `dry-run` style adoption output

### RDBA-15. Add Explicit Backend Switch/Re-anchor Flow For Runtime Artifacts
**Priority:** P1  
**Status:** proposed

Goal:

- support backend changes after install without ad hoc manual sequences

Dependencies:

- RDBA-13
- RDBA-14

Done when:

- one flow can move or adopt canonical runtime artifact storage between backends
- switch results are inspectable and reversible at the operational level

## P2 - Hardening And Regression Coverage

### RDBA-16. Add SQLite/PostgreSQL Parity Fixtures
**Priority:** P2  
**Status:** proposed

Goal:

- prove that both adapters honor the same runtime artifact contract

Dependencies:

- RDBA-5
- RDBA-9

Done when:

- the same fixture payload can be persisted and re-read from SQLite and PostgreSQL with contract-level parity

### RDBA-17. Add Adoption Conflict And Partial-State Fixtures
**Priority:** P2  
**Status:** proposed

Goal:

- lock the safety behavior around migration detection

Dependencies:

- RDBA-11
- RDBA-12
- RDBA-13

Done when:

- tests cover:
  - missing target tables
  - empty target backend
  - partially populated target backend
  - target/source fingerprint mismatch
  - blocked conflict behavior

### RDBA-18. Add DB-First/Fileless Regression Coverage On Both Backends
**Priority:** P2  
**Status:** proposed

Goal:

- preserve the current runtime usability guarantees during the refactor

Dependencies:

- RDBA-5
- RDBA-9

Done when:

- DB-first readers, runtime heads, repair-layer flows, and fileless reconstruction remain valid under the intended backend combinations

### RDBA-19. Add Worktree/PostgreSQL Runtime Artifact Validation
**Priority:** P2  
**Status:** proposed

Goal:

- ensure the new runtime artifact backend does not break the existing worktree/shared runtime model

Dependencies:

- RDBA-9
- RDBA-10

Done when:

- linked worktree fixtures prove stable behavior when canonical runtime artifacts live in PostgreSQL
- shared coordination behavior remains distinct and correct

### RDBA-20. Add Observability For Adoption And Drift
**Priority:** P2  
**Status:** proposed

Goal:

- surface enough diagnostics for operators to trust backend adoption

Dependencies:

- RDBA-11
- RDBA-13

Done when:

- status/doctor outputs can explain:
  - effective canonical backend
  - source backend presence
  - target schema readiness
  - transfer requirement
  - drift/conflict state

## P3 - Rollout

### RDBA-21. Write Migration Guide For SQLite -> PostgreSQL Runtime Adoption
**Priority:** P3  
**Status:** proposed

Goal:

- document safe incremental adoption for existing repositories

Dependencies:

- RDBA-13
- RDBA-14
- RDBA-20

Done when:

- migration docs cover stay-on-SQLite, adopt-PostgreSQL, rollback expectations, and conflict handling

### RDBA-22. Validate On A Real Repository Pilot
**Priority:** P3  
**Status:** proposed

Goal:

- prove the backend abstraction and transfer path outside fixtures

Dependencies:

- RDBA-16
- RDBA-17
- RDBA-19

Done when:

- at least one real repository validates:
  - existing SQLite runtime detection
  - explicit PostgreSQL request
  - target bootstrap or migration
  - transfer when tables are missing
  - stable runtime behavior after adoption

### RDBA-23. Define Compatibility Window And Cleanup
**Priority:** P3  
**Status:** proposed

Goal:

- avoid indefinite ambiguity in config and CLI behavior

Dependencies:

- RDBA-21
- RDBA-22

Done when:

- docs state how long compatibility aliases and fallback behaviors remain supported
- cleanup steps are sequenced after pilot validation, not before

## Recommended Execution Order

1. RDBA-1 to RDBA-4
2. RDBA-5 to RDBA-7
3. RDBA-8 to RDBA-10
4. RDBA-11 to RDBA-15
5. RDBA-16 to RDBA-20
6. RDBA-21 to RDBA-23

## Minimum Viable Milestone

The first milestone should be considered complete only when:

- the application layer no longer depends directly on SQLite helpers for canonical runtime persistence
- backend choice for runtime artifacts is explicit
- SQLite remains fully functional behind the new ports
- PostgreSQL runtime artifact support exists for the remaining SQLite-bound scope
- explicit PostgreSQL selection can detect an existing SQLite runtime and determine whether transfer is required because the PostgreSQL target is missing tables or canonical rows
