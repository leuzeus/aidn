# Performance Tooling (Lot 1 Start)

This folder tracks workflow performance rollout artifacts.

Core planning docs:
- `WORKFLOW_PERFORMANCE_PLAN.md`
- `PRIORITIZATION_MATRIX.md`
- `../rfc/RFC-0001-reload-incremental-gating-index.md`

## CLI Tools

The following scripts were added under `tools/perf/`:

- `collect-event.mjs` - append workflow events to NDJSON
- `report-kpi.mjs` - compute KPI summary from NDJSON
- `sync-kpi-history.mjs` - persist and deduplicate KPI runs across local iterations (`kpi-history.ndjson`)
- `index-sync.mjs` - build index from `docs/audit/*` with `IndexStore` mode: `file|sql|dual`
- `index-sync-check.mjs` - detect drift between on-disk index and fresh import from `docs/audit/*` (optional `--apply`)
- `render-index-sync-summary.mjs` - generate Markdown summary from index sync check JSON
- `sync-index-sync-history.mjs` - persist index sync check runs in NDJSON history
- `report-index-sync.mjs` - compute trend KPIs from index sync history
- `render-index-sync-report-summary.mjs` - generate Markdown trend summary from sync report + thresholds
- `verify-structure-profile-fixtures.mjs` - validate structure profile detection on legacy/modern/mixed fixtures
- `index-store.mjs` - local `IndexStore` abstraction (file-first, SQL export optional)
- `index-to-sql.mjs` - export local index JSON to SQL import script (SQLite-friendly)
- `index-sql-lib.mjs` - shared SQL generation library used by index tooling
- `index-query.mjs` - run standard analytics queries on local index JSON
- `index-verify-dual.mjs` - verify JSON/SQL dual-write parity from deterministic SQL regeneration
- `report-index.mjs` - compute index quality report (counts consistency, parity status, run-metrics presence)
- `render-index-summary.mjs` - generate Markdown summary from index report + index threshold checks
- `reload-check.mjs` - evaluate incremental/full/stop reload decision from digest + mapping
- `gating-evaluate.mjs` - evaluate L1/L2/L3 gating with conditional drift signals
- `checkpoint.mjs` - run reload-check + gate + index-sync as one checkpoint command
- `workflow-hook.mjs` - run checkpoint from session hooks (`session-start` / `session-close`)
- `delivery-window.mjs` - mark delivery start/end to compute overhead ratio against control time
- `check-thresholds.mjs` - compare KPI report against versioned thresholds
- `check-regression.mjs` - compare latest KPI run versus rolling history median
- `report-fallbacks.mjs` - compute fallback/storm metrics from workflow events (with warmup-adjusted metrics)
- `render-summary.mjs` - generate Markdown summary from KPI + threshold/regression/fallback reports
- `reset-runtime.mjs` - clear local perf runtime artifacts before a fresh measurement run
- `sql/schema.sql` - proposed SQLite schema for future index backend

## Commands

```bash
npm run perf:collect -- --event "{\"skill\":\"context-reload\",\"phase\":\"end\",\"event\":\"reload_summary\",\"duration_ms\":820,\"gates_triggered\":[\"R01\"]}"
npm run perf:report
npm run perf:report -- --run-prefix session- --require-delivery
npm run perf:sync-history -- --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --max-runs 200
npm run perf:index -- --target ../client-repo
npm run perf:index-check -- --target ../client-repo --strict
npm run perf:index-check -- --target ../client-repo --apply
npm run perf:index -- --target ../client-repo --store sql --sql-output .aidn/runtime/index/workflow-index.sql
npm run perf:index-dual -- --target ../client-repo
npm run perf:index-dual -- --target ../client-repo --kpi-file .aidn/runtime/perf/kpi-report.json
npm run perf:index -- --target ../client-repo --json
npm run perf:index -- --target ../client-repo --json --dry-run
npm run perf:index-sync-summary -- --check-file .aidn/runtime/index/index-sync-check.json --out .aidn/runtime/index/index-sync-summary.md
npm run perf:index-sync-history -- --check-file .aidn/runtime/index/index-sync-check.json --history-file .aidn/runtime/index/index-sync-history.ndjson --max-runs 200
npm run perf:index-sync-report -- --history-file .aidn/runtime/index/index-sync-history.ndjson --out .aidn/runtime/index/index-sync-report.json
npm run perf:index-sync-thresholds
npm run perf:index-sync-trend-summary -- --report-file .aidn/runtime/index/index-sync-report.json --thresholds-file .aidn/runtime/index/index-sync-thresholds.json --out .aidn/runtime/index/index-sync-trend-summary.md
npm run perf:verify-structure
npm run perf:index-sql -- --index-file .aidn/runtime/index/workflow-index.json --out .aidn/runtime/index/workflow-index.sql
npm run perf:index-query -- --query active-cycles --index-file .aidn/runtime/index/workflow-index.json
npm run perf:index-query -- --query artifacts-since --since 2026-03-01T00:00:00Z --index-file .aidn/runtime/index/workflow-index.json
npm run perf:index-query -- --query run-metrics --index-file .aidn/runtime/index/workflow-index.json --limit 30
npm run perf:structure -- --target ../client-repo --json
npm run perf:index-verify -- --index-file .aidn/runtime/index/workflow-index.json --sql-file .aidn/runtime/index/workflow-index.sql
node tools/perf/index-verify-dual.mjs --index-file .aidn/runtime/index/workflow-index.json --sql-file .aidn/runtime/index/workflow-index.sql --json > .aidn/runtime/index/index-parity.json
npm run perf:index-report -- --index-file .aidn/runtime/index/workflow-index.json --parity-file .aidn/runtime/index/index-parity.json --out .aidn/runtime/index/index-report.json
npm run perf:index-thresholds
npm run perf:index-summary -- --report-file .aidn/runtime/index/index-report.json --thresholds-file .aidn/runtime/index/index-thresholds.json --out .aidn/runtime/index/index-summary.md
npm run perf:reload-check -- --target ../client-repo
npm run perf:reload-check -- --target ../client-repo --write-cache
npm run perf:gate -- --target ../client-repo --mode COMMITTING
npm run perf:checkpoint -- --target ../client-repo --mode COMMITTING
npm run perf:checkpoint -- --target ../client-repo --mode COMMITTING --index-sync-check
npm run perf:session-start -- --target ../client-repo --mode COMMITTING
npm run perf:session-close -- --target ../client-repo --mode COMMITTING
npm run perf:delivery-start -- --target ../client-repo --mode COMMITTING
npm run perf:delivery-end -- --target ../client-repo --mode COMMITTING
npm run perf:check-thresholds -- --kpi-file .aidn/runtime/perf/kpi-report.json --targets docs/performance/KPI_TARGETS.json
npm run perf:check-regression -- --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --targets docs/performance/REGRESSION_TARGETS.json --out .aidn/runtime/perf/kpi-regression.json
npm run perf:check-regression -- --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --targets docs/performance/REGRESSION_TARGETS.json --warmup-enabled true --warmup-history-lt 5 --warmup-multiplier 1.4 --warmup-severity warn --out .aidn/runtime/perf/kpi-regression.json
npm run perf:fallback-report -- --file .aidn/runtime/perf/workflow-events.ndjson --run-prefix session- --out .aidn/runtime/perf/fallback-report.json
npm run perf:check-fallbacks
npm run perf:render-summary -- --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --thresholds-file .aidn/runtime/perf/kpi-thresholds.json --regression-file .aidn/runtime/perf/kpi-regression.json --fallback-report-file .aidn/runtime/perf/fallback-report.json --fallback-thresholds-file .aidn/runtime/perf/fallback-thresholds.json --out .aidn/runtime/perf/kpi-summary.md
npm run perf:reset
npm run perf:reset -- --keep-history
```

Default runtime outputs:
- `.aidn/runtime/perf/workflow-events.ndjson`
- `.aidn/runtime/index/workflow-index.json`
- `.aidn/runtime/index/workflow-index.sql`
- `.aidn/runtime/index/index-parity.json`
- `.aidn/runtime/index/index-report.json`
- `.aidn/runtime/index/index-thresholds.json`
- `.aidn/runtime/index/index-summary.md`
- `.aidn/runtime/cache/reload-state.json`
- `.aidn/runtime/perf/kpi-thresholds.json`
- `.aidn/runtime/perf/kpi-regression.json`
- `.aidn/runtime/perf/kpi-history.ndjson`
- `.aidn/runtime/perf/fallback-report.json`
- `.aidn/runtime/perf/fallback-thresholds.json`
- `.aidn/runtime/perf/kpi-summary.md`

These runtime artifacts are intentionally local and ignored by git.
Use `perf:reset -- --keep-history` if you want to preserve cross-run KPI history.

## IndexStore Modes

- `file` (default): writes JSON index only
- `sql`: writes SQL import script only
- `dual`: writes JSON + SQL in one run (controlled dual-write, non-blocking)

`perf:index` remains backward compatible and defaults to `file` mode.
`perf:index -- --dry-run --json` computes payload summary/digest without writing files.
`perf:index-check` compares current index digest against a dry-run import and can auto-apply with `--apply`.
`perf:index-verify` should pass when SQL output is generated from the same JSON payload and schema settings.
Index outputs are written conditionally: unchanged content is detected and not rewritten.
For JSON index, equivalence check ignores `generated_at` to avoid churn-only rewrites.
KPI/regression/fallback/index report and summary outputs are also written conditionally when content is unchanged.
Use `--kpi-file` to enrich index payload with `run_metrics` from `perf:report --json` output.

## Standard Index Queries

- `active-cycles`: list active cycles (`OPEN|IMPLEMENTING|VERIFYING`)
- `artifacts-since`: list artifacts changed since an ISO timestamp (`--since` required)
- `cycle-files`: list mapped files for one cycle (`--cycle-id` required)
- `run-metrics`: list KPI run metrics present in index payload

## Gating Levels (implemented)

- L1 fast checks: digest + mapping (`perf:reload-check`)
- L2 conditional drift signals: objective delta, scope growth, cross-domain touch, stale drift-check, uncertain intent, structure-mixed/version-stale signals (`perf:gate`)
- L3 incident trigger: blocking L1 reasons or repeated fallback patterns (`perf:gate`)

`perf:checkpoint` orchestrates these steps and writes a summary event for KPI tracking.
Checkpoint summary events now carry effective index write counters (`files_written_count`, `bytes_written`) from `index-sync --json`.
`perf:checkpoint --index-sync-check` also runs `index-sync-check` after index write and stores a check JSON (optional `--index-sync-check-strict` to fail on drift).

## Structure Profile (multi-version compatibility)

- `perf:structure` derives workflow profile from observed `docs/audit` structure (`legacy|modern|mixed|unknown`).
- Reload checks prioritize observed structure over declared `workflow_version` when selecting required artifacts.
- Mixed/unknown profile and declared-version-stale conditions are emitted as structured reason codes:
  - `STRUCTURE_MIXED_PROFILE`
  - `STRUCTURE_PROFILE_UNKNOWN`
  - `DECLARED_VERSION_STALE`
- Index quality thresholds can now enforce structure hygiene via numeric checks on:
  - `summary.structure.is_unknown`
  - `summary.structure.declared_version_looks_stale`

## Session Hook Integration (minimal)

- At session start: run `perf:session-start`
- At session close: run `perf:session-close`
- Default behavior is non-blocking (hook warns if checkpoint fails).
- Use `--strict` on `perf:hook` when you want blocking behavior.
- Optional index mode override on hooks: `--index-store file|sql|dual`.
- Optional checkpoint sync verification on hooks: `--index-sync-check` (or `--index-sync-check-strict`).
- Session start stores a shared `run_id` in `.aidn/runtime/perf/current-run-id.txt`.
- Session close reuses that shared `run_id` when available, then clears the file.

## CI Integration

- A lightweight GitHub workflow is available: `.github/workflows/perf-kpi.yml`
- Triggers: `pull_request` and `workflow_dispatch`
- It executes:
  - `perf:verify-structure`
  - `perf:session-start`
  - `perf:delivery-start`
  - `perf:delivery-end`
  - `perf:session-close`
  - `perf:report --run-prefix session- --require-delivery --json`
  - `perf:sync-history`
  - `perf:index-dual --kpi-file .aidn/runtime/perf/kpi-report.json`
  - `perf:index-check --json` (non-blocking by default in CI)
  - `perf:index-sync-summary`
  - `perf:index-sync-history`
  - `perf:index-sync-report`
  - `perf:index-sync-thresholds` (non-blocking by default in CI)
  - `perf:index-sync-trend-summary`
  - `perf:index-verify`
  - `perf:index-report`
  - `perf:index-thresholds`
  - `perf:index-summary`
  - `perf:check-thresholds` (non-blocking by default in CI)
  - `perf:check-regression` (non-blocking by default in CI)
  - `perf:fallback-report`
  - `perf:check-fallbacks` (non-blocking by default in CI)
  - `perf:render-summary`
- It publishes:
  - `.aidn/runtime/perf/workflow-events.ndjson`
  - `.aidn/runtime/perf/kpi-report.json`
  - `.aidn/runtime/perf/kpi-history.ndjson`
  - `.aidn/runtime/perf/kpi-thresholds.json`
  - `.aidn/runtime/perf/kpi-regression.json`
  - `.aidn/runtime/perf/fallback-report.json`
  - `.aidn/runtime/perf/fallback-thresholds.json`
  - `.aidn/runtime/perf/kpi-summary.md`
  - `.aidn/runtime/index/workflow-index.json`
  - `.aidn/runtime/index/workflow-index.sql`
  - `.aidn/runtime/index/index-sync-check.json`
  - `.aidn/runtime/index/index-sync-summary.md`
  - `.aidn/runtime/index/index-sync-history.ndjson`
  - `.aidn/runtime/index/index-sync-report.json`
  - `.aidn/runtime/index/index-sync-thresholds.json`
  - `.aidn/runtime/index/index-sync-trend-summary.md`
- `workflow_dispatch` supports `strict_thresholds=true` to make threshold violations blocking.
- `workflow_dispatch` supports `strict_index_parity=true` to make dual-write parity violations blocking.
- `workflow_dispatch` supports `strict_index_quality=true` to make index quality threshold violations blocking.
- `workflow_dispatch` supports `strict_index_sync=true` to make index import/export drift checks blocking.
- `workflow_dispatch` supports `strict_regression=true` to make KPI regression violations blocking.
- `workflow_dispatch` supports `strict_fallback=true` to make fallback-storm violations blocking.
- `workflow_dispatch` supports regression warmup overrides via `regression_warmup_enabled`, `regression_warmup_history_lt`, `regression_warmup_multiplier`, `regression_warmup_severity`.

Threshold source file:
- `docs/performance/KPI_TARGETS.json`
- `docs/performance/INDEX_TARGETS.json`
- `docs/performance/INDEX_SYNC_TARGETS.json`
- `docs/performance/REGRESSION_TARGETS.json`
- `docs/performance/FALLBACK_TARGETS.json`

Regression warmup note:
- `REGRESSION_TARGETS.json` supports a `warmup` block.
- Default warmup applies while `history_count < 5`: effective threshold is multiplied (`max_increase_pct_multiplier`) and severity can be overridden (default `warn`).
- Each regression rule can override warmup values via `rules[].warmup` (for metric-specific warmup factors).
- CLI/CI warmup overrides take precedence over both global and rule warmup settings.

Fallback thresholding note:
- Fallback thresholds use warmup-adjusted metrics (`adjusted_fallback_total`, `adjusted_storm_runs`) that exclude cold-start reload fallbacks (`MISSING_CACHE`, `CORRUPT_CACHE`).

## Overhead Ratio Enablement

To avoid `overhead_ratio=n/a`, emit delivery window markers:
- `perf:delivery-start` before implementation window
- `perf:delivery-end` after implementation window

These events are marked as `control=false` and provide delivery duration for KPI ratio calculation.
If no explicit `--run-id` is passed, delivery markers reuse the shared run id from session hook automatically.
