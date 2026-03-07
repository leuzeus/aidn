---
name: start-session
description: Create or resume a session file from template, detect branch context, and prepare cycle-aware working context.
---

# Start Session Skill

## Goal
Initialize or resume a session with correct mode, branch awareness, and cycle mapping.

## Hygiene Guardrails
- Mutate only the active session file in this skill.
- Do not modify baseline files from this skill.
- Apply write-on-change behavior (do not rewrite unchanged content).
- If multiple open sessions match the current branch, STOP and ask user which session to resume.

## Steps

1) Run context-reload logic (light version):
- Read snapshot
- Read baseline
- Detect current branch
- Detect active cycle (if any)
- Classify branch kind: `session` | `cycle` | `intermediate`
- Detect cycles reported from previous session close report (if any)

2) Create or update session file:
- If user explicitly opens a new session, create `docs/audit/sessions/SXXX.md`.
- If current work belongs to an existing open session, update that session file (do not create a new SXXX).
- If a previous session closed with reported cycles, ask whether to import them into this session.

Use TEMPLATE_SESSION_SXXX.md structure.

3) Fill:
- Auto-detected mode
- Confidence + reasons
- Current branch
- Branch kind
- Baseline version
- Active cycles
- Snapshot reviewed: yes
- Session cycle tracking fields:
  - attached cycles
  - reported_from_previous_session
  - carry_over_pending

4) Apply Branch/Cycle Requirement Auto-check:

If mode=COMMITTING:
- If branch kind is `cycle`:
  - Require a cycle + status.md
  - Require `status.md.branch_name == current branch`
  - Run Core DoR check from status.md/brief.md/plan.md:
    - objective + scope/non-scope present
    - first implementation step defined
    - constraints/risks acknowledged
- If branch kind is `intermediate`:
  - Require exactly one parent cycle owner
  - Require explicit link to parent cycle in session file (`integration_target_cycle`)
  - Require final integration path `intermediate -> cycle -> session`
- If branch kind is `session`:
  - Allow only integration/handover/PR orchestration by default
  - Require explicit `integration_target_cycle` when integrating a cycle into session
  - If production implementation is needed, recommend creating/switching to a cycle branch
- If DoR or mapping is not satisfied:
  - do not proceed as COMMITTING
  - recommend smallest actions to reach READY
  - suggest THINKING or EXPLORING until fixed

5) Carry-over handling at session start:
- For each reported cycle from previous session, require one decision:
  - integrate now (resume and integrate cycle into current session when ready)
  - import now (attach to current session)
  - defer (keep reported, no implementation in current session)
  - drop (convert to `NO_GO`/`DROPPED` with rationale)
- Ask these decisions explicitly (interactive question or equivalent user confirmation).
- Update session close/open-loop notes accordingly.

If mode=EXPLORING and:
- >2 files touched OR
- >30 min code work expected
→ Recommend converting to SPIKE cycle + dedicated branch

6) Suggest:
- Session Objective (1 sentence)
- Time Budget
- Planned Outputs

7) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill start-session --mode <THINKING|EXPLORING|COMMITTING> --target . --json`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill start-session --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
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
- in `files`, strict mode remains optional by repository policy.

Do not modify baseline.
Only create/update session file.

