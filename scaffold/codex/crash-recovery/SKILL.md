---
name: crash-recovery
description: Recover safely after an abrupt stop, restart, or suspected partial runtime write in an aidn repository using shared coordination. Use when local backlog or handoff artifacts may be missing or stale, when PostgreSQL shared state may be ahead of local files, or when the next safe action is to reanchor, rematerialize planning, regenerate a handoff packet, or restore shared coordination.
---

# Crash Recovery Skill

## Goal
Recover the repository to the smallest safe resumable state after an abrupt stop.

## Hygiene Guardrails
- Diagnose first, write second.
- Use `docs/audit/CRASH-RECOVERY-RUNBOOK.md` as the installed source of truth.
- Do not guess missing workflow facts.
- Treat `reanchor` as a stop sign before durable writes.
- Do not rerun `coordinator-dispatch-execute` blindly.

## Steps

1) Read:
- `docs/audit/HANDOFF-PACKET.md` when present
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md` when present
- `docs/audit/CRASH-RECOVERY-RUNBOOK.md`

2) Hydrate DB-backed runtime context:
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill crash-recovery --project-runtime-state --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when it has just been refreshed by hydration.
- if repair context is unclear, run `npx aidn runtime repair-layer-triage --target . --json`.

3) Diagnose shared state:
- `npx aidn runtime shared-coordination-doctor --target . --json`
- `npx aidn runtime shared-coordination-status --target . --json`
- `npx aidn runtime coordinator-next-action --target . --json`

4) If shared planning exists but local backlog is missing or stale:
- `npx aidn runtime session-plan --target . --session-id S### --backlog-file docs/audit/backlog/BL-S###-main.md --promote --json`

5) If the local handoff packet is missing or stale:
- `npx aidn runtime project-handoff-packet --target . --json`

6) Refresh local projections:
- `npx aidn runtime project-runtime-state --target . --json`
- `npx aidn runtime handoff-admit --target . --json`

7) If output still recommends `reanchor`:
- inspect with `npx aidn runtime shared-runtime-reanchor --target . --json`
- repair or detach only through `shared-runtime-reanchor`

8) Use shared restore only when the PostgreSQL shared state itself is damaged or incomplete:
- preview `npx aidn runtime shared-coordination-restore --target . --in .aidn/runtime/shared-coordination-backup.json --json`
- apply only after preview is acceptable

## Output

State explicitly:
- whether the repository is resumable now
- whether recovery used shared planning, shared handoff, reanchor, or restore
- the next safe command
- whether durable writes are authorized or refused
