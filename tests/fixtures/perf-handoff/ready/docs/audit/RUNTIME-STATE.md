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

updated_at: 2026-03-09T11:10:22.800Z
runtime_state_mode: files
repair_layer_status: unknown
repair_layer_advice: unknown
repair_routing_hint: reanchor
repair_routing_reason: repair routing is unknown, so the next agent should reanchor before acting

## Current State Freshness

current_state_freshness: ok
current_state_freshness_basis: CURRENT-STATE.md.updated_at is aligned with active cycle status timestamps

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
- `docs/audit/cycles/C101-*/status.md`
- `docs/audit/sessions/S101*.md`
- `.aidn/runtime/context/hydrated-context.json`
- `.aidn/runtime/context/codex-context.json`

## Notes

- Source context file: `.aidn/runtime/context/hydrated-context.json`
- `CURRENT-STATE.md` consistency check passed for the currently evaluated signals.
- In `files` mode, this digest may remain minimal.
- In `dual` / `db-only`, refresh this digest whenever runtime hydration or repair-layer triage reveals new blocking facts.

