#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planRuntimeBackendAdoption, executeRuntimeBackendAdoption } from "../../src/application/runtime/runtime-backend-adoption-service.mjs";
import { createIndexStore } from "../../src/lib/index/index-store.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const READY_RELATIONAL_TABLES = [
  "schema_migrations",
  "runtime_heads",
  "adoption_events",
  "index_meta",
  "cycles",
  "artifacts",
  "sessions",
  "file_map",
  "tags",
  "artifact_tags",
  "run_metrics",
  "artifact_links",
  "cycle_links",
  "session_cycle_links",
  "session_links",
  "repair_decisions",
  "migration_runs",
  "migration_findings",
  "artifact_blobs",
];

const LEGACY_COMPAT_TABLES = [
  "schema_migrations",
  "runtime_snapshots",
  "runtime_heads",
  "adoption_events",
];

async function main() {
  let tempRoot = "";
  try {
    const transferFake = createRuntimePersistenceFakePgClientFactory();
    const transferPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-installed-core",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: transferFake.factory,
    });
    assert(transferPlan.action === "transfer-from-sqlite", "missing target schema with sqlite source should require transfer");
    assert(transferPlan.prerequisites.includes("bootstrap-target"), "missing target schema should require bootstrap before transfer");

    const transferExecution = await executeRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-installed-core",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: transferFake.factory,
      plan: transferPlan,
      write: true,
    });
    assert(transferExecution.ok === true, "transfer execution should succeed");
    assert(transferExecution.verification?.ok === true, "transfer execution should verify digests");
    assert(transferFake.state.relationalRows.index_meta.some((row) => row.key === "payload_schema_version"), "transfer execution should persist canonical runtime metadata");
    assert(transferFake.state.relationalRows.artifacts.length > 0, "transfer execution should persist canonical runtime artifacts");
    assert(transferFake.state.adoptionEvents.length === 1, "transfer execution should record one adoption event");

    const emptyReadyFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: READY_RELATIONAL_TABLES,
      initialSchemaMigrations: [2],
    });
    const emptyReadyPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-empty",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: emptyReadyFake.factory,
      sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    });
    assert(emptyReadyPlan.action === "noop", "empty target with no sqlite source should stay noop");
    assert(emptyReadyPlan.target?.canonical_payload_rows === 0, "empty ready target should expose zero canonical payload rows");
    assert(emptyReadyPlan.target?.compatibility_status === "empty-relational", "empty canonical target should expose empty-relational compatibility status");

    const partialSchemaFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: ["schema_migrations", "runtime_snapshots"],
      initialSchemaMigrations: [],
    });
    const partialSchemaPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-installed-core",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: partialSchemaFake.factory,
    });
    assert(partialSchemaPlan.action === "blocked-conflict", "partial target schema with sqlite source should block");
    assert(partialSchemaPlan.blocked === true, "partial target schema should be marked blocked");

    const legacyRepairFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: ["schema_migrations", "runtime_snapshots", "runtime_heads", "adoption_events"],
      initialSchemaMigrations: [1],
      initialSnapshots: [{
        scope_key: "G:\\projets\\aidn\\tests\\fixtures\\repo-empty",
        project_root_ref: "G:\\projets\\aidn\\tests\\fixtures\\repo-empty",
        source_backend: "sqlite",
        adoption_status: "transferred",
        payload: {
          schema_version: 2,
          artifacts: [
            {
              path: "CURRENT-STATE.md",
              kind: "other",
              subtype: "current_state",
              sha256: "sha-legacy-repair",
              updated_at: "2026-03-11T18:12:00.000Z",
            },
          ],
          summary: {
            artifacts_count: 1,
          },
        },
      }],
    });
    const legacyRepairPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-empty",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: legacyRepairFake.factory,
      sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    });
    assert(legacyRepairPlan.action === "repair-target", "legacy-only target without sqlite source should be repairable");
    assert(legacyRepairPlan.target?.compatibility_status === "legacy-only", "legacy-only target should expose legacy-only compatibility status");
    const legacyRepairExecution = await executeRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-empty",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: legacyRepairFake.factory,
      sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
      plan: legacyRepairPlan,
      write: true,
    });
    assert(legacyRepairExecution.ok === true, "legacy-only target repair should succeed");
    assert(legacyRepairExecution.migration?.migration?.backfill?.legacy_snapshot_backfill === true, "legacy-only target repair should backfill canonical rows");
    assert(legacyRepairFake.state.relationalRows.artifacts.length === 1, "legacy-only target repair should materialize canonical relational artifacts");
    assert(legacyRepairFake.state.runtimeSnapshots.size === 0, "legacy-only target repair should purge legacy snapshot rows");
    const legacyRepairReadyPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-empty",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: legacyRepairFake.factory,
      sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    });
    assert(legacyRepairReadyPlan.action === "noop", "legacy-only target repair should leave a canonical ready target");
    assert(legacyRepairReadyPlan.target?.canonical_payload_rows === 1, "legacy-only target repair should expose one canonical payload row");
    assert(legacyRepairReadyPlan.target?.legacy_snapshot_rows === 0, "legacy-only target repair should expose zero remaining legacy snapshot rows");
    assert(legacyRepairReadyPlan.target?.compatibility_status === "relational-ready", "legacy-only target repair should converge to relational-ready compatibility status");

    const matchingPayloadFake = createRuntimePersistenceFakePgClientFactory({
      initialTables: LEGACY_COMPAT_TABLES,
      initialSchemaMigrations: [1],
      initialSnapshots: [{
        scope_key: "G:\\projets\\aidn\\tests\\fixtures\\repo-installed-core",
        project_root_ref: "G:\\projets\\aidn\\tests\\fixtures\\repo-installed-core",
        payload: {
          schema_version: 2,
          artifacts: [
            {
              path: "CURRENT-STATE.md",
              kind: "other",
              subtype: "current_state",
              sha256: "sha-fixture-current",
              updated_at: "2026-03-11T18:12:00.000Z",
            },
          ],
          summary: {
            artifacts_count: 1,
          },
        },
      }],
    });
    const matchingPlan = await planRuntimeBackendAdoption({
      targetRoot: "tests/fixtures/repo-installed-core",
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: matchingPayloadFake.factory,
    });
    assert(matchingPlan.action === "transfer-from-sqlite", "legacy-only target rows should not block canonical transfer");
    assert(matchingPlan.reason_code === "legacy-only-target-transfer", "legacy-only target should expose the canonical transfer reason code");
    assert(matchingPlan.prerequisites.includes("migrate-target"), "legacy-only target transfer should require canonical schema migration first");
    assert(matchingPlan.target?.compatibility_status === "legacy-only", "legacy-only target transfer should expose legacy-only compatibility status");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-backend-adoption-"));
    const ambiguousTarget = path.join(tempRoot, "ambiguous-source");
    fs.mkdirSync(ambiguousTarget, { recursive: true });
    const ambiguousSqlite = path.join(ambiguousTarget, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const ambiguousStore = createIndexStore({
      mode: "sqlite",
      sqliteOutput: ambiguousSqlite,
    });
    ambiguousStore.write({
      schema_version: 2,
      cycles: [
        {
          cycle_id: "C004",
          session_id: "S004",
          state: "ACTIVE",
          outcome: null,
          branch_name: "feature/c004",
          dor_state: "READY",
          updated_at: "2026-04-09T00:00:00.000Z",
        },
      ],
      artifacts: [
        {
          path: "cycles/C004-first/status.md",
          kind: "cycle_status",
          family: "normative",
          subtype: "status",
          gate_relevance: 1,
          classification_reason: null,
          content_format: "utf8",
          content: "# status\n",
          canonical_format: null,
          canonical: null,
          sha256: "sha-c004-first",
          size_bytes: 9,
          mtime_ns: 1,
          session_id: "S004",
          cycle_id: "C004",
          source_mode: "explicit",
          entity_confidence: 1,
          legacy_origin: null,
          updated_at: "2026-04-09T00:00:00.000Z",
        },
        {
          path: "cycles/C004-second/status.md",
          kind: "cycle_status",
          family: "normative",
          subtype: "status",
          gate_relevance: 1,
          classification_reason: null,
          content_format: "utf8",
          content: "# status\n",
          canonical_format: null,
          canonical: null,
          sha256: "sha-c004-second",
          size_bytes: 9,
          mtime_ns: 2,
          session_id: "S004",
          cycle_id: "C004",
          source_mode: "explicit",
          entity_confidence: 1,
          legacy_origin: null,
          updated_at: "2026-04-09T00:00:01.000Z",
        },
      ],
      file_map: [
        {
          cycle_id: "C004",
          path: "cycles/C004-first/status.md",
          role: "status",
          relation: "normative",
          last_seen_at: "2026-04-09T00:00:00.000Z",
        },
        {
          cycle_id: "C004",
          path: "cycles/C004-second/status.md",
          role: "status",
          relation: "normative",
          last_seen_at: "2026-04-09T00:00:01.000Z",
        },
      ],
      tags: [],
      artifact_tags: [],
      run_metrics: [],
      artifact_links: [],
      cycle_links: [],
      session_cycle_links: [],
      session_links: [],
      migration_runs: [],
      migration_findings: [],
      repair_decisions: [],
      summary: {
        cycles_count: 1,
        sessions_count: 0,
        artifacts_count: 2,
        file_map_count: 2,
        tags_count: 0,
        run_metrics_count: 0,
        artifact_links_count: 0,
        cycle_links_count: 0,
        session_cycle_links_count: 0,
        session_links_count: 0,
        migration_runs_count: 0,
        migration_findings_count: 0,
        repair_decisions_count: 0,
        structure_kind: "unknown",
        artifacts_with_content_count: 2,
        artifacts_with_canonical_count: 0,
      },
    });
    const ambiguousFake = createRuntimePersistenceFakePgClientFactory();
    const ambiguousPlan = await planRuntimeBackendAdoption({
      targetRoot: ambiguousTarget,
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: ambiguousFake.factory,
      sqliteFile: ambiguousSqlite,
    });
    assert(ambiguousPlan.action === "blocked-conflict", "duplicate cycle directories in sqlite source should block canonical postgres transfer");
    assert(ambiguousPlan.reason_code === "source-cycle-identity-ambiguous", "duplicate cycle directories should expose a dedicated reason code");
    assert(Array.isArray(ambiguousPlan.source?.cycle_identity_collisions) && ambiguousPlan.source.cycle_identity_collisions.length === 1, "duplicate cycle directories should be surfaced in the source summary");
    assert(String(ambiguousPlan.source?.cycle_identity_collisions?.[0]?.cycle_id ?? "") === "C004", "duplicate cycle summary should identify the conflicting cycle id");

    const scopeDriftTarget = path.join(tempRoot, "scope-drift-source");
    fs.mkdirSync(scopeDriftTarget, { recursive: true });
    const scopeDriftSqlite = path.join(scopeDriftTarget, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const scopeDriftStore = createIndexStore({
      mode: "sqlite",
      sqliteOutput: scopeDriftSqlite,
    });
    scopeDriftStore.write({
      schema_version: 2,
      target_root: path.join(tempRoot, "different-root"),
      audit_root: path.join(tempRoot, "different-root", "docs", "audit"),
      cycles: [],
      artifacts: [],
      file_map: [],
      tags: [],
      artifact_tags: [],
      run_metrics: [],
      artifact_links: [],
      cycle_links: [],
      session_cycle_links: [],
      session_links: [],
      migration_runs: [],
      migration_findings: [],
      repair_decisions: [],
      summary: {
        cycles_count: 0,
        sessions_count: 0,
        artifacts_count: 0,
        file_map_count: 0,
        tags_count: 0,
        run_metrics_count: 0,
        artifact_links_count: 0,
        cycle_links_count: 0,
        session_cycle_links_count: 0,
        session_links_count: 0,
        migration_runs_count: 0,
        migration_findings_count: 0,
        repair_decisions_count: 0,
        structure_kind: "unknown",
        artifacts_with_content_count: 0,
        artifacts_with_canonical_count: 0,
      },
    });
    const scopeDriftFake = createRuntimePersistenceFakePgClientFactory();
    const scopeDriftPlan = await planRuntimeBackendAdoption({
      targetRoot: scopeDriftTarget,
      backend: "postgres",
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: scopeDriftFake.factory,
      sqliteFile: scopeDriftSqlite,
    });
    assert(scopeDriftPlan.action === "blocked-conflict", "sqlite payload scope drift should block canonical postgres transfer");
    assert(scopeDriftPlan.reason_code === "source-scope-drift", "sqlite payload scope drift should expose a dedicated reason code");
    assert(scopeDriftPlan.source?.source_scope?.blocking === true, "sqlite payload scope drift should be surfaced in the source summary");

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

await main();
