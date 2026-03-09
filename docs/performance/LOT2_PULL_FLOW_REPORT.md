# Lot 2 Flux Tire Report (30 Iterations)

Date:
- 2026-03-02

Commande exécutée:

```bash
npm run perf:campaign -- --iterations 30 --target tests/fixtures/repo-installed-core --sleep-ms 500 --index-store all --json
```

Corpus:
- `tests/fixtures/repo-installed-core`

## Résultats KPI

Lot 0 baseline:
- `overhead_ratio.mean`: 16.729346586949728
- `artifacts_churn.mean`: 0.1
- `gates_frequency.mean`: 18

Lot 2 (flux tiré):
- `overhead_ratio.mean`: 3.0497629157190134
- `artifacts_churn.mean`: 0.1
- `gates_frequency.mean`: 10

Écart vs Lot 0:
- `overhead_ratio.mean`: -81.77%
- `artifacts_churn.mean`: 0.00%
- `gates_frequency.mean`: -44.44%

## Seuils (KPI_TARGETS)

Statut global:
- `pass` (4 pass, 0 fail, 0 blocking)

## Changements Clés Implémentés

- auto-skip du gate complet quand aucun signal:
  - `reload=incremental`
  - `fallback=false`
  - `reason_codes=[]`
  - aucun changement git (staged + working tree)
- option d'override:
  - `checkpoint --no-auto-skip-gate`
- conservation de la garantie:
  - fallback vers gate normal dès qu'un signal existe.
  - mode strict inchangé.

## Décision De Passage

- Lot 2: `COMPLETED`
- Lot 3: `READY_TO_START`

## Artefacts Source

- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/campaign-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-thresholds.json`
