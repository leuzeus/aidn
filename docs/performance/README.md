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
- `sql/schema.sql` - proposed SQLite schema for future index backend

## Commands

```bash
npm run perf:collect -- --event "{\"skill\":\"context-reload\",\"phase\":\"end\",\"event\":\"reload_summary\",\"duration_ms\":820,\"gates_triggered\":[\"R01\"]}"
npm run perf:report
npm run perf:index -- --target ../client-repo
```

Default runtime outputs:
- `.aidn/runtime/perf/workflow-events.ndjson`
- `.aidn/runtime/index/workflow-index.json`

These runtime artifacts are intentionally local and ignored by git.
