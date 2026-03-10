# Backlog Multi-Agent Multi-Cycle Runtime - 2026-03-09

## Goal

Track concrete follow-up work for runtime support of multi-cycle sessions in the multi-agent workflow.

Reference plan:

- `docs/PLAN_MULTI_AGENT_MULTI_CYCLE_RUNTIME_2026-03-09.md`

## Backlog Items

### MAMCR-01 - Define Session Topology Fields

Status: done
Priority: high

Files:

- runtime metadata docs
- installed session examples/templates where relevant

Why:

- express that a session may legitimately attach several cycles

Done when:

- `attached_cycles` is defined as a plural field
- `integration_target_cycles` is defined as a plural field
- `primary_focus_cycle` is defined as optional

### MAMCR-02 - Define Precedence Rules For Legacy And New Fields

Status: done
Priority: high

Files:

- runtime parsing logic
- supporting docs/tests

Why:

- avoid breaking existing installed repositories

Done when:

- plural fields take precedence
- singular legacy fields remain readable
- comma-separated singular values are treated as transitional

### MAMCR-03 - Update Runtime Relation Resolver

Status: done
Priority: high

Files:

- runtime/repair-layer relation resolution

Why:

- stop flagging multi-cycle sessions as ambiguous by default

Done when:

- several attached cycles are accepted as normal topology
- ambiguity is raised only when a concrete execution scope is missing

### MAMCR-04 - Align Handoff / Dispatch Scope Model

Status: done
Priority: high

Files:

- handoff packet runtime projection
- coordinator dispatch logic

Why:

- keep execution scope singular while session topology stays plural

Done when:

- dispatch/handoff payloads expose one explicit `scope_type + scope_id`
- runtime does not depend on session-level singular target inference

### MAMCR-05 - Add Verifier Coverage

Status: done
Priority: high

Files:

- `tools/perf/*`
- fixtures

Why:

- prevent future regressions around multi-cycle session handling

Done when:

- tests cover:
  - session with several attached cycles and no dispatch scope
  - session with several attached cycles and explicit dispatch scope
  - legacy singular metadata
  - transitional comma-separated metadata warning

### MAMCR-06 - Update Installed Templates / Examples

Status: done
Priority: medium

Files:

- `template/docs_audit/*`
- installed fixtures

Why:

- make the supported shape visible to users and assistants

Done when:

- examples show plural session topology fields
- examples do not encourage singular overload for multi-cycle sessions

### MAMCR-07 - Decide Whether `integration_target_cycle` Survives

Status: done
Priority: medium

Files:

- runtime docs
- parsing/model layer

Why:

- avoid keeping a misleading field name if plural topology becomes standard

Done when:

- decision is explicit:
  - keep as optional singular focus field
  - or replace with `integration_target_cycles`

### MAMCR-08 - Align BPMN / Multi-Agent Planning Docs

Status: done
Priority: low

Files:

- `docs/bpmn/*`

Why:

- keep the architectural narrative consistent with the runtime model

Done when:

- BPMN-related docs distinguish:
  - session topology
  - dispatch focus
  - integration hub behavior

## Sequencing Recommendation

Implemented in that order, with runtime compatibility and verification shipped before template normalization.

## Open Questions

- `primary_focus_cycle` now lives in session metadata as optional local focus, while dispatch/handoff carries its own singular scope.
- Transitional singular multi-target fields emit normalization warnings; runtime projections keep the singular persisted focus empty when no single focus exists.
- Should the repair layer ever choose a focus cycle automatically when several cycles are attached but one is explicitly `OPEN` while others are `DONE`?
- Is a dedicated `scope` block preferable to flat `scope_type` / `scope_id` fields in handoff and dispatch artifacts?
