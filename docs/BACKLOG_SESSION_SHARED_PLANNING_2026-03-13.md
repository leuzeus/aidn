# Backlog Session Shared Planning - 2026-03-13

## Goal

Track concrete work needed so `aidn` gains a session-scoped shared planning and backlog layer between:

- session admission
- handoff/dispatch coordination
- cycle execution planning

Reference plan:

- `docs/PLAN_SESSION_SHARED_PLANNING_2026-03-13.md`

## Backlog Items

### SSP-01 - Define Session Planning Vocabulary

Status: completed
Priority: high

Why:

- the runtime needs one stable language for session planning state

Done when:

- `draft`
- `promoted`
- `dispatch_ready`
- `consumed_by_cycle`
- `closed`

are defined explicitly

Progress note:

- the runtime now uses the shared planning states `draft`, `promoted`, `dispatch_ready`, `consumed_by_cycle`, and `closed`
- these states are reflected across `session-plan`, shared backlog projection, and coordinator/handoff consumers

### SSP-02 - Define Runtime Draft Artifact Contract

Status: completed
Priority: high

Why:

- read-only and pre-cycle planning need a durable local state

Done when:

- `.aidn/runtime/context/session-plan-draft.json` has an explicit schema
- the schema includes:
  - session identity
  - planning status
  - candidate backlog items
  - open questions
  - next dispatch recommendation

Progress note:

- `.aidn/runtime/context/session-plan-draft.json` is now written by `aidn runtime session-plan`
- the draft persists session identity, planning status, backlog items, open questions, dispatch hints, execution scope, and agent provenance

### SSP-03 - Define Shared Session Backlog Artifact Contract

Status: completed
Priority: high

Why:

- multi-agent coordination requires a git-shareable planning artifact

Done when:

- one explicit artifact shape is documented for:
  - `docs/audit/backlog/BL-SXXX-<slug>.md`
- the artifact includes:
  - session context
  - linked cycles
  - backlog items
  - open questions
  - addenda
  - dispatch-ready next step

Progress note:

- `docs/audit/backlog/BL-SXXX-<slug>.md` is now the canonical shared backlog artifact
- it carries session context, linked cycles, dispatch fields, execution scope, backlog items, open questions, and structured addenda

### SSP-04 - Add Summary Pointers In `CURRENT-STATE.md`

Status: completed
Priority: high

Why:

- reload must discover active planning without opening the full backlog blindly

Done when:

- `CURRENT-STATE.md` can summarize:
  - `active_backlog`
  - `backlog_status`
  - `backlog_next_step`

without duplicating the backlog body

Progress note:

- `CURRENT-STATE.md` now projects `active_backlog`, `backlog_status`, `backlog_next_step`, `backlog_selected_execution_scope`, and `planning_arbitration_status`
- reload paths consume these fields as summary pointers without duplicating backlog content

### SSP-05 - Add Backlog References To `HANDOFF-PACKET.md`

Status: completed
Priority: high

Why:

- relay needs to carry planning continuity explicitly

Done when:

- handoff projection supports:
  - `backlog_refs`
  - `next_dispatch_step`
  - `planning_arbitration_status`

Progress note:

- `HANDOFF-PACKET.md` now projects `backlog_refs`, planning arbitration, dispatch provenance, freshness, and shared planning candidate fields
- receiving agents can reload the referenced backlog directly when relay provenance is `shared_planning`

### SSP-06 - Add A Bounded Session Planning Command Or Skill

Status: completed
Priority: high

Why:

- planning should be executable through runtime/skills, not only by manual document editing

Done when:

- one command or skill can:
  - create/update the runtime draft
  - promote the draft to a shared backlog
  - refuse unsafe promotion when admission/arbitration is unresolved

Progress note:

- `aidn runtime session-plan` now creates and updates runtime drafts, promotes shared backlogs, and merges updates into existing session backlogs
- workflow skills use this command instead of relying on manual backlog editing

### SSP-07 - Route Promoted Backlog Through DB-First Persistence

Status: completed
Priority: high

Why:

- `dual` and `db-only` must not gain a special-case planning persistence path

Done when:

- promoted backlog artifacts are persisted through:
  - runtime artifact store
  - normal projection/index sync flow

Progress note:

- promoted shared backlogs and aligned `CURRENT-STATE.md` updates now flow through DB-first persistence in `dual` and `db-only`
- verifier coverage confirms artifact-store / sqlite persistence for promoted planning

### SSP-08 - Keep Cycle Plans As Execution Contracts

Status: completed
Priority: high

Why:

- the new session backlog must not dilute cycle accountability

Done when:

- session backlog can feed cycle selection or creation
- `cycles/*/plan.md` remains the source of `first_plan_step` for implementation writes

Progress note:

- shared session planning now informs relay, dispatch, and cycle-create decisions without replacing `cycles/*/plan.md`
- implementation writes still depend on cycle-scoped `first_plan_step`, while promoted session planning only selects or gates the execution path

### SSP-09 - Add Planning Freshness / Arbitration Gates

Status: completed
Priority: medium

Why:

- shared planning is not useful if stale or unresolved planning is silently relayed

Done when:

- handoff warns on stale referenced backlog
- dispatch blocks when planning arbitration remains unresolved
- cycle creation from promoted planning requires an explicit selected execution scope

Progress note:

- handoff now exposes shared planning freshness and warns when the referenced backlog is stale
- coordinator dispatch now blocks when `planning_arbitration_status` remains unresolved
- cycle creation now requires `backlog_selected_execution_scope=new_cycle` when it comes from promoted shared planning

### SSP-10 - Add Multi-Agent Addenda Rules

Status: completed
Priority: medium

Why:

- several agents need to append to planning without collapsing authorship and rationale

Done when:

- the shared backlog supports append-only addenda sections
- addenda record:
  - agent role
  - timestamp
  - rationale
  - affected backlog item or question

Progress note:

- shared backlog addenda now use a structured append-only markdown line format
- each addendum records `agent_role`, `timestamp`, `rationale`, `affected_item`, `affected_question`, and `note`
- coordinator dispatch can summarize recent structured addenda from the active shared backlog

### SSP-11 - Add Verifier Coverage

Status: completed
Priority: high

Why:

- this feature crosses session, handoff, runtime, and state-mode boundaries

Done when:

- fixtures cover:
  - read-only planning draft persistence
  - shared backlog promotion
  - `dual` projection
  - `db-only` projection/materialization
  - handoff with backlog reference
  - cycle creation from promoted session planning

Progress note:

- verifier coverage now spans session-plan promotion/update, shared planning handoff/admit, dispatch/resume/orchestrate consumption, and cycle-create gating
- fixtures cover both `dual` persistence and `db-only` draft behavior

### SSP-12 - Align Templates And Documentation

Status: completed
Priority: medium

Why:

- users and agents need the new planning layer to be visible in the installed baseline

Done when:

- scaffold templates include the new summary fields or artifact references
- docs explain when to keep planning local vs when to promote it

Progress note:

- scaffold and installed templates now include backlog summary pointers, selected execution scope, and structured addenda fields
- Codex-facing docs now state when planning can stay local and when promotion to a shared backlog is required

## Sequencing Recommendation

1. SSP-01
2. SSP-02
3. SSP-03
4. SSP-04
5. SSP-05
6. SSP-06
7. SSP-07
8. SSP-08
9. SSP-09
10. SSP-10
11. SSP-11
12. SSP-12

## Open Questions

- should promotion to a shared backlog be manual first, or automatic on `handoff-close` when planning changed?
- should one session allow several active backlog artifacts, or should one backlog stay canonical per session?
- should backlog addenda be append-only markdown, structured canonical blocks, or both?
- should `coordinator-dispatch-plan` consume the session backlog directly, or only through `HANDOFF-PACKET.md` and `CURRENT-STATE.md` projections?
