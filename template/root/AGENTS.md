<!-- CODEX-AUDIT-WORKFLOW START -->
# AGENTS.md — Execution Contract (v8)

## Purpose

This installed repository uses a **Session-Based, Skill-Driven, Audit-Driven workflow**.

This file is a **startup contract**, not the full live workflow engine.

Agents MUST:
- treat `docs/audit/*` and hydrated runtime context as the live workflow state
- treat workflow skills and runtime hooks as the mutating enforcement path
- use this file for stable startup rules, precedence, and write-stop conditions

## Instruction Layering

Codex may also load guidance outside this file:

- global guidance from `~/.codex/AGENTS.md`
- global temporary override from `~/.codex/AGENTS.override.md`
- nested project guidance from closer `AGENTS.md` or `AGENTS.override.md`

This root file defines the default repository contract.
More specific nested instruction files override broader rules and should remain exceptional.

## Required Skills (Contract)

This workflow assumes the following skills are available:

- context-reload
- start-session
- close-session
- branch-cycle-audit
- drift-check
- handoff-close
- cycle-create
- cycle-close
- promote-baseline
- convert-to-spike
- requirements-delta

If a required skill is unavailable, the agent MUST:
- report the missing skill
- STOP the session

## Source Of Truth

- Workflow specification (canonical): `docs/audit/SPEC.md`
- Workflow adapter (project-local): `docs/audit/WORKFLOW.md`
- Workflow kernel (minimal re-anchor): `docs/audit/WORKFLOW-KERNEL.md`
- Current state summary: `docs/audit/CURRENT-STATE.md`
- Runtime digest: `docs/audit/RUNTIME-STATE.md`
- Multi-agent handoff packet: `docs/audit/HANDOFF-PACKET.md`
- Integration risk digest: `docs/audit/INTEGRATION-RISK.md`
- Agent adapter contract: `docs/audit/AGENT-ADAPTERS.md`
- Fast snapshot: `docs/audit/snapshots/context-snapshot.md`
- Ideas parking: `docs/audit/parking-lot.md`

> Precedence inside workflow rules: `docs/audit/SPEC.md` > `docs/audit/WORKFLOW.md` > `AGENTS.md`.

## Session Start Responsibilities

At the beginning of a session, the agent MUST:

1. Run skill: `context-reload`
2. Re-anchor in this order:
   - `docs/audit/CURRENT-STATE.md`
   - `docs/audit/WORKFLOW-KERNEL.md`
   - `docs/audit/WORKFLOW_SUMMARY.md`
   - `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter
   - active cycle `status.md` and active session file when relevant
3. Confirm `docs/audit/SPEC.md` and `docs/audit/WORKFLOW.md` are loaded when canonical rule precision is needed
4. Run skill: `start-session`
5. Explicitly acknowledge the session mode: `THINKING | EXPLORING | COMMITTING`

`start-session` begins with blocking admission:
- resume the current session/cycle when continuity already exists
- stop on non-compliant branches or unresolved session-base continuity
- stop and request user choice when several open cycles compete
- only allow new session creation after admission returns `create_session_allowed`

If `docs/audit/SPEC.md` is missing, the agent MUST:
- STOP
- request workflow reinstall or repair before continuing

If mode is `COMMITTING`, the agent MUST:
- run skill: `branch-cycle-audit`
- stop if branch ownership is ambiguous or unmapped
- rely on the same branch/session/cycle mapping layer as `start-session`, not on generic gating alone

## Pre-Write Gate (MANDATORY)

Durable writes include:

- `apply_patch`
- direct file edits
- generated file creation
- mutating scripts

Before any durable write, the agent MUST restate:

- current mode
- current branch kind
- active session (`SXXX | none | unknown`)
- active cycle (`CXXX | none | unknown`) when relevant
- `dor_state` when `COMMITTING`
- first implementation step from `plan.md` when `COMMITTING`
- workflow artifacts verified
- missing or uncertain context, if any

Before any durable write, the agent MUST also:

- use workflow skills as the normal state-changing mechanism
- prefer the runtime hook path before mutating workflow work
- stop when required context is missing, ambiguous, stale, or contradictory

If runtime state mode is `dual` or `db-only`, the agent MUST:

- run workflow hooks in strict JSON mode (`npx aidn codex run-json-hook ... --strict --fail-on-repair-block --json`)
- hydrate db-backed context after each workflow skill (`npx aidn codex hydrate-context --target . --skill <skill> --project-runtime-state --json`)
- read hydrated runtime context before durable write
- check `repair_layer_status`
- check `repair_layer_advice`
- stop on blocking repair findings

If one required field is missing, ambiguous, or contradictory, the agent MUST:

- stop durable write
- continue with read-only context reload only
- use `docs/audit/REANCHOR_PROMPT.md` for the restart protocol when context was partially lost
- report the smallest compliant next step

Special note for recent Codex Windows app flows:

- treat `apply_patch` as a durable write operation, not as a shortcut around workflow checks
- do not use `apply_patch` before the pre-write restatement is complete

## COMMITTING Hard Stops

If mode is `COMMITTING`, the agent MUST ensure:

- an active cycle exists
- branch mapping is valid
- DoR core gate is satisfied, or an explicit override is documented
- no plan, no durable write: the first implementation step must be explicit before writing

The agent MUST STOP and request user decision when:

- structural or architectural changes are detected
- DB schema or security impact is detected
- medium or high impact change request is identified
- conflicting requirements exist
- multiple competing strategies require arbitration

If `status.md` indicates `state=IMPLEMENTING`, scope is frozen.
New objectives belong in a change request or a new cycle, not in an untracked expansion of the current cycle.

## Runtime And Handoff Expectations

For `dual` / `db-only` projects, the runtime chain is authoritative for mutating enforcement:

- `npx aidn codex run-json-hook ... --strict --json`
- `npx aidn codex hydrate-context --target . --skill <skill> --project-runtime-state --json`
- `npx aidn runtime sync-db-first-selective --target . --json` for mutating skills
- `npx aidn runtime repair-layer-triage --target . --json` when `repair_layer_status` is `warn` or `block`
- `npx aidn runtime repair-layer-autofix --target . --apply --json` only for safe-only autofix cases

Runtime hooks are infrastructure:
- `start-session` admission decides `resume | choose | create | stop`, then delegates to generic `session-start` runtime work only when admitted
- `branch-cycle-audit` admission validates owned branch mapping, then delegates to generic gating/perf evaluation only when mapping is valid
- `close-session` admission resolves open-cycle close decisions before generic `session-close` runtime work
- `cycle-create` admission resolves continuity plus mode-gate compatibility before generic checkpoint work
- `requirements-delta` admission stops medium/high-impact ownership ambiguity before artifact mutation
- `promote-baseline` admission blocks promotion when target cycle selection, traceability, or open-gap validation is incomplete
- `convert-to-spike` admission reuses cycle continuity logic in `EXPLORING` mode before spike creation work
- `handoff-close` uses generic checkpoint evaluation, but the runtime hook now exposes the actual blocking result instead of a masked success wrapper
- `drift-check` continues to use generic gating as the drift source of truth; treat hook `stop|warn|ok` as authoritative

When work is likely to continue in another agent, the agent SHOULD:

- run skill: `handoff-close`
- refresh `docs/audit/CURRENT-STATE.md`
- refresh `docs/audit/RUNTIME-STATE.md` when in `dual` / `db-only`
- project `docs/audit/HANDOFF-PACKET.md`

The receiving agent MAY start from `docs/audit/HANDOFF-PACKET.md`, but MUST still:

- reload the referenced artifacts
- complete the mandatory pre-write gate
- stop if handoff state is blocked or stale

## Scope

These instructions apply to the entire repository unless a more specific `AGENTS.md` or `AGENTS.override.md` is added within a subdirectory.

Agents MUST:
- invoke skills explicitly when required by `docs/audit/SPEC.md` and `docs/audit/WORKFLOW.md`
- avoid inventing workflow steps
- avoid bypassing audit artifacts
- report uncertainty rather than guessing
- keep documentation and audit artifacts up to date

Failure to comply with `docs/audit/SPEC.md` invalidates the session.
<!-- CODEX-AUDIT-WORKFLOW END -->
