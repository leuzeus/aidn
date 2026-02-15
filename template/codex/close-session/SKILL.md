---
name: close-session
description: Finalize session, enforce drift check, update snapshot, validate branch-cycle consistency.
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

3) Validate Branch/Cycle alignment:

If COMMITTING mode:
- Ensure cycle exists
- Ensure status.md updated
- Ensure branch_name matches current branch

If mismatch → warn and suggest fix.

4) Update:
docs/audit/snapshots/context-snapshot.md

Update:
- Active cycles state
- New gaps (if any)
- Top hypotheses
- Next Entry Point (must allow resume in <5 minutes)

5) Ensure session contains:
### Outputs
### Open loops
### Blockers
### Next Entry Point
### Snapshot updated? (checked)

Do not promote baseline automatically.
If cycle DONE, recommend using promote-baseline workflow.
