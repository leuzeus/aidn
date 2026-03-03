# Planification D'Optimisation Processus (TO-BE) - Workflow Aid'n

## Objectif

Optimiser le workflow comme un analyste d'affaires:
- maintenir les garanties qualité/traçabilité,
- réduire le coût de contrôle par itération,
- améliorer le débit global.

## Principes Directeurs

1. Supprimer le non-valeur ajoutée
2. Réduire les délais
3. Minimiser les transferts
4. Standardiser
5. Intégrer les données
6. Automatiser
7. Traiter à la demande (flux tiré)
8. Optimiser la contrainte

## Cibles Mesurables

- `overhead_ratio`: réduction continue vs baseline courante.
- `artifacts_churn`: réduction des réécritures non nécessaires.
- `gates_frequency`: baisse de la redondance, sans hausse du `stop_rate`.
- Temps de décision L1 (fast checks): cible sub-second.
- Idempotence export/projection: stable sur passes successives.

## État D'Implémentation (au 2026-03-03)

- Lot A (Rationalisation Lean): COMPLETED.
- Lot B (Flux Tiré): COMPLETED.
- Lot C (Intégration Données/Automatisation): COMPLETED sur fixtures + CI, validation corpus réel à finaliser.
- Lot D (TOC): READY FOR EXECUTION avec outillage opérationnel (`constraint-report`, `constraint-actions`, `constraint-history`, `constraint-trend`, `constraint-lot-plan`, `constraint-lot-update`, `constraint-lot-advance`, `constraint-lot-summary`).

## Feuille De Route (Incrémentale)

## Lot A - Rationalisation Lean (quick wins)

Objectif:
- retirer les contrôles/écritures non nécessaires à valeur nulle.

Actions:
- imposer write-on-change sur tous les artefacts de contrôle.
- dédupliquer les relances de gate sans nouveau signal.
- standardiser les règles d'hygiène dans les skills (read-only vs mutating, stop explicite).
- ajouter un tableau de décision unique pour reprise/stop (éviter re-triage manuel).

Critères d'acceptation:
- baisse mesurable du churn.
- aucune régression sur DoR/DoD/drift-check.

## Lot B - Flux Tiré Et Réduction Des Délais

Objectif:
- déclencher le coût lourd uniquement quand requis par signal.

Actions:
- L1 obligatoire et ultra-rapide (digest + mapping).
- L2/L3 strictement conditionnels sur signaux objectivés.
- orchestration checkpoint centrée sur "need-to-run".
- priorisation runtime des étapes critiques avant reporting détaillé.

Critères d'acceptation:
- baisse de `gates_frequency` redondante.
- maintien du taux de détection d'incidents pertinents.

## Lot C - Intégration Données Et Automatisation

Objectif:
- réduire transferts et manipulations multiples.

Actions:
- consolider l'état canonique (JSON/SQLite) comme pivot.
- projections markdown générées à la demande (pas systématiques).
- automatiser seuils/résumés/régressions en CI via presets.
- renforcer import/export bidirectionnel pour transition sans rupture.

Critères d'acceptation:
- parité vérifiée entre stores.
- reconstruction fiable `db -> files`.

## Lot D - Optimisation De La Contrainte (TOC)

Objectif:
- augmenter le débit du système en traitant la contrainte principale.

Actions TOC:
1. Identifier la contrainte active (reload+gate+index).
2. Exploiter: exécution minimale viable.
3. Subordonner: aligner les étapes annexes (reporting, writeups) après décision.
4. Élever: cache/invalidation fine, requêtes directes store.
5. Reboucler: re-profiler à chaque lot.

Critères d'acceptation:
- réduction durable du temps de boucle contrôle.
- amélioration de cadence session/cycle sans perte de conformité.
- boucle exécutable `plan -> advance -> summary` opérationnelle en CI et exploitable en local.

Exécution standard (Lot D):
1. Générer contrainte active + backlog (`constraint-report`, `constraint-actions`).
2. Mettre à jour l'historique et la tendance (`constraint-history`, `constraint-trend`).
3. Générer/mettre à jour le plan de lot (`constraint-lot-plan`, `constraint-lot-update`).
4. Avancer automatiquement le plan (`constraint-lot-advance`) en conservant le JSON d'advance.
5. Produire le résumé de lot en injectant l'advance (`constraint-lot-summary --advance-file ...`).
6. Contrôler les seuils de contrainte (`check-constraints`, `check-constraint-trend`).

## Backlog Priorisé (Impact/Effort)

1. Dédup checks L1/L2 sans signal nouveau (impact élevé, effort faible)
2. Write-on-change systématique artefacts de pilotage (élevé, faible)
3. Normalisation décisionnelle skills (élevé, faible)
4. Déclenchement gate "pull" conditionnel (élevé, moyen)
5. Projection markdown à la demande (moyen/élevé, moyen)
6. Consolidation état canonique + requêtes directes (élevé, moyen/élevé)
7. TOC dashboard + exécution lot-plan CI (contrainte, file d'attente, latence, avancement) (moyen, moyen)

## Gouvernance D'Exécution

- Revue hebdo des KPI + incidents.
- Validation par lot sur fixtures puis corpus réel.
- Aucun big bang: lot suivant uniquement après critères d'acceptation atteints.
- Rollback défini pour chaque évolution de runtime/control-plane.

## Livrables D'Exécution

- backlog opérationnel versionné,
- seuils KPI ajustés par lot,
- rapport d'impact après chaque lot (gains + risques),
- mise à jour continue de la documentation skills/workflow/perf.
