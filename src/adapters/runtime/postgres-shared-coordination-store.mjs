import fs from "node:fs";
import { assertSharedCoordinationStore } from "../../core/ports/shared-coordination-store-port.mjs";
import {
  POSTGRES_SHARED_COORDINATION_SCHEMA_NAME,
  POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION,
  getPostgresSharedCoordinationContract,
  getPostgresSharedCoordinationSchemaFile,
  listPostgresSharedCoordinationTableNames,
} from "../../application/runtime/postgres-shared-coordination-contract-service.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function resolveProjectId(projectId, workspaceId, runtimeWorkspace = null) {
  return normalizeScalar(projectId)
    || normalizeScalar(runtimeWorkspace?.project_id)
    || normalizeScalar(workspaceId);
}

function toJsonValue(value, fallback) {
  if (value == null) {
    return JSON.stringify(fallback);
  }
  return JSON.stringify(value);
}

function parseJsonValue(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

async function loadPgModule(moduleLoader) {
  if (typeof moduleLoader === "function") {
    return moduleLoader("pg");
  }
  return import("pg");
}

async function createPgClient({
  connectionString,
  clientFactory = null,
  moduleLoader = null,
}) {
  if (typeof clientFactory === "function") {
    return clientFactory({
      connectionString,
    });
  }
  const pgModule = await loadPgModule(moduleLoader);
  const Client = pgModule?.Client ?? pgModule?.default?.Client;
  if (typeof Client !== "function") {
    throw new Error("The pg package does not expose a Client constructor");
  }
  return new Client({
    connectionString,
  });
}

export function classifyPostgresSharedCoordinationError(error) {
  const code = normalizeScalar(error?.code);
  const message = normalizeScalar(error?.message || error);

  if (message.includes("Cannot find package 'pg'") || message.includes("Cannot find module 'pg'")) {
    return {
      category: "driver-missing",
      code,
      message,
    };
  }
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(code)) {
    return {
      category: "connectivity",
      code,
      message,
    };
  }
  if (code === "23505") {
    return {
      category: "conflict",
      code,
      message,
    };
  }
  if (code.startsWith("28")) {
    return {
      category: "authentication",
      code,
      message,
    };
  }
  if (code.startsWith("42")) {
    return {
      category: "schema",
      code,
      message,
    };
  }
  if (message.toLowerCase().includes("connect")) {
    return {
      category: "connectivity",
      code,
      message,
    };
  }
  return {
    category: "unknown",
    code,
    message,
  };
}

function mapFailure(operation, error) {
  return {
    ok: false,
    operation,
    error: classifyPostgresSharedCoordinationError(error),
  };
}

async function withClient(runtime, fn) {
  const client = await createPgClient(runtime);
  let connected = false;
  try {
    if (typeof client.connect === "function") {
      await client.connect();
      connected = true;
    }
    return await fn(client);
  } finally {
    if (connected && typeof client.end === "function") {
      await client.end();
    }
  }
}

function mapPlanningRow(row) {
  if (!row) {
    return null;
  }
  return {
    project_id: normalizeScalar(row.project_id),
    workspace_id: normalizeScalar(row.workspace_id),
    planning_key: normalizeScalar(row.planning_key),
    session_id: normalizeScalar(row.session_id) || "none",
    backlog_artifact_ref: normalizeScalar(row.backlog_artifact_ref) || "none",
    backlog_artifact_sha256: normalizeScalar(row.backlog_artifact_sha256) || "",
    planning_status: normalizeScalar(row.planning_status) || "unknown",
    planning_arbitration_status: normalizeScalar(row.planning_arbitration_status) || "none",
    next_dispatch_scope: normalizeScalar(row.next_dispatch_scope) || "none",
    next_dispatch_action: normalizeScalar(row.next_dispatch_action) || "none",
    backlog_next_step: normalizeScalar(row.backlog_next_step) || "unknown",
    selected_execution_scope: normalizeScalar(row.selected_execution_scope) || "none",
    dispatch_ready: Boolean(row.dispatch_ready),
    source_worktree_id: normalizeScalar(row.source_worktree_id) || "none",
    revision: Number(row.revision ?? 0),
    payload: parseJsonValue(row.payload_json, {}),
    created_at: normalizeScalar(row.created_at),
    updated_at: normalizeScalar(row.updated_at),
  };
}

function mapHandoffRow(row) {
  if (!row) {
    return null;
  }
  return {
    project_id: normalizeScalar(row.project_id),
    workspace_id: normalizeScalar(row.workspace_id),
    relay_id: normalizeScalar(row.relay_id),
    session_id: normalizeScalar(row.session_id) || "none",
    cycle_id: normalizeScalar(row.cycle_id) || "none",
    scope_type: normalizeScalar(row.scope_type) || "none",
    scope_id: normalizeScalar(row.scope_id) || "none",
    source_worktree_id: normalizeScalar(row.source_worktree_id) || "none",
    handoff_status: normalizeScalar(row.handoff_status) || "unknown",
    from_agent_role: normalizeScalar(row.from_agent_role) || "unknown",
    from_agent_action: normalizeScalar(row.from_agent_action) || "unknown",
    recommended_next_agent_role: normalizeScalar(row.recommended_next_agent_role) || "unknown",
    recommended_next_agent_action: normalizeScalar(row.recommended_next_agent_action) || "unknown",
    handoff_packet_ref: normalizeScalar(row.handoff_packet_ref) || "none",
    handoff_packet_sha256: normalizeScalar(row.handoff_packet_sha256) || "",
    prioritized_artifacts: parseJsonValue(row.prioritized_artifacts, []),
    metadata: parseJsonValue(row.metadata_json, {}),
    created_at: normalizeScalar(row.created_at),
  };
}

function mapCoordinationRow(row) {
  if (!row) {
    return null;
  }
  return {
    project_id: normalizeScalar(row.project_id),
    workspace_id: normalizeScalar(row.workspace_id),
    record_id: normalizeScalar(row.record_id),
    record_type: normalizeScalar(row.record_type) || "unknown",
    session_id: normalizeScalar(row.session_id) || "none",
    cycle_id: normalizeScalar(row.cycle_id) || "none",
    scope_type: normalizeScalar(row.scope_type) || "none",
    scope_id: normalizeScalar(row.scope_id) || "none",
    source_worktree_id: normalizeScalar(row.source_worktree_id) || "none",
    actor_role: normalizeScalar(row.actor_role) || "unknown",
    actor_action: normalizeScalar(row.actor_action) || "unknown",
    status: normalizeScalar(row.status) || "unknown",
    coordination_log_ref: normalizeScalar(row.coordination_log_ref) || "none",
    coordination_summary_ref: normalizeScalar(row.coordination_summary_ref) || "none",
    payload: parseJsonValue(row.payload_json, {}),
    created_at: normalizeScalar(row.created_at),
  };
}

function mapProjectRegistryRow(row) {
  if (!row) {
    return null;
  }
  return {
    project_id: normalizeScalar(row.project_id),
    project_id_source: normalizeScalar(row.project_id_source) || "unknown",
    project_root_ref: normalizeScalar(row.project_root_ref) || "none",
    locator_ref: normalizeScalar(row.locator_ref) || "none",
    shared_backend_kind: normalizeScalar(row.shared_backend_kind) || "unknown",
    workspace_count: Number(row.workspace_count ?? 0) || 0,
    worktree_count: Number(row.worktree_count ?? 0) || 0,
    planning_state_count: Number(row.planning_state_count ?? 0) || 0,
    handoff_relay_count: Number(row.handoff_relay_count ?? 0) || 0,
    coordination_record_count: Number(row.coordination_record_count ?? 0) || 0,
    updated_at: normalizeScalar(row.updated_at),
  };
}

function mapWorkspaceRegistryRow(row) {
  if (!row) {
    return null;
  }
  return {
    project_id: normalizeScalar(row.project_id),
    workspace_id: normalizeScalar(row.workspace_id),
    workspace_id_source: normalizeScalar(row.workspace_id_source) || "unknown",
    project_id_source: normalizeScalar(row.project_id_source) || "unknown",
    project_root_ref: normalizeScalar(row.project_root_ref) || "none",
    locator_ref: normalizeScalar(row.locator_ref) || "none",
    git_common_dir: normalizeScalar(row.git_common_dir) || "none",
    repo_root: normalizeScalar(row.repo_root) || "none",
    shared_backend_kind: normalizeScalar(row.shared_backend_kind) || "unknown",
    updated_at: normalizeScalar(row.updated_at),
  };
}

async function queryLegacyProjectList(client) {
  const queryResult = await client.query(
    `
    SELECT
      wr.workspace_id AS project_id,
      'legacy-workspace' AS project_id_source,
      wr.repo_root AS project_root_ref,
      wr.locator_ref,
      wr.shared_backend_kind,
      wr.updated_at,
      1::int AS workspace_count,
      (
        SELECT COUNT(*)::int
        FROM aidn_shared.worktree_registry wt
        WHERE wt.workspace_id = wr.workspace_id
      ) AS worktree_count,
      (
        SELECT COUNT(*)::int
        FROM aidn_shared.planning_states ps
        WHERE ps.workspace_id = wr.workspace_id
      ) AS planning_state_count,
      (
        SELECT COUNT(*)::int
        FROM aidn_shared.handoff_relays hr
        WHERE hr.workspace_id = wr.workspace_id
      ) AS handoff_relay_count,
      (
        SELECT COUNT(*)::int
        FROM aidn_shared.coordination_records cr
        WHERE cr.workspace_id = wr.workspace_id
      ) AS coordination_record_count
    FROM aidn_shared.workspace_registry wr
    ORDER BY wr.workspace_id ASC
    `,
  );
  return Array.isArray(queryResult.rows) ? queryResult.rows.map((row) => mapProjectRegistryRow(row)) : [];
}

async function queryLegacyProjectInspect(client, resolvedProjectId) {
  const projectResult = await client.query(
    `
    SELECT
      wr.workspace_id AS project_id,
      'legacy-workspace' AS project_id_source,
      wr.repo_root AS project_root_ref,
      wr.locator_ref,
      wr.shared_backend_kind,
      wr.updated_at,
      1::int AS workspace_count,
      (
        SELECT COUNT(*)::int
        FROM aidn_shared.worktree_registry wt
        WHERE wt.workspace_id = wr.workspace_id
      ) AS worktree_count,
      (
        SELECT COUNT(*)::int
        FROM aidn_shared.planning_states ps
        WHERE ps.workspace_id = wr.workspace_id
      ) AS planning_state_count,
      (
        SELECT COUNT(*)::int
        FROM aidn_shared.handoff_relays hr
        WHERE hr.workspace_id = wr.workspace_id
      ) AS handoff_relay_count,
      (
        SELECT COUNT(*)::int
        FROM aidn_shared.coordination_records cr
        WHERE cr.workspace_id = wr.workspace_id
      ) AS coordination_record_count
    FROM aidn_shared.workspace_registry wr
    WHERE wr.workspace_id = $1
    LIMIT 1
    `,
    [resolvedProjectId],
  );
  const workspaceResult = await client.query(
    `
    SELECT
      wr.workspace_id AS project_id,
      'legacy-workspace' AS project_id_source,
      wr.repo_root AS project_root_ref,
      wr.workspace_id,
      wr.workspace_id_source,
      wr.locator_ref,
      wr.git_common_dir,
      wr.repo_root,
      wr.shared_backend_kind,
      wr.updated_at
    FROM aidn_shared.workspace_registry wr
    WHERE wr.workspace_id = $1
    ORDER BY wr.workspace_id ASC
    `,
    [resolvedProjectId],
  );
  return {
    project: mapProjectRegistryRow(projectResult.rows[0] ?? null),
    workspaces: Array.isArray(workspaceResult.rows) ? workspaceResult.rows.map((row) => mapWorkspaceRegistryRow(row)) : [],
  };
}

export function createPostgresSharedCoordinationStore({
  connectionString,
  connectionRef = "",
  workspace = null,
  env = process.env,
  clientFactory = null,
  moduleLoader = null,
} = {}) {
  const runtime = {
    connectionString: normalizeScalar(connectionString),
    connectionRef: normalizeScalar(connectionRef || workspace?.shared_runtime_connection_ref),
    workspace,
    env,
    clientFactory,
    moduleLoader,
  };
  const schemaSql = fs.readFileSync(getPostgresSharedCoordinationSchemaFile(), "utf8");

  const store = {
    describeContract() {
      return getPostgresSharedCoordinationContract({
        workspace: runtime.workspace,
        env: runtime.env,
        connectionString: runtime.connectionString,
        connectionRef: runtime.connectionRef,
      });
    },

    async bootstrap() {
      try {
        const result = await withClient(runtime, async (client) => {
          await client.query("BEGIN");
          try {
            await client.query(schemaSql);
            await client.query(
              `
              INSERT INTO aidn_shared.schema_migrations (
                schema_name,
                schema_version,
                applied_by,
                notes
              ) VALUES ($1, $2, $3, $4)
              ON CONFLICT (schema_name, schema_version) DO NOTHING
              `,
              [
                POSTGRES_SHARED_COORDINATION_SCHEMA_NAME,
                POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION,
                "aidn",
                "shared coordination bootstrap",
              ],
            );
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
          return {
            ok: true,
            schema_name: POSTGRES_SHARED_COORDINATION_SCHEMA_NAME,
            schema_version: POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION,
          };
        });
        return {
          operation: "bootstrap",
          ...result,
        };
      } catch (error) {
        return mapFailure("bootstrap", error);
      }
    },

    async registerWorkspace({
      projectId = "",
      projectIdSource = "",
      projectRootRef = "",
      workspaceId,
      workspaceIdSource = "",
      locatorRef = "",
      gitCommonDir = "",
      repoRoot = "",
      sharedBackendKind = "postgres",
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = resolveProjectId(projectId, workspaceId, runtime.workspace);
          const resolvedProjectIdSource = normalizeScalar(projectIdSource)
            || normalizeScalar(runtime.workspace?.project_id_source)
            || "legacy-workspace";
          await client.query(
            `
            INSERT INTO aidn_shared.project_registry (
              project_id,
              project_id_source,
              project_root_ref,
              locator_ref,
              shared_backend_kind,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (project_id) DO UPDATE SET
              project_id_source = EXCLUDED.project_id_source,
              project_root_ref = EXCLUDED.project_root_ref,
              locator_ref = EXCLUDED.locator_ref,
              shared_backend_kind = EXCLUDED.shared_backend_kind,
              updated_at = NOW()
            `,
            [
              resolvedProjectId,
              resolvedProjectIdSource,
              normalizeScalar(projectRootRef || runtime.workspace?.project_root) || null,
              normalizeScalar(locatorRef) || null,
              normalizeScalar(sharedBackendKind) || "postgres",
            ],
          );
          const queryResult = await client.query(
            `
            INSERT INTO aidn_shared.workspace_registry (
              project_id,
              project_id_source,
              project_root_ref,
              workspace_id,
              workspace_id_source,
              locator_ref,
              git_common_dir,
              repo_root,
              shared_backend_kind,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (project_id, workspace_id) DO UPDATE SET
              project_id_source = EXCLUDED.project_id_source,
              project_root_ref = EXCLUDED.project_root_ref,
              workspace_id_source = EXCLUDED.workspace_id_source,
              locator_ref = EXCLUDED.locator_ref,
              git_common_dir = EXCLUDED.git_common_dir,
              repo_root = EXCLUDED.repo_root,
              shared_backend_kind = EXCLUDED.shared_backend_kind,
              updated_at = NOW()
            RETURNING project_id, project_id_source, project_root_ref, workspace_id, workspace_id_source, locator_ref, git_common_dir, repo_root, shared_backend_kind
            `,
            [
              resolvedProjectId,
              resolvedProjectIdSource,
              normalizeScalar(projectRootRef || runtime.workspace?.project_root) || null,
              normalizeScalar(workspaceId),
              normalizeScalar(workspaceIdSource) || "unknown",
              normalizeScalar(locatorRef) || null,
              normalizeScalar(gitCommonDir) || null,
              normalizeScalar(repoRoot) || null,
              normalizeScalar(sharedBackendKind) || "postgres",
            ],
          );
          return {
            ok: true,
            workspace: queryResult.rows[0] ?? null,
          };
        });
        return {
          operation: "registerWorkspace",
          ...result,
        };
      } catch (error) {
        return mapFailure("registerWorkspace", error);
      }
    },

    async registerWorktreeHeartbeat({
      projectId = "",
      workspaceId,
      worktreeId,
      worktreeRoot = "",
      gitDir = "",
      isLinkedWorktree = false,
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = resolveProjectId(projectId, workspaceId, runtime.workspace);
          const queryResult = await client.query(
            `
            INSERT INTO aidn_shared.worktree_registry (
              project_id,
              workspace_id,
              worktree_id,
              worktree_root,
              git_dir,
              is_linked_worktree,
              last_seen_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (project_id, workspace_id, worktree_id) DO UPDATE SET
              worktree_root = EXCLUDED.worktree_root,
              git_dir = EXCLUDED.git_dir,
              is_linked_worktree = EXCLUDED.is_linked_worktree,
              last_seen_at = NOW()
            RETURNING project_id, workspace_id, worktree_id, worktree_root, git_dir, is_linked_worktree, last_seen_at
            `,
            [
              resolvedProjectId,
              normalizeScalar(workspaceId),
              normalizeScalar(worktreeId),
              normalizeScalar(worktreeRoot) || null,
              normalizeScalar(gitDir) || null,
              Boolean(isLinkedWorktree),
            ],
          );
          return {
            ok: true,
            worktree: queryResult.rows[0] ?? null,
          };
        });
        return {
          operation: "registerWorktreeHeartbeat",
          ...result,
        };
      } catch (error) {
        return mapFailure("registerWorktreeHeartbeat", error);
      }
    },

    async upsertPlanningState({
      projectId = "",
      workspaceId,
      planningKey,
      sessionId = "",
      backlogArtifactRef = "",
      backlogArtifactSha256 = "",
      planningStatus = "unknown",
      planningArbitrationStatus = "none",
      nextDispatchScope = "none",
      nextDispatchAction = "none",
      backlogNextStep = "unknown",
      selectedExecutionScope = "none",
      dispatchReady = false,
      sourceWorktreeId = "",
      payload = {},
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = resolveProjectId(projectId, workspaceId, runtime.workspace);
          const queryResult = await client.query(
            `
            INSERT INTO aidn_shared.planning_states (
              project_id,
              workspace_id,
              planning_key,
              session_id,
              backlog_artifact_ref,
              backlog_artifact_sha256,
              planning_status,
              planning_arbitration_status,
              next_dispatch_scope,
              next_dispatch_action,
              backlog_next_step,
              selected_execution_scope,
              dispatch_ready,
              source_worktree_id,
              payload_json,
              revision,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, 0, NOW())
            ON CONFLICT (project_id, workspace_id, planning_key) DO UPDATE SET
              session_id = EXCLUDED.session_id,
              backlog_artifact_ref = EXCLUDED.backlog_artifact_ref,
              backlog_artifact_sha256 = EXCLUDED.backlog_artifact_sha256,
              planning_status = EXCLUDED.planning_status,
              planning_arbitration_status = EXCLUDED.planning_arbitration_status,
              next_dispatch_scope = EXCLUDED.next_dispatch_scope,
              next_dispatch_action = EXCLUDED.next_dispatch_action,
              backlog_next_step = EXCLUDED.backlog_next_step,
              selected_execution_scope = EXCLUDED.selected_execution_scope,
              dispatch_ready = EXCLUDED.dispatch_ready,
              source_worktree_id = EXCLUDED.source_worktree_id,
              payload_json = EXCLUDED.payload_json,
              revision = aidn_shared.planning_states.revision + 1,
              updated_at = NOW()
            RETURNING *
            `,
            [
              resolvedProjectId,
              normalizeScalar(workspaceId),
              normalizeScalar(planningKey),
              normalizeScalar(sessionId) || null,
              normalizeScalar(backlogArtifactRef) || null,
              normalizeScalar(backlogArtifactSha256) || null,
              normalizeScalar(planningStatus) || "unknown",
              normalizeScalar(planningArbitrationStatus) || "none",
              normalizeScalar(nextDispatchScope) || "none",
              normalizeScalar(nextDispatchAction) || "none",
              normalizeScalar(backlogNextStep) || "unknown",
              normalizeScalar(selectedExecutionScope) || "none",
              Boolean(dispatchReady),
              normalizeScalar(sourceWorktreeId) || null,
              toJsonValue(payload, {}),
            ],
          );
          return {
            ok: true,
            planning_state: mapPlanningRow(queryResult.rows[0]),
          };
        });
        return {
          operation: "upsertPlanningState",
          ...result,
        };
      } catch (error) {
        return mapFailure("upsertPlanningState", error);
      }
    },

    async appendHandoffRelay({
      projectId = "",
      workspaceId,
      relayId,
      sessionId = "",
      cycleId = "",
      scopeType = "none",
      scopeId = "none",
      sourceWorktreeId = "",
      handoffStatus = "unknown",
      fromAgentRole = "unknown",
      fromAgentAction = "unknown",
      recommendedNextAgentRole = "unknown",
      recommendedNextAgentAction = "unknown",
      handoffPacketRef = "",
      handoffPacketSha256 = "",
      prioritizedArtifacts = [],
      metadata = {},
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = resolveProjectId(projectId, workspaceId, runtime.workspace);
          const queryResult = await client.query(
            `
            INSERT INTO aidn_shared.handoff_relays (
              project_id,
              workspace_id,
              relay_id,
              session_id,
              cycle_id,
              scope_type,
              scope_id,
              source_worktree_id,
              handoff_status,
              from_agent_role,
              from_agent_action,
              recommended_next_agent_role,
              recommended_next_agent_action,
              handoff_packet_ref,
              handoff_packet_sha256,
              prioritized_artifacts,
              metadata_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)
            ON CONFLICT (project_id, workspace_id, relay_id) DO UPDATE SET
              session_id = EXCLUDED.session_id,
              cycle_id = EXCLUDED.cycle_id,
              scope_type = EXCLUDED.scope_type,
              scope_id = EXCLUDED.scope_id,
              source_worktree_id = EXCLUDED.source_worktree_id,
              handoff_status = EXCLUDED.handoff_status,
              from_agent_role = EXCLUDED.from_agent_role,
              from_agent_action = EXCLUDED.from_agent_action,
              recommended_next_agent_role = EXCLUDED.recommended_next_agent_role,
              recommended_next_agent_action = EXCLUDED.recommended_next_agent_action,
              handoff_packet_ref = EXCLUDED.handoff_packet_ref,
              handoff_packet_sha256 = EXCLUDED.handoff_packet_sha256,
              prioritized_artifacts = EXCLUDED.prioritized_artifacts,
              metadata_json = EXCLUDED.metadata_json
            RETURNING *
            `,
            [
              resolvedProjectId,
              normalizeScalar(workspaceId),
              normalizeScalar(relayId),
              normalizeScalar(sessionId) || null,
              normalizeScalar(cycleId) || null,
              normalizeScalar(scopeType) || "none",
              normalizeScalar(scopeId) || "none",
              normalizeScalar(sourceWorktreeId) || null,
              normalizeScalar(handoffStatus) || "unknown",
              normalizeScalar(fromAgentRole) || "unknown",
              normalizeScalar(fromAgentAction) || "unknown",
              normalizeScalar(recommendedNextAgentRole) || "unknown",
              normalizeScalar(recommendedNextAgentAction) || "unknown",
              normalizeScalar(handoffPacketRef) || null,
              normalizeScalar(handoffPacketSha256) || null,
              toJsonValue(prioritizedArtifacts, []),
              toJsonValue(metadata, {}),
            ],
          );
          return {
            ok: true,
            handoff_relay: mapHandoffRow(queryResult.rows[0]),
          };
        });
        return {
          operation: "appendHandoffRelay",
          ...result,
        };
      } catch (error) {
        return mapFailure("appendHandoffRelay", error);
      }
    },

    async appendCoordinationRecord({
      projectId = "",
      workspaceId,
      recordId,
      recordType,
      sessionId = "",
      cycleId = "",
      scopeType = "none",
      scopeId = "none",
      sourceWorktreeId = "",
      actorRole = "",
      actorAction = "",
      status = "unknown",
      coordinationLogRef = "",
      coordinationSummaryRef = "",
      payload = {},
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = resolveProjectId(projectId, workspaceId, runtime.workspace);
          const queryResult = await client.query(
            `
            INSERT INTO aidn_shared.coordination_records (
              project_id,
              workspace_id,
              record_id,
              record_type,
              session_id,
              cycle_id,
              scope_type,
              scope_id,
              source_worktree_id,
              actor_role,
              actor_action,
              status,
              coordination_log_ref,
              coordination_summary_ref,
              payload_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
            ON CONFLICT (project_id, workspace_id, record_id) DO UPDATE SET
              record_type = EXCLUDED.record_type,
              session_id = EXCLUDED.session_id,
              cycle_id = EXCLUDED.cycle_id,
              scope_type = EXCLUDED.scope_type,
              scope_id = EXCLUDED.scope_id,
              source_worktree_id = EXCLUDED.source_worktree_id,
              actor_role = EXCLUDED.actor_role,
              actor_action = EXCLUDED.actor_action,
              status = EXCLUDED.status,
              coordination_log_ref = EXCLUDED.coordination_log_ref,
              coordination_summary_ref = EXCLUDED.coordination_summary_ref,
              payload_json = EXCLUDED.payload_json
            RETURNING *
            `,
            [
              resolvedProjectId,
              normalizeScalar(workspaceId),
              normalizeScalar(recordId),
              normalizeScalar(recordType) || "unknown",
              normalizeScalar(sessionId) || null,
              normalizeScalar(cycleId) || null,
              normalizeScalar(scopeType) || "none",
              normalizeScalar(scopeId) || "none",
              normalizeScalar(sourceWorktreeId) || null,
              normalizeScalar(actorRole) || null,
              normalizeScalar(actorAction) || null,
              normalizeScalar(status) || "unknown",
              normalizeScalar(coordinationLogRef) || null,
              normalizeScalar(coordinationSummaryRef) || null,
              toJsonValue(payload, {}),
            ],
          );
          return {
            ok: true,
            coordination_record: mapCoordinationRow(queryResult.rows[0]),
          };
        });
        return {
          operation: "appendCoordinationRecord",
          ...result,
        };
      } catch (error) {
        return mapFailure("appendCoordinationRecord", error);
      }
    },

    async getPlanningState({
      projectId = "",
      workspaceId,
      planningKey,
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = resolveProjectId(projectId, workspaceId, runtime.workspace);
          const queryResult = await client.query(
            `
            SELECT *
            FROM aidn_shared.planning_states
            WHERE project_id = $1
              AND workspace_id = $2
              AND planning_key = $3
            LIMIT 1
            `,
            [
              resolvedProjectId,
              normalizeScalar(workspaceId),
              normalizeScalar(planningKey),
            ],
          );
          return {
            ok: true,
            planning_state: mapPlanningRow(queryResult.rows[0] ?? null),
          };
        });
        return {
          operation: "getPlanningState",
          ...result,
        };
      } catch (error) {
        return mapFailure("getPlanningState", error);
      }
    },

    async getLatestHandoffRelay({
      projectId = "",
      workspaceId,
      sessionId = "",
      scopeType = "",
      scopeId = "",
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = resolveProjectId(projectId, workspaceId, runtime.workspace);
          const queryResult = await client.query(
            `
            SELECT *
            FROM aidn_shared.handoff_relays
            WHERE project_id = $1
              AND workspace_id = $2
              AND ($3::text = '' OR session_id = $3)
              AND ($4::text = '' OR scope_type = $4)
              AND ($5::text = '' OR scope_id = $5)
            ORDER BY created_at DESC, relay_id DESC
            LIMIT 1
            `,
            [
              resolvedProjectId,
              normalizeScalar(workspaceId),
              normalizeScalar(sessionId),
              normalizeScalar(scopeType),
              normalizeScalar(scopeId),
            ],
          );
          return {
            ok: true,
            handoff_relay: mapHandoffRow(queryResult.rows[0] ?? null),
          };
        });
        return {
          operation: "getLatestHandoffRelay",
          ...result,
        };
      } catch (error) {
        return mapFailure("getLatestHandoffRelay", error);
      }
    },

    async listCoordinationRecords({
      projectId = "",
      workspaceId,
      recordType = "",
      sessionId = "",
      scopeType = "",
      scopeId = "",
      limit = 20,
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = resolveProjectId(projectId, workspaceId, runtime.workspace);
          const queryResult = await client.query(
            `
            SELECT *
            FROM aidn_shared.coordination_records
            WHERE project_id = $1
              AND workspace_id = $2
              AND ($3::text = '' OR record_type = $3)
              AND ($4::text = '' OR session_id = $4)
              AND ($5::text = '' OR scope_type = $5)
              AND ($6::text = '' OR scope_id = $6)
            ORDER BY created_at DESC, record_id DESC
            LIMIT $7
            `,
            [
              resolvedProjectId,
              normalizeScalar(workspaceId),
              normalizeScalar(recordType),
              normalizeScalar(sessionId),
              normalizeScalar(scopeType),
              normalizeScalar(scopeId),
              Math.max(1, Number(limit || 20)),
            ],
          );
          return {
            ok: true,
            records: Array.isArray(queryResult.rows) ? queryResult.rows.map((row) => mapCoordinationRow(row)) : [],
          };
        });
        return {
          operation: "listCoordinationRecords",
          ...result,
        };
      } catch (error) {
        return mapFailure("listCoordinationRecords", error);
      }
    },

    async listProjects() {
      try {
        const result = await withClient(runtime, async (client) => {
          let projects = [];
          try {
            const queryResult = await client.query(
              `
              SELECT
                p.project_id,
                p.project_id_source,
                p.project_root_ref,
                p.locator_ref,
                p.shared_backend_kind,
                p.updated_at,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.workspace_registry wr
                  WHERE wr.project_id = p.project_id
                ) AS workspace_count,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.worktree_registry wt
                  WHERE wt.project_id = p.project_id
                ) AS worktree_count,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.planning_states ps
                  WHERE ps.project_id = p.project_id
                ) AS planning_state_count,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.handoff_relays hr
                  WHERE hr.project_id = p.project_id
                ) AS handoff_relay_count,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.coordination_records cr
                  WHERE cr.project_id = p.project_id
                ) AS coordination_record_count
              FROM aidn_shared.project_registry p
              ORDER BY p.project_id ASC
              `,
            );
            projects = Array.isArray(queryResult.rows) ? queryResult.rows.map((row) => mapProjectRegistryRow(row)) : [];
          } catch (error) {
            const classified = classifyPostgresSharedCoordinationError(error);
            if (classified.category !== "schema") {
              throw error;
            }
            projects = await queryLegacyProjectList(client);
          }
          return {
            ok: true,
            projects,
          };
        });
        return {
          operation: "listProjects",
          ...result,
        };
      } catch (error) {
        return mapFailure("listProjects", error);
      }
    },

    async inspectProject({
      projectId = "",
    } = {}) {
      try {
        const result = await withClient(runtime, async (client) => {
          const resolvedProjectId = normalizeScalar(projectId) || normalizeScalar(runtime.workspace?.project_id);
          let project = null;
          let workspaces = [];
          try {
            const projectResult = await client.query(
              `
              SELECT
                p.project_id,
                p.project_id_source,
                p.project_root_ref,
                p.locator_ref,
                p.shared_backend_kind,
                p.updated_at,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.workspace_registry wr
                  WHERE wr.project_id = p.project_id
                ) AS workspace_count,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.worktree_registry wt
                  WHERE wt.project_id = p.project_id
                ) AS worktree_count,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.planning_states ps
                  WHERE ps.project_id = p.project_id
                ) AS planning_state_count,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.handoff_relays hr
                  WHERE hr.project_id = p.project_id
                ) AS handoff_relay_count,
                (
                  SELECT COUNT(*)::int
                  FROM aidn_shared.coordination_records cr
                  WHERE cr.project_id = p.project_id
                ) AS coordination_record_count
              FROM aidn_shared.project_registry p
              WHERE p.project_id = $1
              LIMIT 1
              `,
              [resolvedProjectId],
            );
            const workspaceResult = await client.query(
              `
              SELECT
                project_id,
                project_id_source,
                project_root_ref,
                workspace_id,
                workspace_id_source,
                locator_ref,
                git_common_dir,
                repo_root,
                shared_backend_kind,
                updated_at
              FROM aidn_shared.workspace_registry
              WHERE project_id = $1
              ORDER BY workspace_id ASC
              `,
              [resolvedProjectId],
            );
            project = mapProjectRegistryRow(projectResult.rows[0] ?? null);
            workspaces = Array.isArray(workspaceResult.rows) ? workspaceResult.rows.map((row) => mapWorkspaceRegistryRow(row)) : [];
          } catch (error) {
            const classified = classifyPostgresSharedCoordinationError(error);
            if (classified.category !== "schema") {
              throw error;
            }
            const legacyResult = await queryLegacyProjectInspect(client, resolvedProjectId);
            project = legacyResult.project;
            workspaces = legacyResult.workspaces;
          }
          return {
            ok: true,
            project,
            workspaces,
          };
        });
        return {
          operation: "inspectProject",
          ...result,
        };
      } catch (error) {
        return mapFailure("inspectProject", error);
      }
    },

    async healthcheck() {
      try {
        const result = await withClient(runtime, async (client) => {
          const metadataResult = await client.query(
            `
            SELECT
              current_database() AS database_name,
              current_schema() AS current_schema_name,
              1 AS ok
            `,
          );
          const metadataRow = metadataResult.rows[0] ?? {};
          const expectedTables = listPostgresSharedCoordinationTableNames();
          const tableResult = await client.query(
            `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = $1
              AND table_name = ANY($2::text[])
            ORDER BY table_name
            `,
            [
              POSTGRES_SHARED_COORDINATION_SCHEMA_NAME,
              expectedTables,
            ],
          );
          const tablesPresent = Array.isArray(tableResult.rows)
            ? tableResult.rows
              .map((row) => normalizeScalar(row.table_name))
              .filter(Boolean)
            : [];
          const tablesMissing = expectedTables.filter((table) => !tablesPresent.includes(table));
          let appliedSchemaVersions = [];
          if (tablesPresent.includes("schema_migrations")) {
            const migrationResult = await client.query(
              `
              SELECT schema_version
              FROM aidn_shared.schema_migrations
              WHERE schema_name = $1
              ORDER BY schema_version ASC
              `,
              [POSTGRES_SHARED_COORDINATION_SCHEMA_NAME],
            );
            appliedSchemaVersions = Array.isArray(migrationResult.rows)
              ? migrationResult.rows
                .map((row) => Number(row.schema_version))
                .filter((value) => Number.isFinite(value))
              : [];
          }
          const latestAppliedSchemaVersion = appliedSchemaVersions.length > 0
            ? Math.max(...appliedSchemaVersions)
            : 0;
          let registeredProjectCount = 0;
          let legacyWorkspaceRows = 0;
          if (tablesPresent.includes("project_registry")) {
            try {
              const projectCountResult = await client.query("SELECT COUNT(*)::int AS registered_project_count FROM aidn_shared.project_registry");
              registeredProjectCount = Number(projectCountResult.rows?.[0]?.registered_project_count ?? 0) || 0;
            } catch (error) {
              const classified = classifyPostgresSharedCoordinationError(error);
              if (classified.category !== "schema") {
                throw error;
              }
            }
          }
          if (tablesPresent.includes("workspace_registry")) {
            try {
              const legacyWorkspaceResult = await client.query(
                "SELECT COUNT(*)::int AS legacy_workspace_rows FROM aidn_shared.workspace_registry WHERE project_id IS NULL OR project_id = ''",
              );
              legacyWorkspaceRows = Number(legacyWorkspaceResult.rows?.[0]?.legacy_workspace_rows ?? 0) || 0;
            } catch (error) {
              const classified = classifyPostgresSharedCoordinationError(error);
              if (classified.category !== "schema") {
                throw error;
              }
              const workspaceCountResult = await client.query("SELECT COUNT(*)::int AS legacy_workspace_rows FROM aidn_shared.workspace_registry");
              legacyWorkspaceRows = Number(workspaceCountResult.rows?.[0]?.legacy_workspace_rows ?? 0) || 0;
              if (registeredProjectCount === 0) {
                registeredProjectCount = legacyWorkspaceRows;
              }
            }
          }
          let schemaStatus = "ready";
          if (tablesMissing.length > 0 && appliedSchemaVersions.length === 0) {
            schemaStatus = "needs-bootstrap";
          } else if (tablesMissing.length > 0) {
            schemaStatus = "schema-drift";
          } else if (latestAppliedSchemaVersion < POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION) {
            schemaStatus = "version-behind";
          } else if (latestAppliedSchemaVersion > POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION) {
            schemaStatus = "version-ahead";
          } else if (appliedSchemaVersions.length === 0) {
            schemaStatus = "no-migrations";
          }
          let compatibilityStatus = "project-scoped";
          const migrationDiagnostics = [];
          if (!tablesPresent.includes("project_registry") && tablesPresent.includes("workspace_registry")) {
            compatibilityStatus = "legacy-workspace-only";
            migrationDiagnostics.push("project_registry is missing; project enumeration falls back to workspace_id compatibility");
          } else if (schemaStatus !== "ready") {
            compatibilityStatus = "schema-not-ready";
          } else if (legacyWorkspaceRows > 0) {
            compatibilityStatus = "mixed-legacy-v2";
            migrationDiagnostics.push(`${legacyWorkspaceRows} workspace_registry rows still need project_id backfill`);
          } else if (registeredProjectCount === 0) {
            compatibilityStatus = "empty";
            migrationDiagnostics.push("project_registry is empty");
          }
          return {
            ok: true,
            database_name: normalizeScalar(metadataRow.database_name) || "unknown",
            schema_name: POSTGRES_SHARED_COORDINATION_SCHEMA_NAME,
            current_schema_name: normalizeScalar(metadataRow.current_schema_name) || "unknown",
            expected_schema_version: POSTGRES_SHARED_COORDINATION_SCHEMA_VERSION,
            applied_schema_versions: appliedSchemaVersions,
            latest_applied_schema_version: latestAppliedSchemaVersion,
            tables_present: tablesPresent,
            tables_missing: tablesMissing,
            registered_project_count: registeredProjectCount,
            legacy_workspace_rows: legacyWorkspaceRows,
            schema_status: schemaStatus,
            compatibility_status: compatibilityStatus,
            migration_diagnostics: migrationDiagnostics,
            schema_ok: schemaStatus === "ready" && legacyWorkspaceRows === 0,
          };
        });
        return {
          operation: "healthcheck",
          ...result,
        };
      } catch (error) {
        return mapFailure("healthcheck", error);
      }
    },
  };

  return assertSharedCoordinationStore(store, "PostgresSharedCoordinationStore");
}
