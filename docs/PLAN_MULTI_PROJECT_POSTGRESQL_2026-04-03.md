# Plan - Multi-Project PostgreSQL Support

Date: 2026-04-03
Status: completed
Scope: define a safe, incremental architecture plan for supporting multiple logical AIDN projects in the same PostgreSQL shared-coordination backend without breaking current worktree, local runtime, or DB-first invariants.

Reference RFC:

- `docs/rfc/RFC-0002-multi-project-identity-and-shared-runtime-v2.md`

Reference migration guide:

- `docs/MULTI_PROJECT_POSTGRESQL_MIGRATION_GUIDE.md`

Reference pilot runbook:

- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_PILOT_2026-04-03.md`

Execution snapshot:

- identity, locator v2, PostgreSQL schema v2, and project-scoped services are implemented
- admin/status/doctor/backup/restore surfaces are project-aware
- dedicated fixtures now cover multi-project isolation and nested-project monorepo resolution
- a real pilot on dedicated `G:\projets\gowire` worktrees validates logical project isolation on one shared backend
- a second real pilot on nested roots inside `G:\projets\gowire-pilot-main` validates project scoping against the same `git_common_dir` and the same `worktree_id`
- execution evidence is summarized in `docs/MULTI_PROJECT_POSTGRESQL_GOWIRE_PILOT_2026-04-04.md`

## Problem Statement

The current PostgreSQL implementation is intentionally scoped around shared coordination for one logical `workspace_id` at a time.

That model is sufficient for:

- several worktrees of the same repository
- several processes writing coordination state for the same shared workspace

It is not sufficient for:

- several independent AIDN projects sharing one PostgreSQL database
- several AIDN sub-projects inside the same repository or monorepo
- administrative operations that need to enumerate, inspect, back up, or prune multiple logical projects in the same backend

The issue is not only SQL shape.

In the current design, `workspace_id` is both:

- the logical shared-coordination partition key
- the user-visible identity surfaced in runtime metadata and handoff packets
- the main derived identity produced by the workspace resolver

This coupling is manageable for multi-worktree support, but it is too ambiguous for true multi-project support.

## Validated Baseline

The current codebase already provides the following constraints and capabilities:

- runtime path classes are explicitly documented in `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
- shared runtime is opt-in
- PostgreSQL is explicitly `shared-coordination-only`, not a drop-in replacement for local SQLite
- `docs/audit/*`, `AGENTS.md`, `.codex/*`, and most runtime artifacts remain local or checkout-bound
- the workspace resolver derives `workspace_id` primarily from explicit override, env, locator, `git_common_dir`, `repo_root`, or `worktree_root`
- the PostgreSQL schema partitions all coordination tables by `workspace_id`
- backup, restore, bootstrap, doctor, status, and re-anchor flows already exist for the current single-workspace model

This means the system is already structured enough to evolve, but the multi-project change must preserve those boundaries rather than flatten them.

## Hard Invariants

Any multi-project design must preserve the following invariants.

### 1. Checkout-bound artifacts stay checkout-bound

These must not be externalized automatically into PostgreSQL:

- `docs/audit/*`
- `AGENTS.md`
- `.codex/*`
- versioned project adapter files

### 2. Local SQLite remains first-class

The local SQLite projection under `.aidn/runtime/index/workflow-index.sqlite` must remain valid for:

- `files`
- `dual`
- `db-only`
- local repair and rematerialization paths

### 3. Shared runtime remains explicit

There must still be no implicit relocation of all `.aidn/*` artifacts into a shared backend.

### 4. Existing single-project users must degrade safely

Users who currently rely on one `workspace_id` per repository must not be forced into a disruptive migration shape.

### 5. Runtime identity must become less ambiguous, not more

The new model must define clear semantics for:

- project identity
- shared workspace identity
- concrete worktree identity

## Architectural Tension To Resolve

The current implementation has one strong idea:

- one logical shared coordination scope is keyed by `workspace_id`

True multi-project support introduces a hierarchy:

- one PostgreSQL backend
- many AIDN projects
- possibly many shared workspaces per project
- many worktrees per workspace

The plan must therefore answer one core question first:

Should `workspace_id` be renamed semantically into `project_id`, or should AIDN support both `project_id` and `workspace_id` as distinct concepts?

## Recommended Identity Model

The recommended model is:

- `project_id`: canonical logical AIDN project identity
- `workspace_id`: optional shared-runtime instance within a project
- `worktree_id`: concrete checkout identity

This model is stricter than the current one, but it fits both the simple case and the advanced case.

### Simple case

One repo, one project, many worktrees:

- one `project_id`
- one `workspace_id`
- many `worktree_id`

### Monorepo case

One repo, several AIDN projects:

- many `project_id`
- each project may have one or more `workspace_id`
- each workspace may have many `worktree_id`

### Compatibility case

For current users, phase one can define:

- `project_id := workspace_id`
- `workspace_id := workspace_id`

This preserves current behavior while making the data model extensible.

## Deep Impact Analysis

### 1. Identity And Resolution

Current risk:

- the resolver derives `workspace_id` from `git_common_dir` or `repo_root`
- in a monorepo, different AIDN projects can collapse into the same identity

Required evolution:

- add explicit `project_id` resolution
- define a canonical `project_root`
- keep explicit override precedence
- reject ambiguous nested-project resolution

### 2. Shared Runtime Locator

Current risk:

- the locator only names one workspace-oriented identity
- it cannot clearly encode project-vs-workspace distinctions

Required evolution:

- add `projectId`
- optionally keep `workspaceId`
- version the locator schema
- preserve local-only fallback

### 3. PostgreSQL Schema

Current risk:

- all PKs, FKs, and indexes are partitioned only by `workspace_id`
- administrative operations cannot clearly distinguish project-level ownership

Required evolution:

- add `project_id` across all shared-coordination tables
- backfill from current `workspace_id`
- migrate PK/FK/index definitions additively
- expose compatibility views or dual-read logic during transition

### 4. Runtime Services

Current risk:

- service APIs take `workspaceId` as the only shared partition key
- callers assume one logical scope per target root

Required evolution:

- propagate `project_id` through resolution, registration, reads, writes, status, and admin surfaces
- ensure all queries are project-scoped
- preserve compatibility for current callers during rollout

### 5. Handoff And Coordination Metadata

Current risk:

- handoff packets and coordination digests expose `workspace_id` but not a stronger project identity contract

Required evolution:

- add `project_id`
- keep older payloads readable
- reject cross-project re-anchoring mistakes explicitly

### 6. Backup, Restore, And Admin Flows

Current risk:

- backup and restore are currently centered around one resolved workspace
- multi-project operations remain operationally opaque

Required evolution:

- support enumeration by project
- support project-scoped export/import
- prevent accidental restore into the wrong project

### 7. Observability And Operability

Current risk:

- health/status can tell whether PostgreSQL is alive, but not whether the backend is carrying multiple isolated projects safely

Required evolution:

- add project counts and project-level inspection
- expose schema generation and compatibility mode
- add explicit signals for mixed legacy/v2 state

### 8. Test Strategy

Current risk:

- current fixtures prove multi-worktree behavior, not true multi-project isolation

Required evolution:

- add same-database multi-project fixtures
- add monorepo nested-project fixtures
- add collision tests where different projects share the same session ids, planning keys, or scope ids

## Target Architecture

### Layer 1 - Project Resolution

Introduce a project-resolution layer that computes:

- `project_id`
- `project_root`
- `project_id_source`

Resolution order should be:

1. CLI override
2. environment override
3. shared-runtime locator
4. project adapter or trusted project config
5. derived fallback from target-root-local AIDN project root
6. compatibility fallback from legacy `workspace_id`

### Layer 2 - Workspace Resolution

Retain workspace resolution, but scope it under the resolved project:

- `workspace_id`
- `workspace_id_source`
- `worktree_id`
- `git_common_dir`
- `repo_root`

In the compatibility phase, `workspace_id` may equal `project_id`.

### Layer 3 - Shared Coordination Partitioning

All shared-coordination tables must be project-scoped.

Recommended table strategy:

- `project_registry`
- `workspace_registry`
- `worktree_registry`
- `planning_states`
- `handoff_relays`
- `coordination_records`

Primary keys should include `project_id` explicitly.

### Layer 4 - Local Compatibility Projection

Keep the existing local SQLite projection unchanged in principle:

- local path remains under the target root
- DB-first and repair flows remain local-projection based
- PostgreSQL remains shared-coordination-only in the near term

## Migration Strategy

### Phase 0 - Terminology And Contract Freeze

Before code changes:

- freeze the meaning of `project_id`, `workspace_id`, `worktree_id`, `project_root`, `repo_root`
- decide whether `workspace_id` survives as a first-class concept or acts as a compatibility alias
- document precedence rules between CLI, env, locator, and derived fallback

### Phase 1 - Resolver And Locator v2

Introduce identity v2 without breaking storage yet:

- add project-resolution service
- extend workspace-resolution output with project metadata
- introduce locator schema v2
- keep reading locator v1

This phase isolates semantic risk before touching PostgreSQL migrations.

### Phase 2 - Additive PostgreSQL Schema v2

Add project-scoped columns and registries:

- add `project_id` to all current shared tables
- backfill from current `workspace_id`
- add new indexes and FKs
- expose compatibility reads

This phase must remain additive first.

### Phase 3 - Service And CLI Routing

Move service calls and admin commands to project-scoped reads and writes:

- registration
- planning state sync
- handoff relay sync
- coordination record sync
- status
- doctor
- backup
- restore

### Phase 4 - Isolation Hardening

Prove that the same backend can safely host:

- two independent repos
- two projects in the same monorepo
- current single-project legacy usage

### Phase 5 - Rollout And Cleanup

Only after broad validation:

- make `project_id` mandatory in the effective contract
- reduce legacy assumptions
- keep compatibility windows for older locators and backups as needed

## Key Risks

### Risk 1 - Vocabulary Drift

If the code keeps using `workspace_id` to mean both project and workspace depending on the call site, the change will remain internally inconsistent.

### Risk 2 - Monorepo Ambiguity

Without a formal `project_root`, nested AIDN projects may be resolved incorrectly or non-deterministically.

### Risk 3 - Partial Migration Blindness

A backend may contain mixed legacy and v2 rows. Health and doctor flows must detect and explain that state.

### Risk 4 - Restore Mis-Targeting

Project-scoped backups restored into the wrong project must be rejected clearly.

### Risk 5 - Over-Expansion Of PostgreSQL Scope

The project must resist pressure to move all runtime state into PostgreSQL prematurely. That would break existing DB-first and worktree-local assumptions.

## Non-Goals

The initial multi-project plan should not attempt to:

- replace all local SQLite reads with PostgreSQL
- externalize `docs/audit/*`
- remove local runtime projection paths
- introduce schema-per-project PostgreSQL layouts
- redesign every runtime command around remote database state

## Exit Criteria

The plan is complete when AIDN can prove all of the following:

- one PostgreSQL backend can host multiple isolated AIDN projects safely
- multi-worktree support for one project still works
- monorepo nested-project resolution is deterministic
- local SQLite projection behavior remains valid for `files`, `dual`, and `db-only`
- admin commands can inspect, back up, restore, and validate one project without ambiguity
- legacy single-project users can upgrade incrementally

## Recommended Delivery Order

1. freeze terminology and resolver rules
2. add project identity to locator and runtime metadata
3. add additive PostgreSQL schema v2
4. route services and CLI to project-scoped operations
5. add isolation, restore, and admin hardening
6. validate on real multi-project fixtures and at least one real pilot repository set
