# Multi-Project PostgreSQL Readiness

Date: 2026-04-04
Status: ready
Scope: final implementation and validation summary for the multi-project PostgreSQL rollout in `aidn`.

## Outcome

The multi-project PostgreSQL work is complete at the repository level.

The shared coordination backend now supports:

- more than one logical `project_id` in the same PostgreSQL backend
- project-aware registration, planning, handoff, coordination, status, doctor, backup, and restore
- compatibility inspection for legacy workspace-scoped schemas
- explicit readiness gating before normal coordination traffic is allowed
- explicit rejection of ambiguous monorepo roots when several nested project locators exist under the chosen `targetRoot`

## Implemented Areas

Core runtime:

- project/workspace/worktree identity model is resolved in `src/application/runtime/workspace-resolution-service.mjs`
- shared runtime validation and re-anchor flows are project-aware
- nested ambiguous locator topology is rejected in `src/application/runtime/shared-runtime-validation-service.mjs`

Shared backend:

- PostgreSQL schema and contract are project-scoped
- adapter queries and registry writes are project-scoped
- admin visibility is available through `tools/runtime/shared-coordination-projects.mjs`

Operator workflows:

- `shared-coordination-status`
- `shared-coordination-doctor`
- `shared-coordination-migrate`
- `shared-coordination-backup`
- `shared-coordination-restore`
- `shared-runtime-reanchor`

Documentation:

- architecture plan: `docs/PLAN_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`
- executable backlog: `docs/BACKLOG_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`
- RFC: `docs/rfc/RFC-0002-multi-project-identity-and-shared-runtime-v2.md`
- migration guide: `docs/MULTI_PROJECT_POSTGRESQL_MIGRATION_GUIDE.md`
- pilot closure: `docs/MULTI_PROJECT_POSTGRESQL_GOWIRE_PILOT_2026-04-04.md`

## Validation Summary

Repository fixture verification passed for:

- PostgreSQL contract and adapter behavior
- legacy compatibility inspection
- migrate, doctor, runtime CLI, projects admin, readiness policy
- multi-project isolation
- backup and restore safety
- handoff packet and runtime-state projection
- shared-runtime re-anchor and workspace resolution

Real pilot evidence passed for:

- two dedicated pilot worktrees using one shared PostgreSQL backend
- two nested project roots in one monorepo worktree with the same `git_common_dir`
- cross-project restore preview rejection
- correct admin enumeration and inspection

Evidence roots:

- `G:\projets\gowire-validation\2026-04-04-multi-project-postgresql`
- `G:\projets\gowire-validation\2026-04-04-multi-project-postgresql-monorepo`

## Remaining Risk

No blocking technical gap remains in the implementation.

The remaining question is product policy only:

- whether UX should become even stricter for unusual nested-project layouts beyond the current hard rejection of multiple descendant locators under one root

## Recommended Next Steps

1. ship the current implementation as the project-scoped PostgreSQL baseline
2. keep locator v1 read compatibility during rollout
3. monitor operator feedback on migration and nested-project ergonomics
4. retire legacy compatibility only after rollout evidence stays clean
