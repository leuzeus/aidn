---
name: branch-cycle-audit
description: Verify branch ownership for session/cycle/intermediate branches and enforce cycle mapping invariants.
---

# Branch ↔ Cycle Audit Skill

## Goal
Prevent silent drift between Git branches and cycle artifacts.

## Steps

1) Identify current Git branch (if accessible).
If not accessible, ask user to provide it.

2) Scan active cycles:
docs/audit/cycles/*/status.md
Collect:
- cycle id
- state
- branch_name

3) Classify current branch:
- session branch: `^S[0-9]+-`
- cycle branch: `^(feature|hotfix|spike|refactor|structural|migration|security|perf|integration|compat|corrective)/C[0-9]+-`
- intermediate branch: `^(feature|hotfix|spike|refactor|structural|migration|security|perf|integration|compat|corrective)/C[0-9]+-I[0-9]+-`

4) Check mapping by branch kind:
- Cycle branch:
  - Exactly one cycle MUST have `status.md.branch_name == current branch` -> OK
  - If none: suggest creating/remapping the cycle and updating `status.md.branch_name`
  - If more than one: ambiguous ownership -> STOP and ask user decision
- Intermediate branch:
  - Must resolve to exactly one parent cycle owner (by id in branch name and/or session metadata)
  - Must keep integration path `intermediate -> cycle -> session`
- Session branch:
  - Must match active session file `session_branch`
  - `status.md.branch_name` MUST NOT be rewritten to the session branch
  - Commits should be limited to integration/handover/PR orchestration unless explicit exception is documented
  - If session close is requested, verify open-cycle resolution decisions are present (`integrate-to-session` / `report` / `close-non-retained`)

5) If current work mode is COMMITTING:
Apply Branch/Cycle Requirement Auto-check:
- Require cycle ownership for cycle/intermediate branches
- Require branch mapping in status.md for cycle branches only
- Require continuity metadata in cycle `status.md`:
  - `continuity_rule`
  - `continuity_base_branch`
  - `continuity_latest_cycle_branch`
  - `continuity_decision_by`
- Validate status DoR marker:
  - `dor_state` should be READY
  - if NOT_READY, ask user to resolve DoR gaps or explicitly document override reason

Continuity validation by rule:
- `R1_STRICT_CHAIN`:
  - latest cycle branch must be ancestor of current cycle branch (`git merge-base --is-ancestor <latest> <current>`).
  - if not ancestor -> STOP and request remediation.
- `R2_SESSION_BASE_WITH_IMPORT`:
  - session branch must be ancestor of current cycle branch.
  - predecessor import target must be documented in status/session artifact before `IMPLEMENTING`.
- `R3_EXCEPTION_OVERRIDE`:
  - `continuity_override_reason` must be explicit.
  - matching CR entry must exist with impact >= medium.
  - if missing -> STOP.

6) Update snapshot (optional but recommended):
- Ensure active cycle list reflects the mapped cycle
- Next entry point points to that cycle status.md

Output:
- Mapping result
- Fix plan (if mismatch)
