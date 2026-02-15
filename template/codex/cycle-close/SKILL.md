---
name: cycle-close
description: Close a cycle safely (VERIFYING → DONE), run exit checklist (REQ/TEST/GAP/CR), update status.md, snapshot, and next entry point.
---

# Cycle Close Skill

## Goal
Close a cycle cleanly and make it baseline-ready.

## Inputs
- Target cycle folder (CXXX-...)
- Desired final state: VERIFYING or DONE

## Steps

1) Locate cycle files:
- status.md
- audit-spec.md
- traceability.md
- decisions.md
- change-requests.md
- (optional) gap-report.md
- (optional) hypotheses.md

2) Exit Checklist (produce a short report):

### Requirements & Acceptance
- Are REQ entries explicit and observable?
- Are acceptance criteria present for key REQs?

### Tests / Validation
- Traceability matrix updated OR justification provided for non-testable REQs.
- TEST references exist or validation steps documented.

### Gaps
- If gap-report.md exists:
  - List open GAPs
  - For each open GAP: fix code | fix spec | fix test | explicitly accept risk

### Change Requests
- Ensure scope changes are recorded in change-requests.md.
- If medium/high impact CR occurred, confirm it was split into a new cycle (or justify why not).

### Decisions
- Confirm major design decisions are captured in decisions.md.

3) Update status.md:
- state: VERIFYING (if remaining validations) or DONE (if complete)
- scope_frozen: true
- last updated: (today)
- next step:
  - VERIFYING: list remaining validations
  - DONE: recommend promote-baseline

4) Update snapshot:
- If DONE: remove from Active cycles, move to “Recently closed” section (if present) or add note.
- Set next entry point:
  - If DONE: suggest promote-baseline or start next cycle
  - If VERIFYING: list remaining verification tasks

Output:
- Exit checklist report
- Files updated list
- Next entry point
