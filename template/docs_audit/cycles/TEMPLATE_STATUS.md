# Cycle Status — CXXX-[type]

state: OPEN
owner: (name)
current goal: (1 phrase)

branch_name: (git branch name)

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

## DoR Checklist (Core Gate for COMMITTING)

- [ ] Cycle exists and branch mapping is valid (`branch_name`)
- [ ] Objective is explicit in `brief.md`
- [ ] Scope and non-scope are explicit in `brief.md`
- [ ] First implementation step is explicit in `plan.md`
- [ ] Constraints and risks are acknowledged

## DoR Adaptive Checks (By Cycle Type)

For `spike`:
- [ ] Learning goal and timebox are explicit

For `feature | hotfix | refactor | perf | compat | corrective`:
- [ ] At least one REQ exists in `audit-spec.md`
- [ ] Planned test linkage exists in `traceability.md`

For `security | migration | integration | structural`:
- [ ] Impact notes are documented
- [ ] Rollback or compatibility strategy is documented

## Quick links
- brief: brief.md
- plan: plan.md
- hypotheses: hypotheses.md
- audit spec: audit-spec.md
- traceability: traceability.md
- gap-report: gap-report.md
- decisions: decisions.md
- change-requests: change-requests.md
