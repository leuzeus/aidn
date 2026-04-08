# Plan - Runtime SQLite/PostgreSQL Backend Abstraction

Date: 2026-04-05
Status: proposed, codebase-validated
Scope: define a safe architecture plan for making the remaining runtime persistence surfaces work with either SQLite or PostgreSQL, including explicit backend selection, install-time adoption from an existing SQLite database, and SOLID remediation before widening backend support.

Reference plans:

- `docs/PLAN_WORKTREE_POSTGRESQL_2026-03-27.md`
- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`
- `docs/MIGRATION_SHARED_RUNTIME_POSTGRESQL.md`

## Why A New Plan Is Needed

The current PostgreSQL work completed so far is real, but intentionally limited.

Today the repository supports:

- PostgreSQL for shared coordination across worktrees/projects
- SQLite for the local DB-first runtime projection, fileless reconstruction, repair-layer reads, and most runtime DB administration

That split was correct for the previous milestone. It is no longer sufficient for the next one.

The new problem is not "add more PostgreSQL somewhere". The actual problem is:

- the remaining runtime persistence still depends directly on SQLite internals
- backend selection is not modeled explicitly enough
- installation and migration flows do not yet know how to detect and adopt an existing SQLite runtime into PostgreSQL
- several current abstractions are too narrow or misleading for a true `sqlite | postgres` runtime backend choice

## Validated Baseline

The current codebase already proves the following:

- PostgreSQL shared coordination exists and is project-scoped
- shared runtime remains explicit and does not externalize `docs/audit/*`
- `.aidn/runtime/index/workflow-index.sqlite` remains the local compat projection even when shared coordination uses PostgreSQL
- install defaults are still DB-backed through SQLite-oriented projection choices (`runtime.stateMode=dual`, `install.artifactImportStore=dual-sqlite`)
- `db-status`, `db-migrate`, and `db-backup` are still SQLite-only runtime admin flows
- many runtime readers still load directly from SQLite helpers such as `readIndexFromSqlite(...)`

Current code signals:

- `src/core/ports/workflow-state-store-port.mjs`
- `src/adapters/runtime/workflow-state-store-adapter.mjs`
- `src/application/runtime/shared-state-backend-service.mjs`
- `src/lib/sqlite/workflow-db-schema-lib.mjs`
- `src/lib/sqlite/index-sqlite-lib.mjs`
- `src/lib/index/index-store.mjs`
- `src/application/install/artifact-import-service.mjs`
- `tools/runtime/db-status.mjs`
- `tools/runtime/db-migrate.mjs`

## Deep Analysis Of The Current Gap

### 1. The code has backend seams, but not for the right runtime scope

There are real abstractions already:

- `SharedCoordinationStore` for PostgreSQL shared coordination
- `SharedStateBackend` for reading the shared/local SQLite compatibility snapshot
- `WorkflowStateStore` for writing index projections

However, those seams do not cover the full runtime persistence problem.

`WorkflowStateStore` only writes projections. It does not model:

- reading artifacts
- reading runtime heads
- reading repair-layer state
- schema inspection and migration
- adoption/transfer between backends

As a result, the write path is partially abstracted, while the read/admin path still depends on SQLite directly.

### 2. "DB backend" is currently conflated with "projection format"

The current config model still revolves around:

- `stateMode`
- `indexStoreMode`
- `artifactImportStore`
- shared runtime locator backend for coordination

That is not enough to express:

- canonical runtime persistence backend = `sqlite` or `postgres`
- local projection/cache policy = keep JSON/SQL/SQLite export or not
- shared coordination backend = `none | sqlite-file | postgres`

If PostgreSQL for runtime artifacts is forced through `artifactImportStore` or `indexStoreMode`, the contract will remain ambiguous and fragile.

### 3. Runtime reads violate dependency inversion

Many runtime and codex use cases import SQLite helpers directly:

- `src/application/runtime/repair-layer-*.mjs`
- `src/application/runtime/index-sync-*.mjs`
- `src/application/runtime/reload-check-use-case.mjs`
- `src/application/runtime/gating-observation-service.mjs`
- `src/application/codex/hydrate-context-use-case.mjs`

This means adding PostgreSQL for the remaining runtime elements would require editing many use cases instead of swapping adapters behind stable ports.

### 4. The current "shared state backend" name is semantically misleading

`resolveSharedStateBackend(...)` always returns a SQLite-backed compatibility reader.

Even when shared coordination is PostgreSQL, the returned backend is still:

- projection backend kind = `sqlite`
- projection scope = `local-compat`

That behavior is valid for the current milestone, but the abstraction name now hides an important distinction:

- coordination backend
- canonical runtime artifact backend
- local compatibility projection backend

If this ambiguity stays in place, future PostgreSQL artifact support will produce an API that is technically working but conceptually inconsistent.

### 5. The migration model is incomplete for backend adoption

Current migrations cover:

- SQLite schema adoption/evolution
- PostgreSQL shared-coordination bootstrap/upgrade

What does not exist yet:

- an adoption planner for `sqlite -> postgres` runtime artifacts
- install-time inspection of an existing SQLite runtime when PostgreSQL is requested
- target backend inspection that can say `noop`, `bootstrap-required`, `transfer-required`, `conflict`, or `repair-required`
- explicit transfer/backfill logic for missing runtime tables or empty PostgreSQL artifact stores

That missing piece is central to the user request.

## SOLID Assessment

The codebase is not globally unsound, but the runtime persistence area needs remediation before backend expansion.

### Single Responsibility Principle

`src/lib/sqlite/workflow-db-schema-lib.mjs` currently owns too many concerns:

- SQLite connection bootstrap
- schema inspection
- schema migration
- backup creation
- table/index/view evolution
- artifact blob/runtime head rebuild logic

`src/lib/index/index-store.mjs` also mixes:

- JSON export
- SQL export
- SQLite schema bootstrap
- SQLite data write model
- payload normalization

These responsibilities should be separated before a PostgreSQL artifact backend is introduced.

### Open/Closed Principle

The runtime is not yet open for a new artifact backend. Adding PostgreSQL currently implies modifying:

- use cases
- CLI commands
- config resolution
- direct SQLite helper imports

That is a signal the extension points are still at the wrong level.

### Liskov Substitution Principle

The current `SharedStateBackend` can only substitute between SQLite locations/scopes, not between true artifact backends.

Its name suggests interchangeability of persistence backends, but its behavior is narrower. That mismatch should be corrected to avoid false substitutability.

### Interface Segregation Principle

The current ports are split in a way that leaves consumers with no backend-neutral read/admin interface:

- one write-only store
- one read-only compatibility snapshot backend
- one shared-coordination store

Consumers need smaller but better-targeted interfaces for:

- runtime artifact reads/writes
- runtime schema/admin operations
- backend adoption/transfer planning

### Dependency Inversion Principle

Application services should depend on runtime persistence ports, not on SQLite libraries.

This is the most important remediation item because it determines whether PostgreSQL support becomes a clean adapter addition or a broad rewrite.

## Hard Invariants

Any implementation must preserve the following:

1. `docs/audit/*`, `AGENTS.md`, `.codex/*`, and other checkout-bound artifacts stay checkout-bound.
2. `files | dual | db-only` remain state-mode semantics, not backend semantics.
3. Shared coordination and runtime artifact persistence remain distinct concerns, even if both may use PostgreSQL.
4. Existing SQLite users must keep a stable local path with no forced PostgreSQL adoption.
5. Backend adoption must be explicit and inspectable, never silent and destructive.
6. Install-time detection must prefer `dry-run` planning semantics before transfer.

## Recommended Target Architecture

### Layer 1 - Runtime Persistence Contract

Introduce explicit runtime artifact persistence concepts separate from projection mode and shared coordination:

- canonical runtime backend: `sqlite | postgres`
- local projection/cache policy: `keep-local-sqlite | keep-json | keep-sql | none`
- shared coordination backend: `none | sqlite-file | postgres`

Suggested config direction:

- `.aidn/config.json` gains a dedicated `runtime.persistence` section
- current `runtime.stateMode` remains unchanged
- current `install.artifactImportStore` becomes a projection/import concern, not the canonical DB backend selector

### Layer 2 - Backend-Neutral Ports

Do not create one giant port. Split by responsibility.

Recommended ports:

- `RuntimeArtifactStorePort`
  - read/write artifact payloads
  - read/write runtime heads
  - read/write repair-layer entities that belong to canonical runtime persistence
- `RuntimePersistenceAdminPort`
  - inspect schema/status
  - bootstrap/migrate schema
  - backup/export metadata needed for rollback
- `RuntimeBackendAdoptionPort` or planner service
  - inspect source backend
  - inspect target backend
  - compute adoption action
  - execute transfer/backfill when explicitly allowed

The existing SQLite logic should be wrapped behind these ports before PostgreSQL support is added.

### Layer 3 - Backend Resolver/Factory

Introduce one resolver that decides the effective runtime artifact backend from:

1. CLI override
2. environment override
3. project config
4. compatibility fallback from current SQLite defaults

That resolver must be separate from:

- workspace/shared-runtime resolution
- index projection mode resolution
- state-mode resolution

### Layer 4 - SQLite Adapter As Compatibility Baseline

The first adapter under the new ports should be SQLite, implemented by wrapping current logic from:

- `workflow-db-schema-lib`
- `index-sqlite-lib`
- `index-store`

This keeps current behavior stable while removing direct SQLite imports from application services.

### Layer 5 - PostgreSQL Runtime Artifact Adapter

Add a PostgreSQL artifact schema and adapter for the remaining SQLite-only elements:

- artifacts
- runtime heads
- reconstructible blob/content payloads
- repair-layer canonical tables that should participate in runtime persistence
- schema/admin metadata needed for inspection and migration

This is distinct from the existing shared-coordination schema and should stay explicit in naming and ownership.

### Layer 6 - Adoption Planner And Transfer Pipeline

Add one explicit adoption planner for backend switching.

When PostgreSQL is explicitly requested, the planner must inspect:

- current SQLite file existence
- SQLite schema health
- whether SQLite contains canonical runtime rows
- PostgreSQL connection/health
- PostgreSQL runtime artifact schema status
- whether required target tables are missing or empty
- whether the target already contains conflicting runtime data

Expected planner outcomes:

- `noop`
- `bootstrap-target`
- `migrate-target`
- `transfer-from-sqlite`
- `repair-target`
- `blocked-conflict`

The install flow and explicit backend-switch flow should consume this planner instead of open-coding detection.

## Install-Time Migration Requirement

When install or reconfiguration explicitly requests PostgreSQL runtime persistence:

1. resolve requested backend
2. inspect local SQLite runtime
3. inspect PostgreSQL target contract
4. if local SQLite exists and PostgreSQL target is incomplete or missing tables, mark transfer required
5. if PostgreSQL target is healthy but empty, allow initial transfer
6. if PostgreSQL target is partially populated, compare fingerprints and block on drift/conflict
7. record the adoption result in a durable, inspectable way

The key rule is:

- missing target tables or empty target rows are an adoption condition
- ambiguous partial target state is a stop condition, not an auto-merge condition

## CLI Surface Direction

The current `db-*` names are too generic for SQLite-only behavior.

Two acceptable directions exist:

### Option A - Keep `db-*`, make them backend-aware

Pros:

- less churn for users

Cons:

- requires careful output so users know which backend is being inspected or migrated

### Option B - Split runtime persistence admin explicitly

Examples:

- `runtime persistence-status`
- `runtime persistence-migrate`
- `runtime persistence-adopt`

Pros:

- clearer semantics

Cons:

- larger CLI surface change

Recommendation:

- keep `db-*` as compatibility aliases
- add backend-aware or persistence-aware commands as the canonical contract

## Delivery Phases

### Phase 0 - Contract Freeze And SOLID Remediation

Deliverables:

- freeze backend vocabulary
- separate runtime artifact backend from state mode and projection mode
- introduce the new ports
- move SQLite-specific imports out of application services

Exit condition:

- application services no longer import SQLite helpers directly for canonical runtime persistence

### Phase 1 - SQLite Adapter Behind New Ports

Deliverables:

- SQLite adapter implementing runtime artifact store/admin contracts
- parity with current `files | dual | db-only` behavior
- compatibility wrappers for current CLI/use cases

Exit condition:

- current runtime behavior is preserved with no direct SQLite dependency in application layer

### Phase 2 - PostgreSQL Runtime Artifact Schema And Adapter

Deliverables:

- explicit PostgreSQL runtime artifact schema
- adapter for runtime artifact reads/writes/admin
- health/status inspection for the new schema

Exit condition:

- runtime artifact persistence can be resolved to either SQLite or PostgreSQL

### Phase 3 - Adoption Planner And Transfer

Deliverables:

- source/target inspection model
- install-time adoption planner
- explicit transfer from SQLite to PostgreSQL
- drift/conflict detection

Exit condition:

- explicit PostgreSQL selection can safely adopt an existing SQLite runtime when appropriate

### Phase 4 - CLI And Install Integration

Deliverables:

- backend-aware persistence admin commands
- install flow integration
- explicit `dry-run` adoption output
- stored adoption metadata and diagnostics

Exit condition:

- installation can tell the user whether migration is required before mutating state

### Phase 5 - Hardening And Rollout

Deliverables:

- parity fixtures
- round-trip verification
- worktree/postgres artifact validation
- docs and migration guide

Exit condition:

- SQLite and PostgreSQL runtime persistence are both supported without hidden behavioral drift

## Main Risks

### 1. Mixing Runtime Artifact Backend With Shared Coordination Backend

Risk:

- PostgreSQL artifact persistence and PostgreSQL shared coordination become coupled accidentally

Mitigation:

- keep separate contracts, schemas, and resolvers

### 2. Breaking DB-First/Fileless Readers

Risk:

- refactoring reads before the compatibility adapter is stable causes regressions

Mitigation:

- land SQLite adapter parity before PostgreSQL artifact support

### 3. Silent Partial Migration

Risk:

- install writes some data into PostgreSQL while SQLite remains authoritative

Mitigation:

- adoption planner must classify partial target states explicitly and block on ambiguity

### 4. Expanding Scope Too Early

Risk:

- trying to migrate every runtime table and every helper at once will create a brittle rewrite

Mitigation:

- start with the canonical runtime artifact store and its admin/adoption surfaces

## Success Criteria

This initiative is successful when:

- runtime artifact persistence backend is explicit and orthogonal to state mode
- application services depend on runtime persistence ports instead of SQLite helpers
- SQLite remains fully supported
- PostgreSQL supports the remaining runtime persistence elements still tied to SQLite today
- install can detect an existing SQLite runtime and decide whether PostgreSQL bootstrap/transfer is required
- missing PostgreSQL tables trigger explicit adoption planning, not silent failure
- partial/conflicting target states are surfaced clearly
- worktree and shared-coordination behavior already implemented remain intact
