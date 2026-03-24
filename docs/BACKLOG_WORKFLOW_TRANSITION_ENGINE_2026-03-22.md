# Backlog Workflow Transition Engine 2026-03-22

## Purpose

Executable backlog for aligning workflow code and BPMN around a shared transition model.

## Priority 1

### WTE-01 - Introduce Shared Transition Constants

Outcome:

- centralize workflow action names, reason codes, and routing hints

Files:

- `src/application/runtime/workflow-transition-constants.mjs`
- `src/application/runtime/start-session-admit-use-case.mjs`
- `src/application/runtime/close-session-admit-use-case.mjs`

Done when:

- both use cases import shared constants for core actions and reason codes

### WTE-02 - Extract Re-anchor Transition Helper

Outcome:

- isolate source-entry vs loop-resume decision logic

Files:

- `src/application/runtime/workflow-transition-lib.mjs`
- `src/application/runtime/start-session-admit-use-case.mjs`

Done when:

- source-branch transition selection is delegated to a shared helper

### WTE-03 - Extract Close-session Decision Helper

Outcome:

- isolate unresolved / stale / allowed close-session decisions

Files:

- `src/application/runtime/workflow-transition-lib.mjs`
- `src/application/runtime/close-session-admit-use-case.mjs`

Done when:

- close-session use case becomes mostly context loading plus shared decision call

## Priority 2

### WTE-04 - Extract Repair Routing Helper

Outcome:

- use one repair decision model across runtime digest, handoff, and pre-write

Files:

- `src/application/runtime/workflow-transition-lib.mjs`
- `tools/runtime/project-runtime-state.mjs`
- `tools/runtime/project-handoff-packet.mjs`
- `tools/runtime/pre-write-admit.mjs`

Done when:

- blocked / warn / clear routing is derived from shared logic

### WTE-05 - Normalize Transition Output Shape

Outcome:

- standard result structure for workflow decisions

Files:

- `src/application/runtime/workflow-transition-lib.mjs`
- callers in `src/application/runtime/`
- relevant tools under `tools/runtime/`

Done when:

- transition outputs expose a stable small schema usable by callers

### WTE-06 - Add Transition Decision Fixture Coverage

Outcome:

- protect extracted helpers from semantic drift

Files:

- `tools/perf/verify-start-session-admission-fixtures.mjs`
- `tools/perf/verify-close-session-admission-fixtures.mjs`
- new verifier(s) for shared transition helpers

Done when:

- transition helpers are covered independently of file-loading wrappers

## Priority 3

### WTE-07 - Align Handoff Routing With Shared Transitions

Outcome:

- handoff packet projection uses the same transition vocabulary as runtime admission

Files:

- `tools/runtime/project-handoff-packet.mjs`
- `tools/runtime/coordinator-next-action.mjs`

Done when:

- handoff routing no longer invents divergent wording or path classes

### WTE-08 - Align Pre-write Admission With Shared Transitions

Outcome:

- pre-write checks map to the same decision model as BPMN execution gating

Files:

- `tools/runtime/pre-write-admit.mjs`

Done when:

- repair / audit / execution routing is explainable from shared helpers

### WTE-09 - Split BPMN Documentation

Outcome:

- smaller readable diagrams matching the extracted code layers

Files:

- `docs/bpmn/aidn-multi-agent-ideal.bpmn`
- additional BPMN files as needed

Done when:

- admission, repair, and close/handoff can be read without overloaded gateways

## Suggested Execution Order

1. `WTE-01`
2. `WTE-02`
3. `WTE-03`
4. `WTE-04`
5. `WTE-06`
6. `WTE-05`
7. `WTE-07`
8. `WTE-08`
9. `WTE-09`

## Immediate Next Slice

Recommended next executable slice:

- `WTE-01`
- `WTE-02`
- `WTE-03`

Reason:

- these tasks give the best architecture gain without forcing a large behavioral migration
