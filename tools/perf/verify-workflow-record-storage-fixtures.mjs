#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createIndexStore } from "../../src/lib/index/index-store.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { artifactContentHash, assertWorkflowRecordProjection } from "../../src/core/workflow/artifact-compare-swap.mjs";

const temporary = fs.realpathSync(os.tmpdir()), owned = [];
let checks = 0;
try {
  for (const directory of ["instances", "definitions", "process-instances", "operation-records", "decision-inbox"]) {
    const root = createStandardWorkflowFixture("dual", owned), sqliteFile = resolveRuntimeSqliteFile({ targetRoot: root });
    const row = content => ({ path: `workflows/${directory}/checkpoint.json`, kind: "runtime", family: "runtime", content_format: "utf8",
      content, sha256: artifactContentHash(content), size_bytes: Buffer.byteLength(content) });
    const payload = content => ({ schema_version: 2, generated_at: "2030-01-01T00:00:00Z", cycles: [], sessions: [], artifacts: [row(content)] });
    assert.doesNotThrow(() => assertWorkflowRecordProjection([row("canonical")], [row("canonical")]));
    assert.throws(() => assertWorkflowRecordProjection([row("canonical")], [row("stale")]), /PROJECTION_CONFLICT/);
    const sqlite = createIndexStore({ mode: "sqlite", sqliteOutput: sqliteFile, targetRoot: root });
    sqlite.write(payload("canonical"));
    assert.throws(() => sqlite.write(payload("stale")), /PROJECTION_CONFLICT/);
    // SQLite index import upserts artifacts and preserves omitted records.
    sqlite.write({ ...payload("canonical"), artifacts: [] });
    const reader = createArtifactStore({ sqliteFile, readOnly: true });
    try { assert.equal(reader.getArtifact(row("").path).content, "canonical"); } finally { reader.close(); }
    process.stdout.write(`PASS SQLite producer: ${directory}, stale refusal and omitted canonical record retained\n`); checks++;

    const fake = createRuntimePersistenceFakePgClientFactory();
    const postgres = createPostgresRuntimeArtifactStore({ targetRoot: root, connectionString: "postgres://fixture:fixture@localhost/never-connected", clientFactory: fake.factory });
    await postgres.writeIndexProjection({ payload: payload("canonical") });
    await assert.rejects(postgres.writeIndexProjection({ payload: payload("stale") }), /PROJECTION_CONFLICT/);
    // PostgreSQL bulk replacement removes omitted rows, so omission must refuse.
    await assert.rejects(postgres.writeIndexProjection({ payload: { ...payload("canonical"), artifacts: [] } }), /PROJECTION_CONFLICT/);
    assert.ok(fake.state.queryLog.some(query => query.sql.includes("path LIKE 'workflows/operation-records/%'")));
    process.stdout.write(`PASS PostgreSQL producer with SQL transport double: ${directory}, stale and omission refusal\n`); checks++;
  }
  process.stdout.write(JSON.stringify({ status: "PASS", checks, proof: "real-index-producers-real-sqlite-and-offline-postgres-transport", live_postgres: "NOT_RUN", native: "NOT_RUN" }) + "\n");
} finally {
  for (const root of owned) {
    const physical = fs.realpathSync(root);
    if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith("aidn-standard-ports-")) throw new Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(physical, { recursive: true, force: true });
  }
}
