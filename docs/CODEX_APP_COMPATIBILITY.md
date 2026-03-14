# Codex App Compatibility Notes

## Purpose

This note documents a recurring integration issue observed with conservative Codex desktop/app or online instruction stacks.
It is intended to help other implementations preserve aid'n workflow behavior when the host agent adds extra safety guidance around writes.

## Problem Pattern

Some Codex app environments apply a heuristic like:

- analysis-only request => stay read-only
- read-only => do not run mutating skills

That heuristic is too coarse for aid'n.

In aid'n, several workflow skills are admission-first:
- `start-session`
- `close-session`
- `cycle-create`
- `requirements-delta`
- `promote-baseline`
- `convert-to-spike`

These skills may mutate later, but their first responsibility is to produce a blocking workflow decision.

## Concrete Failure Mode

Observed bad behavior:
- the agent performs an informal re-anchor
- it skips `start-session` because it classifies the skill as mutative
- it then continues analysis without a formal workflow admission result

Why this breaks aid'n:
- branch conformity may never be checked against the configured source branch
- open session/cycle continuity may never be resolved
- required user choices may never be surfaced
- the agent can drift into "analysis outside workflow" without explicit override

## Required Integration Rule

For aid'n integrations, distinguish:

- admission phase
- durable write phase

Rule:
- read-only intent may block the durable write phase
- read-only intent must not skip the mandatory admission phase

For `start-session`, the integration must still run the admission path and respect its result:
- `resume_current_session`
- `resume_current_cycle`
- `choose_cycle`
- `create_session_allowed`
- `blocked_*`

If admission returns `stop`, the integration should:
- report the blocking reason
- surface the required user choice
- remain read-only unless the user authorizes the next step

## Recommended Host Contract

If the host agent uses a write-safety model, encode this distinction explicitly:

- "Potentially mutating skill" does not mean "forbidden to execute"
- "Potentially mutating skill" means "its durable-write substeps require stronger checks"
- admission-first workflow skills are allowed in read-only analysis because they are the mechanism that decides whether workflow continuation is compliant

## Recommended Command Path

For Codex app/online integrations, prefer the runtime JSON path:

- `npx aidn codex run-json-hook --skill start-session --mode <THINKING|EXPLORING|COMMITTING> --target . --strict --json`

Then:
- inspect `action`
- inspect `result`
- inspect `reason_code`
- inspect `required_user_choice`

Do not infer workflow permission from user intent alone when the admission engine can answer it directly.

## Generic Guidance For Other Workflow Engines

This issue is not specific to aid'n.
Any workflow system with "admission-first, mutation-later" commands should document:

- which commands have a non-mutating admission phase
- which parts are safe in read-only analysis
- which parts require explicit mutation approval
- how host-level instruction layering can accidentally suppress mandatory workflow admission

If this distinction is omitted, conservative AI hosts will often skip the exact command that was meant to enforce workflow safety.
