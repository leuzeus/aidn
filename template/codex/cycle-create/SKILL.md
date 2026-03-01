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
- Current session branch name (if accessible)

## Steps

0) Run continuity gate before creating files/branch:
- Detect current mode: THINKING | EXPLORING | COMMITTING.
- Detect current session branch (if any).
- Detect latest active cycle branch in same session (`OPEN | IMPLEMENTING | VERIFYING`) using `status.md.last updated` + branch mapping.
- Compare requested source branch with:
  - latest active cycle branch
  - current session branch tip

If requested source branch is neither:
- STOP and ask user to select exactly one continuity rule (selection list):
  1. `R1_STRICT_CHAIN (Recommended)` — start from latest active cycle branch
  2. `R2_SESSION_BASE_WITH_IMPORT` — start from session tip with explicit predecessor import
  3. `R3_EXCEPTION_OVERRIDE` — start from custom branch with explicit risk acceptance
- Do not create cycle artifacts until user selects.

Mode gate:
- COMMITTING: allow R1/R2 by default, R3 only with explicit user override.
- EXPLORING: allow R2/R3.
- THINKING: R3 only (no production implementation).

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
- branch_name: `<cycle-type>/CXXX-<short-title>`
- session_owner: `<active session id>` (if available)
- outcome: ACTIVE
- reported_to_session: `none`
- continuity_rule: `R1_STRICT_CHAIN | R2_SESSION_BASE_WITH_IMPORT | R3_EXCEPTION_OVERRIDE`
- continuity_base_branch: `<branch actually used to create this cycle>`
- continuity_latest_cycle_branch: `<detected latest active cycle branch | none>`
- continuity_decision_by: `<user | agent>`
- continuity_override_reason: `<required when rule=R3_EXCEPTION_OVERRIDE>`
- dor_state: NOT_READY
- scope_frozen: false
- next step: write plan + audit spec (or spike goal)

4) Branch source rule:
- Apply selected continuity rule:
  - R1: create cycle branch from latest active cycle branch.
  - R2: create cycle branch from active session branch tip + record predecessor import target in `status.md`.
  - R3: create cycle branch from explicit custom base + require risk rationale in `change-requests.md`.
- Do not use the session branch as `status.md.branch_name`.

5) If type=spike:
- mark in brief.md: learning goal + timebox
- add rule: “code may be throwaway”

6) Update snapshot:
- Add the cycle as active
- Set next entry point to status.md

7) Mark readying actions:
- fill DoR checklist in status.md
- set `dor_state: READY` only when core gate is satisfied

Output:
- Cycle path created
- Next best action list (2-3 items)
