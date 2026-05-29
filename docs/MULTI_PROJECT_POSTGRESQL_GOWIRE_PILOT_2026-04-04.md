# Gowire Pilot - Multi-Project PostgreSQL

Date: 2026-04-04
Status: completed
Scope: record the real pilot evidence used to close `MPG-22`.

## Pilot Shapes

### Shape 1. Dedicated pilot worktrees

- `G:\projets\gowire-pilot-main`
- `G:\projets\gowire-pilot-linked`
- backend: `postgres://root@192.168.1.173:5433/aidn`
- identities: `project-alpha` / `workspace-alpha`
- identities: `project-beta` / `workspace-beta`

Observed outcome:

- one shared backend hosted both projects
- shared project enumeration returned both projects
- the same session key remained isolated across the two pilot worktrees
- restore preview rejected cross-project replay with `project-mismatch`

Evidence root:

- `G:\projets\gowire-validation\2026-04-04-multi-project-postgresql\pilot-evidence.md`

### Shape 2. Nested monorepo project roots in one dedicated worktree

- monorepo worktree: `G:\projets\gowire-pilot-main`
- project root A: `G:\projets\gowire-pilot-main\apps\web`
- project root B: `G:\projets\gowire-pilot-main\packages\ui-kit`
- backend: `postgres://root@192.168.1.173:5433/aidn`
- identities: `monorepo-web` / `monorepo-web`
- identities: `monorepo-ui-kit` / `monorepo-ui-kit`

Observed outcome:

- both project roots resolved against the same `git_common_dir`
- both project roots registered the same `worktree_id` `worktree-ec7d0b78a468c6eb`
- PostgreSQL kept those registrations isolated by `project_id`
- the same session id `S960` produced distinct planning payloads for each root
- handoff packets carried the correct `project_id` and `project_root`
- admin listing exposed both projects with the expected roots and counts
- restore preview from `monorepo-web` into `monorepo-ui-kit` failed with `project-mismatch`

Evidence root:

- `G:\projets\gowire-validation\2026-04-04-multi-project-postgresql-monorepo\pilot-evidence.md`

Key command outputs:

- `phase1-reanchor-apps-web.json`
- `phase1-reanchor-ui-kit.json`
- `phase2-migrate-web.json`
- `phase3-session-plan-web.json`
- `phase3-session-plan-ui-kit.json`
- `phase4-projects-web.json`
- `phase5-projects-web-after-handoff.json`
- `phase6-db-state.json`
- `phase6-restore-preview-ui-kit-from-web.json`

## Closure Decision

`MPG-22` is closed based on Shape 2.

Reason:

- it validates the original high-risk case directly: more than one logical AIDN project in the same monorepo, under one shared PostgreSQL backend, without falling back to Git-root identity
- it proves project scoping even when `git_common_dir` and `worktree_id` are shared
- it keeps the pilot on dedicated worktrees and does not mutate `G:\projets\gowire`

## Remaining Risk

The main remaining design risk is no longer core PostgreSQL isolation.

`aidn` now rejects ambiguous monorepo roots when more than one nested project locator is present beneath the chosen `targetRoot`.
Any further tightening is now a UX policy decision, not a missing isolation capability.
