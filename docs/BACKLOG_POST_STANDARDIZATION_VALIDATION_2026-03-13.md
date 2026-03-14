# Backlog Post-Standardization Validation - 2026-03-13

## Goal

Track the executable closure work after product self-host standardization:

- restore `perf:verify-context-resilience`
- reinstall and revalidate the current package branch in `gowire`
- record whether the remaining failing test was a regression or a pre-existing defect

Reference plan:

- `docs/PLAN_POST_STANDARDIZATION_VALIDATION_2026-03-13.md`

## Backlog Items

### PSV-01 - Reproduce The Direct Coordinator Dispatch Execute Failure

Status: completed
Priority: high

Files:

- `tools/perf/verify-coordinator-dispatch-execute-fixtures.mjs`
- `tools/runtime/coordinator-dispatch-execute.mjs`
- any dependent runtime helper revealed by the failure

Done when:

- the failing command is isolated outside the aggregate npm script
- the exact failure mode is understood

### PSV-02 - Fix The Coordinator Dispatch Execute Failure

Status: completed
Priority: high

Files:

- runtime CLI and/or fixture helpers

Done when:

- `node tools/perf/verify-coordinator-dispatch-execute-fixtures.mjs` passes
- the fix is minimal and justified

### PSV-03 - Restore `perf:verify-context-resilience`

Status: completed
Priority: high

Files:

- only what is needed after `PSV-02`

Done when:

- `npm run perf:verify-context-resilience` passes end-to-end

### PSV-04 - Reinstall Current Branch In `gowire`

Status: completed
Priority: high

Files:

- `gowire/package.json`
- `gowire/package-lock.json`

Done when:

- `gowire` resolves the current branch head

### PSV-05 - Re-run Install And Verify In `gowire`

Status: completed
Priority: high

Files:

- `gowire/.aidn/*`
- `gowire/docs/audit/*`

Done when:

- `npx aidn install --target . --pack core` passes
- `npx aidn install --target . --pack core --verify` passes
- preserved project-owned files remain intact

### PSV-06 - Record Validation Outcome

Status: completed
Priority: medium

Files:

- validation plan/backlog
- optional troubleshooting or audit follow-up

Done when:

- the result is documented
- the coordinator failure is categorized as regression or pre-existing issue

## Recommended Execution Order

1. `PSV-01`
2. `PSV-02`
3. `PSV-03`
4. `PSV-04`
5. `PSV-05`
6. `PSV-06`

## Closure Note

- `perf:verify-context-resilience`: PASS
- `gowire` install: PASS
- `gowire` verify: PASS
- preserved project-owned files in `gowire`: unchanged
