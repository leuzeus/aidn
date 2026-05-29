# Plan - Gowire Pilot Validation For Worktree And PostgreSQL Support

Date: 2026-04-01
Status: proposed
Scope: validate the current `worktree/postgresql` implementation against a real installed client repository (`G:/projets/gowire`), then replan the remaining backlog in `docs/BACKLOG_WORKTREE_POSTGRESQL_2026-03-27.md`.

Reference backlog:

- `docs/BACKLOG_WORKTREE_POSTGRESQL_2026-03-27.md`

Reference runtime docs:

- `docs/MIGRATION_SHARED_RUNTIME_POSTGRESQL.md`
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
- `docs/INSTALL.md`
- `docs/UPGRADE.md`

## Why This Pilot Exists

Fixture coverage is already strong, but the remaining open backlog items are mostly about real rollout behavior:

- broad routing adoption
- real multi-worktree behavior on an installed repo
- PostgreSQL operational safety
- admin lifecycle maturity
- evidence needed to either close or split the remaining backlog items

`G:/projets/gowire` is a good pilot because:

- `aidn` is already installed there
- the repo already carries `AGENTS.md`, `docs/audit/*`, `.aidn/*`, and `.codex/*`
- it is a real client repository, not a synthetic fixture

## Remaining Backlog Items To Validate Or Replan

The pilot is explicitly meant to produce closure evidence or replanning input for:

- `BK-2` worktree identity rollout
- `BK-3` workspace-resolution rollout
- `BK-10` PostgreSQL shared backend breadth
- `BK-11` shared-routing scope correctness
- `BK-13` shared coordination concurrency validation
- `BK-16` PostgreSQL admin lifecycle completeness

## Success Criteria

The pilot is successful when it produces enough evidence to do one of the following for each remaining backlog item:

- mark it implemented
- keep it partial with a narrower residual scope
- split it into smaller follow-up tickets with concrete acceptance criteria

The pilot is not complete merely because commands run successfully once.
It must show:

- what worked
- what failed
- what is still awkward or unsafe
- what is still missing in the product surface

## Safety Model

Do not run this validation in the current `G:/projets/gowire` working tree.

Use dedicated pilot worktrees and keep all changes isolated to pilot branches.

Recommended directories:

- source repo: `G:/projets/gowire`
- pilot main worktree: `G:/projets/gowire-pilot-main`
- pilot linked worktree: `G:/projets/gowire-pilot-linked`
- shared sqlite root: `G:/projets/gowire-shared-runtime`
- evidence root: `G:/projets/gowire-validation/2026-04-01-worktree-postgresql`

## Phase 0 - Prepare The Pilot

### Goal

Create an isolated two-worktree topology for `gowire` and a place to collect evidence.

### Commands

From any shell:

```powershell
New-Item -ItemType Directory -Force G:\projets\gowire-validation\2026-04-01-worktree-postgresql | Out-Null
New-Item -ItemType Directory -Force G:\projets\gowire-shared-runtime | Out-Null
git -C G:\projets\gowire worktree add G:\projets\gowire-pilot-main -b pilot/aidn-worktree-postgresql-validation
git -C G:\projets\gowire-pilot-main worktree add G:\projets\gowire-pilot-linked -b pilot/aidn-worktree-postgresql-linked
```

### Evidence To Capture

- `git status --short --branch` in both pilot worktrees
- `git worktree list`

### Stop Conditions

Stop if:

- `gowire` already has conflicting linked worktrees that make cleanup risky
- the pilot branches already exist with unrelated work

## Phase 1 - Upgrade `aidn` In The Pilot Repo

### Goal

Bring the installed `aidn` version in the pilot worktrees in line with `G:/projets/aidn` on branch `wip/worktree-postgresql-followup`.

### Commands

Run in `G:/projets/gowire-pilot-main`:

```powershell
npm install --save-dev G:\projets\aidn
npx aidn install --target . --pack extended --force-agents-merge
npx aidn install --target . --pack extended --verify
```

Run in `G:/projets/gowire-pilot-linked`:

```powershell
npm install --save-dev G:\projets\aidn
npx aidn install --target . --pack extended --force-agents-merge
npx aidn install --target . --pack extended --verify
```

If the PostgreSQL driver is missing at runtime, install it explicitly in each pilot worktree:

```powershell
npm install --save-dev pg@^8
```

### Evidence To Capture

Store command outputs under the evidence root, for example:

- `phase1-install-main.txt`
- `phase1-install-linked.txt`
- `phase1-verify-main.txt`
- `phase1-verify-linked.txt`

### Validation

The phase is complete when:

- both pilot worktrees can run `npx aidn`
- install verify passes in both worktrees
- no unexpected overwrite happened outside the pilot branches

## Phase 2 - Capture Baseline Before Shared Runtime

### Goal

Measure the current local-only behavior on a real installed repo before enabling shared runtime.

### Commands

Run in both pilot worktrees:

```powershell
npx aidn runtime project-runtime-state --target . --json
npx aidn runtime project-handoff-packet --target . --json
npx aidn runtime pre-write-admit --target . --skill cycle-create --json
npx aidn runtime shared-coordination-status --target . --json
```

### Expected Baseline

At this stage, the expected shape is:

- same `workspace_id` across worktrees
- distinct `worktree_id`
- same `git_common_dir`
- `shared_runtime_mode=local-only`
- shared coordination backend disabled

### Backlog Mapping

This phase validates the real-world closure quality of:

- `BK-2`
- `BK-3`

If workspace identity is unstable or confusing in a real client repo, these two items are not done.

## Phase 3 - Validate `sqlite-file` Shared Runtime Boundary

### Goal

Confirm that a shared runtime root can be enabled across real linked worktrees without externalizing checkout-bound artifacts.

### Commands

Run in both pilot worktrees with the same workspace id:

```powershell
npx aidn runtime shared-runtime-reanchor --target . --backend sqlite-file --shared-root G:\projets\gowire-shared-runtime --workspace-id gowire-pilot --write --json
npx aidn runtime project-runtime-state --target . --json
npx aidn runtime project-handoff-packet --target . --json
npx aidn runtime shared-coordination-status --target . --json
```

### What Must Be True

- both worktrees resolve `shared_runtime_mode=shared-runtime`
- both worktrees keep the same `workspace_id`
- both worktrees keep different `worktree_id`
- local SQLite projection may be shared at the runtime-root layer if configured
- shared coordination still remains disabled for `sqlite-file`
- `docs/audit/*` stays local to each checkout

### Backlog Mapping

This phase validates the routing boundary for:

- `BK-11`

If `docs/audit/*` or other checkout-bound artifacts leak across worktrees, `BK-11` must be reopened aggressively.

## Phase 4 - Validate PostgreSQL Shared Coordination

### Goal

Enable PostgreSQL-backed shared coordination on both pilot worktrees and validate the operational flows against a real repo.

### Prerequisite

Have a reachable PostgreSQL database and export the connection string in both shells:

```powershell
$env:AIDN_PG_URL = "postgres://user:pass@host:5432/db"
```

### Commands

Run in both pilot worktrees:

```powershell
npx aidn runtime shared-runtime-reanchor --target . --backend postgres --connection-ref env:AIDN_PG_URL --workspace-id gowire-pilot --write --json
npx aidn runtime shared-coordination-doctor --target . --json
npx aidn runtime shared-coordination-migrate --target . --json
npx aidn runtime shared-coordination-bootstrap --target . --json
npx aidn runtime shared-coordination-status --target . --json
```

Run at least once per worktree after bootstrap:

```powershell
npx aidn runtime project-runtime-state --target . --json
npx aidn runtime project-handoff-packet --target . --json
npx aidn runtime project-coordination-summary --target . --json
npx aidn runtime coordinator-next-action --target . --json
```

### What Must Be True

- doctor reports a valid PostgreSQL backend contract
- migrate reaches `schema_status=ready`
- bootstrap registers each worktree separately
- status reports a live shared backend
- workspace identity remains stable across both worktrees
- local checkout-bound artifacts remain local
- shared planning, handoff relay, and coordination data become visible through the shared backend

### Backlog Mapping

This phase validates:

- `BK-10`
- `BK-11`
- `BK-16`

If migrate/bootstrap/status are usable but schema upgrade or rollback remains missing, `BK-16` should be split instead of left vague.

## Phase 5 - Concurrency And Safety Exercises

### Goal

Exercise overlapping writes from the two worktrees against the same shared workspace.

### Minimum Exercise Set

From both worktrees, produce overlapping reads and coordination-facing outputs close in time:

```powershell
npx aidn runtime project-handoff-packet --target . --json
npx aidn runtime coordinator-next-action --target . --json
npx aidn runtime project-coordination-summary --target . --json
npx aidn runtime shared-coordination-backup --target . --json
```

Then run:

```powershell
npx aidn runtime shared-coordination-status --target . --json
```

in each worktree and compare:

- shared planning state provenance
- latest handoff relay provenance
- coordination record visibility
- distinct `source_worktree_id` values

### Optional Stronger Exercise

If a safe manual scenario exists in `gowire`, execute a real planning or handoff flow from both worktrees and inspect the shared records afterward.

### Backlog Mapping

This phase validates:

- `BK-13`
- the practical part of `BK-10`
- the shared-routing part of `BK-11`

If concurrency works only in fixtures and not on the pilot repo, `BK-13` remains open.

## Phase 6 - Backup, Restore, And Recovery

### Goal

Validate the operational safety story around backup, restore, doctor, and re-anchor.

### Commands

Run in one pilot worktree:

```powershell
npx aidn runtime shared-coordination-backup --target . --out .aidn/runtime/shared-coordination-backup.json --json
npx aidn runtime shared-coordination-restore --target . --json
npx aidn runtime shared-coordination-restore --target . --write --json
npx aidn runtime shared-runtime-reanchor --target . --json
npx aidn runtime shared-coordination-doctor --target . --json
```

### What Must Be True

- backup exports a coherent snapshot
- restore preview is readable before any write
- restore write path is explicit
- reanchor can diagnose and repair locator drift
- doctor recommendations are actionable rather than vague

### Backlog Mapping

This phase mainly informs:

- `BK-16`

If recovery exists but is still too manual or incomplete for schema lifecycle changes, convert that gap into explicit follow-up tickets.

## Phase 7 - Replan The Remaining Backlog

### Goal

Turn pilot evidence into an updated backlog state instead of leaving vague `partial` labels.

### Required Outputs

At the end of the pilot, produce:

1. a short evidence summary per remaining backlog item
2. an updated status proposal per item: `implemented | partial | split | blocked`
3. concrete next actions for anything not closed

### Replanning Rules

Use these rules:

- close `BK-2` only if worktree identity is stable and unsurprising on real `gowire` worktrees
- close `BK-3` only if the workspace resolver is sufficient for normal runtime commands without ad hoc fixes
- close `BK-10` only if PostgreSQL shared coordination works end to end on the pilot repo, not only in fixtures
- close `BK-11` only if the shared-vs-local boundary is correct under real installed-repo conditions
- close `BK-13` only if overlapping worktree access behaves safely and leaves auditable provenance
- split `BK-16` if the current admin flows are useful but the schema upgrade/rollback lifecycle is still materially missing

### Recommended Residual Ticket Shape

If a backlog item remains open, prefer narrow follow-ups such as:

- `BK-11A` route remaining runtime readers through shared coordination resolution
- `BK-13A` add a repeatable real-repo concurrency runbook
- `BK-16A` implement PostgreSQL schema upgrade sequencing
- `BK-16B` implement PostgreSQL rollback or downgrade safety policy

## Evidence Inventory

The pilot should leave behind a small, explicit evidence set under:

- `G:/projets/gowire-validation/2026-04-01-worktree-postgresql`

Recommended files:

- `phase0-topology.txt`
- `phase1-install-main.txt`
- `phase1-install-linked.txt`
- `phase2-baseline-main.json`
- `phase2-baseline-linked.json`
- `phase3-sqlite-main.json`
- `phase3-sqlite-linked.json`
- `phase4-postgres-main.json`
- `phase4-postgres-linked.json`
- `phase5-concurrency-main.json`
- `phase5-concurrency-linked.json`
- `phase6-backup-restore.json`
- `phase7-backlog-replan.md`

## Recommended Final Decision Format

At the end of execution, summarize each remaining backlog item in this format:

```text
BK-11
- status proposal: partial
- evidence: shared planning and handoff routing work on gowire; checkout-bound docs remain local
- remaining gap: some runtime readers still use local fallback more directly than the shared route
- next action: list the remaining readers and convert them into one narrow follow-up ticket
```

## Cleanup

If the pilot must be discarded after analysis:

```powershell
git -C G:\projets\gowire worktree remove G:\projets\gowire-pilot-linked --force
git -C G:\projets\gowire worktree remove G:\projets\gowire-pilot-main --force
git -C G:\projets\gowire branch -D pilot/aidn-worktree-postgresql-linked
git -C G:\projets\gowire branch -D pilot/aidn-worktree-postgresql-validation
```

Do not clean up before the evidence and backlog replan outputs are saved.
