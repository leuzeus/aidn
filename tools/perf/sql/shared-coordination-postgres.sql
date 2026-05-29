CREATE SCHEMA IF NOT EXISTS aidn_shared;

CREATE TABLE IF NOT EXISTS aidn_shared.schema_migrations (
  schema_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT,
  notes TEXT,
  PRIMARY KEY (schema_name, schema_version)
);

CREATE TABLE IF NOT EXISTS aidn_shared.project_registry (
  project_id TEXT PRIMARY KEY,
  project_id_source TEXT NOT NULL,
  project_root_ref TEXT,
  locator_ref TEXT,
  shared_backend_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

ALTER TABLE aidn_shared.workspace_registry
  ADD COLUMN IF NOT EXISTS project_id TEXT;

ALTER TABLE aidn_shared.workspace_registry
  ADD COLUMN IF NOT EXISTS project_id_source TEXT;

ALTER TABLE aidn_shared.workspace_registry
  ADD COLUMN IF NOT EXISTS project_root_ref TEXT;

UPDATE aidn_shared.workspace_registry
SET
  project_id = COALESCE(NULLIF(project_id, ''), workspace_id),
  project_id_source = COALESCE(NULLIF(project_id_source, ''), 'legacy-workspace'),
  project_root_ref = NULLIF(project_root_ref, '')
WHERE project_id IS NULL
   OR project_id = ''
   OR project_id_source IS NULL
   OR project_id_source = '';

INSERT INTO aidn_shared.project_registry (
  project_id,
  project_id_source,
  project_root_ref,
  locator_ref,
  shared_backend_kind,
  updated_at
)
SELECT DISTINCT
  workspace_registry.project_id,
  workspace_registry.project_id_source,
  workspace_registry.project_root_ref,
  workspace_registry.locator_ref,
  workspace_registry.shared_backend_kind,
  NOW()
FROM aidn_shared.workspace_registry
WHERE workspace_registry.project_id IS NOT NULL
  AND workspace_registry.project_id <> ''
ON CONFLICT (project_id) DO UPDATE SET
  project_id_source = EXCLUDED.project_id_source,
  project_root_ref = COALESCE(EXCLUDED.project_root_ref, aidn_shared.project_registry.project_root_ref),
  locator_ref = COALESCE(EXCLUDED.locator_ref, aidn_shared.project_registry.locator_ref),
  shared_backend_kind = EXCLUDED.shared_backend_kind,
  updated_at = NOW();

ALTER TABLE aidn_shared.workspace_registry
  ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE aidn_shared.workspace_registry
  ALTER COLUMN project_id_source SET NOT NULL;

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

ALTER TABLE aidn_shared.worktree_registry
  ADD COLUMN IF NOT EXISTS project_id TEXT;

UPDATE aidn_shared.worktree_registry AS worktree
SET project_id = workspace.project_id
FROM aidn_shared.workspace_registry AS workspace
WHERE worktree.workspace_id = workspace.workspace_id
  AND (worktree.project_id IS NULL OR worktree.project_id = '');

ALTER TABLE aidn_shared.worktree_registry
  ALTER COLUMN project_id SET NOT NULL;

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

ALTER TABLE aidn_shared.planning_states
  ADD COLUMN IF NOT EXISTS project_id TEXT;

UPDATE aidn_shared.planning_states AS planning
SET project_id = workspace.project_id
FROM aidn_shared.workspace_registry AS workspace
WHERE planning.workspace_id = workspace.workspace_id
  AND (planning.project_id IS NULL OR planning.project_id = '');

ALTER TABLE aidn_shared.planning_states
  ALTER COLUMN project_id SET NOT NULL;

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

ALTER TABLE aidn_shared.handoff_relays
  ADD COLUMN IF NOT EXISTS project_id TEXT;

UPDATE aidn_shared.handoff_relays AS relay
SET project_id = workspace.project_id
FROM aidn_shared.workspace_registry AS workspace
WHERE relay.workspace_id = workspace.workspace_id
  AND (relay.project_id IS NULL OR relay.project_id = '');

ALTER TABLE aidn_shared.handoff_relays
  ALTER COLUMN project_id SET NOT NULL;

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

ALTER TABLE aidn_shared.coordination_records
  ADD COLUMN IF NOT EXISTS project_id TEXT;

UPDATE aidn_shared.coordination_records AS record
SET project_id = workspace.project_id
FROM aidn_shared.workspace_registry AS workspace
WHERE record.workspace_id = workspace.workspace_id
  AND (record.project_id IS NULL OR record.project_id = '');

ALTER TABLE aidn_shared.coordination_records
  ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE aidn_shared.worktree_registry
  DROP CONSTRAINT IF EXISTS worktree_registry_workspace_id_fkey;

ALTER TABLE aidn_shared.worktree_registry
  DROP CONSTRAINT IF EXISTS worktree_registry_workspace_fk;

ALTER TABLE aidn_shared.planning_states
  DROP CONSTRAINT IF EXISTS planning_states_workspace_id_fkey;

ALTER TABLE aidn_shared.planning_states
  DROP CONSTRAINT IF EXISTS planning_states_workspace_fk;

ALTER TABLE aidn_shared.handoff_relays
  DROP CONSTRAINT IF EXISTS handoff_relays_workspace_id_fkey;

ALTER TABLE aidn_shared.handoff_relays
  DROP CONSTRAINT IF EXISTS handoff_relays_workspace_fk;

ALTER TABLE aidn_shared.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_workspace_id_fkey;

ALTER TABLE aidn_shared.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_workspace_fk;

ALTER TABLE aidn_shared.workspace_registry
  DROP CONSTRAINT IF EXISTS workspace_registry_project_fk;

ALTER TABLE aidn_shared.worktree_registry
  DROP CONSTRAINT IF EXISTS worktree_registry_pkey;

ALTER TABLE aidn_shared.planning_states
  DROP CONSTRAINT IF EXISTS planning_states_pkey;

ALTER TABLE aidn_shared.handoff_relays
  DROP CONSTRAINT IF EXISTS handoff_relays_pkey;

ALTER TABLE aidn_shared.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_pkey;

ALTER TABLE aidn_shared.workspace_registry
  DROP CONSTRAINT IF EXISTS workspace_registry_pkey;

ALTER TABLE aidn_shared.workspace_registry
  ADD CONSTRAINT workspace_registry_pkey PRIMARY KEY (project_id, workspace_id);

ALTER TABLE aidn_shared.worktree_registry
  ADD CONSTRAINT worktree_registry_pkey PRIMARY KEY (project_id, workspace_id, worktree_id);

ALTER TABLE aidn_shared.planning_states
  ADD CONSTRAINT planning_states_pkey PRIMARY KEY (project_id, workspace_id, planning_key);

ALTER TABLE aidn_shared.handoff_relays
  ADD CONSTRAINT handoff_relays_pkey PRIMARY KEY (project_id, workspace_id, relay_id);

ALTER TABLE aidn_shared.coordination_records
  ADD CONSTRAINT coordination_records_pkey PRIMARY KEY (project_id, workspace_id, record_id);

ALTER TABLE aidn_shared.workspace_registry
  ADD CONSTRAINT workspace_registry_project_fk
  FOREIGN KEY (project_id) REFERENCES aidn_shared.project_registry(project_id) ON DELETE CASCADE;

ALTER TABLE aidn_shared.worktree_registry
  ADD CONSTRAINT worktree_registry_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES aidn_shared.workspace_registry(project_id, workspace_id) ON DELETE CASCADE;

ALTER TABLE aidn_shared.planning_states
  ADD CONSTRAINT planning_states_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES aidn_shared.workspace_registry(project_id, workspace_id) ON DELETE CASCADE;

ALTER TABLE aidn_shared.handoff_relays
  ADD CONSTRAINT handoff_relays_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES aidn_shared.workspace_registry(project_id, workspace_id) ON DELETE CASCADE;

ALTER TABLE aidn_shared.coordination_records
  ADD CONSTRAINT coordination_records_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES aidn_shared.workspace_registry(project_id, workspace_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_aidn_shared_project_updated
  ON aidn_shared.project_registry(project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_aidn_shared_worktree_last_seen
  ON aidn_shared.worktree_registry(project_id, workspace_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_aidn_shared_planning_session
  ON aidn_shared.planning_states(project_id, workspace_id, session_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_aidn_shared_handoff_scope
  ON aidn_shared.handoff_relays(project_id, workspace_id, scope_type, scope_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aidn_shared_coordination_scope
  ON aidn_shared.coordination_records(project_id, workspace_id, record_type, scope_type, scope_id, created_at DESC);
