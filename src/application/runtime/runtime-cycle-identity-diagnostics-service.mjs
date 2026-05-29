import path from "node:path";
import { createSqliteRuntimeArtifactStore } from "../../adapters/runtime/sqlite-runtime-artifact-store.mjs";
import { createSqliteRuntimePersistenceAdmin } from "../../adapters/runtime/sqlite-runtime-persistence-admin.mjs";
import { payloadDigest } from "../../adapters/runtime/artifact-projector-adapter.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizePathForComparison(value) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return "";
  }
  return path.resolve(normalized).replace(/\\/g, "/").toLowerCase();
}

export function normalizeRelativeArtifactPath(value) {
  return String(value ?? "").trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function extractCycleDirectoryName(relativePath) {
  const normalized = normalizeRelativeArtifactPath(relativePath);
  const match = normalized.match(/^cycles\/([^/]+)\//i);
  return String(match?.[1] ?? "").trim() || null;
}

export function detectCycleIdentityCollisions(payload) {
  const directoriesByCycleId = new Map();
  const register = (cycleId, candidatePath) => {
    const normalizedCycleId = normalizeScalar(cycleId).toUpperCase();
    const cycleDirName = extractCycleDirectoryName(candidatePath);
    if (!normalizedCycleId || !cycleDirName) {
      return;
    }
    if (!directoriesByCycleId.has(normalizedCycleId)) {
      directoriesByCycleId.set(normalizedCycleId, new Set());
    }
    directoriesByCycleId.get(normalizedCycleId).add(cycleDirName);
  };

  for (const row of Array.isArray(payload?.file_map) ? payload.file_map : []) {
    register(row?.cycle_id, row?.path);
  }
  for (const row of Array.isArray(payload?.artifacts) ? payload.artifacts : []) {
    register(row?.cycle_id, row?.path);
  }

  return Array.from(directoriesByCycleId.entries())
    .map(([cycleId, directories]) => ({
      cycle_id: cycleId,
      directories: Array.from(directories).sort((left, right) => left.localeCompare(right)),
    }))
    .filter((item) => item.directories.length > 1)
    .sort((left, right) => left.cycle_id.localeCompare(right.cycle_id));
}

export function detectRuntimeSourceScopeDrift(payload, expectedTargetRoot = ".") {
  const expectedRoot = path.resolve(process.cwd(), expectedTargetRoot ?? ".");
  const expectedAuditRoot = path.join(expectedRoot, "docs", "audit");
  const payloadTargetRoot = normalizeScalar(payload?.target_root);
  const payloadAuditRoot = normalizeScalar(payload?.audit_root);
  const targetRootMatches = payloadTargetRoot
    ? normalizePathForComparison(payloadTargetRoot) === normalizePathForComparison(expectedRoot)
    : null;
  const auditRootMatches = payloadAuditRoot
    ? normalizePathForComparison(payloadAuditRoot) === normalizePathForComparison(expectedAuditRoot)
    : null;
  const targetRootMismatch = targetRootMatches === false;
  const auditRootMismatch = auditRootMatches === false;
  return {
    expected_target_root: expectedRoot,
    expected_audit_root: expectedAuditRoot,
    payload_target_root: payloadTargetRoot || null,
    payload_audit_root: payloadAuditRoot || null,
    target_root_matches: targetRootMatches,
    audit_root_matches: auditRootMatches,
    target_root_mismatch: targetRootMismatch,
    audit_root_mismatch: auditRootMismatch,
    blocking: targetRootMismatch || auditRootMismatch,
  };
}

export function inspectSqliteRuntimeCycleIdentities({
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
  targetRoot = ".",
} = {}) {
  const absoluteSqliteFile = path.resolve(process.cwd(), sqliteFile);
  const admin = createSqliteRuntimePersistenceAdmin({
    sqliteFile: absoluteSqliteFile,
  });
  const store = createSqliteRuntimeArtifactStore({
    sqliteFile: absoluteSqliteFile,
  });
  const schemaStatus = admin.inspectSchema();
  const snapshot = store.loadSnapshot({
    includeRuntimeHeads: false,
  });
  const payload = snapshot.exists && !snapshot.warning ? snapshot.payload : null;
  const cycleIdentityCollisions = payload ? detectCycleIdentityCollisions(payload) : [];
  const scopeDrift = payload ? detectRuntimeSourceScopeDrift(payload, targetRoot) : {
    expected_target_root: path.resolve(process.cwd(), targetRoot ?? "."),
    expected_audit_root: path.join(path.resolve(process.cwd(), targetRoot ?? "."), "docs", "audit"),
    payload_target_root: null,
    payload_audit_root: null,
    target_root_matches: null,
    audit_root_matches: null,
    target_root_mismatch: false,
    audit_root_mismatch: false,
    blocking: false,
  };
  const reasonCodes = [];
  if (cycleIdentityCollisions.length > 0) {
    reasonCodes.push("source-cycle-identity-ambiguous");
  }
  if (scopeDrift.blocking) {
    reasonCodes.push("source-scope-drift");
  }
  const blocked = reasonCodes.length > 0;
  const reasonCode = reasonCodes[0] ?? null;

  return {
    ts: new Date().toISOString(),
    sqlite_file: absoluteSqliteFile,
    exists: Boolean(snapshot.exists),
    warning: normalizeScalar(snapshot.warning) || null,
    ok: snapshot.exists ? !snapshot.warning : true,
    schema_exists: Boolean(schemaStatus?.exists),
    schema_version: schemaStatus?.schema_version ?? null,
    pending_ids: Array.isArray(schemaStatus?.pending_ids) ? schemaStatus.pending_ids : [],
    applied_ids: Array.isArray(schemaStatus?.applied_ids) ? schemaStatus.applied_ids : [],
    has_payload: Boolean(payload && typeof payload === "object"),
    payload_digest: payload ? payloadDigest(payload) : null,
    payload_summary: payload?.summary ?? null,
    source_scope: scopeDrift,
    cycle_identity_collisions: cycleIdentityCollisions,
    cycle_identity_collision_count: cycleIdentityCollisions.length,
    adoption_blocked: blocked,
    reason_code: reasonCode,
    reason_codes: reasonCodes,
    diagnostic_status: snapshot.warning
      ? "warning"
      : (!snapshot.exists
        ? "missing-source"
        : (cycleIdentityCollisions.length > 0
          ? "ambiguous-cycle-identities"
          : (scopeDrift.blocking ? "scope-drift" : "ready"))),
  };
}
