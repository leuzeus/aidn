# CI Gate Families

Date: 2026-05-24
Status: active navigation entry

This page maps the architectural verification surface to the workflows that now own each family.

## Families

| Family | Workflow | Primary checks |
| --- | --- | --- |
| Contracts | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | CLI effect policy, CLI surface inventory, no implicit write, CLI output contracts |
| Runtime | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | source-of-truth policy, metadata policy, governance completeness, state-mode parity, governance runtime CLI |
| Ops | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | DB schema migrations, DB runtime CLI, runtime persistence parity, shared coordination backup/restore/doctor |
| Security | [`.github/workflows/security-baseline.yml`](../.github/workflows/security-baseline.yml) | package leak guard, shared surface boundary, no implicit write |
| Release | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | release version, build-release, release artifacts |
| Docs | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | markdown contract conformance |

## Relationship To Existing Workflows

- `runtime-ops.yml` remains the focused runtime operations smoke path.
- `runtime-mode.yml` remains the focused mode parity path.
- `shared-boundary.yml` remains the focused shared-boundary path.
- `perf-kpi.yml` remains the broader KPI and fixture pipeline.
- `security-baseline.yml` owns the lightweight package and boundary guardrail path.

## Navigation

- [Documentation index](./README.md)
- [Architecture cockpit](./ARCHITECTURE_COCKPIT.md)
- [Testing guide](./TESTING.md)
