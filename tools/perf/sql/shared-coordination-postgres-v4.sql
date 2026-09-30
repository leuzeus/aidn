-- Explicit additive migration. Historical trials remain unsupervised.
ALTER TABLE aidn_shared.execution_runs
  ADD COLUMN supervision_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (supervision_mode IN ('legacy','supervised')),
  ADD COLUMN control_revision BIGINT NOT NULL DEFAULT 0 CHECK (control_revision >= 0),
  ADD COLUMN supervisor_generation BIGINT NOT NULL DEFAULT 0 CHECK (supervisor_generation >= 0),
  ADD COLUMN integration_head_json JSONB,
  ADD COLUMN run_started_at TIMESTAMPTZ,
  ADD COLUMN run_deadline_at TIMESTAMPTZ;
ALTER TABLE aidn_shared.execution_attempts ADD COLUMN preparation_json JSONB, ADD COLUMN dependency_binding_json JSONB;
CREATE TABLE aidn_shared.execution_supervisors (
  run_id TEXT NOT NULL REFERENCES aidn_shared.execution_runs(run_id),
  generation BIGINT NOT NULL CHECK (generation > 0),
  lease_id TEXT NOT NULL UNIQUE,
  lease_until TIMESTAMPTZ NOT NULL,
  supervisor_json JSONB NOT NULL,
  termination_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id,generation)
);
CREATE TABLE aidn_shared.execution_acceptances (
  attempt_id TEXT PRIMARY KEY REFERENCES aidn_shared.execution_attempts(attempt_id),
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  acceptance_sha256 TEXT NOT NULL,
  acceptance_json JSONB NOT NULL,
  supervisor_generation BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id,task_id) REFERENCES aidn_shared.execution_tasks(run_id,task_id),
  FOREIGN KEY (run_id,supervisor_generation) REFERENCES aidn_shared.execution_supervisors(run_id,generation)
);
CREATE UNIQUE INDEX execution_one_accepted_task ON aidn_shared.execution_acceptances(run_id,task_id) WHERE acceptance_json->>'decision'='accepted';
CREATE TABLE aidn_shared.execution_integrations (
  run_id TEXT NOT NULL REFERENCES aidn_shared.execution_runs(run_id),
  integration_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  attempt_id TEXT NOT NULL REFERENCES aidn_shared.execution_acceptances(attempt_id),
  prepared_sha256 TEXT NOT NULL,
  prepared_json JSONB NOT NULL,
  applied_sha256 TEXT,
  applied_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  applied_at TIMESTAMPTZ,
  PRIMARY KEY (run_id,integration_id),
  UNIQUE (run_id,sequence), UNIQUE (attempt_id)
);
CREATE UNIQUE INDEX execution_one_pending_integration ON aidn_shared.execution_integrations(run_id) WHERE applied_json IS NULL;
CREATE TABLE aidn_shared.execution_run_validations (
  run_id TEXT PRIMARY KEY REFERENCES aidn_shared.execution_runs(run_id),
  validation_sha256 TEXT NOT NULL,
  validation_json JSONB NOT NULL,
  supervisor_generation BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id,supervisor_generation) REFERENCES aidn_shared.execution_supervisors(run_id,generation)
);
