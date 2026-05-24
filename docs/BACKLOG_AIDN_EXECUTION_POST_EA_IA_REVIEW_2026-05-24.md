# Backlog exécutable post-analyse EA/IA AIDN

Référence de cadrage: [docs/PLAN_AIDN_EXECUTION_POST_EA_IA_REVIEW_2026-05-24.md](/g:/projets/aidn/docs/PLAN_AIDN_EXECUTION_POST_EA_IA_REVIEW_2026-05-24.md)

Ce backlog transforme le diagnostic EA/IA en lots exécutables, petits et reviewables. L’ordre est volontairement conservateur: sécuriser d’abord la sémantique des commandes et les contrats, puis faire descendre la gouvernance d’information dans les producteurs d’artefacts, ensuite renforcer l’exploitation locale et la release.

## Statut d’exécution

Les lots suivants ont déjà été traités sur `dev` et ne doivent pas être replanifiés comme du nouveau travail:
- `project-runtime-state` et `project-handoff-packet` sont read-only par défaut, avec écriture explicite;
- les politiques d’effet CLI, les contrats critiques et les fixtures runtime ont été durcis;
- la gouvernance `source_of_truth` / `metadata` a été propagée dans les sorties runtime critiques;
- les familles de gates CI sont branchées via un workflow dédié et documentées;
- le flux release a été rendu plus atomique et mieux vérifiable;
- le flux release a désormais un gate unique `perf:verify-release-flow` qui enchaîne version, build, artifacts et pack topology;
- un baseline sécurité CI minimal est désormais branché via un workflow dédié et un gate agrégé;
- les runbooks shared coordination backup / restore / doctor ont été productisés;
- la restauration shared coordination expose désormais une validation post-restore explicite et testée;
- les modes `files`, `dual` et `db-only` sont documentés avec des checks recommandés;
- le cockpit architecture, l’index documentaire et les renvois actifs/archivés ont été ajoutés;
- la navigation documentaire racine a été simplifiée pour éviter de réafficher des plans historiques dans l’entrée active;
- `runtime-project-coordination-summary` et les artefacts multi-agent associés ont été durcis et validés par fixture.
- `project-coordination-summary` a été extrait vers un use case applicatif direct avec garde de non-régression, tandis que le wrapper CLI est redevenu un routage mince.

Toutes les lignes de backlog ci-dessous sont désormais marquées `done` pour refléter l’état livré sur `dev`.

Les sections ci-dessous restent le backlog de référence pour les lots encore ouverts ou à reprendre plus tard.

## P0 - Sécuriser la sémantique des commandes

| ID | Titre | Problème adressé | Description | Fichiers probables à modifier | Critères d’acceptation | Tests ou gates à ajouter | Risques | Dépendances | Taille | Statut |
|---|---|---|---|---|---|---|---|---|---|---|
| P0-01 | Finaliser les classes d’effet publiques du CLI | Effets publics pas assez lisibles | Vérifier que chaque commande publique stable a une classe d’effet claire: `read-only`, `preview`, `projector`, `mutating`, `executor` | `bin/aidn.mjs`, `src/core/cli/effect-policy.mjs`, `docs/CLI_SURFACE_INVENTORY.md` | Toutes les commandes publiques stables sont classées et documentées | `perf:verify-cli-effect-policy`, inventaire CLI | Mauvais reclassement d’une commande historique | Aucun | M | done |
| P0-02 | Rendre `aidn runtime project-runtime-state --json` read-only par défaut | `--json` ambigu et écriture implicite possible | Séparer le calcul du runtime state de l’écriture du digest Markdown; l’écriture devient explicite via `--write` ou commande dédiée | `tools/runtime/project-runtime-state.mjs`, `src/application/runtime/runtime-state-projector-use-case.mjs`, `src/core/contracts/cli-output/runtime-project-runtime-state.v1.schema.json` | `--json` ne modifie plus le checkout par défaut | `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts` | Régression des usages actuels | P0-01 | L | done |
| P0-03 | Rendre `aidn runtime project-handoff-packet --json` read-only par défaut | Projection et sync encore couplées | Séparer lecture du handoff packet, projection locale et synchronisation relay/shared coordination | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/handoff-packet-projector-use-case.mjs`, `src/application/runtime/shared-coordination-store-service.mjs` | La synchronisation n’est jamais implicite | `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts` | Frontière shared/local mal recousue | P0-01 | L | done |
| P0-04 | Ajouter ou brancher un gate `no implicit write` | Mutation surprise | Le gate doit échouer si une commande read-only ou preview modifie le checkout | `tools/perf/verify-cli-no-implicit-write-fixtures.mjs`, `.github/workflows/*`, `package.json` | Les paths checkout-bound restent inchangés pour les commandes classées read-only/preview | `perf:verify-cli-no-implicit-write` en CI | Faux positifs sur fixtures anciennes | P0-01 | M | done |
| P0-05 | Mettre à jour la documentation CLI | Docs pas assez explicites sur les effets | Documenter clairement la classe d’effet de chaque commande stable | `README.md`, `docs/CLI_SURFACE_INVENTORY.md` | Un lecteur peut automatiser sans supposer un effet | Revue docs + lien vers inventory | Sur-documentation | P0-01 | S | done |
| P0-06 | Durcir les contrats JSON critiques | Schémas trop souples | Cibler au minimum runtime state, handoff packet, pre-write-admit, handoff-admit, governance-diagnostics | `src/core/contracts/cli-output/*`, `src/application/runtime/*` | Les nested objects critiques sont durcis sans casser la compatibilité nécessaire | `perf:verify-cli-output-contracts` | Régression d’intégration externe | P0-02, P0-03 | M | done |
| P0-07 | Ajouter des golden fixtures runtime | Absence de référence stable | Créer des fixtures pour les cas nominal et erreur des surfaces critiques | `tools/perf/*fixtures.mjs`, `tests/fixtures/*`, `src/core/contracts/cli-output/*` | Cas nominal et erreurs principales couverts | `perf:verify-cli-output-contracts`, fixtures golden runtime | Explosion du nombre de fixtures | P0-02, P0-03 | M | done |

## P1 - Gouvernance de l’information appliquée

| ID | Titre | Problème adressé | Description | Fichiers probables à modifier | Critères d’acceptation | Tests ou gates à ajouter | Risques | Dépendances | Taille | Statut |
|---|---|---|---|---|---|---|---|---|---|---|
| P1-01 | Propager `source_of_truth` dans les artefacts runtime critiques | SoT pas uniformément exposée | Les artefacts produits doivent exposer ou dériver clairement leur source de vérité | `src/application/runtime/*`, `src/core/source-of-truth/source-of-truth-policy.mjs` | Les sorties critiques portent une SoT explicite ou un diagnostic clair | `perf:verify-source-of-truth-policy`, `perf:verify-governance-diagnostics-use-case` | Warnings supplémentaires | P0-06 | M | done |
| P1-02 | Propager `lifecycle_status` dans les artefacts runtime critiques | Cycle de vie incomplet | Les artefacts doivent indiquer s’ils sont actifs, projetés, stale, superseded, archived, etc. | `src/application/runtime/*`, `src/core/metadata/metadata-policy.mjs` | Le lifecycle est présent ou une exception documentée existe | `perf:verify-metadata-policy`, `perf:verify-governance-completeness` | Hétérogénéité des legacy fields | P1-01 | M | done |
| P1-03 | Consommer `metadata-policy` dans les producteurs d’artefacts | Metadata trop limitée au diagnostic | Ne pas limiter la policy de métadonnées au diagnostic | `src/application/runtime/*`, `tools/runtime/governance-diagnostics.mjs` | Les producteurs d’artefacts utilisent la policy comme source de champs obligatoires | `perf:verify-metadata-policy` | Bris de compat sur champs legacy | P1-02 | M | done |
| P1-04 | Compléter la couverture des concepts gouvernés | Concepts non homogènes | Valider Project, Workspace, Session, CycleStatus, Artifact, CurrentState, RuntimeState, HandoffPacket, Decision, Incident, RepairFinding, CoordinationRecord, CoordinationSummary, AgentAdapter, Snapshot, Baseline | `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`, `docs/ADR/ADR-0006-information-model.md` | Chaque concept a SoT, metadata et lifecycle ou une exception documentée | `perf:verify-governance-completeness` | Scope trop large pour une seule PR | P1-01 | L | done |
| P1-05 | Brancher les gates architecture dans GitHub Actions | CI trop monolithique | Ajouter explicitement les gates architecture dans la CI | `.github/workflows/perf-kpi.yml`, autres workflows CI | Les gates architecture sont exécutés de manière visible en PR | CI GitHub Actions | Allongement du pipeline | P0-04, P0-06 | M | done |
| P1-06 | Séparer les gates par famille | Signal CI confus | Créer une structure claire: contracts, runtime, governance, ops, perf, release | `.github/workflows/*`, `package.json` | Les familles de gates sont lisibles et actionnables | CI workflow refactor | Duplication de jobs | P1-05 | M | done |
| P1-07 | Extraire un use case read-only pour runtime state | Wrapper CLI trop lourd | Le wrapper CLI ne doit plus porter la logique métier lourde | `tools/runtime/project-runtime-state.mjs`, `src/application/runtime/runtime-state-projector-use-case.mjs` | Le use case peut être testé sans CLI | Tests unitaires de use case | Découplage incomplet | P0-02 | L | done |
| P1-08 | Extraire un use case projector explicite pour runtime state | Projection implicite | L’écriture de projection doit passer par un use case dédié et explicite | `tools/runtime/project-runtime-state.mjs`, `src/core/ports/artifact-projector-port.mjs` | L’écriture est un acte explicite et testable | `perf:verify-cli-no-implicit-write` | Risque de doublon de logique | P1-07 | M | done |
| P1-09 | Extraire un use case read-only pour handoff packet | Packet trop couplé | Le packet doit pouvoir être produit sans écrire | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/handoff-packet-projector-use-case.mjs` | Le mode lecture n’écrit rien | Tests unitaires + golden fixture | Régression du packet | P0-03 | L | done |
| P1-10 | Extraire un use case relay/sync explicite pour handoff packet | Sync implicite | La synchronisation partagée ne doit jamais être implicite | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/shared-coordination-store-service.mjs` | Le relay ne s’active que par intention claire | `perf:verify-shared-coordination-runtime-cli` | Complexité d’options | P1-09 | M | done |
| P1-11 | Adopter `artifact-projector-port` | Écritures dispersées | Les écritures de projections doivent passer par un port | `src/core/ports/artifact-projector-port.mjs`, `src/adapters/runtime/artifact-projector-adapter.mjs`, `src/application/runtime/*` | Aucune écriture directe hors port | Test d’intégration port/adapters | Migration progressive | P1-08 | M | done |

## P2 - Exploitabilité locale

| ID | Titre | Problème adressé | Description | Fichiers probables à modifier | Critères d’acceptation | Tests ou gates à ajouter | Risques | Dépendances | Taille | Statut |
|---|---|---|---|---|---|---|---|---|---|---|
| P2-01 | Productiser backup/restore/doctor | Exploitation locale dispersée | Créer ou renforcer les runbooks | `docs/*`, `tools/runtime/shared-coordination-backup.mjs`, `tools/runtime/shared-coordination-restore.mjs`, `tools/runtime/shared-coordination-doctor.mjs` | Runbooks simples et vérifiables | `perf:verify-shared-coordination-backup`, `perf:verify-shared-coordination-restore`, `perf:verify-shared-coordination-doctor` | Runbooks trop verbeux | Aucun | M | done |
| P2-02 | Ajouter validation post-restore | Restauration non vérifiée | Après restore, vérifier runtime state, metadata, source of truth, shared boundary, digests | `tools/runtime/shared-coordination-restore.mjs`, `tools/runtime/db-backup.mjs` | La restauration est suivie d’une validation ciblée | Tests fixture restore + validation | Temps de vérification | P2-01 | M | done |
| P2-03 | Clarifier les modes `files`, `dual`, `db-only` | Modes mal expliqués | Documenter source de vérité, projections, stores, risques et commandes recommandées | `README.md`, `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, `docs/CLI_SURFACE_INVENTORY.md` | Chaque mode est exploitable sans hypothèse cachée | Doc review + gates mode parity | Documentation divergente | P1-01 | S | done |
| P2-04 | Rendre le flux release atomique | Release multi-étapes | Vérifier dans un seul flux VERSION, package.json, build-release, manifest, checksums, npm package surface | `VERSION`, `package.json`, `tools/build-release.mjs`, `tools/install.mjs` | Release cohérente et reproductible | `perf:verify-release-version`, `perf:verify-release-artifacts` | Couplage release plus strict | Aucun | M | done |
| P2-05 | Ajouter ou renforcer le manifest de release | Provenance insuffisamment démontrée | Le manifest doit permettre de vérifier provenance et cohérence des artefacts | `tools/build-release.mjs`, `release/*`, `docs/ADR/ADR-0009-release-versioning-provenance.md` | Artefacts vérifiables par checksum et provenance | Release artifact gate | Complexité du packaging | P2-04 | M | done |

## P3 - Rationalisation documentaire

| ID | Titre | Problème adressé | Description | Fichiers probables à modifier | Critères d’acceptation | Tests ou gates à ajouter | Risques | Dépendances | Taille | Statut |
|---|---|---|---|---|---|---|---|---|---|---|
| P3-01 | Créer un cockpit architecture léger | Entrée architecture dispersée | Relier ADR, plan EA/IA, backlog, runtime surface matrix, CLI inventory, governance diagnostics | `docs/*` | Une page d’entrée unique vers les artefacts utiles | Revue doc | Surfacing documentaire inutile | Aucun | S | done |
| P3-02 | Réduire la dispersion documentaire | Multiplicité de plans et de matrices | Identifier les documents obsolètes, redondants ou à fusionner, sans supprimer l’historique utile | `docs/*` | L’historique utile reste, mais la navigation devient plus simple | Revue doc + inventaire | Perte de trace historique | P3-01 | M | done |

## Séquence d’exécution

1. Inventorier les commandes publiques stables du CLI.
2. Associer une classe d’effet à chaque commande.
3. Vérifier les commandes qui écrivent sans flag explicite.
4. Corriger `project-runtime-state` pour séparer read et write.
5. Corriger `project-handoff-packet` pour séparer read, write et sync.
6. Ajouter ou brancher le gate `no-implicit-write`.
7. Ajouter des fixtures golden pour runtime state.
8. Ajouter des fixtures golden pour handoff packet.
9. Durcir les schémas JSON critiques.
10. Brancher les gates de contrats en CI.
11. Propager SoT et metadata dans les artefacts runtime critiques.
12. Mettre à jour les ADR concernées.

## Definition of Done du backlog

Le backlog est considéré comme engagé lorsque:
- aucune commande read-only ou preview ne modifie le checkout;
- `--json` ne provoque pas d’écriture implicite;
- toute commande mutante a un flag ou une intention explicite;
- les commandes runtime critiques ont un contrat JSON public;
- les sorties critiques ont des golden fixtures;
- les politiques source-of-truth et metadata sont consommées dans les producteurs d’artefacts;
- les concepts informationnels critiques sont couverts ou ont une exception documentée;
- les gates architecture sont exécutés en CI;
- la frontière local-first/shared runtime est protégée par des tests;
- la release/provenance est vérifiable;
- les ADR et la documentation utilisateur sont alignées.
