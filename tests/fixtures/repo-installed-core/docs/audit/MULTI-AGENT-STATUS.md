# Multi-Agent Status

Purpose:

- provide one short operational digest for multi-agent routing
- summarize handoff, roster validity, selection preview, and coordination history
- reduce the need to open multiple multi-agent artifacts during reload

Rule/State boundary:

- this file is a derived digest
- canonical workflow rules remain in `SPEC.md` and `WORKFLOW.md`
- detailed state stays in `HANDOFF-PACKET.md`, `AGENT-ROSTER.md`, `AGENT-SELECTION-SUMMARY.md`, `COORDINATION-SUMMARY.md`, and `USER-ARBITRATION.md`

## Summary

updated_at: template
recommended_role: coordinator
recommended_action: reanchor
recommended_goal: reload the active session, cycle, and runtime facts before acting
handoff_status: none
handoff_admission_status: none
roster_verification: pass
roster_issue_count: 0
adapter_health_pass: yes
environment_ready_count: 0
environment_degraded_count: 0
environment_unavailable_count: 0
recommended_role_coverage_status: ok
adapter_count: 0
auto_selected_agent: unknown
coordination_history_status: empty
last_execution_status: unknown
integration_strategy: user_arbitration_required
integration_mergeability: insufficient_context
integration_candidate_cycle_count: 0
arbitration_required: no
arbitration_status: ok
preferred_decision: continue

## Coordinator Recommendation

- source: current-state
- reason: template placeholder
- stop_required: no

## Integration Strategy

- candidate_cycle_count: 0
- overlap_level: unknown
- semantic_risk: unknown
- readiness: unknown
- mergeability: insufficient_context
- recommended_strategy: user_arbitration_required
- arbitration_required: yes
- rationale: template placeholder

## Arbitration

- required: no
- status: ok
- reason: dispatch is already actionable
- preferred_decision: continue
- suggestion: continue recommended=yes actionable=yes
  rationale: template placeholder

## Roster Verification

- status: pass

## Selection Preview

- selected_agent: unknown
- selection_status: unavailable

## Adapter Health

- codex: ready (template placeholder)
  environment: ready (template placeholder)

## Environment Compatibility

- ready: 0
- degraded: 0
- unavailable: 0
- unknown: 0
- blocked_adapter: none

## Role Coverage

- coordinator: ready=0, degraded=0, unavailable=0, disabled=0, unknown=0
- executor: ready=0, degraded=0, unavailable=0, disabled=0, unknown=0
- auditor: ready=0, degraded=0, unavailable=0, disabled=0, unknown=0
- repair: ready=0, degraded=0, unavailable=0, disabled=0, unknown=0
- recommendation: template placeholder

## Coordination

- history_status: empty
- total_dispatches: 0
- arbitration_count: 0
- last_arbitration_decision: unknown

## Priority Reads

- `docs/audit/HANDOFF-PACKET.md`
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md`
- `docs/audit/AGENT-ROSTER.md`
- `docs/audit/AGENT-HEALTH-SUMMARY.md` when adapter environment compatibility is degraded
- `docs/audit/AGENT-SELECTION-SUMMARY.md`
- `docs/audit/COORDINATION-SUMMARY.md`
- `docs/audit/USER-ARBITRATION.md` when escalation is active
- `aidn runtime coordinator-suggest-arbitration --target . --json` when arbitration remains required

## Notes

- refresh this digest after roster changes, handoff refresh, or active coordination dispatch
- if `roster_verification` fails, do not trust `auto_selected_agent` until the roster is fixed
- if `recommended_role_coverage_status` is `blocked`, do not dispatch automatically until adapter availability is restored
