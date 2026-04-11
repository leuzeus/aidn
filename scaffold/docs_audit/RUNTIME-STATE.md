# Runtime State Digest

Purpose:

- keep runtime-specific operational signals short and easy to reload
- avoid scattering `dual` / `db-only` runtime facts across multiple hidden files
- surface whether `CURRENT-STATE.md` still looks trustworthy

Rule/State boundary:

- this file is a state digest, not a canonical workflow rules file
- keep canonical workflow rules in `docs/audit/SPEC.md`
- keep local policy extensions in `docs/audit/WORKFLOW.md`

## Summary

contract_version: critical-markdown-v1
updated_at: 2026-03-09T00:00:00Z
runtime_state_mode: dual
repair_layer_status: unknown
repair_layer_advice: unknown
repair_primary_reason: unknown
repair_routing_hint: reanchor
repair_routing_reason: repair routing is unknown, so the next agent should reanchor before acting

## Current State Freshness

current_state_freshness: unknown
current_state_freshness_basis: compare `CURRENT-STATE.md.updated_at` against active cycle status timestamps

Meaning:

- `ok`: `CURRENT-STATE.md` is not older than the active cycle timestamps currently checked
- `stale`: `CURRENT-STATE.md` is older than the active cycle timestamps currently checked
- `unknown`: no active cycle, missing timestamps, or freshness not evaluated yet

## Blocking Findings

blocking_findings:
- none

## Prioritized Reads

prioritized_artifacts:
- `docs/audit/HANDOFF-PACKET.md`
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/snapshots/context-snapshot.md`
- active cycle `status.md`
- active session file
- `.aidn/runtime/context/`

## Notes

- In `files` mode, this digest may remain minimal.
- In `dual` / `db-only`, refresh this digest whenever runtime hydration or repair-layer triage reveals new blocking facts.
