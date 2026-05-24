# Architecture Cockpit

Date: 2026-05-24
Status: active navigation entry

Purpose:

- provide a single entry point for the architectural working set
- reduce the need to hunt across plans, matrices, ADRs, and runtime inventories
- keep the local-first / shared-runtime boundary visible
- defer broad documentation navigation to [docs/README.md](./README.md)

## Primary Entry Points

- [Documentation index](./README.md)
- [CI gate families](./CI_GATE_FAMILIES.md)
- [CLI surface inventory](./CLI_SURFACE_INVENTORY.md)
- [Runtime surface scope matrix](./RUNTIME_SURFACE_SCOPE_MATRIX.md)
- [Testing guide](./TESTING.md)
- [Shared runtime migration guide](./MIGRATION_SHARED_RUNTIME_POSTGRESQL.md)

## EA/IA Closure Trace

- [Execution plan post EA/IA review](./PLAN_AIDN_EXECUTION_POST_EA_IA_REVIEW_2026-05-24.md)
- [Executable backlog post EA/IA review](./BACKLOG_AIDN_EXECUTION_POST_EA_IA_REVIEW_2026-05-24.md)

## Architectural References

- [ADR index](./ADR/)
- [ADR-0002 runtime platform architecture](./ADR/ADR-0002-runtime-platform-architecture.md)
- [ADR-0003 source of truth policy](./ADR/ADR-0003-source-of-truth-policy.md)
- [ADR-0004 public CLI JSON contracts](./ADR/ADR-0004-public-cli-json-contracts.md)
- [ADR-0005 read/write CLI semantics](./ADR/ADR-0005-read-write-cli-semantics.md)
- [ADR-0006 information model](./ADR/ADR-0006-information-model.md)
- [ADR-0008 shared coordination ports](./ADR/ADR-0008-shared-coordination-ports.md)
- [ADR-0009 release versioning provenance](./ADR/ADR-0009-release-versioning-provenance.md)

## Runtime Verification

- `architecture-gates.yml`
- `npm run perf:verify-cli-effect-policy`
- `npm run perf:verify-cli-no-implicit-write`
- `npm run perf:verify-cli-output-contracts`
- `npm run perf:verify-source-of-truth-policy`
- `npm run perf:verify-metadata-policy`
- `npm run perf:verify-governance-completeness`
- `npm run perf:verify-state-mode-parity`
- `npm run perf:verify-shared-coordination-backup`
- `npm run perf:verify-shared-coordination-restore`
- `npm run perf:verify-shared-coordination-doctor`
- `npm run perf:verify-security-baseline`
- `npm run perf:verify-release-version`
- `npm run perf:verify-release-artifacts`

## Navigation Rules

- `docs/audit/*` remains checkout-bound and must not be relocated by shared runtime behavior.
- `files`, `dual`, and `db-only` remain supported operating modes.
- PostgreSQL shared coordination stays explicit opt-in.
- release/provenance must stay tied to `VERSION`, `package.json`, manifest, and checksums.
