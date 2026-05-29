#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  loadSharedStateSnapshot,
  loadSharedStateSnapshotAsync,
} from "../../src/application/runtime/shared-state-backend-service.mjs";
import { assessDbOnlyReadiness } from "../../src/application/runtime/db-only-readiness-service.mjs";
import { createRuntimeArtifactStore } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { writeSharedRuntimeLocator } from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";
import { projectRuntimeState } from "../runtime/project-runtime-state.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
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

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-state-backend-"));
    const targetRoot = path.join(tempRoot, "repo");
    const sharedRoot = path.join(targetRoot, ".aidn-shared");
    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/perf-handoff/ready"), targetRoot, { recursive: true });

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      targetRoot,
      "--store",
      "sqlite",
      "--with-content",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    const localSnapshot = loadSharedStateSnapshot({
      targetRoot,
    });
    assert(localSnapshot.exists === true, "local shared state snapshot should resolve from the local sqlite projection by default");
    assert(localSnapshot.backend?.projection_scope === "local-target", "local shared state snapshot should expose local-target projection scope");
    assert(String(localSnapshot.sqliteFile ?? "").replace(/\\/g, "/").endsWith("/.aidn/runtime/index/workflow-index.sqlite"), "local shared state snapshot should point to the local sqlite file");

    const localSqliteFile = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const sharedSqliteFile = path.join(sharedRoot, "index", "workflow-index.sqlite");
    fs.mkdirSync(path.dirname(sharedSqliteFile), { recursive: true });
    fs.copyFileSync(localSqliteFile, sharedSqliteFile);
    writeSharedRuntimeLocator(targetRoot, {
      enabled: true,
      workspaceId: "workspace-shared-state",
      backend: {
        kind: "sqlite-file",
        root: ".aidn-shared",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    });

    fs.rmSync(localSqliteFile, { force: true });
    fs.rmSync(path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md"), { force: true });
    fs.rmSync(path.join(targetRoot, "docs", "audit", "sessions", "S101-alpha.md"), { force: true });
    fs.rmSync(path.join(targetRoot, "docs", "audit", "cycles", "C101-feature-alpha", "status.md"), { force: true });

    const snapshot = loadSharedStateSnapshot({
      targetRoot,
    });
    assert(snapshot.exists === true, "shared state snapshot should resolve from shared sqlite");
    assert(snapshot.backend?.projection_scope === "shared-runtime-root", "shared state snapshot should expose shared-runtime-root projection scope");
    assert(String(snapshot.sqliteFile ?? "").replace(/\\/g, "/").endsWith("/.aidn-shared/index/workflow-index.sqlite"), "shared state snapshot should point to shared sqlite file");

    const handoff = runJson("tools/runtime/project-handoff-packet.mjs", [
      "--target",
      targetRoot,
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    assert(handoff.shared_state_backend?.projection_scope === "shared-runtime-root", "handoff should expose shared runtime projection scope");
    assert(handoff.packet.current_state_source === "sqlite", "handoff should keep loading CURRENT-STATE from sqlite");
    assert(handoff.packet.session_file === "docs/audit/sessions/S101-alpha.md", "handoff should recover session artifact via shared sqlite");

    const preWrite = runJson("bin/aidn.mjs", [
      "runtime",
      "pre-write-admit",
      "--target",
      targetRoot,
      "--skill",
      "requirements-delta",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    assert(preWrite.ok === true, "pre-write admission should still pass through shared sqlite backend");
    assert(preWrite.shared_state_backend?.projection_scope === "shared-runtime-root", "pre-write should expose shared runtime projection scope");
    assert(preWrite.context.current_state_source === "sqlite", "pre-write should resolve current state from shared sqlite");

    const postgresTarget = path.join(tempRoot, "postgres");
    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/perf-handoff/ready"), postgresTarget, { recursive: true });
    runJson("tools/perf/index-sync.mjs", [
      "--target",
      postgresTarget,
      "--store",
      "sqlite",
      "--with-content",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    writeSharedRuntimeLocator(postgresTarget, {
      enabled: true,
      workspaceId: "workspace-postgres-compat",
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    });
    const postgresSnapshot = loadSharedStateSnapshot({
      targetRoot: postgresTarget,
    });
    assert(postgresSnapshot.exists === true, "postgres compatibility snapshot should keep using the local sqlite projection");
    assert(postgresSnapshot.backend?.coordination_backend_kind === "postgres", "postgres compatibility snapshot should expose postgres coordination backend");
    assert(postgresSnapshot.backend?.projection_scope === "local-compat", "postgres compatibility snapshot should expose local-compat projection scope");

    const postgresNoneTarget = path.join(tempRoot, "postgres-none");
    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/perf-handoff/ready"), postgresNoneTarget, { recursive: true });
    runJson("tools/perf/index-sync.mjs", [
      "--target",
      postgresNoneTarget,
      "--store",
      "sqlite",
      "--with-content",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    const postgresNoneLocalSnapshot = loadSharedStateSnapshot({
      targetRoot: postgresNoneTarget,
    });
    const fakePg = createRuntimePersistenceFakePgClientFactory();
    const postgresCanonicalStore = createRuntimeArtifactStore({
      targetRoot: postgresNoneTarget,
      backend: "postgres",
      connectionString: "postgres://fake/runtime-none",
      clientFactory: fakePg.factory,
    });
    await postgresCanonicalStore.writeIndexProjection({
      payload: postgresNoneLocalSnapshot.payload,
    });
    fs.rmSync(path.join(postgresNoneTarget, ".aidn", "runtime", "index", "workflow-index.sqlite"), { force: true });
    fs.rmSync(path.join(postgresNoneTarget, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(postgresNoneTarget, "docs", "audit", "RUNTIME-STATE.md"), { force: true });
    fs.rmSync(path.join(postgresNoneTarget, "docs", "audit", "sessions", "S101-alpha.md"), { force: true });
    fs.rmSync(path.join(postgresNoneTarget, "docs", "audit", "cycles", "C101-feature-alpha", "status.md"), { force: true });

    const postgresCanonicalSnapshot = await loadSharedStateSnapshotAsync({
      targetRoot: postgresNoneTarget,
      backend: "postgres",
      connectionString: "postgres://fake/runtime-none",
      localProjectionPolicy: "none",
      clientFactory: fakePg.factory,
    });
    assert(postgresCanonicalSnapshot.exists === true, "postgres runtime-canonical snapshot should load without a local sqlite projection");
    assert(postgresCanonicalSnapshot.backend?.projection_backend_kind === "postgres", "postgres runtime-canonical snapshot should expose postgres as projection backend");
    assert(postgresCanonicalSnapshot.backend?.projection_scope === "runtime-canonical", "postgres runtime-canonical snapshot should expose runtime-canonical projection scope");

    const sharedStateOptions = {
      backend: "postgres",
      connectionString: "postgres://fake/runtime-none",
      localProjectionPolicy: "none",
      clientFactory: fakePg.factory,
    };
    const runtimeState = await withEnv({
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    }, async () => await projectRuntimeState({
      targetRoot: postgresNoneTarget,
      out: path.join(tempRoot, "postgres-none-runtime-state.md"),
      sharedStateOptions,
    }));
    assert(runtimeState.shared_state_backend?.projection_scope === "runtime-canonical", "runtime-state should expose runtime-canonical projection when localProjectionPolicy=none");
    assert(runtimeState.digest?.current_state_source === "postgres", "runtime-state should resolve CURRENT-STATE from postgres when localProjectionPolicy=none");
    assert(runtimeState.digest?.cycle_status_source === "postgres", "runtime-state should resolve cycle status from postgres when localProjectionPolicy=none");

    const readiness = await withEnv({
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    }, async () => await assessDbOnlyReadiness({
      targetRoot: postgresNoneTarget,
      sharedStateOptions,
    }));
    assert(readiness.status === "pass", "db-only readiness should pass through the postgres runtime-canonical projection");
    assert(readiness.sqlite_index?.projection_scope === "runtime-canonical", "db-only readiness should report runtime-canonical projection scope when localProjectionPolicy=none");
    assert(readiness.resolutions?.current_state?.source === "postgres", "db-only readiness should resolve CURRENT-STATE from postgres when localProjectionPolicy=none");

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

Promise.resolve().then(main).catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
