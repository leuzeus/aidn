# Plan PR Orchestration Runtime - 2026-03-19

## Objective

Extend `aidn` so the session workflow does not stop at `close-session`, but can continue through an explicit, machine-visible PR orchestration path:

- push the session branch
- create or recover the pull request
- track review / merge state
- enforce post-merge local reconciliation
- feed that state back into `start-session` and downstream runtime gates

The immediate user-facing need is clear:

- after `close-session`, the next real action is often not `start-session`
- it is usually `push -> PR -> review/merge -> sync`
- today this path exists as workflow policy, but not as a first-class runtime skill

## Implementation Status

Status:

- proposed

Not yet implemented:

- dedicated skill route for PR orchestration
- durable PR state in session/runtime artifacts
- machine-enforced transition from `close-session` to PR handling
- machine-enforced interpretation of `PR OPEN | PR MERGED | PR CLOSED`

Already implemented and reusable:

- admission-first runtime hooks
- git hygiene and reconciliation checks for `cycle-create`
- session close admission
- start-session admission
- DB-backed runtime digests and handoff/state projections

## Problem Summary

Current `aidn` baseline already states the intended PR workflow policy:

- session branches are reserved for integration / handoff / PR orchestration
- `PR OPEN`: continue existing session branch
- `PR MERGED`: allow new session branch from source branch
- `PR CLOSED (not merged)`: require explicit decision
- post-merge local sync is mandatory before continuing

But the runtime does not yet implement this policy as stateful behavior.

Today:

- `close-session` stops after closing the session and updating workflow artifacts
- no runtime skill proposes or manages PR creation
- no artifact stores authoritative `pr_status`
- `start-session` cannot rely on real PR state; it only sees branch/session continuity

This creates an orchestration gap:

- the workflow contract mentions PR states
- the runtime cannot observe or transition those states directly

## Extrapolated User Need

The actual product need is:

> Once a session is closed and the branch is ready, `aidn` must guide or execute the PR lifecycle explicitly, then block or allow subsequent workflow steps based on actual PR state and merge reconciliation.

This decomposes into five concrete needs:

1. determine whether the closed session is PR-ready
2. ensure the session branch is pushed and reviewable
3. create or recover a PR identity
4. persist PR lifecycle state in workflow artifacts
5. use that state to govern `start-session` and post-merge continuation

## Scope

In scope:

- one dedicated runtime skill for PR orchestration
- durable PR state in session and runtime summary artifacts
- admission and hook logic for PR-ready / PR-open / PR-merged / PR-closed cases
- post-merge sync as part of the same orchestration model
- documentation and visual workflow updates when the runtime path changes
- fixture coverage for manual-assisted and Git-aware flows

Out of scope:

- mandatory direct GitHub API automation in phase 1
- autonomous review resolution
- replacing Codex review gate semantics
- repository hosting abstraction beyond a first GitHub-oriented adapter

## Why A Dedicated Skill Is Required

This should not be folded silently into `close-session`.

Reasons:

- `close-session` is a session-finalization skill, not a branch publication skill
- PR orchestration has different external dependencies than artifact closure
- PR state survives longer than one close operation and must be resumable
- post-merge sync is semantically after merge, not part of session closing itself

The dedicated skill should be:

- `pr-orchestrate`

It may expose several actions internally, but the user-facing workflow should stay singular.

## Recommended Runtime Model

### Skill

Add:

- `pr-orchestrate`

Purpose:

- orchestrate the publish/review/merge/sync path of a session branch

Recommended action vocabulary:

- `prepare_pr`
- `push_required`
- `open_pr_allowed`
- `pr_open_continue_review`
- `pr_merge_ready`
- `post_merge_sync_required`
- `pr_flow_complete`
- `blocked_pr_not_ready`

### Runtime Entry Point

Add:

- `src/application/runtime/pr-orchestrate-admit-use-case.mjs`
- `tools/perf/pr-orchestrate-hook.mjs`

Then register the route in:

- `src/core/skills/skill-policy.mjs`

### State Model

The PR workflow needs durable state.

Recommended session fields:

- `pr_status: none | open | merged | closed_not_merged`
- `pr_url: <url> | none`
- `pr_number: <id> | none`
- `pr_base_branch: <branch> | none`
- `pr_head_branch: <branch> | none`
- `pr_review_status: unknown | pending | approved | changes_requested | resolved`
- `post_merge_sync_status: not_needed | required | done`
- `post_merge_sync_basis: <short rationale>`

Recommended `CURRENT-STATE.md` summary pointers:

- `pr_status`
- `pr_number`
- `pr_base_branch`
- `pr_head_branch`
- `post_merge_sync_status`

Recommended handoff/runtime summary projection:

- expose PR status in `HANDOFF-PACKET.md`
- expose PR status in `RUNTIME-STATE.md` only as a short routing hint, not full PR metadata

## Provider Strategy

### Phase 1 - Manual-Assisted Provider

No hard GitHub dependency.

The skill should:

- verify branch/upstream state
- determine whether a PR likely already exists from stored session state
- propose exact commands / next actions
- allow manual recording of `pr_status`, `pr_number`, `pr_url`
- enforce gating from recorded PR state

This phase is enough to close the current workflow gap.

### Phase 2 - GitHub Adapter

Add a provider adapter, for example:

- `PullRequestAdapter`
- `GitHubCliPullRequestAdapter`

Supported operations:

- detect existing PR for `head -> base`
- create PR
- read current PR state
- optionally merge PR

This phase should remain optional and environment-dependent.

## Admission Design

`pr-orchestrate-admit-use-case` should answer these questions in order:

1. Is there an active session artifact?
2. Is the current branch the session branch?
3. Is the session close gate satisfied?
4. Are unresolved open cycles still attached?
5. Is the working tree clean?
6. Is the session branch pushed and aligned with upstream?
7. Does PR state already exist in the session artifact?
8. If merged, has post-merge sync been completed?

Expected outputs:

- machine-readable action
- required user choice when needed
- recommended next action
- PR/session/git summary fields for projection

## Integration Points

### 1. `close-session`

After successful close:

- do not auto-open PR
- but return `recommended_next_action: run pr-orchestrate`

This is the missing process handoff today.

### 2. `start-session`

Upgrade `start-session` so it reads real PR state from the latest session artifact.

Desired behavior:

- `pr_status=open`: resume existing session branch by default
- `pr_status=merged` + `post_merge_sync_status=done`: allow next session creation from source branch
- `pr_status=merged` + `post_merge_sync_status=required`: block and require sync
- `pr_status=closed_not_merged`: stop and require explicit decision
- `pr_status=none`: fall back to current continuity rules

### 3. `pre-write-admit`

`cycle-create` on a session branch should eventually stop when:

- session PR is open and not intentionally part of the same integration window
- merge/sync state makes new cycle creation ambiguous

This can be introduced after the first `pr-orchestrate` delivery if needed.

### 4. Handoff / Runtime Digests

`HANDOFF-PACKET.md` should include:

- `pr_status`
- `pr_number`
- `post_merge_sync_status`
- the recommended PR-orchestration action when applicable

## Suggested File Touches

Primary runtime files:

- `src/core/skills/skill-policy.mjs`
- `src/application/runtime/pr-orchestrate-admit-use-case.mjs`
- `tools/perf/pr-orchestrate-hook.mjs`
- `src/application/runtime/close-session-admit-use-case.mjs`
- `src/application/runtime/start-session-admit-use-case.mjs`
- `tools/runtime/pre-write-admit.mjs`

State parsing / projection:

- `src/lib/workflow/session-context-lib.mjs`
- `src/lib/workflow/branch-mapping-lib.mjs`
- `tools/runtime/project-runtime-state.mjs`
- `tools/runtime/project-handoff-packet.mjs`

Templates / docs:

- `scaffold/codex/pr-orchestrate/SKILL.md`
- `scaffold/docs_audit/sessions/TEMPLATE_SESSION_SXXX.md`
- `scaffold/docs_audit/CURRENT-STATE.md`
- `scaffold/docs_audit/WORKFLOW_SUMMARY.md`
- `scaffold/docs_audit/PROJECT_WORKFLOW.md`
- `docs/SPEC.md`
- `docs/diagrams/01-global-system-architecture.md`
- `docs/diagrams/03-runtime-session-flow.md`
- `docs/bpmn/aidn-multi-agent-handoff-detail.bpmn`
- `docs/bpmn/README.md`

Verifier coverage:

- `tools/perf/verify-pr-orchestrate-admission-fixtures.mjs`
- `tools/perf/verify-start-session-admission-fixtures.mjs`
- `tools/perf/verify-pre-write-admit-fixtures.mjs`

## Delivery Phases

### Phase 1 - Vocabulary And State Contract

- add PR fields to the session template
- parse them in `session-context-lib`
- surface summary pointers in runtime projections

### Phase 2 - Runtime Skill

- add `pr-orchestrate` admission + hook
- support manual-assisted flow with no GitHub dependency

### Phase 3 - Workflow Integration

- wire `close-session` recommendation
- wire `start-session` gating from real PR state
- add handoff/runtime digest outputs
- update canonical docs, generated workflow prose, and diagrams/BPMN when the new flow is stable

### Phase 4 - Provider Automation

- add optional GitHub adapter
- support PR detection and creation automatically when environment allows it

## Test Matrix

Minimum fixture coverage should include:

- session closed, branch dirty -> block
- session closed, branch ahead of upstream -> block
- session closed, pushed, no PR state -> `open_pr_allowed`
- session with `pr_status=open` -> resume existing session branch
- session with `pr_status=merged`, sync required -> block until sync
- session with `pr_status=merged`, sync done -> allow next session
- session with `pr_status=closed_not_merged` -> explicit decision required

Documentation coverage should include:

- canonical spec wording for PR orchestration state
- generated workflow summary wording after `close-session`
- runtime-session flow diagram update
- BPMN update if the executable relay path changes materially

## Risks

- adding PR state without a dedicated parser will create a second continuity model
- mixing Git-only and GitHub-only concerns too early will overcomplicate phase 1
- storing provider-specific metadata directly in `CURRENT-STATE.md` would make summaries noisy
- auto-creation of PRs before the manual-assisted path is stable would increase failure modes
- runtime changes without diagram/BPMN refresh would recreate the same documentation drift we are trying to remove

## Open Questions

- should `pr-orchestrate` own post-merge sync, or should sync become a second dedicated skill later?
- should `close-session` merely recommend `pr-orchestrate`, or should the coordinator dispatch plan surface it automatically?
- should phase 1 allow recording PR state manually in the session file only, or also via a small runtime command?
- should `cycle-create` on a session branch with `pr_status=open` always block, or only warn during the first release?
