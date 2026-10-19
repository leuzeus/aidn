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
    assert(!postgresSnapshot.warning, `postgres parity snapshot should be readable (${postgresSnapshot.warning || "ok"})`);
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

    // The fake proves SQL lifecycle and option routing; isolation across a
    // concurrent commit is covered separately by the manual live smoke.
    const persisted = () => JSON.stringify({ rows: fake.state.relationalRows,
      heads: [...fake.state.runtimeHeads], snapshots: [...fake.state.runtimeSnapshots],
      tables: [...fake.state.tablesPresent], migrations: fake.state.schemaMigrations });
    for (const includePayload of [false, true]) for (const includeRuntimeHeads of [false, true]) {
      const before = persisted();
      fake.state.queryLog.length = 0;
      const selected = await postgresStore.loadSnapshot({ includePayload, includeRuntimeHeads });
      const queries = fake.state.queryLog.map(query => query.sql);
      assert(selected.exists && !selected.warning, "all snapshot option combinations should retain the canonical scope");
      assert(Boolean(selected.payload) === includePayload, "payload option should control payload hydration");
      assert(Boolean(Object.keys(selected.runtimeHeads).length) === includeRuntimeHeads, "head option should control head hydration");
      assert(queries[0] === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" && queries.at(-1) === "COMMIT",
        "snapshot should commit one repeatable-read read-only transaction");
      assert(queries.filter(sql => sql.startsWith("BEGIN")).length === 1 && queries.filter(sql => sql === "COMMIT").length === 1,
        "snapshot should use exactly one transaction");
      assert(queries.every(sql => /^(SELECT\b|BEGIN\b|COMMIT$)/.test(sql)), "snapshot should not write, bootstrap or lock tables");
      assert(queries.filter(sql => sql.includes("FROM aidn_runtime.runtime_heads")).length === Number(includeRuntimeHeads),
        "snapshot should not reread runtime heads");
      assert(queries.filter(sql => /^SELECT\b/.test(sql)).length === 1 + Number(includeRuntimeHeads) + (includePayload ? 15 : 0),
        "snapshot should retain only the reads requested by its options");
      assert(persisted() === before, "snapshot should preserve all fake persisted state");
    }
    fake.state.queryLog.length = 0;
    assert((await postgresStore.loadRuntimeHeads()).current_state?.artifact_path === "CURRENT-STATE.md",
      "loadRuntimeHeads should retain existing head resolution");
    assert(fake.state.queryLog[0].sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
      && fake.state.queryLog.at(-1).sql === "COMMIT", "loadRuntimeHeads should use the same read transaction");

    const empty = createRuntimePersistenceFakePgClientFactory({ initialTables: [...fake.state.tablesPresent] });
    const emptyStore = createPostgresRuntimeArtifactStore({ targetRoot: tempRoot,
      connectionString: "postgres://aidn:test@localhost:5432/aidn", clientFactory: empty.factory });
    const absent = await emptyStore.loadSnapshot();
    assert(!absent.exists && absent.payload === null && !absent.warning && !Object.keys(absent.runtimeHeads).length,
      "healthy absent scopes should remain absent without a schema warning");
    assert(empty.state.queryLog[0].sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
      && empty.state.queryLog.at(-1).sql === "COMMIT", "all absent scope candidates should share one transaction");

    for (const missingTable of ["index_meta", "artifacts", "COMMIT"]) for (const failedCleanup of ["none", "rollback", "end", "both"]) {
      const queries = [];
      let ended = false;
      let primary = null;
      const failureStore = createPostgresRuntimeArtifactStore({ targetRoot: tempRoot,
        connectionString: "postgres://aidn:test@localhost:5432/aidn",
        clientFactory() {
          const client = fake.factory();
          return {
            connect: () => client.connect(),
            async end() { ended = true; if (["end", "both"].includes(failedCleanup)) throw new Error("fixture closure failure"); },
            async query(sql, values) {
              sql = String(sql).trim(); queries.push(sql);
              if (sql === "ROLLBACK" && ["rollback", "both"].includes(failedCleanup)) throw new Error("fixture rollback failure");
              if (missingTable === "COMMIT" ? sql === "COMMIT" : sql.includes(`FROM aidn_runtime.${missingTable}`)) {
                primary = new Error(missingTable === "COMMIT" ? "fixture commit failure" : `relation \"aidn_runtime.${missingTable}\" does not exist`);
                primary.code = missingTable === "COMMIT" ? "08006" : "42P01";
                throw primary;
              }
              return client.query(sql, values);
            },
          };
        } });
      const failed = await failureStore.loadSnapshot();
      assert(!failed.exists && failed.payload === null && !Object.keys(failed.runtimeHeads).length,
        "any failed required table should discard the partial payload and heads");
      assert(failed.warning === primary?.message, "rollback or client closure failure should preserve the original SQL error");
      assert(queries[0] === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" && queries.at(-1) === "ROLLBACK"
        && queries.filter(sql => sql === "ROLLBACK").length === 1 && (missingTable === "COMMIT" || !queries.includes("COMMIT")),
        "failed snapshot should roll back once without committing");
      assert(queries.findIndex(sql => missingTable === "COMMIT" ? sql === "COMMIT" : sql.includes(`FROM aidn_runtime.${missingTable}`)) === queries.length - 2,
        "failed SQL must not trigger another table query or legacy candidate lookup");
      assert(ended, "failed snapshot should close its client");
    }

    const falsyFailureStore = createPostgresRuntimeArtifactStore({ targetRoot: tempRoot,
      connectionString: "postgres://aidn:test@localhost:5432/aidn", clientFactory() {
        const client = fake.factory();
        return { connect: () => client.connect(),
          async end() { throw new Error("fixture closure must not replace a falsy primary failure"); },
          async query(sql, values) {
            if (String(sql).includes("FROM aidn_runtime.index_meta")) throw 0;
            return client.query(sql, values);
          } };
      } });
    const falsyFailure = await falsyFailureStore.loadSnapshot();
    assert(!falsyFailure.exists && falsyFailure.payload === null && falsyFailure.warning === "0",
      "client closure must preserve a falsy thrown primary failure");

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
