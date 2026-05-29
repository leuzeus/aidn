# Plan - Real Pilot Validation For Multi-Project PostgreSQL Support

Date: 2026-04-03
Status: completed
Scope: validate the current multi-project PostgreSQL implementation against at least one real repository set using one shared PostgreSQL backend for more than one logical AIDN project, then turn the evidence into final closure or follow-up items for `MPG-22`.

Execution note 2026-04-04:

- completed on dedicated gowire pilot worktrees
- closure evidence: `docs/MULTI_PROJECT_POSTGRESQL_GOWIRE_PILOT_2026-04-04.md`
- external evidence root: `G:\projets\gowire-validation\2026-04-04-multi-project-postgresql`
- external evidence root: `G:\projets\gowire-validation\2026-04-04-multi-project-postgresql-monorepo`

Reference backlog:

- `docs/BACKLOG_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`

Reference implementation docs:

- `docs/rfc/RFC-0002-multi-project-identity-and-shared-runtime-v2.md`
- `docs/MULTI_PROJECT_POSTGRESQL_MIGRATION_GUIDE.md`
- `docs/PLAN_MULTI_PROJECT_POSTGRESQL_2026-04-03.md`

Reference evidence template:

- `docs/TEMPLATE_MULTI_PROJECT_POSTGRESQL_PILOT_EVIDENCE_2026-04-03.md`

## Why This Pilot Exists

Fixture coverage is now strong enough to validate the product surface locally.

The remaining unanswered questions are operational:

- does one real PostgreSQL backend stay understandable when carrying more than one logical project
- do project-scoped status, doctor, backup, restore, and project enumeration remain usable under real repo noise
- do users avoid accidental identity collapse during re-anchor and migration
- is the current policy for legacy admin fallback plus strict runtime readiness acceptable in practice

The pilot is not complete because commands run once.

It is complete only when the evidence is good enough to:

- close `MPG-22`
- or narrow the residual risk into explicit follow-up tickets

## Candidate Pilot Shapes

Choose one of these and record the choice in the evidence file.

### Shape A - Two Independent Repositories

Use this when you have:

- two real repositories already using `aidn`
- a need to validate one shared PostgreSQL backend across unrelated projects

This is the clearest proof that isolation does not accidentally depend on Git topology.

### Shape B - One Monorepo With Two AIDN Project Roots

Use this when you have:

- one real monorepo
- two sub-projects that each carry their own AIDN root and locator

This is the best proof that nested project roots do not collapse back to one repo-wide identity.

## Safety Model

Do not run the pilot in an actively used working tree.

Use isolated pilot checkouts or pilot branches only.

Minimum requirements:

- one dedicated evidence root
- one dedicated PostgreSQL database or clearly isolated schema-level environment
- one rollback plan using `shared-coordination-backup`
- one operator responsible for deciding whether results count as closure evidence

## Suggested Directory Layout

Adapt names to your environment and record them exactly in the evidence.

For Shape A:

- repo A source: `<REPO_A_SOURCE>`
- repo A pilot: `<REPO_A_PILOT>`
- repo B source: `<REPO_B_SOURCE>`
- repo B pilot: `<REPO_B_PILOT>`
- evidence root: `<EVIDENCE_ROOT>`

For Shape B:

- monorepo source: `<MONOREPO_SOURCE>`
- monorepo pilot: `<MONOREPO_PILOT>`
- project root A: `<MONOREPO_PILOT>\\apps\\alpha`
- project root B: `<MONOREPO_PILOT>\\apps\\beta`
- evidence root: `<EVIDENCE_ROOT>`

## Phase 0 - Prepare The Pilot

### Goal

Create isolated pilot checkouts and an evidence location.

### Commands

PowerShell example:

```powershell
New-Item -ItemType Directory -Force <EVIDENCE_ROOT> | Out-Null
git -C <REPO_A_SOURCE> worktree add <REPO_A_PILOT> -b pilot/aidn-multi-project-a
git -C <REPO_B_SOURCE> worktree add <REPO_B_PILOT> -b pilot/aidn-multi-project-b
```

If using one monorepo pilot instead:

```powershell
New-Item -ItemType Directory -Force <EVIDENCE_ROOT> | Out-Null
git -C <MONOREPO_SOURCE> worktree add <MONOREPO_PILOT> -b pilot/aidn-multi-project
```

### Evidence To Capture

- `git status --short --branch`
- `git worktree list`
- a short note naming the chosen pilot shape

### Stop Conditions

Stop if:

- the pilot branches already contain unrelated work
- the PostgreSQL environment is shared with unrelated validation and cannot be isolated

## Phase 1 - Align The Installed `aidn` Version

### Goal

Ensure every pilot root uses the same current `aidn` package and the `pg` driver.

### Commands

Run in each pilot root:

```powershell
npm install --save-dev G:\projets\aidn
npm install --save-dev pg@^8
npx aidn install --target . --pack extended --force-agents-merge
npx aidn install --target . --pack extended --verify
```

### Evidence To Capture

- install output
- verify output
- `package.json` / lockfile diff summary if relevant

### Validation

This phase is complete when:

- all pilot roots can run `npx aidn`
- install verify passes in every pilot root

## Phase 2 - Capture Local-Only Baseline

### Goal

Capture the pre-PostgreSQL state before enabling shared runtime.

### Commands

Run in each pilot project root:

```powershell
npx aidn runtime project-runtime-state --target . --json
npx aidn runtime project-handoff-packet --target . --json
npx aidn runtime shared-coordination-status --target . --json
```

### Expected Baseline

- `shared_runtime_mode=local-only`
- no PostgreSQL shared coordination backend in active use
- each project already looks operational in isolation

### Stop Conditions

Stop if any project is already broken before shared runtime is enabled.

## Phase 3 - Enable Project-Aware PostgreSQL Runtime

### Goal

Re-anchor each pilot project to the same PostgreSQL backend with distinct `project_id` values.

### Prerequisite

Export a PostgreSQL connection string in every shell:

```powershell
$env:AIDN_PG_URL = "postgres://user:pass@host:5432/db"
```

### Commands

Run in project A:

```powershell
npx aidn runtime shared-runtime-reanchor --target . --backend postgres --connection-ref env:AIDN_PG_URL --project-id project-alpha --workspace-id workspace-alpha --write --json
npx aidn runtime shared-coordination-doctor --target . --json
npx aidn runtime shared-coordination-migrate --target . --json
npx aidn runtime shared-coordination-bootstrap --target . --json
npx aidn runtime shared-coordination-status --target . --json
```

Run in project B with a different `project_id`:

```powershell
npx aidn runtime shared-runtime-reanchor --target . --backend postgres --connection-ref env:AIDN_PG_URL --project-id project-beta --workspace-id workspace-beta --write --json
npx aidn runtime shared-coordination-doctor --target . --json
npx aidn runtime shared-coordination-migrate --target . --json
npx aidn runtime shared-coordination-bootstrap --target . --json
npx aidn runtime shared-coordination-status --target . --json
```

### Evidence To Capture

- locator diff or resulting locator JSON
- doctor output
- migrate output
- bootstrap output
- status output

### What Must Be True

- `schema_status=ready`
- `compatibility_status=project-scoped`
- both projects resolve the same PostgreSQL backend
- `project_id` differs between the two projects

## Phase 4 - Validate Cross-Project Isolation

### Goal

Prove that same-named logical keys do not collide across projects.

### Method

Use the same session ids, cycle ids, and nominal backlog naming patterns in both projects.

### Commands

Run in both projects with intentionally overlapping logical names:

```powershell
npx aidn runtime session-plan --target . --session-id S900 --item "pilot shared key collision check" --promote --json
npx aidn runtime project-runtime-state --target . --json
npx aidn runtime project-handoff-packet --target . --json
npx aidn runtime project-coordination-summary --target . --json
npx aidn runtime shared-coordination-status --target . --json
```

Then inspect the backend from each project:

```powershell
npx aidn runtime shared-coordination-projects --target . --json
npx aidn runtime shared-coordination-projects --target . --project-id project-alpha --json
npx aidn runtime shared-coordination-projects --target . --project-id project-beta --json
```

### What Must Be True

- project A does not surface project B planning/handoff/coordination content
- project B does not surface project A planning/handoff/coordination content
- project enumeration lists both projects cleanly
- `inspectProject(project-alpha)` does not leak workspace rows from `project-beta`

### Failure Means

If any cross-project content appears in the wrong project, `MPG-22` fails and isolation is not validated.

## Phase 5 - Validate Admin Lifecycle On A Shared Backend

### Goal

Confirm that admin tooling stays understandable once the backend carries more than one project.

### Commands

Run in at least one project root:

```powershell
npx aidn runtime shared-coordination-projects --target . --json
npx aidn runtime shared-coordination-status --target . --json
npx aidn runtime shared-coordination-doctor --target . --json
npx aidn runtime shared-coordination-backup --target . --json
```

Run project-specific inspection:

```powershell
npx aidn runtime shared-coordination-projects --target . --project-id project-alpha --json
npx aidn runtime shared-coordination-projects --target . --project-id project-beta --json
```

### What Must Be True

- operator can see that one backend hosts more than one project
- counts and identities are understandable without raw SQL
- backup remains clearly scoped to the resolved target project

## Phase 6 - Validate Restore Safety

### Goal

Confirm that restore is project-safe on a real backend.

### Commands

In project A:

```powershell
npx aidn runtime shared-coordination-backup --target . --out .aidn/runtime/project-alpha-backup.json --json
```

Then preview restore from project B:

```powershell
npx aidn runtime shared-coordination-restore --target . --in .aidn/runtime/project-alpha-backup.json --json
```

### What Must Be True

- preview rejects with `project-mismatch`
- rejection message is explicit enough for an operator to understand what mismatched

### Optional Positive Check

Replay the backup back into the matching project only if the pilot owner is comfortable mutating the shared backend.

## Phase 7 - Summarize Evidence

### Goal

Turn the pilot into closure input, not just logs.

### Deliverables

At minimum, produce:

- one filled evidence file from `docs/TEMPLATE_MULTI_PROJECT_POSTGRESQL_PILOT_EVIDENCE_2026-04-03.md`
- the command outputs referenced by that evidence file
- one closure decision per remaining open item

### Closure Rules

Close `MPG-22` only if the pilot demonstrates all of the following:

- one PostgreSQL backend hosting more than one logical project
- no cross-project planning/handoff/coordination leakage
- project enumeration and inspection are operationally usable
- restore safety rejects cross-project replay
- no unexpected regression in local checkout-bound artifacts

If one of those fails, do not mark `MPG-22` completed.
Split the failure into a concrete follow-up with:

- exact symptom
- exact command that revealed it
- proposed acceptance criteria

## Minimal Evidence Set

The pilot should leave behind a small explicit evidence set under the evidence root:

- `phase0-git-topology.txt`
- `phase1-install-*.txt`
- `phase2-baseline-*.json`
- `phase3-postgres-enable-*.json`
- `phase4-isolation-*.json`
- `phase5-admin-*.json`
- `phase6-restore-safety-*.json`
- `pilot-evidence.md`

## Cleanup

If the pilot must be discarded after analysis:

```powershell
git -C <REPO_A_SOURCE> worktree remove <REPO_A_PILOT> --force
git -C <REPO_B_SOURCE> worktree remove <REPO_B_PILOT> --force
git -C <REPO_A_SOURCE> branch -D pilot/aidn-multi-project-a
git -C <REPO_B_SOURCE> branch -D pilot/aidn-multi-project-b
```

Adapt those commands if the chosen pilot shape is a monorepo.
