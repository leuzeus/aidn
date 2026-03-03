# Plan Maitre D'Optimisation - Workflow Aid'n

## Objectif Global

Optimiser le workflow sans perte de garanties qualité:
- DoR/DoD
- drift-check
- traçabilité cycle/session/branch

Principes appliqués:
- supprimer le non-valeur ajoutée
- réduire les délais
- minimiser les transferts
- standardiser
- intégrer les données
- automatiser
- traiter à la demande (flux tiré)
- optimiser la contrainte

## Gouvernance De Passage

Règle stricte entre lots:
1. KPI lot atteints.
2. Vérifications perf/fixtures en PASS.
3. Aucune régression de conformité workflow.
4. Rollback documenté.

## Lots Exécutables

## Lot 0 - Baseline (30 itérations)

But:
- établir une baseline stable et comparable.

Actions:
- exécuter campagne KPI 30 itérations sur corpus de référence.
- figer les valeurs de référence (`overhead_ratio`, `artifacts_churn`, `gates_frequency`).
- publier un rapport lot 0.

Sortie attendue:
- baseline versionnée + méthode de mesure.

## Lot 1 - Lean Quick Wins

But:
- réduire le coût non-valeur et le churn documentaire.

Actions:
- write-on-change systématique.
- règles d'hygiène skills harmonisées.
- déduplication des checks sans nouveau signal.

KPI cible:
- `artifacts_churn`: -20% vs Lot 0
- `overhead_ratio`: -15% vs Lot 0

## Lot 2 - Flux Tiré

But:
- exécuter les contrôles lourds uniquement sur besoin réel.

Actions:
- L1 rapide systématique.
- L2/L3 conditionnels sur signaux objectivés.
- orchestration checkpoint orientée need-to-run.

KPI cible:
- `gates_frequency`: -25% redondance vs Lot 0
- `overhead_ratio`: -30% vs Lot 0
- `gates_stop_rate`: stable ou en baisse

## Lot 3 - Intégration Données + Automatisation

But:
- réduire transferts et coûts de synchronisation.

Actions:
- état canonique prioritaire JSON/SQLite.
- projection Markdown à la demande.
- import/export bidirectionnel robuste (multi-version).
- automatisation CI seuils/régression/résumés.

KPI cible:
- `artifacts_churn`: -35% vs Lot 0
- `overhead_ratio`: -40% vs Lot 0

## Lot 4 - Optimisation De La Contrainte (TOC)

But:
- augmenter le débit global en traitant la contrainte active.

Cycle TOC:
1. Identifier la contrainte.
2. Exploiter.
3. Subordonner.
4. Élever.
5. Reprofiler.

KPI cible:
- `overhead_ratio`: -50% vs Lot 0
- baisse durable de la latence de boucle de contrôle.

## Cadence D'Exécution

- Exécution incrémentale, pas de big bang.
- 1 lot actif à la fois.
- Revue KPI + qualité à la fin de chaque lot.

## Statut Actuel

État au 2026-03-03:
- Lot 0: COMPLETED (baseline 30 itérations publiée).
- Lot 1: COMPLETED (`LOT1_QUICK_WINS_REPORT.md` publié).
- Lot 2: COMPLETED (`LOT2_PULL_FLOW_REPORT.md` publié).
- Lot 3: COMPLETED (`LOT3_DB_INTEGRATION_REPORT.md` publié).
- Lot 4: COMPLETED (scope fixtures, boucle TOC soldée).
- Référence baseline: `LOT0_BASELINE_REPORT.md`.
- Dernier rapport Lot 3: `LOT3_DB_INTEGRATION_REPORT.md` (campagne 30 itérations, seuils KPI en PASS).
- Dernier rapport Lot 4: `LOT4_TOC_CONSTRAINT_REPORT.md` (comparaison Lot 0 vs Lot 4 mise à jour, lot-plan TOC clôturé).
- Préparation Lot 4 (TOC): rapport de contrainte active outillé (`perf:constraint-report`) avec seuils (`perf:check-constraints`) et résumé CI (`perf:constraint-summary`).
- Lot 4 actionnable: backlog d'optimisation priorisé impact/effort généré automatiquement (`perf:constraint-actions`).
- Lot 4 pilotage: suivi de tendance des contraintes (`perf:constraint-history` + `perf:constraint-trend`) pour mesurer stabilité et rotation des goulots.
- Lot 4 exécution: plan de lot généré depuis le backlog (`perf:constraint-lot-plan`) avec mise à jour d'avancement (`perf:constraint-lot-update`), avancement automatique (`perf:constraint-lot-advance`) et boucle CI `plan -> advance -> summary` (`perf:constraint-lot-summary`).
- Lot 4 statut final (fixtures): `L4-FD-01` et `L4-FD-02` en `completed`, `4/4` actions `done`, `0` pending, seuil KPI global `pass`, seuil contrainte `pass`, contrainte active `perf-checkpoint`.
- Progression Lot 3:
  - couverture fixture import/export des artefacts de support (`reports/`, `migration/`, `backlog/`, `incidents`)
  - smoke test hooks runtime `db-only` (`session-start` / `session-close`)
  - projection Markdown sélective à la demande via `index-export-files --only-path|--paths-file`
  - pilotage drift-driven: sélection automatique des chemins de projection depuis `index-sync-check` (`index-sync-select-paths`)
  - orchestration de réconciliation (`index-sync-reconcile`) pour enchaîner check/apply/projection ciblée sans étape manuelle
  - compatibilité native SQLite sur la chaîne drift/reconcile (`index-sync-check --index-backend sqlite`, `index-sync-reconcile --index-backend sqlite`)
  - checkpoint backend-aware: `checkpoint --index-sync-check` route automatiquement le contrôle vers l’index JSON ou SQLite selon le store effectif

## Reprise Immédiate (Post Lot 4 Fixtures)

1. Réexécuter la campagne KPI 30 itérations sur corpus projet réel pour confirmer les gains hors fixtures.
2. Exécuter la boucle TOC complète sur ce corpus: `constraint-report` -> `constraint-actions` -> `constraint-history` -> `constraint-trend` -> `constraint-lot-plan` -> `constraint-lot-advance` -> `constraint-lot-summary`.
3. Vérifier `perf:check-constraints` et `perf:check-constraint-trend` sur les artefacts réels.
4. Publier la décision de clôture opérationnelle globale (go/no-go + risques + rollback) avec comparaison explicite Lot 0 vs Lot 4.
