# Multi-Project PostgreSQL Migration Guide

Date: 2026-04-03
Status: draft-for-implementation
Scope: operational guidance for moving an existing AIDN PostgreSQL shared-coordination deployment from legacy `workspace_id`-only assumptions to the project-aware model built around `project_id + workspace_id + worktree_id`.

Reference documents:

- `docs/rfc/RFC-0002-multi-project-identity-and-shared-runtime-v2.md`
- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`
- `docs/BACKLOG_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`
- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_PILOT_2026-04-03.md`

## Executive Summary

The migration is intentionally additive.

- locator v1 remains readable
- existing rows are backfilled to `project_id`
- current single-project deployments can continue with `project_id := workspace_id`
- operator tooling now surfaces mixed legacy/v2 state instead of silently treating it as healthy

The main behavior change is conceptual:

- `project_id` becomes the canonical logical AIDN project boundary
- `workspace_id` remains the shared-runtime instance inside that project
- `worktree_id` remains the concrete checkout identity

## Who Should Use This Guide

Use this guide if you currently have one of these shapes:

- one repository using PostgreSQL shared coordination today
- several worktrees of the same repository sharing one PostgreSQL backend
- a monorepo that now needs more than one logical AIDN project in the same PostgreSQL backend

## Non-Goals

This migration does not:

- move `docs/audit/*`, `AGENTS.md`, or `.codex/*` into PostgreSQL
- replace the local SQLite projection
- introduce one PostgreSQL schema per project

## Preflight Checklist

Before changing any project identity, verify:

1. `aidn runtime shared-coordination-status --target . --json`
2. `aidn runtime shared-coordination-doctor --target . --json`
3. `aidn runtime shared-coordination-backup --target . --json`

Do not continue if:

- `schema_status` is not `ready`
- `compatibility_status` is `mixed-legacy-v2`
- backup generation fails

## Upgrade Path A: Existing Single-Project Repository

This is the low-risk path.

Recommended shape:

- keep the current logical identifier
- set `projectId` equal to the current `workspaceId`
- keep `workspaceId` unchanged

Recommended locator example:

```json
{
  "version": 2,
  "enabled": true,
  "projectId": "workspace-main",
  "workspaceId": "workspace-main",
  "project": {
    "root": ".",
    "rootRef": "target-root"
  },
  "backend": {
    "kind": "postgres",
    "connectionRef": "env:AIDN_PG_URL"
  },
  "projection": {
    "localIndexMode": "preserve-current"
  }
}
```

Steps:

1. update the locator to v2
2. run `aidn runtime shared-coordination-migrate --target . --dry-run --json`
3. run `aidn runtime shared-coordination-migrate --target . --json`
4. run `aidn runtime shared-coordination-doctor --target . --json`
5. confirm `compatibility_status=project-scoped`

## Upgrade Path B: Many Worktrees, One Logical Project

Use one shared `projectId` and one shared `workspaceId` across all worktrees of that project.

Do not derive identity from each checkout path.

Recommended invariants:

- same `projectId` in every linked worktree locator
- same `workspaceId` in every linked worktree locator
- different `worktree_id` derived automatically per checkout

Validation:

- `shared-coordination-projects` should show one project
- status reads from different worktrees should show the same `project_id` and different `worktree_id`

## Upgrade Path C: Monorepo With Several AIDN Projects

Each logical project in the monorepo needs its own locator at its own project root.

Recommended shape:

- one locator per AIDN project root
- one distinct `projectId` per project
- `workspaceId` may match `projectId` initially unless you need several shared workspaces inside the same project

Example:

- `apps/api/.aidn/project/shared-runtime.locator.json` with `projectId=project-api`
- `apps/web/.aidn/project/shared-runtime.locator.json` with `projectId=project-web`

Important rule:

- `project.root` is interpreted relative to the target project root, not the repository root

This prevents a nested monorepo project from collapsing back to the Git root.

## Rollback

Rollback is allowed as long as the deployment has not started depending on distinct multi-project identities.

Rollback steps:

1. take a fresh `shared-coordination-backup`
2. restore the previous package/runtime version
3. revert locators only if the deployment is still logically single-project
4. verify that legacy compatibility mode is still understood by the old runtime

Do not roll back locator identity after two distinct projects have started writing to the same backend with the same legacy `workspace_id`.

## Mixed Legacy/V2 State

The runtime now treats this as a migration problem, not a healthy steady state.

Signals:

- `compatibility_status = mixed-legacy-v2`
- `legacy_workspace_rows > 0`
- doctor fails with `mixed-legacy-v2`

Legacy-only admin note:

- if the backend is still legacy and does not expose `project_registry`, project enumeration falls back to one inferred project per `workspace_id`
- this fallback is for inspection and migration guidance only, not a substitute for the v2 project-scoped schema

Normal runtime policy:

- status, doctor, backup, migration planning, and project enumeration may inspect a legacy backend
- normal shared coordination reads and writes are blocked until the backend reports `schema_status=ready` and `compatibility_status=project-scoped` or `empty`

Required action:

- finish backfilling `project_id` for remaining legacy rows before declaring the backend healthy

## Compatibility Window

Current policy:

- locator v1 remains readable during the migration window
- mixed legacy/v2 rows are detectable but not considered healthy
- project-aware validation is the preferred default now
- the real multi-project pilot gate is now satisfied
- monorepo nested-project behavior is validated on dedicated pilot worktrees

Planned cleanup gate:

- do not remove locator v1 read compatibility before operators validate the migration path on their own shared backends
- do not tighten mixed-state handling further until rollout feedback confirms that post-pilot upgrade steps are operationally smooth

## Retirement Conditions

The compatibility window can be closed only after:

1. legacy row counts remain at zero across supported deployments
2. locator v2 adoption is the norm
3. rollout feedback shows no operator pain around project-aware migration and inspection

## Operational Commands

Useful checks after migration:

1. `aidn runtime shared-coordination-status --target . --json`
2. `aidn runtime shared-coordination-doctor --target . --json`
3. `aidn runtime shared-coordination-projects --target . --json`
4. `aidn runtime shared-coordination-projects --target . --project-id <project_id> --json`
5. `aidn runtime shared-coordination-backup --target . --json`

## Current Open Risk

The main remaining open point is not the schema or project isolation.

The main remaining product question is UX strictness for nested-project layouts beyond the current hard rejection rule.

- fixtures now prove deterministic nested-project resolution
- roots with multiple descendant project locators and no local locator are now rejected explicitly
- further tightening, if any, should be driven by operator feedback rather than by more backend redesign
