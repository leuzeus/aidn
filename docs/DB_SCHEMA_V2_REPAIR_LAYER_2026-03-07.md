# Schema SQL v2 - DB-Only Enrichment And Repair Layer

Date: 2026-03-07
Statut: proposition technique

## 1. Objectif

Definir un schema SQLite v2 concret pour:

- enrichir `db-only`;
- stocker les entites workflow explicites;
- supporter la reparation/inference legacy;
- garder la compatibilite avec le schema v1 actuel.

Le schema v2 doit permettre:

- lecture rapide par entite (`cycle`, `session`, `artifact`);
- liens explicites et infers;
- migration rejouable;
- reconstruction `db -> files`;
- audit des reparations appliquees.

## 2. Principes

1. ne pas casser la lecture v1
2. conserver `artifacts` comme table centrale
3. ajouter les relations manquantes plutot que surcharger `file_map`
4. distinguer explicitement:
   - `explicit`
   - `inferred`
   - `ambiguous`
   - `legacy_repaired`
5. ajouter `confidence` et `inference_source` partout ou une relation peut etre reconstruite

## 3. Compatibilite v1 -> v2

Tables v1 conservees:

- `cycles`
- `artifacts`
- `file_map`
- `tags`
- `artifact_tags`
- `run_metrics`
- `index_meta`

Tables v2 ajoutees:

- `sessions`
- `artifact_links`
- `cycle_links`
- `session_cycle_links`
- `migration_runs`
- `migration_findings`

Colonnes v2 ajoutees:

- `artifacts.source_mode`
- `artifacts.entity_confidence`
- `artifacts.legacy_origin`

## 4. SQL cible

### 4.1 Meta

```sql
CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
```

Valeurs recommandees:

- `schema_version = 2`
- `payload_digest`
- `structure_kind`
- `target_root`
- `audit_root`
- `structure_profile_json`
- `migration_engine_version`

### 4.2 Cycles

```sql
CREATE TABLE IF NOT EXISTS cycles (
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
```

Notes:

- garder `session_id` pour compatibilite
- la relation canonique session/cycle sera plutot dans `session_cycle_links`

### 4.3 Sessions

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  branch_name TEXT,
  state TEXT,
  owner TEXT,
  started_at TEXT,
  ended_at TEXT,
  source_artifact_path TEXT,
  source_confidence REAL NOT NULL DEFAULT 1.0,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL
);
```

Contraintes de fait:

- `source_mode IN ('explicit', 'inferred', 'ambiguous', 'legacy_repaired')`

### 4.4 Artifacts

Schema actuel enrichi:

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  family TEXT NOT NULL DEFAULT 'unknown',
  subtype TEXT,
  gate_relevance INTEGER NOT NULL DEFAULT 0,
  classification_reason TEXT,
  content_format TEXT,
  content TEXT,
  canonical_format TEXT,
  canonical_json TEXT,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  session_id TEXT,
  cycle_id TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  entity_confidence REAL NOT NULL DEFAULT 1.0,
  legacy_origin TEXT,
  updated_at TEXT NOT NULL
);
```

Usage des nouvelles colonnes:

- `source_mode`
  - mode d'association de l'artefact a une entite
- `entity_confidence`
  - confiance sur `cycle_id/session_id`
- `legacy_origin`
  - ex: `legacy_cycle_status`, `mixed_layout`, `manual_backfill`

### 4.5 File Map

```sql
CREATE TABLE IF NOT EXISTS file_map (
  cycle_id TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT,
  relation TEXT NOT NULL DEFAULT 'unknown',
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (cycle_id, path)
);
```

Rôle:

- vue simple `cycle -> fichiers`
- pas la table relationnelle générale

### 4.6 Tags

```sql
CREATE TABLE IF NOT EXISTS tags (
  tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL UNIQUE
);
```

```sql
CREATE TABLE IF NOT EXISTS artifact_tags (
  artifact_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, tag_id),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(artifact_id),
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id)
);
```

### 4.7 Run Metrics

```sql
CREATE TABLE IF NOT EXISTS run_metrics (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  overhead_ratio REAL,
  artifacts_churn REAL,
  gates_frequency REAL
);
```

### 4.8 Artifact Links

Table pivot principale du graphe:

```sql
CREATE TABLE IF NOT EXISTS artifact_links (
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_path, target_path, relation_type)
);
```

Relations ciblees:

- `supports_cycle`
- `supports_session`
- `summarizes_cycle`
- `summarizes_cycle_set`
- `references_snapshot`
- `references_baseline`
- `evidence_for_status`
- `derived_from_legacy_index`
- `mentions_cycle`
- `mentions_session`

### 4.9 Cycle Links

Liens directs entre cycles:

```sql
CREATE TABLE IF NOT EXISTS cycle_links (
  source_cycle_id TEXT NOT NULL,
  target_cycle_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_cycle_id, target_cycle_id, relation_type)
);
```

Relations typiques:

- `precedes`
- `depends_on`
- `derived_from`
- `summarized_with`

### 4.10 Session / Cycle Links

```sql
CREATE TABLE IF NOT EXISTS session_cycle_links (
  session_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, cycle_id, relation_type)
);
```

Relations typiques:

- `attached`
- `active_in_snapshot`
- `included_in_baseline`
- `owner_of_cycle`

### 4.11 Migration Runs

```sql
CREATE TABLE IF NOT EXISTS migration_runs (
  migration_run_id TEXT PRIMARY KEY,
  migration_version TEXT NOT NULL,
  target_root TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  report_json TEXT
);
```

### 4.12 Migration Findings

```sql
CREATE TABLE IF NOT EXISTS migration_findings (
  migration_run_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  finding_code TEXT NOT NULL,
  message TEXT NOT NULL,
  repair_applied INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (migration_run_id, entity_type, entity_key, finding_code)
);
```

## 5. Index recommandes

```sql
CREATE INDEX IF NOT EXISTS idx_artifacts_cycle_id ON artifacts(cycle_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
CREATE INDEX IF NOT EXISTS idx_artifacts_family ON artifacts(family);
CREATE INDEX IF NOT EXISTS idx_artifacts_source_mode ON artifacts(source_mode);

CREATE INDEX IF NOT EXISTS idx_cycles_state ON cycles(state);
CREATE INDEX IF NOT EXISTS idx_cycles_branch_name ON cycles(branch_name);

CREATE INDEX IF NOT EXISTS idx_sessions_branch_name ON sessions(branch_name);
CREATE INDEX IF NOT EXISTS idx_sessions_source_mode ON sessions(source_mode);

CREATE INDEX IF NOT EXISTS idx_file_map_relation ON file_map(relation);

CREATE INDEX IF NOT EXISTS idx_artifact_links_source ON artifact_links(source_path);
CREATE INDEX IF NOT EXISTS idx_artifact_links_target ON artifact_links(target_path);
CREATE INDEX IF NOT EXISTS idx_artifact_links_relation_type ON artifact_links(relation_type);
CREATE INDEX IF NOT EXISTS idx_artifact_links_source_mode ON artifact_links(source_mode);

CREATE INDEX IF NOT EXISTS idx_session_cycle_links_cycle ON session_cycle_links(cycle_id);
CREATE INDEX IF NOT EXISTS idx_session_cycle_links_session ON session_cycle_links(session_id);
CREATE INDEX IF NOT EXISTS idx_session_cycle_links_relation ON session_cycle_links(relation_type);

CREATE INDEX IF NOT EXISTS idx_cycle_links_source ON cycle_links(source_cycle_id);
CREATE INDEX IF NOT EXISTS idx_cycle_links_target ON cycle_links(target_cycle_id);

CREATE INDEX IF NOT EXISTS idx_migration_findings_run ON migration_findings(migration_run_id);
CREATE INDEX IF NOT EXISTS idx_migration_findings_entity ON migration_findings(entity_type, entity_key);
```

## 6. Migration SQL incrementale

### 6.1 ALTER v1 -> v2

```sql
ALTER TABLE artifacts ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'explicit';
ALTER TABLE artifacts ADD COLUMN entity_confidence REAL NOT NULL DEFAULT 1.0;
ALTER TABLE artifacts ADD COLUMN legacy_origin TEXT;
```

Notes:

- en SQLite, ces `ALTER TABLE` doivent etre proteges par une verification de colonne existante cote applicatif

### 6.2 Creation des nouvelles tables

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  branch_name TEXT,
  state TEXT,
  owner TEXT,
  started_at TEXT,
  ended_at TEXT,
  source_artifact_path TEXT,
  source_confidence REAL NOT NULL DEFAULT 1.0,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_links (
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_path, target_path, relation_type)
);

CREATE TABLE IF NOT EXISTS cycle_links (
  source_cycle_id TEXT NOT NULL,
  target_cycle_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_cycle_id, target_cycle_id, relation_type)
);

CREATE TABLE IF NOT EXISTS session_cycle_links (
  session_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, cycle_id, relation_type)
);

CREATE TABLE IF NOT EXISTS migration_runs (
  migration_run_id TEXT PRIMARY KEY,
  migration_version TEXT NOT NULL,
  target_root TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  report_json TEXT
);

CREATE TABLE IF NOT EXISTS migration_findings (
  migration_run_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  finding_code TEXT NOT NULL,
  message TEXT NOT NULL,
  repair_applied INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (migration_run_id, entity_type, entity_key, finding_code)
);
```

## 7. Vues recommandees

### 7.1 Vue cycles actifs

```sql
CREATE VIEW IF NOT EXISTS v_active_cycles AS
SELECT *
FROM cycles
WHERE state IN ('OPEN', 'IMPLEMENTING', 'VERIFYING');
```

### 7.2 Vue artefacts normatifs

```sql
CREATE VIEW IF NOT EXISTS v_normative_artifacts AS
SELECT *
FROM artifacts
WHERE family = 'normative';
```

### 7.3 Vue liens forts

```sql
CREATE VIEW IF NOT EXISTS v_strong_links AS
SELECT *
FROM artifact_links
WHERE confidence >= 0.8
  AND source_mode IN ('explicit', 'inferred', 'legacy_repaired');
```

## 8. Regles de remplissage

### `artifacts`

- `cycle_id`
  - explicite si derive du path moderne/legacy sans ambiguite
  - sinon `NULL`
- `session_id`
  - explicite si derive d'un path session
  - sinon `NULL`
- `source_mode`
  - `explicit` si ownership certain
  - `legacy_repaired` si backfill depuis une structure ancienne
  - `ambiguous` si plusieurs candidats

### `sessions`

- creee si un artefact session existe
- completee par parsing canonical/front matter
- `source_artifact_path` obligatoire si creee par inference

### `artifact_links`

- ne jamais stocker un lien sans `relation_type`
- ne jamais monter `confidence=1.0` pour une inference legacy

### `session_cycle_links`

- table canonique pour:
  - cycles attaches a une session
  - cycles actifs dans snapshot
  - cycles inclus baseline

## 9. Reparation legacy minimale

### Cas `cycles/C001/status.md`

- `cycles.cycle_id = C001`
- `artifacts.cycle_id = C001`
- `file_map(cycle_id=C001, path=..., relation='normative')`

### Cas `cycles/C001-modern-sample/status.md`

- meme traitement que ci-dessus

### Cas legacy sans index global

- ne pas reintroduire d'artefact `cycle_status_index`
- les layouts legacy supportes sont les dossiers de type `cycles/C001/`
- la reparation cible directement les artefacts individuels (`status.md`, `plan.md`, `scope.md`)
- la normalisation attendue consiste a converger vers un statut de cycle par dossier

### Cas support artifact dans un dossier cycle

- `artifacts.cycle_id = cycle inferé`
- `artifacts.source_mode = 'inferred'`
- `artifacts.entity_confidence = 0.6`
- `artifact_links(source_path=support, target_path=status, relation_type='supports_cycle', confidence=0.6, source_mode='inferred')`

## 10. Requetes cibles a supporter

Le schema v2 doit rendre simples les requetes suivantes:

1. lister les cycles actifs
2. lister les artefacts normatifs lies a un cycle
3. lister les artefacts de support lies a un cycle
4. retrouver la session la plus probable d'un cycle
5. hydrater les artefacts utiles a partir d'un snapshot ou baseline
6. lister les findings de migration non resolus
7. comparer explicite vs inferé

Exemple:

```sql
SELECT a.path, a.kind, a.family, a.source_mode, a.entity_confidence
FROM artifacts a
WHERE a.cycle_id = 'C002'
ORDER BY a.family DESC, a.path ASC;
```

Exemple:

```sql
SELECT scl.session_id, scl.relation_type, scl.confidence
FROM session_cycle_links scl
WHERE scl.cycle_id = 'C002'
ORDER BY scl.confidence DESC;
```

## 11. Ordre d'implementation recommande

1. `schema.sql` v2
2. migrations idempotentes dans la couche SQLite
3. lecture `readIndexFromSqlite()` compatible v2
4. ecriture enrichie des nouvelles colonnes/tables
5. moteur de migration brut
6. moteur de reparation relationnelle
7. hydrateur contexte par graphe

## 12. Recommandation

Le schema v2 ne doit pas chercher a tout modeliser tout de suite.

Priorites reelles:

1. `sessions`
2. `session_cycle_links`
3. `artifact_links`
4. enrichissement `artifacts.source_mode/entity_confidence/legacy_origin`
5. `migration_runs` / `migration_findings`

Si ces 5 points sont implémentés proprement, `db-only` change réellement de niveau.
