# Planification - Enrichissement `db-only` et Couche de Reparation / Migration

Date: 2026-03-07
Statut: proposition de mise en oeuvre

## 1. Objectif

Renforcer `db-only` pour qu'il apporte une valeur workflow superieure a `files` et `dual`, pas seulement une projection technique locale.

Le but n'est pas uniquement de stocker des artefacts en SQLite. Le but est de disposer d'un etat relationnel assez riche pour:

- accelerer l'hydratation de contexte;
- eviter les rescans Markdown inutiles;
- tolerer les structures `legacy|mixed`;
- enrichir automatiquement les relations manquantes;
- transformer la "reparation" d'un projet particulier en moteur de migration reutilisable pour les iterations futures.

## 2. Constat actuel

Etat actuel:

- `files` est la source de verite historique.
- `dual` est deja utile: checks DB-backed, projection fichiers conservee, parite verifiee.
- `db-only` fonctionne techniquement, mais la valeur semantique de la DB reste partielle.

Points forts actuels:

- artefacts bien importes;
- taxonomie `kind/family/subtype` deja presente;
- contenu + canonical markdown stockables;
- `cycles`, `file_map`, `artifact_tags`, `run_metrics` deja exposes;
- reconstruction `db -> files` deja possible.

Limites actuelles:

- pas de table `sessions`;
- pas de table de relations explicites entre entites;
- `artifacts.cycle_id` et `artifacts.session_id` restent faibles;
- `file_map` couvre surtout `cycle -> fichier`, pas les liens metier;
- le legacy est absorbe mais pas suffisamment "repare";
- `db-only` hydrate encore trop par chemin/heuristique, pas assez par graphe relationnel.

## 3. Decision cible

Valider les principes suivants:

1. `dual` reste le mode de transition et de compatibilite principal.
2. `db-only` devient un mode a forte valeur ajoutee seulement si la DB contient un graphe relationnel enrichi.
3. La reparation legacy ne doit pas etre un patch ponctuel par projet, mais un pipeline de migration reexecutable.
4. Toute relation reconstruite doit etre marquee comme:
   - `explicit`
   - `inferred`
   - `ambiguous`
5. Les artefacts Markdown restent des projections lisibles; l'etat canonique enrichi vit dans la DB.

## 4. Cible fonctionnelle

### 4.1 Ce que `db-only` doit apporter

En `db-only`, il faut pouvoir:

- charger rapidement:
  - snapshot actif
  - baseline courante
  - sessions recentes
  - cycles actifs
  - artefacts lies a une session/cycle
  - preuves/supports pertinents
- reconstituer des relations utiles sans reparsing complet des fichiers;
- hydrater le contexte par "sous-graphe" plutot que par balayage de repertoires;
- reconstruire `docs/audit` de maniere coherente a tout moment.

### 4.2 Ce que la couche de reparation doit apporter

La couche de reparation/migration doit:

- importer l'etat brut tel qu'il existe;
- inferer les relations manquantes;
- produire un rapport de confiance;
- ne jamais ecraser silencieusement le brut;
- etre rejouable a chaque evolution de regles;
- servir a la fois:
  - a la migration d'un projet legacy particulier;
  - aux prochaines iterations du moteur.

## 5. Architecture cible de la migration

La migration doit etre pensee comme pipeline en 4 etapes:

1. `raw import`
- capture brute de l'etat observe;
- aucune hypothese forte;
- conservation maximale de l'information.

2. `normalization`
- standardisation des entites;
- classification artefacts;
- extraction des identifiants observables (`cycle_id`, `session_id`, `branch_name`, etc.).

3. `repair / inference`
- creation de liens derives;
- backfill des champs manquants;
- marquage du niveau de confiance et de la source d'inference.

4. `promotion`
- materialisation de l'etat canonical utilisable par le runtime;
- emission d'un rapport de migration;
- export eventuel vers fichiers projetes.

## 6. Schema cible v2

Le schema actuel est une bonne base mais il doit etre enrichi.

### 6.1 Tables a conserver

- `cycles`
- `artifacts`
- `file_map`
- `tags`
- `artifact_tags`
- `run_metrics`
- `index_meta`

### 6.2 Tables a ajouter

#### `sessions`

Colonnes minimales:

- `session_id TEXT PRIMARY KEY`
- `branch_name TEXT`
- `state TEXT`
- `owner TEXT`
- `started_at TEXT`
- `ended_at TEXT`
- `source_artifact_path TEXT`
- `source_confidence REAL`
- `source_mode TEXT` (`explicit|inferred|legacy_repaired`)
- `updated_at TEXT NOT NULL`

#### `artifact_links`

Objectif:
- representer les liens entre artefacts.

Colonnes minimales:

- `source_path TEXT NOT NULL`
- `target_path TEXT NOT NULL`
- `relation_type TEXT NOT NULL`
- `confidence REAL NOT NULL DEFAULT 1.0`
- `inference_source TEXT`
- `source_mode TEXT NOT NULL DEFAULT 'explicit'`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY (source_path, target_path, relation_type)`

Exemples de `relation_type`:

- `supports_cycle`
- `supports_session`
- `summarizes_cycle`
- `summarizes_cycle_set`
- `references_baseline`
- `references_snapshot`
- `evidence_for_status`
- `derived_from_legacy_index`

#### `session_cycle_links`

Objectif:
- relier explicitement sessions et cycles.

Colonnes minimales:

- `session_id TEXT NOT NULL`
- `cycle_id TEXT NOT NULL`
- `relation_type TEXT NOT NULL`
- `confidence REAL NOT NULL DEFAULT 1.0`
- `inference_source TEXT`
- `source_mode TEXT NOT NULL DEFAULT 'explicit'`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY (session_id, cycle_id, relation_type)`

Exemples de `relation_type`:

- `attached`
- `active_in_snapshot`
- `included_in_baseline`
- `owner_of_cycle`

#### `migration_runs`

Objectif:
- versionner et auditer les migrations/reparations.

Colonnes minimales:

- `migration_run_id TEXT PRIMARY KEY`
- `migration_version TEXT NOT NULL`
- `target_root TEXT`
- `started_at TEXT NOT NULL`
- `ended_at TEXT`
- `status TEXT NOT NULL`
- `report_json TEXT`

#### `migration_findings`

Objectif:
- garder le detail exploitable.

Colonnes minimales:

- `migration_run_id TEXT NOT NULL`
- `entity_type TEXT NOT NULL`
- `entity_key TEXT NOT NULL`
- `severity TEXT NOT NULL`
- `finding_code TEXT NOT NULL`
- `message TEXT NOT NULL`
- `repair_applied INTEGER NOT NULL DEFAULT 0`
- `confidence REAL`

## 7. Regles de reparation

### 7.1 Ownership minimal

Si un artefact est sous:

- `cycles/Cxxx.../`
  - inferer `cycle_id`
- `sessions/Sxxx...`
  - inferer `session_id`

Cette regle existe deja partiellement pour les artefacts. Elle doit etre generalisee et tracee comme inference.

### 7.2 Reparation des sessions

Depuis les artefacts session:

- extraire `session_branch`
- extraire `attached_cycles`
- extraire `session_owner`
- creer/mettre a jour `sessions`
- creer `session_cycle_links`

Si le parser ne trouve pas tout:

- stocker le partiel
- marquer `source_mode=inferred`
- emettre un finding `SESSION_PARTIAL_METADATA`

### 7.3 Reparation des snapshots

Depuis `snapshots/context-snapshot.md`:

- extraire cycles actifs;
- creer des `session_cycle_links` de type `active_in_snapshot`;
- creer des `artifact_links` entre snapshot et cycles/artefacts majeurs.

### 7.4 Reparation des baselines

Depuis `baseline/current.md` et `baseline/history.md`:

- extraire les cycles inclus si presents;
- creer des liens `included_in_baseline`;
- lier baseline aux artefacts normatifs majeurs.

### 7.5 Reparation legacy

Cas `cycles/cycle-status.md` ou structures mixtes:

- si un cycle individuel peut etre isole, creer une entite cycle normale;
- sinon creer un artefact `cycle_status_index`;
- ajouter des liens `derived_from_legacy_index` vers les cycles inferables;
- emettre un finding `LEGACY_INDEX_PARTIAL_RELATIONS` si l'information reste incomplete.

### 7.6 Reparation des artefacts de support

Pour les artefacts de support dans un dossier cycle/session:

- creer un lien `supports_cycle` ou `supports_session`;
- si l'ownership est seulement par chemin, `confidence=0.6`;
- si confirme par contenu/canonical/front matter, `confidence=0.9`.

### 7.7 Ambiguite

Si plusieurs entites candidates sont possibles:

- ne pas promouvoir automatiquement le lien comme fort;
- stocker le lien en `source_mode=ambiguous`;
- emettre un finding `AMBIGUOUS_RELATION`;
- laisser le runtime utiliser ce lien uniquement si la policy l'autorise.

## 8. Contrat de fiabilite

Chaque relation ou entite reparee doit porter:

- `source_mode`
- `confidence`
- `inference_source`

Exemples:

- `source_mode=explicit`, `confidence=1.0`
- `source_mode=inferred`, `confidence=0.8`, `inference_source=session_frontmatter`
- `source_mode=legacy_repaired`, `confidence=0.5`, `inference_source=cycle_status_index`

Le runtime doit pouvoir:

- filtrer les liens faibles;
- preferer les liens explicites;
- demander une revalidation si le contexte critique depend d'un lien ambigu.

## 9. Impact sur les modes

### `files`

- reste la reference humaine;
- peut beneficier du moteur de migration pour pre-remplir une DB locale;
- ne change pas de philosophie.

### `dual`

- reste le meilleur mode operationnel a court terme;
- combine auditabilite fichier et acceleration DB-backed;
- beneficie directement de la repair layer sans changer la projection humaine.

### `db-only`

- devient defendable seulement si la DB porte un graphe relationnel suffisamment riche;
- gagne de la valeur quand l'hydratation s'appuie sur des liens, des scores et des findings plutot que sur des heuristiques de chemin seules;
- doit etre considere comme un mode "high leverage" pour projets bien instrumentes, pas comme simple variante technique.

## Addendum - Priorisation des enrichissements `db-only`

Cet addendum capture la priorisation issue de l'evaluation de l'implementation actuelle apres mise en place:

- du schema v2;
- de la repair layer dediee;
- de l'hydratation classee par signaux de reparation;
- de l'integration runtime dans `sync-db-first` et `mode-migrate`.

### A. Verdict courant

Position retenue:

1. `dual` est pret et utile.
2. `db-only` est maintenant credible et apporte deja:
   - gain de rapidite;
   - gain de contexte;
   - meilleure coherence sur legacy/mixed.
3. `db-only` n'est pas encore un graphe workflow complet; la prochaine valeur vient du modele relationnel, pas de plus de stockage brut.

### B. Backlog priorise

#### `P0`

##### `P0-1` Promotion des relations fortes

Objectif:
- distinguer les relations quasi-canoniques des relations simplement inferees.

A ajouter:
- `relation_status` du type:
  - `explicit`
  - `promoted`
  - `inferred`
  - `ambiguous`
  - `rejected`

Portee prioritaire:
- `attached_cycle`
- `active_in_snapshot`
- `included_in_baseline`

Impact:
- tres fort sur la qualite de l'hydratation.

Effort:
- moyen.

##### `P0-2` Enrichissement fort des sessions

Objectif:
- faire des sessions de vraies entites workflow.

A ajouter:
- debut / fin reels;
- parent / enfant;
- carry-over structure;
- integration cible;
- mode de travail;
- meilleures regles de continuite.

Impact:
- tres fort.

Effort:
- moyen.

##### `P0-3` Relations artefact -> artefact plus riches

Objectif:
- sortir du simple `supports_cycle` / `summarizes_cycle`.

A ajouter:
- `supports_artifact`
- `supersedes_artifact`
- `references_artifact`
- `implements_requirement`
- `evidence_for_decision`

Impact:
- tres fort.

Effort:
- eleve.

#### `P1`

##### `P1-1` Requetes metier dediees

Objectif:
- faire de la DB une vraie surface de requetage workflow.

A ajouter:
- `getRelevantCyclesForSession`
- `getRelevantSessionsForCycle`
- `getBaselineContext`
- `getSnapshotContext`
- `getTopArtifactsForDecision`

Impact:
- fort.

Effort:
- moyen.

##### `P1-2` Repair layer incrementale

Objectif:
- eviter le recalcul complet a chaque execution.

A ajouter:
- invalidation ciblee;
- recalcul par artefact/cycle impacte;
- fingerprint de migration.

Impact:
- fort sur performance et CI.

Effort:
- eleve.

##### `P1-3` Gestion explicite des ambiguities

Objectif:
- transformer l'ambiguite en objet gouverne, pas en simple filtre.

A ajouter:
- statut:
  - `open`
  - `accepted`
  - `rejected`
  - `needs_human_resolution`
- workflow de resolution.

Impact:
- fort.

Effort:
- moyen.

#### `P2`

##### `P2-1` Modelisation de la continuite workflow

Objectif:
- relier plus proprement session, cycle, baseline, snapshot, handoff.

Impact:
- moyen a fort.

Effort:
- moyen.

##### `P2-2` Liens plus fins pour les artefacts de support

Objectif:
- mieux exploiter rapports, incidents, backlog, migration.

Impact:
- moyen.

Effort:
- moyen.

##### `P2-3` Vues SQL orientees runtime

Objectif:
- simplifier les lectures frequentes et reduire la logique applicative repetitive.

A ajouter:
- `v_active_cycle_context`
- `v_session_context`
- `v_repair_findings_open`

Impact:
- moyen.

Effort:
- faible a moyen.

### C. Ordre recommande

Ordre d'execution recommande:

1. promotion des relations fortes;
2. enrichissement des sessions;
3. requetes metier dediees;
4. relations artefact -> artefact;
5. gestion explicite des ambiguities;
6. repair layer incrementale;
7. continuite workflow;
8. raffinement des artefacts de support;
9. vues SQL runtime.

### D. Rationnel

Cet ordre est retenu parce qu'il maximise d'abord:

- la qualite du contexte utile au runtime;
- la valeur semantique de `db-only`;
- la capacite de `db-only` a depasser `dual` sur les projets bien structures.

Il reporte volontairement:

- les optimisations de performance plus fines;
- les raffinements de presentation SQL;
- les enrichissements support moins critiques.

### E. Decision de pilotage

Position de pilotage retenue:

1. recommander `dual` comme mode avance par defaut;
2. continuer a investir dans `db-only` comme mode a forte valeur contextuelle;
3. considerer que la prochaine phase d'investissement doit porter sur le modele relationnel et les requetes metier, pas sur le simple stockage d'artefacts.

### `dual`

- beneficie immediatement des relations enrichies;
- garde la projection lisible;
- devient le mode de validation ideale pour l'enrichissement.

### `db-only`

- devient le vrai mode a valeur ajoutee;
- la qualite de contexte ne depend plus uniquement des chemins ou du scan;
- l'hydratation selective peut s'appuyer sur le graphe relationnel.

## 10. Plan de mise en oeuvre

### Phase 1 - Schema et stockage enrichi

Objectif:
- ajouter la structure necessaire sans casser l'existant.

Travaux:

- etendre `schema.sql`;
- ajouter `sessions`, `artifact_links`, `session_cycle_links`, `migration_runs`, `migration_findings`;
- ajouter les migrations SQLite idempotentes;
- mettre a jour lecture SQLite tolérante.

Critere d'acceptation:

- l'index actuel continue a se lire;
- les nouvelles tables existent sans casser les fixtures actuelles.

### Phase 2 - Moteur de migration brut

Objectif:
- importer et normaliser sans reparation agressive.

Travaux:

- `src/application/migration/import-raw-use-case.mjs`
- `src/application/migration/normalize-entities-use-case.mjs`
- `tools/runtime/migrate-db-semantic.mjs`

Sortie:

- entites brutes + normalisees;
- rapport initial;
- aucun lien artificiel fort.

Critere d'acceptation:

- migration rejouable;
- zero perte d'artefact;
- rapport de findings genere.

### Phase 3 - Couche de reparation relationnelle

Objectif:
- enrichir le graphe de maniere tracee.

Travaux:

- parser session/snapshot/baseline;
- backfill `sessions`;
- generer `artifact_links` et `session_cycle_links`;
- introduire `confidence/source_mode`.

Critere d'acceptation:

- les relations explicites et inferees sont distinguables;
- le runtime peut lister les cycles et sessions actives sans rescanner tous les fichiers.

### Phase 4 - Hydratation `db-only` guidee par graphe

Objectif:
- faire du graphe la vraie valeur ajoutee.

Travaux:

- hydrateur contexte par voisinage relationnel;
- selection ciblee des artefacts pertinents;
- budget de contexte par priorite et confiance.

Critere d'acceptation:

- hydratation plus courte et plus stable que le scan complet;
- contexte plus coherent sur les repos `mixed`.

### Phase 5 - Promotion et export

Objectif:
- rendre le mecanisme exploitable en continu.

Travaux:

- promotion des relations de confiance elevee;
- export `db -> files` en respectant les liens;
- rapport final de migration;
- support de reexecution incrementale.

Critere d'acceptation:

- `db-only -> files` reste reconstructible;
- les migrations suivantes reutilisent la couche de reparation au lieu de repartir de zero.

## 11. Valeur iterative

Le mecanisme doit explicitement servir aux iterations futures.

Pour cela:

- les regles de migration doivent etre versionnees;
- chaque run doit etre comparable au precedent;
- les findings doivent etre historises;
- un projet particulier "repare" doit produire des heuristiques reutilisables ailleurs.

Principe:

- on n'itere pas seulement sur les donnees du projet;
- on itere sur les regles de comprehension du workflow.

## 12. Definition of Done

Le chantier sera considere termine quand:

1. `db-only` peut hydrater un contexte utile a partir de relations enrichies;
2. les sessions et liens session/cycle sont explicites en DB;
3. les cas legacy/mixed produisent un rapport de reparation traçable;
4. les relations inferees sont marquees par confiance et source;
5. la migration est rejouable sur les prochaines iterations;
6. `dual` reste en parite avec projection fichiers;
7. `db-only -> files` reste reconstructible sans perte structurelle majeure.

## 13. Recommandation d'ordre d'execution

Ordre recommande:

1. schema v2
2. lecture SQLite tolérante v2
3. import brut / normalisation
4. reparation sessions / cycles / support artifacts
5. hydrateur contexte graphe
6. promotion + migration report
7. validation sur corpus `legacy`, `mixed`, `modern`, projet reel

## 14. Risques

1. Sur-inference
- risque: creer de faux liens.
- mitigation: `confidence`, `source_mode`, promotion explicite.

2. Complexite excessive
- risque: transformer l'index en moteur opaque.
- mitigation: pipeline simple `raw -> normalized -> inferred -> canonical`.

3. Divergence entre fichiers et DB
- risque: la reparation enrichit trop la DB sans projection coherente.
- mitigation: verifier les exports `db -> files` et produire des rapports de divergence.

4. Valeur faible si le graphe reste trop pauvre
- mitigation: prioriser `sessions`, `session_cycle_links`, `artifact_links` avant toute sophistication supplementaire.

## 15. Decision proposal

Valider:

1. `db-only` ne sera considere "mature" qu'apres enrichissement relationnel.
2. La reparation legacy devient un moteur de migration versionne.
3. Les liens infers sont des donnees de premier rang, mais jamais confondus avec l'explicite.
4. Le prochain chantier DB ne porte pas d'abord sur plus de stockage, mais sur plus de semantique.
