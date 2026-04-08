#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSqliteRuntimeArtifactStore } from "../../src/adapters/runtime/sqlite-runtime-artifact-store.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { stablePayloadProjection } from "../../src/adapters/runtime/artifact-projector-adapter.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function normalizePayloadForComparison(payload) {
  const next = sortJson(payload);
  if (Array.isArray(next?.artifacts)) {
    next.artifacts = next.artifacts.slice().sort((left, right) =>
      String(left?.path ?? "").localeCompare(String(right?.path ?? "")));
  }
  return next;
}

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-parity-"));
    const sqliteFile = path.join(tempRoot, "workflow-index.sqlite");
    const fake = createRuntimePersistenceFakePgClientFactory();
    const sqliteStore = createSqliteRuntimeArtifactStore({
      mode: "sqlite",
      sqliteFile,
    });
    const postgresStore = createPostgresRuntimeArtifactStore({
      targetRoot: tempRoot,
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
    });

    const payload = {
      schema_version: 2,
      generated_at: "2026-04-05T13:00:00.000Z",
      target_root: tempRoot,
      audit_root: path.join(tempRoot, "docs", "audit"),
      structure_profile: {
        kind: "fixture",
      },
      repair_layer_meta: null,
      cycles: [],
      sessions: [],
      artifacts: [
        {
          path: "CURRENT-STATE.md",
          kind: "other",
          family: "unknown",
          subtype: "current_state",
          gate_relevance: 0,
          classification_reason: null,
          content_format: null,
          content: null,
          canonical_format: null,
          canonical: null,
          sha256: "sha-current",
          size_bytes: 0,
          mtime_ns: "0",
          session_id: null,
          cycle_id: null,
          source_mode: "explicit",
          entity_confidence: 1,
          legacy_origin: null,
          updated_at: "2026-04-05T13:00:00.000Z",
        },
        {
          path: "RUNTIME-STATE.md",
          kind: "other",
          family: "unknown",
          subtype: "runtime_state",
          gate_relevance: 0,
          classification_reason: null,
          content_format: null,
          content: null,
          canonical_format: null,
          canonical: null,
          sha256: "sha-runtime",
          size_bytes: 0,
          mtime_ns: "0",
          session_id: null,
          cycle_id: null,
          source_mode: "explicit",
          entity_confidence: 1,
          legacy_origin: null,
          updated_at: "2026-04-05T13:05:00.000Z",
        },
        {
          path: "HANDOFF-PACKET.md",
          kind: "other",
          family: "unknown",
          subtype: "handoff_packet",
          gate_relevance: 0,
          classification_reason: null,
          content_format: null,
          content: null,
          canonical_format: null,
          canonical: null,
          sha256: "sha-handoff",
          size_bytes: 0,
          mtime_ns: "0",
          session_id: null,
          cycle_id: null,
          source_mode: "explicit",
          entity_confidence: 1,
          legacy_origin: null,
          updated_at: "2026-04-05T13:10:00.000Z",
        },
      ],
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
        artifacts_count: 3,
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
        structure_kind: "fixture",
        artifacts_with_content_count: 0,
        artifacts_with_canonical_count: 0,
      },
    };

    sqliteStore.writeIndexProjection({ payload });
    await postgresStore.writeIndexProjection({ payload });

    const sqliteSnapshot = sqliteStore.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: true,
    });
    const postgresSnapshot = await postgresStore.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: true,
    });

    assert(!sqliteSnapshot.warning, `sqlite parity snapshot should be readable (${sqliteSnapshot.warning || "ok"})`);
    assert(
      JSON.stringify(normalizePayloadForComparison(stablePayloadProjection(sqliteSnapshot.payload)))
        === JSON.stringify(normalizePayloadForComparison(stablePayloadProjection(postgresSnapshot.payload))),
      "sqlite and postgres payloads should match after stable projection",
    );

    const sqliteHeadKeys = Object.keys(sqliteSnapshot.runtimeHeads).sort();
    const postgresHeadKeys = Object.keys(postgresSnapshot.runtimeHeads).sort();
    assert(JSON.stringify(sqliteHeadKeys) === JSON.stringify(postgresHeadKeys), "sqlite and postgres runtime head keys should match");
    assert(postgresSnapshot.runtimeHeads.current_state?.artifact_path === "CURRENT-STATE.md", "postgres parity snapshot should preserve current_state");
    assert(postgresSnapshot.runtimeHeads.handoff_packet?.artifact_path === "HANDOFF-PACKET.md", "postgres parity snapshot should preserve handoff_packet");

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
