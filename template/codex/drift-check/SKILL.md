---
name: drift-check
description: Detect scope drift (A/B/D), generate a Recovery plan, and optionally create a CR + parking-lot entries.
---

# Drift Check Skill

## Goal
Detect when exploration/implementation drifted and recover quickly.

## Hygiene Guardrails
- Keep this skill diagnostic-first: detect and report before mutating artifacts.
- Do not auto-create CR/parking entries without explicit user confirmation.
- Do not edit `docs/audit/SPEC.md` or baseline files from this skill.
- When drift is severe/structural, STOP and request arbitration before continuing implementation.

## Steps

1) Read:
- Current session file (latest docs/audit/sessions/SXXX.md)
- Active cycle status.md (if any)
- Snapshot

2) Ask/Infer:
- What was the original objective?
- What is the current objective now?

3) Drift signals:
- objective changed
- scope expanded
- unexpected modules touched
- architectural refactor emerging
- cannot explain in 1 sentence

4) Produce a Drift Report:
- Drift level: none | mild | severe
- What changed (bullets)
- Keep vs discard
- Split recommendation:
  - new cycle? (feature/spike/structural)
  - new branch?
  - CR required?

5) If objective changed:
- Recommend creating CR entry in cycle change-requests.md
- Impact classification: low | medium | high
- If medium/high → recommend new cycle

6) If idea is valuable but non-essential:
- Add IDEA-xxx suggestion for parking-lot.md

7) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill drift-check --mode COMMITTING --target . --json`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill drift-check --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- use L2 signals as objective drift evidence:
  - `objective_delta`
  - `scope_growth`
  - `cross_domain_touch`
  - `time_since_last_drift_check`
  - `uncertain_intent`
- in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).
- in files, this hook remains non-blocking by default.
- if `repair_layer_status` is `warn` or `block`, run `npx aidn runtime repair-layer-triage --target . --json` before relying on db-backed continuity or artifact links.

Output:
- Recovery actions (2–5 steps)
- Clear Next Entry Point

