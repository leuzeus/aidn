# Plan Multi-Agent Multi-Cycle Runtime - 2026-03-09

## Objective

Improve `aidn` so the runtime and repair layer support **sessions attached to multiple cycles** without forcing an ambiguous singular relation.

This plan is driven by an observed runtime ambiguity in an installed client repository:

- `AMBIGUOUS_RELATION` on `S069.md`
- session linked to both `C047` and `C048`
- runtime unable to infer a single preferred cycle relation automatically

The workflow concept already allows a session to span multiple cycles.
The gap is in the **runtime metadata model and relation resolution**, not in the conceptual workflow itself.

## Problem Summary

Current workflow reality:

- a session can aggregate multiple cycles
- a session branch can act as an integration hub
- multi-agent operation increases the probability that multiple cycles are attached to the same session at the same time

Current runtime weakness:

- the repair layer still benefits from or assumes a relation that is effectively too singular in some cases
- fields such as `integration_target_cycle` become ambiguous when they contain several cycles implicitly
- the runtime then emits `AMBIGUOUS_RELATION` instead of consuming a normalized multi-cycle model

This becomes more visible with multi-agent orchestration because:

- one session may dispatch several agents against different cycles
- one session may integrate several completed cycles before merging upstream
- relation inference by heuristics becomes increasingly fragile

## Design Goal

The runtime must support these statements simultaneously:

- a session may have **multiple attached cycles**
- a session may have **multiple integration targets**
- an individual dispatch or handoff should still have a **single explicit execution scope**
- a single optional focus cycle may exist, but should not be required globally

## Scope

In scope:

- session/cycle relation model in runtime-facing metadata
- relation resolution used by repair/runtime indexing
- compatibility with installed repositories
- multi-agent dispatch/handoff compatibility
- additive migration path from current artifacts

Out of scope:

- changing the conceptual workflow to forbid multi-cycle sessions
- removing existing `session_owner` or `reported_to_session`
- replacing cycles as the unit of accountability
- introducing unconstrained concurrent writes on the same branch

## Recommended Target Model

### Session-Level Fields

Use explicit plural fields for session topology:

- `session_branch`
- `attached_cycles`
- `integration_target_cycles`
- optional `primary_focus_cycle`

Interpretation:

- `attached_cycles`: all cycles linked to the session
- `integration_target_cycles`: cycles the session is expected to integrate or relay
- `primary_focus_cycle`: optional current focus for a local decision or relay, not a global invariant

### Dispatch / Handoff-Level Fields

Keep execution scope singular at dispatch time:

- `scope_type`
- `scope_id`
- `target_branch`
- `role`
- `action`

Interpretation:

- a session may be multi-cycle
- a dispatch should still point to one concrete scope at a time

This preserves clarity while still allowing parallel multi-agent work.

## Key Design Principles

1. Do not collapse session topology and execution focus into the same field.
2. Use plural fields for topology, singular fields for dispatch.
3. Prefer explicit metadata over repair-layer inference.
4. Preserve backward compatibility where possible.
5. Keep the runtime conservative when metadata is incomplete.

## Proposed Deliverables

### D1 - Define The Canonical Runtime Metadata Model

Purpose:

- normalize how multi-cycle sessions are represented

Expected outcome:

- explicit recommendation for:
  - `attached_cycles`
  - `integration_target_cycles`
  - `primary_focus_cycle`

### D2 - Update Relation Resolution In Runtime / Repair Layer

Purpose:

- stop treating the session-cycle relation as effectively singular

Expected outcome:

- relation resolution can accept several attached cycles
- ambiguity is only raised when dispatch scope is missing, not merely because a session has several cycles

### D3 - Introduce A Compatibility Strategy For Existing Session Files

Purpose:

- avoid breaking installed repositories immediately

Expected outcome:

- legacy singular fields remain readable
- plural fields, when present, take precedence
- comma-separated singular values are treated as transitional and flagged for normalization

### D4 - Align Handoff / Coordinator Runtime

Purpose:

- ensure multi-agent dispatch reads the new model correctly

Expected outcome:

- coordinator/dispatch relies on explicit dispatch scope
- session-level multi-cycle topology no longer forces a singular target

### D5 - Update Templates And Docs

Purpose:

- make the installed workflow structure express the supported model clearly

Target areas:

- `scaffold/docs_audit/*`
- `scaffold/root/AGENTS.md`
- BPMN/runtime planning docs

Status:

- implemented

## Phased Rollout

### Phase 1 - Metadata Contract

Goal:

- define the correct target shape before touching runtime heuristics

Changes:

- document the plural topology model
- define precedence rules between old and new fields

Acceptance criteria:

- there is one explicit source of truth for multi-cycle session metadata

Status:

- implemented

### Phase 2 - Runtime Compatibility

Goal:

- let runtime consume both old and new representations safely

Changes:

- plural-first parsing
- legacy fallback
- transitional warnings

Acceptance criteria:

- installed repos with current artifacts still work
- new plural metadata removes false singular ambiguity

Status:

- implemented

### Phase 3 - Runtime Resolution Update

Goal:

- stop overloading session metadata as execution scope

Changes:

- relation resolver distinguishes:
  - topology
  - focus
  - dispatch scope

Acceptance criteria:

- a session with several cycles is not by itself considered ambiguous
- ambiguity only remains when a concrete execution choice is required but not supplied

Status:

- implemented

### Phase 4 - Template And Fixture Alignment

Goal:

- make installed repos speak the new model consistently

Changes:

- update templates
- update fixtures
- add verifier coverage

Acceptance criteria:

- templates and fixtures cover both multi-cycle session topology and single-scope dispatch

Status:

- implemented

## Suggested Target Semantics

Recommended semantics for future installed session files:

```md
## Session Branch Continuity
- session_branch: `S069-option-a-dsl-v2`
- attached_cycles:
  - C047
  - C048
- integration_target_cycles:
  - C047
  - C048
- primary_focus_cycle: `none`
```

Recommended semantics for future dispatch/handoff payloads:

```yaml
scope_type: cycle
scope_id: C048
target_branch: feature/C048-option-a-dsl-effects-v1
role: executor
action: implement
```

## Non-Goals

Do not implement as part of this plan:

- unconstrained parallel writes to the same branch
- removing cycle accountability
- making every session always pick a single primary cycle
- silently rewriting all existing client repositories during install

## Success Criteria

This plan is successful when:

- multi-cycle sessions are a first-class supported runtime concept
- session topology does not force a fake singular target
- dispatch/handoff remains narrow and explicit
- repair/runtime ambiguity decreases without constraining valid multi-agent usage
