# Backlog Aidn Correction Architecture - GitHub Issues Ready - 2026-05-24

## Usage

This document is a derived issue-preparation artifact for
`docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`.

Important:

- this file is not the implementation source of truth
- current delivery status still lives in the dated backlog plan
- if these issue drafts diverge from the repository state, treat them as a stale export until refreshed

Recommended labels:

- `architecture`
- `runtime`
- `cli`
- `testing`
- `governance`
- `ops`
- `release`
- `security`
- `packaging`
- `ci`
- `local-first`

Recommended milestones:

- `M1 Stabilize Public Surfaces`
- `M2 Governance And Runtime Hardening`
- `M3 CI And Release Boundaries`

## Issue Drafts

### Issue 1 - Classify all public, experimental, and internal CLI surfaces

Title:

`[Architecture] ARCH-P0-01 - Classify all CLI surfaces`

Body:

```md
## Summary

Build one explicit inventory for public, experimental, and internal CLI surfaces.

## Why

The repository already exposes many runtime commands. Their status must be explicit before deeper refactors continue.

## Scope

- `bin/aidn.mjs`
- `package.json`
- `src/core/cli/effect-policy.mjs`
- `src/core/contracts/cli-output/README.md`

## Acceptance Criteria

- every stable `aidn` command has an explicit effect class
- internal scripts are documented as internal or experimental
- the inventory is aligned with the public alias set

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `architecture`
- `cli`
- `governance`
- `P0`

Milestone:

- `M1 Stabilize Public Surfaces`

### Issue 2 - Decide and implement `db-only-readiness` public status

Title:

`[Runtime] ARCH-P0-02 - Decide the public status of db-only-readiness`

Body:

```md
## Summary

Keep `aidn runtime db-only-readiness --json` explicitly public or explicitly internal.

## Why

The command is already scripted and tested. Its public status must not remain implicit.

## Scope

- `tools/runtime/db-only-readiness.mjs`
- `bin/aidn.mjs`
- `src/core/contracts/cli-output/`

## Acceptance Criteria

- the status is documented
- if public, the JSON contract and effect policy are present
- the no-write gate covers the promoted surface

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `runtime`
- `contracts`
- `db-only`
- `P0`

Milestone:

- `M1 Stabilize Public Surfaces`

### Issue 3 - Clarify repair-layer public/internal status

Title:

`[Runtime] ARCH-P0-03 - Classify repair-layer commands as internal or public`

Body:

```md
## Summary

Classify `repair-layer` commands so they cannot become public API by accident.

## Why

The repair layer is central to CI and ops, but it should stay bounded and explicit.

## Scope

- `tools/runtime/repair-layer*.mjs`
- `package.json`
- `src/core/cli/effect-policy.mjs`

## Acceptance Criteria

- each command has an explicit status
- any public surface has a contract and effect class
- internal commands stay out of the public alias inventory

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `runtime`
- `repair-layer`
- `cli`
- `P0`

Milestone:

- `M1 Stabilize Public Surfaces`

### Issue 4 - Extend no implicit write to promoted surfaces

Title:

`[Testing] ARCH-P0-04 - Extend no implicit write coverage`

Body:

```md
## Summary

Ensure stable read, preview, and projector dry-run surfaces do not mutate guarded paths.

## Why

This is the primary guardrail against surprise checkout or metadata writes.

## Scope

- `tools/perf/verify-cli-no-implicit-write-fixtures.mjs`
- `src/core/cli/effect-policy.mjs`

## Acceptance Criteria

- the gate passes on the promoted surfaces
- guarded paths are explicit
- excluded surfaces have a documented rationale

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `testing`
- `cli`
- `safety`
- `P0`

Milestone:

- `M1 Stabilize Public Surfaces`

### Issue 5 - Add shared runtime extension gate

Title:

`[Architecture] ARCH-P0-06 - Add a shared runtime extension gate`

Body:

```md
## Summary

Block new shared runtime surfaces unless ADR, matrix, contracts, and tests are updated together.

## Why

Shared runtime is the riskiest local-first boundary in the repository.

## Scope

- `tools/perf/`
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
- `docs/ADR/ADR-0007-local-first-federation-boundary.md`

## Acceptance Criteria

- unexpected shared surfaces fail the gate
- the matrix and ADR remain aligned
- the decision surface is explicit

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `shared-runtime`
- `architecture`
- `local-first`
- `P0`

Milestone:

- `M1 Stabilize Public Surfaces`

### Issue 6 - Add governance metrics for source-of-truth and metadata

Title:

`[Governance] ARCH-P1-01 - Expose SoT coverage in governance diagnostics`

Body:

```md
## Summary

Map critical runtime commands to concepts and expose coverage in governance diagnostics.

## Why

Policies already exist. The runtime must prove it consumes them.

## Scope

- `src/application/runtime/governance-diagnostics-use-case.mjs`
- `tools/runtime/governance-diagnostics.mjs`

## Acceptance Criteria

- diagnostics show command to concept linkage
- missing concepts are visible
- coverage status is machine-readable

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `governance`
- `information-architecture`
- `runtime`
- `P1`

Milestone:

- `M2 Governance And Runtime Hardening`

### Issue 7 - Extract a first `pre-write-admit` tranche

Title:

`[Runtime] ARCH-P1-03 - Extract a first pre-write-admit tranche`

Body:

```md
## Summary

Move one isolated responsibility out of `tools/runtime/pre-write-admit.mjs` into `src/application/runtime`.

## Why

The command is one of the largest runtime scripts and sits on a safety boundary before writes.

## Scope

- `tools/runtime/pre-write-admit.mjs`
- `src/application/runtime/pre-write-admit-use-case.mjs`

## Acceptance Criteria

- the CLI JSON behavior stays unchanged
- the extracted use case is testable directly
- the wrapper is smaller and clearer

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `runtime`
- `refactor`
- `admission`
- `P1`

Milestone:

- `M2 Governance And Runtime Hardening`

### Issue 8 - Productize backup, restore, adopt, and reanchor runbooks

Title:

`[Ops] ARCH-P1-06 - Productize backup, restore, adopt, and reanchor runbooks`

Body:

```md
## Summary

Convert PostgreSQL and shared runtime guides into surface-specific runbooks with preview, write, and rollback steps.

## Why

The commands already exist. Operators need a safer and clearer sequence.

## Scope

- `docs/MIGRATION_SHARED_RUNTIME_POSTGRESQL.md`
- `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`

## Acceptance Criteria

- each mutation has a backup step and a post-write check
- preview/write/rollback paths are obvious
- the docs avoid unnecessary pilot detail

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `ops`
- `postgres`
- `runtime`
- `P1`

Milestone:

- `M2 Governance And Runtime Hardening`

### Issue 9 - Split CI gates by intention

Title:

`[CI] ARCH-P1-07 - Split CI gates by intention`

Body:

```md
## Summary

Keep CI readable by family: contracts, governance, runtime-ops, shared-boundary, release, and perf-kpi.

## Why

The current signal is good but too concentrated in a few jobs.

## Scope

- `.github/workflows/*.yml`
- `package.json`

## Acceptance Criteria

- jobs stay equivalent or stronger
- each job name reflects its risk family
- failures are easier to route

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `ci`
- `testing`
- `maintainability`
- `P1`

Milestone:

- `M3 CI And Release Boundaries`

### Issue 10 - Add release and provenance checklist

Title:

`[Release] ARCH-P2-03 - Add a release and provenance checklist`

Body:

```md
## Summary

Align versioning, package metadata, release artifacts, checksums, and publish surface checks.

## Why

Release is already instrumented; the published surface must remain clean and reproducible.

## Scope

- `docs/GIT_WORKFLOW.md`
- `tools/build-release.mjs`
- `tools/perf/verify-release-artifacts.mjs`
- `package.json`

## Acceptance Criteria

- release verification is explicit and repeatable
- publish surface guards are part of the flow
- internal or pilot details do not leak into the package

## References

- `docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_BACKLOG_2026-05-23.md`
```

Labels:

- `release`
- `security`
- `packaging`
- `P2`

Milestone:

- `M3 CI And Release Boundaries`

