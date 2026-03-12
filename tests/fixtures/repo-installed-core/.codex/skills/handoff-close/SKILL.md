---
name: handoff-close
description: Prepare an explicit relay for another agent by refreshing current state, runtime digest, and handoff packet with a concrete next-agent goal.
---

# Handoff Close Skill

## Goal
Prepare a deterministic relay packet before pausing when another agent is expected to continue.

## Hygiene Guardrails
- Use this skill only when another agent is likely to continue the same line of work.
- Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.
- Do not use this skill to bypass normal session close, cycle close, or branch-cycle audit rules.
- Do not leave `next_agent_goal` implicit. State it explicitly.

## Pre-Write Admission
Before the first durable write in this skill, run:
- `npx aidn runtime pre-write-admit --target . --skill handoff-close --json`
- If `admission_status` is `blocked`, STOP and continue with read-only re-anchor or repair steps only.

## Steps

1) Read:
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md` when present
- active session file when present
- active cycle `status.md` when present

2) Confirm the relay intent:
- next agent role: `coordinator | executor | auditor | repair`
- next agent action: `reanchor | implement | audit | analyze | repair | relay | close | coordinate`
- explicit next-agent goal
- optional handoff note when a short warning or nuance is needed

3) Update `docs/audit/CURRENT-STATE.md` when present:
- `updated_at`
- active session / cycle summary
- top open items
- next actions
- blocking findings when known

4) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill handoff-close --mode <THINKING|EXPLORING|COMMITTING> --target . --json`
- the runtime `handoff-close` hook exposes the underlying checkpoint result directly; blocked reload/gate states are surfaced as blocking hook results
- handoff-specific packet validation remains enforced by `project-handoff-packet` and `handoff-admit`, not by the perf hook alone
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill handoff-close --project-runtime-state --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when it has just been refreshed by hydration.
- in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).
- in files, this hook remains non-blocking by default.
- DB runtime sync (mandatory in dual/db-only; optional in files):
- run `npx aidn runtime sync-db-first-selective --target . --json` (falls back to full sync when needed).
- for DB-first write-through on a specific artifact, run `npx aidn runtime db-first-artifact --target . --path <relative-audit-path> --source-file <file> --json`.
- in dual/db-only, this step is mandatory and blocking on failure.
- in files, this step is optional unless repository policy requires DB parity.
- if `repair_layer_status` is `warn` or `block`, run `npx aidn runtime repair-layer-triage --target . --json` before continuing.
- if triage exposes a safe-only autofix candidate, you MAY run `npx aidn runtime repair-layer-autofix --target . --apply --json`.
- if blocking findings remain after triage/autofix, STOP the skill and request user arbitration.
- in files, strict mode remains optional by repository policy.
- in dual/db-only, prefer `--fail-on-repair-block` on the JSON hook invocation and STOP on `repair_layer_status=block`.

5) Project the relay packet explicitly:
- run `npx aidn runtime project-handoff-packet --target . --next-agent-goal "<explicit next-agent goal>" --handoff-note "<optional note>" --json`
- if hydration already refreshed `docs/audit/RUNTIME-STATE.md`, keep the relay aligned with that digest
- ensure `docs/audit/HANDOFF-PACKET.md` contains:
  - `handoff_status`
  - `recommended_next_agent_role`
  - `next_agent_goal`
  - prioritized artifacts

6) Before another agent resumes, recommend:
- `npx aidn runtime handoff-admit --target . --json`

## Output

State explicitly:
- next agent role
- next agent action
- next agent goal
- whether the relay is `ready`, `refresh_required`, or `blocked`
- which artifact the receiving agent must open first
