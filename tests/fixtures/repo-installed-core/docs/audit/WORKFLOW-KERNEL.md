# Workflow Kernel

Purpose: shortest safe workflow re-anchor before any durable write.

## Read Order

If another agent already prepared a handoff:

1. `docs/audit/HANDOFF-PACKET.md`
2. run `npx aidn runtime handoff-admit --target . --json`
3. `docs/audit/CURRENT-STATE.md`
4. `docs/audit/WORKFLOW-KERNEL.md`

Otherwise:

1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`
4. `docs/audit/WORKFLOW.md`
5. `docs/audit/SPEC.md` only when a canonical rule must be checked precisely

Agent-to-agent handoff is advisory only. The receiving agent must still complete the mandatory restatement before any durable write.

## Mandatory Restatement Before Durable Write

State explicitly:

- current mode: `THINKING | EXPLORING | COMMITTING`
- current branch kind: `source | session | cycle | intermediate | unknown`
- active session: `SXXX | none | unknown`
- active cycle: `CXXX | none | unknown`
- `dor_state`: `READY | NOT_READY | unknown`
- first implementation step from `plan.md` when writing in `COMMITTING`

Durable writes include:

- `apply_patch`
- direct file edits
- generated file creation
- mutating scripts

## Hard Stops

- no session start context -> stop and reload
- no declared mode -> no durable write
- `COMMITTING` without active cycle -> stop
- branch/cycle mapping ambiguous -> stop
- `dor_state != READY` in `COMMITTING` without explicit override -> stop
- missing first implementation step in `COMMITTING` -> stop
- incomplete or contradictory workflow context -> stay read-only

## Runtime State Reminder

If runtime state mode is `dual` or `db-only`:

- run workflow hooks in strict mode
- read hydrated runtime context before acting
- check `repair_layer_status` before durable write
- stop on blocking repair findings

## Recovery Fallback

If `CURRENT-STATE.md` is missing or stale, reload from:

1. `docs/audit/snapshots/context-snapshot.md`
2. `docs/audit/baseline/current.md`
3. latest active session file
4. active cycle `status.md`

No durable write is allowed until the minimal restatement above is complete.
