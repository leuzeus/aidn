# 05 Local-First Shared Runtime

## Purpose

AIDN is local-first by default.

Shared runtime is opt-in and must not weaken checkout-bound auditability or local recovery.

## Core Rules

- PostgreSQL is optional
- once `runtime.persistence.backend=postgres` is configured, runtime continuity reads use PostgreSQL as the canonical backend and stop on unavailable or ambiguous canonical context
- shared runtime is opt-in
- local checkout-bound artifacts stay local unless a rule explicitly says otherwise
- shared runtime may carry coordination metadata, not implicit copies of checkout-bound state
- public runtime JSON outputs may expose connection references but must recursively redact resolved connection strings

## Do Not Move Implicitly

These surfaces must not be relocated by shared runtime behavior:

- `docs/audit/*`
- `AGENTS.md`
- `.agents/*`
- `.codex/*`
- `.aidn/config.json`
- `.aidn/runtime/index/workflow-index.sqlite`
- `.aidn/runtime/context/*`
- `repair_findings`
- `incident`

`repair_findings` and `incident` are explicitly not shared. A future change may
cross that boundary only after an ADR adds the surface and the shared
coordination port exposes it.

## Shared Runtime Boundary

Any shared runtime extension must pass through:

- explicit ports or adapters
- the relevant ADR
- tests
- a gate

The current boundary is described in:

- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
- `docs/ADR/ADR-0007-local-first-federation-boundary.md`
- `docs/ADR/ADR-0008-shared-coordination-ports.md`

## Practical Rule

If a change would make a checkout-bound artifact disappear into shared infrastructure, stop and re-check the boundary before proceeding.

The default expectation is local recovery first, explicit shared coordination second.
