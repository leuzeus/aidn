# Handoff Packet

Purpose:

- provide a short, deterministic handoff digest between agents
- reduce restart cost for long sessions or multi-window work
- point the next agent to the minimum artifact set before acting

Rule/State boundary:

- this file is a state digest, not a canonical workflow rules file
- keep canonical workflow rules in `docs/audit/SPEC.md`
- keep local policy extensions in `docs/audit/WORKFLOW.md`

## Summary

updated_at: 2026-03-09T00:00:00Z
handoff_status: refresh_required
handoff_from_agent_role: coordinator
handoff_from_agent_action: relay
recommended_next_agent_role: coordinator
recommended_next_agent_action: reanchor
next_agent_goal: reanchor current session, cycle, and runtime facts before any durable write
scope_type: session
scope_id: none
target_branch: none
backlog_refs: none
planning_arbitration_status: none
preferred_dispatch_source: workflow
shared_planning_candidate_ready: no
shared_planning_candidate_aligned: no
shared_planning_dispatch_scope: none
shared_planning_dispatch_action: none
shared_planning_freshness: not_applicable
shared_planning_freshness_basis: no active shared planning backlog
shared_planning_gate_status: not_applicable
shared_planning_gate_reason: no active shared planning backlog
transition_policy_status: allowed
transition_policy_reason: THINKING allows coordinator -> coordinator

## Active Context

mode: unknown
branch_kind: unknown
active_session: none
active_cycle: none
dor_state: unknown
first_plan_step: unknown
active_backlog: none
backlog_status: unknown
backlog_next_step: unknown
linked_backlog_cycles: none

## Runtime Signals

runtime_state_mode: dual
repair_layer_status: unknown
repair_primary_reason: unknown
repair_routing_hint: reanchor
current_state_freshness: unknown

## Blocking Findings

blocking_findings:
- none

## Prioritized Reads

prioritized_artifacts:
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/WORKFLOW-KERNEL.md`
- `docs/audit/RUNTIME-STATE.md`
- active backlog artifact when present
- active session file
- active cycle `status.md`

## Handoff Guidance

- `ready`: the next agent can resume from the prioritized artifacts and restate the workflow context before writing
- `refresh_required`: the next agent must reload session/cycle facts before any durable write
- `blocked`: the next agent must resolve runtime blocking findings or workflow contradictions before continuing
- multi-agent relays remain constrained by workflow mode; an admitted packet still needs an allowed `from -> to` transition

## Handoff Intent

handoff_note: none

## Notes

- Refresh this packet after significant session/cycle state changes when work is likely to continue in another agent.
- In `dual` / `db-only`, refresh this packet after refreshing `docs/audit/RUNTIME-STATE.md`.
