# Backlog - Multi-Project PostgreSQL Support

Date: 2026-04-03
Status: completed
Scope: executable backlog for evolving the current PostgreSQL shared-coordination support from a single `workspace_id` partition model to a true multi-project model that preserves local runtime and worktree invariants.

Reference plan:

- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`

Reference RFC:

- `docs/rfc/RFC-0002-multi-project-identity-and-shared-runtime-v2.md`

Reference migration guide:

- `docs/MULTI_PROJECT_POSTGRESQL_MIGRATION_GUIDE.md`

Reference pilot runbook:

- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_PILOT_2026-04-03.md`

Progress snapshot:

- completed through MPG-23
- legacy admin/health fallback for workspace-scoped schemas is implemented
- normal coordination traffic is now explicitly blocked until schema and compatibility status are fully ready
- MPG-18 is covered for deterministic nested-project resolution, and ambiguous monorepo roots with multiple nested locators now fail explicitly
- real pilot evidence now covers both dedicated-worktree and nested-monorepo project roots on one shared PostgreSQL backend
- execution evidence is summarized in `docs/MULTI_PROJECT_POSTGRESQL_GOWIRE_PILOT_2026-04-04.md`

## Delivery Rules

- preserve current behavior when no multi-project configuration is present
- keep `docs/audit/*`, `AGENTS.md`, `.codex/*`, and local runtime artifacts outside PostgreSQL
- do not replace the local SQLite projection in this backlog
- keep migrations additive first
- do not introduce schema-per-project PostgreSQL layouts
- make identity semantics explicit before broadening SQL scope

## Priority Legend

- **P0**: architecture-defining and blocking
- **P1**: core implementation slices
- **P2**: hardening, migration safety, and operational tooling
- **P3**: rollout polish and pilot validation

## P0 - Identity And Contract Foundation

### MPG-1. Freeze Multi-Project Terminology
**Priority:** P0
**Status:** completed

Why:

- the current code uses `workspace_id` as the main logical shared key
- multi-project support is unsafe until `project_id`, `workspace_id`, and `worktree_id` are defined precisely

Done when:

- docs define the meaning of `project_id`, `workspace_id`, `worktree_id`, `project_root`, and `repo_root`
- docs define whether `workspace_id` remains first-class or acts as a compatibility alias
- all later backlog items can refer to one stable identity vocabulary

### MPG-2. Inventory Every `workspace_id` Surface
**Priority:** P0
**Status:** completed

Why:

- the impact spans schema, services, CLI, packets, backups, and tests

Done when:

- every `workspace_id` read/write/display surface is mapped
- the map distinguishes schema, runtime service, CLI, handoff, backup/restore, and test fixtures
- each surface is tagged as rename, augment, dual-read, or compatibility-only

### MPG-3. Define Project Resolution Semantics
**Priority:** P0
**Status:** completed

Why:

- current resolution logic collapses identity around Git-derived workspace heuristics
- monorepo multi-project support requires a deterministic project boundary

Dependencies:

- MPG-1

Done when:

- a resolver contract exists for `project_id`, `project_root`, and `project_id_source`
- precedence order is documented for CLI, env, locator, trusted config, and derived fallback
- nested-project ambiguity rules are explicit

### MPG-4. Define Locator Schema v2
**Priority:** P0
**Status:** completed

Why:

- the shared-runtime locator cannot remain workspace-only if multi-project becomes first-class

Dependencies:

- MPG-1
- MPG-3

Done when:

- locator v2 includes `projectId`
- locator v2 defines the relationship between `projectId` and `workspaceId`
- locator validation rules cover project/workspace mismatch
- backward-read compatibility for locator v1 is specified

## P1 - Core Runtime And Schema Changes

### MPG-5. Extend Runtime Resolution Output With Project Metadata
**Priority:** P1
**Status:** completed

Why:

- service and CLI layers need project metadata before SQL migration can be exploited safely

Dependencies:

- MPG-3
- MPG-4

Done when:

- runtime resolution exposes `project_id`, `project_root`, and `project_id_source`
- current `workspace_id` and `worktree_id` outputs remain available
- callers can opt into project-aware behavior without breaking current flows

### MPG-6. Add Project Metadata To Handoff And Runtime Digests
**Priority:** P1
**Status:** completed

Why:

- cross-worktree and cross-process coordination must reject accidental cross-project reuse explicitly

Dependencies:

- MPG-5

Done when:

- handoff packets include `project_id`
- runtime digests and admissions include `project_id`
- legacy payloads remain readable with clear degradation behavior

### MPG-7. Add PostgreSQL Schema v2 Registries
**Priority:** P1
**Status:** completed

Why:

- the backend needs an explicit project-scoped registry model

Dependencies:

- MPG-1
- MPG-5

Done when:

- schema migration adds `project_registry`
- current registries are extended or reshaped to include `project_id`
- health/status can detect whether schema v2 is present

### MPG-8. Add `project_id` To Shared Coordination Tables
**Priority:** P1
**Status:** completed

Why:

- current partitioning by `workspace_id` alone is insufficient for true multi-project isolation

Dependencies:

- MPG-7

Done when:

- `project_id` is added to `workspace_registry`, `worktree_registry`, `planning_states`, `handoff_relays`, and `coordination_records`
- indexes and foreign keys are added additively
- migration backfills existing rows deterministically

### MPG-9. Implement Dual-Read Compatibility For Legacy Rows
**Priority:** P1
**Status:** completed

Why:

- production-like databases may contain only legacy `workspace_id` scoped rows during rollout

Dependencies:

- MPG-8

Done when:

- readers can interpret legacy rows safely
- mixed v1/v2 backend states are detectable
- no silent cross-project leakage occurs in compatibility mode

### MPG-10. Route Shared Coordination Services Through Project Scope
**Priority:** P1
**Status:** completed

Why:

- service APIs currently take `workspaceId` as the sole partition key

Dependencies:

- MPG-5
- MPG-8
- MPG-9

Done when:

- workspace registration is project-scoped
- planning sync/read is project-scoped
- handoff sync/read is project-scoped
- coordination record sync/read is project-scoped

### MPG-11. Update PostgreSQL Adapter Queries And Contracts
**Priority:** P1
**Status:** completed

Why:

- the adapter remains the narrowest point where isolation can still be broken if query predicates are incomplete

Dependencies:

- MPG-8
- MPG-10

Done when:

- all adapter queries include project scoping
- all PK/FK assumptions in the adapter match schema v2
- contract docs and health output expose the new partition model

## P2 - Admin, Migration, And Safety Tooling

### MPG-12. Extend Re-Anchor And Validation Flows For Project Scope
**Priority:** P2
**Status:** completed

Why:

- locator repair and runtime validation must explain project mismatches, not only workspace mismatches

Dependencies:

- MPG-4
- MPG-5

Done when:

- re-anchor can inspect, propose, and write project-aware locators
- validation reports project mismatch explicitly
- local-only fallback remains safe

### MPG-13. Add Project-Aware Status And Doctor Output
**Priority:** P2
**Status:** completed

Why:

- operators need to understand whether one backend is hosting several projects and whether they are isolated correctly

Dependencies:

- MPG-10
- MPG-11

Done when:

- status output shows project identity clearly
- doctor output reports legacy-vs-v2 compatibility state
- health output can enumerate or count registered projects

### MPG-14. Add Project-Scoped Backup And Restore Contracts
**Priority:** P2
**Status:** completed

Why:

- current backup and restore flows are centered on one resolved workspace

Dependencies:

- MPG-10
- MPG-11

Done when:

- backup payload includes `project_id`
- restore refuses mismatched target project by default
- restore preview explains project and workspace alignment

### MPG-15. Add Project Enumeration And Admin Commands
**Priority:** P2
**Status:** completed

Why:

- a multi-project backend remains hard to operate without discovery surfaces

Dependencies:

- MPG-13

Done when:

- admin flows can list registered projects
- operators can inspect one project without reading raw SQL tables
- project-level prune or retention strategy is documented or implemented

### MPG-16. Add Mixed-State Migration Diagnostics
**Priority:** P2
**Status:** completed

Why:

- additive migration implies a real transition period with mixed legacy and v2 state

Dependencies:

- MPG-8
- MPG-9
- MPG-13

Done when:

- doctor/status can identify partially migrated data
- migration diagnostics explain what remains to be upgraded
- the system does not silently present mixed data as healthy

## P2 - Regression Coverage

### MPG-17. Add Multi-Project Backend Fixture Coverage
**Priority:** P2
**Status:** completed

Why:

- current fixtures prove multi-worktree behavior, not multi-project isolation

Dependencies:

- MPG-10
- MPG-11

Done when:

- tests exercise two independent projects in one PostgreSQL backend
- tests prove isolated planning, relay, and coordination reads/writes
- tests prove same-named session or planning keys do not collide across projects

### MPG-18. Add Monorepo Nested-Project Resolution Fixtures
**Priority:** P2
**Status:** completed

Why:

- the biggest semantic risk is mis-resolving several AIDN projects inside one repo

Dependencies:

- MPG-3
- MPG-5

Done when:

- fixtures cover nested project roots
- resolver behavior is deterministic
- ambiguous layouts fail clearly

### MPG-19. Add Backup/Restore Isolation Tests
**Priority:** P2
**Status:** completed

Why:

- restore is one of the easiest places to reintroduce cross-project corruption

Dependencies:

- MPG-14

Done when:

- tests cover project-matched restore
- tests cover project-mismatched restore rejection
- preview output reflects the effective project boundary

### MPG-20. Add CLI And Doctor Regression Fixtures
**Priority:** P2
**Status:** completed

Why:

- the user-facing contract depends on status, doctor, re-anchor, backup, and restore behavior staying coherent

Dependencies:

- MPG-12
- MPG-13
- MPG-14

Done when:

- fixtures cover status, doctor, backup, restore, and re-anchor under project-aware mode
- fixtures cover legacy compatibility mode
- outputs remain explicit and non-ambiguous

## P3 - Rollout And Pilot Validation

### MPG-21. Write Migration Guidance For Legacy Users
**Priority:** P3
**Status:** completed

Why:

- current users need a safe path from one-workspace-per-repo assumptions to project-aware semantics

Dependencies:

- MPG-12
- MPG-14
- MPG-16

Done when:

- migration docs cover single-project upgrade
- migration docs cover multi-project monorepo adoption
- migration docs explain locator upgrade and rollback paths

### MPG-22. Validate Against A Real Multi-Project Pilot
**Priority:** P3
**Status:** completed

Why:

- fixture confidence is not enough for identity and operability changes of this breadth

Dependencies:

- MPG-17
- MPG-18
- MPG-20

Done when:

- at least one real pilot uses a shared PostgreSQL backend for more than one logical project
- evidence confirms project isolation and expected admin visibility
- evidence confirms current worktree behavior still holds

Status today:

- a real pilot on `G:\projets\gowire-pilot-main` and `G:\projets\gowire-pilot-linked` validated shared-backend project isolation, project-aware admin visibility, and restore-side `project-mismatch` rejection using two logical project identities on dedicated pilot worktrees
- a second real pilot on `G:\projets\gowire-pilot-main\apps\web` and `G:\projets\gowire-pilot-main\packages\ui-kit` validated two maintained project roots inside the same monorepo worktree, with one shared `git_common_dir`, one shared `worktree_id`, distinct `project_id` values, isolated planning and handoff state, project-aware admin enumeration, and restore-side `project-mismatch` rejection
- evidence is recorded in `docs/MULTI_PROJECT_POSTGRESQL_GOWIRE_PILOT_2026-04-04.md` and in `G:\projets\gowire-validation\2026-04-04-multi-project-postgresql-monorepo\pilot-evidence.md`

### MPG-23. Define Cleanup And Compatibility Window
**Priority:** P3
**Status:** completed

Why:

- additive migrations need an explicit retirement strategy or they become permanent ambiguity

Dependencies:

- MPG-16
- MPG-21
- MPG-22

Done when:

- docs state how long locator v1 and legacy row compatibility remain supported
- docs state when stricter project-aware validation becomes the default
- cleanup steps are sequenced after real validation, not before

## Recommended Execution Order

1. MPG-1 to MPG-4
2. MPG-5 and MPG-6
3. MPG-7 to MPG-11
4. MPG-12 to MPG-16
5. MPG-17 to MPG-20
6. MPG-21 to MPG-23

## Minimum Viable Milestone

The first milestone should be considered complete only when:

- AIDN resolves and exposes `project_id` explicitly
- one PostgreSQL backend can host two isolated projects safely
- current single-project behavior remains compatible
- project-aware status, validation, backup, and restore flows exist
