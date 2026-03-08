# Lot 1 Quick Wins Report (30 Iterations)

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

Lot 1 (après quick wins):
- `overhead_ratio.mean`: 3.9133753774563496
- `artifacts_churn.mean`: 0.1
- `gates_frequency.mean`: 12

Écart vs Lot 0:
- `overhead_ratio.mean`: -76.61%
- `artifacts_churn.mean`: 0.00%
- `gates_frequency.mean`: -33.33%

## Seuils (KPI_TARGETS)

Statut global:
- `pass` (4 pass, 0 fail, 0 blocking)

## Changements Clés Implémentés

- `workflow-hook` session-start en mode préflight léger (skip gating complet, option `--full-start-gate` pour forcer le mode historique).
- `checkpoint` passe le résultat reload à `gating-evaluate` (suppression d'un `reload-check` subprocess redondant).
- `checkpoint` supporte `--skip-gate-evaluate` pour le flux tiré.
- précision millisecondes sur `run_id` pour limiter les collisions en exécutions rapides.
- index sync conserve le skip incrémental no-signal et le check synthétique en mode skip.

## Décision De Passage

- Lot 1: `COMPLETED`
- Lot 2: `READY_TO_START`

## Artefacts Source

- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/campaign-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-thresholds.json`
