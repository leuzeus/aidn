# Backlog Stale Merged Cycle Guard - 2026-03-22

## Goal

Track the concrete work needed so `aidn` no longer keeps or resumes a cycle that is still marked open in workflow artifacts even though git shows it is already integrated.

Reference plan:

- `docs/PLAN_STALE_MERGED_CYCLE_GUARD_2026-03-22.md`

## Backlog Items

### SMCG-01 - Define Stale Merged Cycle Vocabulary

Status: implemented in essence
Priority: high

Why:

- admissions need one stable interpretation of “artifact says open, git says merged”

Done when:

- explicit statuses exist for:
  - `active`
  - `stale_merged_into_session`
  - `stale_merged_into_source`
  - `unknown`

### SMCG-02 - Extract Shared Topology Helper

Status: implemented in essence
Priority: high

Why:

- `pre-write-admit` already computes merge ancestry, but the logic is not reusable by runtime admissions

Done when:

- one shared helper exposes:
  - cycle branch ref availability
  - session branch ref availability
  - source branch ref availability
  - `cycle -> session` ancestry
  - `session -> source` ancestry
  - classification result

### SMCG-03 - Harden `close-session` Against Stale `report` Decisions

Status: implemented in essence
Priority: high

Why:

- a merged cycle must not survive session closure as a still-open reported cycle

Done when:

- `close-session-admit` blocks if:
  - a cycle is open in artifacts
  - its branch is already merged into the owning session branch
  - and the close decision is `report`

### SMCG-04 - Harden `close-session` Against Post-Close Drift

Status: implemented in essence
Priority: high

Why:

- a session may keep `close_gate_satisfied: yes` even after a new cycle is attached later

Done when:

- `close-session-admit` blocks when:
  - the session close report predates or omits a newly attached open cycle
  - and that cycle has no valid regenerated close decision

### SMCG-05 - Harden `start-session` Source-Branch Resume Logic

Status: implemented in essence
Priority: high

Why:

- the current source-branch path resumes any sole open cycle without checking whether it is already merged

Done when:

- `start-session-admit` no longer returns `resume_current_cycle` for a stale merged cycle
- it returns an explicit blocking action with audit-regularization guidance

### SMCG-06 - Add `close-session` Fixture Coverage

Status: implemented in essence
Priority: high

Why:

- the failure must be reproducible in automation

Done when:

- fixture coverage proves:
  - merged cycle + `report` decision blocks
  - unmerged cycle + `report` decision still follows current contract

### SMCG-07 - Add `start-session` Fixture Coverage

Status: implemented in essence
Priority: high

Why:

- the user-visible regression happened in `start-session`

Done when:

- fixture coverage proves:
  - source branch with one stale merged open cycle does not yield `resume_current_cycle`
  - the new reason code/action is emitted

### SMCG-08 - Add `db-only` Parity Fixture

Status: partially implemented
Priority: high

Why:

- the reported consumer repository runs in `db-only`

Done when:

- the stale merged cycle scenario behaves the same in `db-only` as in `files`

### SMCG-09 - Reassess `CURRENT-STATE` Consistency Coverage

Status: pending
Priority: medium

Why:

- stale merged open cycles are also a workflow consistency smell, not only an admission problem

Done when:

- one explicit decision exists whether to:
  - add a new `verify-current-state-consistency` failure mode
  - or keep the check admission-only

### SMCG-10 - Document Runtime Behavior Change

Status: partially implemented
Priority: medium

Why:

- users need to understand why `aidn` blocks stale resume paths instead of suggesting “resume cycle”

Done when:

- changelog and/or workflow docs mention:
  - stale merged open cycle detection
  - `close-session` blocking on inconsistent `report`
  - `start-session` blocking on stale resume paths

## Current Read Of Implementation

- `SMCG-01` to `SMCG-07` are implemented in essence in the current codebase:
  - shared stale-cycle vocabulary exists in `stale-open-cycle-guard-lib.mjs`
  - `start-session` and `close-session` both consume the shared classification
  - stale-source and stale-session actions/reason codes are wired through runtime admission
  - fixture coverage exists in `verify-start-session-admission-fixtures.mjs`, `verify-close-session-admission-fixtures.mjs`, and `verify-workflow-transition-fixtures.mjs`
- `SMCG-08` is only partially implemented:
  - there is explicit `db-only` stale-cycle coverage for `start-session`
  - parity is not yet documented as fully closed across every stale-cycle path
- `SMCG-09` remains open:
  - the guard currently lives in admission logic, not in a dedicated `CURRENT-STATE` consistency verifier
- `SMCG-10` is only partially implemented:
  - the diagrams now mention the stale merged-cycle guard
  - a broader workflow/changelog note is still missing if we want the behavior change documented outside diagrams and planning docs
