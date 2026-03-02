# Etat Des Lieux (AS-IS) - Workflow Aid'n

## Scope

- Périmètre: exécution session/cycle, gating, drift-check, traçabilité, import/export artefacts.
- Source: workflow actuel (`SPEC`, skills, tooling perf, KPI runtime).
- Objectif: établir une base factuelle avant optimisation processus.

## Modèle Opérationnel Actuel

Flux nominal (COMMITTING):
1. `context-reload`
2. `start-session`
3. `branch-cycle-audit`
4. implémentation + writeups cycle/session
5. `drift-check` (conditionnel / forcé)
6. `close-session`
7. index sync / checks / reporting

## Cartographie AS-IS (Valeur vs Coût)

| Etape | Valeur métier | Coûts observés | Risques |
|---|---|---|---|
| Context reload | Alignement rapide du contexte | reload complet, lectures redondantes | latence, surcontexte |
| Start session | traçabilité d'entrée | écriture session + validations répétées | churn documentaire |
| Branch-cycle audit | sécurité de mapping | vérifs branch/cycle parfois répétées | faux-stop si ambigu |
| Drift-check | protection scope/qualité | relance coûteuse si signaux trop sensibles | sur-contrôle |
| Close session | cohérence de sortie | résolution cycles + snapshot + reporting | délai de clôture |
| Index / parity / reports | observabilité et migration DB | pipeline long (json+sql+sqlite+summary) | coût CI |

## Baseline KPI Disponible (Référence Interne)

- KPI principaux en place:
  - `overhead_ratio`
  - `artifacts_churn`
  - `gates_frequency`
- Instrumentation disponible:
  - événements NDJSON
  - checks index/parity/canonical/regression
  - tendances historisées

## Analyse Lean (Muda) - Gaspillages Dominants

1. Sur-traitement:
- mêmes contrôles relancés sans changement de contexte utile.

2. Attente:
- temps de reload/gating/index avant reprise livraison.

3. Transferts:
- multiplications des passages session <-> cycle <-> snapshot <-> index.

4. Retouches:
- artefacts réécrits malgré peu de variation fonctionnelle.

5. Stock:
- accumulation de writeups/supports non consommés immédiatement.

## Contraintes Système (TOC)

Contrainte principale actuelle:
- boucle de contrôle runtime (reload + gate + index + writeups) qui fixe le débit d'itération.

Contraintes secondaires:
- hétérogénéité de structure des repos (legacy/modern/mixed).
- coût de maintien de parité multi-store (`file/sql/sqlite`).

## Diagnostic Par Principe D'Optimisation

1. Supprimer le non-valeur ajoutée:
- opportunité forte sur relances de checks sans signal nouveau.

2. Réduire les délais:
- opportunité forte sur reload incrémental + checks rapides en amont.

3. Minimiser les transferts:
- opportunité forte via source canonique unique + projections à la demande.

4. Standardiser:
- opportunité moyenne/forte sur conventions skill, artefacts, décisions de gate.

5. Intégrer les données:
- opportunité forte via index/store unifié et requêtes directes.

6. Automatiser:
- opportunité forte sur contrôles répétitifs, résumés, seuils CI.

7. Traiter à la demande (flux tiré):
- opportunité moyenne/forte: déclencher contrôles lourds uniquement sur signaux.

8. Optimiser la contrainte:
- opportunité critique: limiter le temps passé dans la boucle de contrôle.

## Conclusion AS-IS

- Le workflow protège bien qualité/traçabilité.
- Le coût dominant reste la redondance des contrôles et du cycle documentaire.
- La prochaine phase doit concentrer l'optimisation sur le débit d'itération sans réduire les garanties DoR/DoD/drift-check.
