# Lot 0 Baseline Report (30 Iterations)

Date:
- 2026-03-02

Commande exécutée:

```bash
npm run perf:campaign -- --iterations 30 --target tests/fixtures/repo-installed-core --sleep-ms 500 --index-store all --json
```

Corpus:
- `tests/fixtures/repo-installed-core`

## Résultats KPI

- `runs_analyzed`: 30
- `overhead_ratio.mean`: 16.729346586949728
- `overhead_ratio.median`: 14.784857790024287
- `overhead_ratio.p90`: 22.397043294614573
- `artifacts_churn.mean`: 0.1
- `artifacts_churn.median`: 0
- `artifacts_churn.p90`: 0
- `gates_frequency.mean`: 18
- `gates_frequency.median`: 18
- `gates_frequency.p90`: 18

## Seuils (KPI_TARGETS)

Statut global:
- `warn` (3 pass, 1 fail, 0 blocking)

Règle en échec:
- `OVERHEAD_MEAN_MAX`
- attendu: `<= 12`
- observé: `16.729346586949728`

## Interprétation

- Le système est stable sur churn et fréquence de gates.
- Le principal levier d'optimisation restant est la réduction de l'overhead de contrôle.

## Décision De Passage

- Lot 0: `COMPLETED`
- Lot 1: `READY_TO_START`

## Artefacts Source

- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/campaign-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-thresholds.json`
