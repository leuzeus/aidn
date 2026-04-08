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
    await client.query("DELETE FROM aidn_runtime.runtime_heads WHERE scope_key = $1", [scopeKey]);
    await client.query("DELETE FROM aidn_runtime.adoption_events WHERE scope_key = $1", [scopeKey]);
    await client.query("DELETE FROM aidn_runtime.runtime_snapshots WHERE scope_key = $1", [scopeKey]);
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

    const client = new Client({ connectionString });
    await client.connect();
    let snapshotRows = [];
    let eventRows = [];
    try {
      snapshotRows = (await client.query(
        `
        SELECT scope_key, payload_digest, adoption_status, source_backend, updated_at
        FROM aidn_runtime.runtime_snapshots
        WHERE scope_key = $1
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
        tables_missing: status.payload?.tables_missing ?? null,
        adoption_plan_action: status.payload?.runtime_backend_adoption_plan?.action ?? null,
      },
      backup: {
        status: backup.status,
        backup_file: backup.payload?.backup_file ?? null,
      },
      live_db: {
        runtime_snapshot_rows: snapshotRows,
        adoption_events: eventRows,
      },
    };

    const checks = {
      index_sync_ok: indexSync.status === 0,
      adopt_transfer_applied: adopt.payload?.runtime_backend_adoption_plan?.action === "transfer-from-sqlite"
        && adopt.payload?.runtime_backend_adoption?.verification?.ok === true,
      status_reports_postgres: status.payload?.runtime_persistence?.backend === "postgres",
      status_reports_ready_schema: Array.isArray(status.payload?.tables_missing) && status.payload.tables_missing.length === 0,
      status_reports_snapshot_row: Number(status.payload?.payload_rows ?? 0) === 1,
      status_reports_noop_after_transfer: status.payload?.runtime_backend_adoption_plan?.action === "noop",
      backup_ok: backup.payload?.ok === true && typeof backup.payload?.backup_file === "string",
      live_snapshot_written: snapshotRows.length === 1 && normalizeScalar(snapshotRows[0]?.adoption_status) === "transferred",
      live_event_recorded: eventRows.length >= 1 && normalizeScalar(eventRows[0]?.action) === "transfer-from-sqlite",
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
