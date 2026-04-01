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
