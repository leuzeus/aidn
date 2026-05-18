# Backlog AIDN Enterprise And Information Architecture - 2026-05-18

Plan: `docs/PLAN_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`

## Objectif

Transformer AIDN d'une plateforme runtime déjà émergente en plateforme locale de gouvernance du travail assisté par IA, avec modèle d'information explicite, sources de vérité déclarées, contrats CLI/JSON versionnés et gates qualité exploitables.

Ce backlog est conçu pour:

- ouvrir des issues actionnables
- découper les changements en PRs reviewables
- préserver les modes `files|dual|db-only`
- éviter une réécriture large
- maintenir une approche local-first compatible avec une petite équipe open source

## Vue D'Ensemble

| Epic | Sujet | Priorité | Statut | Dépend de |
|---|---|---:|---|---|
| EIA-1 | Modèle d'information et source de vérité | P0 | Done | - |
| EIA-2 | Contrats CLI/JSON publics | P0 | Done | EIA-1 |
| EIA-3 | Sémantique lecture/écriture CLI | P0 | Done | EIA-2 |
| EIA-4 | Gates source de vérité par mode | P1 | Done | EIA-1 |
| EIA-5 | Qualité metadata et gouvernance | P1 | Done | EIA-1 |
| EIA-6 | Refactoring couches runtime restantes | P1 | In Progress | EIA-2 |
| EIA-7 | ADR et principes de gouvernance | P1 | Done | EIA-1 |
| EIA-8 | Exploitation locale | P2 | Backlog | EIA-4 |
| EIA-9 | Fédération local-first | P3 | Backlog | EIA-4, EIA-8 |

## Règles D'Exécution

1. Une tâche doit tenir dans une PR reviewable.
2. Aucun changement ne doit traiter le dépôt racine comme un projet AIDN installé.
3. `scaffold/*` est modifié uniquement comme source installable.
4. `tests/fixtures/*` reste un corpus suivi, pas un état live.
5. Les vérifications doivent distinguer `PASS` et `SKIP`.
6. Les commandes de lecture ne doivent pas introduire de mutation implicite nouvelle.
7. Toute compatibilité legacy doit être explicitement nommée et testée.

## EIA-1 - Modèle D'Information Et Source De Vérité

### EIA-1.1 - Ajouter Le Plan D'Architecture Informationnelle

- priorité: `P0`
- statut: `Done`
- objectif: versionner le diagnostic, la vision cible, les capacités, les chaînes de valeur, le modèle d'information, les problèmes et la roadmap
- artefacts à modifier: `docs/PLAN_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`

Critères d'acceptation:

- le plan existe sous `docs/`
- le plan référence ce backlog
- le plan distingue package source, scaffold, fixtures et projets installés
- le plan contient sources de vérité, métadonnées obligatoires et lifecycle

Tests attendus:

- revue documentaire
- `git diff --check`

### EIA-1.2 - Ajouter Le Backlog Exécutable

- priorité: `P0`
- statut: `Done`
- objectif: transformer le plan en tickets séquencés
- artefacts à modifier: `docs/BACKLOG_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`

Critères d'acceptation:

- backlog lié au plan
- epics P0/P1/P2/P3 visibles
- chaque tâche P0/P1 inclut acceptation, dépendances, tests et artefacts probables

Tests attendus:

- revue documentaire
- `git diff --check`

### EIA-1.3 - Produire La Matrice Source De Vérité Par Concept

- priorité: `P0`
- statut: `Done`
- objectif: rendre explicite la source canonique par concept et par mode `files|dual|db-only`
- dépend de: `EIA-1.1`
- artefacts à modifier:
  - `docs/PLAN_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`
  - `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
  - futur ADR source de vérité

Avancement:

- le plan contient une matrice source de vérité par concept et par mode
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md` contient un overlay logique qui complète la matrice de chemins physiques
- les projections, caches et surfaces shared-runtime sont nommés explicitement

Critères d'acceptation:

- chaque concept critique a une source canonique
- chaque projection est nommée comme projection, digest ou cache
- les différences `files`, `dual`, `db-only` sont explicites
- les surfaces shared-runtime restent opt-in

Tests attendus:

- revue architecture
- `npm run perf:verify-state-mode-parity`
- `npm run perf:verify-runtime-persistence-parity` si la matrice touche les backends

### EIA-1.4 - Inventorier Les Concepts Et Champs Runtime Actuels

- priorité: `P0`
- statut: `Done`
- objectif: aligner le modèle conceptuel avec SQL, parsers Markdown et sorties CLI actuelles
- dépend de: `EIA-1.1`
- artefacts à inspecter:
  - `src/lib/sqlite/workflow-db-schema-lib.mjs`
  - `tools/perf/sql/schema.sql`
  - `tools/perf/sql/runtime-artifacts-postgres-relational-v2.sql`
  - `src/lib/workflow/structured-artifact-parser-lib.mjs`
  - `src/lib/workflow/markdown-contract-registry-lib.mjs`

Avancement:

- le plan contient un inventaire des champs runtime actuels par surface
- les champs de provenance, legacy, confidence et source mode sont identifiés
- les gaps metadata/owner/lifecycle/classification sont listés

Critères d'acceptation:

- liste des champs critiques par concept
- champs inferred/legacy/source_mode identifiés
- gaps entre SQL, Markdown et JSON listés

Tests attendus:

- revue documentaire
- pas de test runtime requis si inventaire only

## EIA-2 - Contrats CLI/JSON Publics

### EIA-2.1 - Créer Le Répertoire Des Contrats CLI

- priorité: `P0`
- statut: `Done`
- objectif: établir la convention des schemas de sorties CLI
- dépend de: `EIA-1.3`
- artefacts à modifier:
  - `src/core/contracts/cli-output/README.md`
  - `src/core/contracts/cli-output/*.schema.json`

Avancement:

- `src/core/contracts/cli-output/README.md` définit la convention de nommage, version et compatibilité
- 10 schemas v1 initiaux existent pour les sorties CLI critiques
- chaque schema expose `x-aidn-command` et `x-aidn-contract-version`

Critères d'acceptation:

- convention de nommage documentée
- chaque schema expose `schema_version` ou `contract_version`
- compatibilité legacy documentée séparément
- aucun schema ne dépend de chemins locaux réels

Tests attendus:

- validation JSON syntaxique
- `git diff --check`

### EIA-2.2 - Stabiliser Les 10 Sorties JSON Critiques

- priorité: `P0`
- statut: `Done`
- objectif: versionner les contrats consommables les plus importants
- dépend de: `EIA-2.1`
- commandes concernées:
  - `aidn runtime project-runtime-state --json`
  - `aidn runtime project-handoff-packet --json`
  - `aidn runtime pre-write-admit --json`
  - `aidn runtime db-status --json`
  - `aidn runtime coordinator-next-action --json`
  - `aidn runtime coordinator-dispatch-plan --json`
  - `aidn runtime coordinator-orchestrate --json`
  - `aidn runtime handoff-admit --json`
  - `aidn project config --list --json`
  - `aidn codex hydrate-context --json`

Avancement:

- les 10 schemas v1 existent sous `src/core/contracts/cli-output/`
- les schemas verrouillent les champs top-level et restent volontairement extensibles pour les sous-objets
- les sorties réelles sont validées par `perf:verify-cli-output-contracts`

Critères d'acceptation:

- chaque commande a un schema v1 ou un contrat de preview documenté
- les champs obligatoires sont listés
- les champs optionnels/legacy sont explicitement marqués
- la compatibilité `files|dual|db-only` est couverte lorsque pertinente

Tests attendus:

- nouveaux tests golden ou extension de fixtures existantes
- `npm run perf:verify-cli-aliases`
- tests ciblés des commandes concernées

### EIA-2.3 - Ajouter Un Vérificateur De Contrats CLI

- priorité: `P1`
- statut: `Done`
- objectif: empêcher la dérive silencieuse des sorties JSON
- dépend de: `EIA-2.2`
- artefacts à modifier:
  - `tools/perf/verify-cli-output-contracts-fixtures.mjs`
  - `package.json`
  - fixtures ciblées sous `tests/fixtures/*`

Avancement:

- `tools/perf/verify-cli-output-contracts-fixtures.mjs` exécute les 10 commandes critiques sur une copie temporaire de `repo-installed-core`
- le verifier valide les sorties contre les schemas v1
- le verifier contrôle que les projectors exécutés avec `--dry-run` ne modifient pas `RUNTIME-STATE.md` ou `HANDOFF-PACKET.md`
- `package.json` expose `npm run perf:verify-cli-output-contracts`

Critères d'acceptation:

- le verifier exécute les commandes critiques sur fixtures
- les sorties sont validées contre schemas
- les erreurs indiquent commande, champ et schema

Tests attendus:

- `npm run perf:verify-cli-output-contracts`
- `npm run perf:verify-cli-aliases`

## EIA-3 - Sémantique Lecture/Écriture CLI

### EIA-3.1 - Inventorier Les Commandes Mutantes

- priorité: `P0`
- statut: `Done`
- objectif: classer les commandes CLI en read-only, preview, projector, mutating
- dépend de: `EIA-2.1`
- artefacts à inspecter:
  - `bin/aidn.mjs`
  - `tools/runtime/*.mjs`
  - `tools/perf/*.mjs`
  - `tools/project/*.mjs`
  - `tools/codex/*.mjs`

Avancement:

- le plan contient un inventaire des effets CLI par commande critique
- les commandes `project-runtime-state`, `project-handoff-packet` et `hydrate-context` sont classées comme projectors
- les commandes avec exécution ou écriture explicite sont distinguées des commandes read-only

Critères d'acceptation:

- chaque commande publique a une classe d'effet
- les commandes qui écrivent par défaut sont listées
- les commandes de projection documentaire sont distinguées des reads

Tests attendus:

- revue documentaire
- no-op sur fixtures propres

### EIA-3.2 - Normaliser `project-runtime-state` Et `project-handoff-packet`

- priorité: `P0`
- statut: `Done`
- objectif: éviter les mutations surprises lors d'une consultation JSON
- dépend de: `EIA-3.1`
- artefacts à modifier:
  - `tools/runtime/project-runtime-state.mjs`
  - `tools/runtime/project-handoff-packet.mjs`
  - fixtures associées

Avancement:

- les deux commandes acceptent maintenant `--dry-run`
- en `--dry-run`, elles calculent la projection et retournent le payload JSON sans écrire le Markdown cible
- `project-handoff-packet --dry-run` n'ajoute pas de relay shared coordination
- le comportement historique sans `--dry-run` reste inchangé pour compatibilité

Critères d'acceptation:

- une lecture JSON peut être exécutée sans modifier le worktree
- l'écriture de digest est explicite via `--write` ou une commande clairement projecteur
- la compatibilité actuelle est préservée par option ou période de transition documentée

Tests attendus:

- `npm run perf:verify-handoff-packet`
- `npm run perf:verify-runtime-state-projector`
- nouveau test de non-mutation sur fixture propre

### EIA-3.3 - Documenter La Convention CLI

- priorité: `P1`
- statut: `Done`
- objectif: rendre prévisible `--json`, `--dry-run`, `--write`, `--apply`, `--execute`
- dépend de: `EIA-3.2`
- artefacts à modifier:
  - `README.md`
  - `docs/INSTALL.md`
  - `docs/TESTING.md`
  - `docs/TROUBLESHOOTING.md`

Avancement:

- `README.md` documente la convention `--json`, `--dry-run`, `--write`, `--apply`, `--execute`
- `docs/TESTING.md` indique quand lancer `perf:verify-cli-output-contracts`
- le verifier confirme que les projectors en `--dry-run --json` ne modifient pas leurs projections Markdown

Critères d'acceptation:

- les commandes read-only sont identifiables
- les commandes mutantes exigent une intention explicite ou sont nommées comme projecteurs
- les exemples de docs respectent la convention

Tests attendus:

- revue docs
- `npm run perf:verify-generated-docs` si les docs générées sont touchées

## EIA-4 - Gates Source De Vérité Par Mode

### EIA-4.1 - Ajouter Une Policy Source-Of-Truth Dans `src/core`

- priorité: `P1`
- statut: `Done`
- objectif: centraliser la règle SoT par mode et surface
- dépend de: `EIA-1.3`
- artefacts à modifier:
  - `src/core/state-mode/`
  - nouveau module `src/core/source-of-truth/`
  - tests fixture ciblés

Avancement:

- `src/core/source-of-truth/source-of-truth-policy.mjs` centralise les concepts, modes et sources canoniques
- `tools/perf/verify-source-of-truth-policy.mjs` vérifie que chaque concept couvre `files`, `dual` et `db-only`
- `package.json` expose `npm run perf:verify-source-of-truth-policy`

Critères d'acceptation:

- `files`, `dual`, `db-only` ont des règles vérifiables
- les projections ne peuvent pas être confondues avec l'état canonique
- les shared-runtime candidates restent opt-in

Tests attendus:

- `npm run perf:verify-state-mode-parity`
- `npm run perf:verify-shared-runtime-locator`
- `npm run perf:verify-shared-sqlite-boundary`

### EIA-4.2 - Ajouter Des Checks De Cohérence SoT

- priorité: `P1`
- statut: `Done`
- objectif: bloquer ou avertir quand les sources déclarées divergent
- dépend de: `EIA-4.1`
- artefacts à modifier:
  - runtime admission services
  - repair-layer triage
  - `tools/runtime/pre-write-admit.mjs`

Critères d'acceptation:

- divergence critique produit `blocked` ou `warn` selon mode
- le résultat expose `reason_code`
- les chemins de réparation sont proposés

Avancement:

- `tools/runtime/pre-write-admit.mjs` expose `source_of_truth`, `source_of_truth_status` et `source_of_truth_reason_codes`
- les divergences critiques de mode produisent un blocage codé `SOT_STATE_MODE_MISMATCH`
- les projections Markdown lues en `db-only` produisent un warning codé `SOT_DB_ONLY_PROJECTION_READ`
- la fixture `source-of-truth-state-mode-mismatch` couvre le blocage admission

Tests attendus:

- `npm run perf:verify-pre-write-admit`
- `npm run perf:verify-repair-layer-triage`
- `npm run perf:verify-runtime-persistence-parity`

## EIA-5 - Qualité Metadata Et Gouvernance

### EIA-5.1 - Définir Les Métadonnées Obligatoires Par Concept

- priorité: `P1`
- statut: `Done`
- objectif: éviter owner/source/lifecycle implicites
- dépend de: `EIA-1.4`
- artefacts à modifier:
  - plan architecture informationnelle
  - `src/lib/workflow/markdown-contract-registry-lib.mjs`
  - templates `scaffold/docs_audit/*`

Critères d'acceptation:

- champs obligatoires par concept documentés
- exceptions legacy explicites
- templates critiques alignés

Avancement:

- `src/core/metadata/metadata-policy.mjs` centralise les champs obligatoires, recommandés et tolérés legacy par concept
- `src/lib/workflow/markdown-contract-registry-lib.mjs` rattache les contrats Markdown critiques à la policy metadata
- `tools/perf/verify-metadata-policy.mjs` vérifie la cohérence de la policy et son exposition par les contrats critiques
- le plan architecture informationnelle documente la policy metadata canonique

Tests attendus:

- `npm run perf:verify-metadata-policy`
- `npm run perf:verify-markdown-contract`
- `npm run perf:verify-generated-docs`

### EIA-5.2 - Ajouter Un Gate Metadata Completeness

- priorité: `P1`
- statut: `Done`
- objectif: signaler les artefacts critiques incomplets
- dépend de: `EIA-5.1`
- artefacts à modifier:
  - `tools/perf/verify-markdown-contract-conformance-fixtures.mjs`
  - `src/lib/workflow/markdown-contract-registry-lib.mjs`

Critères d'acceptation:

- champs manquants exposés avec code et sévérité
- legacy tolerated reste visible mais non bloquant par défaut
- les artefacts critiques futurs sont conformes

Avancement:

- les artefacts Markdown critiques exposent `metadata_policy_version`, `metadata_status` et `metadata_findings` dans leur forme canonique
- les champs gouvernés manquants produisent `MISSING_GOVERNED_METADATA` ou `MISSING_GOVERNED_METADATA_LEGACY_TOLERATED`
- les runtime heads SQLite/PostgreSQL propagent les metadata findings pour les digests critiques
- `tools/perf/verify-markdown-contract-conformance-fixtures.mjs` couvre les statuts metadata legacy tolérés

Tests attendus:

- `npm run perf:verify-markdown-contract`
- `npm run perf:verify-current-state-consistency-fixtures`

### EIA-5.3 - Documenter Rôles Owner/Steward/Maintainer/Agent/Reviewer/Architect

- priorité: `P1`
- statut: `Done`
- objectif: clarifier responsabilités de gouvernance
- dépend de: `EIA-5.1`
- artefacts à modifier:
  - `docs/PLAN_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`
  - `scaffold/docs_audit/WORKFLOW_SUMMARY.md`
  - `scaffold/root/AGENTS.md` si nécessaire

Critères d'acceptation:

- chaque rôle a une responsabilité claire
- les agents savent quoi lire avant mutation
- le modèle reste compatible package source vs installed repo

Avancement:

- `docs/PLAN_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md` contient un RACI opérationnel owner/steward/maintainer/agent/reviewer/architect
- `scaffold/docs_audit/WORKFLOW_SUMMARY.md` expose les rôles installés et les lectures minimales avant mutation
- la distinction package source vs dépôt installé reste portée par le root `AGENTS.md`, sans dupliquer la règle dans les templates installés

Tests attendus:

- revue docs
- `npm run perf:verify-generated-docs` si templates touchés

## EIA-6 - Refactoring Couches Runtime Restantes

### EIA-6.1 - Extraire Les Projections Runtime Restantes En Use Cases

- priorité: `P1`
- statut: `Done`
- objectif: réduire le couplage dans `tools/runtime`
- dépend de: `EIA-3.2`
- artefacts à modifier:
  - `tools/runtime/project-runtime-state.mjs`
  - `tools/runtime/project-handoff-packet.mjs`
  - `src/application/runtime/*`

Critères d'acceptation:

- scripts CLI deviennent wrappers minces
- rendu Markdown et construction payload sont testables hors CLI
- comportement de sortie conservé sauf changement explicite read/write

Avancement:

- `src/application/runtime/runtime-state-projector-use-case.mjs` porte le rendu Markdown du runtime-state digest
- `src/application/runtime/handoff-packet-projector-use-case.mjs` porte le rendu Markdown du handoff packet
- `tools/runtime/project-runtime-state.mjs` et `tools/runtime/project-handoff-packet.mjs` délèguent le rendu à la couche application
- la construction complète des payloads reste encore dans les scripts CLI et sera extraite dans un incrément suivant

Tests attendus:

- `npm run perf:verify-runtime-state-projector`
- `npm run perf:verify-handoff-packet`

### EIA-6.2 - Séparer Observabilité Et Runtime Engine

- priorité: `P1`
- statut: `In Progress`
- objectif: isoler KPI/reporting des transitions workflow
- dépend de: `EIA-2.3`
- artefacts à modifier:
  - `tools/perf/report-*.mjs`
  - `tools/perf/render-*.mjs`
  - futur `src/application/observability/*`

Critères d'acceptation:

- collecte/reporting n'orchestre pas les gates
- use cases observability séparés
- wrappers existants restent compatibles

Avancement:

- `src/application/observability/repair-layer-triage-summary-use-case.mjs` porte le rendu Markdown du résumé repair-layer triage
- `tools/perf/render-repair-layer-triage-summary.mjs` reste un wrapper lecture JSON + écriture fichier
- les autres scripts `tools/perf/report-*` et `tools/perf/render-*` restent à inventorier avant fermeture de EIA-6.2

Tests attendus:

- checks perf ciblés selon fichier touché
- `npm run perf:verify-cli-aliases`

## EIA-7 - ADR Et Principes De Gouvernance

### EIA-7.1 - Ajouter ADR-0003 Source Of Truth Policy

- priorité: `P1`
- statut: `Done`
- dépend de: `EIA-1.3`
- artefacts à modifier:
  - `docs/ADR/ADR-0003-source-of-truth-policy.md`
  - `docs/ADR/README.md`

Avancement:

- `docs/ADR/ADR-0003-source-of-truth-policy.md` documente la politique SoT par concept/mode
- l'index ADR référence la décision

Critères d'acceptation:

- modes `files|dual|db-only` couverts
- projections et caches explicitement nommés
- shared runtime opt-in clarifié

Tests attendus:

- revue ADR

### EIA-7.2 - Ajouter ADR-0004 Public CLI JSON Contracts

- priorité: `P1`
- statut: `Done`
- dépend de: `EIA-2.1`
- artefacts à modifier:
  - `docs/ADR/ADR-0004-public-cli-json-contracts.md`
  - `docs/ADR/README.md`

Avancement:

- `docs/ADR/ADR-0004-public-cli-json-contracts.md` documente la stratégie de schemas v1 extensibles
- l'index ADR référence la décision

Critères d'acceptation:

- stratégie schema/version/compat documentée
- commandes critiques listées
- politique de breaking change définie

Tests attendus:

- revue ADR

### EIA-7.3 - Ajouter ADR-0005 Read/Write CLI Semantics

- priorité: `P1`
- statut: `Done`
- dépend de: `EIA-3.1`
- artefacts à modifier:
  - `docs/ADR/ADR-0005-read-write-cli-semantics.md`
  - `docs/ADR/README.md`

Avancement:

- `docs/ADR/ADR-0005-read-write-cli-semantics.md` définit les classes d'effet CLI
- l'index ADR référence la décision

Critères d'acceptation:

- convention `--json`, `--dry-run`, `--write`, `--apply`, `--execute` définie
- migration compat pour commandes historiques mentionnée

Tests attendus:

- revue ADR

### EIA-7.4 - Ajouter ADR-0006 Et ADR-0007

- priorité: `P2`
- statut: `Backlog`
- dépend de: `EIA-1.4`, `EIA-8`
- artefacts à modifier:
  - `docs/ADR/ADR-0006-information-model.md`
  - `docs/ADR/ADR-0007-local-first-federation-boundary.md`
  - `docs/ADR/README.md`

Critères d'acceptation:

- information model gouverné comme actif produit
- fédération future bornée sans cloud-first

Avancement:

- `docs/ADR/ADR-0006-information-model.md` documente le modèle informationnel comme actif produit gouverné
- `docs/ADR/ADR-0007-local-first-federation-boundary.md` borne la fédération local-first et opt-in
- `docs/ADR/README.md` référence les deux ADR

Tests attendus:

- revue ADR

## EIA-8 - Exploitation Locale

### EIA-8.1 - Clarifier Runbooks Backup/Restore/Migration

- priorité: `P2`
- statut: `Backlog`
- dépend de: `EIA-4.2`
- artefacts à modifier:
  - `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`
  - `docs/MIGRATION_SHARED_RUNTIME_POSTGRESQL.md`
  - `docs/TROUBLESHOOTING.md`
  - `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`

Critères d'acceptation:

- backup avant mutation documenté
- restore vérifie compatibilité schema
- local SQLite vs shared coordination distingués

Tests attendus:

- `npm run perf:verify-shared-coordination-backup`
- `npm run perf:verify-shared-coordination-restore`
- `npm run perf:verify-db-schema-migrations`

### EIA-8.2 - Ajouter Indicateurs D'Exploitation Locale

- priorité: `P2`
- statut: `Backlog`
- dépend de: `EIA-2.3`
- artefacts à modifier:
  - `tools/runtime/db-status.mjs`
  - `tools/runtime/shared-coordination-status.mjs`
  - `tools/perf/report-*.mjs`

Critères d'acceptation:

- status runtime expose schema, source, freshness, repair status
- les indicateurs sont exploitables sans cloud
- secrets restent masqués

Tests attendus:

- `npm run perf:verify-db-runtime-cli`
- `npm run perf:verify-shared-coordination-runtime-cli`

## EIA-9 - Fédération Local-First

### EIA-9.1 - Formaliser Le Contrat Multi-Repo Opt-In

- priorité: `P3`
- statut: `Backlog`
- dépend de: `EIA-8.1`
- artefacts à modifier:
  - `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
  - ADR-0007
  - shared runtime locator docs

Critères d'acceptation:

- aucune externalisation implicite de `docs/audit/*`
- coordination partagée limitée aux tables explicitement listées
- locator requis pour toute fédération

Tests attendus:

- `npm run perf:verify-shared-runtime-locator`
- `npm run perf:verify-shared-coordination-multi-project`
- `npm run perf:verify-shared-coordination-worktree-concurrency`

## Jalons Recommandés

### M1 - Cadrage Informationnel

Contenu:

- EIA-1.1
- EIA-1.2
- EIA-1.3
- EIA-1.4

Résultat:

- vocabulaire, concepts et sources de vérité explicités.

### M2 - Contrats Publics Et CLI Non Surprise

Contenu:

- EIA-2.1
- EIA-2.2
- EIA-3.1
- EIA-3.2

Résultat:

- sorties JSON critiques versionnées et lectures non mutantes clarifiées.

### M3 - Gates Et Metadata Quality

Contenu:

- EIA-4.1
- EIA-4.2
- EIA-5.1
- EIA-5.2

Résultat:

- qualité et source de vérité vérifiées avant mutation.

### M4 - Gouvernance Et Refactoring Progressif

Contenu:

- EIA-6
- EIA-7

Résultat:

- couches plus propres et décisions d'architecture documentées.

### M5 - Exploitation Et Fédération Future

Contenu:

- EIA-8
- EIA-9

Résultat:

- runtime local exploitable, fédération strictement opt-in.

## Définition De Ready

Un ticket est `Ready` si:

- ses dépendances sont terminées
- les artefacts à modifier sont identifiés
- les tests attendus sont listés
- le changement tient dans une PR reviewable

## Définition De Done

Un ticket est `Done` si:

- le code ou la documentation cible est livré
- les tests ciblés passent ou les `SKIP` sont justifiés
- les sorties ou contrats modifiés sont documentés
- aucune confusion package source / installed repo n'est introduite
- aucun détail local-only sensible n'est ajouté aux fichiers publiés
