#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { buildNextAidnProjectConfig } from "../../src/application/install/project-config-service.mjs";
import { readAidnProjectConfig, writeAidnProjectConfig } from "../../src/lib/config/aidn-config-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(repoRoot, scriptRelative, args, env = {}) {
  const result = spawnSync(process.execPath, [path.resolve(repoRoot, scriptRelative), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
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

async function cleanupScope(connectionString, scopeKey) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const tableName of [
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
    ]) {
      try {
        await client.query(`DELETE FROM aidn_runtime.${tableName} WHERE scope_key = $1`, [scopeKey]);
      } catch (error) {
        if (String(error?.code ?? "") !== "42P01") {
          throw error;
        }
      }
    }
    for (const tableName of ["adoption_events", "runtime_snapshots"]) {
      try {
        await client.query(`DELETE FROM aidn_runtime.${tableName} WHERE scope_key = $1`, [scopeKey]);
      } catch (error) {
        if (String(error?.code ?? "") !== "42P01") {
          throw error;
        }
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  let tempRoot = "";
  try {
    const connectionString = normalizeScalar(process.env.AIDN_RUNTIME_PG_SMOKE_URL || process.env.AIDN_PG_SMOKE_URL);
    if (!connectionString) {
      console.log(JSON.stringify({
        ok: true,
        skipped: true,
        reason: "AIDN_RUNTIME_PG_SMOKE_URL or AIDN_PG_SMOKE_URL is not set",
      }, null, 2));
      return;
    }

    const repoRoot = process.cwd();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-pg-smoke-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(path.resolve(repoRoot, "tests", "fixtures", "repo-installed-core"), targetRoot, { recursive: true });
    fs.rmSync(path.join(targetRoot, ".aidn", "runtime"), { recursive: true, force: true });

    const env = {
      AIDN_RUNTIME_PG_SMOKE_URL: connectionString,
    };

    await cleanupScope(connectionString, targetRoot);

    const indexSync = runJson(repoRoot, "tools/perf/index-sync.mjs", [
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

    const adopt = runJson(repoRoot, "bin/aidn.mjs", [
      "runtime",
      "persistence-adopt",
      "--target",
      targetRoot,
      "--json",
    ], env);
    assert(adopt.status === 0, "live persistence-adopt should succeed");

    const status = runJson(repoRoot, "bin/aidn.mjs", [
      "runtime",
      "persistence-status",
      "--target",
      targetRoot,
      "--json",
    ], env);
    assert(status.status === 0, "live persistence-status should succeed");

    const backup = runJson(repoRoot, "bin/aidn.mjs", [
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
    fs.rmSync(path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite"), { force: true });
    fs.rmSync(path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(targetRoot, "docs", "audit", "HANDOFF-PACKET.md"), { force: true });
    fs.rmSync(path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md"), { force: true });

    const runtimeState = runJson(repoRoot, "tools/runtime/project-runtime-state.mjs", [
      "--target",
      targetRoot,
      "--json",
    ], env);
    assert(runtimeState.status === 0, "live runtime-state should succeed with runtime-canonical postgres projection");

    const dbOnlyReadiness = runJson(repoRoot, "tools/runtime/db-only-readiness.mjs", [
      "--target",
      targetRoot,
      "--json",
    ], env);
    assert(dbOnlyReadiness.status === 0, "live db-only-readiness should succeed with runtime-canonical postgres projection");

    const handoff = runJson(repoRoot, "tools/runtime/project-handoff-packet.mjs", [
      "--target",
      targetRoot,
      "--json",
    ], env);
    assert(handoff.status === 0, "live handoff packet should succeed with runtime-canonical postgres projection");

    const client = new Client({ connectionString });
    await client.connect();
    let snapshotRows = [];
    let eventRows = [];
    let canonicalMetaRows = [];
    let canonicalArtifactRows = [];
    try {
      try {
        snapshotRows = (await client.query(
          `
          SELECT scope_key, payload_digest, adoption_status, source_backend, updated_at
          FROM aidn_runtime.runtime_snapshots
          WHERE scope_key = $1
          `,
          [targetRoot],
        )).rows;
      } catch (error) {
        if (String(error?.code ?? "") !== "42P01") {
          throw error;
        }
      }
      canonicalMetaRows = (await client.query(
        `
        SELECT key, value, updated_at
        FROM aidn_runtime.index_meta
        WHERE scope_key = $1
        ORDER BY key ASC
        `,
        [targetRoot],
      )).rows;
      canonicalArtifactRows = (await client.query(
        `
        SELECT artifact_id, path, subtype, updated_at
        FROM aidn_runtime.artifacts
        WHERE scope_key = $1
        ORDER BY path ASC
        `,
        [targetRoot],
      )).rows;
      eventRows = (await client.query(
        `
        SELECT event_id, action, status, source_backend, target_backend, created_at
        FROM aidn_runtime.adoption_events
        WHERE scope_key = $1
        ORDER BY created_at DESC
        `,
        [targetRoot],
      )).rows;
    } finally {
      await client.end();
    }

    const output = {
      ok: true,
      skipped: false,
      target_root: targetRoot,
      index_sync: {
        status: indexSync.status,
        payload_digest: indexSync.payload?.payload_digest ?? null,
      },
      adopt: {
        status: adopt.status,
        action: adopt.payload?.runtime_backend_adoption_plan?.action ?? null,
        execution_status: adopt.payload?.runtime_backend_adoption?.execution_status ?? null,
        verification: adopt.payload?.runtime_backend_adoption?.verification ?? null,
      },
      status: {
        status: status.status,
        backend: status.payload?.runtime_persistence?.backend ?? null,
        payload_rows: status.payload?.payload_rows ?? null,
        canonical_payload_rows: status.payload?.canonical_payload_rows ?? null,
        legacy_snapshot_rows: status.payload?.legacy_snapshot_rows ?? null,
        storage_policy: status.payload?.storage_policy ?? null,
        compatibility_status: status.payload?.compatibility_status ?? null,
        tables_missing: status.payload?.tables_missing ?? null,
        adoption_plan_action: status.payload?.runtime_backend_adoption_plan?.action ?? null,
      },
      backup: {
        status: backup.status,
        backup_file: backup.payload?.backup_file ?? null,
      },
      runtime_canonical: {
        runtime_state: {
          status: runtimeState.status,
          projection_backend: runtimeState.payload?.shared_state_backend?.projection_backend_kind ?? null,
          projection_scope: runtimeState.payload?.shared_state_backend?.projection_scope ?? null,
          current_state_source: runtimeState.payload?.digest?.current_state_source ?? null,
        },
        db_only_readiness: {
          status: dbOnlyReadiness.status,
          summary: dbOnlyReadiness.payload?.summary?.status ?? null,
          projection_scope: dbOnlyReadiness.payload?.operational?.sqlite_index?.projection_scope ?? null,
          current_state_source: dbOnlyReadiness.payload?.operational?.resolutions?.current_state?.source ?? null,
          handoff_packet_source: dbOnlyReadiness.payload?.operational?.resolutions?.handoff_packet?.source ?? null,
        },
        handoff: {
          status: handoff.status,
          projection_backend: handoff.payload?.shared_state_backend?.projection_backend_kind ?? null,
          projection_scope: handoff.payload?.shared_state_backend?.projection_scope ?? null,
          current_state_source: handoff.payload?.packet?.current_state_source ?? null,
        },
      },
      live_db: {
        runtime_snapshot_rows: snapshotRows,
        canonical_index_meta_rows: canonicalMetaRows,
        canonical_artifact_rows: canonicalArtifactRows,
        adoption_events: eventRows,
      },
    };

    const checks = {
      index_sync_ok: indexSync.status === 0,
      adopt_transfer_applied: adopt.payload?.runtime_backend_adoption_plan?.action === "transfer-from-sqlite"
        && adopt.payload?.runtime_backend_adoption?.verification?.ok === true,
      status_reports_postgres: status.payload?.runtime_persistence?.backend === "postgres",
      status_reports_relational_canonical_storage: status.payload?.storage_policy === "relational-canonical",
      status_reports_relational_ready_compatibility: status.payload?.compatibility_status === "relational-ready",
      status_reports_ready_schema: Array.isArray(status.payload?.tables_missing) && status.payload.tables_missing.length === 0,
      status_reports_canonical_payload_row: Number(status.payload?.canonical_payload_rows ?? 0) === 1,
      status_reports_noop_after_transfer: status.payload?.runtime_backend_adoption_plan?.action === "noop",
      backup_ok: backup.payload?.ok === true && typeof backup.payload?.backup_file === "string",
      live_canonical_meta_written: canonicalMetaRows.some((row) => normalizeScalar(row.key) === "payload_schema_version"),
      live_canonical_artifacts_written: canonicalArtifactRows.length > 0,
      live_snapshot_compat_optional: snapshotRows.length === 0
        || (snapshotRows.length === 1 && normalizeScalar(snapshotRows[0]?.adoption_status) === "transferred"),
      live_event_recorded: eventRows.length >= 1 && normalizeScalar(eventRows[0]?.action) === "transfer-from-sqlite",
      runtime_canonical_runtime_state_scope: runtimeState.payload?.shared_state_backend?.projection_scope === "runtime-canonical",
      runtime_canonical_runtime_state_backend: runtimeState.payload?.shared_state_backend?.projection_backend_kind === "postgres",
      runtime_canonical_current_state_source: runtimeState.payload?.digest?.current_state_source === "postgres",
      runtime_canonical_readiness_pass: dbOnlyReadiness.payload?.summary?.status === "pass",
      runtime_canonical_readiness_scope: dbOnlyReadiness.payload?.operational?.sqlite_index?.projection_scope === "runtime-canonical",
      runtime_canonical_readiness_current_state_source: dbOnlyReadiness.payload?.operational?.resolutions?.current_state?.source === "postgres",
      runtime_canonical_readiness_handoff_source: dbOnlyReadiness.payload?.operational?.resolutions?.handoff_packet?.source === "postgres",
      runtime_canonical_handoff_scope: handoff.payload?.shared_state_backend?.projection_scope === "runtime-canonical",
      runtime_canonical_handoff_current_state_source: handoff.payload?.packet?.current_state_source === "postgres",
    };
    output.checks = checks;
    output.pass = Object.values(checks).every((value) => value === true);

    console.log(JSON.stringify(output, null, 2));
    if (!output.pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    const connectionString = normalizeScalar(process.env.AIDN_RUNTIME_PG_SMOKE_URL || process.env.AIDN_PG_SMOKE_URL);
    const targetRoot = tempRoot ? path.join(tempRoot, "repo") : "";
    if (connectionString && targetRoot) {
      try {
        await cleanupScope(connectionString, targetRoot);
      } catch {
      }
    }
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

await main();
