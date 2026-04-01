CREATE SCHEMA IF NOT EXISTS aidn_shared;

CREATE TABLE IF NOT EXISTS aidn_shared.schema_migrations (
  schema_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT,
  notes TEXT,
  PRIMARY KEY (schema_name, schema_version)
);

CREATE TABLE IF NOT EXISTS aidn_shared.workspace_registry (
  workspace_id TEXT PRIMARY KEY,
  workspace_id_source TEXT NOT NULL,
  locator_ref TEXT,
  git_common_dir TEXT,
  repo_root TEXT,
  shared_backend_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aidn_shared.worktree_registry (
  workspace_id TEXT NOT NULL REFERENCES aidn_shared.workspace_registry(workspace_id) ON DELETE CASCADE,
  worktree_id TEXT NOT NULL,
  worktree_root TEXT,
  git_dir TEXT,
  is_linked_worktree BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, worktree_id)
);

CREATE TABLE IF NOT EXISTS aidn_shared.planning_states (
  workspace_id TEXT NOT NULL REFERENCES aidn_shared.workspace_registry(workspace_id) ON DELETE CASCADE,
  planning_key TEXT NOT NULL,
  session_id TEXT,
  backlog_artifact_ref TEXT,
  backlog_artifact_sha256 TEXT,
  planning_status TEXT NOT NULL,
  planning_arbitration_status TEXT NOT NULL DEFAULT 'none',
  next_dispatch_scope TEXT NOT NULL DEFAULT 'none',
  next_dispatch_action TEXT NOT NULL DEFAULT 'none',
  backlog_next_step TEXT NOT NULL DEFAULT 'unknown',
  selected_execution_scope TEXT NOT NULL DEFAULT 'none',
  dispatch_ready BOOLEAN NOT NULL DEFAULT FALSE,
  source_worktree_id TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, planning_key)
);

CREATE TABLE IF NOT EXISTS aidn_shared.handoff_relays (
  workspace_id TEXT NOT NULL REFERENCES aidn_shared.workspace_registry(workspace_id) ON DELETE CASCADE,
  relay_id TEXT NOT NULL,
  session_id TEXT,
  cycle_id TEXT,
  scope_type TEXT NOT NULL DEFAULT 'none',
  scope_id TEXT NOT NULL DEFAULT 'none',
  source_worktree_id TEXT,
  handoff_status TEXT NOT NULL,
  from_agent_role TEXT NOT NULL,
  from_agent_action TEXT NOT NULL,
  recommended_next_agent_role TEXT NOT NULL,
  recommended_next_agent_action TEXT NOT NULL,
  handoff_packet_ref TEXT,
  handoff_packet_sha256 TEXT,
  prioritized_artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, relay_id)
);

CREATE TABLE IF NOT EXISTS aidn_shared.coordination_records (
  workspace_id TEXT NOT NULL REFERENCES aidn_shared.workspace_registry(workspace_id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  session_id TEXT,
  cycle_id TEXT,
  scope_type TEXT NOT NULL DEFAULT 'none',
  scope_id TEXT NOT NULL DEFAULT 'none',
  source_worktree_id TEXT,
  actor_role TEXT,
  actor_action TEXT,
  status TEXT NOT NULL,
  coordination_log_ref TEXT,
  coordination_summary_ref TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_aidn_shared_worktree_last_seen
  ON aidn_shared.worktree_registry(workspace_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_aidn_shared_planning_session
  ON aidn_shared.planning_states(workspace_id, session_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_aidn_shared_handoff_scope
  ON aidn_shared.handoff_relays(workspace_id, scope_type, scope_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aidn_shared_coordination_scope
  ON aidn_shared.coordination_records(workspace_id, record_type, scope_type, scope_id, created_at DESC);
