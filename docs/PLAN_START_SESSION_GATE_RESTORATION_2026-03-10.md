# Plan - Start-Session Gate Restoration

Date: 2026-03-10
Status: proposed
Scope: restore the lost `start-session` workflow gate while integrating cleanly with the current runtime/hook architecture.

## Problem Statement

The current `start-session` execution path no longer enforces the workflow contract described in the skill, `SPEC`, `WORKFLOW`, and `AGENTS`.

Observed mismatch:

- `start-session` is documented as a branch-aware, session-aware, cycle-aware admission step.
- In practice it is routed to a generic runtime hook and returns success without enforcing the expected branch/session/cycle gate.
- The adapter rule "check previous session PR status against source branch before creating a new session branch" exists in documentation but is not enforced by the runtime path.
- The current runtime path can pass on non-compliant situations such as:
  - non-aid'n branch kinds
  - missing active session mapping
  - missing or ambiguous cycle continuity at session start
  - session continuation cases that should resume instead of creating new session/cycle artifacts

## Goals

Restore a blocking admission gate for `start-session` that:

- checks the current Git branch and branch kind before any session/cycle creation
- stops when the current branch is not compliant with aid'n workflow expectations
- decides whether to:
  - resume the current session
  - resume the current cycle
  - ask the user to choose among multiple open cycles
  - block and request arbitration
  - allow creation of a new session or cycle only when continuity allows it
- preserves the current runtime stack for:
  - run ids
  - index sync
  - repair layer
  - strict db-backed execution modes
- keeps a single source of truth for branch/session/cycle interpretation

## Non-Goals

- no rewrite of the generic `workflow-hook`
- no parallel second workflow engine
- no GitHub-specific PR API dependency in the first fix pass
- no relaxation of existing `dual` / `db-only` strict behavior

## Current Root Cause

`start-session` is currently routed to a generic `workflow-hook` path instead of a domain-specific session admission path.

Consequences:

- the hook executes runtime checkpoint/index behavior
- but it does not enforce the workflow-specific branch/session/cycle topology expected by the `start-session` contract
- `branch-cycle-audit` is also routed through a generic gate, so the branch ownership logic is not actually centralized in an enforceable business layer

## Design Principle

Do not replace the current runtime hook stack.

Instead:

1. add a dedicated `start-session` admission layer
2. run that admission before the generic runtime hook
3. only call the generic runtime hook when the admission result authorizes progression

This keeps the existing runtime/perf/index/repair behavior intact while restoring the lost workflow gate.

## Implementation Plan

### Phase 1 - Extract shared workflow context primitives

Create reusable library helpers so the same interpretation is used by:

- `start-session`
- `branch-cycle-audit`
- `reload-check`
- `pre-write-admit`
- `CURRENT-STATE` consistency checks

Extract and centralize:

- branch classification:
  - `session`
  - `cycle`
  - `intermediate`
  - `other`
  - `unknown`
- session file discovery
- cycle status discovery
- session topology parsing:
  - `attached_cycles`
  - `integration_target_cycles`
  - `primary_focus_cycle`
  - `reported_from_previous_session`
  - `carry_over_pending`
- active/open cycle interpretation

Expected result:

- no duplicated branch-kind logic across multiple tools
- one common interpretation layer for runtime and verification code

### Phase 2 - Add a dedicated `start-session-admit` use case

Create a business-level admission use case for session start.

Responsibilities:

1. inspect current Git branch and classify it
2. inspect workflow state from current artifacts
3. resolve current session and cycle continuity
4. determine whether the current branch is workflow-compliant
5. determine whether work must resume instead of creating anything new
6. produce a structured decision payload

Decision outcomes should include explicit cases such as:

- `resume_current_session`
- `resume_current_cycle`
- `choose_cycle`
- `create_session_allowed`
- `create_cycle_allowed`
- `blocked_non_compliant_branch`
- `blocked_open_cycles_must_be_resolved`
- `blocked_session_base_gate`
- `blocked_ambiguous_topology`

Payload fields should include:

- `branch_kind`
- `branch_compliance`
- `active_session`
- `active_cycle`
- `open_cycles`
- `candidate_cycles`
- `blocking_reasons`
- `required_user_choice`
- `recommended_next_action`

### Phase 3 - Restore the missing `start-session` gates

The dedicated admission must enforce the missing workflow rules.

Required checks:

1. Branch compliance gate

- If current branch is not an aid'n branch kind, stop before session/cycle creation.
- Ask whether the work must first be merged into the source branch or explicitly ignored with rationale.

2. Session continuity gate

- If current branch already belongs to an open session, resume that session.
- Do not create a new session in that case.

3. Cycle continuity gate

- If current branch belongs to an open cycle or intermediate branch, resume that cycle path.
- Do not create a parallel session/cycle implicitly.

4. Open cycle resolution gate

- If a session is open and one or more cycles are still open:
  - with an accompanying new request: block further session/cycle creation until cycle resolution or explicit cycle choice
  - without a new request: continue the current session/cycle

5. Multi-cycle arbitration gate

- If several cycles are open, require user selection or explicit relaunch by agent.

6. Session branch base gate

- Before authorizing a new session branch, evaluate the previous session state against the configured `source_branch`.
- Required outcomes:
  - `PR OPEN`: continue existing session branch by default
  - `PR OPEN` + override: allow with rationale
  - `PR MERGED` or no previous session: allow new session branch from source branch
  - `PR CLOSED (not merged)`: stop and require explicit user decision
- Hard stop: do not chain session branches by default

7. Create-only-when-clean gate

- Only allow creation of a new session/cycle when there is no active open session/cycle requiring continuity first.

### Phase 4 - Integrate with the existing runtime hook chain

Keep the current runtime hook for:

- checkpointing
- run id management
- perf events
- index sync
- repair layer aggregation
- strict db-backed enforcement

Integration model:

1. `start-session` skill entrypoint calls `start-session-admit`
2. if admission returns `blocked` or `requires_user_choice`, stop there
3. if admission returns `resume` or `create_allowed`, then run the existing `workflow-hook --phase session-start`

This preserves the existing runtime architecture while restoring workflow enforcement.

### Phase 5 - Align `branch-cycle-audit` with the same source of truth

Refactor `branch-cycle-audit` so it reuses the same branch/session/cycle interpretation layer as `start-session-admit`.

Goal:

- avoid two divergent implementations
- ensure both skills enforce the same mapping invariants
- keep generic gating signals as a complement, not as the only branch/cycle gate

### Phase 6 - Test coverage restoration

Add explicit contract tests for the restored behavior.

Required fixture coverage:

- non-aid'n branch kind blocks `start-session`
- branch/session mismatch blocks `start-session`
- missing active session blocks or requires repair instead of passing
- missing active cycle blocks COMMITTING continuation
- valid open session resumes instead of creating a new one
- valid open cycle resumes instead of creating a new one
- multiple open cycles require user choice
- session base gate requires explicit decision on non-merged previous session
- `dual` / `db-only` still preserve strict runtime behavior after admission succeeds

Required test updates:

- existing tests that only assert `start_ok` must be extended to assert the correct admission decision
- add new negative tests where `start-session` must not silently pass

## Reuse Strategy

To integrate with the existing codebase cleanly:

- reuse branch classification already present in `reload-check`
- reuse session topology parsing already present in repair-layer projection
- reuse session/cycle lookup patterns already present in:
  - `pre-write-admit`
  - current-state consistency verification
  - handoff/runtime helpers
- avoid adding a third independent parser

## Documentation Update Plan

Documentation must be updated in the same implementation stream.

### Required updates

1. `scaffold/codex/start-session/SKILL.md`

- describe that `start-session` begins with a blocking admission decision
- clarify resume/create/block outcomes
- clarify user-choice requirements for multiple cycles and non-compliant branches

2. `scaffold/docs_audit/PROJECT_WORKFLOW.md`

- keep the session branch base gate
- clarify that it is now enforced by runtime admission, not just documented
- clarify the expected stop/arbitration behavior

3. `scaffold/root/AGENTS.md`

- reflect the actual execution order:
  - context reload
  - start-session admission
  - runtime hook continuation only if admitted
- clarify that `workflow-hook` is infrastructure, not the full workflow decision layer

4. `docs/SPEC.md`

- update only if wording is needed to make the admission step explicit in implementation terms
- do not change canonical intent unless necessary

5. `scaffold/docs_audit/WORKFLOW_SUMMARY.md`

- add a concise note that `start-session` can block and request arbitration before any new session/cycle creation

6. `CHANGELOG.md`

- record restoration of `start-session` branch/session/cycle admission gates

## Acceptance Criteria

The fix is complete when all of the following are true:

- `start-session` no longer returns success on non-compliant branch/session/cycle states
- new session/cycle creation is blocked when continuity requires resuming existing work first
- multiple open cycles trigger explicit user choice
- the session base gate against `source_branch` is enforced before new session creation
- `workflow-hook` remains responsible for runtime/perf/index/repair behavior after admission
- `branch-cycle-audit` and `start-session` rely on the same branch/session/cycle interpretation layer
- tests cover both positive and negative admission outcomes
- templates and docs reflect the implemented behavior

## Recommended Delivery Order

1. Extract shared branch/session/cycle helper libraries
2. Implement `start-session-admit`
3. Add a specialized `start-session` hook entrypoint
4. Route `start-session` through the new admission path
5. Re-align `branch-cycle-audit`
6. Add and update tests
7. Update templates and documentation
8. Record the change in changelog

## Risks

- duplicating parsing logic again if helper extraction is skipped
- breaking db-backed strict flows if the admission layer bypasses current runtime hook semantics
- introducing a GitHub-specific dependency too early for the session base gate
- letting docs diverge again if template updates are deferred

## First Implementation Constraint

For the first fix pass, prefer a deterministic local admission model based on:

- Git branch/state
- workflow artifacts
- current runtime state
- current session/cycle topology

If the previous-session PR status cannot be inferred reliably from local state, the admission should stop and request explicit user arbitration rather than silently assuming success.
