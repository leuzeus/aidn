#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildNextAidnProjectConfig } from "../../src/application/install/project-config-service.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { readAidnProjectConfig, writeAidnProjectConfig } from "../../src/lib/config/aidn-config-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RUNTIME_TABLES_IN_DELETE_ORDER = Object.freeze([
  "runtime_heads",
  "artifact_blobs",
  "migration_findings",
  "migration_runs",
  "repair_decisions",
  "session_links",
  "session_cycle_links",
  "cycle_links",
  "artifact_links",
  "run_metrics",
  "artifact_tags",
  "tags",
  "file_map",
  "artifacts",
  "sessions",
  "cycles",
  "index_meta",
  "runtime_scope_registry",
  "adoption_events",
  "runtime_snapshots",
]);
const INJECTED_FAILURE_CODE = "AIDN_RUNTIME_PG_INJECTED_FAILURE_AFTER_WRITES";

let postgresClientClass = null;

async function loadPostgresClientClass() {
  if (postgresClientClass == null) {
    const postgresModule = await import("pg");
    postgresClientClass = postgresModule.Client;
  }
  return postgresClientClass;
}

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(scriptRelative, args, env = {}) {
  const result = spawnSync(process.execPath, [path.resolve(REPO_ROOT, scriptRelative), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    payload: (() => {
      try {
        return JSON.parse(String(result.stdout ?? "{}"));
      } catch {
        return null;
      }
    })(),
  };
}

function redact(value, secret) {
  return String(value ?? "")
    .replaceAll(secret, "[redacted]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-postgres-url]");
}

function serializeError(error, secret) {
  if (!error) {
    return null;
  }
  return {
    name: normalizeScalar(error.name) || "Error",
    code: normalizeScalar(error.code) || null,
    message: redact(error.message, secret),
  };
}

async function tableExists(client, tableName) {
  const result = await client.query("SELECT to_regclass($1) AS table_name", [
    `aidn_runtime.${tableName}`,
  ]);
  return result.rows[0]?.table_name != null;
}

async function countScopeRowsWithClient(client, scopeKey) {
  const counts = {};
  for (const tableName of RUNTIME_TABLES_IN_DELETE_ORDER) {
    if (!(await tableExists(client, tableName))) {
      counts[tableName] = 0;
      continue;
    }
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS row_count FROM aidn_runtime.${tableName} WHERE scope_key = $1`,
      [scopeKey],
    );
    counts[tableName] = Number(result.rows[0]?.row_count ?? 0);
  }
  return counts;
}

function summarizeScopeCounts(scopeKey, counts) {
  const nonzero = Object.entries(counts)
    .filter(([, count]) => Number(count) !== 0)
    .map(([table, count]) => ({ table, count: Number(count) }));
  return {
    scope_key: scopeKey,
    counters_checked: RUNTIME_TABLES_IN_DELETE_ORDER.length,
    total_rows: Object.values(counts).reduce((sum, count) => sum + Number(count), 0),
    all_zero: nonzero.length === 0,
    nonzero,
    counts,
  };
}

export async function cleanAndVerifyScopes(connectionString, scopeKeys) {
  const uniqueScopeKeys = [...new Set(scopeKeys.filter(Boolean))];
  const Client = await loadPostgresClientClass();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    try {
      for (const scopeKey of uniqueScopeKeys) {
        for (const tableName of RUNTIME_TABLES_IN_DELETE_ORDER) {
          if (await tableExists(client, tableName)) {
            await client.query(
              `DELETE FROM aidn_runtime.${tableName} WHERE scope_key = $1`,
              [scopeKey],
            );
          }
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const scopeResults = [];
    for (const scopeKey of uniqueScopeKeys) {
      const counts = await countScopeRowsWithClient(client, scopeKey);
      scopeResults.push(summarizeScopeCounts(scopeKey, counts));
    }
    return {
      ok: scopeResults.every((item) => item.all_zero),
      table_count: RUNTIME_TABLES_IN_DELETE_ORDER.length,
      scopes: scopeResults,
    };
  } finally {
    await client.end();
  }
}

async function readLiveEvidence(connectionString, legacyScopeKey, canonicalScopeKey) {
  const Client = await loadPostgresClientClass();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    let snapshotRows = [];
    if (await tableExists(client, "runtime_snapshots")) {
      snapshotRows = (await client.query(
        `
        SELECT scope_key, payload_digest, adoption_status, source_backend
        FROM aidn_runtime.runtime_snapshots
        WHERE scope_key = $1
        `,
        [legacyScopeKey],
      )).rows;
    }
    const canonicalMetaRows = (await client.query(
      `
      SELECT key, value
      FROM aidn_runtime.index_meta
      WHERE scope_key = $1
      ORDER BY key ASC
      `,
      [canonicalScopeKey],
    )).rows;
    const canonicalArtifactRows = (await client.query(
      `
      SELECT artifact_id, path, subtype
      FROM aidn_runtime.artifacts
      WHERE scope_key = $1
      ORDER BY path ASC
      `,
      [canonicalScopeKey],
    )).rows;
    const registryRows = (await client.query(
      `
      SELECT scope_key, runtime_scope_id, legacy_scope_key, project_id, workspace_id,
             explicit_project_context, is_legacy_scope
      FROM aidn_runtime.runtime_scope_registry
      WHERE scope_key = $1
      `,
      [canonicalScopeKey],
    )).rows;
    const eventRows = (await client.query(
      `
      SELECT event_id, action, status, source_backend, target_backend
      FROM aidn_runtime.adoption_events
      WHERE scope_key = $1
      ORDER BY created_at DESC
      `,
      [canonicalScopeKey],
    )).rows;
    return {
      snapshotRows,
      canonicalMetaRows,
      canonicalArtifactRows,
      registryRows,
      eventRows,
    };
  } finally {
    await client.end();
  }
}

async function exerciseRuntimePersistence({
  connectionString,
  targetRoot,
  canonicalScopeKey,
  projectContext,
  injectFailureAfterWrites,
}) {
  const env = {
    AIDN_RUNTIME_PG_SMOKE_URL: connectionString,
  };
  const indexSync = runJson("tools/perf/index-sync.mjs", [
    "--target",
    targetRoot,
    "--store",
    "dual-sqlite",
    "--with-content",
    "--json",
  ], env);
  assert(indexSync.status === 0, "live index-sync should succeed");

  const currentConfig = readAidnProjectConfig(targetRoot).data;
  const nextConfig = buildNextAidnProjectConfig(currentConfig, {
    store: "dual-sqlite",
    stateMode: "dual",
  }, {
    runtimePersistenceBackend: "postgres",
    runtimePersistenceConnectionRef: "env:AIDN_RUNTIME_PG_SMOKE_URL",
    runtimePersistenceLocalProjectionPolicy: "keep-local-sqlite",
  });
  writeAidnProjectConfig(targetRoot, nextConfig);

  const adopt = runJson("bin/aidn.mjs", [
    "runtime",
    "persistence-adopt",
    "--target",
    targetRoot,
    "--json",
  ], env);
  assert(adopt.status === 0, "live persistence-adopt should succeed");
  if (injectFailureAfterWrites) {
    const injected = new Error("injected failure after PostgreSQL runtime writes");
    injected.code = INJECTED_FAILURE_CODE;
    throw injected;
  }

  const status = runJson("bin/aidn.mjs", [
    "runtime",
    "persistence-status",
    "--target",
    targetRoot,
    "--json",
  ], env);
  assert(status.status === 0, "live persistence-status should succeed");
  assert(
    status.payload?.runtime_structures?.selected_backend === "postgres",
    "live persistence-status should expose the selected postgres backend structure",
  );
  assert(
    status.payload?.runtime_structures?.sqlite?.backend === "sqlite",
    "live persistence-status should expose the sqlite compatibility structure",
  );
  assert(
    status.payload?.runtime_structures?.migration?.action === "noop",
    "live persistence-status should show noop migration after postgres adoption",
  );
  assert(
    status.payload?.runtime_backend?.connection?.connection_string === "[redacted]",
    "live persistence-status should redact the resolved postgres connection string",
  );
  assert(
    !JSON.stringify(status.payload).includes(connectionString),
    "live persistence-status should not serialize the resolved postgres connection string",
  );

  const backup = runJson("bin/aidn.mjs", [
    "runtime",
    "persistence-backup",
    "--target",
    targetRoot,
    "--json",
  ], env);
  assert(backup.status === 0, "live persistence-backup should succeed");

  const runtimeCanonicalConfig = buildNextAidnProjectConfig(readAidnProjectConfig(targetRoot).data, {
    store: "sqlite",
    stateMode: "db-only",
  }, {
    runtimePersistenceBackend: "postgres",
    runtimePersistenceConnectionRef: "env:AIDN_RUNTIME_PG_SMOKE_URL",
    runtimePersistenceLocalProjectionPolicy: "none",
  });
  writeAidnProjectConfig(targetRoot, runtimeCanonicalConfig);
  fs.rmSync(path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite"), {
    force: true,
  });
  fs.rmSync(path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md"), { force: true });
  fs.rmSync(path.join(targetRoot, "docs", "audit", "HANDOFF-PACKET.md"), { force: true });
  fs.rmSync(path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md"), { force: true });

  const runtimeState = runJson("tools/runtime/project-runtime-state.mjs", [
    "--target",
    targetRoot,
    "--json",
  ], env);
  assert(
    runtimeState.status === 0,
    "live runtime-state should succeed with runtime-canonical postgres projection",
  );
  assert(
    runtimeState.payload?.shared_state_backend?.runtime_backend?.connection?.connection_string
      === "[redacted]",
    "live runtime-state should redact the canonical postgres connection string",
  );
  assert(
    !JSON.stringify(runtimeState.payload).includes(connectionString),
    "live runtime-state should not serialize the resolved postgres connection string",
  );

  const dbOnlyReadiness = runJson("tools/runtime/db-only-readiness.mjs", [
    "--target",
    targetRoot,
    "--json",
  ], env);
  assert(
    dbOnlyReadiness.status === 0,
    "live db-only-readiness should succeed with runtime-canonical postgres projection",
  );

  const handoff = runJson("tools/runtime/project-handoff-packet.mjs", [
    "--target",
    targetRoot,
    "--json",
  ], env);
  assert(
    handoff.status === 0,
    "live handoff packet should succeed with runtime-canonical postgres projection",
  );
  assert(
    handoff.payload?.shared_state_backend?.runtime_backend?.connection?.connection_string
      === "[redacted]",
    "live handoff should redact the canonical postgres connection string",
  );
  assert(
    !JSON.stringify(handoff.payload).includes(connectionString),
    "live handoff should not serialize the resolved postgres connection string",
  );

  const liveEvidence = await readLiveEvidence(connectionString, targetRoot, canonicalScopeKey);
  const checks = {
    index_sync_ok: indexSync.status === 0,
    adopt_transfer_applied: adopt.payload?.runtime_backend_adoption_plan?.action
      === "transfer-from-sqlite"
      && adopt.payload?.runtime_backend_adoption?.verification?.ok === true,
    status_reports_postgres: status.payload?.runtime_persistence?.backend === "postgres",
    status_reports_relational_canonical_storage:
      status.payload?.storage_policy === "relational-canonical",
    status_reports_relational_ready_compatibility:
      status.payload?.compatibility_status === "relational-ready",
    status_reports_ready_schema:
      Array.isArray(status.payload?.tables_missing) && status.payload.tables_missing.length === 0,
    status_reports_canonical_payload_row:
      Number(status.payload?.canonical_payload_rows ?? 0) === 1,
    status_reports_noop_after_transfer:
      status.payload?.runtime_backend_adoption_plan?.action === "noop",
    backup_ok: backup.payload?.ok === true && typeof backup.payload?.backup_file === "string",
    live_canonical_meta_written:
      liveEvidence.canonicalMetaRows.some((row) => normalizeScalar(row.key) === "payload_schema_version"),
    live_canonical_artifacts_written: liveEvidence.canonicalArtifactRows.length > 0,
    live_runtime_scope_registry_written: liveEvidence.registryRows.length === 1
      && normalizeScalar(liveEvidence.registryRows[0]?.runtime_scope_id) === canonicalScopeKey
      && normalizeScalar(liveEvidence.registryRows[0]?.legacy_scope_key) === targetRoot,
    live_snapshot_compat_optional: liveEvidence.snapshotRows.length === 0
      || (liveEvidence.snapshotRows.length === 1
        && normalizeScalar(liveEvidence.snapshotRows[0]?.adoption_status) === "transferred"),
    live_event_recorded: liveEvidence.eventRows.length >= 1
      && normalizeScalar(liveEvidence.eventRows[0]?.action) === "transfer-from-sqlite",
    runtime_canonical_runtime_state_scope:
      runtimeState.payload?.shared_state_backend?.projection_scope === "runtime-canonical",
    runtime_canonical_runtime_state_backend:
      runtimeState.payload?.shared_state_backend?.projection_backend_kind === "postgres",
    runtime_canonical_current_state_source:
      runtimeState.payload?.digest?.current_state_source === "postgres",
    runtime_canonical_readiness_pass:
      dbOnlyReadiness.payload?.summary?.status === "pass",
    runtime_canonical_readiness_scope:
      dbOnlyReadiness.payload?.operational?.sqlite_index?.projection_scope === "runtime-canonical",
    runtime_canonical_readiness_current_state_source:
      dbOnlyReadiness.payload?.operational?.resolutions?.current_state?.source === "postgres",
    runtime_canonical_readiness_handoff_source:
      dbOnlyReadiness.payload?.operational?.resolutions?.handoff_packet?.source === "postgres",
    runtime_canonical_handoff_scope:
      handoff.payload?.shared_state_backend?.projection_scope === "runtime-canonical",
    runtime_canonical_handoff_current_state_source:
      handoff.payload?.packet?.current_state_source === "postgres",
    project_context_matches_scope: projectContext.runtime_scope_id === canonicalScopeKey,
  };
  assert(
    Object.values(checks).every((value) => value === true),
    "one or more PostgreSQL runtime persistence assertions failed",
  );
  return {
    checks,
    rows_written_before_cleanup: {
      canonical_index_meta: liveEvidence.canonicalMetaRows.length,
      canonical_artifacts: liveEvidence.canonicalArtifactRows.length,
      runtime_scope_registry: liveEvidence.registryRows.length,
      adoption_events: liveEvidence.eventRows.length,
      legacy_snapshots: liveEvidence.snapshotRows.length,
    },
  };
}

async function runCase({ connectionString, label, injectFailureAfterWrites }) {
  let tempRoot = "";
  let targetRoot = "";
  let canonicalScopeKey = "";
  let primaryError = null;
  let cleanupError = null;
  let exercise = null;
  let cleanup = null;
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `aidn-runtime-pg-${label}-`));
    targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(
      path.resolve(REPO_ROOT, "tests", "fixtures", "repo-installed-core"),
      targetRoot,
      { recursive: true },
    );
    fs.rmSync(path.join(targetRoot, ".aidn", "runtime"), { recursive: true, force: true });
    const projectContext = resolveRuntimeProjectContext({ targetRoot });
    canonicalScopeKey = projectContext.runtime_scope_id;
    const initialCleanup = await cleanAndVerifyScopes(
      connectionString,
      [targetRoot, canonicalScopeKey],
    );
    assert(initialCleanup.ok, "synthetic PostgreSQL scopes must be empty before the smoke");
    exercise = await exerciseRuntimePersistence({
      connectionString,
      targetRoot,
      canonicalScopeKey,
      projectContext,
      injectFailureAfterWrites,
    });
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      cleanup = await cleanAndVerifyScopes(
        connectionString,
        [targetRoot, canonicalScopeKey],
      );
      assert(cleanup.ok, "synthetic PostgreSQL scopes were not fully cleaned");
    } catch (error) {
      cleanupError = error;
    }
    if (tempRoot && fs.existsSync(tempRoot)) {
      const removal = removePathWithRetry(tempRoot);
      if (!removal.ok) {
        cleanupError ??= removal.error;
      }
    }
    if (tempRoot && fs.existsSync(tempRoot)) {
      cleanupError ??= new Error("runtime PostgreSQL smoke temp directory remains");
    }
  }
  return {
    label,
    inject_failure_after_writes: injectFailureAfterWrites,
    exercise,
    primary_error: serializeError(primaryError, connectionString),
    cleanup_error: serializeError(cleanupError, connectionString),
    cleanup: cleanup
      ? {
        ok: cleanup.ok,
        table_count: cleanup.table_count,
        scopes: cleanup.scopes.map((scope) => ({
          scope_key: scope.scope_key,
          counters_checked: scope.counters_checked,
          total_rows: scope.total_rows,
          all_zero: scope.all_zero,
          nonzero: scope.nonzero,
        })),
      }
      : null,
    temp_removed: tempRoot ? !fs.existsSync(tempRoot) : true,
    success: primaryError == null && cleanupError == null,
    expected_injected_failure_observed:
      injectFailureAfterWrites && primaryError?.code === INJECTED_FAILURE_CODE,
  };
}

async function main() {
  const connectionString = normalizeScalar(
    process.env.AIDN_RUNTIME_PG_SMOKE_URL || process.env.AIDN_PG_SMOKE_URL,
  );
  if (!connectionString) {
    console.log(JSON.stringify({
      ok: true,
      pass: true,
      skipped: true,
      reason: "AIDN_RUNTIME_PG_SMOKE_URL or AIDN_PG_SMOKE_URL is not set",
    }, null, 2));
    return;
  }

  let output;
  try {
    const successCase = await runCase({
      connectionString,
      label: "success",
      injectFailureAfterWrites: false,
    });
    const injectedFailureCase = await runCase({
      connectionString,
      label: "failure",
      injectFailureAfterWrites: true,
    });
    const pass = successCase.success
      && successCase.exercise != null
      && successCase.cleanup?.scopes?.length === 2
      && successCase.cleanup.scopes.every(
        (scope) => scope.counters_checked === RUNTIME_TABLES_IN_DELETE_ORDER.length
          && scope.all_zero,
      )
      && injectedFailureCase.expected_injected_failure_observed
      && injectedFailureCase.cleanup_error == null
      && injectedFailureCase.cleanup?.scopes?.length === 2
      && injectedFailureCase.cleanup.scopes.every(
        (scope) => scope.counters_checked === RUNTIME_TABLES_IN_DELETE_ORDER.length
          && scope.all_zero,
      )
      && successCase.temp_removed
      && injectedFailureCase.temp_removed;
    output = {
      ok: pass,
      pass,
      skipped: false,
      secrets_redacted: true,
      table_count_per_scope: RUNTIME_TABLES_IN_DELETE_ORDER.length,
      cases: {
        success: successCase,
        failure_after_writes: injectedFailureCase,
      },
    };
  } catch (error) {
    output = {
      ok: false,
      pass: false,
      skipped: false,
      secrets_redacted: true,
      fatal_error: serializeError(error, connectionString),
    };
  }
  console.log(JSON.stringify(output, null, 2));
  if (!output.pass) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
