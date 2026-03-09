# RFC-0001 - Reload Incremental, Gating En Niveaux, Index Local

## Statut

Proposé

## Contexte

Le workflow Aid'n maintient une forte qualité (DoR/DoD, drift-check, traçabilité), mais le coût de contrôle peut augmenter:
- relectures répétées d'artefacts
- relance de gates sans changement de contexte
- writeups redondants

Objectif:
- réduire latence/coût contexte sans diminuer la couverture des garanties `SPEC-Rxx`.

## Objectifs RFC

- définir un reload incrémental sûr (digest + invalidation + fallback)
- définir un gating à 3 niveaux (L1/L2/L3)
- proposer un index local minimal SQLite optionnel
- formaliser les modes d'état runtime `files|dual|db-only`
- garantir l'import/export complet des artefacts normatifs et de support

Non-objectifs:
- remplacement immédiat des fichiers Markdown comme source de vérité
- dépendance obligatoire à un service distant

## Proposition A - Reload Incrémental

## A1. Digest model

Digest global de session:
- `reload_digest = sha256(branch + head_commit + spec_version + baseline_hash + snapshot_hash + active_cycles_hash + session_hash)`

Digest par artefact:
- `artifact_hash = sha256(file_bytes)`

Fichiers suivis minimalement:
- `docs/audit/baseline/current.md`
- `docs/audit/snapshots/context-snapshot.md`
- `docs/audit/sessions/SXXX.md` (session active)
- `docs/audit/cycles/*/status.md` (cycles actifs)
- `docs/audit/WORKFLOW.md` (adapter local)
- `docs/audit/SPEC.md` (snapshot canonique)
- `docs/audit/cycles/*/*.md` (artefacts de support liés aux cycles)
- `docs/audit/reports/*.md`, `docs/audit/migration/*.md`, `docs/audit/backlog/*.md`

Cache:
- `.aidn/runtime/cache/reload-state.json`

Champs cache:
- `run_id`, `created_at`, `branch`, `head_commit`, `reload_digest`
- `artifacts[] {path, hash, mtime_ns, size_bytes, role}`
- `active_cycles[] {cycle_id, state, branch_name, status_hash}`

## A2. Invalidation rules

Invalider (partiel ou total) si:
- changement de branche ou de commit `HEAD`
- hash baseline/snapshot/session/cycle actif modifié
- set des cycles actifs modifié
- fichier manquant ou dupliqué (ex: mapping ambigu)
- version spec/workflow modifiée

Portée:
- invalidation partielle: ne recharger que les artefacts impactés
- invalidation totale: full reload

## A3. Fallback policy

Forcer full reload si:
- cache absent/corrompu
- parsing artefact échoue
- incohérence mapping branch<->cycle
- digest calculé invalide

Comportement:
1. log `result=fallback`, `reason_code=<...>`
2. exécuter full reload
3. si full reload échoue: `STOP` + incident (`L2` mini, `L3/L4` selon impact)

## Proposition B - Gating En Niveaux

## B1. L1 - Fast checks (toujours)

Checks:
- digest/hashes (changement réel?)
- mapping branche/cycle/session
- présence des champs obligatoires (`dor_state`, continuité, etc.)

Attendu:
- < 200ms en local sur contexte standard

Sortie:
- `L1_PASS` -> continuer
- `L1_FAIL_RECOVERABLE` -> fallback full reload
- `L1_FAIL_BLOCKING` -> STOP + L3

## B2. L2 - Drift-check conditionnel

L2 déclenché seulement si signaux:
- `objective_delta`: objectif diffère de session/cycle
- `scope_growth`: +N fichiers hors périmètre prévu (N configurable, ex: 3)
- `cross_domain_touch`: fichiers sur domaines sensibles (db, auth, api)
- `time_since_last_drift_check > T` (ex: 45 min en COMMITTING)
- `uncertain_intent`: incapacité à résumer objectif en 1 phrase

Logique:
- si aucun signal -> pas de drift-check complet (trace "skipped-no-signal")
- si >=1 signal -> drift-check standard
- si signal critique (security/db structural) -> drift-check obligatoire + mode COMMITTING

## B3. L3 - Incident triage

Déclenchement:
- contradiction de gate (`Rxx`)
- mapping branch/cycle impossible
- fallback répété (>2 fois sur la même run/session)
- état non conforme persistant

Politique:
- `L1/L2`: auto-fix possible
- `L3/L4`: STOP + autorisation utilisateur avant changement de règles

## Proposition C - Option Index Local SQLite Minimal

## C1. Schéma proposé

```sql
CREATE TABLE cycles (
  cycle_id TEXT PRIMARY KEY,
  session_id TEXT,
  state TEXT NOT NULL,
  outcome TEXT,
  branch_name TEXT,
  dor_state TEXT,
  continuity_rule TEXT,
  continuity_base_branch TEXT,
  continuity_latest_cycle_branch TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE artifacts (
  artifact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,              -- baseline|snapshot|session|cycle_status|workflow|spec|other
  family TEXT NOT NULL,            -- normative|support|unknown
  subtype TEXT,                    -- plan|status|report|profiling|migration_plan|...
  gate_relevance INTEGER NOT NULL DEFAULT 0, -- 1 si utilisé par gates, sinon 0
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  session_id TEXT,
  cycle_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE file_map (
  cycle_id TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT,                       -- status|plan|brief|traceability|...
  relation TEXT,                   -- normative|support
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (cycle_id, path)
);

CREATE TABLE tags (
  tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL UNIQUE
);

CREATE TABLE artifact_tags (
  artifact_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, tag_id),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(artifact_id),
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id)
);

CREATE TABLE run_metrics (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  overhead_ratio REAL,
  artifacts_churn REAL,
  gates_frequency REAL
);

CREATE TABLE workflow_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);
```

## C2. Requêtes de base nécessaires

- cycles actifs par branche:
```sql
SELECT cycle_id, state, branch_name
FROM cycles
WHERE state IN ('OPEN','IMPLEMENTING','VERIFYING')
ORDER BY updated_at DESC;
```

- artefacts modifiés depuis un timestamp:
```sql
SELECT path, kind, sha256, updated_at
FROM artifacts
WHERE updated_at > ?
ORDER BY updated_at DESC;
```

- mapping fichiers d'un cycle:
```sql
SELECT path, role
FROM file_map
WHERE cycle_id = ?;
```

- fréquence de gates par run:
```sql
SELECT run_id, gates_frequency, overhead_ratio
FROM run_metrics
ORDER BY started_at DESC
LIMIT 30;
```

## C3. Synchronisation avec fichiers existants (import/export)

Principe:
- mode `files`: fichiers Markdown restent source de vérité
- mode `dual`: fichiers + SQLite doivent rester en parité
- mode `db-only`: SQLite devient source runtime; fichiers reconstructibles à la demande

Import (files -> index):
1. scanner artefacts workflow
2. parser champs structurés minimaux (`state`, `branch_name`, `dor_state`, etc.)
3. classer chaque artefact: `family`, `subtype`, `gate_relevance`
4. upsert tables `cycles`, `artifacts`, `file_map`, `tags`
5. si format inconnu: conserver en `family=support|unknown` + `reason_code`, sans perte silencieuse

Export (index -> rapports):
- générer des rapports KPI/perf
- en `dual`: ne pas écraser automatiquement les artefacts normatifs
- en `db-only`: reconstruire dossiers cycle/session + artefacts de support depuis DB

Rebuild:
- commande de reconstruction complète depuis fichiers
- utilisée en fallback/réparation

Variables de mode proposées:
- `AIDN_INDEX_STORE_MODE=file|sqlite|...` (backend index)
- `AIDN_STATE_MODE=files|dual|db-only` (source d'état workflow)

## Compatibilité et Qualité

Règle de sécurité:
- si doute: fallback full reload + gate standard

Invariants maintenus:
- DoR/DoD et drift-check ne sont pas supprimés
- on réduit les répétitions, pas la couverture
- traçabilité cycle/session reste obligatoire

## Plan De Rollout

1. Lot 1: instrumentation + L1 fast checks + KPI
2. Lot 2: reload incrémental + index local + fallback robuste + taxonomie artefacts
3. Lot 3: abstraction `IndexStore` + modes `dual/db-only` + reconstruction DB -> fichiers (feature flag)

## Open Questions

- seuil exact `scope_growth` par type de cycle
- temps max sans L2 drift-check en COMMITTING
- niveau de granularité optimal des tags artefact

## Addendum - Compatibilité Multi-Version (legacy + moderne)

Constat terrain:
- un même repo peut contenir des structures de workflow issues de plusieurs versions (ex: cycles legacy `C001` et cycles modernes `C001-<slug>`).
- le champ déclaré `workflow_version` peut être obsolète par rapport à la structure réellement observée.

Décision:
- prioriser un `structure profile check` basé sur la structure observée:
  - `legacy` | `modern` | `mixed` | `unknown`
- utiliser le profil pour choisir la policy d'artefacts requis (au lieu d'une liste unique globale).
- conserver `workflow_version` comme signal secondaire de cohérence, pas comme source unique de vérité.

Signaux normalisés proposés:
- `STRUCTURE_MIXED_PROFILE`
- `STRUCTURE_PROFILE_UNKNOWN`
- `DECLARED_VERSION_STALE`
- `STRUCTURE_PROFILE_CHANGED`

Effet attendu:
- moins de faux blocages sur repos hybrides
- drift-check conditionnel plus fiable
- meilleure traçabilité des écarts version déclarée vs structure observée
