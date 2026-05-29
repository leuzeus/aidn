import path from "node:path";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function toCompactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildSharedCoordinationMigrationPlan({
  health = null,
  contract = null,
} = {}) {
  const expectedSchemaVersion = normalizePositiveInteger(contract?.schema_version || health?.expected_schema_version);
  const latestAppliedSchemaVersion = normalizePositiveInteger(health?.latest_applied_schema_version);
  const schemaStatus = normalizeScalar(health?.schema_status || "unknown") || "unknown";

  if (schemaStatus === "ready") {
    return {
      action: "noop",
      status: "ready",
      blocked: false,
      mutating: false,
      reason: "shared coordination schema is already aligned with the current package contract",
      expected_schema_version: expectedSchemaVersion,
      latest_applied_schema_version: latestAppliedSchemaVersion,
      rollback_recommended: false,
    };
  }
  if (schemaStatus === "needs-bootstrap" || schemaStatus === "no-migrations") {
    return {
      action: "bootstrap",
      status: schemaStatus,
      blocked: false,
      mutating: true,
      reason: "shared coordination schema has not been bootstrapped yet",
      expected_schema_version: expectedSchemaVersion,
      latest_applied_schema_version: latestAppliedSchemaVersion,
      rollback_recommended: false,
    };
  }
  if (schemaStatus === "version-behind") {
    return {
      action: "upgrade",
      status: schemaStatus,
      blocked: false,
      mutating: true,
      reason: `shared coordination schema version ${latestAppliedSchemaVersion || 0} is behind expected version ${expectedSchemaVersion || 0}`,
      expected_schema_version: expectedSchemaVersion,
      latest_applied_schema_version: latestAppliedSchemaVersion,
      rollback_recommended: true,
    };
  }
  if (schemaStatus === "schema-drift") {
    return {
      action: "repair",
      status: schemaStatus,
      blocked: false,
      mutating: true,
      reason: "shared coordination schema is partially present and needs repair before normal operation",
      expected_schema_version: expectedSchemaVersion,
      latest_applied_schema_version: latestAppliedSchemaVersion,
      rollback_recommended: true,
    };
  }
  if (schemaStatus === "version-ahead") {
    return {
      action: "blocked-version-ahead",
      status: schemaStatus,
      blocked: true,
      mutating: false,
      reason: `shared coordination schema version ${latestAppliedSchemaVersion || 0} is newer than this package expects (${expectedSchemaVersion || 0})`,
      expected_schema_version: expectedSchemaVersion,
      latest_applied_schema_version: latestAppliedSchemaVersion,
      rollback_recommended: false,
    };
  }
  return {
    action: "investigate",
    status: schemaStatus,
    blocked: true,
    mutating: false,
    reason: `shared coordination schema status is ${schemaStatus}; review health before attempting migration`,
    expected_schema_version: expectedSchemaVersion,
    latest_applied_schema_version: latestAppliedSchemaVersion,
    rollback_recommended: false,
  };
}

export function defaultSharedCoordinationRollbackSnapshotPath(targetRoot = ".", {
  now = new Date(),
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  return path.join(
    absoluteTargetRoot,
    ".aidn",
    "runtime",
    `shared-coordination-rollback-${toCompactTimestamp(now)}.json`,
  );
}

export function buildSharedCoordinationRollbackHint({
  targetRoot = ".",
  inputFile = "",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const absoluteInputFile = path.resolve(absoluteTargetRoot, inputFile || ".");
  const relativeInput = path.relative(absoluteTargetRoot, absoluteInputFile).replace(/\\/g, "/");
  return {
    input_file: absoluteInputFile,
    restore_command: `npx aidn runtime shared-coordination-restore --target . --in ${relativeInput} --write --json`,
    note: "Replay this rollback snapshot if the schema migration needs to be reverted logically.",
  };
}

export function resolveSharedCoordinationBackupSchemaInfo(payload = {}) {
  const sourceSchemaVersion = normalizePositiveInteger(
    payload?.schema_snapshot?.latest_applied_schema_version
      || payload?.health?.latest_applied_schema_version
      || payload?.contract?.source_schema_version
      || payload?.contract?.schema_version,
  );
  const expectedSchemaVersion = normalizePositiveInteger(
    payload?.schema_snapshot?.expected_schema_version
      || payload?.health?.expected_schema_version
      || payload?.contract?.expected_schema_version
      || payload?.contract?.schema_version,
  );
  return {
    source_schema_version: sourceSchemaVersion,
    expected_schema_version: expectedSchemaVersion,
    schema_status: normalizeScalar(
      payload?.schema_snapshot?.schema_status
        || payload?.health?.schema_status
        || "unknown",
    ) || "unknown",
  };
}

export function resolveSharedCoordinationRestoreCompatibility({
  backupPayload = {},
  resolution = null,
  health = null,
} = {}) {
  const backup = resolveSharedCoordinationBackupSchemaInfo(backupPayload);
  const runtimeExpectedVersion = normalizePositiveInteger(
    resolution?.contract?.schema_version || health?.expected_schema_version,
  );
  const runtimeLatestVersion = normalizePositiveInteger(health?.latest_applied_schema_version);

  if (!backup.source_schema_version || !runtimeExpectedVersion) {
    return {
      ok: true,
      status: "unknown",
      reason: "schema version compatibility could not be derived from the backup metadata",
      backup_source_schema_version: backup.source_schema_version,
      backup_expected_schema_version: backup.expected_schema_version,
      runtime_expected_schema_version: runtimeExpectedVersion,
      runtime_latest_schema_version: runtimeLatestVersion,
    };
  }
  if (backup.source_schema_version > runtimeExpectedVersion) {
    return {
      ok: false,
      status: "backup-version-ahead",
      reason: `backup source schema version ${backup.source_schema_version} is newer than this package expects (${runtimeExpectedVersion})`,
      backup_source_schema_version: backup.source_schema_version,
      backup_expected_schema_version: backup.expected_schema_version,
      runtime_expected_schema_version: runtimeExpectedVersion,
      runtime_latest_schema_version: runtimeLatestVersion,
    };
  }
  if (runtimeLatestVersion === 0) {
    return {
      ok: true,
      status: "compatible-after-bootstrap",
      reason: `target schema is not bootstrapped yet; backup schema version ${backup.source_schema_version} remains compatible with package schema ${runtimeExpectedVersion}`,
      backup_source_schema_version: backup.source_schema_version,
      backup_expected_schema_version: backup.expected_schema_version,
      runtime_expected_schema_version: runtimeExpectedVersion,
      runtime_latest_schema_version: runtimeLatestVersion,
    };
  }
  if (backup.source_schema_version > runtimeLatestVersion) {
    return {
      ok: true,
      status: "compatible-after-upgrade",
      reason: `target schema version ${runtimeLatestVersion} is behind backup schema version ${backup.source_schema_version}, but the current package supports replay after bootstrap/upgrade`,
      backup_source_schema_version: backup.source_schema_version,
      backup_expected_schema_version: backup.expected_schema_version,
      runtime_expected_schema_version: runtimeExpectedVersion,
      runtime_latest_schema_version: runtimeLatestVersion,
    };
  }
  if (backup.source_schema_version < runtimeExpectedVersion) {
    return {
      ok: true,
      status: "compatible-older-backup",
      reason: `backup source schema version ${backup.source_schema_version} is older than the current package schema (${runtimeExpectedVersion}); logical replay remains compatible`,
      backup_source_schema_version: backup.source_schema_version,
      backup_expected_schema_version: backup.expected_schema_version,
      runtime_expected_schema_version: runtimeExpectedVersion,
      runtime_latest_schema_version: runtimeLatestVersion,
    };
  }
  return {
    ok: true,
    status: "compatible",
    reason: "backup schema version is compatible with the current shared coordination contract",
    backup_source_schema_version: backup.source_schema_version,
    backup_expected_schema_version: backup.expected_schema_version,
    runtime_expected_schema_version: runtimeExpectedVersion,
    runtime_latest_schema_version: runtimeLatestVersion,
  };
}
