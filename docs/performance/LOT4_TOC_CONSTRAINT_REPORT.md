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
- `overhead_ratio.mean`: 2.189884153568903
- `artifacts_churn.mean`: 0.1
- `gates_frequency.mean`: 10

Écart vs Lot 0:
- `overhead_ratio.mean`: -86.91%
- `artifacts_churn.mean`: 0.00%
- `gates_frequency.mean`: -44.44%

## Seuils KPI (KPI_TARGETS)

Statut global:
- `pass` (4 pass, 0 fail, 0 blocking)

## Exécution TOC (Lot 4)

Contrainte active:
- `skill`: `perf-checkpoint`
- `signal`: `control_duration_ms`
- `share`: `0.4174375321544219` (`41.74%`)
- `control_share_of_total`: `0.6852404849791934` (`68.52%`)

Seuils contrainte (`CONSTRAINT_TARGETS`):
- statut global: `pass` (3 pass, 0 fail, 0 blocking)

Seuils tendance contrainte (`CONSTRAINT_TREND_TARGETS`):
- statut global: `pass` (5 pass, 0 fail, 0 blocking)

Backlog et plan Lot 4:
- actions générées: `4` (batch `foundational`)
- action prioritaire: `perf-checkpoint:generic-control-reduction` (`priority_score=17.33`)
- lots exécutés: `L4-FD-01`, `L4-FD-02`
- avancement final: `4/4` actions `done`, `0` pending

## Ajustement Instrumentation Lot 4

- `workflow-hook` publie désormais une durée de wrapper (overhead hook) sans re-compter la durée imbriquée de `checkpoint`.
- objectif: éviter le double comptage dans les rapports KPI/contrainte et refléter la contrainte réelle du pipeline.
- `gating-evaluate` réduit le coût de contrôle:
  - scan Git unifié via `git status --porcelain --untracked-files=no`
  - lecture NDJSON ciblée sur les signaux utiles (drift/fallback), sans parsing global du fichier d'événements.

## Vérification de l'action restante (Lot 4)

Action clôturée:
- `gating-evaluate:generic-control-reduction`

Impact observé (même campagne 30 runs):
- `gating-evaluate.control_duration_ms`: `19544 -> 12052` (`-38.33%`)
- `gating-evaluate.p90_duration_ms`: `732 -> 399` (`-45.49%`)
- `gating-evaluate.control_share_of_control`: `17.62% -> 12.16%`
- contrainte globale: `CONSTRAINT_CONTROL_SHARE_MAX` repasse en `pass` (`68.52% <= 70%`)

## Décision De Passage

- Lot 4: `COMPLETED` (scope fixtures) avec boucle TOC complète exécutée et backlog lot entièrement soldé.
- comparaison Lot 0 -> Lot 4: objectif plan maître (`-50% overhead`) largement dépassé (`-86.91%`).
- point de vigilance: confirmer le même profil de gains sur corpus projet réel avant clôture opérationnelle globale.

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
