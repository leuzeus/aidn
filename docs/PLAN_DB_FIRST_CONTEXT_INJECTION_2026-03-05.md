# Planification - Injection Contexte Codex + Runtime DB-First

Date: 2026-03-05
Statut: proposition de mise en oeuvre

## 1. Objectif

Mettre en place un runtime ou:

- les sorties JSON des hooks (`npx aidn perf ... --json`) sont injectees explicitement dans le contexte operationnel Codex;
- en `dual` et `db-only`, les artefacts workflow sont geres en **DB-first**;
- en `dual`, les fichiers `docs/audit` sont projetes en parallele;
- en `db-only`, les artefacts sont hydratables a la demande pour le contexte;
- un retour en `files` reconstruit integralement `docs/audit` depuis la DB.

## 2. Contrat de modes d'etat (a figer)

- `files`: source de verite = fichiers `docs/audit/*`.
- `dual`: source de verite = DB; projection fichiers automatique (compatibilite outillage).
- `db-only`: source de verite = DB; projection fichiers seulement a la demande.

Regle globale: en `dual/db-only`, les checks et hooks doivent suivre un chemin DB-backed (strict).

## 3. Gap actuel (resume)

- Le chainage perf existe (`skill-hook`, `checkpoint`, `workflow-hook`) et renvoie du JSON.
- Le JSON est peu exploite en contexte agent si non relu explicitement.
- Le pipeline courant reste majoritairement `files -> index(DB)` puis `DB -> files` a la demande, pas un flux natif DB-first pour les artefacts metier.

## 4. Cible fonctionnelle

### 4.1 Injection explicite des JSON hooks

Standardiser une etape obligatoire apres chaque hook JSON:

1. executer la commande via wrapper unique;
2. parser/normaliser le payload;
3. persister un resume canonique;
4. recharger ce resume dans le flux de decision Codex.

### 4.2 DB-first artefacts en dual/db-only

- Ecriture artefact: DB en premier (upsert canonique + contenu + metadonnees).
- Projection fichier:
  - `dual`: projection automatique apres upsert;
  - `db-only`: projection uniquement on-demand.
- Lecture contexte en `db-only`: hydratation selective (pas reconstruction globale systematique).

## 5. Livrables techniques

## 5.1 Contexte JSON

- `tools/codex/run-json-hook.mjs`
  - execute une commande JSON;
  - capture `stdout`;
  - valide/parce JSON;
  - applique politique d'echec (`strict`, `state_mode`).
- `tools/codex/normalize-hook-payload.mjs`
  - normalise les schemas heterogenes vers un contrat stable.
- `tools/codex/context-store.mjs`
  - ecrit:
    - brut: `.aidn/runtime/context/raw/<skill>-<ts>.json`
    - agregat: `.aidn/runtime/context/codex-context.json`

Schema minimal par entree:

- `ts`, `skill`, `command`, `ok`, `state_mode`, `strict`, `mode`
- `decision`, `fallback`, `reason_codes`
- `action`, `result`, `gates_triggered`
- `error`

## 5.2 Couche DB-first artefacts

- `tools/runtime/artifact-store.mjs`
  - API: `upsertArtifact`, `getArtifact`, `listArtifacts`, `materializeArtifacts`.
  - stockage canonical + content + hash + provenance (`skill`, `run_id`, `updated_at`).
- adaptateurs skills pour remplacer les ecritures directes `docs/audit/*`.
- projection:
  - `dual`: auto-materialization incremental;
  - `db-only`: materialization selective ou full sur demande.

## 5.3 Hydratation contexte en db-only

- `tools/codex/hydrate-context.mjs`
  - reconstruit uniquement les artefacts requis pour la skill courante;
  - priorite: `snapshots/context-snapshot.md`, `WORKFLOW.md`, `SPEC.md`, session/cycles actifs;
  - budget taille contexte configurable.

## 5.4 Bascule inter-modes

- `tools/runtime/mode-migrate.mjs`
  - `files -> dual/db-only`: import initial + verif parite.
  - `dual/db-only -> files`: reconstruction complete de `docs/audit`.
  - rapport de divergence et statut final.

## 6. Migration des skills

Skills cibles:

- `context-reload`
- `branch-cycle-audit`
- `drift-check`
- `start-session`
- `close-session`
- `cycle-create`
- `cycle-close`
- `promote-baseline`
- `requirements-delta`
- `convert-to-spike`

Regle migration par skill:

1. remplacer l'appel `npx aidn perf ... --json` direct par `run-json-hook.mjs`;
2. injecter lecture de `codex-context.json` juste apres hook;
3. brancher decision explicite (`stop|full|incremental`, `go|warn|block`);
4. remplacer ecritures fichier par `artifact-store` (si skill mutatrice);
5. conserver compatibilite temporaire sous feature flag si necessaire.

## 7. Phasage

### Phase 1 - Injection JSON (priorite immediate)

- implementer wrapper + normalizer + context store;
- migrer les 10 skills hookees;
- ajouter checks CI de couverture.

### Phase 2 - DB-first ecriture

- implementer `artifact-store`;
- migrer skills mutatrices en DB-first;
- activer projection auto en `dual`.

### Phase 3 - db-only hydratation + bascule files

- implementer hydrateur contexte `db-only`;
- implementer reconstruction complete vers `files`;
- valider workflows de transition.

### Phase 4 - Audit review post-optimisation

- executer une revue d'audit finale orientee processus et resultats;
- verifier que les optimisations ne sont ni perturbees, ni annulees dans le flux reel;
- produire un rapport de stabilite avec ecarts, causes racines et actions correctives;
- declencher une replanification formelle si les ecarts depassent les seuils definis.

## 8. Tests et CI

Tests unitaires:

- normalisation payload hooks (`ok:true`, `ok:false`, `strict`);
- `artifact-store` (upsert/read/list/materialize);
- hydrateur contexte (selection deterministic + budget).

Tests integration:

- decision hook appliquee dans chaque skill;
- parite `dual` (DB source vs fichiers projetes);
- execution `db-only` sans dependance a un `docs/audit` preexistant;
- reconstruction `db-only -> files` sans perte.
- audit review de fin: verification des gains process sur une fenetre multi-runs.

Gates CI:

- interdire nouveaux appels directs `npx aidn perf ... --json` hors wrapper;
- verifier ecriture de `.aidn/runtime/context/codex-context.json`;
- verifier qu'en `dual/db-only`, le chemin DB-first est utilise pour ecriture artefacts.
- ajouter un gate `audit-review` sur derive des KPI process (latence, fallback, blocages, rework).

## 9. Definition of Done

- 100% des skills cibles utilisent l'injection explicite JSON.
- `codex-context.json` est maintenu et consomme dans les decisions de skill.
- En `dual/db-only`, ecriture artefact metier DB-first active.
- En `dual`, projection fichiers automatique operationnelle.
- En `db-only`, hydratation contexte selective operationnelle.
- Retour vers `files` possible via reconstruction complete, validee par tests.
- Audit review final execute et approuve, ou replanification ouverte avec backlog correctif.

## 10. Risques et mitigations

- Risque: surcharge contexte LLM.
  - Mitigation: injecter resume minimal, pas payload complet.
- Risque: schemas JSON heterogenes.
  - Mitigation: normalizer unique + tests de contrat.
- Risque: divergence DB/fichiers en `dual`.
  - Mitigation: checks de parite et materialization incremental deterministic.
- Risque: blocages excessifs en strict.
  - Mitigation: regles strictes bornees a `dual/db-only`, erreurs explicites et actionnables.
- Risque: degradation silencieuse des optimisations dans le temps.
  - Mitigation: audit review de cloture + gate CI de derive + boucle de replanification.

## 11.1 Cadre d'audit review (cloture)

Perimetre:

- verifier que les decisions JSON injectees sont effectivement consommees par les skills;
- verifier que DB-first reste le chemin primaire en `dual/db-only`;
- verifier que les projections/reconstructions ne reintroduisent pas de dette process.

Signaux minimaux a controler:

- taux de fallback (`reason_codes`), frequence des `stop/block`, latence mediane des hooks;
- ecarts de parite DB/fichiers en `dual`;
- volume de rework (actions correctives post-run);
- incidents de migration de mode (`files <-> dual <-> db-only`).

Sortie attendue:

- rapport `audit-review` (PASS/WARN/FAIL);
- liste d'ecarts priorisee;
- decision: `stabilise` ou `replanifier`.

Regle de boucle:

- si `WARN` recurrent ou `FAIL`, ouvrir une nouvelle planification d'optimisation avec objectifs cibles et delai.
## 12. Decision proposal

Valider officiellement:

1. `dual` et `db-only` deviennent DB-first (pas seulement DB-backed checks).
2. L'injection explicite des hooks JSON est mandatory dans tous les skills concernes.
3. La reconstruction vers `files` est un mecanisme standard de compatibilite, pas la source primaire en mode DB.
4. Une phase d'audit review de cloture est obligatoire avec replanification automatique en cas de derive.
