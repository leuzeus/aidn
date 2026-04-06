# Crash Recovery Runbook

Use this runbook after an abrupt stop of `aidn` processes when the repository uses shared coordination with PostgreSQL.

This is an operational recovery sequence for an installed repository. It is not a global atomic reset for local files, SQLite, and PostgreSQL together.

## Preferred Entry Point

Prefer the `crash-recovery` skill first.

Use the skill when:

- local backlog or handoff artifacts may be missing or stale
- shared PostgreSQL coordination may be ahead of local files
- the next safe action is unclear after restart

The skill is the primary operator path. The CLI sequence below is the manual fallback and the reference procedure behind the skill.

## Prerequisite

Set the shared PostgreSQL connection before shared-runtime commands:

```powershell
$env:AIDN_PG_URL='postgres://...'
```

## Manual CLI Fallback

### 1. Diagnose shared state

```powershell
npx aidn runtime shared-coordination-doctor --target . --json
npx aidn runtime shared-coordination-status --target . --json
```

Expected outcome:

- backend is `ready`
- the active `planning_state` and latest `handoff_relay` are visible

### 2. Ask for the safest next step

```powershell
npx aidn runtime coordinator-next-action --target . --json
```

If the recommendation is `reanchor`, do not force a durable write yet.

### 3. Rematerialize the backlog if the local backlog is missing

```powershell
npx aidn runtime session-plan --target . --session-id S### --backlog-file docs/audit/backlog/BL-S###-main.md --promote --json
```

Use the active session and backlog path reported by `shared-coordination-status`.

### 4. Regenerate the handoff packet if needed

```powershell
npx aidn runtime project-handoff-packet --target . --json
```

This recreates `docs/audit/HANDOFF-PACKET.md` locally and refreshes the shared handoff relay.

### 5. Refresh the local runtime digest

```powershell
npx aidn runtime project-runtime-state --target . --json
```

### 6. Re-run admission

```powershell
npx aidn runtime handoff-admit --target . --json
```

If admission still rejects, inspect the reported workflow facts instead of retrying blindly.

## Reanchor Path

Use this when shared state exists but local workflow facts are still inconsistent.

Inspect first:

```powershell
npx aidn runtime shared-runtime-reanchor --target . --json
```

If you must temporarily detach the worktree from shared runtime:

```powershell
npx aidn runtime shared-runtime-reanchor --target . --local-only --write --json
```

To attach the worktree back to PostgreSQL shared runtime:

```powershell
npx aidn runtime shared-runtime-reanchor --target . --backend postgres --connection-ref env:AIDN_PG_URL --workspace-id <workspace-id> --write --json
```

## Restore Path

Use this when the shared PostgreSQL state itself must be restored from a backup snapshot.

Preview first:

```powershell
npx aidn runtime shared-coordination-restore --target . --in .aidn/runtime/shared-coordination-backup.json --json
```

Apply only after preview is acceptable:

```powershell
npx aidn runtime shared-coordination-restore --target . --in .aidn/runtime/shared-coordination-backup.json --write --json
```

If a restore is interrupted, rerun the same restore command. The PostgreSQL replay converges via upsert semantics.

## Scenario Notes

### Crash During `session-plan`

Recovery is usually:

1. `shared-coordination-status`
2. `session-plan --promote`
3. `coordinator-next-action`

### Crash During `project-handoff-packet`

Recovery is usually:

1. `shared-coordination-status`
2. `project-handoff-packet`
3. `handoff-admit`

### Crash During `coordinator-dispatch-execute`

Do not rerun immediately. First verify whether the agent command already produced durable effects. This is the riskiest scenario for duplicate side effects.

### Crash During `shared-coordination-restore`

Rerun the same restore after verifying schema compatibility and workspace identity.

## Operating Rules

- Prefer the `crash-recovery` skill over manual command-by-command recovery.
- Prefer `coordinator-next-action` over guessing.
- If shared planning exists, `session-plan --promote` is the primary backlog recovery command.
- If `handoff-admit` says `reanchor`, treat that as a stop sign before durable writes.
- Do not replay `coordinator-dispatch-execute` blindly.
- Use restore only for shared-state repair, not as a substitute for fixing bad local workflow facts.
