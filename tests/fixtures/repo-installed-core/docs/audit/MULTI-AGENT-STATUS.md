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

updated_at: 2026-03-09T16:54:17.333Z
recommended_role: coordinator
recommended_action: reanchor
recommended_goal: reanchor current session, cycle, and runtime facts before any durable write
handoff_status: refresh_required
handoff_admission_status: rejected
roster_verification: pass
roster_issue_count: 0
adapter_health_pass: yes
environment_ready_count: 3
environment_degraded_count: 0
environment_unavailable_count: 0
recommended_role_coverage_status: ok
adapter_count: 6
auto_selected_agent: codex
coordination_history_status: empty
last_execution_status: unknown

## Coordinator Recommendation

- source: handoff-admit
- reason: handoff admission rejected
- stop_required: no

## Roster Verification

- status: pass

## Selection Preview

- selected_agent: codex
- selection_status: selected
- reason: auto selected codex for coordinator + reanchor

## Adapter Health

- codex: ready (adapter is enabled and loadable)
  environment: ready (adapter executed the default environment probe successfully)
- codex-auditor: ready (adapter is enabled and loadable)
  environment: ready (adapter executed the default environment probe successfully)
- codex-repair: ready (adapter is enabled and loadable)
  environment: ready (adapter executed the default environment probe successfully)
- external-example-auditor: disabled (adapter is disabled by roster)
  environment: unknown (environment probe skipped because the adapter is disabled by roster)
- local-shell-auditor: disabled (adapter is disabled by roster)
  environment: unknown (environment probe skipped because the adapter is disabled by roster)
- local-shell-repair: disabled (adapter is disabled by roster)
  environment: unknown (environment probe skipped because the adapter is disabled by roster)

## Environment Compatibility

- ready: 3
- degraded: 0
- unavailable: 0
- unknown: 3
- blocked_adapter: none

## Role Coverage

- coordinator: ready=1, degraded=0, unavailable=0, disabled=0, unknown=0
- executor: ready=1, degraded=0, unavailable=0, disabled=0, unknown=0
- auditor: ready=2, degraded=0, unavailable=0, disabled=2, unknown=0
- repair: ready=2, degraded=0, unavailable=0, disabled=1, unknown=0
- recommendation: 1 runnable adapter(s) remain available for role coordinator

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

## Notes

- refresh this digest after roster changes, handoff refresh, or active coordination dispatch
- if `roster_verification` fails, do not trust `auto_selected_agent` until the roster is fixed
- if `recommended_role_coverage_status` is `blocked`, do not dispatch automatically until adapter availability is restored
- generated file: `docs/audit/MULTI-AGENT-STATUS.md`
