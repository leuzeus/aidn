---
name: close-session
description: Finalize session, enforce drift check, update snapshot, validate branch context consistency.
---

# Close Session Skill

## Goal
End session cleanly and prepare for fast resume.

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

6) Ensure session contains:
### Outputs
### Open loops
### Blockers
### Cycle Resolution At Session Close
### Session close gate satisfied?
### Next Entry Point
### Snapshot updated? (checked)

Do not promote baseline automatically.
If cycle DONE, recommend using promote-baseline workflow.
