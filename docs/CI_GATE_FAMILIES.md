# CI Gate Families

Date: 2026-05-24
Status: active navigation entry

This page maps the architectural verification surface to the workflows that now own each family.

`Governance Admission` classifies every pull request with the internal
`governance-route.v1` contract, publishes the route artifact, executes the
selected family matrix, and owns the final rollup. Each family and gate is
selected at most once on a pull request.

## Families

| Family | Workflow | Primary checks |
| --- | --- | --- |
| Contracts | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | JSON contracts and exhaustive surface catalog |
| Effects | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | effect policy and no implicit write |
| Governance | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | source of truth, metadata, completeness |
| Docs | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | Markdown contracts and CLI inventory |
| Codex | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | pack topology and isolated installed-client discovery |
| Runtime | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | state modes, governance CLI, persistence and shared boundary |
| Security | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | full Git-tracked sensitivity scan plus package/surface boundary checks |
| Release | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | version, reproducibility, topology, sensitivity, workflow policy |
| Cleanliness | [`.github/workflows/governance-admission.yml`](../.github/workflows/governance-admission.yml) | branch policy, gate catalog, clean local full run |

The executable catalog is `package/catalogs/gates.v1.json`. Every entry declares family, script, job, surfaces, condition, obligations for `dev`, `main`, and release, and reports one of `PASS`, `FAIL`, or `SKIP`.

The same catalog contains the adaptive lane and path policy. `FAST` is limited
to recognized historical documentation. `STANDARD` selects the implicated
families and falls back conservatively for unknown paths. `ASSURED` selects all
42 required obligations. The surface catalog can elevate a route but cannot
grant a lower lane.

The tracked-tree sensitivity gate inspects every Git-tracked path and every tracked text file. Package topology independently applies the same policy to the npm tarball. Tracked documentation now uses neutral external-pilot labels and placeholder roots; because earlier commits contained pilot-specific names and local paths, a separate Git history cleanup may still be required before broader archival or publication.

## Relationship To Existing Workflows

- `governance-admission.yml` is the only pull-request gate workflow. Branch
  protection on `dev` and `main` requires its exact `Governance Admission`
  rollup; no compatibility check jobs remain.
- `perf-kpi.yml` remains non-blocking observability and runs on pull requests
  only for runtime, performance, index, or self-host changes; manual dispatch
  remains available.
- `runtime-ops-live-smoke.yml` remains manual and reports PostgreSQL evidence
  separately from required pull-request gates.
- `release.yml` runs only at the publication boundary on a push to `main` and
  intentionally repeats the complete obligation set before tag or GitHub Release.

## Navigation

- [Documentation index](./README.md)
- [Architecture cockpit](./ARCHITECTURE_COCKPIT.md)
- [Testing guide](./TESTING.md)
