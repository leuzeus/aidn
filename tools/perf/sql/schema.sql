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

CREATE TABLE sessions (
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

CREATE TABLE file_map (
  cycle_id TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT,
  relation TEXT NOT NULL DEFAULT 'unknown',
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

CREATE TABLE artifact_links (
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  relation_status TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_path, target_path, relation_type)
);

CREATE TABLE cycle_links (
  source_cycle_id TEXT NOT NULL,
  target_cycle_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  relation_status TEXT NOT NULL DEFAULT 'explicit',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_cycle_id, target_cycle_id, relation_type)
);

CREATE TABLE session_cycle_links (
  session_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  inference_source TEXT,
  source_mode TEXT NOT NULL DEFAULT 'explicit',
  relation_status TEXT NOT NULL DEFAULT 'explicit',
  ambiguity_status TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, cycle_id, relation_type)
);

CREATE TABLE repair_decisions (
  relation_scope TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  decided_by TEXT,
  notes TEXT,
  PRIMARY KEY (relation_scope, source_ref, target_ref, relation_type)
);

CREATE TABLE migration_runs (
  migration_run_id TEXT PRIMARY KEY,
  engine_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  target_root TEXT,
  notes TEXT
);

CREATE TABLE migration_findings (
  finding_id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_run_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  artifact_path TEXT,
  message TEXT NOT NULL,
  confidence REAL,
  suggested_action TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (migration_run_id) REFERENCES migration_runs(migration_run_id)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_cycle_id ON artifacts(cycle_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_artifact_links_target ON artifact_links(target_path, relation_type);
CREATE INDEX IF NOT EXISTS idx_cycle_links_target ON cycle_links(target_cycle_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_session_cycle_links_cycle ON session_cycle_links(cycle_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_migration_findings_run ON migration_findings(migration_run_id);
CREATE INDEX IF NOT EXISTS idx_repair_decisions_scope ON repair_decisions(relation_scope, decision);
