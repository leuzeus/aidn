# Plan Stale Merged Cycle Guard - 2026-03-22

## Objective

Prevent `aidn` from treating a cycle as still active when workflow artifacts say `OPEN|IMPLEMENTING|VERIFYING` but git topology shows the cycle is already absorbed:

- into its owning session branch
- or into the configured source branch through the owning session

The immediate user-facing need is clear:

- `close-session` must not let a session close report keep a merged cycle as `report` / still-open state
- `start-session` must not propose `resume_current_cycle` for a cycle that is already merged
- `db-only` and `dual` modes must behave the same way as file-backed mode

## Implementation Status

Status:

- proposed

Not yet implemented:

- shared git-aware classification of stale merged open cycles
- `close-session` validation of cycle decisions against git merge topology
- `start-session` rejection of stale merged open cycles on the source branch
- fixture coverage for the stale-merged scenario in `files` and `db-only`

Already implemented and reusable:

- `start-session` admission
- `close-session` admission
- local git adapter ancestry checks
- `pre-write-admit` session integration gate that already computes `cycle_merged_into_session`

## Problem Summary

Current runtime behavior trusts workflow artifact state first:

- `listCycleStatuses` reads cycle `status.md`
- `collectOpenCycles` keeps every cycle in `OPEN|IMPLEMENTING|VERIFYING`
- `close-session` only checks whether each open cycle has a textual close decision
- `start-session` resumes the sole open cycle on the source branch

What is missing is a topology guard:

- if a cycle branch is already merged into the session branch, `report` is no longer a safe or coherent close decision
- if the session branch is already merged into the source branch, resuming the cycle is semantically wrong

This creates a stale-state failure mode:

- audit artifacts can lag behind git reality
- the runtime reproduces that stale state faithfully
- downstream users are told to resume work that is already integrated

## Extrapolated User Need

The actual product need is:

> When git proves a cycle has already been integrated, `aidn` must stop treating its artifact state as resumable and must require audit regularization instead of continuing the stale workflow path.

This decomposes into four concrete needs:

1. classify whether an open cycle is still truly open or already merged
2. reject inconsistent `close-session` decisions when merge topology contradicts artifact state
3. block stale `start-session` resume paths on the source branch
4. preserve parity across `files`, `dual`, and `db-only`

## Scope

In scope:

- one shared helper to classify stale merged open cycles from git topology
- `close-session` admission hardening
- `start-session` admission hardening
- regression fixtures for file-backed and db-backed flows
- short documentation/changelog note once code lands

Out of scope:

- automatic artifact mutation or silent auto-close of cycles
- changing hydration/context projectors directly
- automatic PR merge detection beyond branch ancestry
- generic repair-layer remediation for all workflow drift classes

## Why The Guard Belongs In Admission

This should not be implemented only in hydration or only in the repair layer.

Reasons:

- the user-visible failure happens at workflow decisions, not just at projection time
- `close-session` and `start-session` are the places that choose whether work may continue
- stale merged open cycles are a business-topology contradiction, not a rendering issue
- admission hardening can stop the bad path before more workflow state is written

## Recommended Runtime Model

### Shared Helper

Add one shared helper, derived from the existing `pre-write-admit` session integration gate, that can answer:

- does the cycle branch exist locally?
- does the owning session branch exist locally?
- is the cycle branch already an ancestor of the session branch?
- is the session branch already an ancestor of the configured source branch?
- should this cycle still be considered resumable?

Recommended output shape:

- `status: active | stale_merged_into_session | stale_merged_into_source | unknown`
- `blocking_reason`
- `warnings`

### `close-session` Behavior

Upgrade `close-session-admit-use-case` so it validates close decisions against git topology.

Expected behavior:

- if a cycle is open in artifacts and already merged into the session branch:
  - `report` must be rejected
  - missing decision must still be rejected
  - user must regularize it as `integrate-to-session` or `close-non-retained`
- if the cycle is not merged, current behavior stays unchanged

Recommended new reason codes:

- `CLOSE_SESSION_STALE_REPORTED_CYCLE_ALREADY_MERGED`
- `CLOSE_SESSION_STALE_OPEN_CYCLE_DECISION_MISSING`

### `start-session` Behavior

Upgrade `start-session-admit-use-case` on the source branch:

- before returning `resume_current_cycle`, classify each open cycle
- if the only open cycle is stale-merged:
  - do not return `resume_current_cycle`
  - return a blocking action that explicitly says audit regularization is required

Recommended action:

- `blocked_stale_open_cycle_state`

Recommended reason codes:

- `START_SESSION_STALE_OPEN_CYCLE_MERGED_INTO_SESSION`
- `START_SESSION_STALE_OPEN_CYCLE_MERGED_INTO_SOURCE`

### State-Mode Parity

The guard must use:

- the same git topology checks in all state modes
- workflow artifact data resolved from the active runtime source

This means:

- no behavior drift between `files` and `db-only`
- no special-case bypass because the index is SQLite-backed

## Design Constraints

- Never auto-close the cycle silently from admission.
- Never reinterpret a truly open, unmerged cycle as closed.
- If refs are missing locally, degrade to `unknown`, not `merged`.
- Prefer explicit blocking with actionable rationale over silent allowance.
- Reuse the existing git adapter primitives instead of shelling new ad hoc commands.

## Proposed Implementation Steps

### Phase 1 - Extract Shared Git Topology Guard

Add one shared helper from the logic already present in `pre-write-admit`.

Done when:

- ancestry checks are reusable outside `pre-write-admit`
- cycle/session/source merge classification is available to runtime admissions

### Phase 2 - Harden `close-session`

Apply the guard to session close decisions.

Done when:

- stale merged open cycles no longer pass as `report`
- stale merged open cycles without regenerated session close report are blocked

### Phase 3 - Harden `start-session`

Apply the guard to source-branch resume logic.

Done when:

- source-branch `start-session` no longer recommends resuming a stale merged cycle
- output tells the user to regularize audit state instead

### Phase 4 - Add Regression Coverage

Add fixtures for:

- file-backed stale merged cycle on `close-session`
- file-backed stale merged cycle on `start-session`
- db-only stale merged cycle on `start-session`
- optional consistency fixture for stale close-gate/session-close drift

## Verification Strategy

Minimum validation set:

- `node tools/perf/verify-close-session-admission-fixtures.mjs`
- `node tools/perf/verify-start-session-admission-fixtures.mjs`
- any new db-only parity verifier added for this work
- targeted manual fixture run proving:
  - merged cycle + `report` decision blocks
  - merged cycle on `dev` does not yield `resume_current_cycle`

## Risks

- false positives if local refs are absent or stale
- over-blocking on repos with intentionally archived cycle branches
- accidental divergence between `pre-write-admit` and the new shared helper if logic is copied instead of extracted

## Recommended Next Step

Implement the shared classification helper first, then wire `close-session`, then `start-session`, then add parity fixtures.
