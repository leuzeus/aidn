#!/usr/bin/env node
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createPostgresRuntimePersistenceAdmin } from "../../src/adapters/runtime/postgres-runtime-persistence-admin.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  try {
    const fake = createRuntimePersistenceFakePgClientFactory();
    const admin = createPostgresRuntimePersistenceAdmin({
      targetRoot: "/tmp/runtime-store",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
    });
    const store = createPostgresRuntimeArtifactStore({
      targetRoot: "/tmp/runtime-store",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
    });

    const initialStatus = await admin.inspectSchema();
    assert(initialStatus.ok === true, "status should succeed before bootstrap");
    assert(initialStatus.exists === false, "status should start with missing schema");

    const migrated = await admin.migrateSchema();
    assert(migrated.ok === true, "migrate should succeed");
    assert(migrated.status.tables_missing.length === 0, "migrate should materialize runtime tables");

    const payload = {
      schema_version: 2,
      generated_at: "2026-04-05T12:00:00.000Z",
      artifacts: [
        {
          path: "CURRENT-STATE.md",
          kind: "other",
          subtype: "current_state",
          sha256: "sha-current",
          updated_at: "2026-04-05T12:00:00.000Z",
        },
        {
          path: "RUNTIME-STATE.md",
          kind: "other",
          subtype: "runtime_state",
          sha256: "sha-runtime",
          updated_at: "2026-04-05T12:05:00.000Z",
        },
      ],
      summary: {
        artifacts_count: 2,
      },
    };

    const writeOutputs = await store.writeIndexProjection({
      payload,
      sourceBackend: "sqlite",
      sourceSqliteFile: "/tmp/runtime-store/.aidn/runtime/index/workflow-index.sqlite",
      adoptionStatus: "transferred",
      adoptionMetadata: {
        planner_action: "transfer-from-sqlite",
      },
    });
    assert(Array.isArray(writeOutputs) && writeOutputs[0]?.kind === "postgres", "write should return a postgres output");

    const snapshot = await store.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: true,
    });
    assert(snapshot.exists === true, "snapshot should exist after write");
    assert(snapshot.payload?.summary?.artifacts_count === 2, "snapshot should expose payload summary");
    assert(snapshot.payload_digest && snapshot.payload_digest.length > 10, "snapshot should expose a payload digest");
    assert(snapshot.runtimeHeads.current_state?.artifact_path === "CURRENT-STATE.md", "runtime heads should expose current_state");
    assert(snapshot.runtimeHeads.runtime_state?.artifact_path === "RUNTIME-STATE.md", "runtime heads should expose runtime_state");
    assert(snapshot.source_backend === "sqlite", "snapshot should retain source backend");
    assert(snapshot.source_sqlite_file?.endsWith("workflow-index.sqlite"), "snapshot should retain source sqlite file");
    assert(snapshot.adoption_status === "transferred", "snapshot should retain adoption status");

    const event = await store.recordAdoptionEvent({
      action: "transfer-from-sqlite",
      status: "applied",
      sourceBackend: "sqlite",
      targetBackend: "postgres",
      sourcePayloadDigest: snapshot.payload_digest,
      targetPayloadDigest: snapshot.payload_digest,
      payload: {
        note: "fixture",
      },
    });
    assert(event.ok === true, "adoption event should be recorded");
    assert(fake.state.adoptionEvents.length === 1, "fake state should capture adoption events");

    const backup = await admin.backupPersistence();
    assert(backup.ok === true, "backup should succeed");
    assert(typeof backup.backup_file === "string" && backup.backup_file.endsWith(".json"), "backup should materialize a json file");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
