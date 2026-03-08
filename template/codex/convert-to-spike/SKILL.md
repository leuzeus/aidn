---
name: convert-to-spike
description: Convert an ongoing EXPLORING effort into an official SPIKE cycle + dedicated branch recommendation.
---

# Convert EXPLORING → SPIKE Skill

## Goal
When exploration becomes non-trivial, formalize it with minimal friction.

## Hygiene Guardrails
- Keep conversion lightweight: create/attach spike artifacts, do not mutate baseline.
- Do not auto-close existing cycles as part of conversion.
- Prefer recommendation over forced branch operations when user intent is not explicit.

## Trigger rule (use automatically if possible)
If mode=EXPLORING and:
- code changes > ~30 minutes OR touches >2 files
→ recommend converting to SPIKE cycle + dedicated branch

## Steps

1) Identify current exploration topic (1 sentence).
2) Create a new SPIKE cycle via cycle-create:
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

6) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill convert-to-spike --mode EXPLORING --target . --json`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill convert-to-spike --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
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
- if `repair_layer_status` is `warn` or `block`, run `npx aidn runtime repair-layer-triage --target . --json` before continuing.
- if triage exposes a safe-only autofix candidate, you MAY run `npx aidn runtime repair-layer-autofix --target . --apply --json`.
- if blocking findings remain after triage/autofix, STOP the skill and request user arbitration.

Output:
- New cycle path
- Branch recommendation
- Next steps (validate hypotheses, document decision)

