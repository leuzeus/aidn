# 06 Validation And DoD

## Purpose

This document defines the minimum validation and the minimum Definition of Done for AIDN changes.

Do not close a task until the relevant evidence exists.

For intent-based test selection and result interpretation, use `docs/TESTING.md` as the broader guide.

## Definition Of Done

A task is done only when:

- behavior is verified
- docs are aligned
- policies are aligned
- contracts and fixtures are updated if needed
- relevant gates pass
- any architectural decision change is reflected in the ADR

## Validation Commands

Run the smallest relevant set first.

Current available commands include:

- `npm run perf:verify-cli-surface-parity`
- `npm run perf:verify-cli-no-implicit-write`
- `npm run perf:verify-cli-output-contracts`
- `npm run perf:verify-cli-surface-inventory`
- `npm run perf:verify-metadata-policy`
- `npm run perf:verify-source-of-truth-policy`
- `npm run perf:verify-governance-completeness`
- `npm run perf:verify-governance-runtime-cli`
- `npm run perf:verify-shared-surface-boundary`
- `npm run perf:verify-state-mode-parity`
- `npm run perf:verify-release-version`
- `npm run perf:verify-release-provenance`

## Commands Requested In Reviews Or Plans But Not Present As Literal Scripts

The current `package.json` does not define all requested wrapper names as literal scripts.

- `npm test` is not defined today
- `npm run perf:verify-no-implicit-write` is implemented as `npm run perf:verify-cli-no-implicit-write`
- `npm run perf:verify-runtime-modes` has no literal wrapper today; use `npm run perf:verify-state-mode-parity` and the shared-boundary checks
- `npm run perf:verify-golden-fixtures` has no literal wrapper today; use the closest gates for the surface under change, such as `npm run perf:verify-cli-output-contracts`, `npm run perf:verify-governance-runtime-cli`, `npm run perf:verify-governance-completeness`, and `npm run perf:verify-generated-doc-golden`

If a command is documented but missing, do not pretend it ran. Use the nearest existing gate, and update the docs or scripts in a follow-up if the missing wrapper is important enough to keep.

## What To Do When Validation Is Missing

- if a gate does not exist, identify the nearest existing check and report the gap explicitly
- if a script exists but fails, fix the underlying issue before marking the task complete
- if a check is intentionally skipped, record `SKIP` separately from `PASS`
- if the task touches a public surface, prefer one contract or fixture check in addition to the behavioral check

## Reporting

When you report the result, include:

- commands that passed
- commands that skipped
- commands that failed
- the reason for any missing or substituted gate
- any remaining risk that would justify a follow-up PR
