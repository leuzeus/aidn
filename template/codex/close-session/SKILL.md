---
name: close-session
description: Finalize session, enforce drift check, update snapshot, validate branch context consistency.
---

# Close Session Skill

## Goal
End session cleanly and prepare for fast resume.

## Hygiene Guardrails
- Do not close session if at least one attached open cycle has no explicit decision.
- Mutate only session/snapshot/current-state artifacts, plus cycle status files explicitly selected by user decision.
- Never auto-merge branches from this skill.
- Apply write-on-change behavior to avoid churn in unchanged artifacts.

## Pre-Write Admission
Before the first durable write in this skill, run:
- `npx aidn runtime pre-write-admit --target . --skill close-session --json`
- If `admission_status` is `blocked`, STOP and continue with read-only re-anchor or repair steps only.

## Steps

1) Review current session SXXX.md.

2) Enforce OVERFLOW / DRIFT CHECK:

Ask:
- Can objective be explained in 1 sentence?
- Was scope expanded?
- Unexpected modules touched?
- Future clarity acceptable?

If drift detected:
- Fill Recovery section
- Suggest split into new cycle if needed
- Create CR entry suggestion if objective changed

3) Resolve open cycles before closing session (mandatory gate):

- Read attached cycles from session tracking and/or infer from active cycles + branch ownership.
- Build the list of cycles with state `OPEN | IMPLEMENTING | VERIFYING`.
- For each open cycle, require explicit decision:
  - `integrate-to-session` (merge cycle into current session branch and mark cycle `DONE`)
  - `report` (carry to next session)
  - `close-non-retained` (`NO_GO` or `DROPPED` with rationale)
  - `cancel-close`
- Ask these decisions explicitly (interactive question or equivalent user confirmation).
- If at least one open cycle has no explicit decision, STOP session close.
- Record all decisions in session close report (`Cycle Resolution At Session Close`).

4) Validate Branch/Cycle alignment:

If COMMITTING mode:
- Detect branch kind: `session` | `cycle` | `intermediate`
- If `cycle`: ensure cycle exists, status.md updated, and `branch_name == current branch`
- If `intermediate`: ensure one parent cycle owner and recorded integration path
- If `session`: ensure active session file `session_branch == current branch` and keep `status.md.branch_name` on cycle branches

If mismatch → warn and suggest fix.

5) Update:
docs/audit/snapshots/context-snapshot.md

Update:
- Active cycles state
- New gaps (if any)
- Top hypotheses
- Next Entry Point (must allow resume in <5 minutes)

6) Update:
docs/audit/CURRENT-STATE.md

Update:
- `updated_at`
- active session / cycle summary after close decision
- `branch_kind`
- `mode`
- `dor_state` if still relevant
- top open items
- next actions
- blocking findings when known

7) Ensure session contains:
### Outputs
### Open loops
### Blockers
### Cycle Resolution At Session Close
### Session close gate satisfied?
### Next Entry Point
### Snapshot updated? (checked)

8) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill close-session --mode <THINKING|EXPLORING|COMMITTING> --target . --json`
- the runtime `close-session` hook applies open-cycle resolution admission before delegating to generic `session-close` checkpoint/index/repair behavior
- expect machine-visible outcomes such as `close_session_allowed`, `blocked_open_cycles_must_be_resolved`, or `blocked_cycle_resolution_decision_required`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill close-session --project-runtime-state --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when it has just been refreshed by hydration.
- in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).
- in files, this hook remains non-blocking by default.
- DB runtime sync (mandatory in dual/db-only; optional in files):
- run `npx aidn runtime sync-db-first-selective --target . --json` (falls back to full sync when needed).
- for DB-first write-through on a specific artifact, run `npx aidn runtime db-first-artifact --target . --path <relative-audit-path> --source-file <file> --json`.
- in dual/db-only, this step is mandatory and blocking on failure.
- in files, this step is optional unless repository policy requires DB parity.
- if `repair_layer_status` is `warn` or `block`, run `npx aidn runtime repair-layer-triage --target . --json` before continuing.
- if triage exposes a safe-only autofix candidate, you MAY run `npx aidn runtime repair-layer-autofix --target . --apply --json`.
- if blocking findings remain after triage/autofix, STOP the skill and request user arbitration.
- in files, strict mode remains optional by repository policy.
- in dual/db-only, prefer `--fail-on-repair-block` on the JSON hook invocation and STOP on `repair_layer_status=block`.

Do not promote baseline automatically.
If cycle DONE, recommend using promote-baseline workflow.

