import path from "node:path";
import {
  createRuntimeArtifactStore,
  createRuntimePersistenceAdmin,
  resolveEffectiveRuntimePersistence,
  resolveRuntimeSqliteFile,
} from "./runtime-persistence-service.mjs";
import { createSqliteRuntimeArtifactStore } from "../../adapters/runtime/sqlite-runtime-artifact-store.mjs";
import { createSqliteRuntimePersistenceAdmin } from "../../adapters/runtime/sqlite-runtime-persistence-admin.mjs";
import { payloadDigest, stablePayloadProjection } from "../../adapters/runtime/artifact-projector-adapter.mjs";
import { assertRuntimeBackendAdoption } from "../../core/ports/runtime-backend-adoption-port.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function resolveConnectionRef(explicitConnectionRef, resolvedConnectionRef) {
  const explicit = normalizeScalar(explicitConnectionRef);
  if (explicit) {
    return explicit;
  }
  return normalizeScalar(resolvedConnectionRef);
}

function summarizeSourceSnapshot(sourceStatus, sourceSnapshot, sqliteFile) {
  const payload = sourceSnapshot.exists && !sourceSnapshot.warning ? sourceSnapshot.payload : null;
  return {
    backend: "sqlite",
    sqlite_file: sqliteFile,
    exists: Boolean(sourceSnapshot.exists),
    schema_exists: Boolean(sourceStatus?.exists),
    schema_version: sourceStatus?.schema_version ?? null,
    pending_ids: Array.isArray(sourceStatus?.pending_ids) ? sourceStatus.pending_ids : [],
    applied_ids: Array.isArray(sourceStatus?.applied_ids) ? sourceStatus.applied_ids : [],
    warning: normalizeScalar(sourceSnapshot.warning),
    has_payload: Boolean(payload && typeof payload === "object"),
    payload,
    payload_digest: payload ? payloadDigest(payload) : null,
    payload_summary: payload?.summary ?? null,
  };
}

function buildPlan({
  absoluteTargetRoot,
  backend,
  connectionRef,
  source,
  targetStatus,
  targetSnapshot,
  action,
  reason,
  reasonCode,
  prerequisites = [],
  blocked = false,
} = {}) {
  const targetDigest = targetSnapshot?.payload_digest
    ?? (targetSnapshot?.payload ? payloadDigest(targetSnapshot.payload) : null);
  return {
    ts: new Date().toISOString(),
    target_root: absoluteTargetRoot,
    requested_backend: backend,
    connection_ref: connectionRef || null,
    action,
    blocked,
    reason,
    reason_code: reasonCode,
    prerequisites,
    transfer_required: action === "transfer-from-sqlite",
    write_safe: blocked !== true,
    source: {
      ...source,
      payload: source?.payload ? cloneJson(stablePayloadProjection(source.payload)) : null,
    },
    target: {
      ok: targetStatus?.ok === true,
      backend: "postgres",
      exists: Boolean(targetStatus?.exists),
      scope_key: targetStatus?.scope_key ?? absoluteTargetRoot,
      schema_name: targetStatus?.schema_name ?? "aidn_runtime",
      schema_version: targetStatus?.schema_version ?? 1,
      tables_present: Array.isArray(targetStatus?.tables_present) ? targetStatus.tables_present : [],
      tables_missing: Array.isArray(targetStatus?.tables_missing) ? targetStatus.tables_missing : [],
      payload_rows: Number(targetStatus?.payload_rows ?? 0) || 0,
      pending_ids: Array.isArray(targetStatus?.pending_ids) ? targetStatus.pending_ids : [],
      applied_ids: Array.isArray(targetStatus?.applied_ids) ? targetStatus.applied_ids : [],
      reason: normalizeScalar(targetStatus?.reason),
      snapshot_exists: Boolean(targetSnapshot?.exists),
      snapshot_warning: normalizeScalar(targetSnapshot?.warning),
      payload_digest: targetDigest,
      adoption_status: normalizeScalar(targetSnapshot?.adoption_status) || null,
      source_backend: normalizeScalar(targetSnapshot?.source_backend) || null,
      source_sqlite_file: normalizeScalar(targetSnapshot?.source_sqlite_file) || null,
    },
  };
}

async function recordEventIfSupported(targetStore, payload) {
  if (typeof targetStore?.recordAdoptionEvent !== "function") {
    return null;
  }
  return targetStore.recordAdoptionEvent(payload);
}

export function createRuntimeBackendAdoptionService(options = {}) {
  const targetRoot = path.resolve(process.cwd(), options.targetRoot ?? ".");
  const runtimePersistence = resolveEffectiveRuntimePersistence({
    targetRoot,
    backend: options.backend,
    connectionRef: options.connectionRef,
    configData: options.configData ?? null,
    env: options.env ?? process.env,
  });
  const sqliteFile = resolveRuntimeSqliteFile({
    targetRoot,
    sqliteFile: options.sqliteFile,
  });

  async function planAdoption() {
    if (runtimePersistence.backend !== "postgres") {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source: summarizeSourceSnapshot(
          createSqliteRuntimePersistenceAdmin({
            sqliteFile,
            role: "runtime-backend-adoption-source",
          }).inspectSchema(),
          createSqliteRuntimeArtifactStore({ sqliteFile }).loadSnapshot({
            includePayload: true,
            includeRuntimeHeads: false,
          }),
          sqliteFile,
        ),
        targetStatus: null,
        targetSnapshot: null,
        action: "noop",
        reason: "canonical runtime backend remains sqlite; no backend adoption required",
        reasonCode: "sqlite-active",
      });
    }

    const sourceAdmin = createSqliteRuntimePersistenceAdmin({
      sqliteFile,
      role: "runtime-backend-adoption-source",
    });
    const sourceStore = createSqliteRuntimeArtifactStore({
      sqliteFile,
    });
    const source = summarizeSourceSnapshot(
      sourceAdmin.inspectSchema(),
      sourceStore.loadSnapshot({
        includePayload: true,
        includeRuntimeHeads: false,
      }),
      sqliteFile,
    );

    const targetAdmin = createRuntimePersistenceAdmin({
      ...options,
      targetRoot,
      backend: "postgres",
      connectionRef: resolveConnectionRef(options.connectionRef, runtimePersistence.connectionRef),
    });
    const targetStore = createRuntimeArtifactStore({
      ...options,
      targetRoot,
      backend: "postgres",
      connectionRef: resolveConnectionRef(options.connectionRef, runtimePersistence.connectionRef),
    });
    const targetStatus = await targetAdmin.inspectSchema();
    const tablesPresent = Array.isArray(targetStatus?.tables_present) ? targetStatus.tables_present : [];
    const tablesMissing = Array.isArray(targetStatus?.tables_missing) ? targetStatus.tables_missing : [];
    const pendingIds = Array.isArray(targetStatus?.pending_ids) ? targetStatus.pending_ids : [];
    const payloadRows = Number(targetStatus?.payload_rows ?? 0) || 0;

    if (targetStatus?.ok !== true) {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source,
        targetStatus,
        targetSnapshot: null,
        action: "blocked-conflict",
        blocked: true,
        reason: normalizeScalar(targetStatus?.reason) || "postgres runtime target is unavailable",
        reasonCode: "target-unavailable",
      });
    }

    if (tablesPresent.length === 0) {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source,
        targetStatus,
        targetSnapshot: null,
        action: source.has_payload ? "transfer-from-sqlite" : "bootstrap-target",
        prerequisites: source.has_payload ? ["bootstrap-target"] : [],
        reason: source.has_payload
          ? "postgres runtime target is absent and sqlite source data is available"
          : "postgres runtime target is absent and no sqlite source payload is available",
        reasonCode: source.has_payload ? "target-bootstrap-and-transfer" : "target-bootstrap-only",
      });
    }

    if (tablesMissing.length > 0) {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source,
        targetStatus,
        targetSnapshot: null,
        action: (payloadRows === 0 && !source.has_payload) ? "repair-target" : "blocked-conflict",
        blocked: !(payloadRows === 0 && !source.has_payload),
        reason: (payloadRows === 0 && !source.has_payload)
          ? "postgres runtime target schema is partial but can be repaired before first canonical write"
          : "postgres runtime target schema is partial and ambiguous; automatic merge is blocked",
        reasonCode: (payloadRows === 0 && !source.has_payload) ? "partial-schema-repairable" : "partial-schema-ambiguous",
      });
    }

    if (pendingIds.length > 0) {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source,
        targetStatus,
        targetSnapshot: null,
        action: source.has_payload ? "transfer-from-sqlite" : "migrate-target",
        prerequisites: source.has_payload ? ["migrate-target"] : [],
        reason: source.has_payload
          ? "postgres runtime target schema requires migration before sqlite transfer"
          : "postgres runtime target schema requires migration",
        reasonCode: source.has_payload ? "target-migrate-and-transfer" : "target-migrate-only",
      });
    }

    if (payloadRows === 0) {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source,
        targetStatus,
        targetSnapshot: null,
        action: source.has_payload ? "transfer-from-sqlite" : "noop",
        reason: source.has_payload
          ? "postgres runtime target is empty and sqlite source data is available"
          : "postgres runtime target is ready but empty and no sqlite source payload is available",
        reasonCode: source.has_payload ? "empty-target-transfer" : "empty-target-no-source",
      });
    }

    const targetSnapshot = await targetStore.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: false,
    });
    if (!targetSnapshot.exists || targetSnapshot.warning) {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source,
        targetStatus,
        targetSnapshot,
        action: source.has_payload ? "blocked-conflict" : "repair-target",
        blocked: source.has_payload,
        reason: source.has_payload
          ? "postgres runtime target has canonical rows but the snapshot cannot be verified safely"
          : "postgres runtime target snapshot metadata is inconsistent and should be repaired",
        reasonCode: source.has_payload ? "target-snapshot-unverifiable" : "target-snapshot-repairable",
      });
    }

    const targetDigest = targetSnapshot.payload_digest
      ?? (targetSnapshot.payload ? payloadDigest(targetSnapshot.payload) : null);
    if (!source.has_payload) {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source,
        targetStatus,
        targetSnapshot,
        action: "noop",
        reason: "postgres runtime target already contains canonical data and no sqlite transfer source is available",
        reasonCode: "target-ready",
      });
    }

    if (targetDigest === source.payload_digest) {
      return buildPlan({
        absoluteTargetRoot: targetRoot,
        backend: runtimePersistence.backend,
        connectionRef: runtimePersistence.connectionRef,
        source,
        targetStatus,
        targetSnapshot,
        action: "noop",
        reason: "postgres runtime target already matches the sqlite canonical payload",
        reasonCode: "target-matches-source",
      });
    }

    return buildPlan({
      absoluteTargetRoot: targetRoot,
      backend: runtimePersistence.backend,
      connectionRef: runtimePersistence.connectionRef,
      source,
      targetStatus,
      targetSnapshot,
      action: "blocked-conflict",
      blocked: true,
      reason: "postgres runtime target already contains canonical data that differs from the sqlite source",
      reasonCode: "payload-drift",
    });
  }

  async function executeAdoption({ write = true, plan = null } = {}) {
    const resolvedPlan = plan ?? await planAdoption();
    if (!write || resolvedPlan.blocked || resolvedPlan.action === "noop") {
      return {
        ...resolvedPlan,
        attempted: false,
        applied: false,
        ok: resolvedPlan.blocked !== true,
        execution_status: resolvedPlan.blocked ? "blocked" : "dry-run",
        migration: null,
        transfer: null,
        verification: null,
        event: null,
      };
    }

    const targetAdmin = createRuntimePersistenceAdmin({
      ...options,
      targetRoot,
      backend: "postgres",
      connectionRef: resolveConnectionRef(options.connectionRef, runtimePersistence.connectionRef),
    });
    const targetStore = createRuntimeArtifactStore({
      ...options,
      targetRoot,
      backend: "postgres",
      connectionRef: resolveConnectionRef(options.connectionRef, runtimePersistence.connectionRef),
    });

    let migration = null;
    if (resolvedPlan.prerequisites.includes("bootstrap-target")
      || resolvedPlan.prerequisites.includes("migrate-target")
      || resolvedPlan.action === "bootstrap-target"
      || resolvedPlan.action === "migrate-target"
      || resolvedPlan.action === "repair-target") {
      migration = await targetAdmin.migrateSchema();
    }

    let transfer = null;
    let verification = null;
    if (resolvedPlan.action === "transfer-from-sqlite") {
      const sourcePayload = resolvedPlan.source?.payload;
      if (!sourcePayload || typeof sourcePayload !== "object") {
        throw new Error("SQLite runtime source payload is required for transfer-from-sqlite");
      }
      const outputs = await targetStore.writeIndexProjection({
        payload: sourcePayload,
        sourceBackend: "sqlite",
        sourceSqliteFile: resolvedPlan.source.sqlite_file,
        adoptionStatus: "transferred",
        adoptionMetadata: {
          planner_action: resolvedPlan.action,
          planner_reason_code: resolvedPlan.reason_code,
          source_payload_digest: resolvedPlan.source.payload_digest,
          prerequisites: resolvedPlan.prerequisites,
          transferred_at: new Date().toISOString(),
        },
      });
      const targetSnapshot = await targetStore.loadSnapshot({
        includePayload: true,
        includeRuntimeHeads: false,
      });
      const targetDigest = targetSnapshot.payload_digest
        ?? (targetSnapshot.payload ? payloadDigest(targetSnapshot.payload) : null);
      verification = {
        ok: targetSnapshot.exists === true
          && !targetSnapshot.warning
          && targetDigest === resolvedPlan.source.payload_digest,
        source_payload_digest: resolvedPlan.source.payload_digest,
        target_payload_digest: targetDigest,
        snapshot_exists: targetSnapshot.exists === true,
        snapshot_warning: normalizeScalar(targetSnapshot.warning),
      };
      transfer = {
        ok: verification.ok,
        outputs,
      };
    }

    const event = await recordEventIfSupported(targetStore, {
      action: resolvedPlan.action,
      status: resolvedPlan.action === "transfer-from-sqlite"
        ? (verification?.ok ? "applied" : "verification-failed")
        : "applied",
      sourceBackend: resolvedPlan.source.backend,
      targetBackend: "postgres",
      sourcePayloadDigest: resolvedPlan.source.payload_digest,
      targetPayloadDigest: verification?.target_payload_digest ?? null,
      payload: {
        reason_code: resolvedPlan.reason_code,
        reason: resolvedPlan.reason,
        prerequisites: resolvedPlan.prerequisites,
      },
    });

    return {
      ...resolvedPlan,
      attempted: true,
      applied: true,
      ok: resolvedPlan.action === "transfer-from-sqlite" ? verification?.ok === true : true,
      execution_status: resolvedPlan.action,
      migration,
      transfer,
      verification,
      event,
    };
  }

  return assertRuntimeBackendAdoption({
    describeBackend() {
      return {
        backend_kind: runtimePersistence.backend,
        connection_ref: runtimePersistence.connectionRef ?? null,
        target_root: targetRoot,
        sqlite_file: sqliteFile,
      };
    },
    planAdoption,
    executeAdoption,
  }, "RuntimeBackendAdoptionService");
}

export async function planRuntimeBackendAdoption(options = {}) {
  return createRuntimeBackendAdoptionService(options).planAdoption();
}

export async function executeRuntimeBackendAdoption(options = {}) {
  const service = createRuntimeBackendAdoptionService(options);
  const plan = options.plan ?? await service.planAdoption();
  return service.executeAdoption({
    write: options.write !== false,
    plan,
  });
}
