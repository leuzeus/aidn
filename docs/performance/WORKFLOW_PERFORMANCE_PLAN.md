# Plan Performance Workflow Aid'n

## Scope

Objectif principal:
- réduire la latence par itération et le coût de contexte sans perdre les garanties qualité du workflow (`SPEC-R01..R11`).

Garanties à préserver:
- DoR/DoD (notamment `SPEC-R04`)
- drift-check (`SPEC-R05`)
- traçabilité cycle/session/branch
- gates session close/PR/sync/incident (`SPEC-R07..R10`)

Contraintes:
- pas de migration "big bang"
- livraison incrémentale en 3 lots
- transition explicite par modes: `files` -> `dual` -> `db-only`
- en mode `dual`, fichiers + DB doivent rester en parité
- en mode `db-only`, les fichiers runtime ne sont plus requis mais doivent rester reconstructibles depuis la DB
- compatibilité multi-version: un même repo peut contenir des artefacts legacy + modernes; les contrôles doivent se baser sur la structure observée, pas uniquement sur la version déclarée.
- les artefacts Markdown doivent évoluer vers un rôle de projection lisible (générée), avec un état canonique optimisé côté JSON/SQLite.

## Statut D'Exécution

État au 2026-03-03:
- Lot 1 (Quick wins): implémenté (instrumentation NDJSON, L1/L2/L3 gating, écritures conditionnelles, hooks session).
- Lot 2 (Index local): implémenté (reload incrémental + fallback, index sync/check, structure profile multi-version, trend/check pipelines).
- Lot 3 (DB future): implémenté en mode local SQLite progressif (store modes `sqlite|dual-sqlite|all`, import/export, parity SQL+SQLite, CI fixtures dédiées, feature flag `AIDN_INDEX_STORE_MODE`).
- Lot 3 (projection canonique): rendu Markdown déterministe branché sur état canonique (`canonical_format` + `canonical`), avec fallback export DB->files même en `--no-content`.
- Lot 3 (projection incrémentale): mise à jour section-level des projections Markdown via blocs gérés (`aidn:block:*`) pour réduire le churn lors des exports répétés.
- Lot 3 (pilotage CI): seuils index enrichis avec garde-fous de couverture canonique (`INDEX_CANONICAL_*`) et résumé index mis à jour.
- Lot 3 (trend guardrails): pipeline de régression dédié à la couverture canonique (`index-report -> index-regression-kpi -> history -> check-regression`).
- Lot 3 (fast guardrail): check léger CI de couverture canonique directement depuis `index-query canonical-coverage`.
- Lot 3 (PR observability): résumé Markdown dédié du check canonique publié dans `GITHUB_STEP_SUMMARY` pour lecture immédiate.
- Lot 3 (CLI reliability): vérification fixture des alias `aidn perf` pour les commandes index/canonical ajoutées.
- Lot 3 (ops controls): contrôle strict dédié `strict_index_canonical` dans `workflow_dispatch`.
- Lot 4 (TOC prep): rapport de contrainte active (`report-constraints`) + seuils dédiés (`CONSTRAINT_TARGETS`) + backlog priorisé (`constraint-actions`) + résumé Markdown CI (`constraint-summary`) avec vérification fixture dédiée.

Reste à finaliser:
- validation KPI sur un corpus projet réel (au-delà des fixtures) avec fenêtre d'itérations représentative.
- confirmation des objectifs de réduction vs baseline historique du projet cible.

Dernière campagne locale de validation (fixtures, 30 itérations):
- date: 2026-03-03
- commande: `npm run perf:campaign -- --iterations 30 --target tests/fixtures/repo-installed-core --sleep-ms 500 --index-store all --json`
- `runs_analyzed`: 30
- `overhead_ratio.mean`: 2.68662084302406
- `artifacts_churn.mean`: 0.10
- `gates_frequency.mean`: 10
- `kpi thresholds`: `pass` (4/4)

Hors scope (pour ce plan):
- réécriture complète des skills
- suppression immédiate des artefacts Markdown lisibles (ils restent requis pour la transition et l'audit humain)

## Corpus Pilote Et Taxonomie D'Artefacts

Référence terrain utilisée pour calibrage:
- corpus `docs/audit` multi-versions et multi-artefacts (sessions, cycles, baseline, snapshot, rapports, migration, backlog, incidents).

Constat principal:
- les cycles ne contiennent pas uniquement les artefacts "standards" (`status`, `plan`, `brief`, `traceability`, ...),
- ils incluent aussi des artefacts de support hétérogènes (ex: `report*.md`, `profiling.md`, `migration-plan.md`, `contract-spec.md`, `validation.md`, `*.patch`).

Décision de planification:
- l'import DB ne doit pas ignorer les artefacts hors gabarit standard,
- la taxonomie DB doit distinguer:
  - artefacts normatifs (pilotent les gates),
  - artefacts de support (preuves, analyses, rapports, migration),
- l'export doit permettre reconstruction complète des dossiers cycle/session, y compris artefacts de support.
- le format canonique runtime doit être structuré (JSON/SQLite) et les `.md` générés comme projection déterministe pour lecture/revue.

## Carte De Profiling Instrumentable

### Points de coût (où mesurer)

| Zone | Coût principal | Mesures |
|---|---|---|
| `context-reload` | lecture snapshot/baseline/cycles + classification branche | `duration_ms`, `files_read_count`, `bytes_read`, `active_cycles_count` |
| `start-session` | remplissage session + checks DoR/mapping | `duration_ms`, `writes_count`, `gates_triggered` |
| `branch-cycle-audit` | scan cycles actifs + regex branch + checks continuité | `duration_ms`, `git_calls_count`, `mapping_status` |
| `drift-check` | analyse signaux + rapport recovery + CR/parking-lot | `duration_ms`, `signals_count`, `drift_level` |
| `close-session` | résolution cycles ouverts + update snapshot | `duration_ms`, `open_cycles_count`, `decisions_count` |
| writeups | mise à jour multiple d'artefacts (normatifs + support) | `writes_count`, `bytes_written`, `artifacts_touched`, `support_artifacts_touched` |
| surcontexte | chargement de fichiers non nécessaires | `files_read_unneeded`, `context_bytes_total` |

### Couverture Skills (plan d'extension)

Constat courant:
- hooks perf explicites déjà branchés: `start-session`, `close-session`.
- skills du pack à couvrir: `branch-cycle-audit`, `close-session`, `context-reload`, `convert-to-spike`, `cycle-close`, `cycle-create`, `drift-check`, `promote-baseline`, `requirements-delta`, `start-session`.

Approche recommandée (incrémentale):
- Phase 1 (skills coûteuses, impact latence): `context-reload`, `branch-cycle-audit`, `drift-check`.
- Phase 2 (skills mutatrices, impact churn/traçabilité): `cycle-create`, `cycle-close`, `promote-baseline`, `requirements-delta`.
- Phase 3 (skills restantes, harmonisation): `convert-to-spike` + consolidation des hooks session existants.

Règle d'implémentation:
- éviter la duplication dans chaque skill: centraliser via `perf:checkpoint` / `perf:hook`.
- instrumenter chaque skill avec un événement minimal `start/end` + compteurs de fichiers/gates.
- préserver le mode non bloquant par défaut, basculable en strict.

### Format de logs minimal (NDJSON)

Fichier recommandé:
- `.aidn/runtime/perf/workflow-events.ndjson`

1 ligne = 1 événement.

Champs exacts:

| Champ | Type | Description |
|---|---|---|
| `ts` | string (ISO-8601 UTC) | horodatage événement |
| `run_id` | string | identifiant d'itération (session + horodatage) |
| `session_id` | string \| null | ex: `S072` |
| `cycle_id` | string \| null | ex: `C118` |
| `branch` | string | branche git courante |
| `mode` | string | `THINKING|EXPLORING|COMMITTING` |
| `skill` | string | ex: `context-reload` |
| `phase` | string | `start|check|write|end|fallback` |
| `event` | string | nom court de l'étape |
| `duration_ms` | integer | durée de l'étape |
| `files_read_count` | integer | nb fichiers lus |
| `bytes_read` | integer | octets lus |
| `files_written_count` | integer | nb fichiers écrits |
| `bytes_written` | integer | octets écrits |
| `gates_triggered` | array<string> | ex: `["R03","R04"]` |
| `result` | string | `ok|warn|stop|fallback` |
| `reason_code` | string \| null | ex: `DIGEST_MISS`, `MAPPING_AMBIGUOUS` |
| `trace_id` | string | corrélation multi-étapes |

Exemple:

```json
{"ts":"2026-03-01T10:12:04Z","run_id":"S072-20260301T1012","session_id":"S072","cycle_id":"C118","branch":"feature/C118-cache-reload","mode":"COMMITTING","skill":"context-reload","phase":"end","event":"reload_summary","duration_ms":842,"files_read_count":7,"bytes_read":18342,"files_written_count":0,"bytes_written":0,"gates_triggered":["R01"],"result":"ok","reason_code":null,"trace_id":"tr-7f12"}
```

## KPI (3 KPI imposés)

### 1) Overhead Ratio

Définition:
- `overhead_ratio = control_time_ms / delivery_time_ms`

Où:
- `control_time_ms` = somme (`context-reload`, `start-session`, `branch-cycle-audit`, `drift-check`, `close-session`, writeups de conformité)
- `delivery_time_ms` = temps d'implémentation/exécution utile (hors gates)

Cible:
- Lot 1: -20% vs baseline
- Lot 2: -35% vs baseline
- Lot 3: -50% vs baseline

### 2) Artifacts Churn

Définition:
- `artifacts_churn = (artifact_writes + artifact_rewrites + artifact_deletes) / iteration`

Artefacts concernés:
- normatifs: `status.md`, `SXXX.md`, `context-snapshot.md`, `change-requests.md`, `parking-lot.md`
- support: `report*.md`, `profiling.md`, `migration-*.md`, `contract-spec.md`, `validation.md`, autres artefacts cycle non normatifs

Cible:
- Lot 1: -15%
- Lot 2: -30%
- Lot 3: -40%

### 3) Gates Frequency

Définition:
- `gates_frequency = gates_executed / iteration`
- suivi complémentaire: `gates_stop_rate = stops / gates_executed`

Interprétation:
- on vise moins d'exécutions redondantes, pas moins de couverture.
- le `stop_rate` ne doit pas monter après optimisation.

Cible:
- `gates_frequency`: -20% de redondance (mêmes gates relancées sans changement de contexte)
- `gates_stop_rate`: stable ou en baisse

## Plan En 3 Lots

## Lot 1 - Quick Wins (instrumentation + allègement contrôlé)

Objectifs mesurables:
- instrumentation active sur 100% des skills critiques
- `context-reload` p50 < 1.5s sur repo de référence
- overhead ratio -20% sans régression qualité

Tâches techniques:
- ajouter logger NDJSON standard dans les points d'entrée skills
- introduire checks L1 rapides avant gates lourdes
- éviter relecture/écriture d'artefacts inchangés
- templates de writeups plus concis (même contenu normatif, moins duplication)
- ajouter un check de profil structurel (`legacy|modern|mixed|unknown`) avec signaux de fiabilité (version déclarée vs structure observée)
- brancher hooks perf sur les 3 skills coûteuses (`context-reload`, `branch-cycle-audit`, `drift-check`) via wrapper commun

Risques:
- sous-instrumentation (angles morts)
- optimisation trop agressive qui masque un drift réel
- faux positifs de version si la détection repose sur le champ `workflow_version` seul

Critères d'acceptation:
- KPI disponibles sur 30 itérations minimum
- zéro violation des invariants `SPEC-R01`, `R03`, `R04`, `R07`
- aucun incident L3/L4 causé par les quick wins
- repos mixtes (legacy+modern) détectés explicitement et routés vers checks conditionnels sans blocage erroné
- couverture instrumentation: 5/10 skills minimum (`start-session`, `close-session` + 3 skills coûteuses)

Definition of Done (Lot 1):
- logs NDJSON exploitables
- dashboard simple (script CLI) pour les 3 KPI
- documentation d'exploitation + rollback activable
- baseline de coverage skills instrumentées atteinte (5/10) et vérifiée sur fixtures

## Lot 2 - Index Local (cache + index fichier, source de vérité inchangée)

Objectifs mesurables:
- reload incrémental opérationnel
- -35% overhead ratio vs baseline
- -30% artifacts churn

Tâches techniques:
- implémenter digest global + digest par artefact
- cache local de reload (`.aidn/runtime/cache/reload-state.json`)
- index local (fichier ou SQLite local) pour lookup cycles/artefacts/tags
- invalider finement par changement baseline/snapshot/cycle/session/branch
- étape de normalisation structurelle: policy d'artefacts requis par profil + codes raison normalisés (`STRUCTURE_MIXED_PROFILE`, etc.)
- classer chaque artefact importé par famille (`normative|support`) + type (`status|plan|report|profiling|...`)
- ne jamais bloquer un import parce qu'un artefact est inconnu: classer en `support/unknown` avec `reason_code`
- étendre l'instrumentation aux skills mutatrices (`cycle-create`, `cycle-close`, `promote-baseline`, `requirements-delta`)

Risques:
- incohérence cache <> fichiers
- invalidation trop permissive (stale reads)

Critères d'acceptation:
- fallback full reload automatique sur incohérence
- parité fonctionnelle entre mode full et mode incrémental
- 0 perte de traçabilité (tous les champs de conformité restent présents)
- profile check détecte correctement `legacy|modern|mixed` sur corpus de référence, sans se fier au seul numéro de version déclaré
- import couvre 100% des fichiers `docs/audit` observés sur corpus pilote (aucun fichier silencieusement ignoré)
- couverture instrumentation: 9/10 skills minimum (incluant toutes les skills mutatrices)

Definition of Done (Lot 2):
- pipeline incremental reload activé par défaut avec fallback
- tests d'invalidation (baseline/snapshot/cycle/branch)
- script de rebuild index local depuis les fichiers
- hooks perf harmonisés sur skills mutatrices + métriques churn/gates exploitables par skill

## Lot 3 - DB Future (SQLite dev, modes dual/db-only, non bloquante)

Objectifs mesurables:
- préparation d'un backend DB (SQLite renforcé puis cible Postgres) sans casser le mode fichiers
- -50% overhead ratio vs baseline
- requêtes analytiques < 100ms sur dataset de test
- modes d'exécution configurables:
  - `AIDN_STATE_MODE=dual` (transition),
  - `AIDN_STATE_MODE=db-only` (runtime sans dépendance aux fichiers sessions/cycles)

Tâches techniques:
- introduire adaptateur `IndexStore` (file, sqlite, future remote)
- ajouter mode dual-write contrôlé (fichiers + index) avec vérification de parité
- ajouter mode `db-only` (gates lisent la DB; génération fichiers à la demande)
- exporter métriques et états de contrôle pour analytics/CI
- formaliser un schéma canonique par artefact (`status`, `session`, `cycle`, `support`) côté JSON/SQLite
- implémenter rendu Markdown déterministe depuis l'état canonique (projection lisible)
- implémenter rendu incrémental des `.md` (sections impactées uniquement, pas réécriture complète systématique)
- implémenter commandes:
  - import `files -> db` (avec taxonomie normatif/support),
  - export `db -> files` (reconstruction complète),
  - verify parity `files <-> db`
- finaliser couverture 10/10 skills avec wrapper unique (`perf:checkpoint`) et déprécier les hooks ad hoc

Risques:
- divergence entre écritures fichiers et DB
- complexité opérationnelle trop tôt

Critères d'acceptation:
- mode DB désactivable sans impact (feature flag)
- aucune dépendance bloquante réseau pour exécution standard
- migration/rebuild complète depuis fichiers validée
- en `db-only`, les décisions de gates sont équivalentes à `dual` sur corpus de référence
- reconstruction d'un repo complet depuis DB validée (cycles/sessions + artefacts de support)
- les `.md` régénérés depuis l'état canonique restent lisibles et stables (pas de churn inutile hors sections modifiées)

Definition of Done (Lot 3):
- contrat d'interface `IndexStore` stable
- migration dry-run documentée
- plan de rollback DB -> file-only testé
- contrat d'état `AIDN_STATE_MODE` documenté (`files|dual|db-only`)
- tests automatiques import/export/parité incluant artefacts de support
- test automatique d'équivalence `dual` vs `db-only` pour `reload-check` + `gating-evaluate` (`perf:verify-state-mode-parity`)
- couverture instrumentation 10/10 skills validée (mêmes garanties qualité, coût réduit)
- renderer Markdown branché sur état canonique + tests de stabilité (idempotence/rendu partiel)

## Backlog Priorisé

1. Instrumentation NDJSON commune (skills critiques)
2. Calculateur KPI CLI (overhead/churn/frequency)
3. L1 fast checks (hash + branch mapping)
4. Dédup writeups (écriture conditionnelle si contenu inchangé)
5. Digest incremental reload + invalidation fine
6. Fallback full reload + codes erreur normalisés
7. Index local minimal (fichier puis SQLite)
8. Requêtes analytiques standard (actifs, churn, fréquence gates)
9. Dual-write contrôlé + tests de parité
10. Feature flag DB future + doc migration
11. Normalisation multi-version (profil structurel + policy d'artefacts requis par profil)
12. Taxonomie artefacts (normatif/support/unknown) + parser tolérant
13. Reconstruction DB -> fichiers (cycles/sessions + supports)
14. Équivalence de décision des gates entre modes `dual` et `db-only`
15. Couverture perf Phase 1: hooks sur `context-reload`, `branch-cycle-audit`, `drift-check`
16. Couverture perf Phase 2: hooks sur `cycle-create`, `cycle-close`, `promote-baseline`, `requirements-delta`
17. Couverture perf Phase 3: hooks sur `convert-to-spike` + uniformisation wrapper unique
18. Schéma canonique artefacts runtime (JSON/SQLite) pour `status/session/cycle/support`
19. Renderer Markdown déterministe depuis état canonique
20. Rendu Markdown incrémental (sections impactées uniquement)

## Acceptance Criteria Globaux

- Les règles qualité du workflow restent appliquées (DoR/DoD/drift/traçabilité).
- Les KPI démontrent un gain mesurable sur 30 itérations minimum.
- Toute incohérence détectée force un fallback sûr (full reload + trace incident si nécessaire).
- Aucune suppression de gate canonique; seulement réduction de relances inutiles.
- Aucune perte silencieuse d'artefact lors d'import/export (incluant artefacts de support non standard).
- La couverture d'optimisation est étendue à 100% des skills du pack sans baisse des garanties DoR/DoD/drift-check.
- Les artefacts Markdown deviennent des projections stables de l'état canonique, sans perte d'information ni surcharge de churn.

## Structure Recommandée A Créer

- `docs/performance/WORKFLOW_PERFORMANCE_PLAN.md`
- `docs/performance/PRIORITIZATION_MATRIX.md`
- `docs/rfc/RFC-0001-reload-incremental-gating-index.md`
- `tools/perf/collect-event.mjs`
- `tools/perf/report-kpi.mjs`
- `tools/perf/index-sync.mjs`
- `tools/perf/sql/schema.sql`
- `.aidn/runtime/perf/workflow-events.ndjson`
- `.aidn/runtime/cache/reload-state.json`
- `.aidn/runtime/index/workflow-index.sqlite`
