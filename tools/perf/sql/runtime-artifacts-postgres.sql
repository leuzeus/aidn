CREATE SCHEMA IF NOT EXISTS aidn_runtime;

CREATE TABLE IF NOT EXISTS aidn_runtime.schema_migrations (
  schema_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  applied_by TEXT,
  notes TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (schema_name, schema_version)
);

CREATE TABLE IF NOT EXISTS aidn_runtime.runtime_snapshots (
  scope_key TEXT PRIMARY KEY,
  project_root_ref TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  payload_digest TEXT NOT NULL,
  payload_schema_version INTEGER NOT NULL DEFAULT 1,
  source_backend TEXT NOT NULL DEFAULT 'unknown',
  source_sqlite_file TEXT,
  adoption_status TEXT NOT NULL DEFAULT 'unknown',
  adoption_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runtime_snapshots_digest
  ON aidn_runtime.runtime_snapshots(payload_digest);

CREATE TABLE IF NOT EXISTS aidn_runtime.runtime_heads (
  scope_key TEXT NOT NULL,
  head_key TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  artifact_sha256 TEXT,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_key, head_key)
);

CREATE INDEX IF NOT EXISTS idx_runtime_heads_artifact_path
  ON aidn_runtime.runtime_heads(artifact_path);

CREATE TABLE IF NOT EXISTS aidn_runtime.adoption_events (
  event_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  source_backend TEXT,
  target_backend TEXT NOT NULL,
  source_payload_digest TEXT,
  target_payload_digest TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adoption_events_scope_created
  ON aidn_runtime.adoption_events(scope_key, created_at DESC);
