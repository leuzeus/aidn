# Title

`feat: integrate cross-usage convergence gates and harden runtime cleanup`

## Summary

This PR introduces `Cross-Usage Convergence` as a first-class AIDN validation mechanism and hardens runtime/fixture cleanup behavior across the verification toolchain.

The branch is intentionally split into atomic commits, but the work falls into two review themes:

1. `Cross-Usage Convergence`
2. Windows-safe cleanup and related runtime fixes

## What changed

### Cross-Usage Convergence

- Added canonical documentation, plan, backlog, and integration guidance.
- Added `usage_matrix` to cycle templates and surfaced it in workflow/project docs.
- Added structured adapter configuration via `specializedGates.crossUsageConvergence`.
- Enforced `usage_matrix` on:
  - `promote-baseline`
  - `cycle-close`
  - `pre-write-admit`
- Exposed blocking reasons and recommended next actions in Codex hook output.
- Updated skills and workflow guidance so incomplete usage coverage is visible as a hard stop.

### Runtime and verifier hardening

- Standardized Windows-safe temp cleanup across the `tools/perf` verifier fleet.
- Hardened `reset-runtime` cleanup behavior.
- Fixed repair-layer artifact writes so outputs resolve under the target root instead of the repository root.
- Reduced false positives in `db-only-readiness`.
- Added a dedicated verifier for runtime path cleanup behavior.

## Why

The main product change is to prevent convergence on a single passing scenario for shared or high-risk surfaces. The runtime/tooling hardening work was necessary to keep the verifier fleet stable while broadening fixture coverage, especially on Windows.

## Validation

Representative checks run on the branch:

- `node tools/perf/verify-generated-doc-fragments-fixtures.mjs`
- `node tools/perf/verify-imported-sections-policy-fixtures.mjs`
- `node tools/perf/verify-workflow-adapter-migration-fixtures.mjs`
- `node tools/perf/verify-generated-doc-golden-fixtures.mjs`
- `node tools/perf/verify-generated-docs-fixtures.mjs`
- `node tools/perf/verify-promote-baseline-admission-fixtures.mjs`
- `node tools/perf/verify-cycle-close-admission-fixtures.mjs`
- `node tools/perf/verify-pre-write-admit-fixtures.mjs`
- `node tools/perf/verify-db-only-readiness-fixtures.mjs`
- `node tools/perf/verify-sync-db-first-selective-fixtures.mjs --json`
- `node tools/perf/verify-mode-migrate-repair-layer-fixtures.mjs --json`
- `node tools/perf/verify-runtime-path-cleanup-fixtures.mjs`
- `node tools/perf/verify-session-plan-fixtures.mjs --json`

## Review guide

Recommended review order:

1. Canonical docs and workflow/template changes
2. Adapter/config rendering for `specializedGates.crossUsageConvergence`
3. Admission/runtime gates for `cycle-close`, `promote-baseline`, and `pre-write-admit`
4. Repair-layer path fixes
5. Cleanup helper propagation and runtime cleanup verifier

## Risk

- Medium on admission behavior because new `usage_matrix` gates can block `DONE` flows.
- Low to medium on tooling because cleanup changes affect test/runtime artifact deletion.
- Low on documentation consistency; the branch includes canonical and generated-doc updates.

## Follow-up

- Optional: collapse commits by theme before merge if a shorter history is preferred.
- Optional: add a generic policy test that asserts `usage_matrix` visibility in all generated workflow variants.
