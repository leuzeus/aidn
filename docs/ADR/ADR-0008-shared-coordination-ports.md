# ADR-0008 - Shared Coordination Ports

## Status

Accepted

## Date

2026-05-24

## Context

AIDN already exposes shared coordination concepts through runtime validation, shared SQLite/PostgreSQL backends and coordination workflows. The implementation surface is real, but the contract boundary is still spread across adapters, runtime use cases and documentation.

Without a port-level contract, it is easy to let shared coordination grow by accident into a broader shared runtime surface.

## Decision

AIDN will define explicit shared coordination ports before extending the shared runtime surface.

Rules:

- shared coordination must pass through minimal ports in `src/core/ports`
- the port surface must require explicit workspace, worktree and project identity
- runtime PostgreSQL and shared coordination must resolve project context through the same workspace identity model
- locator validation is mandatory before any shared backend access
- shared coordination is limited to registry, planning, handoff and coordination records
- checkout-bound and local runtime surfaces `docs/audit/*`, `AGENTS.md`, `.agents/*`, `.codex/*`, `.aidn/config.json`, `.aidn/runtime/index/workflow-index.sqlite`, `.aidn/runtime/context/*`, `repair_findings` and `incident` remain outside shared coordination
- `repair_findings` and `incident` are explicitly not shared because this ADR defines no port or table for them

The first port slice should support:

- workspace registry access
- worktree registry access
- planning state reads and writes
- handoff relay records
- coordination history records

## Options Compared

| Option | Result |
|---|---|
| Adapter-only shared coordination | Fast to ship, but the boundary stays implicit and harder to review. |
| Event store first | Strong for history, but too large a step for the current scope. |
| Minimal explicit ports | Small enough to review, stable enough to extend, and consistent with local-first boundaries. |

## Criteria

- local-first behavior remains intact
- shared surfaces remain opt-in and auditable
- ports stay narrow enough to test directly
- future expansion can happen without changing the boundary contract

## Consequences

Positive:

- shared coordination becomes easier to reason about
- adapter implementations can evolve behind a stable contract
- boundary checks can target a small set of ports and records

Negative:

- the initial port design adds one more layer to maintain
- shared runtime work needs slightly more upfront documentation

## Risks

- port names may drift from the existing adapter vocabulary if not aligned early
- a port that is too broad would recreate the current implicit boundary problem

## Follow-Up

### Canonical artifact commands (0.10.1)

`ProjectArtifactStore` separates explicit artifact commands from bulk index
projection and adoption. It resolves the configured runtime persistence backend;
PostgreSQL never falls back to a local SQLite store. A targeted transaction uses
an existing schema and unique scope, keeps stable artifact identifiers, updates
only the named artifact and its directly derived rows, and rolls back on conflict.
Session/cycle metadata stays in the same canonical scope. No schema migration or
cross-scope repair is implicit. A short artifact-table lock also serializes these
writes against older bulk writers; it modifies no other scope's rows.

Workflow checkpoints consume the canonical PostgreSQL snapshot and do not
reimport checkout documents. Bulk import/adoption remains a separate explicit
operation. This extends runtime persistence commands, not the shared coordination
data boundary. Existing local-first and native admission rules still apply.

- align `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md` with the new ports
- map the port methods to adapter implementations and runtime use cases
- keep `ADR-0007` and the shared-surface gate synchronized with any port change
- the minimal shared coordination store port is implemented in `src/core/ports/shared-coordination-store-port.mjs` and asserted by the PostgreSQL shared coordination adapter
- runtime PostgreSQL now records `runtime_scope_id` and `project_context` separately from shared coordination rows so future platform dashboards can join by `project_id` without confusing projects
