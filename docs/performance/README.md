# Performance Tooling (Lot 2 Completed)

This folder tracks workflow performance rollout artifacts.

Execution model:
- Perf scripts live in the aidn package (`tools/perf/*`) and are executed via the npm CLI entrypoint `aidn`.
- They target client repositories via `--target <client-repo>`.
- They do not copy `tools/perf/*` into client repositories.
- Runtime outputs are written under `<target>/.aidn/runtime/*`.

Core planning docs:
- `WORKFLOW_PERFORMANCE_PLAN.md`
- `PRIORITIZATION_MATRIX.md`
- `PROCESS_ASIS_STATE.md`
- `PROCESS_OPTIMIZATION_PLAN.md`
- `PROCESS_MASTER_PLAN.md`
- `LOT0_BASELINE_REPORT.md`
- `LOT1_QUICK_WINS_REPORT.md`
- `LOT2_PULL_FLOW_REPORT.md`
- `LOT3_DB_INTEGRATION_REPORT.md`
- `../rfc/RFC-0001-reload-incremental-gating-index.md`

## CLI Tools

The following scripts were added under `tools/perf/`:

- `collect-event.mjs` - append workflow events to NDJSON
- `report-kpi.mjs` - compute KPI summary from NDJSON
- `sync-kpi-history.mjs` - persist and deduplicate KPI runs across local iterations (`kpi-history.ndjson`)
- `index-sync.mjs` - build index from `docs/audit/*` with `IndexStore` mode: `file|sql|dual|sqlite|dual-sqlite|all`
- `index-sync-check.mjs` - detect drift between on-disk index and fresh import from `docs/audit/*` (optional `--apply`)
- `index-sync-select-paths.mjs` - derive drift-driven path selection (`export-paths.txt`) from `index-sync-check` artifact mismatches
- `index-sync-reconcile.mjs` - end-to-end reconcile flow (`check -> select-paths -> apply -> selective export`)
- `render-index-sync-summary.mjs` - generate Markdown summary from index sync check JSON
- `sync-index-sync-history.mjs` - persist index sync check runs in NDJSON history
- `report-index-sync.mjs` - compute trend KPIs from index sync history
- `render-index-sync-report-summary.mjs` - generate Markdown trend summary from sync report + thresholds
- `verify-structure-profile-fixtures.mjs` - validate structure profile detection on legacy/modern/mixed fixtures
- `verify-skill-hook-coverage.mjs` - validate full perf hook coverage on codex skills templates
- `verify-index-sync-fixtures.mjs` - validate index sync drift/apply/in-sync flow on fixtures
- `verify-index-sync-select-paths-fixtures.mjs` - validate drift-driven path selection and selective export flow on fixtures
- `verify-index-reconcile-fixtures.mjs` - validate reconcile flow across drift then idempotent pass on fixtures
- `verify-checkpoint-index-sync-backend-fixtures.mjs` - validate `checkpoint --index-sync-check` backend routing (`dual` -> JSON, `sqlite` -> SQLite)
- `verify-index-sqlite-fixtures.mjs` - validate SQLite index flow (sync + SQL parity + SQLite parity + export)
- `verify-index-canonical-check-fixtures.mjs` - validate lightweight canonical coverage check (strict/non-strict) on fixtures
- `verify-index-regression-fixtures.mjs` - validate index regression pipeline and zero-baseline handling on fixtures
- `verify-index-export-filter-fixtures.mjs` - validate selective export/projection via `--only-path` on fixtures
- `verify-support-artifacts-fixtures.mjs` - validate import/export coverage for support artifacts (`reports/`, `migration/`, `backlog/`, `incidents/`)
- `verify-db-only-hooks-fixtures.mjs` - validate runtime session hooks in `db-only` mode (`session-start`/`session-close`)
- `verify-perf-cli-aliases-fixtures.mjs` - validate `aidn perf` aliases for canonical/index commands on fixtures
- `verify-install-import-fixtures.mjs` - validate installer artifact import behavior and backend precedence
- `verify-state-mode-parity-fixtures.mjs` - validate `dual` vs `db-only` parity for reload + gating decisions on fixtures
- `index-store.mjs` - local `IndexStore` abstraction (JSON/SQL/SQLite outputs)
- `index-to-sql.mjs` - export local index JSON to SQL import script (SQLite-friendly)
- `index-sql-lib.mjs` - shared SQL generation library used by index tooling
- `index-sqlite-lib.mjs` - shared SQLite read helpers for export/parity tooling
- `index-query.mjs` - run standard analytics queries on local index JSON or SQLite index
- `check-index-canonical-coverage.mjs` - lightweight canonical coverage check directly from index query output
- `render-index-canonical-check-summary.mjs` - render concise Markdown summary for canonical coverage check output
- `index-verify-dual.mjs` - verify JSON/SQL dual-write parity from deterministic SQL regeneration
- `index-from-sqlite.mjs` - export SQLite index back to JSON (derived artifact)
- `index-export-files.mjs` - reconstruct `docs/audit/*` artifacts from index payload content (JSON or SQLite backend)
- `index-verify-sqlite.mjs` - verify JSON/SQLite parity from deterministic projection
- `report-index.mjs` - compute index quality report (counts consistency, SQL+SQLite parity status, run-metrics presence)
- `report-index-regression-kpi.mjs` - convert index quality report into regression KPI input (`runs[]`)
- `render-index-summary.mjs` - generate Markdown summary from index report + index threshold checks
- `reload-check.mjs` - evaluate incremental/full/stop reload decision from digest + mapping
- `gating-evaluate.mjs` - evaluate L1/L2/L3 gating with conditional drift signals
- `checkpoint.mjs` - run reload-check + gate + index-sync as one checkpoint command
- `skill-hook.mjs` - route skill-level perf hooks to the right runtime tool (`reload-check|gate|checkpoint|hook`)
- `workflow-hook.mjs` - run checkpoint from session hooks (`session-start` / `session-close`)
- `delivery-window.mjs` - mark delivery start/end to compute overhead ratio against control time
- `check-thresholds.mjs` - compare KPI report against versioned thresholds
- `check-thresholds-defaults.mjs` - run threshold checks from preset defaults (`index|index-sync|fallback`) with package fallback targets
- `check-regression.mjs` - compare latest KPI run versus rolling history median
- `report-fallbacks.mjs` - compute fallback/storm metrics from workflow events (with warmup-adjusted metrics)
- `report-constraints.mjs` - identify active workflow bottleneck (TOC) from perf events with skill-level shares and recommendations
- `run-kpi-campaign.mjs` - run repeated session/delivery cycles and emit KPI/threshold campaign summary
- `render-summary.mjs` - generate Markdown summary from KPI + threshold/regression/fallback reports
- `reset-runtime.mjs` - clear local perf runtime artifacts before a fresh measurement run
- `sql/schema.sql` - SQLite schema used by SQL export and SQLite index mode

## Commands

Package CLI (recommended in client repos):

```bash
npx aidn perf checkpoint --target . --mode COMMITTING --index-store all --index-sync-check --json
npx aidn perf skill-hook --skill context-reload --target . --mode THINKING --json
npx aidn perf session-start --target . --mode COMMITTING --json
npx aidn perf session-close --target . --mode COMMITTING --json
npx aidn perf index --target . --store all --json
npx aidn perf index-select-paths --target . --check-file .aidn/runtime/index/index-sync-check.json --out .aidn/runtime/index/export-paths.txt --include-types missing_in_index,digest_mismatch
npx aidn perf index-reconcile --target . --index-file .aidn/runtime/index/workflow-index.json --check-file .aidn/runtime/index/index-sync-check.json --paths-file .aidn/runtime/index/export-paths.txt --audit-root docs/audit
npx aidn perf index-check --target . --index-file .aidn/runtime/index/workflow-index.sqlite --index-backend sqlite --json
npx aidn perf index-reconcile --target . --index-file .aidn/runtime/index/workflow-index.sqlite --index-backend sqlite --check-file .aidn/runtime/index/index-sync-check.json --paths-file .aidn/runtime/index/export-paths.txt --audit-root docs/audit
npx aidn perf index-export-files --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --target . --audit-root docs/audit
npx aidn perf index --target . --store all --no-content --json
npx aidn perf index-export-files --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --target . --audit-root docs/audit --render-markdown
npx aidn perf index-canonical-check --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --targets docs/performance/INDEX_TARGETS.json --json
npx aidn perf index-canonical-summary --check-file .aidn/runtime/index/index-canonical-check.json --out .aidn/runtime/index/index-canonical-check-summary.md
npx aidn perf index-thresholds --target . --json
npx aidn perf index-sync-thresholds --target . --json
npx aidn perf check-fallbacks --target . --json
npx aidn perf constraint-report --file .aidn/runtime/perf/workflow-events.ndjson --run-prefix session- --out .aidn/runtime/perf/constraint-report.json --json
```

Repository scripts (maintainer/dev mode):

```bash
npm run perf:collect -- --event "{\"skill\":\"context-reload\",\"phase\":\"end\",\"event\":\"reload_summary\",\"duration_ms\":820,\"gates_triggered\":[\"R01\"]}"
npm run perf:report
npm run perf:report -- --run-prefix session- --require-delivery
npm run perf:sync-history -- --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --max-runs 200
npm run perf:index -- --target ../client-repo
npm run perf:index-check -- --target ../client-repo --strict
npm run perf:index-check -- --target ../client-repo --apply
npm run perf:index-select-paths -- --target ../client-repo --check-file .aidn/runtime/index/index-sync-check.json --out .aidn/runtime/index/export-paths.txt
npm run perf:index-reconcile -- --target ../client-repo --index-file .aidn/runtime/index/workflow-index.json --check-file .aidn/runtime/index/index-sync-check.json --paths-file .aidn/runtime/index/export-paths.txt --audit-root docs/audit
npm run perf:index-check -- --target ../client-repo --index-file .aidn/runtime/index/workflow-index.sqlite --index-backend sqlite --json
npm run perf:index-reconcile -- --target ../client-repo --index-file .aidn/runtime/index/workflow-index.sqlite --index-backend sqlite --check-file .aidn/runtime/index/index-sync-check.json --paths-file .aidn/runtime/index/export-paths.txt --audit-root docs/audit
npm run perf:index -- --target ../client-repo --store sql --sql-output .aidn/runtime/index/workflow-index.sql
npm run perf:index-sqlite -- --target ../client-repo
npm run perf:index -- --target ../client-repo --store all --sqlite-output .aidn/runtime/index/workflow-index.sqlite
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
npm run perf:verify-skill-hooks
npm run perf:verify-index-sync
npm run perf:verify-index-sync-select-paths
npm run perf:verify-index-reconcile
npm run perf:verify-index-reconcile-sqlite
npm run perf:verify-checkpoint-index-sync-backend
npm run perf:verify-index-sqlite
npm run perf:verify-index-canonical-check
npm run perf:verify-index-regression
npm run perf:verify-index-export-filter
npm run perf:verify-support-artifacts
npm run perf:verify-db-only-hooks
npm run perf:verify-cli-aliases
npm run perf:verify-constraint-report
npm run perf:verify-install-import
npm run perf:verify-state-mode-parity
npm run perf:index-sql -- --index-file .aidn/runtime/index/workflow-index.json --out .aidn/runtime/index/workflow-index.sql
npm run perf:index-from-sqlite -- --sqlite-file .aidn/runtime/index/workflow-index.sqlite --out .aidn/runtime/index/workflow-index.from-sqlite.json
npm run perf:index-export-files -- --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --target ../client-repo --audit-root docs/audit
npm run perf:index-export-files -- --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --target ../client-repo --audit-root docs/audit --no-render-markdown
npm run perf:index-export-files -- --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --target ../client-repo --audit-root docs/audit --only-path reports/R001-latency-review.md --only-path backlog/BL001-perf-followups.md
npm run perf:index-verify-sqlite -- --index-file .aidn/runtime/index/workflow-index.json --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json
npm run perf:index-query -- --query active-cycles --index-file .aidn/runtime/index/workflow-index.json
npm run perf:index-query -- --query active-cycles --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite
npm run perf:index-query -- --query artifacts-since --since 2026-03-01T00:00:00Z --index-file .aidn/runtime/index/workflow-index.json
npm run perf:index-query -- --query run-metrics --index-file .aidn/runtime/index/workflow-index.json --limit 30
npm run perf:structure -- --target ../client-repo --json
npm run perf:index-verify -- --index-file .aidn/runtime/index/workflow-index.json --sql-file .aidn/runtime/index/workflow-index.sql
node tools/perf/index-verify-dual.mjs --index-file .aidn/runtime/index/workflow-index.json --sql-file .aidn/runtime/index/workflow-index.sql --json > .aidn/runtime/index/index-parity.json
npm run perf:index-report -- --index-file .aidn/runtime/index/workflow-index.json --parity-file .aidn/runtime/index/index-parity.json --sqlite-parity-file .aidn/runtime/index/index-sqlite-parity.json --out .aidn/runtime/index/index-report.json
npm run perf:index-thresholds
npm run perf:index-canonical-check -- --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --targets docs/performance/INDEX_TARGETS.json --out .aidn/runtime/index/index-canonical-check.json
npm run perf:index-canonical-summary -- --check-file .aidn/runtime/index/index-canonical-check.json --out .aidn/runtime/index/index-canonical-check-summary.md
npm run perf:index-regression-kpi -- --index-report-file .aidn/runtime/index/index-report.json --out .aidn/runtime/index/index-regression-kpi.json
npm run perf:index-regression-history -- --kpi-file .aidn/runtime/index/index-regression-kpi.json --history-file .aidn/runtime/index/index-regression-history.ndjson --max-runs 200
npm run perf:index-regression -- --kpi-file .aidn/runtime/index/index-regression-kpi.json --history-file .aidn/runtime/index/index-regression-history.ndjson --targets docs/performance/INDEX_REGRESSION_TARGETS.json --out .aidn/runtime/index/index-regression.json
npm run perf:index-summary -- --report-file .aidn/runtime/index/index-report.json --thresholds-file .aidn/runtime/index/index-thresholds.json --regression-file .aidn/runtime/index/index-regression.json --canonical-check-file .aidn/runtime/index/index-canonical-check.json --out .aidn/runtime/index/index-summary.md
npm run perf:reload-check -- --target ../client-repo
npm run perf:reload-check -- --target ../client-repo --write-cache
npm run perf:gate -- --target ../client-repo --mode COMMITTING
npm run perf:gate -- --target ../client-repo --mode COMMITTING --index-sync-check-file .aidn/runtime/index/index-sync-check.json
npm run perf:checkpoint -- --target ../client-repo --mode COMMITTING
npm run perf:skill-hook -- --skill context-reload --target ../client-repo --mode THINKING --json
npm run perf:checkpoint -- --target ../client-repo --mode COMMITTING --index-sync-check
npm run perf:session-start -- --target ../client-repo --mode COMMITTING
npm run perf:session-close -- --target ../client-repo --mode COMMITTING
npm run perf:delivery-start -- --target ../client-repo --mode COMMITTING
npm run perf:delivery-end -- --target ../client-repo --mode COMMITTING
npm run perf:check-thresholds -- --kpi-file .aidn/runtime/perf/kpi-report.json --targets docs/performance/KPI_TARGETS.json
npm run perf:check-regression -- --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --targets docs/performance/REGRESSION_TARGETS.json --out .aidn/runtime/perf/kpi-regression.json
npm run perf:check-regression -- --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --targets docs/performance/REGRESSION_TARGETS.json --warmup-enabled true --warmup-history-lt 5 --warmup-multiplier 1.4 --warmup-severity warn --out .aidn/runtime/perf/kpi-regression.json
npm run perf:fallback-report -- --file .aidn/runtime/perf/workflow-events.ndjson --run-prefix session- --out .aidn/runtime/perf/fallback-report.json
npm run perf:constraint-report -- --file .aidn/runtime/perf/workflow-events.ndjson --run-prefix session- --out .aidn/runtime/perf/constraint-report.json --json
npm run perf:check-fallbacks
npm run perf:campaign -- --iterations 30 --target tests/fixtures/repo-installed-core
npm run perf:render-summary -- --kpi-file .aidn/runtime/perf/kpi-report.json --history-file .aidn/runtime/perf/kpi-history.ndjson --thresholds-file .aidn/runtime/perf/kpi-thresholds.json --regression-file .aidn/runtime/perf/kpi-regression.json --fallback-report-file .aidn/runtime/perf/fallback-report.json --fallback-thresholds-file .aidn/runtime/perf/fallback-thresholds.json --out .aidn/runtime/perf/kpi-summary.md
npm run perf:reset
npm run perf:reset -- --keep-history
```

Default runtime outputs:
- `.aidn/runtime/perf/workflow-events.ndjson`
- `.aidn/runtime/index/workflow-index.json`
- `.aidn/runtime/index/workflow-index.sql`
- `.aidn/runtime/index/workflow-index.sqlite` (when `--store` includes SQLite output)
- `.aidn/runtime/index/workflow-index.from-sqlite.json` (optional export)
- `.aidn/runtime/index/index-parity.json`
- `.aidn/runtime/index/index-sqlite-parity.json`
- `.aidn/runtime/index/index-report.json`
- `.aidn/runtime/index/index-thresholds.json`
- `.aidn/runtime/index/index-canonical-check.json`
- `.aidn/runtime/index/index-canonical-check-summary.md`
- `.aidn/runtime/index/index-regression-kpi.json`
- `.aidn/runtime/index/index-regression-history.ndjson`
- `.aidn/runtime/index/index-regression.json`
- `.aidn/runtime/index/index-summary.md`
- `.aidn/runtime/cache/reload-state.json`
- `.aidn/runtime/perf/kpi-thresholds.json`
- `.aidn/runtime/perf/kpi-regression.json`
- `.aidn/runtime/perf/kpi-history.ndjson`
- `.aidn/runtime/perf/fallback-report.json`
- `.aidn/runtime/perf/constraint-report.json`
- `.aidn/runtime/perf/fallback-thresholds.json`
- `.aidn/runtime/perf/kpi-summary.md`
- `.aidn/runtime/perf/campaign-report.json` (when using `perf:campaign`)

These runtime artifacts are intentionally local and ignored by git.
Use `perf:reset -- --keep-history` if you want to preserve cross-run KPI history.
Fixture verifiers write isolated outputs under `.aidn/runtime/index/fixtures/*` to avoid collisions.

## IndexStore Modes

- `file` (default): writes JSON index only
- `sql`: writes SQL import script only
- `dual`: writes JSON + SQL in one run (controlled dual-write, non-blocking)
- `sqlite`: writes SQLite index file only
- `dual-sqlite`: writes JSON + SQLite in one run
- `all`: writes JSON + SQL + SQLite in one run

`perf:index` remains backward compatible and defaults to `file` mode.
You can set `AIDN_INDEX_STORE_MODE` to override the default store mode globally (for `perf:index`, `perf:checkpoint`, `perf:hook`), while CLI flags still take precedence.
You can also set `AIDN_STATE_MODE=files|dual|db-only` to control runtime state strategy defaults:
- `files` -> default store `file`
- `dual` -> default store `dual-sqlite`
- `db-only` -> default store `sqlite`
If both are set, explicit CLI flags still win, then `AIDN_INDEX_STORE_MODE`, then `AIDN_STATE_MODE`.
When env vars are not set, runtime commands also read `.aidn/config.json` in the target repo:
- `runtime.stateMode` (or `profile`) for state mode
- `runtime.indexStoreMode` or `install.artifactImportStore` for index store fallback
Artifact content embedding defaults:
- `files` -> content embedding disabled by default
- `dual` and `db-only` -> content embedding enabled by default
Override with `--with-content` or `--no-content` on `perf:index`.
Examples:
- PowerShell: ``$env:AIDN_INDEX_STORE_MODE='sqlite'; npm run perf:session-start -- --target ../client-repo``
- Bash: ``AIDN_INDEX_STORE_MODE=sqlite npm run perf:index -- --target ../client-repo``
`perf:index -- --dry-run --json` computes payload summary/digest without writing files.
`perf:index-check` compares current index digest against a dry-run import and can auto-apply with `--apply`.
`perf:index-check` also emits `reason_codes`, `drift_level` and numeric summary fields for automation.
`perf:index-verify` should pass when SQL output is generated from the same JSON payload and schema settings.
`perf:index-verify-sqlite` should pass when SQLite output matches JSON payload projection.
Index outputs are written conditionally: unchanged content is detected and not rewritten.
For JSON index, equivalence check ignores `generated_at` to avoid churn-only rewrites.
KPI/regression/fallback/index report and summary outputs are also written conditionally when content is unchanged.
Use `--kpi-file` to enrich index payload with `run_metrics` from `perf:report --json` output.

## Standard Index Queries

`perf:index-query` supports:
- `--backend auto` (default): `.sqlite` file => SQLite mode, otherwise JSON mode
- `--backend json`: force JSON reader
- `--backend sqlite`: force SQLite reader

- `active-cycles`: list active cycles (`OPEN|IMPLEMENTING|VERIFYING`)
- `artifacts-since`: list artifacts changed since an ISO timestamp (`--since` required)
- `cycle-files`: list mapped files for one cycle (`--cycle-id` required)
- `run-metrics`: list KPI run metrics present in index payload
- `canonical-coverage`: show canonical projection coverage ratios (all artifacts + markdown subset)

Artifact rows now include classification fields for multi-version/hybrid repositories:
- `family`: `normative|support|unknown`
- `subtype`: normalized artifact subtype (`status`, `plan`, `report`, ...)
- `gate_relevance`: `1|0` (used by gating policy)
- `classification_reason`: optional classifier hint for non-standard support artifacts
- `content_format`: `utf8|base64|null`
- `content`: optional embedded artifact payload (required for deterministic `db -> files` reconstruction)
- `canonical_format`: canonical schema id (`markdown-canonical-v1|null`)
- `canonical`: canonical artifact data used for deterministic markdown projection when embedded content is absent

`cycle-files` rows now include `relation` (`normative|support`) for cycle-scoped mapping.

`perf:index-export-files` behavior:
- embedded content present: writes exact embedded bytes (`content_format + content`)
- embedded content missing and `--render-markdown` enabled (default): writes deterministic markdown projection from `canonical`
- `--no-render-markdown`: disables projection fallback and reports `missing_content`
- `--only-path <relpath>` (repeatable): restricts export/projection to selected artifact paths
- `--paths-file <file>`: loads selected paths from a newline-delimited file (supports `#` comments)
- when projected markdown already exists with `aidn:generated-from-canonical` marker, export updates managed blocks incrementally (`aidn:block:*`) instead of forcing full-template regeneration
- SQLite fixture verification enforces idempotence on second export pass (`exported=0`, `unchanged>=1`) with incremental projection active

`perf:index-report` now exposes projection coverage metrics:
- `summary.projection.artifacts_with_content`
- `summary.projection.artifacts_with_canonical`
- `summary.projection.canonical_coverage_ratio`
- `summary.projection.artifacts_markdown`
- `summary.projection.artifacts_markdown_with_canonical`
- `summary.projection.canonical_coverage_ratio_markdown`

`perf:index-summary` can optionally include lightweight canonical check results:
- pass `--canonical-check-file .aidn/runtime/index/index-canonical-check.json`

`INDEX_TARGETS.json` now includes canonical projection guardrails:
- `INDEX_CANONICAL_ARTIFACTS_MIN`
- `INDEX_CANONICAL_COVERAGE_MIN`

For fast CI feedback (without full report thresholds), use:
- `perf:index-canonical-check` against `workflow-index.sqlite`
- By default it reads `docs/performance/INDEX_TARGETS.json`; CLI values (`--min-*`) still override target-file values.
- In package mode (`npx aidn ...`), if `docs/performance/INDEX_TARGETS.json` is not present in the client repo, the command falls back to the package's built-in `docs/performance/INDEX_TARGETS.json`.
- Use `--require-target-rules` if missing target rules must fail the command.

`perf:campaign` path behavior:
- Runtime outputs (`workflow-events.ndjson`, KPI/threshold/campaign reports) are resolved under `--target`.
- `--targets-file` is resolved with fallback order: `--target` -> current working directory -> package defaults.

## Gating Levels (implemented)

- L1 fast checks: digest + mapping (`perf:reload-check`)
- L2 conditional drift signals: objective delta, scope growth, cross-domain touch, stale drift-check, uncertain intent, structure-mixed/version-stale signals (`perf:gate`)
- L2 conditional drift signals also include `index_sync_drift` when latest index sync check is out-of-sync (`--index-sync-check-file`) and matches the same `target_root`.
- L3 incident trigger: blocking L1 reasons or repeated fallback patterns (`perf:gate`)

`perf:checkpoint` orchestrates these steps and writes a summary event for KPI tracking.
Checkpoint summary events now carry effective index write counters (`files_written_count`, `bytes_written`) from `index-sync --json`.
`perf:checkpoint --index-sync-check` also runs `index-sync-check` after index write and stores a check JSON (optional `--index-sync-check-strict` to fail on drift).
`perf:checkpoint --index-sync-check` automatically resolves the backend/index file pair from store mode (`file|dual|all -> workflow-index.json`, `sqlite|dual-sqlite -> workflow-index.sqlite`).
`index-sync-check` now emits artifact-level drift (`artifact_mismatches` + `artifact_summary`) with mismatch types:
- `missing_in_index`
- `digest_mismatch`
- `stale_in_index`
`perf:index-select-paths` can transform this drift payload into an `export-paths.txt` used by `index-export-files --paths-file` for targeted projection only.
`perf:index-reconcile` orchestrates `index-check -> index-select-paths -> index-check --apply -> index-export-files --paths-file` as a single reconciliation flow.

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
- Optional index mode override on hooks: `--index-store file|sql|dual|sqlite|dual-sqlite|all`.
- Optional checkpoint sync verification on hooks: `--index-sync-check` (or `--index-sync-check-strict`).
- Session start stores a shared `run_id` in `.aidn/runtime/perf/current-run-id.txt`.
- Session close reuses that shared `run_id` when available, then clears the file.

## Skill Hook Coverage (Phase 1-3)

Recommended optional hooks (non-blocking by default) in skill flows:
- `context-reload`: `npx aidn perf skill-hook --skill context-reload --target . --mode <THINKING|EXPLORING|COMMITTING> --json`
- `branch-cycle-audit`: `npx aidn perf skill-hook --skill branch-cycle-audit --target . --mode COMMITTING --json`
- `drift-check`: `npx aidn perf skill-hook --skill drift-check --target . --mode COMMITTING --json`
- `start-session`: `npx aidn perf skill-hook --skill start-session --target . --mode <THINKING|EXPLORING|COMMITTING> --json`
- `close-session`: `npx aidn perf skill-hook --skill close-session --target . --mode <THINKING|EXPLORING|COMMITTING> --json`
- `cycle-create`: `npx aidn perf skill-hook --skill cycle-create --target . --mode COMMITTING --json`
- `cycle-close`: `npx aidn perf skill-hook --skill cycle-close --target . --mode COMMITTING --json`
- `promote-baseline`: `npx aidn perf skill-hook --skill promote-baseline --target . --mode COMMITTING --json`
- `requirements-delta`: `npx aidn perf skill-hook --skill requirements-delta --target . --mode COMMITTING --json`
- `convert-to-spike`: `npx aidn perf skill-hook --skill convert-to-spike --target . --mode EXPLORING --json`

This rollout extends optimization coverage to high-cost checks first, then mutating skills, while keeping blocking behavior opt-in.

## CI Integration

- A lightweight GitHub workflow is available: `.github/workflows/perf-kpi.yml`
- Triggers: `pull_request` and `workflow_dispatch`
- It executes:
  - `perf:verify-structure`
  - `perf:verify-skill-hooks`
  - `perf:verify-index-sync`
  - `perf:verify-index-sync-select-paths`
  - `perf:verify-index-reconcile`
  - `perf:verify-index-reconcile-sqlite`
  - `perf:verify-checkpoint-index-sync-backend`
  - `perf:verify-index-sqlite`
  - `perf:verify-index-canonical-check`
  - `perf:verify-index-regression`
  - `perf:verify-index-export-filter`
  - `perf:verify-support-artifacts`
  - `perf:verify-db-only-hooks`
  - `perf:verify-cli-aliases`
  - `perf:verify-constraint-report`
  - `perf:session-start`
  - `perf:delivery-start`
  - `perf:delivery-end`
  - `perf:session-close`
  - `perf:report --run-prefix session- --require-delivery --json`
  - `perf:sync-history`
  - `perf:index-dual --kpi-file .aidn/runtime/perf/kpi-report.json`
  - `perf:index-sqlite --kpi-file .aidn/runtime/perf/kpi-report.json`
  - `perf:index-check --json` (non-blocking by default in CI)
  - `perf:index-sync-summary`
  - `perf:index-select-paths`
  - `perf:index-sync-history`
  - `perf:index-sync-report`
  - `perf:index-sync-thresholds` (non-blocking by default in CI)
  - `perf:index-sync-trend-summary`
  - `perf:index-verify`
  - `perf:index-verify-sqlite`
  - `perf:index-report`
  - `perf:index-thresholds`
  - `perf:index-canonical-check` (non-blocking by default in CI)
  - `perf:index-canonical-summary`
  - `perf:index-regression-kpi`
  - `perf:index-regression-history`
  - `perf:index-regression` (non-blocking by default in CI)
  - `perf:index-summary`
  - `perf:check-thresholds` (non-blocking by default in CI)
  - `perf:check-regression` (non-blocking by default in CI)
  - `perf:fallback-report`
  - `perf:constraint-report`
  - `perf:check-fallbacks` (non-blocking by default in CI)
  - `perf:render-summary`
- It publishes:
  - `.aidn/runtime/perf/workflow-events.ndjson`
  - `.aidn/runtime/perf/kpi-report.json`
  - `.aidn/runtime/perf/kpi-history.ndjson`
  - `.aidn/runtime/perf/kpi-thresholds.json`
  - `.aidn/runtime/perf/kpi-regression.json`
  - `.aidn/runtime/perf/fallback-report.json`
  - `.aidn/runtime/perf/constraint-report.json`
  - `.aidn/runtime/perf/fallback-thresholds.json`
  - `.aidn/runtime/perf/kpi-summary.md`
  - `.aidn/runtime/index/workflow-index.json`
  - `.aidn/runtime/index/workflow-index.sql`
  - `.aidn/runtime/index/workflow-index.sqlite`
  - `.aidn/runtime/index/index-sync-check.json`
  - `.aidn/runtime/index/export-paths.txt`
  - `.aidn/runtime/index/index-sync-summary.md`
  - `.aidn/runtime/index/index-sync-history.ndjson`
  - `.aidn/runtime/index/index-sync-report.json`
  - `.aidn/runtime/index/index-sync-thresholds.json`
  - `.aidn/runtime/index/index-sync-trend-summary.md`
  - `.aidn/runtime/index/index-parity.json`
  - `.aidn/runtime/index/index-sqlite-parity.json`
  - `.aidn/runtime/index/index-canonical-check.json`
  - `.aidn/runtime/index/index-canonical-check-summary.md`
  - `.aidn/runtime/index/index-regression-kpi.json`
  - `.aidn/runtime/index/index-regression-history.ndjson`
  - `.aidn/runtime/index/index-regression.json`
- `workflow_dispatch` supports `strict_thresholds=true` to make threshold violations blocking.
- `workflow_dispatch` supports `strict_index_parity=true` to make dual-write parity violations blocking.
- `workflow_dispatch` supports `strict_index_quality=true` to make index quality threshold violations blocking.
- `workflow_dispatch` supports `strict_index_canonical=true` to make lightweight canonical coverage checks blocking.
- `workflow_dispatch` supports `strict_index_sync=true` to make index import/export drift checks blocking.
- `workflow_dispatch` supports `strict_regression=true` to make KPI regression violations blocking.
- `workflow_dispatch` supports `strict_fallback=true` to make fallback-storm violations blocking.
- `workflow_dispatch` supports regression warmup overrides via `regression_warmup_enabled`, `regression_warmup_history_lt`, `regression_warmup_multiplier`, `regression_warmup_severity`.

Threshold source file:
- `docs/performance/KPI_TARGETS.json`
- `docs/performance/INDEX_TARGETS.json`
- `docs/performance/INDEX_SYNC_TARGETS.json`
- `docs/performance/INDEX_REGRESSION_TARGETS.json`
- `docs/performance/REGRESSION_TARGETS.json`
- `docs/performance/FALLBACK_TARGETS.json`

Regression warmup note:
- `REGRESSION_TARGETS.json` supports a `warmup` block.
- Default warmup applies while `history_count < 5`: effective threshold is multiplied (`max_increase_pct_multiplier`) and severity can be overridden (default `warn`).
- Each regression rule can override warmup values via `rules[].warmup` (for metric-specific warmup factors).
- CLI/CI warmup overrides take precedence over both global and rule warmup settings.
- For baseline `0`, regression checks no longer fail as invalid: `latest=0` passes, `latest>0` is treated as a regression (`increase_pct=Infinity`).

Fallback thresholding note:
- Fallback thresholds use warmup-adjusted metrics (`adjusted_fallback_total`, `adjusted_storm_runs`) that exclude cold-start reload fallbacks (`MISSING_CACHE`, `CORRUPT_CACHE`).

## Overhead Ratio Enablement

To avoid `overhead_ratio=n/a`, emit delivery window markers:
- `perf:delivery-start` before implementation window
- `perf:delivery-end` after implementation window

These events are marked as `control=false` and provide delivery duration for KPI ratio calculation.
If no explicit `--run-id` is passed, delivery markers reuse the shared run id from session hook automatically.
