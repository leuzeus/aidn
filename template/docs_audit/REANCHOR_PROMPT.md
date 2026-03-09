# Reanchor Prompt

Use this prompt when an assistant lost context, restarted, or only partially remembers the workflow state.

## Mandatory Read List

If another agent already prepared a relay:

1. `docs/audit/HANDOFF-PACKET.md`
2. run `npx aidn runtime handoff-admit --target . --json`

Then continue with:

1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`
4. active session file, if any
5. active cycle `status.md`, if any

If more detail is needed:

6. `docs/audit/WORKFLOW.md`
7. `docs/audit/SPEC.md`

In `dual` / `db-only`:

8. hydrated runtime context under `.aidn/runtime/context/`

## Required Restatement Before Durable Write

State explicitly:

- current mode
- current branch kind
- active session
- active cycle
- `dor_state`
- handoff status when `HANDOFF-PACKET.md` is present
- transition policy status when `HANDOFF-PACKET.md` is present
- first implementation step from `plan.md` when `COMMITTING`
- runtime state mode when known
- missing context, if any
- durable write authorized: `yes | no`

## Durable Write Reminder

Durable writes include:

- `apply_patch`
- direct file edits
- generated file creation
- mutating scripts

## Stop Rule

If one required field is unknown, ambiguous, or contradictory:

- do not write
- continue with read-only context reload
- state the smallest compliant next step

## Suggested Output Format

- Context workflow detected
- Audit de conformite
- Plan de changement
- Decision: durable write authorized or refused
- If refused: next compliant step
