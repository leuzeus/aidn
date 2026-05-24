# Runtime Surface Scope Matrix

Date: 2026-03-28  
Status: current codebase inventory

Purpose:

- provide a single source of truth for runtime path scope
- separate checkout-bound artifacts from worktree-local runtime state and shared-runtime candidates
- define the no-regression rules for `files`, `dual`, and `db-only`

## Scope Classes

- `checkout-bound`: versioned or branch-visible files tied to the current checkout
- `worktree-local`: runtime/config state anchored under the selected target root
- `shared-candidate`: data that can be shared explicitly through the shared-runtime locator
- `ephemeral`: disposable runtime scratch or report outputs

## Matrix

| Path or surface | Scope | Shared by default | Current source of truth | Notes |
| --- | --- | --- | --- | --- |
| `docs/audit/*` | `checkout-bound` | no | worktree checkout | Must remain branch-visible and must not be externalized automatically. |
| `AGENTS.md` | `checkout-bound` | no | worktree checkout | Treated as workflow policy visible in the current checkout. |
| `.codex/*` | `checkout-bound` | no | worktree checkout | Local assistant/project scaffolding stays tied to the checkout content. |
| `.aidn/project/workflow.adapter.json` | `checkout-bound` or `worktree-local` | no | client repo decision | Durable project config; may be versioned by the client repository. |
| `.aidn/project/shared-runtime.locator.json` | `worktree-local` | no | current target root | Explicit locator for opting into shared runtime; not a shared store itself. |
| `.aidn/config.json` | `worktree-local` | no | current target root | Host-local/runtime-local defaults; not the shared-runtime contract. |
| `.aidn/runtime/index/workflow-index.sqlite` | `worktree-local` | no | current target root | Default local SQLite projection/cache. Under `postgres`, this remains the local compat projection. |
| `.aidn/runtime/index/*.json` | `worktree-local` | no | current target root | Local JSON/SQL/index exports remain target-root anchored. |
| `.aidn/runtime/context/*` | `worktree-local` | no | current target root | Hydrated context and runtime snapshots stay local to the executing worktree. |
| `.aidn/runtime/perf/*` | `ephemeral` | no | current target root | KPI, reports, thresholds, and scratch perf outputs are local runtime artifacts. |
| `.aidn/runtime/index/repair-layer*` | `ephemeral` | no | current target root | Repair-layer reports and triage outputs remain local and disposable. |
| shared locator `backend.kind=sqlite-file` root | `shared-candidate` | explicit only | locator target | Only the explicitly configured shared SQLite projection is shared. |
| shared locator `backend.kind=postgres` connection | `shared-candidate` | explicit only | locator target + env | Used only for shared coordination tables, not checkout-bound artifacts. |
| PostgreSQL `workspace_registry` / `worktree_registry` | `shared-candidate` | explicit only | shared backend | Shared workspace identity and worktree heartbeat state. |
| PostgreSQL `planning_states` | `shared-candidate` | explicit only | shared backend | Shared planning/dispatch metadata without replacing backlog artifacts. |
| PostgreSQL `handoff_relays` | `shared-candidate` | explicit only | shared backend | Shared handoff relay metadata while `HANDOFF-PACKET.md` remains local/versioned. |
| PostgreSQL `coordination_records` | `shared-candidate` | explicit only | shared backend | Shared coordination history without externalizing `COORDINATION-SUMMARY.md`. |

## Concept Source-Of-Truth Overlay

This overlay names the logical owner of key information concepts. It complements the physical path matrix above.

| Concept | `files` mode source | `dual` mode source | `db-only` mode source | Projection / cache |
| --- | --- | --- | --- | --- |
| Workflow rules | `docs/audit/SPEC.md` | same checkout-bound file | same checkout-bound file | generated summaries only |
| Project policy | `.aidn/project/workflow.adapter.json` | same local/project file | same local/project file | `WORKFLOW.md`, `CODEX_ONLINE.md`, `index.md` |
| Runtime defaults | `.aidn/config.json` | same worktree-local file | same worktree-local file | CLI status output |
| Session state | `docs/audit/sessions/S*.md` | runtime DB/index plus required Markdown projection | runtime DB, materialized on demand | `CURRENT-STATE.md`, runtime heads |
| Cycle state | `docs/audit/cycles/*/status.md` | runtime DB/index plus required Markdown projection | runtime DB, materialized on demand | `CURRENT-STATE.md`, runtime heads |
| Artifact inventory | checkout scan | runtime artifact store | runtime artifact store | SQLite/local exports, materialized docs |
| Runtime digests | generated Markdown files | runtime store plus generated Markdown | runtime store plus generated Markdown on demand | `RUNTIME-STATE.md`, `HANDOFF-PACKET.md` |
| Repair findings | local scan/report | repair-layer runtime tables | repair-layer runtime tables | repair reports and summaries |
| Coordination records | `.aidn/runtime/context/*` | local context or explicit shared backend | local context or explicit shared backend | `COORDINATION-LOG.md`, `COORDINATION-SUMMARY.md` |
| Agent roster | `docs/audit/AGENT-ROSTER.md` | same checkout-bound file | same checkout-bound file | health and selection summaries |
| CLI output contracts | package `src/core/contracts/cli-output/*.schema.json` | same package contract | same package contract | generated docs future |

## Mode Contract Summary

The overlay above describes where each concept lives. These are the operational guarantees the modes must preserve:

- `files`
  - checkout-bound artifacts are authoritative
  - local runtime projections are derived from the checkout
  - shared runtime is ignored unless a locator explicitly opts in
- `dual`
  - runtime DB and checkout-bound artifacts coexist
  - local SQLite/projection artifacts remain valid and must stay reconstructible
  - shared coordination may be enabled explicitly, but it never relocates checkout-bound paths
- `db-only`
  - the runtime DB becomes the primary source for supported runtime state
  - Markdown and other human-facing projections are materialized on demand
  - shared runtime remains opt-in and does not imply wholesale relocation of `.aidn/*`

Rules:

- checkout-bound artifacts remain local/versioned even when DB-backed runtime is enabled
- DB-backed runtime may become canonical for operational state, but Markdown projections remain audited project artifacts
- shared coordination stores only metadata explicitly listed in this matrix; they do not relocate `docs/audit/*`
- local SQLite under `.aidn/runtime/index/` is never shared by default

## Explicit Non-Share List

- `docs/audit/*`
- `AGENTS.md`
- `.codex/*`
- `.aidn/config.json`
- `.aidn/runtime/context/*`
- local repair reports, triage files, and perf outputs

## Explicit Shared-Candidate List

- `.aidn/project/shared-runtime.locator.json` as an opt-in locator only
- explicit `sqlite-file` shared projection root
- PostgreSQL shared coordination tables:
  - `workspace_registry`
  - `worktree_registry`
  - `planning_states`
  - `handoff_relays`
  - `coordination_records`

## Regression Rules

### `files`

- runtime readers continue to resolve from checkout/worktree-local files first
- no shared runtime is consulted unless explicitly configured by locator/env/CLI

### `dual`

- local projection artifacts remain valid under `.aidn/runtime/index/*`
- DB-first readers may use local SQLite fallback, but checkout-bound artifacts remain local/versioned

### `db-only`

- DB-first readers may reconstruct supported `docs/audit/*` artifacts from SQLite
- this remains valid when shared runtime is enabled through:
  - `sqlite-file` shared projection
  - `postgres` shared coordination with local SQLite compat projection
- repair-layer SQLite flows remain local-projection based

## Guardrails

- shared runtime must be explicit; there is no implicit relocation of all `.aidn/*`
- PostgreSQL shared coordination does not replace `workflow-index.sqlite` on day one
- raw paths coming from locator or handoff metadata must pass canonical shared-runtime validation

## Backup And Restore Boundaries

| Operation | Covers | Does not cover | Verification |
| --- | --- | --- | --- |
| `runtime db-backup` | local runtime projection and SQLite-backed runtime payloads | shared coordination PostgreSQL rows, checkout-bound docs | `npm run perf:verify-db-runtime-cli` |
| `runtime persistence-backup` | configured runtime persistence backend for the selected scope | shared coordination metadata | `npm run perf:verify-runtime-persistence-parity` |
| `runtime shared-coordination-backup` | explicit shared coordination metadata | local `workflow-index.sqlite`, `docs/audit/*`, `.codex/*` | `npm run perf:verify-shared-coordination-backup` |
| `runtime shared-coordination-restore` | selected shared coordination backup payload | checkout-bound artifacts and local runtime projection | `npm run perf:verify-shared-coordination-restore` |
| schema migration fixtures | schema compatibility and migration behavior | live PostgreSQL availability | `npm run perf:verify-db-schema-migrations` |

Operational rules:

- backup the surface you are about to mutate; one backup family is not a substitute for another
- preview restore/migration before write when the command supports it
- keep connection strings behind `env:*` references and scrub support artifacts before sharing
- rerun admission gates after restore because restored coordination metadata can be ahead of local Markdown projections

## Multi-Repo Federation Contract

Federation is an opt-in coordination contract, not a cloud mode and not a replacement for local audit artifacts.

Required inputs:

- a valid `.aidn/project/shared-runtime.locator.json`
- explicit `project_id`, `workspace_id` and per-worktree `worktree_id`
- an explicit backend: `sqlite-file` for controlled local experiments or `postgres` for multi-writer shared coordination
- environment-backed secrets such as `env:AIDN_PG_URL` when PostgreSQL is used

Allowed shared surfaces:

- `workspace_registry`
- `worktree_registry`
- `planning_states`
- `handoff_relays`
- `coordination_records`

Forbidden implicit sharing:

- `docs/audit/*`
- `AGENTS.md`
- `.codex/*`
- `.aidn/config.json`
- `.aidn/runtime/index/workflow-index.sqlite`
- local repair reports, local perf reports and hydrated context files

Validation:

- `npm run perf:verify-shared-runtime-locator`
- `npm run perf:verify-shared-coordination-multi-project`
- `npm run perf:verify-shared-coordination-worktree-concurrency`

Any future shared surface must update this matrix, ADR-0007, CLI status output contracts and fixture coverage before it is treated as stable.

Shared coordination access is expected to pass through the port contract described in `docs/ADR/ADR-0008-shared-coordination-ports.md` before any new shared behavior is considered stable.

That port contract is implemented by `src/core/ports/shared-coordination-store-port.mjs` and asserted by the PostgreSQL shared coordination adapter; future shared behavior should extend that contract rather than bypass it.
