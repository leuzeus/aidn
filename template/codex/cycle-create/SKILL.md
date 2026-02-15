---
name: cycle-create
description: Create a new cycle folder (CXXX-[type]) with required artifacts, initialize status.md with branch_name and guardrails fields.
---

# Cycle Create Skill

## Goal
Create a clean cycle scaffold fast and correctly.

## Inputs (ask user if missing)
- Cycle ID: CXXX
- Type: feature | spike | refactor | structural | migration | security | perf | integration | compat | corrective | hotfix
- Short title (for folder suffix)
- Current branch name (if accessible)

## Steps

1) Create folder:
docs/audit/cycles/CXXX-[type]-<short-title>/

2) Create minimal required files using templates:
- status.md (required)
- brief.md
- plan.md
- hypotheses.md
- audit-spec.md
- traceability.md
- decisions.md
- change-requests.md
- (optional) gap-report.md (only when needed)

3) In status.md, set:
- state: OPEN
- branch_name: <current branch or suggested>
- dor_state: NOT_READY
- scope_frozen: false
- next step: write plan + audit spec (or spike goal)

4) If type=spike:
- mark in brief.md: learning goal + timebox
- add rule: “code may be throwaway”

5) Update snapshot:
- Add the cycle as active
- Set next entry point to status.md

6) Mark readying actions:
- fill DoR checklist in status.md
- set `dor_state: READY` only when core gate is satisfied

Output:
- Cycle path created
- Next best action list (2-3 items)
