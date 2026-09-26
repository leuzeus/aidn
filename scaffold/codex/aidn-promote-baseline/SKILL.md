---
name: aidn-promote-baseline
description: "AIDN project workflow. Promote a DONE cycle to baseline if conditions are met, update baseline current/history + snapshot + index. Use only in an explicitly activated AIDN project."
metadata:
  aidn-skill-id: promote-baseline
---

# Promote Baseline Skill

## Project Activation

Before loading workflow context or running the steps below, run `aidn runtime pre-write-admit --target . --skill promote-baseline --json`. Continue only when `activation.active` is `true` and `admission_status` is `admitted` or `admitted_with_warnings`.

If activation is absent, false or unknown, stop this skill without loading workflow state or creating artifacts. Report the activation reason; `aidn bootstrap --diagnose --json` is the explicit read-only diagnostic. Do not install or activate the project automatically. A blocked admission allows only the read-only diagnostics it recommends, within the user's scope.

## Goal
Safely “publish” completed work into baseline.

## Hygiene Guardrails
- Promote only explicitly selected cycle(s) in `DONE` state.
- Do not rewrite existing baseline history entries; append only.
- Update baseline current/history/snapshot coherently in one promotion pass.
- Apply write-on-change behavior to avoid unnecessary churn.
- Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.

## Pre-Write Admission
Before the first durable write in this skill, run:
- `npx aidn runtime pre-write-admit --target . --skill promote-baseline --json`
- If `admission_status` is `blocked`, STOP and continue with read-only re-anchor or repair steps only.
- If the block mentions `usage matrix`, treat it as a hard gate: update the target cycle `status.md` so `usage_matrix_state=VERIFIED` or `WAIVED` with an explicit rationale before trying to promote again.

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
- usage matrix completeness for `shared` or `high-risk` surfaces
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
- Update `docs/audit/CURRENT-STATE.md` when present:
- refresh baseline summary/version pointer
- remove promoted cycle from active focus
- update open gaps/CR summary if promotion resolves them
- set the next safe action after promotion
- keep `repair_layer_status` and `repair_primary_reason` aligned with the latest hydrated/runtime digest when repair context is relevant

5) Performance hook (mandatory in dual/db-only; optional in files):
- run `npx aidn codex run-json-hook --skill promote-baseline --mode COMMITTING --target . --json`
- the runtime `aidn-promote-baseline` hook validates target-cycle selection, open-gap closure, and traceability readiness before delegating to generic checkpoint/index/repair behavior
- expect machine-visible outcomes such as `promote_baseline_allowed`, `choose_cycle`, or `blocked_open_gap`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.
- hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill promote-baseline --project-runtime-state --json`.
- in dual/db-only, use the hydrated payload to read `repair_layer_status`, `repair_layer_advice`, prioritized artifacts, and continuity hints before acting.
- prefer `docs/audit/RUNTIME-STATE.md` as the short runtime digest when it has just been refreshed by hydration.
- use this output to capture:
  - baseline/snapshot-driven reload invalidation
  - gate/index consistency after promotion updates
- if the hook returns `reason_code=PROMOTE_BASELINE_USAGE_MATRIX_INCOMPLETE`, STOP and apply the JSON `recommended_next_action` before any further write.
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
- Promotion summary
- New baseline version
- Next entry point

