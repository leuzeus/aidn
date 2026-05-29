# PR Summary - Cross-Usage Convergence and Runtime Cleanup

## Scope

This branch delivers two linked themes:

1. `Cross-Usage Convergence` as a structured AIDN validation policy.
2. Windows-safe runtime and fixture cleanup hardening across the verification toolchain.

## Theme A - Cross-Usage Convergence

### Objective

Integrate multi-usage validation into AIDN so shared or high-risk implementations cannot converge on a single scenario.

### Main changes

- Added the concept, plan, backlog, and formalization in the canonical documentation.
- Added `usage_matrix` to cycle templates and surfaced it in generated workflow documentation.
- Added structured adapter configuration through `specializedGates.crossUsageConvergence`.
- Added runtime gates for:
  - `promote-baseline`
  - `cycle-close`
  - `pre-write-admit`
- Exposed blocking reasons and recommended next actions in Codex hook output.
- Updated agent skills and workflow guidance so `usage_matrix` failures are explicit hard stops.

### Key commits

- `50c602b` `docs: add cross-usage convergence plan`
- `5d9f708` `docs: add cross-usage convergence to spec`
- `639852e` `docs: add cross-usage policy to workflow adapter`
- `1d2f657` `docs: add usage matrix cycle templates`
- `07c32ed` `feat: add structured cross-usage adapter policy`
- `c2828ab` `docs: enforce usage matrix in agent workflow`
- `c62937d` `feat: enforce usage matrix at baseline promotion`
- `b854dd4` `feat: enforce usage matrix at cycle close`
- `26f5963` `feat: gate cycle-close usage matrix in pre-write admit`
- `7b7feb9` `feat: expose cycle-close gate details in codex hook output`
- `c9ef10b` `feat: gate promote-baseline usage matrix in pre-write admit`

## Theme B - Runtime and Fixture Cleanup Hardening

### Objective

Remove Windows-specific cleanup flakiness and fix output-path regressions discovered while broadening fixture coverage.

### Main changes

- Standardized temporary fixture cleanup on `removePathWithRetry` across the `tools/perf` verifier fleet.
- Hardened `reset-runtime` cleanup behavior.
- Added runtime-safe path cleanup for:
  - delivery window state removal
  - workflow session run-id removal
- Fixed path resolution regressions where repair-layer artifacts could be written under the repository root instead of the target root.
- Fixed false positives in `db-only-readiness` scans.
- Aligned one repair-block verifier with the actual DB-backed hook semantics.

### Key commits

- `a29dd22` `test: harden fixture cleanup on windows`
- `737a351` `test: reuse windows-safe cleanup across admission fixtures`
- `e4cdfcd` `test: apply windows-safe cleanup to core fixture verifiers`
- `4fa0ab8` `test: extend windows-safe cleanup to repair fixture verifiers`
- `fa813ec` `test: apply windows-safe cleanup to coordinator install verifiers`
- `4a51507` `test: extend windows-safe cleanup to coordinator fixture verifiers`
- `079d60a` `test: extend windows-safe cleanup to multi-agent db-only verifiers`
- `3c91fbc` `fix: write repair-layer triage artifacts under target root`
- `75b1f76` `fix: write repair-layer reports under target root`
- `03b8511` `fix: avoid false positives in db-only readiness scan`
- `77c58b2` `test: harden reset runtime cleanup`
- `5f1915e` `fix: harden runtime path cleanup`
- `19d87c5` `test: cover runtime path cleanup`

## Validation executed

Representative validation run on this branch included:

- cross-usage adapter policy and generated-doc fixture verifiers
- `verify-promote-baseline-admission-fixtures.mjs`
- `verify-cycle-close-admission-fixtures.mjs`
- `verify-pre-write-admit-fixtures.mjs`
- `verify-db-only-readiness-fixtures.mjs`
- `verify-sync-db-first-selective-fixtures.mjs`
- `verify-mode-migrate-repair-layer-fixtures.mjs`
- `verify-runtime-path-cleanup-fixtures.mjs`
- `verify-session-plan-fixtures.mjs`

In addition, the remaining `tools/perf` temporary-target cleanup pattern was exhausted for the targeted `tempRoot/tmpRoot/tmpTarget/tempTarget` cases.

## Review focus

Recommended review order:

1. `docs/SPEC.md` and workflow/template changes for the `usage_matrix` model.
2. Runtime admission gates for `cycle-close`, `promote-baseline`, and `pre-write-admit`.
3. Adapter/config rendering for `specializedGates.crossUsageConvergence`.
4. Repair-layer path resolution fixes.
5. Shared cleanup helper adoption and the dedicated runtime cleanup verifier.

## Risk profile

- Functional risk is concentrated in the new `usage_matrix` admission gates.
- Tooling risk is concentrated in fixture cleanup behavior and runtime artifact deletion.
- Documentation risk is low and mostly concerns consistency between canonical docs and generated workflow output.
