# CI Gate Families

Date: 2026-05-24
Status: active navigation entry

This page maps the architectural verification surface to the workflows that now own each family.

## Families

| Family | Workflow | Primary checks |
| --- | --- | --- |
| Contracts | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | JSON contracts and exhaustive surface catalog |
| Effects | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | effect policy and no implicit write |
| Governance | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | source of truth, metadata, completeness |
| Docs | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | Markdown contracts and CLI inventory |
| Codex | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | pack topology and isolated installed-client discovery |
| Runtime | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | state modes, governance CLI, shared boundary |
| Security | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | full Git-tracked sensitivity scan plus package/surface boundary checks |
| Release | [`.github/workflows/release.yml`](../.github/workflows/release.yml) | version, reproducibility, topology, sensitivity, workflow policy |
| Cleanliness | [`.github/workflows/architecture-gates.yml`](../.github/workflows/architecture-gates.yml) | branch policy, gate catalog, clean local full run |

The executable catalog is `package/catalogs/gates.v1.json`. Every entry declares family, script, job, surfaces, condition, obligations for `dev`, `main`, and release, and reports one of `PASS`, `FAIL`, or `SKIP`.

The tracked-tree sensitivity gate inspects every Git-tracked path and every tracked text file. Package topology independently applies the same policy to the npm tarball. Tracked documentation now uses neutral external-pilot labels and placeholder roots; because earlier commits contained pilot-specific names and local paths, a separate Git history cleanup may still be required before broader archival or publication.

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
