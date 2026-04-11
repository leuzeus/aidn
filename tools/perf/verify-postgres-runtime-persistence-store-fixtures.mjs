#!/usr/bin/env node
import fs from "node:fs";
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
    assert(initialStatus.compatibility_status === "empty", "missing schema should report empty compatibility status");

    const migrated = await admin.migrateSchema();
    assert(migrated.ok === true, "migrate should succeed");
    assert(migrated.status.tables_missing.length === 0, "migrate should materialize runtime tables");
    assert(migrated.status.schema_version === 2, "migrate should expose relational target schema version");
    assert(migrated.status.applied_ids.includes("2"), "migrate should record relational target schema version");
    assert(migrated.status.pending_ids.length === 0, "migrate should not leave canonical migrations pending");
    assert(migrated.status.compatibility_status === "empty-relational", "migrate should report an empty relational-ready schema");

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
    assert(fake.state.runtimeSnapshots.size === 0, "canonical postgres writes should not require legacy runtime_snapshots rows");
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
    const backupPayload = JSON.parse(fs.readFileSync(backup.backup_file, "utf8"));
    assert(backupPayload.storage_policy === "relational-canonical", "backup should declare relational canonical storage policy");
    assert(backupPayload.snapshot?.payload?.summary?.artifacts_count === 2, "backup should materialize the canonical payload snapshot");

    const staleLegacyTargetRoot = "G:\\tmp\\runtime-store-stale-legacy";
    const staleLegacyFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: ["schema_migrations", "runtime_snapshots", "runtime_heads", "adoption_events", "index_meta", "artifacts"],
      initialSchemaMigrations: [1, 2],
      initialSnapshots: [{
        scope_key: staleLegacyTargetRoot,
        project_root_ref: staleLegacyTargetRoot,
        source_backend: "sqlite",
        adoption_status: "transferred",
        payload: {
          schema_version: 2,
          artifacts: [
            {
              path: "CURRENT-STATE.md",
              kind: "other",
              subtype: "current_state",
              sha256: "sha-stale",
              updated_at: "2026-04-05T11:50:00.000Z",
            },
          ],
          summary: {
            artifacts_count: 1,
          },
        },
      }],
    });
    const staleLegacyStore = createPostgresRuntimeArtifactStore({
      targetRoot: staleLegacyTargetRoot,
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: staleLegacyFake.factory,
    });
    await staleLegacyStore.writeIndexProjection({
      payload,
      sourceBackend: "sqlite",
      sourceSqliteFile: "G:\\tmp\\runtime-store-stale-legacy\\.aidn\\runtime\\index\\workflow-index.sqlite",
      adoptionStatus: "transferred",
      adoptionMetadata: {
        planner_action: "transfer-from-sqlite",
      },
    });
    assert(staleLegacyFake.state.runtimeSnapshots.size === 0, "canonical postgres writes should purge stale legacy runtime_snapshots rows");

    const legacyOnlyFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: ["schema_migrations", "runtime_snapshots", "runtime_heads", "adoption_events"],
      initialSchemaMigrations: [1],
      initialSnapshots: [{
        scope_key: "G:\\tmp\\runtime-store-legacy",
        project_root_ref: "G:\\tmp\\runtime-store-legacy",
        source_backend: "sqlite",
        adoption_status: "transferred",
        payload: {
          schema_version: 2,
          generated_at: "2026-04-05T12:10:00.000Z",
          target_root: "G:\\tmp\\runtime-store-legacy",
          artifacts: [
            {
              path: "CURRENT-STATE.md",
              kind: "other",
              subtype: "current_state",
              sha256: "sha-legacy",
              updated_at: "2026-04-05T12:10:00.000Z",
            },
          ],
          summary: {
            artifacts_count: 1,
          },
        },
      }],
    });
    const legacyAdmin = createPostgresRuntimePersistenceAdmin({
      targetRoot: "G:\\tmp\\runtime-store-legacy",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: legacyOnlyFake.factory,
    });
    const legacyStore = createPostgresRuntimeArtifactStore({
      targetRoot: "G:\\tmp\\runtime-store-legacy",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: legacyOnlyFake.factory,
    });
    const legacyDirectRead = await legacyStore.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: false,
    });
    assert(legacyDirectRead.exists === false, "legacy snapshot rows should stay hidden from canonical runtime reads by default");
    const legacyBackup = await legacyAdmin.backupPersistence();
    assert(legacyBackup.ok === true, "legacy backup should succeed through admin compatibility fallback");
    assert(legacyBackup.compatibility_fallback_used === true, "legacy backup should expose explicit compatibility fallback usage");
    const legacyBackupPayload = JSON.parse(fs.readFileSync(legacyBackup.backup_file, "utf8"));
    assert(legacyBackupPayload.compatibility_fallback_used === true, "legacy backup payload should declare explicit compatibility fallback usage");
    const legacyStatusBefore = await legacyAdmin.inspectSchema();
    assert(legacyStatusBefore.compatibility_status === "legacy-only", "legacy-only schema should report legacy-only compatibility status");
    const legacyMigrated = await legacyAdmin.migrateSchema();
    assert(legacyMigrated.migration.backfill?.legacy_snapshot_backfill === true, "migrate should backfill canonical rows from a legacy snapshot");
    assert(legacyMigrated.status.canonical_payload_rows === 1, "legacy backfill should materialize a canonical payload row");
    assert(legacyMigrated.status.legacy_snapshot_rows === 0, "legacy backfill should drain legacy snapshot rows after canonical migration");
    assert(legacyMigrated.status.compatibility_status === "relational-ready", "legacy backfill should converge to relational-ready compatibility status");
    assert(legacyOnlyFake.state.relationalRows.artifacts.length === 1, "legacy backfill should materialize relational artifacts");
    assert(legacyOnlyFake.state.runtimeSnapshots.size === 0, "legacy backfill should purge legacy runtime_snapshots rows");
    const postMigrationBackup = await legacyAdmin.backupPersistence();
    assert(postMigrationBackup.compatibility_fallback_used === false, "post-migration backup should no longer require legacy compatibility fallback");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
