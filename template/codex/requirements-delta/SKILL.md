---
name: requirements-delta
description: Revise an old plan/spec safely by generating an addendum (delta), mapping old→new REQs, and opening CR or new cycle if structural changes are detected.
---

# Requirements Delta / Addendum Skill

## Goal
Handle “we revised an old plan” without losing traceability.

## Hygiene Guardrails
- Never silently rewrite/remove historical REQs.
- Keep old-to-new mapping explicit and durable in addendum + traceability.
- Do not modify baseline files from this skill.
- If impact is medium/high and branch ownership is unclear, STOP and request cycle/branch decision.
- If the delta changes active scope or next steps, keep `docs/audit/CURRENT-STATE.md` aligned at summary level.

## Pre-Write Admission
Before the first durable write in this skill, run:
- `npx aidn runtime pre-write-admit --target . --skill requirements-delta --json`
- If `admission_status` is `blocked`, STOP and continue with read-only re-anchor or repair steps only.

## When to use
- You revisit an older plan/audit-spec and realize structural changes are needed
- New constraints appear (API/DB/security/architecture)
- Requirements changed after exploration

## Steps

1) Identify scope of revision:
- What changed? (1–5 bullets)
- Why? (constraint, discovery, new info, stakeholder change)
- Impact: low | medium | high

2) Choose strategy (auto-recommend):
- Low impact: addenda inside same cycle (update audit-spec + traceability)
- Medium/high impact: create CR + recommend new cycle (often structural/refactor/spike)

3) Generate a Delta Document (addendum):
Create (or update) in the cycle folder:
- `addenda.md` (if not existing) or append a new section

Add a new section:
## ADDENDUM-XXX
- Date:
- Summary of change
- Motivation
- Impact level
- Breaking changes? yes/no
- New assumptions / removed assumptions
- Migration notes (if any)

4) Requirements mapping:
Create a small mapping table:
| Old REQ | Action | New REQ | Notes |
|---|---|---|---|
Actions:
- keep
- revise (create new REQ; deprecate old)
- split
- drop (with justification)

Rules:
- For significant revision: do NOT overwrite old REQ silently.
  - Mark old as deprecated
  - Create a new REQ with new id
  - Update traceability accordingly

5) Update traceability.md:
- Ensure each new/changed REQ has a TEST or justification.
- If tests not ready yet: add as planned, and add a validation plan note.

6) If code already diverged:
- Recommend drift-check
- If on a mixed branch: recommend convert-to-spike or new cycle + new branch.

7) If addendum/traceability updates change the active plan:
- update `docs/audit/CURRENT-STATE.md` when present
- refresh top open items, active hypotheses, and `next_actions`
- keep only the first actionable implementation or validation step in summary form

8) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill requirements-delta --mode COMMITTING --target . --json`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill requirements-delta --project-runtime-state --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when it has just been refreshed by hydration.
- use this output to capture:
  - scope drift signals after addendum/traceability updates
  - index/update summary for modified support artifacts
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
- Addendum content
- REQ mapping table
- Recommended next step (CR/new cycle/continue)

