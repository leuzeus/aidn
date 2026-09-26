-- Additive supervision metadata only. Run through explicit locked migration.
CREATE TABLE aidn_shared.execution_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  runtime_scope_id TEXT NOT NULL,
  planning_key TEXT NOT NULL,
  planning_revision BIGINT NOT NULL CHECK (planning_revision > 0),
  plan_sha256 TEXT NOT NULL,
  canonical_snapshot_sha256 TEXT NOT NULL,
  plan_json JSONB NOT NULL,
  run_json JSONB NOT NULL,
  recovery_reason TEXT,
  reservation_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (project_id, workspace_id, planning_key)
    REFERENCES aidn_shared.planning_states(project_id, workspace_id, planning_key)
);
CREATE UNIQUE INDEX execution_one_reserved_scope ON aidn_shared.execution_runs(runtime_scope_id) WHERE reservation_active;
CREATE UNIQUE INDEX execution_one_reserved_plan ON aidn_shared.execution_runs(project_id, workspace_id, planning_key) WHERE reservation_active;

CREATE TABLE aidn_shared.execution_tasks (
  run_id TEXT NOT NULL REFERENCES aidn_shared.execution_runs(run_id),
  task_id TEXT NOT NULL,
  task_json JSONB NOT NULL,
  next_ordinal BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, task_id)
);

CREATE TABLE aidn_shared.execution_attempts (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ordinal BIGINT NOT NULL CHECK (ordinal > 0),
  owner_id TEXT NOT NULL,
  generation BIGINT NOT NULL CHECK (generation > 0),
  lease_id TEXT NOT NULL UNIQUE,
  lease_until TIMESTAMPTZ NOT NULL,
  attempt_json JSONB NOT NULL,
  delegation_json JSONB NOT NULL,
  request_json JSONB,
  runner_json JSONB,
  result_json JSONB,
  termination_json JSONB,
  reconciliation_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id, task_id) REFERENCES aidn_shared.execution_tasks(run_id, task_id),
  UNIQUE (run_id, task_id, ordinal)
);

CREATE TABLE aidn_shared.execution_events (
  attempt_id TEXT NOT NULL REFERENCES aidn_shared.execution_attempts(attempt_id),
  event_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  payload_sha256 TEXT NOT NULL,
  event_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (attempt_id, event_id),
  UNIQUE (attempt_id, sequence)
);
