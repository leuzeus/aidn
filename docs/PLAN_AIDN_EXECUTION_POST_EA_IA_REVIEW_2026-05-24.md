# Plan d’exécution post-analyse EA/IA AIDN

Backlog exécutable associé: [docs/BACKLOG_AIDN_EXECUTION_POST_EA_IA_REVIEW_2026-05-24.md](/g:/projets/aidn/docs/BACKLOG_AIDN_EXECUTION_POST_EA_IA_REVIEW_2026-05-24.md)

## 1. Résumé de la situation actuelle

AIDN a déjà franchi une étape importante sur la branche `dev`. Le dépôt n’est plus un simple pack de templates: il expose un CLI public `aidn`, des commandes runtime, des modes de state management `files`, `dual`, `db-only`, des projections Markdown, des stores SQLite/PostgreSQL, des contrats JSON publics, des ADR structurantes, des policies de source of truth et de métadonnées, des mécanismes de coordination multi-agent, ainsi que des scripts de validation et de release. L’architecture existe donc déjà comme système, pas seulement comme intention.

Ce qui est déjà bien corrigé:
- la séparation de couches est visible entre `src/core`, `src/application`, `src/adapters` et les wrappers `tools/` / `bin/`;
- les politiques `source-of-truth` et `metadata` sont présentes et validables;
- les classes d’effet CLI existent déjà dans la base de code et la documentation de surface est structurée;
- les contrats JSON publics v1 sont déjà matérialisés sous `src/core/contracts/cli-output/`;
- plusieurs gates de vérification existent déjà dans `package.json` et dans les workflows GitHub;
- la frontière local-first / shared runtime est documentée et le PostgreSQL shared runtime reste opt-in.

Le problème restant est surtout un problème d’exécution des décisions d’architecture. Les ADR et les plans décrivent déjà l’objectif; l’écart est maintenant dans l’application systématique de ces décisions aux commandes runtime, aux producteurs d’artefacts, aux contrats JSON et à la CI. Autrement dit, AIDN doit passer d’une architecture “nommée et documentée” à une architecture “exécutable et vérifiable”.

Il faut stabiliser avant d’étendre pour trois raisons:
- certaines surfaces publiques restent trop larges ou trop ambiguës dans leurs effets réels;
- des commandes critiques mélangent encore lecture, projection, écriture et parfois synchronisation;
- les surfaces shared/local et les artefacts checkout-bound sont déjà sensibles, donc toute extension prématurée augmenterait le risque de dérive, de mutation implicite ou de brouillage du canon.

## 2. Diagnostic actionnable

| ID | Problème | Symptôme observé | Cause probable | Risque | Impact | Priorité | Fichiers concernés | Statut actuel |
|---|---|---|---|---|---|---|---|---|
| D-01 | Commandes runtime trop lourdes | `project-runtime-state` et `project-handoff-packet` portent encore une logique d’orchestration et de projection trop large | Extraction incomplète vers `src/application/runtime/*` | Régression de comportement, coût de review élevé | Maintenance fragile et refactorings plus risqués | P0 | `tools/runtime/project-runtime-state.mjs`, `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/runtime-state-projector-use-case.mjs`, `src/application/runtime/handoff-packet-projector-use-case.mjs` | Partiellement corrigé |
| D-02 | `--json` ambigu | Certaines commandes peuvent encore écrire alors que l’appelant voit un mode JSON | `--json` est interprété comme format de sortie, pas comme garantie d’immutabilité | Mutation surprise du checkout ou du backend | Automatisation trompée | P0 | `README.md`, `bin/aidn.mjs`, `src/core/cli/effect-policy.mjs`, `tools/runtime/*` | Clarifié mais pas partout verrouillé |
| D-03 | Écritures implicites | Des commandes read-only ou preview peuvent encore rafraîchir un digest Markdown | Séparation read / projector / mutating pas assez stricte | Fuite de mutation non intentionnelle | Checkout modifié sans intention explicite | P0 | `tools/runtime/project-runtime-state.mjs`, `tools/runtime/project-handoff-packet.mjs`, `tools/runtime/pre-write-admit.mjs`, `tools/runtime/handoff-admit.mjs` | À verrouiller |
| D-04 | Projecteurs qui mélangent lecture, projection, sync | Le même exécutable peut lire l’état, produire une vue et synchroniser | Use case, projection et relay partagé sont encore trop couplés | Frontière local/shared brouillée | Risque de synchronisation implicite | P0 | `tools/runtime/project-handoff-packet.mjs`, `tools/runtime/project-runtime-state.mjs`, `src/application/runtime/*projector*` | À séparer |
| D-05 | Politiques SoT/metadata partiellement appliquées | Les policies existent, mais tous les producteurs d’artefacts ne les consomment pas de la même façon | Les policies ont été centralisées après la première génération de scripts | Métadonnées manquantes ou inégales | Confiance moindre dans les artefacts runtime | P1 | `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`, `src/application/runtime/governance-diagnostics-use-case.mjs` | Partiellement appliqué |
| D-06 | Contrats JSON trop souples sur certains objets imbriqués | Les sorties critiques existent, mais certains nested objects restent peu contraints | Durcissement volontairement progressif avant les golden fixtures | Régressions de forme silencieuses | Intégrations plus fragiles | P0 | `src/core/contracts/cli-output/*.schema.json` | À durcir |
| D-07 | Gates architecture pas assez branchés en CI | Les vérifications existent dans `package.json`, mais la CI ne les regroupe pas toujours de manière explicite par famille | Croissance organique des scripts et des workflows | Signal PR moins lisible | Régressions architecture noyées dans les checks | P1 | `.github/workflows/perf-kpi.yml`, autres workflows CI, `package.json` | Partiellement branché |
| D-08 | Concepts d’information non couverts homogènement | Certains concepts gouvernés ont une couverture plus nette que d’autres | Le modèle d’information a grandi par couches successives | Gouvernance incomplète | Diagnostics et contrats hétérogènes | P1 | `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`, `docs/ADR/ADR-0006-information-model.md` | Couverture inégale |
| D-09 | Release/provenance pas encore atomique | VERSION, package, manifest, checksum et build sont alignés mais doivent rester vérifiables comme un seul flux | La release est encore gérée par plusieurs étapes séparées | Artefacts incohérents | Support et audit fragilisés | P2 | `VERSION`, `package.json`, `tools/build-release.mjs`, `tools/install.mjs`, `docs/ADR/ADR-0009-release-versioning-provenance.md` | Documenté, à durcir |
| D-10 | Frontière shared/local à protéger | PostgreSQL/shared runtime est disponible mais ne doit pas absorber les artefacts checkout-bound | Extension potentiellement trop facile si non gardée par ports et tests | Perte du local-first | Dérive d’architecture | P0 | `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, `docs/ADR/ADR-0007-local-first-federation-boundary.md`, `src/core/ports/*`, `src/application/runtime/shared-*` | Bien définie, à défendre |

## 3. Principes d’exécution

1. Local-first par défaut.
   - Définition: le comportement principal doit rester exploitable depuis le checkout local sans service central obligatoire.
   - Motivation: AIDN doit rester simple à adopter, déboguer et maintenir.
   - Implication dans le code: SQLite, fichiers Markdown et projections locales restent suffisants; PostgreSQL/shared runtime demeure opt-in.

2. Aucune écriture implicite.
   - Définition: une commande qui n’annonce pas explicitement une mutation ne doit pas modifier le checkout ni le backend partagé.
   - Motivation: protéger les utilisateurs, les fixtures et l’automatisation.
   - Implication dans le code: les `read-only`, `preview` et `--json` doivent être testés contre toute mutation cachée.

3. `--json` ne doit pas impliquer une mutation.
   - Définition: le format de sortie ne change pas l’effet.
   - Motivation: éviter que les intégrations traitent le JSON comme une garantie de lecture seule.
   - Implication dans le code: l’effet doit être porté par une classe d’effet et par des flags explicites, pas par le format.

4. Les projections ne sont pas la source de vérité.
   - Définition: un digest Markdown, un résumé ou un packet ne deviennent pas canoniques du seul fait qu’ils sont lisibles.
   - Motivation: éviter la confusion entre vue et canon.
   - Implication dans le code: les projecteurs doivent exposer leur source, leur fraîcheur et leur statut de projection.

5. Chaque commande publique doit avoir une classe d’effet.
   - Définition: la surface CLI publique doit être classée selon son impact.
   - Motivation: rendre les comportements auditables et testables.
   - Implication dans le code: inventaire CLI, policies d’effet et tests de cohérence doivent rester synchronisés.

6. Les contrats JSON publics doivent précéder les refactorings profonds.
   - Définition: une forme publique doit être fixée avant le déplacement de logique métier.
   - Motivation: réduire le blast radius des refactors.
   - Implication dans le code: schémas JSON, golden fixtures et compatibilité additive d’abord.

7. Les politiques SoT et metadata doivent être consommées par les producteurs d’artefacts.
   - Définition: les policies ne servent pas seulement à diagnostiquer; elles doivent alimenter les sorties.
   - Motivation: éviter une gouvernance décorative.
   - Implication dans le code: les use cases runtime doivent injecter `source_of_truth`, `lifecycle_status`, et les champs obligatoires.

8. Les wrappers CLI doivent rester minces.
   - Définition: `bin/` et `tools/runtime/*.mjs` orchestrent, mais n’abritent pas la logique métier lourde.
   - Motivation: faciliter les tests unitaires et la review.
   - Implication dans le code: déplacer la logique dans `src/application/runtime/*` et `src/core/*`.

9. Toute surface partagée doit passer par un port explicite.
   - Définition: pas d’accès direct et dispersé au shared coordination ou à ses dérivés.
   - Motivation: préserver la frontière local-first / shared runtime.
   - Implication dans le code: utiliser `src/core/ports/*` et les adapters dédiés.

10. Toute correction doit être testée par fixture, gate ou test unitaire.
   - Définition: pas de correction architecturale sans preuve exécutable.
   - Motivation: garder les changements petits, reviewables et stables.
   - Implication dans le code: chaque PR doit ajouter ou adapter un test/gate.

## 4. Architecture cible d’exécution

### core
Responsabilités:
- politiques;
- invariants;
- contrats;
- ports;
- classes d’effet;
- concepts informationnels.

Ce qui semble déjà présent:
- `src/core/cli/effect-policy.mjs`;
- `src/core/source-of-truth/source-of-truth-policy.mjs`;
- `src/core/metadata/metadata-policy.mjs`;
- `src/core/contracts/cli-output/*`;
- `src/core/ports/*`.

Ce qui doit être corrigé:
- durcir les contrats JSON critiques;
- compléter la couverture conceptuelle;
- rendre les politiques encore plus consommables par les use cases.

Fichiers à inspecter:
- `src/core/cli/effect-policy.mjs`
- `src/core/contracts/cli-output/*`
- `src/core/ports/*`
- `src/core/source-of-truth/source-of-truth-policy.mjs`
- `src/core/metadata/metadata-policy.mjs`

Risques de dérive:
- contrats trop permissifs;
- policies présentes mais non consommées;
- prolifération de concepts sans owner clair.

### application
Responsabilités:
- use cases runtime;
- admission;
- projection;
- handoff;
- gouvernance diagnostics;
- backup/restore;
- release checks.

Ce qui semble déjà présent:
- use cases séparés pour runtime, handoff, governance, shared coordination, persistence et coordination;
- services de validation et de résolution de workspace/shared runtime.

Ce qui doit être corrigé:
- extraire les projecteurs read-only;
- séparer write/sync des lectures;
- renforcer la consommation réelle des policies.

Fichiers à inspecter:
- `src/application/runtime/*`

Risques de dérive:
- use cases trop couplés aux wrappers CLI;
- logique d’orchestration dispersée;
- duplication d’invariants entre services.

### adapters
Responsabilités:
- filesystem;
- Git;
- SQLite;
- PostgreSQL;
- shared coordination;
- console;
- agents.

Ce qui semble déjà présent:
- adapters runtime pour SQLite/PostgreSQL, Git local et shared coordination;
- adapters codex et local shell agent.

Ce qui doit être corrigé:
- éviter les accès directs hors ports;
- garder PostgreSQL/shared runtime explicitement opt-in;
- faire respecter les frontières des surfaces checkout-bound.

Fichiers à inspecter:
- `src/adapters/*`
- `src/core/ports/*`

Risques de dérive:
- contournement des ports;
- mutation locale involontaire;
- confusion entre store local et surface partagée.

### cli/tools
Responsabilités:
- parsing des arguments;
- routage;
- rendu stdout/json;
- codes de sortie;
- aucun métier lourd.

Ce qui semble déjà présent:
- `bin/aidn.mjs` route les groupes CLI;
- les wrappers runtime sont nombreux mais structurés.

Ce qui doit être corrigé:
- alléger les scripts runtime épais;
- clarifier public/internal/experimental;
- rendre les effets explicites dans la surface publique.

Fichiers à inspecter:
- `bin/aidn.mjs`
- `tools/runtime/*`
- `tools/install.mjs`
- `tools/build-release.mjs`

Risques de dérive:
- CLI qui accumule la logique métier;
- ambiguïté sur les effets réels;
- surface publique plus large que le contrat.

### distribution
Responsabilités:
- install;
- build-release;
- manifestes;
- checksums;
- provenance;
- documentation publique.

Ce qui semble déjà présent:
- `tools/install.mjs`;
- `tools/build-release.mjs`;
- `VERSION`;
- `package.json` et `files`.

Ce qui doit être corrigé:
- rendre le flux release atomique et vérifiable;
- brancher les gates release dans la CI;
- maintenir la surface de distribution cohérente avec les contrats.

Fichiers à inspecter:
- `VERSION`
- `package.json`
- `tools/install.mjs`
- `tools/build-release.mjs`
- `docs/ADR/ADR-0009-release-versioning-provenance.md`

Risques de dérive:
- incohérence version/package/release;
- fuite de surfaces non désirées;
- provenance insuffisamment démontrée.

## 5. Backlog priorisé

### P0 - Sécuriser la sémantique des commandes

| ID | Titre | Problème adressé | Description | Fichiers probables à modifier | Critères d’acceptation | Tests ou gates à ajouter | Risques | Dépendances | Taille |
|---|---|---|---|---|---|---|---|---|---|
| P0-01 | Finaliser les classes d’effet publiques du CLI | Effets publics pas assez lisibles | Vérifier que chaque commande publique stable a une classe d’effet claire: `read-only`, `preview`, `projector`, `mutating`, `executor` | `bin/aidn.mjs`, `src/core/cli/effect-policy.mjs`, `docs/CLI_SURFACE_INVENTORY.md` | Toutes les commandes publiques stables sont classées et documentées | `perf:verify-cli-effect-policy`, inventaire CLI | Mauvais reclassement d’une commande historique | Aucun | M |
| P0-02 | Rendre `aidn runtime project-runtime-state --json` read-only par défaut | `--json` ambigu et écriture implicite possible | Séparer le calcul du runtime state de l’écriture du digest Markdown; l’écriture devient explicite via `--write` ou commande dédiée | `tools/runtime/project-runtime-state.mjs`, `src/application/runtime/runtime-state-projector-use-case.mjs`, `src/core/contracts/cli-output/runtime-project-runtime-state.v1.schema.json` | `--json` ne modifie plus le checkout par défaut | `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts` | Régression des usages actuels | P0-01 | L |
| P0-03 | Rendre `aidn runtime project-handoff-packet --json` read-only par défaut | Projection et sync encore couplées | Séparer lecture du handoff packet, projection locale et synchronisation relay/shared coordination | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/handoff-packet-projector-use-case.mjs`, `src/application/runtime/shared-coordination-store-service.mjs` | La synchronisation n’est jamais implicite | `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts` | Frontière shared/local mal recousue | P0-01 | L |
| P0-04 | Ajouter ou brancher un gate `no implicit write` | Mutation surprise | Le gate doit échouer si une commande read-only ou preview modifie le checkout | `tools/perf/verify-cli-no-implicit-write-fixtures.mjs`, `.github/workflows/*`, `package.json` | Les paths checkout-bound restent inchangés pour les commandes classées read-only/preview | `perf:verify-cli-no-implicit-write` en CI | Faux positifs sur fixtures anciennes | P0-01 | M |
| P0-05 | Mettre à jour la documentation CLI | Docs pas assez explicites sur les effets | Documenter clairement la classe d’effet de chaque commande stable | `README.md`, `docs/CLI_SURFACE_INVENTORY.md` | Un lecteur peut automatiser sans supposer un effet | Revue docs + lien vers inventory | Sur-documentation | P0-01 | S |
| P0-06 | Durcir les contrats JSON critiques | Schémas trop souples | Cibler au minimum runtime state, handoff packet, pre-write-admit, handoff-admit, governance-diagnostics | `src/core/contracts/cli-output/*`, `src/application/runtime/*` | Les nested objects critiques sont durcis sans casser la compatibilité nécessaire | `perf:verify-cli-output-contracts` | Régression d’intégration externe | P0-02, P0-03 | M |
| P0-07 | Ajouter des golden fixtures runtime | Absence de référence stable | Créer des fixtures pour les cas nominal et erreur des surfaces critiques | `tools/perf/*fixtures.mjs`, `tests/fixtures/*`, `src/core/contracts/cli-output/*` | Cas nominal et erreurs principales couverts | `perf:verify-cli-output-contracts`, fixtures golden runtime | Explosion du nombre de fixtures | P0-02, P0-03 | M |

### P1 - Gouvernance de l’information appliquée

| ID | Titre | Problème adressé | Description | Fichiers probables à modifier | Critères d’acceptation | Tests ou gates à ajouter | Risques | Dépendances | Taille |
|---|---|---|---|---|---|---|---|---|---|
| P1-01 | Propager `source_of_truth` dans les artefacts runtime critiques | SoT pas uniformément exposée | Les artefacts produits doivent exposer ou dériver clairement leur source de vérité | `src/application/runtime/*`, `src/core/source-of-truth/source-of-truth-policy.mjs` | Les sorties critiques portent une SoT explicite ou un diagnostic clair | `perf:verify-source-of-truth-policy`, `perf:verify-governance-diagnostics-use-case` | Warnings supplémentaires | P0-06 | M |
| P1-02 | Propager `lifecycle_status` dans les artefacts runtime critiques | Cycle de vie incomplet | Les artefacts doivent indiquer s’ils sont actifs, projetés, stale, superseded, archived, etc. | `src/application/runtime/*`, `src/core/metadata/metadata-policy.mjs` | Le lifecycle est présent ou une exception documentée existe | `perf:verify-metadata-policy`, `perf:verify-governance-completeness` | Hétérogénéité des legacy fields | P1-01 | M |
| P1-03 | Consommer `metadata-policy` dans les producteurs d’artefacts | Metadata trop limitée au diagnostic | Ne pas limiter la policy de métadonnées au diagnostic | `src/application/runtime/*`, `tools/runtime/governance-diagnostics.mjs` | Les producteurs d’artefacts utilisent la policy comme source de champs obligatoires | `perf:verify-metadata-policy` | Bris de compat sur champs legacy | P1-02 | M |
| P1-04 | Compléter la couverture des concepts gouvernés | Concepts non homogènes | Valider Project, Workspace, Session, CycleStatus, Artifact, CurrentState, RuntimeState, HandoffPacket, Decision, Incident, RepairFinding, CoordinationRecord, CoordinationSummary, AgentAdapter, Snapshot, Baseline | `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`, `docs/ADR/ADR-0006-information-model.md` | Chaque concept a SoT, metadata et lifecycle ou une exception documentée | `perf:verify-governance-completeness` | Scope trop large pour une seule PR | P1-01 | L |
| P1-05 | Brancher les gates architecture dans GitHub Actions | CI trop monolithique | Ajouter explicitement les gates architecture dans la CI | `.github/workflows/perf-kpi.yml`, autres workflows CI | Les gates architecture sont exécutés de manière visible en PR | CI GitHub Actions | Allongement du pipeline | P0-04, P0-06 | M |
| P1-06 | Séparer les gates par famille | Signal CI confus | Créer une structure claire: contracts, runtime, governance, ops, perf, release | `.github/workflows/*`, `package.json` | Les familles de gates sont lisibles et actionnables | CI workflow refactor | Duplication de jobs | P1-05 | M |
| P1-07 | Extraire un use case read-only pour runtime state | Wrapper CLI trop lourd | Le wrapper CLI ne doit plus porter la logique métier lourde | `tools/runtime/project-runtime-state.mjs`, `src/application/runtime/runtime-state-projector-use-case.mjs` | Le use case peut être testé sans CLI | tests unitaires de use case | Découplage incomplet | P0-02 | L |
| P1-08 | Extraire un use case projector explicite pour runtime state | Projection implicite | L’écriture de projection doit passer par un use case dédié et explicite | `tools/runtime/project-runtime-state.mjs`, `src/core/ports/artifact-projector-port.mjs` | L’écriture est un acte explicite et testable | `perf:verify-cli-no-implicit-write` | Risque de doublon de logique | P1-07 | M |
| P1-09 | Extraire un use case read-only pour handoff packet | Packet trop couplé | Le packet doit pouvoir être produit sans écrire | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/handoff-packet-projector-use-case.mjs` | Le mode lecture n’écrit rien | tests unitaires + golden fixture | Régression du packet | P0-03 | L |
| P1-10 | Extraire un use case relay/sync explicite pour handoff packet | Sync implicite | La synchronisation partagée ne doit jamais être implicite | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/shared-coordination-store-service.mjs` | Le relay ne s’active que par intention claire | `perf:verify-shared-coordination-runtime-cli` | Complexité d’options | P1-09 | M |
| P1-11 | Adopter `artifact-projector-port` | Écritures dispersées | Les écritures de projections doivent passer par un port | `src/core/ports/artifact-projector-port.mjs`, `src/adapters/runtime/artifact-projector-adapter.mjs`, `src/application/runtime/*` | Aucune écriture directe hors port | test d’intégration port/adapters | Migration progressive | P1-08 | M |

### P2 - Exploitabilité locale

| ID | Titre | Problème adressé | Description | Fichiers probables à modifier | Critères d’acceptation | Tests ou gates à ajouter | Risques | Dépendances | Taille |
|---|---|---|---|---|---|---|---|---|---|
| P2-01 | Productiser backup/restore/doctor | Exploitation locale dispersée | Créer ou renforcer les runbooks | `docs/*`, `tools/runtime/shared-coordination-backup.mjs`, `tools/runtime/shared-coordination-restore.mjs`, `tools/runtime/shared-coordination-doctor.mjs` | Runbooks simples et vérifiables | `perf:verify-shared-coordination-backup`, `perf:verify-shared-coordination-restore`, `perf:verify-shared-coordination-doctor` | Runbooks trop verbeux | Aucun | M |
| P2-02 | Ajouter validation post-restore | Restauration non vérifiée | Après restore, vérifier runtime state, metadata, source of truth, shared boundary, digests | `tools/runtime/shared-coordination-restore.mjs`, `tools/runtime/db-backup.mjs` | La restauration est suivie d’une validation ciblée | tests fixture restore + validation | Temps de vérification | P2-01 | M |
| P2-03 | Clarifier les modes `files`, `dual`, `db-only` | Modes mal expliqués | Documenter source de vérité, projections, stores, risques et commandes recommandées | `README.md`, `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, `docs/CLI_SURFACE_INVENTORY.md` | Chaque mode est exploitable sans hypothèse cachée | doc review + gates mode parity | Documentation divergente | P1-01 | S |
| P2-04 | Rendre le flux release atomique | Release multi-étapes | Vérifier dans un seul flux VERSION, package.json, build-release, manifest, checksums, npm package surface | `VERSION`, `package.json`, `tools/build-release.mjs`, `tools/install.mjs` | Release cohérente et reproductible | `perf:verify-release-version`, `perf:verify-release-artifacts` | Couplage release plus strict | Aucun | M |
| P2-05 | Ajouter ou renforcer le manifest de release | Provenance insuffisamment démontrée | Le manifest doit permettre de vérifier provenance et cohérence des artefacts | `tools/build-release.mjs`, `release/*`, `docs/ADR/ADR-0009-release-versioning-provenance.md` | Artefacts vérifiables par checksum et provenance | release artifact gate | Complexité du packaging | P2-04 | M |

### P3 - Rationalisation documentaire

| ID | Titre | Problème adressé | Description | Fichiers probables à modifier | Critères d’acceptation | Tests ou gates à ajouter | Risques | Dépendances | Taille |
|---|---|---|---|---|---|---|---|---|---|
| P3-01 | Créer un cockpit architecture léger | Entrée architecture dispersée | Relier ADR, plan EA/IA, backlog, runtime surface matrix, CLI inventory, governance diagnostics | `docs/README*.md`, `docs/*` | Une page d’entrée unique vers les artefacts utiles | review doc | Surfacing documentaire inutile | Aucun | S |
| P3-02 | Réduire la dispersion documentaire | Multiplicité de plans et de matrices | Identifier les documents obsolètes, redondants ou à fusionner, sans supprimer l’historique utile | `docs/*` | L’historique utile reste, mais la navigation devient plus simple | revue doc + inventaire | Perte de trace historique | P3-01 | M |

## 6. Roadmap

### Court terme - 2 à 4 semaines
Objectif:
supprimer les écritures implicites et stabiliser les contrats runtime critiques.

Livrables attendus:
- commandes runtime read-only par défaut;
- flags explicites pour write/sync;
- gate `no-implicit-write`;
- contrats JSON critiques renforcés;
- premières golden fixtures.

Risques:
- régression sur des usages CLI historiques;
- découverte de surfaces encore ambiguës;
- explosion des fixtures si le découpage n’est pas ciblé.

Critères de succès:
- `--json` ne déclenche plus d’écriture implicite sur les commandes ciblées;
- les surfaces critiques ont un contrat public et des fixtures;
- le gate no-implicit-write est visible dans la CI.

Backlog associé:
- P0-01 à P0-07.

### Moyen terme - 1 à 3 mois
Objectif:
faire descendre la gouvernance SoT/metadata dans les producteurs d’artefacts.

Livrables attendus:
- politique SoT consommée dans les use cases;
- politique metadata consommée dans les use cases;
- concepts gouvernés couverts;
- CI architecture branchée;
- projecteurs progressivement extraits des wrappers CLI.

Risques:
- warnings legacy plus nombreux;
- refactorings de surface trop larges;
- CI plus longue si les familles ne sont pas séparées.

Critères de succès:
- les artefacts runtime critiques portent leurs métadonnées gouvernées;
- les wrappers CLI deviennent minces;
- la CI architecture est lisible par famille.

Backlog associé:
- P1-01 à P1-11.

### Long terme - 3 à 6 mois
Objectif:
durcir l’exploitation locale, la release et la fédération local-first.

Livrables attendus:
- runbooks backup/restore;
- release atomique;
- ports shared coordination généralisés;
- cockpit architecture;
- aucune nouvelle surface partagée sans ADR, port, contrat et gate.

Risques:
- extension shared runtime trop rapide;
- complexité de release plus élevée;
- documentation trop dispersée si la rationalisation est tardive.

Critères de succès:
- la restauration est vérifiable après backup;
- la provenance release est démontrable;
- aucune surface partagée n’apparaît sans mécanisme de contrôle explicite.

Backlog associé:
- P2-01 à P3-02.

## 7. ADR à créer ou mettre à jour

| ADR | Statut recommandé | Raison | Décision à prendre | Alternatives | Critères d’acceptation |
|---|---|---|---|---|---|
| ADR-0004 - Public CLI JSON Contracts | À mettre à jour | Les contrats existent mais doivent être durcis progressivement | Préciser le durcissement des objets imbriqués critiques | Laisser les schémas évoluer sans règle claire | Les sorties critiques ont une stratégie de compatibilité explicitée |
| ADR-0005 - Read/Write CLI Semantics | À mettre à jour | `--json` ne doit pas être confondu avec une permission d’écriture | Imposer `--write` et `--sync-relay` sur les effets sensibles | Continuer avec des effets implicites historiques | Les effets sensibles sont explicitement déclenchés |
| ADR-0006 - Information Model | À mettre à jour | La couverture des concepts gouvernés doit être complétée | Étendre le modèle d’information et les exceptions documentées | Laisser les concepts émerger au fil de l’implémentation | SoT, metadata et lifecycle sont alignés par concept |
| ADR-0008 - Shared Coordination Ports | À mettre à jour | Toute surface partagée doit passer par des ports | Préciser l’obligation de passer par les ports | Laisser les adapters partager des accès directs | Aucune nouvelle surface partagée sans port explicite |
| ADR-0009 - Release Versioning Provenance | À mettre à jour | Le flux release doit devenir atomique et vérifiable | Lier VERSION, build-release, manifest et checksums dans un seul flux | Vérifier séparément chaque étape | Provenance et cohérence de release démontrables |
| Nouvelle ADR - Read Models and Projectors Split | À créer | Clarifier la séparation entre lecture et écriture de projection | Définir la frontière read-only / projector / sync | Continuer à enrichir les wrappers CLI | Les projecteurs sont explicitement séparés des lectures |
| Nouvelle ADR - Runtime Metadata Propagation | À créer | Les policies SoT/metadata doivent alimenter les producteurs d’artefacts | Définir les champs obligatoires dans les artefacts runtime | Laisser les artefacts dériver de manière opportuniste | Les artefacts critiques exposent leurs métadonnées gouvernées |
| Nouvelle ADR - CLI Effect Classes Enforcement in CI | À créer | La classe d’effet doit être vérifiée automatiquement | Relier l’inventaire CLI, les policies d’effet et la CI | Vérification seulement manuelle | La CI empêche les régressions de sémantique CLI |

## 8. Première séquence d’exécution

1. Inventorier toutes les commandes publiques stables du CLI.
   - But: avoir une surface de référence unique.
   - Fichiers probables: `bin/aidn.mjs`, `docs/CLI_SURFACE_INVENTORY.md`, `package.json`.
   - Critère d’acceptation: la liste publique est exhaustive et classée.
   - Test ou gate attendu: `perf:verify-cli-surface-inventory`.

2. Associer une classe d’effet à chaque commande.
   - But: rendre l’effet public lisible.
   - Fichiers probables: `src/core/cli/effect-policy.mjs`, `bin/aidn.mjs`.
   - Critère d’acceptation: aucune commande publique stable sans classe d’effet.
   - Test ou gate attendu: `perf:verify-cli-effect-policy`.

3. Vérifier quelles commandes écrivent sans flag explicite.
   - But: isoler les écritures implicites.
   - Fichiers probables: `tools/runtime/*`, `bin/aidn.mjs`.
   - Critère d’acceptation: la liste des écritures implicites est connue.
   - Test ou gate attendu: `perf:verify-cli-no-implicit-write`.

4. Corriger `project-runtime-state` pour séparer read et write.
   - But: rendre la lecture pure par défaut.
   - Fichiers probables: `tools/runtime/project-runtime-state.mjs`, `src/application/runtime/runtime-state-projector-use-case.mjs`.
   - Critère d’acceptation: `--json` ne modifie plus le checkout.
   - Test ou gate attendu: `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts`.

5. Corriger `project-handoff-packet` pour séparer read, write et sync.
   - But: protéger la frontière shared/local.
   - Fichiers probables: `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/handoff-packet-projector-use-case.mjs`.
   - Critère d’acceptation: la sync partagée est explicite.
   - Test ou gate attendu: `perf:verify-cli-no-implicit-write`, `perf:verify-shared-coordination-runtime-cli`.

6. Ajouter ou brancher le gate no-implicit-write.
   - But: empêcher les régressions de mutation implicite.
   - Fichiers probables: `package.json`, `.github/workflows/perf-kpi.yml`.
   - Critère d’acceptation: le gate s’exécute en PR.
   - Test ou gate attendu: `perf:verify-cli-no-implicit-write`.

7. Ajouter des fixtures golden pour runtime state.
   - But: figer la forme publique et les cas d’erreur.
   - Fichiers probables: `tests/fixtures/*`, `tools/perf/*fixtures.mjs`.
   - Critère d’acceptation: cas nominal et erreurs principales couverts.
   - Test ou gate attendu: `perf:verify-cli-output-contracts`.

8. Ajouter des fixtures golden pour handoff packet.
   - But: stabiliser le packet de coordination.
   - Fichiers probables: `tests/fixtures/*`, `tools/perf/*fixtures.mjs`.
   - Critère d’acceptation: le packet est reproductible et contractuel.
   - Test ou gate attendu: `perf:verify-cli-output-contracts`.

9. Durcir les schémas JSON critiques.
   - But: contraindre les objets imbriqués les plus sensibles.
   - Fichiers probables: `src/core/contracts/cli-output/*`.
   - Critère d’acceptation: les sorties critiques ne sont plus trop souples.
   - Test ou gate attendu: `perf:verify-cli-output-contracts`.

10. Brancher les gates de contrats en CI.
    - But: rendre la vérification visible sur chaque PR.
    - Fichiers probables: `.github/workflows/perf-kpi.yml`, autres workflows.
    - Critère d’acceptation: les gates architecture tournent en CI.
    - Test ou gate attendu: workflow CI.

11. Propager SoT et metadata dans les artefacts runtime critiques.
    - But: faire vivre les policies dans les producteurs.
    - Fichiers probables: `src/application/runtime/*`, `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`.
    - Critère d’acceptation: les sorties critiques exposent SoT et lifecycle.
    - Test ou gate attendu: `perf:verify-source-of-truth-policy`, `perf:verify-metadata-policy`.

12. Mettre à jour les ADR concernées.
    - But: aligner architecture déclarée et architecture exécutée.
    - Fichiers probables: `docs/ADR/ADR-0004-public-cli-json-contracts.md`, `docs/ADR/ADR-0005-read-write-cli-semantics.md`, `docs/ADR/ADR-0006-information-model.md`, `docs/ADR/ADR-0008-shared-coordination-ports.md`, `docs/ADR/ADR-0009-release-versioning-provenance.md`.
    - Critère d’acceptation: les ADR décrivent la nouvelle frontière.
    - Test ou gate attendu: revue ADR + gates associés.

## 9. Definition of Done globale

Le redressement architectural est considéré comme réellement engagé lorsque:
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

## 10. Hypothèses à valider

| Hypothèse | Pourquoi elle compte | Comment la vérifier | Décision selon le résultat |
|---|---|---|---|
| Toutes les commandes publiques sont déjà couvertes par une classe d’effet | Sans couverture complète, l’inventaire CLI reste incomplet | Comparer `bin/aidn.mjs`, `package.json` et `src/core/cli/effect-policy.mjs` | Si non, classer les commandes manquantes avant tout refactor |
| Le gate no-implicit-write existe déjà mais n’est pas branché en CI | Cela évite de réinventer un gate déjà présent | Inspecter `package.json` et les workflows GitHub | S’il existe, le brancher; sinon, le créer |
| `Decision`, `Incident`, `Snapshot`, `Baseline` ont une source de vérité explicite | Ces concepts portent la traçabilité du projet | Vérifier `source-of-truth-policy`, `metadata-policy` et les ADR | Si non, compléter la policy ou documenter l’exception |
| `project-runtime-state` peut être refactoré sans casser les usages actuels | Le risque principal est la régression de l’automatisation | Construire des golden fixtures avant le refactor | Si non, conserver la compatibilité par un flag temporaire |
| Les contrats JSON actuels sont trop souples pour les intégrations externes | Les intégrations consomment la forme publique | Ajouter des tests contractuels sur les nested objects | Si oui, durcir les schémas avant toute extraction supplémentaire |
| Les commandes handoff mélangent encore projection locale et relay partagé | C’est la zone la plus sensible de la frontière local/shared | Tester les effets avec et sans opt-in shared coordination | Si oui, imposer une séparation read/project/sync et un port explicite |
