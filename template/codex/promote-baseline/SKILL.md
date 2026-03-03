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

5) Optional performance hook (Phase 2, recommended for instrumented repositories):
- run `npx aidn perf skill-hook --skill promote-baseline --target . --mode COMMITTING --json`
- state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).
- use this output to capture:
  - baseline/snapshot-driven reload invalidation
  - gate/index consistency after promotion updates
- this should not block workflow execution by default

Output:
- Promotion summary
- New baseline version
- Next entry point
