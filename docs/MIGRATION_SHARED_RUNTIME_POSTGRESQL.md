# Migration - Shared Runtime and PostgreSQL

Date: 2026-03-28
Status: codebase-aligned
Scope: incremental adoption path from local SQLite-only runtime to optional shared runtime and PostgreSQL-backed shared coordination.

## Invariants

- `docs/audit/*` stays worktree-local and versioned
- `workflow-index.sqlite` remains the local SQLite projection/cache
- PostgreSQL is used for shared coordination scope, not as a drop-in replacement for every SQLite reader
- shared runtime is opt-in
- rollback to local-only is supported

## Verification Surface

Use the smallest relevant verification set for the boundary you are changing:

- locator and path validity: `npm run perf:verify-shared-runtime-locator`, `npm run perf:verify-shared-runtime-path`
- re-anchor behavior: `npm run perf:verify-shared-runtime-reanchor`
- coordination backup and restore: `npm run perf:verify-shared-coordination-backup`, `npm run perf:verify-shared-coordination-restore`
- shared coordination doctoring: `npm run perf:verify-shared-coordination-doctor`
- multi-project federation: `npm run perf:verify-shared-coordination-multi-project`, `npm run perf:verify-shared-coordination-worktree-concurrency`

## Backup / Restore Runbook

Shared coordination backup protects coordination metadata only. It does not back up checkout-bound audit artifacts, local `.codex/*`, or the local SQLite runtime projection.

### Quick Reference

| Command | Default effect | Explicit write / sync flag | Primary use |
| --- | --- | --- | --- |
| `shared-coordination-backup` | read-only snapshot export | none | capture shared coordination state before a risky change |
| `shared-coordination-restore` | preview only | `--write` | replay a vetted snapshot into the shared backend |
| `shared-coordination-doctor` | read-only diagnostics | none | explain backend health, schema state, and next actions |

Operational checklist:

1. identify the target scope and backend kind
2. run the matching status check
3. capture the family-specific backup
4. preview the change if a `--dry-run` path exists
5. apply the change only after the preview is clean
6. rerun status and admission checks immediately after the write

Decision points:

- if the change only touches local checkout artifacts, use the git rollback path instead of shared-runtime restore
- if the change only touches the local SQLite projection, use `db-backup` / local restore instead of shared-coordination restore
- if the change touches shared coordination metadata, keep a shared backup before every write
- if the change needs a new backend or workspace boundary, re-anchor first and only then migrate

| Surface | Backup command | Restore command | Notes |
|---|---|---|---|
| Shared coordination PostgreSQL/sqlite-file | `npx aidn runtime shared-coordination-backup --target . --json` | `npx aidn runtime shared-coordination-restore --target . --write --json` | Captures workspace registry, planning states, handoff relays and coordination records. |
| Local runtime projection | `npx aidn runtime db-backup --target . --json` | regenerate or restore local SQLite backup | Remains target-root anchored and local. |
| Checkout-bound workflow docs | Git commit/branch backup | Git restore/revert | Never externalized by shared runtime. |

Safe sequence before mutating shared coordination:

1. inspect `shared-coordination-status`
2. capture `shared-coordination-backup`
3. run the mutating command with `--dry-run` when available
4. apply with `--write`
5. run `shared-coordination-status` and `pre-write-admit` again

Post-write verification:

- `shared-coordination-status --json` reports the expected backend kind and workspace identity
- `shared-coordination-doctor --json` reports a clean state or only expected warnings
- `pre-write-admit --skill requirements-delta --strict --json` remains admitted for the target checkout
- any restored coordination record still matches the local checkout’s active session and cycle

For write-adjacent shared-runtime changes, preview first when the command supports it:

- `shared-runtime-reanchor --json` before `--write`
- `shared-coordination-restore --json` before `--write`
- `shared-coordination-migrate --dry-run --json` before a live migration

Restore sequence:

1. run `shared-coordination-restore --json` without `--write` to preview
2. confirm backend kind, workspace id and backup schema version
3. run `shared-coordination-restore --write --json`
4. run `shared-coordination-status --json`
5. rerun the workflow admission gate before durable writes

Post-restore validation:

1. confirm the restore report exposes the expected `source_of_truth` and `metadata`
2. confirm `restore_applied=true` and the preview counts match the backup snapshot
3. run `shared-coordination-doctor --json`
4. run `shared-coordination-status --json`
5. run the local admission gate(s) for the affected workflow scope
6. verify the local digest/projection that consumes the restored shared state

Rollback command families:

- `shared-runtime-reanchor --local-only --write --json` to return a target to local-only mode
- `shared-coordination-restore --write --json` to restore shared coordination metadata
- `db-backup` to preserve the local SQLite projection before any destructive reset

Rollback expectations:

- prefer the narrowest rollback that matches the affected surface
- never use shared-coordination restore to fix a local doc-only mistake
- never use git revert to fix a corrupted shared coordination backend
- if both shared metadata and local projection are affected, restore the shared metadata first and then regenerate the local projection

Secrets:

- use `env:AIDN_PG_URL` or another environment-backed connection reference
- never commit raw PostgreSQL URLs, local absolute validation paths, or backup files containing sensitive payloads
- scrub support bundles before sharing outside the local machine

## Option 0 - Stay Local SQLite

If you do not need multi-worktree shared coordination, do nothing.

Current local behavior remains valid:

- local runtime under `.aidn/runtime/*`
- local SQLite projection under `.aidn/runtime/index/workflow-index.sqlite`
- DB-first and fileless readers continue to work from that local SQLite projection

Useful checks:

```bash
npx aidn runtime db-status --target . --json
npx aidn runtime pre-write-admit --target . --skill requirements-delta --strict --json
```

## Option 1 - Inspect Current Shared-Runtime State

Before changing anything:

```bash
npx aidn runtime shared-runtime-reanchor --target . --json
npx aidn runtime shared-coordination-status --target . --json
```

Use this when:

- the locator is missing
- the locator is malformed
- `workspace_id` mismatches an override
- you want to confirm whether the worktree is still `local-only` or already `shared-runtime`

## Multi-Repo Opt-In Contract

Multi-repo or multi-worktree federation is available only through explicit shared-runtime configuration.

Required contract:

- every participating project/worktree has a validated `.aidn/project/shared-runtime.locator.json`
- the locator identifies the shared backend and workspace boundary
- project/workspace/worktree identity is visible in `shared-coordination-status --json`
- PostgreSQL credentials are referenced through `env:*`
- shared coordination contains coordination metadata only; local audit artifacts remain in each checkout

Before joining another repository or worktree to the same backend:

```bash
npx aidn runtime shared-runtime-reanchor --target . --json
npx aidn runtime shared-coordination-status --target . --json
npm run perf:verify-shared-runtime-locator
npm run perf:verify-shared-coordination-multi-project
npm run perf:verify-shared-coordination-worktree-concurrency
```

Do not copy locator files blindly between repositories. Re-anchor each target so `project_id`, `workspace_id`, `worktree_id`, backend kind and connection reference are checked against that target.

## Option 2 - Shared Runtime With `sqlite-file`

This is useful for controlled experiments where several worktrees need a shared coordination root but PostgreSQL is not available yet.

Constraints:

- use a shared root outside `docs/`, `docs/audit/`, `.git`, and `.aidn/runtime`
- prefer a root outside the worktree checkout when using linked worktrees
- treat this as lighter-weight than PostgreSQL, not as the final multi-writer answer

Example:

```bash
npx aidn runtime shared-runtime-reanchor \
  --target . \
  --backend sqlite-file \
  --shared-root ../aidn-shared \
  --workspace-id workspace-main \
  --write \
  --json
```

Then verify:

```bash
npx aidn runtime pre-write-admit --target . --skill requirements-delta --strict --json
npx aidn runtime shared-coordination-status --target . --json
```

## Option 3 - Shared Runtime With PostgreSQL

Use PostgreSQL when shared coordination is truly multi-worktree or multi-writer.

### 1. Define the connection secret

Example:

```bash
export AIDN_PG_URL='postgres://user:pass@host:5432/aidn'
```

On Windows PowerShell:

```powershell
$env:AIDN_PG_URL='postgres://user:pass@host:5432/aidn'
```

### 2. Re-anchor each worktree

Run this in every worktree that should join the same shared workspace:

```bash
npx aidn runtime shared-runtime-reanchor \
  --target . \
  --backend postgres \
  --connection-ref env:AIDN_PG_URL \
  --workspace-id workspace-main \
  --write \
  --json
```

### 3. Bootstrap the shared backend

```bash
npx aidn runtime shared-coordination-bootstrap --target . --json
```

### 4. Verify status

```bash
npx aidn runtime shared-coordination-status --target . --json
```

Expected shape:

- `shared_coordination_backend.backend_kind = postgres`
- `shared_coordination_backend.status = ready`
- `health.ok = true`

Optional local backup/export:

```bash
npx aidn runtime shared-coordination-backup --target . --json
```

Restore preview or replay from that local snapshot:

```bash
npx aidn runtime shared-coordination-restore --target . --json
npx aidn runtime shared-coordination-restore --target . --write --json
```

### 5. Optional live smoke

```bash
AIDN_PG_SMOKE_URL="$AIDN_PG_URL" npm run perf:verify-postgres-shared-coordination-live-smoke
```

This smoke is intended to run locally against a PostgreSQL instance reachable from your machine.
If you want a manually triggered CI path, use `.github/workflows/runtime-ops-live-smoke.yml`.

## Repair and Re-anchor

If `.aidn/project/shared-runtime.locator.json` is broken or unsafe:

- inspect first:

```bash
npx aidn runtime shared-runtime-reanchor --target . --json
```

- fallback safely to local-only:

```bash
npx aidn runtime shared-runtime-reanchor --target . --local-only --write --json
```

- or repair with explicit shared settings:

```bash
npx aidn runtime shared-runtime-reanchor \
  --target . \
  --backend postgres \
  --connection-ref env:AIDN_PG_URL \
  --workspace-id workspace-main \
  --write \
  --json
```

After repair:

```bash
npx aidn runtime pre-write-admit --target . --skill requirements-delta --strict --json
```

## Rollback

Return a worktree to local-only mode:

```bash
npx aidn runtime shared-runtime-reanchor --target . --local-only --write --json
```

Effects:

- shared runtime is disabled for that worktree
- the locator is rewritten into a safe disabled state
- local SQLite projection remains available

## What Does Not Change

These do not migrate into PostgreSQL automatically:

- `docs/audit/*`
- `AGENTS.md`
- `.aidn/runtime/index/workflow-index.sqlite`
- fileless reconstruction logic that depends on the local SQLite projection

## Recommended Order

1. inspect current state
2. choose `local-only`, `sqlite-file`, or `postgres`
3. re-anchor one worktree
4. bootstrap and verify status
5. only then add sibling worktrees
6. use rollback to local-only if the shared setup is not acceptable
