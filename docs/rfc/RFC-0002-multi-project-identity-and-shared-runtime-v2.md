# RFC-0002 - Multi-Project Identity And Shared Runtime v2

## Statut

Proposé

## Date

2026-04-03

## Contexte

`aidn` supporte déjà:

- un runtime local par `targetRoot`
- un mode `shared-runtime` explicite
- un backend PostgreSQL limité à la coordination partagée
- une résolution stable de `workspace_id` pour plusieurs worktrees d'un même repo

Ce modèle est suffisant tant que la frontière logique est:

- un repo ou un ensemble de worktrees
- un seul scope partagé de coordination

Il devient insuffisant dès que l'on veut supporter:

- plusieurs projets AIDN indépendants dans une même base PostgreSQL
- plusieurs projets AIDN à l'intérieur d'un même monorepo
- des opérations d'admin, backup, restore et inspection par projet

Le problème structurel est que `workspace_id` est aujourd'hui surchargé.

Il représente à la fois:

- la partition logique du backend partagé
- l'identité visible dans les paquets et digests runtime
- la sortie principale du resolver

Cette ambiguïté est acceptable pour du multi-worktree simple, mais pas pour du multi-projet réel.

## Objectifs RFC

- formaliser un modèle d'identité non ambigu pour `project_id`, `workspace_id` et `worktree_id`
- définir un resolver v2 compatible avec le comportement actuel
- définir un contrat `shared-runtime.locator.json` v2
- définir la forme logique du schéma PostgreSQL v2
- préciser la stratégie de migration additive et la compatibilité legacy

Non-objectifs:

- remplacer immédiatement le SQLite local par PostgreSQL
- externaliser `docs/audit/*`
- introduire un schéma PostgreSQL par projet
- redessiner tout le runtime autour d'un backend distant

## Invariants

### Invariant 1 - Les artefacts versionnés restent locaux au checkout

Ne doivent pas être externalisés automatiquement:

- `docs/audit/*`
- `AGENTS.md`
- `.codex/*`
- `.aidn/project/workflow.adapter.json` lorsqu'il est versionné

### Invariant 2 - Le SQLite local reste premier pour la projection locale

`.aidn/runtime/index/workflow-index.sqlite` reste valide pour:

- `files`
- `dual`
- `db-only`
- rematerialization
- repair flows

### Invariant 3 - Le shared runtime reste explicite

Il ne doit pas exister de relocation implicite de tout `.aidn/*` vers PostgreSQL.

### Invariant 4 - La compatibilité mono-projet doit rester incrémentale

Un utilisateur actuel avec un seul `workspace_id` ne doit pas subir de cassure de contrat brutale.

## Proposition

## A. Modèle d'identité v2

### A1. Définitions normatives

- `project_id`: identité logique canonique d'un projet AIDN
- `project_root`: racine locale du projet AIDN utilisé comme frontière de résolution
- `workspace_id`: identité d'une instance de runtime partagé au sein d'un projet
- `worktree_id`: identité d'un checkout concret
- `repo_root`: racine Git du checkout courant
- `git_common_dir`: primitive Git permettant de reconnaître des worktrees frères

### A2. Relation entre les identités

Relation recommandée:

- un `project_id` possède zéro à N `workspace_id`
- un `workspace_id` possède un à N `worktree_id`

Cas simple, compatible avec l'existant:

- un projet
- un workspace partagé
- plusieurs worktrees

Dans ce cas:

- `project_id == workspace_id`

Cas avancé:

- un projet
- plusieurs workspaces partagés
- plusieurs worktrees par workspace

Dans ce cas:

- `project_id != workspace_id`

### A3. Pourquoi conserver `workspace_id`

Alternatives considérées:

1. remplacer purement `workspace_id` par `project_id`
2. introduire `project_id` et conserver `workspace_id`

Décision:

- introduire `project_id`
- conserver `workspace_id`

Raisons:

- le terme `workspace` reste utile pour décrire une instance de coordination partagée
- cela permet de garder une compatibilité naturelle avec l'existant
- cela évite d'imposer une sémantique réductrice si `aidn` supporte plus tard plusieurs workspaces pour un même projet

## B. Resolver v2

### B1. Sortie minimale attendue

Le resolver v2 doit retourner:

- `project_id`
- `project_id_source`
- `project_root`
- `workspace_id`
- `workspace_id_source`
- `worktree_id`
- `worktree_root`
- `repo_root`
- `git_common_dir`
- `shared_runtime_mode`
- `shared_backend_kind`
- `shared_runtime_connection_ref`
- `shared_runtime_locator_ref`

### B2. Ordre de résolution de `project_id`

Ordre normatif:

1. override CLI explicite
2. override env explicite
3. valeur du locator partagé
4. config projet de confiance
5. fallback dérivé depuis `project_root`
6. compatibilité legacy via `workspace_id`

### B3. Ordre de résolution de `project_root`

Ordre recommandé:

1. override CLI explicite
2. locator si considéré de confiance
3. présence de `.aidn/project/workflow.adapter.json`
4. `targetRoot` si c'est une racine projet valide
5. rejet en cas d'ambiguïté imbriquée

### B4. Ordre de résolution de `workspace_id`

Ordre normatif:

1. override CLI explicite
2. override env explicite
3. valeur du locator
4. fallback `workspace_id := project_id`

### B5. Règles d'ambiguïté

Le resolver doit rejeter explicitement:

- deux frontières projet candidates valides pour le même `targetRoot`
- un `project_id` explicite incompatible avec le locator
- un `workspace_id` explicite qui tente de se rattacher à un autre projet
- un monorepo dans lequel le `targetRoot` ne permet pas de déterminer un `project_root` unique

### B6. Règles de compatibilité

En mode legacy:

- si aucun `project_id` n'est présent, `project_id := workspace_id`
- si aucun `workspace_id` n'est présent, `workspace_id := project_id`

Cette compatibilité doit être visible dans les métadonnées via les champs `*_source`.

## C. Contrat `shared-runtime.locator.json` v2

### C1. Problème du locator actuel

Le locator v1 est centré sur:

- `workspaceId`
- backend
- projection locale

Il ne peut pas exprimer proprement:

- l'identité du projet
- la relation projet/workspace
- la compatibilité legacy

### C2. Shape proposée

```json
{
  "version": 2,
  "enabled": true,
  "projectId": "project-gowire-auth",
  "workspaceId": "workspace-gowire-auth-main",
  "project": {
    "root": ".",
    "rootRef": "target-root"
  },
  "backend": {
    "kind": "postgres",
    "root": "",
    "connectionRef": "env:AIDN_PG_URL"
  },
  "projection": {
    "localIndexMode": "preserve-current"
  },
  "compat": {
    "legacyWorkspaceIdentity": "workspace-gowire-auth-main"
  }
}
```

### C3. Champs normatifs

- `version`: entier, obligatoire
- `enabled`: booléen
- `projectId`: identité projet canonique
- `workspaceId`: identité workspace explicite, optionnelle mais recommandée
- `project.root`: racine relative ou logique du projet
- `project.rootRef`: provenance de la racine
- `backend.kind`: `none|sqlite-file|postgres`
- `backend.root`: requis pour `sqlite-file`
- `backend.connectionRef`: requis pour `postgres`
- `projection.localIndexMode`: politique de projection locale

### C4. Compatibilité lecture v1

Si `version == 1`:

- `projectId := workspaceId`
- `workspaceId := workspaceId`
- `project.root := targetRoot`
- `compat.legacyWorkspaceIdentity := workspaceId`

### C5. Politique d'écriture

Pendant la fenêtre de transition:

- les nouveaux writes doivent écrire v2
- la lecture doit accepter v1 et v2
- les outils de re-anchor doivent proposer un upgrade explicite

## D. Schéma PostgreSQL v2

### D1. Principe général

Toutes les tables de coordination partagée doivent être scopées par `project_id`.

Le modèle logique recommandé est:

- `project_registry`
- `workspace_registry`
- `worktree_registry`
- `planning_states`
- `handoff_relays`
- `coordination_records`

### D2. Shape logique minimale

`project_registry`

- `project_id` PK
- `project_id_source`
- `project_root_ref`
- `locator_ref`
- `shared_backend_kind`

`workspace_registry`

- PK composite recommandée: (`project_id`, `workspace_id`)
- FK vers `project_registry(project_id)`

`worktree_registry`

- PK composite recommandée: (`project_id`, `workspace_id`, `worktree_id`)

`planning_states`

- PK composite recommandée: (`project_id`, `workspace_id`, `planning_key`)

`handoff_relays`

- PK composite recommandée: (`project_id`, `workspace_id`, `relay_id`)

`coordination_records`

- PK composite recommandée: (`project_id`, `workspace_id`, `record_id`)

### D3. Pourquoi ne pas scoper uniquement par `project_id`

Alternative rejetée:

- supprimer `workspace_id` de la partition SQL et ne garder que `project_id`

Raison du rejet:

- cela fermerait prématurément l'extension vers plusieurs workspaces par projet
- le coût supplémentaire de garder `workspace_id` est faible
- le bénéfice en expressivité et compatibilité est fort

### D4. Compatibilité migration

Migration additive recommandée:

1. ajouter `project_id` nullable
2. backfill `project_id := workspace_id`
3. ajouter `project_registry`
4. ajouter nouveaux index et FKs
5. migrer les queries vers le scope projet
6. seulement ensuite rendre `project_id` requis

## E. Contrat service v2

### E1. Contrat de registration

La registration doit devenir:

- `registerProject`
- `registerWorkspace`
- `registerWorktreeHeartbeat`

Même si l'API externe reste temporairement simplifiée, les services doivent séparer ces trois niveaux.

### E2. Contrat de lecture/écriture

Toutes les opérations doivent recevoir ou déduire explicitement:

- `projectId`
- `workspaceId`

Aucune query partagée ne doit rester seulement scoped par `workspaceId`.

### E3. Contrat de backup/restore

Les payloads de backup doivent contenir:

- `project_id`
- `workspace_id`
- version du schéma source
- mode de compatibilité éventuel

Le restore doit:

- refuser par défaut un `project_id` incompatible
- expliquer la compatibilité projet/workspace dans le preview

## F. Contrat observabilité et admin

Les commandes d'admin doivent permettre:

- l'énumération des projets
- l'inspection d'un projet
- l'inspection d'un workspace dans un projet
- la détection d'un backend mixte legacy/v2

Le `healthcheck` doit exposer au minimum:

- version de schéma attendue
- version(s) appliquée(s)
- nombre de projets enregistrés
- présence de lignes legacy sans `project_id`

## G. Matrice de compatibilité

### G1. Utilisateur legacy mono-projet

Comportement attendu:

- upgrade sans reconfiguration immédiate
- `project_id := workspace_id`
- lecture des anciens locators et anciens backups

### G2. Multi-worktree même projet

Comportement attendu:

- même `project_id`
- même `workspace_id`
- `worktree_id` distincts

### G3. Monorepo multi-projet

Comportement attendu:

- `project_id` distincts
- `project_root` distincts
- collisions de `session_id`, `planning_key`, `scope_id` sans fuite inter-projets

### G4. Future extension multi-workspace

Comportement attendu:

- un même `project_id`
- plusieurs `workspace_id`
- l'API et le schéma restent déjà cohérents

## H. Alternatives rejetées

### H1. Schéma PostgreSQL par projet

Rejeté parce que:

- la gestion opérationnelle et migratoire devient inutilement lourde
- l'énumération globale devient plus complexe
- cela ne règle pas la clarté d'identité côté runtime

### H2. Utiliser uniquement `repo_root` comme identité projet

Rejeté parce que:

- cela ne couvre pas les monorepos multi-projet
- cela mélange Git et frontière AIDN

### H3. Utiliser uniquement `git_common_dir` comme identité projet

Rejeté parce que:

- cela est utile pour fédérer des worktrees, pas pour distinguer plusieurs projets d'un même repo

### H4. Renommer seulement les champs sans changer le resolver

Rejeté parce que:

- cela déplacerait l'ambiguïté sans la résoudre

## I. Séquencement recommandé

1. implémenter le vocabulaire et le resolver v2
2. implémenter le locator v2 avec lecture v1
3. ajouter le schéma PostgreSQL v2 additif
4. migrer les services et adapters
5. migrer status/doctor/backup/restore
6. ajouter la couverture multi-projet et monorepo
7. seulement ensuite durcir les validations par défaut

## J. Décisions ouvertes

Les points suivants doivent être fermés avant implémentation large:

1. `project_root` est-il sérialisé dans le locator comme path relatif, path canonique, ou référence logique uniquement ?
2. veut-on autoriser plusieurs `workspace_id` actifs par défaut pour un même projet dès la v2, ou simplement préserver cette possibilité dans le schéma ?
3. faut-il exposer `AIDN_PROJECT_ID` et `AIDN_PROJECT_ROOT` dès la première tranche, ou seulement `AIDN_PROJECT_ID` ?
4. quelle stratégie de cleanup cible-t-on pour les lignes legacy sans `project_id` ?

## K. Critères d'acceptation RFC

Cette RFC est considérée suffisamment précise pour implémentation quand:

- un dev senior peut coder le resolver v2 sans deviner la sémantique des identités
- un dev senior peut écrire la migration SQL v2 sans ambiguïté de partition
- un dev senior peut faire évoluer le locator et les flows d'admin sans réinterpréter le modèle
- les cas legacy, multi-worktree et monorepo sont explicitement couverts
