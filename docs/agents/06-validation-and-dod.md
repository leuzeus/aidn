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
- public JSON output is one complete parseable document on `stdout`, with
  diagnostics kept on `stderr`
- dependency-bearing workflows install from a tracked lockfile and prove
  required optional drivers resolve before executing their consumers
- every tracked GitHub Actions workflow parses with the locked YAML dependency
  before structural trigger, job, command, and ordering policies are evaluated
- every executed gate leaves the tracked and untracked, non-ignored checkout state unchanged
- pull-request governance emits one `governance-route.v1` artifact, executes
  each selected family at most once, and exposes the exact `Governance Admission`
  rollup required by branch protection
- every failed gate retains a bounded, redacted exit code, signal, and
  stdout/stderr tail; named fixture assertions and cleanup results must survive
  through both direct output and the family summary
- required gate preconditions fail diagnostically when unavailable; they are not reported as `SKIP`
- manual-only PostgreSQL smoke evidence remains outside pull-request admission
  and is reported separately as `PASS`, `SKIP`, or `UNAVAILABLE`
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
- `npm run perf:verify-gate-runner-fixtures`
- `npm run perf:verify-release-version`
- `npm run perf:verify-release-provenance`

## Commands Requested In Reviews Or Plans But Not Present As Literal Scripts

The current `package.json` does not define all requested wrapper names as literal scripts.

- `npm test` is not defined today
- the historical `perf:verify-no-implicit-write` name is implemented as `npm run perf:verify-cli-no-implicit-write`
- the historical `perf:verify-runtime-modes` name has no literal wrapper today; use `npm run perf:verify-state-mode-parity` and the shared-boundary checks
- the historical `perf:verify-golden-fixtures` name has no literal wrapper today; use the closest gates for the surface under change, such as `npm run perf:verify-cli-output-contracts`, `npm run perf:verify-governance-runtime-cli`, `npm run perf:verify-governance-completeness`, and `npm run perf:verify-generated-doc-golden`

If a command is documented but missing, do not pretend it ran. Use the nearest existing gate, and update the docs or scripts in a follow-up if the missing wrapper is important enough to keep.

## What To Do When Validation Is Missing

- if a gate does not exist, identify the nearest existing check and report the gap explicitly
- if a script exists but fails, fix the underlying issue before marking the task complete
- if a check is intentionally skipped, record `SKIP` separately from `PASS`
- if a gate introduces a checkout change, attribute the failure to that gate and report only bounded path/status diagnostics, never file contents or secrets
- if the task touches a public surface, prefer one contract or fixture check in addition to the behavioral check

## Reporting

When you report the result, include:

- commands that passed
- commands that skipped
- commands that failed
- the reason for any missing or substituted gate
- any remaining risk that would justify a follow-up PR
