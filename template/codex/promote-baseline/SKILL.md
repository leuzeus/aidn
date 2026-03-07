---
name: promote-baseline
description: Promote a DONE cycle to baseline if conditions are met, update baseline current/history + snapshot + index.
---

# Promote Baseline Skill

## Goal
Safely “publish” completed work into baseline.

## Hygiene Guardrails
- Promote only explicitly selected cycle(s) in `DONE` state.
- Do not rewrite existing baseline history entries; append only.
- Update baseline current/history/snapshot coherently in one promotion pass.
- Apply write-on-change behavior to avoid unnecessary churn.

## Preconditions
- Cycle state is DONE (or VERIFYING completed)
- No unresolved GAPs (or explicitly justified)
- REQs have traceability or justification

## Steps

1) Ask for target cycle id/path (or infer from snapshot).
2) Validate:
- status.md state
- gap-report.md open items
- traceability completeness (or notes)
3) If validation fails:
- produce a checklist of what’s missing
- stop (do not promote)

4) If validation passes:
- Update docs/audit/baseline/current.md:
  - bump version (user chooses v0.2, v0.3…)
  - summary
  - included cycles
- Append to docs/audit/baseline/history.md
- Update docs/audit/index.md if needed
- Update snapshot:
  - remove cycle from active
  - set next entry point

5) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill promote-baseline --mode COMMITTING --target . --json`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill promote-baseline --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- use this output to capture:
  - baseline/snapshot-driven reload invalidation
  - gate/index consistency after promotion updates
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
- Promotion summary
- New baseline version
- Next entry point

