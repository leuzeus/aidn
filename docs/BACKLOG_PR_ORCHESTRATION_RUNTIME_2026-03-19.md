# Backlog PR Orchestration Runtime - 2026-03-19

## Goal

Track concrete work needed so `aidn` gains a dedicated PR orchestration skill and can execute the intended flow after `close-session`:

- push session branch
- open or recover PR
- track review / merge state
- enforce post-merge sync

Reference plan:

- `docs/PLAN_PR_ORCHESTRATION_RUNTIME_2026-03-19.md`

## Backlog Items

### PROR-01 - Define PR Workflow Vocabulary

Status: pending
Priority: high

Why:

- the runtime needs a stable state machine before it can gate anything

Done when:

- `none`
- `open`
- `merged`
- `closed_not_merged`

are explicitly defined for `pr_status`

and:

- `not_needed`
- `required`
- `done`

are explicitly defined for `post_merge_sync_status`

### PROR-02 - Extend Session Artifact Contract

Status: pending
Priority: high

Why:

- PR state must survive restart, handoff, and reinstall

Done when:

- the session template includes:
  - `pr_status`
  - `pr_url`
  - `pr_number`
  - `pr_base_branch`
  - `pr_head_branch`
  - `pr_review_status`
  - `post_merge_sync_status`
  - `post_merge_sync_basis`

### PROR-03 - Parse PR State In Workflow Libraries

Status: pending
Priority: high

Why:

- runtime admission cannot depend on raw markdown scraping in several places

Done when:

- `session-context-lib` parses the PR fields
- branch/session mapping summaries can expose those fields where needed

### PROR-04 - Add Summary Pointers In Runtime State Artifacts

Status: pending
Priority: high

Why:

- reload and handoff need short PR visibility without opening the full session artifact blindly

Done when:

- `CURRENT-STATE.md` can summarize:
  - `pr_status`
  - `pr_number`
  - `pr_base_branch`
  - `pr_head_branch`
  - `post_merge_sync_status`

- `HANDOFF-PACKET.md` can summarize:
  - `pr_status`
  - `post_merge_sync_status`
  - recommended PR orchestration action

### PROR-05 - Implement `pr-orchestrate` Admission Use Case

Status: pending
Priority: high

Why:

- the skill needs a business gate before any provider-specific operation

Done when:

- one runtime use case decides:
  - PR not ready
  - push required
  - PR open allowed
  - PR already open
  - merge sync required
  - PR flow complete

### PROR-06 - Add `pr-orchestrate` Hook Entrypoint

Status: pending
Priority: high

Why:

- the skill must become routable through the standard `aidn` runtime hook layer

Done when:

- `tools/perf/pr-orchestrate-hook.mjs` exists
- `skill-policy.mjs` routes `pr-orchestrate`
- strict/db-backed behavior follows the normal skill-hook model

### PROR-07 - Deliver Manual-Assisted Provider Mode

Status: pending
Priority: high

Why:

- the first usable version should not require GitHub automation

Done when:

- the skill can:
  - verify git readiness
  - propose exact next commands
  - accept or persist manual PR metadata
  - continue from recorded PR state

### PROR-08 - Integrate `close-session` Recommendation

Status: pending
Priority: high

Why:

- the missing process handoff happens immediately after a successful session close

Done when:

- successful `close-session` returns a recommendation to run `pr-orchestrate`
- the recommendation is machine-visible in hook output

### PROR-09 - Integrate `start-session` With Real PR State

Status: pending
Priority: high

Why:

- the documented `PR OPEN | MERGED | CLOSED` policy is not useful until `start-session` reads real PR state

Done when:

- `start-session` uses persisted `pr_status`
- `pr_status=open` resumes the existing session branch
- `pr_status=merged` requires sync completion before allowing a new session
- `pr_status=closed_not_merged` requires explicit decision

### PROR-10 - Integrate Post-Merge Sync State

Status: pending
Priority: high

Why:

- `SPEC-R09` must become part of the same orchestration path, not a purely documentary rule

Done when:

- merge detection sets `post_merge_sync_status=required`
- local reconciliation can mark `post_merge_sync_status=done`
- downstream runtime gates stop when merge happened but sync is still missing

### PROR-11 - Reassess `cycle-create` Behavior On Session Branches With Active PR State

Status: pending
Priority: medium

Why:

- once PR state exists, new cycle creation on a session branch may become ambiguous or invalid

Done when:

- one explicit decision exists for `cycle-create` when:
  - `pr_status=open`
  - `pr_status=merged` but sync is pending
  - `pr_status=closed_not_merged`

### PROR-12 - Add Provider Abstraction

Status: pending
Priority: medium

Why:

- manual mode should not hard-code future GitHub automation paths

Done when:

- a provider contract exists for:
  - find PR
  - create PR
  - read PR status
  - optionally merge PR

### PROR-13 - Add Optional GitHub CLI Adapter

Status: pending
Priority: medium

Why:

- GitHub-hosted repositories should gain a smoother automated path once the state model is stable

Done when:

- an adapter can use `gh` or equivalent to:
  - detect an existing PR
  - create a PR
  - refresh its state

without becoming mandatory for phase 1

### PROR-14 - Update Templates / Skills / Generated Workflow Docs

Status: pending
Priority: medium

Why:

- users and agents need to see the new PR orchestration path explicitly

Done when:

- a new `scaffold/codex/pr-orchestrate/SKILL.md` exists
- workflow summary/docs mention the new runtime path after `close-session`
- the state/rule boundary remains explicit

### PROR-15 - Update Canonical Docs, Diagrams, And BPMN

Status: pending
Priority: medium

Why:

- the PR flow is part of the workflow contract and must stay aligned across prose and visual references

Done when:

- `docs/SPEC.md` reflects the dedicated PR orchestration path where needed
- generated workflow docs and scaffold docs mention the new flow explicitly
- impacted diagrams under `docs/diagrams/` are refreshed
- impacted BPMN files under `docs/bpmn/` are refreshed when the runtime path changes materially

### PROR-16 - Add Verifier Coverage

Status: pending
Priority: high

Why:

- PR orchestration is cross-cutting and will regress unless locked with fixtures

Done when:

- fixtures cover:
  - closed session, dirty tree
  - closed session, branch not pushed
  - closed session, PR open
  - PR merged, sync required
  - PR merged, sync complete
  - PR closed not merged

## Sequencing Recommendation

1. PROR-01
2. PROR-02
3. PROR-03
4. PROR-04
5. PROR-05
6. PROR-06
7. PROR-07
8. PROR-08
9. PROR-09
10. PROR-10
11. PROR-11
12. PROR-12
13. PROR-13
14. PROR-14
15. PROR-15
16. PROR-16

## Open Questions

- should `pr-orchestrate` own merge execution eventually, or stop at “merge now” guidance?
- should PR state be stored only in the session artifact, or also in a dedicated support artifact later?
- should the first release support only GitHub-style PR terminology, or keep the abstraction provider-neutral from day one?
- should `close-session` eventually dispatch `pr-orchestrate` automatically in coordinator mode, or only recommend it?
