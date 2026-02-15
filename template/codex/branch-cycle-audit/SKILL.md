---
name: branch-cycle-audit
description: Verify current branch maps to exactly one cycle, enforce branch_name in status.md, and suggest fixes if mismatch.
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

3) Check mapping:
- If exactly one cycle has branch_name == current branch → OK
- If none match:
  - suggest creating a cycle (cycle-create)
  - OR update the correct cycle status.md with branch_name
- If more than one match:
  - warn: ambiguous mapping
  - ask user which cycle owns the branch
  - propose splitting branches or renaming

4) If current work mode is COMMITTING:
Apply Branch/Cycle Requirement Auto-check:
- Require a cycle + status.md
- Require branch mapping in status.md (branch_name: ...)
- Validate status DoR marker:
  - `dor_state` should be READY
  - if NOT_READY, ask user to resolve DoR gaps or explicitly document override reason

5) Update snapshot (optional but recommended):
- Ensure active cycle list reflects the mapped cycle
- Next entry point points to that cycle status.md

Output:
- Mapping result
- Fix plan (if mismatch)
