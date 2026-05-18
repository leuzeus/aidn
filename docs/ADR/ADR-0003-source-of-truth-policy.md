# ADR-0003 - Source Of Truth Policy

## Status

Proposed

## Date

2026-05-18

## Context

AIDN supports `files`, `dual`, and `db-only` runtime modes while also projecting human-readable audit artifacts under `docs/audit/*`. The same concept can appear in Markdown, SQLite, PostgreSQL, runtime context JSON and CLI output.

Without an explicit source-of-truth policy, agents and maintainers can confuse canonical state, projection, digest and cache.

## Decision

AIDN will define source of truth by concept and runtime mode.

Rules:

- workflow rules remain checkout-bound in `docs/audit/SPEC.md`
- project policy remains `.aidn/project/workflow.adapter.json`
- `docs/audit/*` remains checkout-bound and never shared by default
- in `files`, session/cycle state is file-first
- in `dual`, runtime DB/index is canonical for runtime state and Markdown projection is required
- in `db-only`, runtime DB is canonical and Markdown is materialized on demand
- shared runtime is opt-in and limited to explicitly listed coordination metadata

The living matrices are:

- `docs/PLAN_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`

## Options Compared

| Option | Result |
|---|---|
| Files-first everywhere | Simple, but blocks DB-backed governance and federation readiness. |
| DB-first everywhere | Clear for runtime, but breaks installed-repo audit ergonomics. |
| Implicit hybrid | Backward compatible, but causes drift and ambiguity. |
| Explicit per-concept policy | More documentation, but matches current architecture and migration needs. |

## Criteria

- local-first behavior remains stable
- `files`, `dual`, and `db-only` stay supported
- projections are distinguishable from canonical state
- shared runtime cannot silently relocate checkout-bound artifacts

## Consequences

Positive:

- less ambiguity for agents and maintainers
- better repair-layer diagnostics
- safer DB-backed runtime evolution

Negative:

- policy and implementation must stay synchronized
- transitional legacy paths need explicit compatibility handling

## Risks

- inconsistent enforcement if gates are not updated
- over-documentation if future code does not consume the policy

## Follow-Up

- add source-of-truth policy helpers under `src/core`
- add gate checks for source/projection drift
- keep ADR-0003 aligned with runtime scope matrix updates
