---
name: pr-orchestrate
description: Orchestrate the session PR lifecycle after close-session: push, open PR, track review, and enforce post-merge sync.
---

# PR Orchestrate Skill

## Goal
Drive the session branch through the explicit PR lifecycle without skipping push, review, or post-merge reconciliation.

## Hygiene Guardrails
- Use this skill after `close-session` when the session is review-ready.
- Treat session PR state as durable workflow state and keep it recorded in the session artifact.
- Do not auto-merge or auto-close a PR in phase 1 unless the user explicitly asks for it and provider support exists.
- Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.

## Steps

1) Read:
- latest closed session artifact
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter

2) Confirm session PR metadata:
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
- if `repair_layer_status` is `warn` or `block`, run `npx aidn runtime repair-layer-triage --target . --json` before continuing.
- if triage exposes a safe-only autofix candidate, you MAY run `npx aidn runtime repair-layer-autofix --target . --apply --json`.
- if blocking findings remain after triage/autofix, STOP the skill and request user arbitration.

4) Follow the returned next action:
- `push_session_branch`: push the session branch first.
- `open_pull_request`: open or recover the PR against the source branch.
- `await_review`: continue review triage and update PR state only.
- `merge_pull_request`: merge only after explicit approval and evidence.
- `post_merge_sync_required`: reconcile the source branch locally before any new session or cycle creation.

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
