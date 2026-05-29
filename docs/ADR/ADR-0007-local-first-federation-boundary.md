# ADR-0007 - Local-First Federation Boundary

## Status

Accepted

## Date

2026-05-18

## Context

AIDN is a local-first workflow governance platform. It already supports local files, SQLite, optional PostgreSQL-backed runtime persistence and shared coordination candidates. This creates a federation path, but also a risk: moving too much state into shared infrastructure too early would weaken the auditability and maintainability of the installed local workflow.

The current goal is not to become a cloud platform. Federation must remain opt-in and bounded until local source-of-truth, metadata, backup/restore and contract semantics are stable.

## Decision

AIDN will keep federation local-first and opt-in.

Rules:

- checkout-bound workflow artifacts remain local and versioned by the installed project
- shared runtime may store coordination metadata only when explicitly configured
- SQLite remains the default local runtime backend for DB-backed modes
- PostgreSQL is an optional backend for persistence and shared coordination, not a required service
- multi-repo or multi-worktree federation must use explicit workspace/worktree identity and locator configuration
- no command may silently relocate audit artifacts into shared runtime
- PostgreSQL runtime persistence rows must be contextualized by durable `project_id` and `workspace_id`, not by absolute filesystem paths

Stable federation contract:

- shared coordination is limited to `workspace_registry`, `worktree_registry`, `planning_states`, `handoff_relays` and `coordination_records`
- the locator is required for every shared backend and must be validated before use
- `project_id`, `workspace_id` and `worktree_id` are part of the public operational identity surface
- runtime persistence exposes the same identity through `project_context` and `runtime_scope_id`
- DB-backed PostgreSQL projects that explicitly disable the shared-runtime locator remain local-first, but shared coordination diagnostics must warn that shared PostgreSQL coordination is not active
- `docs/audit/*`, `AGENTS.md`, `.codex/*`, `.aidn/config.json` and local runtime projections stay outside shared coordination
- PostgreSQL connection material must be referenced through `env:*` or equivalent indirection, never embedded in tracked files

## Options Compared

| Option | Result |
|---|---|
| Local only forever | Simple, but limits multi-agent and multi-worktree coordination. |
| Cloud-first platform | Centralized, but too costly and inappropriate before local contracts stabilize. |
| Implicit shared runtime | Convenient, but high risk for audit boundaries and data leaks. |
| Explicit local-first federation | Incremental, auditable and maintainable for a small open-source team. |

## Criteria

- local checkout remains fully understandable and recoverable
- shared coordination is explicit and reversible
- sensitive local paths or pilot data are not leaked into tracked files
- backup/restore and migration paths exist before broader federation

## Consequences

Positive:

- preserves local audit ergonomics
- enables future multi-repo coordination without forcing infrastructure
- limits blast radius of shared runtime mistakes

Negative:

- federation setup is more explicit
- some cross-repo automation remains manual until exploitation runbooks mature

## Risks

- users may expect shared runtime to synchronize more than coordination metadata
- optional PostgreSQL paths may drift from SQLite without parity tests
- local-only pilot validation can leak details if fixtures are not sanitized

## Follow-Up

- keep shared runtime locator validation strict
- require explicit multi-repo test fixtures before expanding the shared-surface list
- keep `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md` synchronized with this ADR
