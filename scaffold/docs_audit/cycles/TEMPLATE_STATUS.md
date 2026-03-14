# Cycle Status — CXXX-[type]

state: OPEN
owner: (name)
current goal: (1 phrase)

branch_name: (git branch name)
session_owner: (ex: S065) # optional but recommended
outcome: ACTIVE # ACTIVE | DONE | NO_GO | DROPPED
reported_to_session: (ex: S066 | none)

continuity_rule: R1_STRICT_CHAIN # R1_STRICT_CHAIN | R2_SESSION_BASE_WITH_IMPORT | R3_EXCEPTION_OVERRIDE
continuity_base_branch: (branch used as source for this cycle branch)
continuity_latest_cycle_branch: (latest active cycle branch at creation time | none)
continuity_decision_by: (user | agent)
continuity_override_reason: (required only if continuity_rule=R3_EXCEPTION_OVERRIDE)

dor_state: NOT_READY
dor_last_check: 2026-02-07
dor_checked_by: (name/agent)
dor_override_reason: (optional; required only if forced COMMITTING while NOT_READY)

scope_frozen: false
scope_freeze_reason: (ex: implementing phase)

blockers:
  - (none)

next step:
  - (ex: write audit-spec.md)

last updated: 2026-02-07

## DoR Reference
- Canonical DoR rules: `docs/audit/SPEC.md` (`SPEC-R04`).
- This status file stores state only (`dor_state`, `dor_last_check`, overrides).

## Quick links
- brief: brief.md
- plan: plan.md
- hypotheses: hypotheses.md
- audit spec: audit-spec.md
- traceability: traceability.md
- gap-report: gap-report.md
- decisions: decisions.md
- change-requests: change-requests.md
