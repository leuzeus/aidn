-- Explicit additive migration. Existing prepared journals remain immutable.
CREATE TABLE aidn_shared.execution_integration_intents (
  run_id TEXT NOT NULL REFERENCES aidn_shared.execution_runs(run_id),
  integration_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  attempt_id TEXT NOT NULL REFERENCES aidn_shared.execution_acceptances(attempt_id),
  intent_sha256 TEXT NOT NULL,
  intent_json JSONB NOT NULL,
  creator_generation BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  applied_at TIMESTAMPTZ,
  PRIMARY KEY (run_id,integration_id),
  UNIQUE (run_id,sequence), UNIQUE (attempt_id),
  UNIQUE (run_id,integration_id,intent_sha256),
  FOREIGN KEY (run_id,creator_generation) REFERENCES aidn_shared.execution_supervisors(run_id,generation)
);
CREATE UNIQUE INDEX execution_one_pending_intent ON aidn_shared.execution_integration_intents(run_id) WHERE applied_at IS NULL;
ALTER TABLE aidn_shared.execution_integrations
  ADD COLUMN intent_sha256 TEXT,
  ADD CONSTRAINT execution_integration_intent_binding FOREIGN KEY (run_id,integration_id,intent_sha256)
    REFERENCES aidn_shared.execution_integration_intents(run_id,integration_id,intent_sha256);
ALTER TABLE aidn_shared.execution_acceptances
  ADD COLUMN evidence_verification_json JSONB,
  ADD COLUMN evidence_verification_sha256 TEXT;
ALTER TABLE aidn_shared.execution_run_validations
  ADD COLUMN evidence_verification_json JSONB,
  ADD COLUMN evidence_verification_sha256 TEXT;
