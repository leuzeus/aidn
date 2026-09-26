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

The 0.10.2 initial-cycle admission reads canonical session/current/runtime
artifacts and verifies their physical branch. An explicit absence of a cycle
has no cycle timestamp comparison to perform; this does not make an unknown
freshness value `ok`. The bounded `cycle-create` check retains all other gates,
requires a clear repair state and does not apply to native patch authorization.
The 0.10.3 correction recognizes the hook-produced `clean` repair state as well
as legacy `ok`, without rewriting canonical values or admitting warning,
blocking, or unknown repair states.
Runtime projection in db-only/PostgreSQL mode also resolves canonical artifacts
and refuses backend unavailability instead of substituting Markdown projections.

The 0.10.4 correction applies the same canonical reader to branch-audit ownership
and automatic reload/gating snapshots. Configured PostgreSQL cannot be displaced
by the default SQLite index path or a conflicting explicit backend. Branch audit
propagates gating refusal through its wrappers. Its repeated-fallback policy uses
a recent branch window and excludes explained normal reloads, without changing
canonical data, clearing event history or weakening anomaly refusal.

The 0.10.5 correction makes drift completion a specific local workflow event,
produced by the explicit drift skill after its current checks pass. Evaluation
does not require a prior occurrence of itself. Other admission conditions remain
independent; a generic evaluation, a warning, a stop or an event from another
branch cannot refresh the current branch's drift age. No canonical database
write or shared synchronization is introduced.

The 0.10.6 runtime projector derives repair status from the same freshly read
canonical snapshot used for its DB-backed context. An observed empty collection
is distinct from absent or malformed findings. Cached hook observations remain
ineligible as DB revision evidence and cannot replace the live repair summary.
Projection is read-only unless explicitly written to a file; persisting that
reviewed digest uses a separate selective artifact write. This introduces no
new shared coordination surface or implicit database mutation.

The 0.10.7 reader resolves PostgreSQL head metadata against the same scoped
snapshot using exact artifact path, identity and fingerprint. It shares this
resolution between admission and runtime projections. Historical normalized path
aliases are not removed or chosen by order/date; without a head, only a unique
matching artifact can be used. An invalid head refuses instead of falling back.
SQLite's already materialized artifact heads remain supported. This is read
resolution only, not a database migration or authority to rewrite old artifacts.

- align `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md` with the new ports
- map the port methods to adapter implementations and runtime use cases
- keep `ADR-0007` and the shared-surface gate synchronized with any port change
- the minimal shared coordination store port is implemented in `src/core/ports/shared-coordination-store-port.mjs` and asserted by the PostgreSQL shared coordination adapter
- runtime PostgreSQL now records `runtime_scope_id` and `project_context` separately from shared coordination rows so future platform dashboards can join by `project_id` without confusing projects
