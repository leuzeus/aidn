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

ADR-0013 defines an explicit migration of standard AIDN executable assets to a
user-level installation. This is code distribution, not shared workflow storage:
project configuration, activation, extensions, historical records and runtime
data retain their existing scope. Global installation shipped in 0.10.0;
each client still needs explicit ownership-checked migration. A published
engine is not permission to relocate project files or data implicitly.

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

## Bounded Supervision Model

ADR-0014 reserves PostgreSQL authority for the future opt-in supervised execution
path (`execution_run`, `delegated_task`, `execution_attempt`). Existing sequential
workflows continue to support operation without PostgreSQL. Lot 2 ships pure
contracts with `model_only` coverage: no shared store, schema migration, worker
or scheduler is available, and the current shared coordination port is unchanged.

Transcripts and bulky outputs remain local; shared metadata will contain only
bounded references, byte counts and hashes. Task ownership leases are distinct
from worktree heartbeats and global engine-generation leases. No claim, heartbeat
or read-only readiness check may implicitly bootstrap DDL. Delegation and results
belong to attempts; expiration requires reconciliation before another launch.
