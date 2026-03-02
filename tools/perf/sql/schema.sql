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
