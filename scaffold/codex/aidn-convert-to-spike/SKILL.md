---
name: aidn-convert-to-spike
description: "AIDN project workflow. Convert an ongoing EXPLORING effort into an official SPIKE cycle + dedicated branch recommendation. Use only in an explicitly activated AIDN project."
metadata:
  aidn-skill-id: convert-to-spike
---

# Convert EXPLORING → SPIKE Skill

## Project Activation

Before loading workflow context or running the steps below, run `aidn runtime pre-write-admit --target . --skill convert-to-spike --json`. Continue only when `activation.active` is `true` and `admission_status` is `admitted` or `admitted_with_warnings`.

If activation is absent, false or unknown, stop this skill without loading workflow state or creating artifacts. Report the activation reason; `aidn bootstrap --diagnose --json` is the explicit read-only diagnostic. Do not install or activate the project automatically. A blocked admission allows only the read-only diagnostics it recommends, within the user's scope.

## Goal
When exploration becomes non-trivial, formalize it with minimal friction.

## Hygiene Guardrails
- Keep conversion lightweight: create/attach spike artifacts, do not mutate baseline.
- Do not auto-close existing cycles as part of conversion.
- Prefer recommendation over forced branch operations when user intent is not explicit.
- Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.

## Pre-Write Admission
Before the first durable write in this skill, run:
- `npx aidn runtime pre-write-admit --target . --skill convert-to-spike --json`
- If `admission_status` is `blocked`, STOP and continue with read-only re-anchor or repair steps only.

## Trigger rule (use automatically if possible)
If mode=EXPLORING and:
- code changes > ~30 minutes OR touches >2 files
→ recommend converting to SPIKE cycle + dedicated branch

## Steps

1) Identify current exploration topic (1 sentence).
2) Create a new SPIKE cycle via aidn-cycle-create:
- brief.md includes learning goal + timebox
- decisions.md must capture outcomes
3) Recommend branch naming:
- spike/CXXX-<topic>
4) Update current session:
- mark mode still EXPLORING or switch to COMMITTING? (usually keep EXPLORING)
- reference the new cycle id
5) Update snapshot:
- add spike as active
- next entry point points to spike status.md

6) Update `docs/audit/CURRENT-STATE.md` when present:
- set `active_cycle` to the new spike when it becomes the primary focus
- keep `mode` aligned with the chosen session mode after conversion
- summarize the new exploration goal in `next_actions`
- avoid duplicating full spike plan content; keep only the first actionable step
- keep `repair_layer_status` and `repair_primary_reason` aligned with the latest hydrated/runtime digest when repair context is relevant

7) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill convert-to-spike --mode EXPLORING --target . --json`
- the runtime `aidn-convert-to-spike` hook applies spike-continuity admission before delegating to generic checkpoint/index/repair behavior
- it reuses `aidn-cycle-create` continuity logic with the `EXPLORING` mode gate, so strict chain may still stop and require explicit override/choice
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill convert-to-spike --project-runtime-state --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when it has just been refreshed by hydration.
- use this output to capture:
  - reload/gate outcome around spike conversion
  - index update summary for newly created spike artifacts
- in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).
- in files, this hook remains non-blocking by default.
- in dual/db-only, prefer `--fail-on-repair-block` on the JSON hook invocation and STOP on `repair_layer_status=block`.
- DB runtime sync (mandatory in dual/db-only; optional in files):
- run `npx aidn runtime sync-db-first-selective --target . --json` (falls back to full sync when needed).
- for DB-first write-through on a specific artifact, run `npx aidn runtime db-first-artifact --target . --path <relative-audit-path> --source-file <file> --json`.
- in dual/db-only, this step is mandatory and blocking on failure.
- in files, this step is optional unless repository policy requires DB parity.
- if `repair_layer_status` is `warn` or `block`, run `npx aidn runtime project-runtime-state --target . --json` before continuing.
- Repair mutations require a reviewed source-maintenance procedure; repair-layer tools are internal and have no public runtime alias.
- if blocking findings remain after diagnosis, STOP the skill and request user arbitration.

Output:
- New cycle path
- Branch recommendation
- Next steps (validate hypotheses, document decision)

