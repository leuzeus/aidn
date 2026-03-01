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
- `index-sync.mjs` - build a local JSON index from `docs/audit/*`
- `reload-check.mjs` - evaluate incremental/full/stop reload decision from digest + mapping
- `gating-evaluate.mjs` - evaluate L1/L2/L3 gating with conditional drift signals
- `checkpoint.mjs` - run reload-check + gate + index-sync as one checkpoint command
- `sql/schema.sql` - proposed SQLite schema for future index backend

## Commands

```bash
npm run perf:collect -- --event "{\"skill\":\"context-reload\",\"phase\":\"end\",\"event\":\"reload_summary\",\"duration_ms\":820,\"gates_triggered\":[\"R01\"]}"
npm run perf:report
npm run perf:index -- --target ../client-repo
npm run perf:reload-check -- --target ../client-repo
npm run perf:reload-check -- --target ../client-repo --write-cache
npm run perf:gate -- --target ../client-repo --mode COMMITTING
npm run perf:checkpoint -- --target ../client-repo --mode COMMITTING
```

Default runtime outputs:
- `.aidn/runtime/perf/workflow-events.ndjson`
- `.aidn/runtime/index/workflow-index.json`
- `.aidn/runtime/cache/reload-state.json`

These runtime artifacts are intentionally local and ignored by git.

## Gating Levels (implemented)

- L1 fast checks: digest + mapping (`perf:reload-check`)
- L2 conditional drift signals: objective delta, scope growth, cross-domain touch, stale drift-check, uncertain intent (`perf:gate`)
- L3 incident trigger: blocking L1 reasons or repeated fallback patterns (`perf:gate`)

`perf:checkpoint` orchestrates these steps and writes a summary event for KPI tracking.
