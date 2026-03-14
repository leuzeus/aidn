---
name: cycle-create
description: Create a new cycle folder (CXXX-[type]) with required artifacts, initialize status.md with branch_name and guardrails fields.
---

# Cycle Create Skill

## Goal
Create a clean cycle scaffold fast and correctly.

## Hygiene Guardrails
- Never overwrite an existing cycle folder without explicit user confirmation.
- If target cycle path already exists, STOP and ask whether to reuse/rename.
- Create files from templates and avoid rewriting unchanged files.
- Keep branch naming canonical: `<cycle-type>/CXXX-<short-title>`.
- Do not modify baseline files from this skill.
- Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.

## Pre-Write Admission
Before the first durable write in this skill, run:
- `npx aidn runtime pre-write-admit --target . --skill cycle-create --json`
- If `admission_status` is `blocked`, STOP and continue with read-only re-anchor or repair steps only.

## Inputs (ask user if missing)
- Cycle ID: CXXX
- Type: feature | spike | refactor | structural | migration | security | perf | integration | compat | corrective | hotfix
- Short title (for folder suffix)
- Current session branch name (if accessible)
- If a promoted shared backlog is active: explicit execution scope selection for cycle creation (`backlog_selected_execution_scope: new_cycle`)

## Steps

0) Run continuity gate before creating files/branch:
- Detect current mode: THINKING | EXPLORING | COMMITTING.
- Detect current session branch (if any).
- Detect latest active cycle branch in same session (`OPEN | IMPLEMENTING | VERIFYING`) using `status.md.last updated` + branch mapping.
- Compare requested source branch with:
  - latest active cycle branch
  - current session branch tip

If requested source branch is neither:
- STOP and ask user to select exactly one continuity rule (selection list):
  1. `R1_STRICT_CHAIN (Recommended)` — start from latest active cycle branch
  2. `R2_SESSION_BASE_WITH_IMPORT` — start from session tip with explicit predecessor import
  3. `R3_EXCEPTION_OVERRIDE` — start from custom branch with explicit risk acceptance
- Do not create cycle artifacts until user selects.

Mode gate:
- COMMITTING: allow R1/R2 by default, R3 only with explicit user override.
- EXPLORING: allow R2/R3.
- THINKING: R3 only (no production implementation).
- If `active_backlog` is promoted, STOP unless shared planning arbitration is resolved and `backlog_selected_execution_scope=new_cycle`.
- To record that choice through workflow state, run `npx aidn runtime session-plan --target . --selected-execution-scope new_cycle --promote --json` before creating the cycle.

1) Create folder:
docs/audit/cycles/CXXX-[type]-<short-title>/

2) Create minimal required files using templates:
- status.md (required)
- brief.md
- plan.md
- hypotheses.md
- audit-spec.md
- traceability.md
- decisions.md
- change-requests.md
- (optional) gap-report.md (only when needed)

3) In status.md, set:
- state: OPEN
- branch_name: `<cycle-type>/CXXX-<short-title>`
- session_owner: `<active session id>` (if available)
- outcome: ACTIVE
- reported_to_session: `none`
- continuity_rule: `R1_STRICT_CHAIN | R2_SESSION_BASE_WITH_IMPORT | R3_EXCEPTION_OVERRIDE`
- continuity_base_branch: `<branch actually used to create this cycle>`
- continuity_latest_cycle_branch: `<detected latest active cycle branch | none>`
- continuity_decision_by: `<user | agent>`
- continuity_override_reason: `<required when rule=R3_EXCEPTION_OVERRIDE>`
- dor_state: NOT_READY
- scope_frozen: false
- next step: write plan + audit spec (or spike goal)

4) Branch source rule:
- Apply selected continuity rule:
  - R1: create cycle branch from latest active cycle branch.
  - R2: create cycle branch from active session branch tip + record predecessor import target in `status.md`.
  - R3: create cycle branch from explicit custom base + require risk rationale in `change-requests.md`.
- Do not use the session branch as `status.md.branch_name`.

5) If type=spike:
- mark in brief.md: learning goal + timebox
- add rule: “code may be throwaway”

6) Update snapshot:
- Add the cycle as active
- Set next entry point to status.md

7) Update `docs/audit/CURRENT-STATE.md`:
- `updated_at`
- `active_cycle`
- `cycle_branch`
- `branch_kind`
- `dor_state`
- `first_plan_step` if already known
- next actions reflecting cycle creation

8) Mark readying actions:
- fill DoR checklist in status.md
- set `dor_state: READY` only when core gate is satisfied

9) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill cycle-create --mode COMMITTING --target . --json`
- the runtime `cycle-create` hook applies continuity admission before delegating to generic checkpoint/index/repair behavior
- expect machine-visible continuity outcomes such as `proceed_r1_strict_chain`, `proceed_r2_session_base_with_import`, or `stop_choose_continuity_rule`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill cycle-create --project-runtime-state --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when it has just been refreshed by hydration.
- use this output to capture:
  - reload decision and gating outcome
  - index/update summary after cycle scaffold changes
- in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).
- in files, this hook remains non-blocking by default.
- in dual/db-only, prefer `--fail-on-repair-block` on the JSON hook invocation and STOP on `repair_layer_status=block`.
- DB runtime sync (mandatory in dual/db-only; optional in files):
- run `npx aidn runtime sync-db-first-selective --target . --json` (falls back to full sync when needed).
- for DB-first write-through on a specific artifact, run `npx aidn runtime db-first-artifact --target . --path <relative-audit-path> --source-file <file> --json`.
- in dual/db-only, this step is mandatory and blocking on failure.
- in files, this step is optional unless repository policy requires DB parity.
- if `repair_layer_status` is `warn` or `block`, run `npx aidn runtime repair-layer-triage --target . --json` before continuing.
- if triage exposes a safe-only autofix candidate, you MAY run `npx aidn runtime repair-layer-autofix --target . --apply --json`.
- if blocking findings remain after triage/autofix, STOP the skill and request user arbitration.

Output:
- Cycle path created
- Next best action list (2-3 items)

