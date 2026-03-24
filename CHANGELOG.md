# Changelog

## Unreleased

## 0.5.1

- Refactor workflow transition handling around shared constants and helpers for `start-session`, `close-session`, handoff routing, and repair routing.
- Normalize runtime transition outputs and extend fixture coverage for extracted workflow decisions.
- Split and clean up BPMN documentation into focused views, align the macro workflow view, and document BPMN modeling/layout rules.
- Add stale merged cycle guard groundwork, shared topology classification, and related workflow diagram updates.

## 0.5.0-rc.1
- Complete DB-first fileless runtime support so `db-only` repositories remain readable by the assistant even when workflow markdown artifacts are not materialized on disk.
- Preserve `dual` compatibility by keeping artifacts reconstructible from SQLite and by fixing `db-only -> dual` migration to rematerialize missing hot workflow files from the database.
- Add runtime diagnostics and DB-first fallback coverage across hydrate-context, admissions, coordinator flows, integration risk, and workflow summary projectors.
- Add additive SQLite schema migrations `0002` through `0005` for `runtime_heads`, reconstructible `artifact_blobs`, `v_materializable_artifacts`, and hot artifact subtype/index normalization.
- Separate logical payload schema versioning from physical SQLite schema migration versioning to keep JSON/SQLite parity checks stable while allowing DB evolution.
- Extend migration and round-trip regression coverage for DB adoption, fileless `db-only`, dual rematerialization, and hot artifact rebuild workflows.

- Restore blocking `start-session` admission gates for branch compliance, session/cycle continuity, multi-cycle arbitration, and session-base continuity before generic runtime session-start processing.
- Route `branch-cycle-audit` through the same shared branch/session/cycle mapping layer as `start-session`, stopping on non-owned, missing, or ambiguous mappings before generic gating evaluation.
- Add shared workflow mapping helpers plus regression verifiers for `start-session` and `branch-cycle-audit`, and include them in context-resilience validation.
- Update workflow templates and installed-core fixture docs to reflect admission-first execution for `start-session` and `branch-cycle-audit`.
- Add durable project adapter config support via `.aidn/project/workflow.adapter.json`, plus `aidn project config` wizard/list/migration flows.
- Render `WORKFLOW.md`, `WORKFLOW_SUMMARY.md`, `CODEX_ONLINE.md`, and `index.md` deterministically from template + config instead of defaulting to free-form Codex migration.
- Preserve `baseline/current.md`, `baseline/history.md`, `parking-lot.md`, and `snapshots/context-snapshot.md` across reinstall according to explicit ownership classes.

## 0.4.0
- Add post-install workflow re-anchor artifacts: `WORKFLOW-KERNEL.md`, `CURRENT-STATE.md`, `REANCHOR_PROMPT.md`, `ARTIFACT_MANIFEST.md`, and `RUNTIME-STATE.md`.
- Add a mandatory pre-write gate in `AGENTS.md`, including explicit durable-write handling for `apply_patch` in recent Codex Windows flows.
- Add `aidn runtime project-runtime-state` and integrate runtime digest projection into `hydrate-context` for `dual` and `db-only` repositories.
- Surface runtime digest and stale current-state hints in agent-facing hook outputs.
- Extend workflow/runtime verification with current-state consistency fixtures, runtime-state projector checks, hydrate-context projection checks, and install/import propagation checks.
- Regenerate installed-core fixture and diagrams to reflect the `0.4.0` workflow/runtime model.

- Add npm-standard package metadata (`version`, `bin`, `files`, `engines`) and expose a new `aidn` CLI entrypoint.
- Add `bin/aidn.mjs` command router for installer/build/perf commands (`aidn install`, `aidn perf checkpoint`, etc.).
- Update install/perf docs to use package-driven execution (`npm install ...` + `npx aidn ...`) instead of direct repository path calls.
- Fix perf runtime execution from external client repos by resolving sub-scripts from aidn package paths and writing runtime outputs relative to `--target`.
- Harden SQLite index sync for mixed-structure repositories by upserting duplicate `cycle_id` rows instead of failing on unique constraint.
- Preserve customizable client files during install updates and add optional Codex-assisted migration pass (with safe fallback to keep files unchanged).
- Enforce Codex authentication (`codex login`) when `codex_online=true`, and skip AI migration when Codex is not authenticated.
- Make `index-sync --kpi-file` resolution backward-compatible: prefer `--target` path, fallback to current working directory when only global CI/runtime KPI file exists.
- Align `perf-kpi` CI runtime paths with fixture target runtime (`tests/fixtures/repo-installed-core/.aidn/runtime/*`) to avoid root-runtime path mismatches.
- Fix `delivery-window` to resolve event/state/run-id files relative to `--target` (same runtime location as session hooks).
- Expand installer placeholder handling: infer values from existing project files, prompt for missing values on first install, and auto-fill safe defaults in non-interactive runs.
- Fix `check-index-canonical-coverage` package execution by resolving internal `index-query` from package paths (no client `tools/perf` dependency).
- Add fallback lookup for canonical threshold targets (`docs/performance/INDEX_TARGETS.json`) from package defaults when missing in client repos.
- Fix `run-kpi-campaign` runtime path resolution so event/KPI/threshold/campaign outputs are written under `--target` and sub-scripts are resolved from package paths.
- Extend `perf:verify-cli-aliases` fixture to validate package-mode execution from a client repo (`cwd` on target), including `aidn perf campaign`.
- Add `aidn perf` preset threshold wrappers for package-mode workflows:
  - `index-thresholds` (`index-report` + `INDEX_TARGETS`)
  - `index-sync-thresholds` (`index-sync-report` + `INDEX_SYNC_TARGETS`)
  - `check-fallbacks` (`fallback-report` + `FALLBACK_TARGETS`)
- Installer now copies Codex skill source folders into client repos under `.codex/skills/*` (local/offline availability) in addition to `.codex/skills.yaml`.
- Install fixture verification now checks local skill presence (`.codex/skills/context-reload/SKILL.md`) to prevent regressions.
- Tighten Codex skill hygiene guardrails across workflow skills (read-only vs mutating boundaries, write-on-change expectations, explicit stop/confirmation points) and normalize spike branch recommendation to `spike/CXXX-<topic>`.

## 0.3.0
- Extend `IndexStore` abstraction for local workflow index output with SQLite modes (`sqlite|dual-sqlite|all`) in `tools/perf/index-sync.mjs`.
- Add shared SQL generation module (`src/lib/index/index-sql-lib.mjs`) and reuse it from `index-to-sql`.
- Add `npm run perf:index-dual` for controlled dual-write output (JSON + SQL) without changing file-first source of truth.
- Add `npm run perf:index-sqlite` and `npm run perf:index-all` convenience commands.
- Add SQLite import/export helpers (`index-sqlite-lib`, `perf:index-from-sqlite`) and parity verifier (`perf:index-verify-sqlite`).
- Extend index quality report/thresholds to evaluate SQL and SQLite parity independently and as aggregate parity status.
- Add `tools/perf/index-query.mjs` and `npm run perf:index-query` for standard local index analytics queries.
- Extend `tools/perf/index-query.mjs` with SQLite backend support (`--backend auto|json|sqlite`).
- Extend `perf-kpi` CI flow to refresh and publish `workflow-index.sqlite` artifacts.
- Add `tools/perf/index-verify-dual.mjs` and CI parity check to validate dual-write JSON/SQL consistency.
- Optimize index writes with content-equivalence checks (including JSON equivalence without `generated_at`) to reduce unnecessary rewrites.
- Add optional `--kpi-file` on index sync/checkpoint/hook to enrich index payload with `run_metrics`.
- Add SQL export/import support for `run_metrics` and `run-metrics` query mode in `perf:index-query`.
- Add CI option `strict_index_parity` (workflow_dispatch) and keep parity check non-blocking by default on PR.
- Add index quality reporting pipeline (`perf:index-report`, `perf:index-thresholds`, `perf:index-summary`) with targets in `docs/performance/INDEX_TARGETS.json`.
- Extend perf CI artifacts and job summary with index quality outputs (`index-parity`, `index-report`, `index-thresholds`, `index-summary`).
- Add CI option `strict_index_quality` (workflow_dispatch) for blocking index quality thresholds.
- Add KPI regression checker (`tools/perf/check-regression.mjs`) with targets in `docs/performance/REGRESSION_TARGETS.json`.
- Add CI option `strict_regression` (workflow_dispatch) for blocking KPI regression checks.
- Extend KPI markdown summary with regression status/checks and trend section over recent runs.
- Emit explicit `reload-check` events during checkpoints for better fallback observability.
- Add fallback storm reporting/checks (`tools/perf/report-fallbacks.mjs`, `docs/performance/FALLBACK_TARGETS.json`) and CI option `strict_fallback`.
- Extend KPI summary with fallback status/metrics/checks.
- Make fallback thresholds warmup-aware by checking adjusted metrics that exclude cold-start fallback reasons (`MISSING_CACHE`, `CORRUPT_CACHE`).
- Add persistent KPI history sync (`tools/perf/sync-kpi-history.mjs`) with dedup by `run_id` and bounded retention.
- Update regression checks to consume merged current + history runs (`kpi-history.ndjson`) for cross-run baseline.
- Update KPI summary trends/top-runs to use merged current + history runs.
- Add `perf:reset -- --keep-history` support to preserve cross-run KPI history when resetting runtime artifacts.
- Add adaptive warmup handling for regression checks (`REGRESSION_TARGETS.warmup`) with effective threshold/severity adjustments on short history windows.
- Add metric-specific warmup overrides (`rules[].warmup`) for regression checks (distinct effective thresholds by metric).
- Add CLI/CI warmup override controls for regression checks (workflow_dispatch inputs mapped to `check-regression` warmup options).
- Ensure CLI/CI warmup overrides are priority-applied over global and per-rule warmup target settings.
- Add shared perf I/O utility (`src/lib/index/io-lib.mjs`) and apply conditional write-on-change to KPI/regression/fallback/index reports and markdown summaries.
- Add `--json` output mode to `tools/perf/index-sync.mjs` and wire checkpoint summary events to effective index write counters.
- Add workflow structure profiling (`perf:structure`) with observed-profile detection (`legacy|modern|mixed|unknown`) and integrate it into reload/gating decisions for multi-version repositories.
- Add `perf:index-check` drift control for import/export sync (`index-sync --dry-run` digest compare, optional `--apply` rebuild).
- Add CI integration for `perf:index-check` with `strict_index_sync` workflow_dispatch option and artifact publishing (`index-sync-check.json`).
- Add `perf:index-sync-summary` markdown renderer and publish index sync drift summary in CI job summary/artifacts.
- Add dedicated multi-version structure fixtures (`legacy|modern|mixed`) and `perf:verify-structure` validator script.
- Run `perf:verify-structure` in `perf-kpi` CI workflow to prevent structure-profile regressions.
- Add index sync trend pipeline (`sync-index-sync-history`, `report-index-sync`, `INDEX_SYNC_TARGETS`, markdown trend summary) and publish artifacts in perf CI.
- Add optional checkpoint/hook `index-sync-check` execution (`--index-sync-check`, `--index-sync-check-strict`) with exported check JSON and summary-event integration.
- Extend checkpoint/hook index options with SQLite output support (`--index-store sqlite|dual-sqlite|all`, `--index-sqlite-output`).
- Enrich `index-sync-check` outputs with `reason_codes`, `drift_level`, numeric summary fields, and high-drift trend reporting.
- Extend `gating-evaluate` with `index_sync_drift` signal and L3 escalation path (`L3_INDEX_SYNC_DRIFT`) on high drift levels.
- Scope `index_sync_drift` gating signal to matching `target_root` to avoid cross-project false positives.
- Add `perf:verify-index-sync` fixture integration test (drift -> apply -> in-sync) and run it in perf CI.
- Add `perf:verify-index-sqlite` fixture integration test (sync + SQL parity + SQLite parity + export) and run it in perf CI.
- Isolate fixture verifier runtime outputs under `.aidn/runtime/index/fixtures/*` to avoid local test collisions.
- Fix `index-sync-check --apply` to write back to the provided `--index-file` path (custom output paths now converge correctly).
- Add `AIDN_INDEX_STORE_MODE` feature flag to set default index store mode for `index-sync`, `checkpoint`, and `workflow-hook` (CLI args still override).
- Add `perf:campaign` (`run-kpi-campaign`) to execute repeatable KPI validation campaigns across N iterations.
- Fix perf subcommand path resolution so running `aidn/tools/perf/*.mjs` from a client repo `cwd` works without requiring `tools/perf` inside the client repository.

## 0.2.0
- Add canonical rule index and workflow gates in `SPEC` (`SPEC-R01..SPEC-R11`).
- Upgrade AGENTS execution contract for session/cycle/intermediate branch ownership.
- Normalize cycle and session templates for state-oriented continuity and close resolution.
- Add new support docs/templates: `WORKFLOW_SUMMARY`, `CONTINUITY_GATE`, `RULE_STATE_BOUNDARY`, `incidents/TEMPLATE_INC_TMP`.
- Update installer manifests and verification set for new workflow artifacts.
- Update core Codex skill set/content and keep `.codex/skills.yaml` pinned to `v0.2.0` at install time.
- Regenerate `tests/fixtures/repo-installed-core` with the `0.2.0` workflow payload.

## 0.1.0
- Initial template-only release
