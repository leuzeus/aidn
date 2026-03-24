# Plan Workflow Transition Engine 2026-03-22

## Objective

Refactor `aidn` workflow control so the code expresses the same transition model as the BPMN:

- explicit re-anchor entry vs loop resume
- explicit repair blocked vs repair warning routing
- shared transition decisions across admission, runtime digest, handoff, and close-session flows
- smaller, testable decision units instead of duplicated branch logic

## Problem

Current workflow logic is clearer than before, but still spread across:

- `src/application/runtime/start-session-admit-use-case.mjs`
- `src/application/runtime/close-session-admit-use-case.mjs`
- `tools/runtime/project-runtime-state.mjs`
- `tools/runtime/project-handoff-packet.mjs`
- `tools/runtime/pre-write-admit.mjs`
- coordinator / hook entrypoints

This creates 3 risks:

1. BPMN can become cleaner than the real code path.
2. Transition names drift between use cases, projectors, and CLI tools.
3. Repair / re-anchor / handoff routing remains partially duplicated.

## Target State

Introduce a shared workflow transition layer that becomes the single source of truth for transition decisions.

Target modules:

- `src/application/runtime/workflow-transition-lib.mjs`
- `src/application/runtime/workflow-transition-constants.mjs`

Target responsibilities:

- define transition actions and decision enums
- resolve re-anchor path
- resolve repair path
- resolve session continuation path
- resolve close-session path
- expose stable outputs reusable by projectors and CLI tools

## Scope

In scope:

- extract shared transition constants
- extract pure decision helpers
- migrate `start-session` and `close-session` to the shared layer
- align runtime repair routing with the same shared decisions
- align handoff / pre-write routing where transition duplication exists
- add table-style fixture coverage for transition decisions
- split overloaded BPMN documentation into smaller diagrams if needed

Out of scope for this slice:

- DB schema changes
- broad UI / CLI redesign
- changing workflow semantics without a documented reason

## Execution Phases

### Phase 1 - Stabilize Transition Vocabulary

Create shared constants for:

- actions
- reason codes
- repair routing hints
- re-anchor path kinds

Deliverable:

- constants file used by at least `start-session` and `close-session`

Exit criteria:

- no new string literals for core transition actions in those two files

### Phase 2 - Extract Shared Decision Library

Extract pure helpers for:

- `resolveReanchorPath`
- `resolveRepairPath`
- `resolveSessionContinuation`
- `resolveCloseSessionDecision`

Deliverable:

- workflow transition lib with no file writes and no shell side effects

Exit criteria:

- use cases become orchestration wrappers around shared helpers

### Phase 3 - Align Runtime Projectors

Update runtime digest / handoff / pre-write tools so they reuse the same repair and routing decisions.

Deliverable:

- `project-runtime-state`
- `project-handoff-packet`
- `pre-write-admit`

all derive routing from shared transition helpers or shared constants

Exit criteria:

- repair routing language is identical across outputs

### Phase 4 - Expand Verification

Add table-driven tests / fixture verifiers for transition decisions.

Required cases:

- source branch with clean continuity
- source branch with resumable cycle
- source branch with stale merged open cycle
- session branch with ambiguous focus cycle
- repair blocked
- repair warn
- close-session unresolved cycle decisions
- close-session stale reported cycle

Exit criteria:

- each transition family has dedicated verifier coverage

### Phase 5 - Documentation Normalization

Split the overloaded BPMN into focused diagrams:

- re-anchor and admission
- execution / repair / audit
- handoff / close / publish

Exit criteria:

- no gateway in the published BPMN exceeds the readability constraints we just imposed

## Design Rules

1. Decision helpers must be pure.
2. File-system reads happen at orchestration boundaries, not in transition helpers.
3. Shared action names must be declared once.
4. BPMN and code must use the same transition names where practical.
5. New routing semantics require both code update and BPMN/document update.

## Risks

### Risk 1 - Hidden Semantic Drift

Extracting helpers may accidentally normalize behaviors that currently differ by caller.

Mitigation:

- capture current behavior with fixture verification before broad migration

### Risk 2 - Over-abstracting Too Early

A large generic engine could become harder to maintain than focused helpers.

Mitigation:

- start with small explicit helpers, not a framework

### Risk 3 - BPMN Overfitting

Forcing code to mirror diagram shapes too literally can make implementation awkward.

Mitigation:

- align decisions and transition boundaries, not every visual artifact

## Definition Of Done

This plan is complete when:

- shared workflow transition helpers exist
- `start-session` and `close-session` are thin orchestration layers
- runtime repair routing uses shared logic
- fixture coverage protects the extracted decisions
- BPMN documentation is split and readable
