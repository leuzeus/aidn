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
- `index-sync.mjs` - build index from `docs/audit/*` with `IndexStore` mode: `file|sql|dual`
- `index-store.mjs` - local `IndexStore` abstraction (file-first, SQL export optional)
- `index-to-sql.mjs` - export local index JSON to SQL import script (SQLite-friendly)
- `index-sql-lib.mjs` - shared SQL generation library used by index tooling
- `index-query.mjs` - run standard analytics queries on local index JSON
- `reload-check.mjs` - evaluate incremental/full/stop reload decision from digest + mapping
- `gating-evaluate.mjs` - evaluate L1/L2/L3 gating with conditional drift signals
- `checkpoint.mjs` - run reload-check + gate + index-sync as one checkpoint command
- `workflow-hook.mjs` - run checkpoint from session hooks (`session-start` / `session-close`)
- `delivery-window.mjs` - mark delivery start/end to compute overhead ratio against control time
- `check-thresholds.mjs` - compare KPI report against versioned thresholds
- `render-summary.mjs` - generate Markdown summary from KPI + threshold reports
- `reset-runtime.mjs` - clear local perf runtime artifacts before a fresh measurement run
- `sql/schema.sql` - proposed SQLite schema for future index backend

## Commands

```bash
npm run perf:collect -- --event "{\"skill\":\"context-reload\",\"phase\":\"end\",\"event\":\"reload_summary\",\"duration_ms\":820,\"gates_triggered\":[\"R01\"]}"
npm run perf:report
npm run perf:report -- --run-prefix session- --require-delivery
npm run perf:index -- --target ../client-repo
npm run perf:index -- --target ../client-repo --store sql --sql-output .aidn/runtime/index/workflow-index.sql
npm run perf:index-dual -- --target ../client-repo
npm run perf:index-sql -- --index-file .aidn/runtime/index/workflow-index.json --out .aidn/runtime/index/workflow-index.sql
npm run perf:index-query -- --query active-cycles --index-file .aidn/runtime/index/workflow-index.json
npm run perf:index-query -- --query artifacts-since --since 2026-03-01T00:00:00Z --index-file .aidn/runtime/index/workflow-index.json
npm run perf:reload-check -- --target ../client-repo
npm run perf:reload-check -- --target ../client-repo --write-cache
npm run perf:gate -- --target ../client-repo --mode COMMITTING
npm run perf:checkpoint -- --target ../client-repo --mode COMMITTING
npm run perf:session-start -- --target ../client-repo --mode COMMITTING
npm run perf:session-close -- --target ../client-repo --mode COMMITTING
npm run perf:delivery-start -- --target ../client-repo --mode COMMITTING
npm run perf:delivery-end -- --target ../client-repo --mode COMMITTING
npm run perf:check-thresholds -- --kpi-file .aidn/runtime/perf/kpi-report.json --targets docs/performance/KPI_TARGETS.json
npm run perf:render-summary -- --kpi-file .aidn/runtime/perf/kpi-report.json --thresholds-file .aidn/runtime/perf/kpi-thresholds.json --out .aidn/runtime/perf/kpi-summary.md
npm run perf:reset
```

Default runtime outputs:
- `.aidn/runtime/perf/workflow-events.ndjson`
- `.aidn/runtime/index/workflow-index.json`
- `.aidn/runtime/index/workflow-index.sql`
- `.aidn/runtime/cache/reload-state.json`
- `.aidn/runtime/perf/kpi-thresholds.json`
- `.aidn/runtime/perf/kpi-summary.md`

These runtime artifacts are intentionally local and ignored by git.

## IndexStore Modes

- `file` (default): writes JSON index only
- `sql`: writes SQL import script only
- `dual`: writes JSON + SQL in one run (controlled dual-write, non-blocking)

`perf:index` remains backward compatible and defaults to `file` mode.

## Standard Index Queries

- `active-cycles`: list active cycles (`OPEN|IMPLEMENTING|VERIFYING`)
- `artifacts-since`: list artifacts changed since an ISO timestamp (`--since` required)
- `cycle-files`: list mapped files for one cycle (`--cycle-id` required)

## Gating Levels (implemented)

- L1 fast checks: digest + mapping (`perf:reload-check`)
- L2 conditional drift signals: objective delta, scope growth, cross-domain touch, stale drift-check, uncertain intent (`perf:gate`)
- L3 incident trigger: blocking L1 reasons or repeated fallback patterns (`perf:gate`)

`perf:checkpoint` orchestrates these steps and writes a summary event for KPI tracking.

## Session Hook Integration (minimal)

- At session start: run `perf:session-start`
- At session close: run `perf:session-close`
- Default behavior is non-blocking (hook warns if checkpoint fails).
- Use `--strict` on `perf:hook` when you want blocking behavior.
- Optional index mode override on hooks: `--index-store file|sql|dual`.
- Session start stores a shared `run_id` in `.aidn/runtime/perf/current-run-id.txt`.
- Session close reuses that shared `run_id` when available, then clears the file.

## CI Integration

- A lightweight GitHub workflow is available: `.github/workflows/perf-kpi.yml`
- Triggers: `pull_request` and `workflow_dispatch`
- It executes:
  - `perf:session-start`
  - `perf:delivery-start`
  - `perf:delivery-end`
  - `perf:session-close`
  - `perf:report --run-prefix session- --require-delivery --json`
  - `perf:check-thresholds` (non-blocking by default in CI)
  - `perf:render-summary`
- It publishes:
  - `.aidn/runtime/perf/workflow-events.ndjson`
  - `.aidn/runtime/perf/kpi-report.json`
  - `.aidn/runtime/perf/kpi-thresholds.json`
  - `.aidn/runtime/perf/kpi-summary.md`
  - `.aidn/runtime/index/workflow-index.json`
  - `.aidn/runtime/index/workflow-index.sql`
- `workflow_dispatch` supports `strict_thresholds=true` to make threshold violations blocking.

Threshold source file:
- `docs/performance/KPI_TARGETS.json`

## Overhead Ratio Enablement

To avoid `overhead_ratio=n/a`, emit delivery window markers:
- `perf:delivery-start` before implementation window
- `perf:delivery-end` after implementation window

These events are marked as `control=false` and provide delivery duration for KPI ratio calculation.
If no explicit `--run-id` is passed, delivery markers reuse the shared run id from session hook automatically.
