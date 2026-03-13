# Plan - Post-Standardization Validation

Date: 2026-03-13
Status: completed
Scope: finish the validation work that remains after product self-host standardization, then revalidate the updated package in the real `gowire` client repository.

## Problem Statement

The product/self-host standardization backlog is complete, but one important validation gap remains:

- `npm run perf:verify-context-resilience` still fails

The observed failure currently lands in:

- `tools/perf/verify-coordinator-dispatch-execute-fixtures.mjs`
- with a `Usage:` fallback emitted by `coordinator-dispatch-execute.mjs`

In parallel, the package should now be revalidated in `gowire`, because the internal product namespace changed from `template/` to `scaffold/`, even though the installed client contract stayed stable.

## Goals

- restore a green `perf:verify-context-resilience`
- identify whether the remaining failure is a pre-existing defect or a regression exposed by the recent product refactor
- reinstall the current branch in `gowire`
- rerun install/verify there and confirm stable project behavior

## Non-Goals

- no further structural repo standardization in this lot
- no client workflow contract rewrite
- no additional self-host redesign

## Workstreams

### 1. Restore Context-Resilience Verification

Tasks:

- reproduce the `verify-coordinator-dispatch-execute-fixtures.mjs` failure directly
- inspect the exact CLI call chain down to `tools/runtime/coordinator-dispatch-execute.mjs`
- determine whether argument forwarding, defaults, or fixture assumptions are broken
- fix the failing runtime/test path
- rerun:
  - `node tools/perf/verify-coordinator-dispatch-execute-fixtures.mjs`
  - `npm run perf:verify-context-resilience`

Acceptance:

- the direct fixture passes
- `perf:verify-context-resilience` passes end-to-end

### 2. Revalidate Installed Package In `gowire`

Tasks:

- reinstall the package from the current GitHub branch in `gowire`
- rerun:
  - `npx aidn install --target . --pack core`
  - `npx aidn install --target . --pack core --verify`
- confirm:
  - adapter config persists
  - generated docs remain healthy
  - source branch remains correct
  - no unexpected loss in preserved project files

Acceptance:

- install passes
- verify passes
- generated docs remain deterministic
- `gowire` preserved project-owned files remain intact

### 3. Record The Validation Outcome

Tasks:

- document whether the failing context-resilience issue was:
  - newly introduced by the standardization work
  - or pre-existing and only surfaced now
- if relevant, add a short follow-up note in an audit or troubleshooting doc

Acceptance:

- the result is explicit
- future work can distinguish “standardization complete” from “validation complete”

## Risks

### Risk 1 - The failing resilience test is unrelated but blocks closure

Mitigation:

- treat it as required closure work for the post-standardization lot
- isolate the minimal failing command first

### Risk 2 - `gowire` reveals a real client-facing regression

Mitigation:

- reinstall and verify immediately after restoring the global test line
- treat `gowire` as the real-world guardrail

## Acceptance Criteria

This post-standardization validation lot is complete when:

- `npm run perf:verify-context-resilience` passes
- the current branch is reinstalled successfully in `gowire`
- `gowire` install and verify pass
- the validation outcome is documented clearly

## Outcome

Result:

- `npm run perf:verify-context-resilience` now passes end-to-end
- `gowire` reinstall + install + verify pass against branch head `5ccd27c`
- preserved project-owned files in `gowire` stayed byte-identical for:
  - `docs/audit/baseline/current.md`
  - `docs/audit/baseline/history.md`
  - `docs/audit/parking-lot.md`
  - `docs/audit/snapshots/context-snapshot.md`

Classification of the failures:

- the remaining failures were not caused by the `template/` -> `scaffold/` product refactor
- they were pre-existing validation drift exposed by stricter runtime behavior already present in the branch:
  - stale fixture expectations for `verify-coordinator-dispatch-execute-fixtures.mjs`
  - strict non-zero JSON-returning `close-session` behavior in `db-only`
  - outdated hint expectations for `tools/perf/skill-hook.mjs` vs the Codex-facing `run-json-hook` path

## Recommended Delivery Order

1. reproduce and fix `verify-coordinator-dispatch-execute-fixtures`
2. rerun full `perf:verify-context-resilience`
3. reinstall package in `gowire`
4. rerun install/verify in `gowire`
5. record the outcome

## Recommendation

Execute this plan before starting any new feature work.

Reason:

- it closes the last meaningful validation gap left by the product standardization
- it confirms the branch is safe in both product and real client contexts
