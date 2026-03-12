# Project Workflow Adapter (Stub)

This file is the project adapter for `aidn-workflow`.
Use it to record repository-specific constraints and operating policy.
Core workflow rules belong to `docs/audit/SPEC.md`, not here.
Its role is to reduce local ambiguity and keep AI behavior stable.

## Adapter Metadata

```yaml
workflow_product: aidn-workflow
workflow_version: 0.4.0
installed_pack: core
project_name: gowire
source_branch: dev
```

## Project Constraints

- Runtime/platform constraints: `Go-first codebase, TinyGo-compatible WASM runtime, avoid reflection-heavy patterns, and keep wasm bundle size under project limits.`
- Architecture constraints: `SSR-first custom elements, serializable props/events, lifecycle hooks consistency, and minimal SSR/hydration template divergence.`
- Dependency/data constraints: `Imports must follow the minimal-dependency principle: remove unused imports, avoid broad provider root packages when a service-specific package exists, preserve side-effect imports only when justified, and validate module hygiene with go mod tidy -diff in each active module scope (root and tools).`
- Delivery constraints (CI/release/compliance): `Local quality gates include go fmt/go vet/staticcheck, explicit root+tools test coverage, Go+Node tests, and tinygo lint refresh when WASM/runtime dependencies change. CI orchestration is managed by Drone (.drone.yml).`
- Generated artifact constraints: `Do not patch generated files directly as source of truth; update generator/template sources and regenerate artifacts in the same change.`
- Regression safety constraints: `Every hotfix touching hydration/dispatch must pass targeted runtime JS tests, proxy tests, and at least one browser stress scenario before merge.`

## Branch & Cycle Policy

- Source branch: `dev`
- Source branch classification: `source` (reload/reference branch only; never cycle ownership branch).
- Session branch naming: `SXXX-<short-slug>`
- Cycle branch naming: `<cycle-type>/CXXX-<slug>`
- Intermediate branch naming: `<cycle-type>/CXXX-I##-<slug>`
- Allowed cycle types: `feature | hotfix | spike | refactor | structural | migration | security | perf | integration | compat | corrective`
- DoR policy: `minimal core gate + adaptive checks by cycle type: for COMMITTING on cycle/intermediate branches, require one active mapped cycle with status.md + brief.md + plan.md + decisions.md + traceability.md.`

### Session Transition Cleanliness Gate (Mandatory)

- Applies before opening a new `SXXX-*` session branch.
- If orphan artifacts exist, require one explicit adoption/archive/drop decision.

## Runtime State Policy

- Preferred runtime state mode: `dual`.
- Default install/runtime profile for this repository is `dual` with `dual-sqlite` index storage.
- `files` mode is fallback-only for local recovery or exceptional troubleshooting, not the normal execution path.
- In `dual`, workflow hooks, hydration, and DB-backed runtime checks are expected before mutating workflow state.

## Cycle Continuity Gate (Project Policy, adapter extension to `SPEC-R06`)

Canonical continuity requirements are defined in `docs/audit/SPEC.md`.

### Mode mapping

- `COMMITTING`: choose `R1` or `R2`; `R3` requires explicit user override.
- `EXPLORING`: choose `R2` or `R3`.
- `THINKING`: `R3` only (no production implementation allowed).

## Session Close & PR Review

- Session close and PR review gates are canonical in `docs/audit/SPEC.md` (`SPEC-R07`, `SPEC-R08`).

### CI Capacity Gate (Mandatory, project policy extension)

- Drone capacity is limited: only one PR may consume `continuous-integration/drone/pr` at a time.
- Dependency/security batches (Dependabot included) must be sequential: update one PR, wait CI, merge/close, then move to the next.
- If multiple active CI PRs are detected: STOP and reduce to one.

## Snapshot Discipline

- Snapshot update trigger: `At session close and whenever baseline, active cycles, or next entry point changes.`
- Snapshot owner: `Current session agent, validated during review.`
- Freshness rule before commit/review: `Snapshot reviewed at session start and updated in the same session if branch-cycle mapping or cycle state changed.`
- Parking lot rule for non-essential ideas (entropy isolation): `Record non-essential ideas in docs/audit/parking-lot.md as IDEA-xxx and keep them out of active cycle scope.`
