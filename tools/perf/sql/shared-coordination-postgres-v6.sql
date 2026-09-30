-- Explicit lifecycle metadata only; no filesystem cleanup or implicit migration.
CREATE TABLE aidn_shared.execution_cancel_requests (
  run_id TEXT PRIMARY KEY REFERENCES aidn_shared.execution_runs(run_id),
  request_id TEXT NOT NULL UNIQUE,
  request_sha256 TEXT NOT NULL,
  request_json JSONB NOT NULL,
  target_supervisor_generation BIGINT NOT NULL CHECK (target_supervisor_generation >= 0),
  accepted_control_revision BIGINT NOT NULL CHECK (accepted_control_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE aidn_shared.execution_cleanup_operations (
  run_id TEXT NOT NULL REFERENCES aidn_shared.execution_runs(run_id),
  cleanup_id TEXT NOT NULL,
  generation BIGINT NOT NULL CHECK (generation > 0),
  cleanup_sha256 TEXT NOT NULL,
  cleanup_json JSONB NOT NULL,
  ownership_json JSONB NOT NULL,
  runner_json JSONB NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','stopped','completed')),
  termination_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id,cleanup_id,generation)
);
CREATE UNIQUE INDEX execution_one_active_cleanup ON aidn_shared.execution_cleanup_operations(run_id) WHERE status='active';
CREATE TABLE aidn_shared.execution_cleanup_resources (
  run_id TEXT NOT NULL,
  cleanup_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  creator_generation BIGINT NOT NULL CHECK (creator_generation > 0),
  resource_json JSONB NOT NULL,
  resource_sha256 TEXT NOT NULL,
  result_json JSONB,
  result_sha256 TEXT,
  result_generation BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (run_id,cleanup_id,resource_id),
  FOREIGN KEY (run_id,cleanup_id,creator_generation) REFERENCES aidn_shared.execution_cleanup_operations(run_id,cleanup_id,generation),
  FOREIGN KEY (run_id,cleanup_id,result_generation) REFERENCES aidn_shared.execution_cleanup_operations(run_id,cleanup_id,generation)
);
