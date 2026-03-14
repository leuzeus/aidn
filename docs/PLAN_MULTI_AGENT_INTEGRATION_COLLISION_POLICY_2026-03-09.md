# Plan Multi-Agent Integration Collision Policy - 2026-03-09

## Objective

Extend `aidn` so multi-agent work across several cycles attached to the same session can be integrated with an explicit policy instead of relying on ad hoc Git merge intuition.

This plan addresses the real need behind recent questions:

- several agents may work in parallel on different cycles inside one session
- a plain Git merge is sometimes sufficient
- sometimes it is not sufficient even when textual conflicts are low
- the runtime should help decide the integration strategy instead of leaving that decision implicit

## Implementation Status

Status: implemented on `2026-03-09`

Delivered:

- cycle-type-aware integration policy in runtime
- `docs/audit/INTEGRATION-RISK.md` as the explicit assessment artifact
- coordinator/session-level gating when the strategy is not `direct_merge`
- explicit arbitration paths for:
  - `integration_cycle`
  - `report_forward`
  - `rework_from_example`
- verifier coverage for representative strategy cases

## Problem Summary

Current `aidn` baseline now supports:

- multi-cycle sessions
- singular dispatch scope per relay
- multi-agent handoff/admission/coordinator routing

What is still missing:

- explicit collision detection between cycles
- explicit mergeability assessment
- explicit integration strategy selection
- explicit treatment of cycle type in integration decisions

Without this layer, the workflow can coordinate agents, but still cannot answer these operational questions reliably:

- can these two cycles be merged directly?
- do they require a dedicated integration cycle?
- should one cycle be reported forward instead of integrated now?
- should changes be replayed semantically instead of merged mechanically?

## Extrapolated User Need

The actual product need is:

> When several agents finish work on different cycles attached to the same session, `aidn` must detect integration risk, classify mergeability, and recommend a safe integration strategy that takes cycle type, overlap, readiness, and workflow context into account.

This decomposes into four concrete needs:

1. detect likely collision risk across cycles
2. classify whether direct merge is acceptable
3. recommend a strategy when direct merge is not the right answer
4. trace the chosen strategy so later relays and operators do not reinterpret the situation manually

## Scope

In scope:

- collision and overlap assessment between cycles
- mergeability policy for cycles inside one session
- use of cycle type in strategy selection
- integration strategy recommendation for coordinator/runtime
- workflow artifacts that keep this decision traceable

Out of scope:

- fully autonomous multi-branch merge execution
- unconstrained concurrent writes on the same branch
- replacing Git
- proving semantic compatibility perfectly from static analysis alone

## Core Distinctions

The model must distinguish these concerns explicitly.

### A. Session Topology

- which cycles are attached to a session
- which cycles are intended as integration targets

This is already partially covered by:

- `attached_cycles`
- `integration_target_cycles`
- optional `primary_focus_cycle`

### B. Dispatch Scope

- what one agent is currently responsible for

This is already partially covered by:

- `scope_type`
- `scope_id`
- `target_branch`

### C. Integration Readiness

- whether a cycle is ready to be considered for integration

This must include:

- cycle state
- DoR/verification state
- unresolved blockers
- unresolved repair/runtime findings

### D. Integration Strategy

- how completed work should move toward session integration

This is the missing layer.

## Recommended Integration Strategies

Start with a deliberately small strategy set.

### 1. `direct_merge`

Meaning:

- normal Git merge/cherry-pick path is acceptable

Use when:

- overlap risk is low
- cycle types are compatible
- readiness is high
- no blocking semantic risk is detected

### 2. `integration_cycle`

Meaning:

- create or route through a dedicated integration cycle before session integration

Use when:

- several cycles must be harmonized together
- overlap exists but is still manageable
- ordering or validation needs to be explicit

### 3. `report_forward`

Meaning:

- do not integrate now; keep the work as an open integration item for a later session/cycle

Use when:

- dependency or readiness is missing
- merge is not justified yet
- arbitration is deferred intentionally

### 4. `rework_from_example`

Meaning:

- do not merge mechanically; use an existing cycle as source material and replay/rework intentionally in another cycle

Use when:

- semantic collision is high
- architecture or invariants diverge
- merge would produce misleading or fragile results
- a cycle is better treated as inspiration than as merge input

## Why Git Merge Alone Is Insufficient

Git only answers textual mergeability.

The workflow must also care about:

- invariant conflicts
- architectural conflicts
- migration order
- security precedence
- refactor vs feature incompatibility
- spike output that should not be merged as production code

So the decision should not be:

- "can Git merge these branches?"

It should be:

- "is Git merge the correct integration strategy for these cycle types and this overlap profile?"

## Required Inputs For Strategy Selection

The policy should use at least these inputs.

### 1. Cycle Type

Relevant examples already used by `aidn`:

- `feature`
- `hotfix`
- `spike`
- `refactor`
- `structural`
- `migration`
- `security`
- `perf`
- `integration`
- `compat`
- `corrective`

### 2. Technical Overlap

Minimum useful classes:

- `none`
- `low`
- `medium`
- `high`
- `unknown`

This can be estimated from:

- touched files
- touched directories/modules
- shared symbols or structured ownership hints when available

### 3. Semantic Risk

Minimum useful classes:

- `low`
- `medium`
- `high`
- `unknown`

Possible signals:

- conflicting decisions
- incompatible hypotheses
- incompatible traceability targets
- feature vs refactor/migration/security interaction

### 4. Integration Readiness

Minimum useful classes:

- `ready`
- `conditional`
- `blocked`

Signals:

- cycle state
- verification state
- open gaps
- repair-layer status

## Initial Decision Matrix

This should start as policy, not as a perfect algorithm.

### Default heuristics

- `feature + feature + low overlap -> direct_merge`
- `feature + feature + medium overlap -> integration_cycle`
- `feature + refactor -> integration_cycle` by default
- `feature + migration -> integration_cycle` by default
- `feature + security -> integration_cycle` or `report_forward` depending on readiness
- `spike + anything -> rework_from_example` by default
- `integration + anything -> do not treat as a normal source cycle; use as assembly vehicle`
- `compat + feature -> integration_cycle` unless overlap is clearly trivial
- any pair with `semantic_risk=high -> rework_from_example` or user arbitration
- any pair with `readiness=blocked -> report_forward` or arbitration

This matrix must remain overridable by explicit user arbitration.

## Recommended New Runtime Concepts

### A. Collision Assessment

Introduce a runtime assessment artifact or digest that answers:

- which cycles are being considered together
- what overlap level is detected
- what semantic risk is detected
- what confidence level the assessment has

### B. Mergeability Classification

Introduce a classification such as:

- `merge_safe`
- `merge_risky`
- `merge_not_recommended`
- `insufficient_context`

### C. Integration Strategy Recommendation

Introduce a derived recommendation such as:

- `direct_merge`
- `integration_cycle`
- `report_forward`
- `rework_from_example`
- `user_arbitration_required`

### D. Integration Decision Trace

Introduce a traceable artifact where the chosen strategy is recorded so the next relay does not reinterpret it.

## Proposed Deliverables

### D1 - Define Collision And Mergeability Model

Expected outcome:

- explicit vocabulary for:
  - overlap
  - semantic risk
  - readiness
  - mergeability

### D2 - Define Strategy Matrix

Expected outcome:

- explicit mapping:
  - `(cycle_type pair + overlap + readiness + semantic risk) -> strategy`

### D3 - Add Integration Assessment Artifact

Expected outcome:

- one artifact or digest that stores:
  - candidate cycles
  - risk classification
  - recommended strategy
  - rationale

### D4 - Align Coordinator Runtime

Expected outcome:

- coordinator can escalate, gate, or recommend an integration strategy before a merge-oriented relay

### D5 - Align Workflow Templates And Skills

Expected outcome:

- session close / cycle close / handoff flows can record the chosen integration path

## Suggested Artifact Direction

One realistic option is:

- `docs/audit/INTEGRATION-RISK.md`

Possible contents:

- `candidate_cycles`
- `cycle_types`
- `overlap_level`
- `semantic_risk`
- `integration_readiness`
- `mergeability`
- `recommended_strategy`
- `rationale`
- `arbitration_required`

An alternative is a session-scoped artifact:

- `docs/audit/SESSION-INTEGRATION-PLAN.md`

The first option is better if you want a compact runtime digest.
The second is better if you want a richer operational document.

## Phased Rollout

### Phase 1 - Vocabulary And Policy

Goal:

- formalize the decision space before trying to automate it

Changes:

- define collision classes
- define mergeability classes
- define strategy set
- define first decision matrix

Acceptance criteria:

- the repository has one explicit policy vocabulary for multi-cycle integration

### Phase 2 - Assessment Runtime

Goal:

- compute a first deterministic assessment from current artifacts

Changes:

- cycle pair overlap heuristics
- cycle-type-aware strategy recommendation
- readiness-aware gating

Acceptance criteria:

- runtime can output a recommended strategy for a set of attached cycles

### Phase 3 - Coordinator Integration

Goal:

- make orchestration respect integration risk

Changes:

- dispatch plan checks integration strategy before merge-oriented relays
- blocked or risky cases route to:
  - `integration_cycle`
  - `report_forward`
  - `rework_from_example`
  - user arbitration

Acceptance criteria:

- the coordinator does not treat all completed parallel cycles as directly mergeable

### Phase 4 - Workflow Traceability

Goal:

- make the chosen path visible and durable

Changes:

- update templates/skills/docs
- record integration decisions at session close / relay close

Acceptance criteria:

- integration intent is traceable across sessions and relays

## Non-Goals

Do not aim initially for:

- perfect semantic conflict detection
- autonomous conflict resolution
- full merge bot behavior
- replacing human review for risky integrations

## Success Criteria

This plan is successful when:

- aid'n can distinguish "Git can merge" from "workflow should merge"
- cycle type influences integration policy
- risky parallel outputs do not collapse into an implicit merge path
- replay/rework and report-forward become first-class strategies, not ad hoc exceptions
