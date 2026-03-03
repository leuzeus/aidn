# Lot 4 TOC Constraint Optimization Report (30 Iterations)

Date:
- 2026-03-03

Commande exécutée:

```bash
npm run perf:campaign -- --iterations 30 --target tests/fixtures/repo-installed-core --sleep-ms 500 --index-store all --json
```

Pipeline TOC exécuté:
- `perf:constraint-report`
- `perf:check-constraints`
- `perf:constraint-actions`
- `perf:constraint-history`
- `perf:constraint-trend`
- `perf:check-constraint-trend`
- `perf:constraint-lot-plan`
- `perf:constraint-lot-advance`
- `perf:constraint-lot-summary`
- `perf:constraint-summary`

Corpus:
- `tests/fixtures/repo-installed-core`

## Résultats KPI

Lot 0 baseline:
- `overhead_ratio.mean`: 16.729346586949728
- `artifacts_churn.mean`: 0.1
- `gates_frequency.mean`: 18

Lot 4 (TOC loop active):
- `overhead_ratio.mean`: 2.6148678708848396
- `artifacts_churn.mean`: 0.1
- `gates_frequency.mean`: 10

Écart vs Lot 0:
- `overhead_ratio.mean`: -84.37%
- `artifacts_churn.mean`: 0.00%
- `gates_frequency.mean`: -44.44%

## Seuils KPI (KPI_TARGETS)

Statut global:
- `pass` (4 pass, 0 fail, 0 blocking)

## Exécution TOC (Lot 4)

Contrainte active:
- `skill`: `workflow-hook`
- `signal`: `control_duration_ms`
- `share`: `0.5162672537894826` (`51.63%`)
- `control_share_of_total`: `0.7225016213305924` (`72.25%`)

Seuils contrainte (`CONSTRAINT_TARGETS`):
- statut global: `warn` (2 pass, 1 fail, 0 blocking)
- check en écart: `CONSTRAINT_CONTROL_SHARE_MAX` (`<= 0.7`, observé `0.7225016213305924`, sévérité `warn`)

Seuils tendance contrainte (`CONSTRAINT_TREND_TARGETS`):
- statut global: `pass` (5 pass, 0 fail, 0 blocking)

Backlog et plan Lot 4:
- actions générées: `3` (batch `foundational`)
- action prioritaire: `workflow-hook:generic-control-reduction` (`priority_score=20.67`)
- plan généré: `L4-FD-01` (`in_progress`, `3` actions `pending`)

## Décision De Passage

- Lot 4: `IN_PROGRESS` (boucle TOC exécutée et plan de lot démarré).
- Prochaine étape: implémenter les actions du lot `L4-FD-01`, puis relancer campagne + pipeline TOC pour ramener `control_share_of_total` sous le seuil `0.7` tout en conservant les gains KPI vs Lot 0.

## Artefacts Source

- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/campaign-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/kpi-thresholds.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-report.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-thresholds.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-actions.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-history.ndjson`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-trend.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-trend-thresholds.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-lot-plan.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-lot-advance.json`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-lot-plan-summary.md`
- `tests/fixtures/repo-installed-core/.aidn/runtime/perf/constraint-summary.md`
