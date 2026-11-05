---
name: aidn-pr-orchestrate
description: "AIDN project workflow. Orchestrate the session PR lifecycle after aidn-close-session: push, open PR, track review, and enforce post-merge sync. Use only in an explicitly activated AIDN project."
metadata:
  aidn-skill-id: pr-orchestrate
---

# PR Orchestrate Skill

## STANDARD instance entry

At a top-level user invocation with an explicitly selected
`standard-workflow-execution.v1` configuration, use
`aidn runtime workflow-run --target . --configuration <file> --json` to observe
that same durable instance. Save its returned `preview` object. Apply only an
explicitly authorized exact action with `--action-file <file> --execute
--expect-plan <sha256>`. A human wait requires a fresh authenticated source;
use `--decision-source <ref>` to prepare its delivery. Preserve typed wait,
refusal, defer, cancellation and reconciliation outcomes. Continue through this
entry instead of independently executing the manual orchestration below.

This applies only to the top-level entry. A host-assigned Native activity or
leaf completion hook must never recursively invoke `workflow-run`. Keep
`codex workflow-step` in its admission/context/coordination role. Missing
authority, configuration or capabilities do not authorize a manual fallback.
The existing steps below remain the explicit compatibility route when STANDARD
has not been selected. Source scaffolds require separate installed qualification.

## Project Activation

Before loading workflow context or running the steps below, run `aidn runtime pre-write-admit --target . --skill pr-orchestrate --json`. Continue only when `activation.active` is `true` and `admission_status` is `admitted` or `admitted_with_warnings`.

If activation is absent, false or unknown, stop this skill without loading workflow state or creating artifacts. Report the activation reason; `aidn bootstrap --diagnose --json` is the explicit read-only diagnostic. Do not install or activate the project automatically. A blocked admission allows only the read-only diagnostics it recommends, within the user's scope.

## Goal
Drive the session branch through the explicit PR lifecycle without skipping push, review, or post-merge reconciliation.

## Hygiene Guardrails
- Use this skill after `aidn-close-session` when the session is review-ready.
- Treat session PR state as durable workflow state and keep it recorded in the session artifact.
- In dual/db-only or configured PostgreSQL mode, read and update that artifact through the canonical backend; a local Markdown projection may be stale.
- The PR hook diagnoses the next action without automatically importing projections. Record lifecycle changes explicitly; do not materialize stale files to influence admission.
- Do not auto-merge or auto-close a PR in phase 1 unless the user explicitly asks for it and provider support exists.
- Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.

## Steps

1) Read:
- latest closed session artifact
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter

2) Prepare local delivery and confirm session PR metadata:

If still on a retained cycle branch, prepare local delivery explicitly before PR
admission. A confirmed session closure and delivery checkpoint are prerequisites,
not permission to integrate. Require a separate human `integrate-to-session`
decision bound to the canonical CLOSED owner, retained DONE cycle, exact source
and session refs/tips, index, filters, worktree registrations and checkpoint.
Execute only the reviewed local fast-forward plan with a fresh grant. Refusal,
deferral, cancellation and uncertain effects remain distinct; do not repeat an
uncertain transaction. Re-anchor the branch context before PR admission. This
preparation does not authorize push, PR creation, merge or post-merge sync.

- `pr_status`
- `pr_url`
- `pr_number`
- `pr_base_branch`
- `pr_head_branch`
- `pr_review_status`
- `post_merge_sync_status`

3) Run the runtime admission:
- `npx aidn codex run-json-hook --skill pr-orchestrate --mode <THINKING|EXPLORING|COMMITTING> --target . --json`
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill pr-orchestrate --project-runtime-state --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when it has just been refreshed by hydration.
- in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).
- in files, this hook remains non-blocking by default.
- if `repair_layer_status` is `warn` or `block`, run `npx aidn runtime project-runtime-state --target . --json` before continuing.
- Repair mutations require a reviewed source-maintenance procedure; repair-layer tools are internal and have no public runtime alias.
- if blocking findings remain after diagnosis, STOP the skill and request user arbitration.

4) Follow the returned next action:
- `push_session_branch`: push the session branch first.
- `open_pull_request`: open or recover the PR against the source branch.
- `await_review`: continue review triage and update PR state only.
- `merge_pull_request`: merge only after explicit approval and evidence.
- `post_merge_sync_required`: reconcile the source branch locally before any new session or cycle creation.

For an authenticated valid finding requiring product changes, explicitly reopen
the same CLOSED owning session under the reviewed correction plan. Preserve the
complete prior closure report and completion proof as historical records; reset
closure/snapshot gates and keep active_cycle none. Reopening grants no product
write. Create a new cycle through its ordinary admission and continuity choice,
freeze its plan, satisfy readiness and enter IMPLEMENTING on its cycle branch
before product edits. Run impacted validations for the new HEAD and close/deliver
again through a fresh causal successor. Replies, resolutions and merge consent
remain separate; refresh review observations after provider changes.

5) Update `docs/audit/CURRENT-STATE.md` when present:
- `updated_at`
- `active_session`
- `session_branch`
- `session_pr_status`
- `session_pr_review_status`
- `post_merge_sync_status`
- next actions
- `repair_layer_status` and `repair_primary_reason` when the latest hydrated/runtime digest exposes them

6) Update the session artifact when state changes:
- PR link/number
- review state
- merge result
- post-merge sync completion basis

This skill is orchestration-first.
It exists to stop accidental `new session` or `new cycle` flows while the previous session branch is still waiting for push, PR, review, merge, or local sync.
