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
- locator validation is mandatory before any shared backend access
- shared coordination is limited to registry, planning, handoff and coordination records
- checkout-bound artifacts such as `docs/audit/*`, `AGENTS.md`, `.codex/*` and `.aidn/config.json` remain outside shared coordination

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

- align `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md` with the new ports
- map the port methods to adapter implementations and runtime use cases
- keep `ADR-0007` and the shared-surface gate synchronized with any port change
- the minimal shared coordination store port is implemented in `src/core/ports/shared-coordination-store-port.mjs` and asserted by the PostgreSQL shared coordination adapter
