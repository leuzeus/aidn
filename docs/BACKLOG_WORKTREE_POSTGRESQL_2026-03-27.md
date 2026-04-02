# Backlog - Worktree and PostgreSQL Support

Date: 2026-03-27
Status: proposed, codebase-validated on 2026-03-28, pilot-validated on `G:/projets/gowire` on 2026-04-02
Scope: executable backlog for adding optional shared runtime support across Git worktrees and introducing PostgreSQL for shared coordination state without breaking the current local SQLite-centered runtime.

Reference plan:

- `docs/PLAN_WORKTREE_POSTGRESQL_2026-03-27.md`

## Validated Baseline

These capabilities already exist and should be preserved, not re-invented:

- state modes: `files`, `dual`, `db-only`
- index projection modes: `file`, `sql`, `dual`, `sqlite`, `dual-sqlite`, `all`
- local SQLite index storage and admin commands
- SQLite-backed fileless/runtime-head fallback for several `docs/audit/*` readers
- versioned workflow surfaces under `docs/audit/*`
- optional durable project adapter under `.aidn/project/workflow.adapter.json`
- target-root anchored runtime/config paths under `.aidn/*`

## Priority Legend

- **P0**: must land first or other work is mis-scoped
- **P1**: core implementation slices
- **P2**: hardening and regression coverage
- **P3**: migration and rollout polish

## Delivery Rules

- preserve current local behavior when no shared-runtime config is provided
- do not share `docs/audit/*` out-of-band
- do not try to replace all SQLite reads with PostgreSQL in one pass
- separate shared-backend selection from current `artifactImportStore` / index projection settings

## P0 - Foundation And Scope Control

### BK-1. Freeze the current runtime surface inventory
**Priority:** P0  
**Status today:** implemented in `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md` as the current single source of truth for runtime path scope and regression rules

**Goal:** document which runtime/config/artifact paths are versioned, local, shared-candidate, or ephemeral.

**Current code signal:**
- `docs/audit/*` and `AGENTS.md` are checkout-visible workflow artifacts
- `.aidn/config.json` and `.aidn/runtime/*` are target-local runtime paths
- `.aidn/project/workflow.adapter.json` is a durable project config path that may be versioned by the client repo

**Deliverables:**
- artifact scope matrix
- explicit non-share list
- explicit shared-candidate list
- regression rules for `files|dual|db-only`

**Validation criteria:**
- every currently written runtime path has a declared scope
- the plan no longer implies that all AIDN artifacts should be shared across worktrees

### BK-2. Extend the VCS adapter with worktree identity primitives
**Priority:** P0  
  **Status today:** implemented; fixture coverage plus a real `G:/projets/gowire` linked-worktree pilot now validate distinct `worktree_id`, shared `git_common_dir`, and stable worktree identity across real checkouts

**Goal:** expose the Git facts required to distinguish current worktree identity from logical workspace identity.

**Current code signal:**
- the adapter already exposes current branch and `git rev-parse --show-toplevel`
- there is no `git common-dir` or linked-worktree detection API

**Deliverables:**
- VCS port additions for `gitCommonDir`, `worktreeRoot`, and linked-worktree detection
- local Git adapter implementation
- fixture coverage for main checkout and linked worktrees

**Validation criteria:**
- sibling worktrees resolve the same Git common-dir
- the runtime can tell main checkout from linked worktree

### BK-3. Add a dedicated workspace-resolution service
**Priority:** P0  
  **Status today:** implemented; fixture coverage plus a real `G:/projets/gowire` two-worktree pilot now validate stable `workspace_id` resolution and normal runtime-command adoption without ad hoc root guessing

**Goal:** compute `workspace_id`, `worktree_root`, `repo_root`, `git_common_dir`, and shared-runtime mode from one resolver.

**Dependencies:** BK-1, BK-2

**Deliverables:**
- new workspace-resolution module
- deterministic workspace ID derivation
- explicit fallback order: CLI > env > trusted config > Git > local-only fallback

**Validation criteria:**
- the same repository opened through two worktrees resolves the same `workspace_id`
- no caller needs to guess shared vs local roots ad hoc

### BK-4. Introduce a shared-runtime locator model separate from `.aidn/config.json`
**Priority:** P0  
**Status today:** implemented with `.aidn/project/shared-runtime.locator.json`, validation, resolver integration, and local-only fallback

**Goal:** stop overloading target-local runtime defaults as if they were shared-workspace configuration.

**Dependencies:** BK-1, BK-3

**Deliverables:**
- explicit locator/config schema for shared runtime
- backend kind field
- locator validation rules
- local-only default behavior retained

**Validation criteria:**
- users can opt into shared runtime without silently relocating all of `.aidn/`
- `.aidn/config.json` is no longer the implicit shared-workspace contract

## P1 - Core Runtime Changes

### BK-5. Add workspace metadata to handoff and runtime digests
**Priority:** P1  
**Status today:** implemented across runtime/handoff digests and admission payloads with safe optional-field compatibility

**Goal:** keep handoff logical-first while letting another worktree re-anchor the same shared workspace.

**Current code signal:**
- handoff already carries scope, branch, logical artifact refs, and routing intent
- it does not carry workspace identity or shared backend info

**Dependencies:** BK-3, BK-4

**Deliverables:**
- `workspace_id`
- `worktree_id`
- `shared_backend_kind`
- shared-runtime locator reference
- compatibility behavior for older packets

**Validation criteria:**
- another worktree can re-anchor shared state without relying on raw paths alone
- old handoff packets still degrade safely

### BK-6. Add strict locator/path validation for shared runtime admission
**Priority:** P1  
**Status today:** implemented with shared-runtime validation, cross-platform path helpers, mismatch rejection, and surfaced validation status in runtime outputs

**Goal:** validate shared-runtime locators with the same rigor already expected for workflow path handling.

**Dependencies:** BK-4, BK-5

**Deliverables:**
- normalization rules
- canonicalization rules
- trusted-root checks
- mismatch rejection when locator metadata disagrees with workspace identity

**Validation criteria:**
- invalid shared roots or injected paths are rejected
- handoff/runtime bootstrap cannot silently cross into another workspace

### BK-7. Extract a shared-state backend seam from SQLite-specific runtime reads
**Priority:** P1  
**Status today:** implemented with a dedicated shared-state backend port/service, SQLite compatibility backend, and explicit `sqlite-file` / `postgres local-compat` projection behavior

**Goal:** create a real seam for shared coordination state instead of branching directly on local SQLite everywhere.

**Current code signal:**
- many modules branch directly on `json` vs `sqlite`
- local SQLite payloads/runtime heads are used by DB-first fallback readers

**Dependencies:** BK-3, BK-4

**Deliverables:**
- shared-state interface for coordination data
- SQLite-backed implementation for compatibility
- caller updates in handoff/runtime/coordination flows

**Validation criteria:**
- shared coordination reads do not depend directly on local SQLite internals
- local SQLite projection/fileless support still works

### BK-8. Preserve the existing local SQLite projection path
**Priority:** P1  
  **Status today:** implemented and protected by explicit regression coverage

**Goal:** keep current JSON/SQL/SQLite projection behavior working for local runtime, repair, and fileless reconstruction.

**Dependencies:** BK-7

**Deliverables:**
- explicit non-regression coverage for local SQLite projection
- clarified ownership of `workflow-index.sqlite` as local projection/cache unless explicitly configured otherwise
- no forced PostgreSQL migration for current users

**Validation criteria:**
- current `files|dual|db-only` flows still pass locally
- SQLite admin commands remain valid for local SQLite usage

### BK-9. Define the PostgreSQL shared-state schema and adapter scope
**Priority:** P1  
  **Status today:** implemented with contract, schema, adapter/store, optional `pg` packaging, and dedicated status/bootstrap/migrate admin flows

**Goal:** add PostgreSQL only for the shared coordination data that truly needs multi-writer support.

**Dependencies:** BK-7, BK-8

**Deliverables:**
- PostgreSQL adapter contract
- initial schema for workspace identity, shared planning, handoff relay, and coordination records
- connection/bootstrap model
- driver selection and packaging decision

**Validation criteria:**
- PostgreSQL scope is explicit and does not pretend to replace every SQLite table on day one
- packaging/runtime dependency impact is understood

### BK-10. Implement PostgreSQL shared backend support
**Priority:** P1  
**Status today:** partial; adapter/store, targeted shared sync, health/status flows, optional `pg` packaging, and a live smoke harness are implemented, and a real `G:/projets/gowire` two-worktree pilot on 2026-04-02 validated `doctor`, `migrate`, `bootstrap`, `status`, `backup`, `restore`, shared handoff relay writes, and shared coordination record writes against a live PostgreSQL server; broad runtime read-surface adoption remains incomplete

**Goal:** make shared coordination state persist safely in PostgreSQL.

**Dependencies:** BK-9

**Deliverables:**
- connection handling
- shared write/read operations
- error classification
- health/status reporting

**Validation criteria:**
- several worktrees can read/write the same shared coordination scope safely
- backend selection is explicit and observable

### BK-11. Route only the intended shared coordination scope through the shared backend
**Priority:** P1  
**Status today:** partial; the `sqlite-file` boundary and live PostgreSQL handoff/coordination visibility are now validated on a real `G:/projets/gowire` two-worktree pilot, checkout-bound artifacts remain local, and the `session-plan` promotion path now updates `CURRENT-STATE.md` so shared planning becomes discoverable through standard status reads; the remaining gap is broader read/routing adoption beyond the currently exercised surfaces

**Goal:** keep checkout-bound artifacts local while exposing the right coordination state across worktrees.

**Dependencies:** BK-5, BK-7, BK-10

**Deliverables:**
- routing rules for shared coordination state
- routing rules for worktree-local runtime state
- compatibility policy for projected artifacts and local SQLite caches

**Validation criteria:**
- `docs/audit/*` is not silently externalized
- shared planning/coordination becomes visible across worktrees where intended
- local derived artifacts remain isolated unless deliberately rebuilt

## P2 - Hardening And Regression Coverage

### BK-12. Add real Git worktree fixtures
**Priority:** P2  
**Status today:** implemented via real `git worktree add` fixture coverage for the VCS adapter and workspace-resolution service

**Goal:** validate behavior against actual linked worktrees, not only path mocks.

**Dependencies:** BK-2, BK-3, BK-11

**Deliverables:**
- temporary repo fixture with main checkout and linked worktrees
- tests for shared `workspace_id`
- tests for distinct `worktree_id`
- tests for local-only fallback

**Validation criteria:**
- worktree resolution is deterministic in real Git topology

### BK-13. Add concurrency tests for shared coordination state
**Priority:** P2  
**Status today:** implemented with residual stress-validation risk; store-level multi-writer coverage exists for PostgreSQL shared coordination, a real linked-worktree fixture validates concurrent shared coordination routing across actual `git worktree add` checkouts, an explicit `sqlite-file` linked-worktree boundary fixture proves shared SQLite projection reuse while keeping shared coordination disabled, the live PostgreSQL smoke harness covers concurrent overlap behind `AIDN_PG_SMOKE_URL`, a manual real-server smoke passed on 2026-03-29, and a real `G:/projets/gowire` two-worktree pilot on 2026-04-02 produced shared planning revisions, shared handoff relay visibility, and shared coordination records with distinct `source_worktree_id` values; heavier sustained-contention validation remains an optional narrower follow-up rather than a blocker for this backlog slice

**Goal:** prove the shared backend behaves correctly under overlapping access.

**Dependencies:** BK-10, BK-11

**Deliverables:**
- multi-writer PostgreSQL tests
- explicit SQLite shared-file boundary tests
- consistency checks for relay/planning state

**Validation criteria:**
- PostgreSQL is measurably safer than shared SQLite for the targeted shared scope
- no silent corruption under expected overlap patterns

### BK-14. Harden Windows and Linux path behavior
**Priority:** P2  
**Status today:** implemented with a shared runtime-path helper, explicit `win32` and `linux` fixture coverage, and regular Perf KPI workflow execution

**Goal:** keep shared-runtime resolution portable across platforms.

**Dependencies:** BK-4, BK-6, BK-12

**Deliverables:**
- Windows normalization coverage
- Linux normalization coverage
- common validation helpers for locator/path admission

**Validation criteria:**
- the same logical locator semantics work on both platforms
- the implementation does not depend on symlink-only behavior

### BK-15. Add regression coverage for DB-first and fileless readers
**Priority:** P2  
**Status today:** implemented with dedicated shared-runtime regression fixtures covering `sqlite-file` shared-root reads, PostgreSQL `local-compat` reads, and repair-layer SQLite previews under fileless conditions

**Goal:** ensure the worktree/PostgreSQL changes do not break existing SQLite-based fallback readers.

**Dependencies:** BK-7, BK-8, BK-11

**Deliverables:**
- regression tests for runtime-head readers
- regression tests for fileless artifact reconstruction
- regression tests for repair-layer SQLite flows

**Validation criteria:**
- current DB-first/fileless behavior keeps working when shared-runtime support is introduced

## P3 - Migration And Rollout

### BK-16. Add PostgreSQL admin flows without regressing SQLite admin flows
**Priority:** P3  
  **Status today:** partial but narrowed; PostgreSQL `status`, `bootstrap`, `migrate`, `doctor`, `backup`, and `restore` CLIs now exist, schema-version/schema-drift inspection is explicit, local backup/export and snapshot replay flows exist, a manual real-server smoke passed on 2026-03-29, and a real `G:/projets/gowire` pilot on 2026-04-02 validated those admin flows against a live PostgreSQL backend; the remaining gap is the deeper schema upgrade/rollback lifecycle rather than baseline operational usability

**Goal:** provide setup/status/repair workflows for PostgreSQL while keeping current SQLite CLIs clear and valid.

**Dependencies:** BK-10

**Deliverables:**
- PostgreSQL bootstrap/init flow
- PostgreSQL status/health flow
- PostgreSQL migration flow
- explicit naming split from current SQLite `db-*` commands where necessary

**Validation criteria:**
- users can initialize and inspect the PostgreSQL backend without ambiguity
- SQLite admin commands remain clearly SQLite-specific

### BK-17. Add a repair/re-anchor flow for broken shared-runtime locators
**Priority:** P3  
**Status today:** implemented with a dedicated `shared-runtime-reanchor` CLI, malformed/unsafe/mismatched locator fixture coverage, and safe fallback to local-only mode

**Goal:** recover when a worktree loses or corrupts its shared-runtime configuration.

**Dependencies:** BK-4, BK-5, BK-6, BK-11

**Deliverables:**
- shared-runtime re-anchor command/flow
- mismatch diagnostics
- safe fallback to local-only mode when repair is not possible

**Validation criteria:**
- a broken worktree can be repaired without destructive reset
- failures are explicit and actionable

### BK-18. Document migration from local SQLite-only to shared runtime/PostgreSQL
**Priority:** P3  
**Status today:** implemented in dedicated migration guidance with explicit local-only, `sqlite-file`, PostgreSQL, repair, and rollback paths

**Goal:** let current users adopt the new model incrementally.

**Dependencies:** BK-8, BK-10, BK-11, BK-16

**Deliverables:**
- migration notes
- backend-selection guidance
- explicit "stay local SQLite" guidance
- examples for multi-worktree shared-runtime setup

**Validation criteria:**
- existing users can remain on local SQLite with no breakage
- shared-runtime/PostgreSQL adoption is incremental and reversible

## Recommended Landing Order

1. BK-1
2. BK-2
3. BK-3
4. BK-4
5. BK-5
6. BK-6
7. BK-7
8. BK-8
9. BK-9
10. BK-10
11. BK-11
12. BK-12
13. BK-13
14. BK-14
15. BK-15
16. BK-16
17. BK-17
18. BK-18

## Definition of Done

This backlog is complete when:

- local single-worktree behavior is unchanged unless shared runtime is explicitly enabled
- linked worktrees can resolve the same logical workspace safely
- only the intended coordination/runtime scope is shared across worktrees
- local SQLite projection and DB-first/fileless flows still work
- PostgreSQL supports the selected shared coordination scope
- Windows and Linux path handling is covered
- broken locator or handoff metadata is rejected or repairable
- migration and admin workflows are documented and usable
