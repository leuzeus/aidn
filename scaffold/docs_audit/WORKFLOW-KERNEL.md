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

## Procedure Routing

Keep the Read Order above as the default and recovery route. The table locates
existing conditional procedures; it does not remove startup reads or admissions.
For an explicitly requested scoped consultation, use only complete units bound
to accepted client authorities. Missing bindings, units, dependencies or stale
sources require expansion through the default route, while remaining read-only.
Native qualification is required before replacing the default startup route.

| Trigger | Read / invoke | Obligation retained |
|---|---|---|
| Every session, including read-only work | `aidn-context-reload`, CURRENT-STATE.md, this kernel, WORKFLOW_SUMMARY.md, `aidn-start-session` | Activation and session admission; resume/choose/create/stop remains authoritative |
| COMMITTING or selected session/cycle continuity | The admitted session file, cycle status.md and plan.md; `aidn-branch-cycle-audit` in COMMITTING | Exact branch ownership, DoR and first plan step; never choose a competing cycle by recency |
| Runtime freshness unknown/stale or repair warn/block | RUNTIME-STATE.md; read-only `aidn runtime project-runtime-state --target . --json` | Recheck the configured canonical backend; block stops workflow actions |
| Another agent prepared a relay | HANDOFF-PACKET.md; `aidn runtime handoff-admit --target . --json` | Reload referenced artifacts, respect shared planning dispatch and reject blocked/stale handoffs |
| Several session cycles may converge | INTEGRATION-RISK.md and the declared usage_matrix | Keep coordination dependencies and coverage visible |
| Canonical rule precision or conflicting instructions | WORKFLOW.md and SPEC.md | SPEC > WORKFLOW > AGENTS; stop unresolved contradictions |
| Lost, missing or contradictory context | Recovery Fallback below and REANCHOR_PROMPT.md; CRASH-RECOVERY-RUNBOOK.md after abrupt stop | Read-only until the mandatory restatement is complete |

Omitted procedures must be named in the context report with their trigger and
expansion reference. A trigger becoming true invalidates the previous selection.

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
- revalidate the configured canonical backend before acting; hydrated context is a derived cache and cannot establish freshness
- refresh caches only through the separately authorized mutating path; startup diagnosis remains read-only
- check `repair_layer_status` before durable write
- stop on blocking repair findings

## Recovery Fallback

If `CURRENT-STATE.md` is missing or stale, reload from:

1. `docs/audit/snapshots/context-snapshot.md`
2. `docs/audit/baseline/current.md`
3. latest active session file
4. active cycle `status.md`

No durable write is allowed until the minimal restatement above is complete.
