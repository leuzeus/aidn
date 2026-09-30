// All callers hold one PostgreSQL transaction. Runtime writers and reservations
// take the artifacts table lock first, then planning (if used), then scope.
function refuse(code) { const error = new Error(code); error.code = code; throw error; }

export async function lockExecutionScope(client, scopeKey) {
  if (typeof scopeKey !== "string" || !scopeKey) refuse("ARTIFACT_EXECUTION_SCOPE_INVALID");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["aidn.execution.scope", scopeKey])]);
}

export async function lockExecutionPlanning(client, { projectId, workspaceId, planningKey }) {
  if (![projectId, workspaceId, planningKey].every(value => typeof value === "string" && value)) refuse("SHARED_EXECUTION_IDENTITY_INVALID");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["aidn.execution.planning", projectId, workspaceId, planningKey])]);
}

async function hasReservations(client) {
  const found = await client.query("SELECT to_regclass('aidn_shared.execution_runs') AS execution_runs");
  return Boolean(found.rows[0]?.execution_runs);
}

export async function guardCanonicalMutation(client, scopeKey) {
  if (!await hasReservations(client)) return;
  await lockExecutionScope(client, scopeKey);
  const reserved = await client.query("SELECT run_id FROM aidn_shared.execution_runs WHERE runtime_scope_id=$1 AND reservation_active=true", [scopeKey]);
  if (reserved.rows.length) refuse("ARTIFACT_EXECUTION_SCOPE_RESERVED");
}

export async function guardPlanningMutation(client, { projectId, workspaceId, planningKey, expectedRevision = null }) {
  await lockExecutionPlanning(client, { projectId, workspaceId, planningKey });
  if (await hasReservations(client)) {
    const reserved = await client.query("SELECT run_id FROM aidn_shared.execution_runs WHERE project_id=$1 AND workspace_id=$2 AND planning_key=$3 AND reservation_active=true", [projectId, workspaceId, planningKey]);
    if (reserved.rows.length) refuse("SHARED_EXECUTION_SCOPE_RESERVED");
  }
  if (expectedRevision !== null && expectedRevision !== undefined) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) refuse("SHARED_PLANNING_REVISION_INVALID");
    const current = await client.query("SELECT revision FROM aidn_shared.planning_states WHERE project_id=$1 AND workspace_id=$2 AND planning_key=$3 FOR UPDATE", [projectId, workspaceId, planningKey]);
    if (Number(current.rows[0]?.revision ?? 0) !== expectedRevision) refuse("SHARED_PLANNING_REVISION_CONFLICT");
  }
}
