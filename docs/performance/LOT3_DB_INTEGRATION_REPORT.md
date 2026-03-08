# Lot 3 Data Integration Report (30 Iterations)

Date:
- 2026-03-03

Commande executee:

```bash
npm run perf:campaign -- --iterations 30 --target tests/fixtures/repo-installed-core --sleep-ms 500 --index-store all --json
```

Corpus:
- `tests/fixtures/repo-installed-core`

## Resultats KPI

Lot 0 baseline:
- `overhead_ratio.mean`: 16.729346586949728
- `artifacts_churn.mean`: 0.1
- `gates_frequency.mean`: 18

Lot 3 (data integration + sqlite/reconcile chain):
- `overhead_ratio.mean`: 2.68662084302406
- `artifacts_churn.mean`: 0.1
- `gates_frequency.mean`: 10

Ecart vs Lot 0:
- `overhead_ratio.mean`: -83.94%
- `artifacts_churn.mean`: 0.00%
- `gates_frequency.mean`: -44.44%

## Seuils (KPI_TARGETS)

Statut global:
- `pass` (4 pass, 0 fail, 0 blocking)

## Validations Lot 3 Incluses

- parity JSON/SQL/SQLite (`perf:verify-index-sqlite`)
- drift/reconcile sqlite natif (`perf:verify-index-reconcile-sqlite`)
- projection selective drift-driven (`perf:index-select-paths` + `perf:index-export-files --paths-file`)
- import/export artefacts support (`perf:verify-support-artifacts`)
- equivalence runtime `dual` vs `db-only` (`perf:verify-state-mode-parity`)
- hooks runtime `db-only` (`perf:verify-db-only-hooks`)
- checkpoint backend-aware pour `--index-sync-check` (`perf:verify-checkpoint-index-sync-backend`)

## Decision De Passage

- Lot 3: `IN_PROGRESS` (validation fixtures robuste, campagne locale 30 iterations en PASS)
- Prochaine etape: confirmer ces KPI sur corpus projet reel pour cloture formelle du lot.

## Artefacts Source

- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/campaign-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-thresholds.json`
