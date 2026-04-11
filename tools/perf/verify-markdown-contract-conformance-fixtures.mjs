#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runIndexSync(target, sqliteFile) {
  if (fs.existsSync(sqliteFile)) {
    fs.rmSync(sqliteFile, { force: true });
  }
  const script = path.resolve(process.cwd(), "tools/perf/index-sync.mjs");
  execFileSync(process.execPath, [
    script,
    "--target",
    target,
    "--store",
    "sqlite",
    "--sqlite-output",
    sqliteFile,
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readRuntimeHeadPayloads(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    const rows = db.prepare(`
      SELECT head_key, payload_json
      FROM runtime_heads
      ORDER BY head_key ASC
    `).all();
    return Object.fromEntries(rows.map((row) => {
      try {
        return [String(row.head_key ?? ""), JSON.parse(String(row.payload_json ?? "{}"))];
      } catch {
        return [String(row.head_key ?? ""), {}];
      }
    }));
  } finally {
    db.close();
  }
}

function hasFinding(findings, code) {
  return Array.isArray(findings) && findings.some((finding) => String(finding?.code ?? "") === code);
}

async function main() {
  try {
    const target = path.resolve(process.cwd(), "tests/fixtures/perf-structure/markdown-contract-conformance");
    const sqliteFile = path.resolve(target, ".aidn/runtime/index/fixtures/markdown-contract-conformance/workflow-index.sqlite");
    fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });

    runIndexSync(target, sqliteFile);
    const payload = readIndexFromSqlite(sqliteFile).payload;
    const artifactByPath = new Map((payload.artifacts ?? []).map((artifact) => [String(artifact?.path ?? ""), artifact]));
    const sqliteRuntimeHeads = readRuntimeHeadPayloads(sqliteFile);

    const currentState = artifactByPath.get("CURRENT-STATE.md");
    const runtimeState = artifactByPath.get("RUNTIME-STATE.md");
    const handoffPacket = artifactByPath.get("HANDOFF-PACKET.md");
    const sessionLegacy = artifactByPath.get("sessions/S201.md");
    const sessionTypeMismatch = artifactByPath.get("sessions/S202.md");
    const sessionMissingField = artifactByPath.get("sessions/S203.md");
    const cycleConformant = artifactByPath.get("cycles/C201-feature-contract-baseline/status.md");
    const cycleLegacy = artifactByPath.get("cycles/C202-feature-contract-legacy/status.md");

    assert(String(currentState?.canonical?.contract_status ?? "") === "conformant", "expected CURRENT-STATE conformant status");
    assert(String(currentState?.canonical?.contract_version ?? "") === "critical-markdown-v1", "expected CURRENT-STATE contract version");
    assert(Array.isArray(currentState?.canonical?.contract_findings) && currentState.canonical.contract_findings.length === 0, "expected CURRENT-STATE no contract findings");

    assert(String(runtimeState?.canonical?.contract_status ?? "") === "non_conformant", "expected RUNTIME-STATE non_conformant status");
    assert(hasFinding(runtimeState?.canonical?.contract_findings, "INVALID_CONTRACT_VERSION"), "expected RUNTIME-STATE invalid version finding");

    assert(String(handoffPacket?.canonical?.contract_status ?? "") === "non_conformant", "expected HANDOFF-PACKET non_conformant status");
    assert(hasFinding(handoffPacket?.canonical?.contract_findings, "MISSING_REQUIRED_SECTION"), "expected HANDOFF-PACKET missing section finding");

    assert(String(sessionLegacy?.canonical?.contract_status ?? "") === "legacy_tolerated", "expected S201 legacy_tolerated status");
    assert(String(sessionLegacy?.canonical?.legacy_shape_id ?? "") === "implicit_current_contract", "expected S201 implicit current-contract legacy marker");
    assert(hasFinding(sessionLegacy?.canonical?.contract_findings, "MISSING_EXPLICIT_CONTRACT_VERSION"), "expected S201 missing explicit version finding");

    assert(String(sessionTypeMismatch?.canonical?.contract_status ?? "") === "non_conformant", "expected S202 non_conformant status");
    assert(hasFinding(sessionTypeMismatch?.canonical?.contract_findings, "FIELD_TYPE_MISMATCH"), "expected S202 field type mismatch finding");

    assert(String(sessionMissingField?.canonical?.contract_status ?? "") === "non_conformant", "expected S203 non_conformant status");
    assert(hasFinding(sessionMissingField?.canonical?.contract_findings, "MISSING_REQUIRED_FIELD"), "expected S203 missing field finding");

    assert(String(cycleConformant?.canonical?.contract_status ?? "") === "conformant", "expected C201 status conformant");
    assert(String(cycleLegacy?.canonical?.contract_status ?? "") === "legacy_tolerated", "expected C202 status legacy_tolerated");
    assert(hasFinding(cycleLegacy?.canonical?.contract_findings, "MISSING_EXPLICIT_CONTRACT_VERSION"), "expected C202 missing explicit version finding");

    assert(String(sqliteRuntimeHeads.current_state?.contract_status ?? "") === "conformant", "expected SQLite current_state contract status");
    assert(String(sqliteRuntimeHeads.runtime_state?.contract_status ?? "") === "non_conformant", "expected SQLite runtime_state contract status");
    assert(String(sqliteRuntimeHeads.handoff_packet?.contract_status ?? "") === "non_conformant", "expected SQLite handoff contract status");
    assert(hasFinding(sqliteRuntimeHeads.runtime_state?.contract_findings, "INVALID_CONTRACT_VERSION"), "expected SQLite runtime_state invalid version finding");

    const fake = createRuntimePersistenceFakePgClientFactory();
    const postgresStore = createPostgresRuntimeArtifactStore({
      targetRoot: target,
      connectionString: "postgres://aidn:test@localhost:5432/aidn",
      clientFactory: fake.factory,
    });
    await postgresStore.writeIndexProjection({ payload });
    const postgresSnapshot = await postgresStore.loadSnapshot({
      includePayload: true,
      includeRuntimeHeads: true,
    });

    const postgresArtifactByPath = new Map((postgresSnapshot.payload?.artifacts ?? []).map((artifact) => [String(artifact?.path ?? ""), artifact]));
    assert(String(postgresArtifactByPath.get("CURRENT-STATE.md")?.canonical?.contract_status ?? "") === "conformant", "expected PostgreSQL CURRENT-STATE contract parity");
    assert(String(postgresArtifactByPath.get("sessions/S201.md")?.canonical?.contract_status ?? "") === "legacy_tolerated", "expected PostgreSQL session legacy contract parity");
    assert(String(postgresSnapshot.runtimeHeads.current_state?.contract_status ?? "") === "conformant", "expected PostgreSQL current_state runtime head contract parity");
    assert(String(postgresSnapshot.runtimeHeads.runtime_state?.contract_status ?? "") === "non_conformant", "expected PostgreSQL runtime_state runtime head contract parity");
    assert(hasFinding(postgresSnapshot.runtimeHeads.runtime_state?.contract_findings, "INVALID_CONTRACT_VERSION"), "expected PostgreSQL runtime_state invalid version finding");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
