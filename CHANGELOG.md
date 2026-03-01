# Changelog

## Unreleased
- Add `IndexStore` abstraction for local workflow index output (`file|sql|dual`) in `tools/perf/index-sync.mjs`.
- Add shared SQL generation module (`tools/perf/index-sql-lib.mjs`) and reuse it from `index-to-sql`.
- Add `npm run perf:index-dual` for controlled dual-write output (JSON + SQL) without changing file-first source of truth.
- Add `tools/perf/index-query.mjs` and `npm run perf:index-query` for standard local index analytics queries.
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
