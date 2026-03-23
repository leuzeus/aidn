# Backlog Multi-Agent Integration Collision Policy - 2026-03-09

## Goal

Track concrete work needed so `aidn` can assess collision risk and choose an explicit integration strategy when multiple cycles inside one session may converge.

Reference plan:

- `docs/PLAN_MULTI_AGENT_INTEGRATION_COLLISION_POLICY_2026-03-09.md`

## Backlog Items

### MAICP-01 - Define Collision Vocabulary

Status: implemented
Priority: high

Why:

- the runtime needs stable language before it can classify anything

Done when:

- overlap classes are defined
- semantic risk classes are defined
- mergeability classes are defined

### MAICP-02 - Define Integration Strategy Vocabulary

Status: implemented
Priority: high

Why:

- the runtime needs a small, explicit set of integration actions

Done when:

- `direct_merge`
- `integration_cycle`
- `report_forward`
- `rework_from_example`
- `user_arbitration_required`

are explicitly documented

### MAICP-03 - Add Cycle-Type-Aware Strategy Matrix

Status: implemented
Priority: high

Why:

- cycle type must influence the integration path

Done when:

- the policy distinguishes at least:
  - `feature`
  - `spike`
  - `refactor`
  - `migration`
  - `security`
  - `integration`
  - `compat`

### MAICP-04 - Introduce Integration Assessment Artifact

Status: implemented
Priority: high

Why:

- the decision must be traceable, not just computed transiently

Done when:

- one explicit artifact or digest records:
  - candidate cycles
  - risk
  - mergeability
  - recommended strategy
  - rationale

### MAICP-05 - Implement Overlap Heuristics

Status: implemented
Priority: high

Why:

- the runtime needs a first approximation of collision risk

Done when:

- overlap can be classified from at least:
  - shared files
  - shared directories/modules
  - missing-context fallback to `unknown`

### MAICP-06 - Implement Readiness-Aware Gating

Status: implemented
Priority: high

Why:

- not all finished coding work is integration-ready

Done when:

- blocked cycles cannot silently flow into merge-oriented strategies

### MAICP-07 - Align Coordinator / Dispatch Runtime

Status: implemented
Priority: high

Why:

- orchestration must consume the integration policy

Done when:

- dispatch/escalation respects recommended integration strategy
- risky cases stop or reroute before merge-oriented relays

### MAICP-08 - Support `rework_from_example`

Status: implemented
Priority: medium

Why:

- some outputs should inspire integration, not be merged mechanically

Done when:

- the workflow can explicitly record that a cycle is used as source material for rework in another integration vehicle

### MAICP-09 - Support `report_forward`

Status: implemented
Priority: medium

Why:

- some work should be deferred without ambiguity

Done when:

- the integration recommendation can intentionally defer a cycle instead of forcing immediate integration

### MAICP-10 - Update Templates / Skills / Docs

Status: implemented
Priority: medium

Why:

- users and agents need to see the supported strategies explicitly

Done when:

- session/cycle close flows can record the chosen strategy
- handoff/coordinator docs mention integration strategy policy

### MAICP-11 - Add Verifier Coverage

Status: implemented
Priority: high

Why:

- the policy is risky unless locked by fixtures

Done when:

- tests cover:
  - low-overlap compatible cycles
  - type-driven risky pairs
  - blocked readiness
  - `spike -> rework_from_example`
  - `feature + refactor -> integration_cycle`
  - `migration + feature -> no direct merge`

## Sequencing Recommendation

1. MAICP-01
2. MAICP-02
3. MAICP-03
4. MAICP-04
5. MAICP-05
6. MAICP-06
7. MAICP-07
8. MAICP-08
9. MAICP-09
10. MAICP-10
11. MAICP-11

## Open Questions

- should the first implementation assess pairs of cycles only, or sets of N cycles?
- should overlap stay file-level first, or try symbol-level analysis immediately?
- should `integration_cycle` always imply a dedicated branch, or just a dedicated accountability artifact?
- should `rework_from_example` be recorded as a relationship between two cycles, or as a decision on the integration vehicle?
