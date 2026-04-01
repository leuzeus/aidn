#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeSharedRuntimeLocator } from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, args, env = {}) {
  const stdout = execFileSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function removeFilelessArtifacts(targetRoot) {
  for (const rel of [
    "docs/audit/CURRENT-STATE.md",
    "docs/audit/RUNTIME-STATE.md",
    "docs/audit/HANDOFF-PACKET.md",
    "docs/audit/sessions/S101-alpha.md",
    "docs/audit/cycles/C101-feature-alpha/status.md",
  ]) {
    fs.rmSync(path.join(targetRoot, rel), { force: true, recursive: false });
  }
}

function runRepairPreview(targetRoot, sqliteFile, env) {
  return runJson("tools/runtime/repair-layer.mjs", [
    "--target",
    targetRoot,
    "--index-file",
    sqliteFile,
    "--index-backend",
    "sqlite",
    "--json",
    "--no-report",
  ], env);
}

function assertRepairSummaryStable(before, after, prefix) {
  const checks = [
    ["sessions_count", before?.summary?.sessions_count, after?.summary?.sessions_count],
    ["artifact_links_count", before?.summary?.artifact_links_count, after?.summary?.artifact_links_count],
    ["session_cycle_links_count", before?.summary?.session_cycle_links_count, after?.summary?.session_cycle_links_count],
    ["migration_findings_count", before?.summary?.migration_findings_count, after?.summary?.migration_findings_count],
  ];
  for (const [field, left, right] of checks) {
    assert(left === right, `${prefix} repair summary drifted for ${field}`);
  }
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-db-first-"));
    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };
    const fixtureRoot = path.resolve(process.cwd(), "tests/fixtures/perf-handoff/ready");

    const sqliteTarget = path.join(tempRoot, "sqlite-file");
    fs.cpSync(fixtureRoot, sqliteTarget, { recursive: true });
    runJson("tools/perf/index-sync.mjs", [
      "--target",
      sqliteTarget,
      "--store",
      "sqlite",
      "--with-content",
      "--json",
    ], env);
    const sqliteLocalFile = path.join(sqliteTarget, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const sqliteSharedRoot = path.join(sqliteTarget, ".aidn-shared");
    const sqliteSharedFile = path.join(sqliteSharedRoot, "index", "workflow-index.sqlite");
    fs.mkdirSync(path.dirname(sqliteSharedFile), { recursive: true });
    fs.copyFileSync(sqliteLocalFile, sqliteSharedFile);
    writeSharedRuntimeLocator(sqliteTarget, {
      enabled: true,
      workspaceId: "workspace-bk15-sqlite",
      backend: {
        kind: "sqlite-file",
        root: ".aidn-shared",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    });
    const sqliteRepairBefore = runRepairPreview(sqliteTarget, sqliteSharedFile, env);
    fs.rmSync(sqliteLocalFile, { force: true });
    removeFilelessArtifacts(sqliteTarget);
    const sqliteRuntimeState = runJson("tools/runtime/project-runtime-state.mjs", [
      "--target",
      sqliteTarget,
      "--out",
      path.join(tempRoot, "sqlite-runtime-state.md"),
      "--json",
    ], env);
    const sqliteReadiness = runJson("tools/runtime/db-only-readiness.mjs", [
      "--target",
      sqliteTarget,
      "--json",
    ], env);
    const sqliteDbStatus = runJson("tools/runtime/db-status.mjs", [
      "--target",
      sqliteTarget,
      "--sqlite-file",
      ".aidn-shared/index/workflow-index.sqlite",
      "--json",
    ], env);
    const sqliteRepairAfter = runRepairPreview(sqliteTarget, sqliteSharedFile, env);

    assert(sqliteRuntimeState.shared_state_backend?.projection_scope === "shared-runtime-root", "sqlite-file runtime-state should expose shared-runtime-root projection");
    assert(sqliteRuntimeState.shared_state_backend?.coordination_backend_kind === "sqlite-file", "sqlite-file runtime-state should expose sqlite-file coordination backend");
    assert(sqliteRuntimeState.digest?.current_state_source === "sqlite", "sqlite-file runtime-state should resolve CURRENT-STATE from SQLite");
    assert(sqliteRuntimeState.digest?.cycle_status_source === "sqlite", "sqlite-file runtime-state should resolve cycle status from SQLite");
    assert(sqliteReadiness.summary?.status === "pass", "sqlite-file readiness should pass");
    assert(sqliteReadiness.operational?.sqlite_index?.projection_scope === "shared-runtime-root", "sqlite-file readiness should expose shared-runtime-root");
    assert(sqliteReadiness.operational?.sqlite_index?.coordination_backend_kind === "sqlite-file", "sqlite-file readiness should expose sqlite-file coordination backend");
    assert(sqliteReadiness.operational?.resolutions?.handoff_packet?.source === "sqlite", "sqlite-file readiness should resolve HANDOFF-PACKET from SQLite");
    assert(sqliteDbStatus.exists === true, "sqlite-file db-status should inspect the shared sqlite file when requested explicitly");
    assert(sqliteDbStatus.resolved_projection_backend?.projection_scope === "shared-runtime-root", "sqlite-file db-status should expose shared-runtime-root projection backend");
    assertRepairSummaryStable(sqliteRepairBefore, sqliteRepairAfter, "sqlite-file");

    const postgresTarget = path.join(tempRoot, "postgres");
    fs.cpSync(fixtureRoot, postgresTarget, { recursive: true });
    runJson("tools/perf/index-sync.mjs", [
      "--target",
      postgresTarget,
      "--store",
      "sqlite",
      "--with-content",
      "--json",
    ], env);
    const postgresLocalFile = path.join(postgresTarget, ".aidn", "runtime", "index", "workflow-index.sqlite");
    writeSharedRuntimeLocator(postgresTarget, {
      enabled: true,
      workspaceId: "workspace-bk15-postgres",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    });
    const postgresRepairBefore = runRepairPreview(postgresTarget, postgresLocalFile, env);
    removeFilelessArtifacts(postgresTarget);
    const postgresRuntimeState = runJson("tools/runtime/project-runtime-state.mjs", [
      "--target",
      postgresTarget,
      "--out",
      path.join(tempRoot, "postgres-runtime-state.md"),
      "--json",
    ], env);
    const postgresReadiness = runJson("tools/runtime/db-only-readiness.mjs", [
      "--target",
      postgresTarget,
      "--json",
    ], env);
    const postgresDbStatus = runJson("tools/runtime/db-status.mjs", [
      "--target",
      postgresTarget,
      "--json",
    ], env);
    const postgresRepairAfter = runRepairPreview(postgresTarget, postgresLocalFile, env);

    assert(postgresRuntimeState.shared_state_backend?.projection_scope === "local-compat", "postgres runtime-state should keep the local-compat SQLite projection");
    assert(postgresRuntimeState.shared_state_backend?.coordination_backend_kind === "postgres", "postgres runtime-state should expose postgres coordination backend");
    assert(postgresRuntimeState.digest?.current_state_source === "sqlite", "postgres runtime-state should resolve CURRENT-STATE from SQLite");
    assert(postgresRuntimeState.digest?.cycle_status_source === "sqlite", "postgres runtime-state should resolve cycle status from SQLite");
    assert(postgresReadiness.summary?.status === "pass", "postgres readiness should pass");
    assert(postgresReadiness.operational?.sqlite_index?.projection_scope === "local-compat", "postgres readiness should expose local-compat projection");
    assert(postgresReadiness.operational?.sqlite_index?.coordination_backend_kind === "postgres", "postgres readiness should expose postgres coordination backend");
    assert(postgresReadiness.operational?.resolutions?.session_artifact?.source === "sqlite", "postgres readiness should resolve session artifacts from SQLite");
    assert(postgresDbStatus.exists === true, "postgres db-status should keep inspecting the local SQLite projection");
    assert(postgresDbStatus.resolved_projection_backend?.projection_scope === "local-compat", "postgres db-status should expose local-compat resolved projection");
    assertRepairSummaryStable(postgresRepairBefore, postgresRepairAfter, "postgres");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
