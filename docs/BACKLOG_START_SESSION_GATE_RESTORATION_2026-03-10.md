# Backlog Start-Session Gate Restoration - 2026-03-10

## Goal

Track concrete follow-up work for restoration of the lost `start-session` branch/session/cycle gate.

Reference plan:

- `docs/PLAN_START_SESSION_GATE_RESTORATION_2026-03-10.md`

## Backlog Items

### SSGR-01 - Extract Shared Branch Classification Helpers

Status: proposed
Priority: high

Files:

- shared workflow lib files under `src/lib/workflow/`
- current branch classification consumers

Why:

- stop duplicating branch-kind logic across runtime, verification, and admission code

Done when:

- branch kind classification is centralized
- supported kinds include `session`, `cycle`, `intermediate`, `other`, `unknown`
- existing consumers use the shared helper instead of local regex copies

### SSGR-02 - Extract Shared Session/Cycle Context Parsing Helpers

Status: proposed
Priority: high

Files:

- shared workflow lib files under `src/lib/workflow/`
- session/cycle topology consumers

Why:

- keep one source of truth for session topology and continuity parsing

Done when:

- helpers exist for:
  - session file lookup
  - cycle status lookup
  - parsing `attached_cycles`
  - parsing `integration_target_cycles`
  - parsing `primary_focus_cycle`
  - parsing `reported_from_previous_session`
  - parsing `carry_over_pending`
- runtime and verification code stop maintaining divergent parsers

### SSGR-03 - Implement `start-session-admit` Use Case

Status: proposed
Priority: high

Files:

- `src/application/runtime/*`
- optional shared runtime support files

Why:

- restore the missing workflow-specific business gate before `session-start`

Done when:

- a dedicated admission use case exists for `start-session`
- it returns structured decisions instead of relying on generic runtime `ok`
- output includes:
  - branch kind
  - branch compliance
  - active session
  - active cycle
  - open cycles
  - blocking reasons
  - required user choice
  - recommended next action

### SSGR-04 - Enforce Non-Compliant Branch Stop At Session Start

Status: proposed
Priority: high

Files:

- `start-session` admission/runtime entrypoint
- tests/fixtures

Why:

- the current implementation incorrectly allows `start-session` to pass on non-aid'n branches

Done when:

- `start-session` stops on `branch_kind=other`
- the stop output requests explicit arbitration
- allowed choices include:
  - merge into source branch first
  - ignore with rationale

### SSGR-05 - Enforce Resume-First Session Continuity

Status: proposed
Priority: high

Files:

- `start-session` admission logic
- fixtures/tests

Why:

- the workflow must resume an active open session before creating new session artifacts

Done when:

- if the current branch maps to an open session, the decision is `resume_current_session`
- `start-session` does not silently authorize a new session in that case

### SSGR-06 - Enforce Resume-First Cycle Continuity

Status: proposed
Priority: high

Files:

- `start-session` admission logic
- fixtures/tests

Why:

- cycle and intermediate branches must continue their owner cycle instead of opening parallel workflow state

Done when:

- if the current branch maps to an open cycle or intermediate branch, the decision is `resume_current_cycle`
- cycle parent continuity is explicit in the admission output

### SSGR-07 - Block New Session/Cycle Creation While Open Cycles Need Resolution

Status: proposed
Priority: high

Files:

- `start-session` admission logic
- fixtures/tests

Why:

- a session with unresolved open cycles must not spawn additional sessions/cycles implicitly

Done when:

- with open cycles plus a new accompanying request, `start-session` blocks further creation
- the output requires resolving or choosing an existing cycle first
- without a new request, the decision resumes the current session/cycle path

### SSGR-08 - Add Multi-Cycle Arbitration At Session Start

Status: proposed
Priority: high

Files:

- `start-session` admission logic
- fixtures/tests

Why:

- several open cycles require explicit operator choice rather than silent inference

Done when:

- `start-session` returns `choose_cycle` when several open cycles are valid candidates
- output includes candidate cycle ids
- output supports explicit user choice or relaunch by agent

### SSGR-09 - Implement Session Branch Base Gate Against `source_branch`

Status: proposed
Priority: high

Files:

- `start-session` admission logic
- workflow metadata readers
- fixtures/tests

Why:

- the adapter contract requires checking previous session state against the configured source branch before opening a new session branch

Done when:

- admission evaluates the previous session state before authorizing a new session branch
- it distinguishes at minimum:
  - previous session still open / continue existing branch
  - previous session resolved / new session allowed
  - non-resolved ambiguous prior state / explicit user decision required
- hard stop remains in effect for default session-branch chaining

### SSGR-10 - Add Specialized `start-session` Hook Entrypoint

Status: proposed
Priority: high

Files:

- `tools/perf/*`
- `src/application/runtime/*`
- skill routing files

Why:

- integrate the new admission layer without rewriting the existing generic runtime hook

Done when:

- `start-session` runs through a specialized hook entrypoint
- the specialized hook runs admission first
- the generic `workflow-hook --phase session-start` is called only after admission success

### SSGR-11 - Update Skill Routing To Use The Specialized Start-Session Path

Status: proposed
Priority: high

Files:

- `src/core/skills/skill-policy.mjs`
- `src/application/runtime/skill-hook-use-case.mjs`

Why:

- restore correct behavior from the actual production entrypoint, not only from direct scripts

Done when:

- `start-session` no longer routes directly to the generic `workflow-hook`
- runtime skill invocation preserves current JSON/strict behavior

### SSGR-12 - Re-Align `branch-cycle-audit` With Shared Mapping Logic

Status: proposed
Priority: high

Files:

- `branch-cycle-audit` runtime path
- shared helpers
- fixtures/tests

Why:

- avoid reintroducing divergent interpretations between `start-session` and `branch-cycle-audit`

Done when:

- `branch-cycle-audit` uses the same shared branch/session/cycle mapping logic
- generic signal gating remains additive, not the only branch/cycle decision layer

### SSGR-13 - Extend Contract Tests For Negative Start-Session Outcomes

Status: proposed
Priority: high

Files:

- `tools/perf/*`
- `tests/fixtures/*`

Why:

- current tests mostly validate that the hook returns `ok`, which misses the regression

Done when:

- tests explicitly fail when `start-session` incorrectly passes on:
  - non-compliant branch
  - missing session mapping
  - missing cycle mapping
  - unresolved multi-cycle continuity
- tests assert admission decisions, not only generic `ok`

### SSGR-14 - Add Positive Continuity Tests For Resume Paths

Status: proposed
Priority: medium

Files:

- `tools/perf/*`
- `tests/fixtures/*`

Why:

- the restored gate must support valid resume flows, not only block invalid states

Done when:

- tests cover:
  - resume current open session
  - resume current open cycle
  - continue current cycle without creating a new session
  - choose cycle when several valid open cycles exist

### SSGR-15 - Preserve `dual` / `db-only` Strict Semantics After Admission

Status: proposed
Priority: high

Files:

- db-backed hook/runtime tests
- start-session specialized hook

Why:

- admission restoration must not break strict runtime enforcement in db-backed modes

Done when:

- `dual` / `db-only` still force strict behavior
- hydration/index/repair behavior still runs after successful admission
- blocked admission prevents downstream mutation/runtime progression cleanly

### SSGR-16 - Update `start-session` Skill Documentation

Status: proposed
Priority: high

Files:

- `scaffold/codex/start-session/SKILL.md`

Why:

- the skill documentation must reflect the restored admission behavior and output

Done when:

- the skill explicitly describes:
  - blocking admission
  - resume-vs-create decisions
  - non-compliant branch stop
  - multi-cycle arbitration
  - continuity-first behavior

### SSGR-17 - Update Workflow Adapter Documentation

Status: proposed
Priority: medium

Files:

- `scaffold/docs_audit/PROJECT_WORKFLOW.md`
- `scaffold/docs_audit/WORKFLOW_SUMMARY.md`

Why:

- adapter documentation should describe an actually enforced gate, not a doc-only contract

Done when:

- session branch base gate wording matches implemented admission behavior
- workflow summary mentions that `start-session` may block and request arbitration before creation

### SSGR-18 - Update Installed Execution Contract Documentation

Status: proposed
Priority: medium

Files:

- `scaffold/root/AGENTS.md`

Why:

- the root execution contract should describe the real execution order and enforcement path

Done when:

- `AGENTS.md` reflects that `start-session` begins with admission
- it distinguishes infrastructure runtime hooks from workflow business gates

### SSGR-19 - Record The Restoration In Changelog

Status: proposed
Priority: medium

Files:

- `CHANGELOG.md`
- optional targeted workflow changelog note if needed

Why:

- keep a repository trace of the regression fix and behavior restoration

Done when:

- changelog records restoration of `start-session` branch/session/cycle gating
- changelog notes documentation and test coverage updates

## Sequencing Recommendation

1. SSGR-01
2. SSGR-02
3. SSGR-03
4. SSGR-04
5. SSGR-05
6. SSGR-06
7. SSGR-07
8. SSGR-08
9. SSGR-09
10. SSGR-10
11. SSGR-11
12. SSGR-12
13. SSGR-13
14. SSGR-14
15. SSGR-15
16. SSGR-16
17. SSGR-17
18. SSGR-18
19. SSGR-19

## Open Questions

- how should the first implementation infer "previous session PR status" without introducing a GitHub-specific dependency?
- should the first pass represent the session-base gate as local workflow-state continuity rather than literal remote PR state?
- should `branch-cycle-audit` get its own dedicated admission use case or consume the same helper stack through its current route?
- should `start-session` emit machine-readable user-choice prompts directly, or only a normalized decision payload to be surfaced by the caller?
