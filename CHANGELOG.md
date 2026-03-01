# Changelog

## Unreleased
- Add npm-standard package metadata (`version`, `bin`, `files`, `engines`) and expose a new `aidn` CLI entrypoint.
- Add `bin/aidn.mjs` command router for installer/build/perf commands (`aidn install`, `aidn perf checkpoint`, etc.).
- Update install/perf docs to use package-driven execution (`npm install ...` + `npx aidn ...`) instead of direct repository path calls.
- Fix perf runtime execution from external client repos by resolving sub-scripts from aidn package paths and writing runtime outputs relative to `--target`.
- Harden SQLite index sync for mixed-structure repositories by upserting duplicate `cycle_id` rows instead of failing on unique constraint.

## 0.3.0
- Extend `IndexStore` abstraction for local workflow index output with SQLite modes (`sqlite|dual-sqlite|all`) in `tools/perf/index-sync.mjs`.
- Add shared SQL generation module (`tools/perf/index-sql-lib.mjs`) and reuse it from `index-to-sql`.
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
- Add shared perf I/O utility (`tools/perf/io-lib.mjs`) and apply conditional write-on-change to KPI/regression/fallback/index reports and markdown summaries.
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
