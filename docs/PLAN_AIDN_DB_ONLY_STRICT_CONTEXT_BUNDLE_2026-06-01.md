# Plan AIDN - `db-only` strict, backend canonique et bundle Codex budgete

Date: 2026-06-01

## Objectif

Faire de `db-only` un mode strict pour l'etat runtime: AIDN ne doit plus produire automatiquement de materialisations runtime visibles dans le projet. Les artefacts visibles de session, cycle, coordination ou digest restent possibles, mais uniquement comme exports ou materialisations explicites.

Le socle workflow issu du scaffold n'est pas une materialisation runtime. `AGENTS.md`, les skills `.codex`, `SPEC.md`, `WORKFLOW.md`, `WORKFLOW-KERNEL.md`, `WORKFLOW_SUMMARY.md` et `CODEX_ONLINE.md` restent des surfaces de bootstrap protegees tant qu'un contrat de bootstrap cache sous `.aidn/` n'est pas implemente.

Le backend canonique reste separe du mode d'etat:

- si `runtime.persistence.backend=postgres`, PostgreSQL est le backend canonique pour `install`, `verify`, runtime et shared;
- si PostgreSQL n'est pas configure, SQLite reste le backend local cache sous `.aidn/runtime/index/`;
- SQLite et PostgreSQL ensemble ne sont autorises que pour migration, compatibilite ou diagnostic explicite.

## Contrat cible

### `db-only` strict

En `db-only`, les commandes standard ne doivent pas creer ni rafraichir automatiquement les materialisations runtime/state:

- `docs/audit/CURRENT-STATE.md`;
- `docs/audit/RUNTIME-STATE.md`;
- `docs/audit/HANDOFF-PACKET.md`;
- `docs/audit/cycles/C*`;
- `docs/audit/sessions/S*.md`;
- projections Markdown runtime visibles.

Les surfaces visibles deviennent des materialisations explicites. Une commande ou option dediee doit porter l'intention, par exemple `--materialize-visible-artifacts` ou une commande runtime de projection.

Le cleanup strict ne doit pas quarantiner les assets scaffold qui permettent encore a Codex de comprendre et executer le workflow.

### Backend canonique

`db-only` n'est pas un backend. Le backend est resolu par configuration runtime:

- `runtime.persistence.backend=postgres`: chemin normal PostgreSQL-only;
- absence de configuration PostgreSQL: fallback SQLite cache;
- migration explicite: inspection separee de la source et de la cible.

`install.artifactImportStore` reste un mecanisme de compatibilite ou de migration. Il ne doit pas remplacer le backend canonique quand PostgreSQL est configure.

### Bundle cache Codex

Codex doit pouvoir lire efficacement le contexte sans forcer la materialisation visible. La cible est un cache read-through cache sous:

```text
.aidn/runtime/context/hydrated-context.json
```

Ce bundle est regenerable depuis le backend actif. Il n'est jamais la source de verite.

Regles de selection:

- `active`: artefacts actifs avec extrait de contenu;
- `continuity`: artefacts fortement relies avec extrait limite si le budget le permet;
- `history`: metadonnees seules.

Budgets par defaut:

- cible: 256KB;
- plafond dur: 1MB;
- extrait par artefact: 4KB;
- l'historique ancien reste en manifeste leger sauf relation de continuite, handoff, crash recovery, finding bloquant ou arbitrage.

Le bundle doit exposer:

- `budget_status`;
- `selected_count`;
- `metadata_only_count`;
- `truncated_count`;
- `omitted_count`;
- `total_bytes`;
- `hard_limit_bytes`;
- `source_backend`;
- `runtime_scope_id`;
- `project_id`;
- `workspace_id`;
- `source_revision` ou digest snapshot.

Si le bundle est absent, stale ou incoherent, il est regenere depuis la BDD. Il ne pilote jamais migration, adoption, cleanup, resolution de conflit ou ecriture canonique.

## Migration et reinstallation

Avant toute migration ou reinstallation vers `db-only`, AIDN doit produire un backup externe complet des materialisations runtime/state visibles gerees, puis placer ces artefacts en quarantaine externe apres verification du backup.

Emplacement par defaut:

```text
<parent-du-projet>/.aidn-backups/<project_id>/<timestamp>/
```

Le dry-run doit lister:

- fichiers a sauvegarder;
- fichiers a quarantiner;
- fichiers proteges;
- fichiers inconnus;
- fichiers deja conformes;
- destination du backup;
- destination de la quarantaine.

Les fichiers proteges ou inconnus ne sont pas deplaces sans intention explicite. Une restauration depuis backup/quarantaine doit etre disponible.

## Impacts publics

### Installation

`aidn install` en `db-only` strict:

- ecrit uniquement sous `.aidn/` en chemin normal;
- ne copie pas automatiquement les artefacts visibles du pack core;
- ne rend pas les docs generees visibles;
- preserve `AGENTS.md` par defaut;
- preserve les assets scaffold workflow et ne les traite pas comme des candidats de cleanup;
- conserve la verification du backend, du project context et des surfaces cachees.

Les artefacts visibles ne sont ecrits qu'avec une option explicite de materialisation.

### Verification

`aidn install --verify` doit valider:

- `.aidn/config.json`;
- `.aidn/project/workflow.adapter.json`;
- backend canonique;
- structure BDD;
- project context;
- bundle cache cache sous `.aidn/`;
- absence d'obligation sur `docs/audit/*` en `db-only` strict.

### Runtime et shared

Runtime et shared doivent resoudre le meme contexte projet. `project_id`, `workspace_id`, `worktree_id` et `runtime_scope_id` restent les frontieres canoniques pour eviter les collisions inter-projets.

## Risques

- Des workflows ou tests historiques peuvent supposer que `docs/audit/*` existe toujours.
- Des skills Codex peuvent encore lire des projections visibles au lieu du bundle cache ou de la BDD.
- Des installations existantes peuvent contenir des artefacts visibles geres qui doivent etre sauvegardes et quarantaines sans perte.
- Une configuration PostgreSQL incomplete peut faire retomber implicitement vers SQLite si le contrat n'est pas strictement applique.
- Un bundle trop volumineux peut deteriorer les longues sessions.

## Gowire

`gowire` sera traite comme lot separe apres mise a jour et validation AIDN:

- dry-run migration/cleanup sur `G:\projets\gowire`;
- backup externe sous `G:\projets\.aidn-backups\gowire\<timestamp>\`;
- validation PostgreSQL et project context;
- quarantaine externe des artefacts visibles geres;
- verification absence de doublons apres reinstallation/import/adoption.

Les anciennes lignes PostgreSQL associees a un scope path-based ne doivent etre migrees qu'apres diagnostic d'identite et plan de backfill explicite.

## Definition de done

Le lot est complet uniquement si:

- le comportement `db-only` strict est code et verifie;
- les docs et ADR refletent le contrat;
- les sorties JSON publiques ont leurs contrats et fixtures;
- les commandes read-only ou preview ne mutent pas;
- les gates ciblees passent;
- la migration `gowire` reste explicitement separee.
