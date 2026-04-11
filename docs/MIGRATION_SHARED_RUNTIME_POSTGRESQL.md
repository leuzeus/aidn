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
