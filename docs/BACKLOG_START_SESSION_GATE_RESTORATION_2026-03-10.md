# Backlog Start-Session Gate Restoration - 2026-03-10

## Goal

Track concrete follow-up work for restoration of the lost `start-session` branch/session/cycle gate.

Reference plan:

- `docs/PLAN_START_SESSION_GATE_RESTORATION_2026-03-10.md`

## Backlog Items

### SSGR-01 - Extract Shared Branch Classification Helpers

Status: completed
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

Progress note:

- branch classification is centralized in `src/lib/workflow/branch-kind-lib.mjs`
- `start-session`, `branch-cycle-audit`, `cycle-create`, `close-session`, `promote-baseline`, `requirements-delta`, and reload consumers use the shared branch-kind helper instead of local regex copies

### SSGR-02 - Extract Shared Session/Cycle Context Parsing Helpers

Status: completed
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

Progress note:

- shared session/cycle parsing helpers now live in `src/lib/workflow/session-context-lib.mjs` and `src/lib/workflow/branch-mapping-lib.mjs`
- `start-session` and `branch-cycle-audit` admission paths use these shared helpers for session lookup, cycle lookup, and continuity fields
- `integration-risk-service` now reuses the shared session metadata parser and artifact lookup helpers instead of maintaining a separate session-topology parser

### SSGR-03 - Implement `start-session-admit` Use Case

Status: completed
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

Progress note:

- `src/application/runtime/start-session-admit-use-case.mjs` now provides a dedicated workflow-specific admission layer before `session-start`
- it returns structured decisions including branch kind, active session/cycle, open cycles, mapping state, blocking reasons, user choices, and recommended next action

### SSGR-04 - Enforce Non-Compliant Branch Stop At Session Start

Status: completed
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

Progress note:

- `start-session` now stops on `branch_kind=other|unknown` with `action=blocked_non_compliant_branch`
- the admission output exposes explicit operator choices: `merge_to_source_first` and `ignore_with_rationale`
- fixture coverage verifies the blocked branch path in both the specialized hook and the Codex JSON hook

### SSGR-05 - Enforce Resume-First Session Continuity

Status: completed
Priority: high

Files:

- `start-session` admission logic
- fixtures/tests

Why:

- the workflow must resume an active open session before creating new session artifacts

Done when:

- if the current branch maps to an open session, the decision is `resume_current_session`
- `start-session` does not silently authorize a new session in that case

Progress note:

- `start-session-admit` now returns `resume_current_session` for owned session branches and for source-branch continuity when an active session must be resumed first
- fixture coverage now includes an explicit `resume_current_session` case

### SSGR-06 - Enforce Resume-First Cycle Continuity

Status: completed
Priority: high

Files:

- `start-session` admission logic
- fixtures/tests

Why:

- cycle and intermediate branches must continue their owner cycle instead of opening parallel workflow state

Done when:

- if the current branch maps to an open cycle or intermediate branch, the decision is `resume_current_cycle`
- cycle parent continuity is explicit in the admission output

Progress note:

- `start-session-admit` now returns `resume_current_cycle` for owned cycle and intermediate branches
- the admission payload exposes the mapped cycle and owner session when they can be resolved

### SSGR-07 - Block New Session/Cycle Creation While Open Cycles Need Resolution

Status: completed
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

Progress note:

- source-branch admission now blocks new workflow creation when active sessions or open cycles already own continuity
- it returns `resume_current_session`, `resume_current_cycle`, or `choose_cycle` instead of silently authorizing a new session

### SSGR-08 - Add Multi-Cycle Arbitration At Session Start

Status: completed
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

Progress note:

- multi-cycle session and source-branch scenarios now return `choose_cycle` with candidate cycle summaries and explicit required user choices
- fixture coverage verifies the blocked multi-cycle branch path

### SSGR-09 - Implement Session Branch Base Gate Against `source_branch`

Status: completed
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

Progress note:

- `start-session-admit` now enforces a session-base gate via latest-session continuity against the configured `source_branch`
- unresolved previous session state returns `blocked_session_base_gate` instead of opening a new session branch by default

### SSGR-10 - Add Specialized `start-session` Hook Entrypoint

Status: completed
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

Progress note:

- `tools/perf/start-session-hook.mjs` now performs admission first and only delegates to generic `session-start` workflow work on admitted paths

### SSGR-11 - Update Skill Routing To Use The Specialized Start-Session Path

Status: completed
Priority: high

Files:

- `src/core/skills/skill-policy.mjs`
- `src/application/runtime/skill-hook-use-case.mjs`

Why:

- restore correct behavior from the actual production entrypoint, not only from direct scripts

Done when:

- `start-session` no longer routes directly to the generic `workflow-hook`
- runtime skill invocation preserves current JSON/strict behavior

Progress note:

- skill routing now targets the specialized `start-session-hook.mjs`
- runtime skill execution preserves JSON, strict, and DB-backed behavior through the standard skill-hook path

### SSGR-12 - Re-Align `branch-cycle-audit` With Shared Mapping Logic

Status: completed
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

Progress note:

- `branch-cycle-audit-admit` now reuses the same shared branch-kind and branch-mapping helpers as `start-session`
- coverage verifies that branch ownership stops before generic gating when mapping is missing or ambiguous

### SSGR-13 - Extend Contract Tests For Negative Start-Session Outcomes

Status: completed
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

Progress note:

- `verify-start-session-admission-fixtures.mjs` now asserts structured admission decisions for non-compliant branch, missing session mapping, missing cycle mapping, and multi-cycle arbitration cases

### SSGR-14 - Add Positive Continuity Tests For Resume Paths

Status: completed
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

Progress note:

- fixture coverage now includes positive resume cases for both `resume_current_session` and `resume_current_cycle`, plus the `choose_cycle` arbitration path

### SSGR-15 - Preserve `dual` / `db-only` Strict Semantics After Admission

Status: completed
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

Progress note:

- `start-session` keeps strict runtime semantics in DB-backed modes through the standard skill-hook path
- blocked admission prevents delegation to the generic workflow hook, while admitted paths still flow through hydration/index/repair checks

### SSGR-16 - Update `start-session` Skill Documentation

Status: completed
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

Progress note:

- `scaffold/codex/start-session/SKILL.md` now documents admission-first execution, stop conditions, resume-vs-create decisions, and multi-cycle arbitration

### SSGR-17 - Update Workflow Adapter Documentation

Status: completed
Priority: medium

Files:

- `scaffold/docs_audit/PROJECT_WORKFLOW.md`
- `scaffold/docs_audit/WORKFLOW_SUMMARY.md`

Why:

- adapter documentation should describe an actually enforced gate, not a doc-only contract

Done when:

- session branch base gate wording matches implemented admission behavior
- workflow summary mentions that `start-session` may block and request arbitration before creation

Progress note:

- installed workflow docs now describe `start-session` as a blocking admission step that may stop and request arbitration before any creation path

### SSGR-18 - Update Installed Execution Contract Documentation

Status: completed
Priority: medium

Files:

- `scaffold/root/AGENTS.md`

Why:

- the root execution contract should describe the real execution order and enforcement path

Done when:

- `AGENTS.md` reflects that `start-session` begins with admission
- it distinguishes infrastructure runtime hooks from workflow business gates

Progress note:

- the installed execution contract now states that `start-session` is admission-first and separates workflow business gates from generic runtime hooks

### SSGR-19 - Record The Restoration In Changelog

Status: completed
Priority: medium

Files:

- `CHANGELOG.md`
- optional targeted workflow changelog note if needed

Why:

- keep a repository trace of the regression fix and behavior restoration

Done when:

- changelog records restoration of `start-session` branch/session/cycle gating
- changelog notes documentation and test coverage updates

Progress note:

- `CHANGELOG.md` already records the restoration of `start-session` admission gates, the shared `branch-cycle-audit` mapping path, and the associated regression coverage/docs updates

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
