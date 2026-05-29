# Plan - Worktree and PostgreSQL Support

Date: 2026-03-27
Status: proposed, codebase-validated on 2026-03-28
Scope: define a realistic implementation plan for optional multi-worktree shared runtime support and PostgreSQL-backed shared coordination, aligned with the current AIDN architecture.

## Validated Baseline

The current codebase already provides the following behavior and constraints:

- runtime state modes are `files`, `dual`, and `db-only`
- index projection modes are `file`, `sql`, `dual`, `sqlite`, `dual-sqlite`, and `all`
- the only implemented database backend is SQLite, via `node:sqlite`
- the runtime path inventory is now frozen in `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
- all runtime persistence is currently anchored under the selected `targetRoot`, especially:
  - `.aidn/config.json`
  - `.aidn/runtime/index/workflow-index.sqlite`
  - `.aidn/runtime/context/*`
- installed/versioned workflow artifacts stay under the worktree checkout, especially:
  - `docs/audit/*`
  - `AGENTS.md`
  - optional `.aidn/project/workflow.adapter.json`
- DB-backed fallback already exists: several runtime readers can reconstruct `docs/audit/*` artifacts from SQLite when files are absent
- handoff and runtime digests already prefer logical artifact references such as `docs/audit/...`, not arbitrary filesystem paths
- the local Git adapter now exposes `worktreeRoot`, `gitDir`, `gitCommonDir`, and linked-worktree detection, and real `git worktree add` fixtures validate the VCS adapter and workspace-resolution service against actual linked checkouts
- the codebase now has an initial PostgreSQL shared-coordination adapter/service, a connection/bootstrap model, and an initial SQL schema file
- targeted shared writes are wired for planning, handoff relay, user arbitration, and coordinator dispatch metadata, and initial shared reads now feed shared-planning routing, shared handoff relay fallback with explicit freshness arbitration and same-age divergence signaling, coordination summary/loop history, and shared-coordination status snapshots
- fixture-backed store-level multi-writer coverage now exists for PostgreSQL shared coordination, a real linked-worktree service-level fixture now validates shared backend routing across actual `git worktree add` checkouts, and an explicit `sqlite-file` linked-worktree boundary fixture now proves shared SQLite projection reuse while keeping shared coordination disabled; live PostgreSQL contention has now been validated manually on 2026-03-29 against a real server, but it is still not exercised by default CI
- dedicated shared-coordination status/bootstrap/migrate/doctor/backup/restore CLI flows now exist, PostgreSQL health inspection now exposes schema status/version drift explicitly, local shared-coordination backup/export and snapshot replay flows now exist, `pg` is now declared as an optional dependency in `package.json`, the regular Perf KPI workflow now runs the linked-worktree shared-coordination fixture plus DB-first/shared-runtime regression coverage and doctor/backup/restore coverage on PRs, and a live smoke harness covers both basic and concurrent shared writes behind `AIDN_PG_SMOKE_URL` as a local/manual validation path; there is still no full PostgreSQL schema upgrade/rollback lifecycle and the live smoke is intentionally not part of default GitHub CI
- shared-runtime path normalization and locator/path admission now use a common helper library with explicit `win32` and `linux` fixture coverage, and those cross-platform path checks run in the regular Perf KPI workflow
- a dedicated shared-runtime re-anchor CLI now repairs malformed, unsafe, or mismatched locator state without destructive reset, and migration guidance now documents local-only, `sqlite-file`, and PostgreSQL adoption paths

This means the repository is not starting from zero, but it is also not one refactor away from PostgreSQL or shared multi-worktree runtime.

## Problem Restatement

The actual gap is narrower than "share everything across worktrees".

Today, AIDN already keeps most durable workflow artifacts in versioned paths inside the checkout. The missing capability is:

- optional shared runtime and coordination state across multiple Git worktrees
- safe discovery of that shared state from each worktree
- a concurrent backend better suited than a shared SQLite file when several worktrees or processes can write at the same time

The plan must therefore preserve the existing versioned artifact contract while introducing an explicit shared-runtime model.

## What Must Stay Local Vs Shared

Canonical inventory:

- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`

### Versioned, checkout-bound artifacts

These should remain tied to the checked-out worktree content and should not be auto-shared through an external runtime root:

- `docs/audit/*`
- `AGENTS.md`
- `.codex/*`
- `.aidn/project/workflow.adapter.json` when committed by the client repository

Reason:

- these artifacts describe the branch/session/cycle state of the checked-out tree
- different worktrees may legitimately carry different versions of these files
- sharing them out-of-band would create branch drift and hidden state

### Worktree-local runtime state

These should stay local to the current worktree unless explicitly projected or rebuilt:

- `.aidn/config.json`
- `.aidn/runtime/index/workflow-index.sqlite` when used as a local projection/cache
- `.aidn/runtime/context/*`
- local repair reports, triage JSON, perf artifacts, and temporary runtime outputs

Reason:

- current code assumes these paths resolve from `targetRoot`
- several tools write branch-local or execution-local derived state there
- `.aidn/config.json` currently mixes host-local defaults with runtime settings and is not a safe shared contract yet

### Shared workspace/runtime candidates

The first shared scope should be limited to data that truly benefits from cross-worktree visibility:

- workspace identity and locator metadata
- shared backend selection
- durable multi-agent coordination records
- shared planning dispatch state
- optional shared handoff relay metadata
- optional shared canonical coordination tables backed by PostgreSQL

### Ephemeral state

These remain process-local and disposable:

- temp files
- transient CLI outputs
- one-shot repair working files
- benchmark scratch data

## Core Design Decisions

### 1. Add shared runtime as an explicit layer, not an implicit `.aidn/` relocation

Current code assumes `.aidn/` is under `targetRoot`. That behavior must remain the default.

Multi-worktree support should be opt-in through explicit shared-runtime resolution, not by assuming that every worktree magically points to the same `.aidn/` directory.

### 2. Do not treat PostgreSQL as a drop-in replacement for `workflow-index.sqlite`

The codebase is strongly coupled to SQLite today:

- index writers emit `.sqlite` outputs directly
- runtime readers branch on `json` vs `sqlite`
- DB admin flows are SQLite-only (`db-status`, `db-migrate`, `db-backup`)
- fileless reconstruction paths read from SQLite payloads and runtime heads

The first PostgreSQL milestone should therefore target shared coordination/state tables, not a forced replacement of every local SQLite projection.

### 3. Separate three concerns that are currently blended together

The current runtime model blends together:

- state mode (`files|dual|db-only`)
- projection format (`json|sql|sqlite` outputs)
- storage backend choice

Worktree/PostgreSQL support needs an explicit split:

- local projection mode: keep current JSON/SQL/SQLite outputs
- shared state backend: `none`, `sqlite-file`, or `postgres`
- workspace resolution mode: local-only vs shared-runtime aware

Without that split, PostgreSQL would be awkwardly overloaded into `artifactImportStore` or `indexStoreMode`, which would be misleading.

### 4. Use Git worktree identity, not just repository top-level

`git rev-parse --show-toplevel` is not enough to identify a logical workspace shared by multiple worktrees.

The new resolver should be able to derive at least:

- `worktreeRoot`
- `repoRoot` (current checkout top-level)
- `gitCommonDir`
- `workspaceId`
- `sharedRuntimeRoot` or shared backend locator

On Git repositories, `gitCommonDir` is the key primitive for recognizing sibling worktrees that belong to the same logical workspace.

### 5. Keep handoff logical-first

Current handoff/runtime artifacts mostly pass logical workflow references, which is good.

The extension should continue to prefer:

- `workspace_id`
- backend kind
- logical shared-runtime locator reference
- worktree identifier relative to the workspace

Raw absolute paths should be admitted only when strictly necessary and validated against trusted scope rules.

## Current Code Gaps To Close

### Gap A - No workspace resolver

Missing today:

- git common-dir detection
- linked-worktree vs main-checkout distinction
- stable workspace identity across worktrees
- shared runtime root discovery

### Gap B - Runtime paths are target-root anchored everywhere

Current default assumptions are baked into many readers/writers.

Examples of behavior that must become explicit instead of implicit:

- `.aidn/config.json` always resolves under `targetRoot`
- `.aidn/runtime/index/workflow-index.sqlite` always resolves under `targetRoot`
- DB-first fallback loads SQLite from `targetRoot/.aidn/runtime/index/workflow-index.sqlite`

### Gap C - Shared state is conflated with local SQLite projection

Today the "DB-backed" model mostly means "read/write local SQLite projection under the target".

That is useful, but it is not the same thing as cross-worktree shared state.

### Gap D - Handoff lacks workspace identity metadata

Current handoff packets include workflow scope and logical artifact references, but they do not include:

- workspace identity
- shared backend kind
- shared runtime locator
- worktree identity

### Gap E - Backend seams are too SQLite-specific

There is a `WorkflowStateStoreAdapter`, but most of the runtime read path still branches directly on SQLite behavior.

The seam that needs to exist for PostgreSQL is broader than the current write adapter.

## Target Architecture

### Workspace Resolution Layer

Introduce a dedicated workspace-resolution service that returns:

- `workspace_id`
- `worktree_root`
- `repo_root`
- `git_common_dir`
- `shared_runtime_mode`
- `shared_runtime_root`
- `shared_backend_kind`

Resolution order should be explicit:

1. CLI override
2. environment override
3. trusted config/runtime locator
4. Git-derived fallback
5. current local-only behavior

### Shared Runtime Locator

Introduce a shared-runtime locator separate from the current `.aidn/config.json` runtime defaults.

This locator should define, at minimum:

- shared runtime enabled/disabled
- backend kind
- backend connection or root reference
- workspace identity
- optional projection policy

The first implementation should allow a local-only fallback with zero behavior change for existing users.

### Local Projection Layer

Keep the existing projection behavior available:

- JSON index projection
- SQL export projection
- SQLite projection
- SQLite-based fileless fallback/materialization

This layer remains valuable even when PostgreSQL exists, because several runtime readers and repair flows already rely on it.

### Shared Backend Layer

Add a shared backend abstraction for cross-worktree coordination.

Initial backends:

- `sqlite-file` for explicit local/shared experiments where acceptable
- `postgres` for true multi-writer shared coordination

The shared backend should initially own only the data that must be shared across worktrees, not every existing artifact projection.

## Suggested Shared-State Scope For Phase 1

The first PostgreSQL-backed shared scope should be limited to coordination/state that is already conceptually shared:

- workspace registration
- handoff relay metadata
- shared planning dispatch metadata
- shared coordination digests that do not need to overwrite versioned `docs/audit/*`
- optional runtime heads for canonical shared coordination views

Do not start by moving all of the following into PostgreSQL:

- full index export generation
- every artifact blob used for fileless reconstruction
- all repair-layer historical data
- every existing SQLite admin workflow

Those can follow later if the shared backend proves stable and useful.

## Handoff And Safety Plan

### Handoff additions

Add the following logical fields to handoff/runtime packets:

- `workspace_id`
- `worktree_id`
- `shared_backend_kind`
- `shared_runtime_locator_ref`
- `shared_runtime_enabled`

### Validation rules

If a raw path is present anywhere in handoff or runtime bootstrap data:

- normalize it
- canonicalize it
- ensure it falls under an allowed trusted root
- reject traversal or unrelated external roots
- avoid printing it unless diagnostics require it

## Cross-Platform Rules

### Windows

- do not rely on symlink-only designs
- normalize drive letters and separators
- support explicit shared-runtime configuration without shell-specific tricks

### Linux

- support normal POSIX path resolution
- allow symlink-based helpers only as optional convenience, not as the contract

### Common rule

The design contract is explicit resolution plus validation, not filesystem magic.

## Implementation Phases

### Phase 0 - Freeze Current Invariants

Deliverables:

- written inventory of current runtime surfaces
- clear classification of versioned vs local vs shared candidates
- no-regression matrix for `files|dual|db-only`

### Phase 1 - Add Workspace Identity And Worktree Detection

Deliverables:

- VCS adapter extension for git common-dir/worktree identity
- workspace resolver module
- deterministic workspace ID derivation
- tests for main checkout vs linked worktree

### Phase 2 - Introduce Shared Runtime Locator

Deliverables:

- explicit config/env/CLI model for shared runtime
- local-only fallback preserved
- validated path/locator admission rules
- no silent redirection of existing `.aidn/` paths

### Phase 3 - Enrich Handoff And Runtime Digests

Deliverables:

- workspace metadata in handoff/runtime packets
- logical identifiers preferred over raw paths
- safe rejection of ambiguous locator data

### Phase 4 - Extract Shared-State Backend Seams

Deliverables:

- shared-state interface for coordination data
- removal of direct SQLite assumptions from the shared-state path
- SQLite projection path kept intact for local readers and repair flows

### Phase 5 - Add PostgreSQL Shared Backend

Deliverables:

- backend configuration model
- PostgreSQL connection bootstrap
- initial shared coordination schema
- shared read/write flows for the selected coordination scope
- health/status checks for the backend

### Phase 6 - Integrate Projection And Recovery Flows

Deliverables:

- optional local SQLite projection fed from shared state where required
- repair/re-anchor flow for broken shared-runtime locator data
- compatibility behavior for fileless/runtime-head readers

### Phase 7 - Hardening, Docs, And Rollout

Deliverables:

- worktree fixtures
- concurrency validation
- Windows/Linux path coverage
- updated install/runtime docs
- migration path from local SQLite-only setups

## Test Plan

### Worktree tests

- one repository with main checkout plus at least two linked worktrees
- deterministic `workspace_id` across those worktrees
- distinct `worktree_id` per checkout
- local-only fallback when no shared runtime is configured

### Regression tests

- existing `files`, `dual`, and `db-only` flows still pass without new shared-runtime config
- existing SQLite admin commands still work for local SQLite
- fileless reconstruction from SQLite still works where currently supported

### Backend tests

- explicit selection of local-only vs shared SQLite vs PostgreSQL
- PostgreSQL bootstrap/status/health checks
- concurrent writes on shared coordination records

### Security tests

- invalid shared root path
- invalid PostgreSQL locator/config
- handoff locator spoofing
- raw path traversal attempts
- workspace mismatch between worktree and backend metadata

### Cross-platform tests

- Windows absolute/relative path normalization
- Linux absolute/relative path normalization
- identical logical workspace resolution behavior on both platforms

## Risks

### 1. Overloading existing state-mode semantics

Risk:

- trying to express PostgreSQL entirely through current `stateMode` or `artifactImportStore` settings will produce confusing behavior

Mitigation:

- introduce a separate shared-backend concept

### 2. Breaking local SQLite/fileless flows

Risk:

- a full replacement of SQLite too early would regress repair-layer and DB-first runtime behavior

Mitigation:

- keep local SQLite projection intact while extracting shared-state seams

### 3. Sharing the wrong artifacts

Risk:

- externalizing `docs/audit/*` or other checkout-bound files would create invisible branch drift

Mitigation:

- keep versioned workflow artifacts worktree-local
- share coordination/runtime metadata first

### 4. Weak worktree identity

Risk:

- using only checkout top-level would fail to recognize sibling worktrees as one logical workspace

Mitigation:

- derive identity from Git common-dir plus explicit workspace config when provided

## Success Criteria

This initiative is successful when:

- existing single-worktree behavior remains unchanged by default
- linked worktrees can derive the same `workspace_id`
- shared runtime is opt-in and explicit
- SQLite remains fully usable for local setups
- PostgreSQL is available for shared concurrent coordination use
- worktree-local/versioned artifacts are not accidentally externalized
- handoff/runtime metadata can re-anchor the correct shared workspace safely
- path and locator spoofing are rejected

## Notes

This plan intentionally stages PostgreSQL behind workspace resolution and backend-seam extraction.

That ordering matches the current codebase. Adding PostgreSQL first would force large, brittle rewrites across modules that still assume local SQLite projection under `targetRoot/.aidn/runtime/index/workflow-index.sqlite`.
