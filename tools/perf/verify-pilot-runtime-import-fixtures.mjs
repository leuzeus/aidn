#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { resolveLocalPilotRuntimeImportTarget } from "./local-pilot-runtime-import-lib.mjs";

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

function selectPrimarySession(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const sorted = rows.slice().sort((left, right) => {
    const leftFocus = String(left?.integration_target_cycle ?? "").trim() ? 1 : 0;
    const rightFocus = String(right?.integration_target_cycle ?? "").trim() ? 1 : 0;
    if (rightFocus !== leftFocus) {
      return rightFocus - leftFocus;
    }
    const leftScore = String(left?.parent_session ?? "").trim() ? 1 : 0;
    const rightScore = String(right?.parent_session ?? "").trim() ? 1 : 0;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return String(left?.session_id ?? "").localeCompare(String(right?.session_id ?? ""), undefined, { numeric: true, sensitivity: "base" });
  });
  return sorted[0] ?? null;
}

async function main() {
  try {
    const pilotResolution = resolveLocalPilotRuntimeImportTarget({
      explicitRoot: process.env.AIDN_PILOT_RUNTIME_IMPORT_ROOT,
    });
    if (pilotResolution.status === "missing" || pilotResolution.status === "ambiguous") {
      console.log(`SKIP: ${pilotResolution.reason}`);
      return;
    }
    assert(pilotResolution.status !== "invalid", pilotResolution.reason);
    const target = pilotResolution.target;
    assert(target, "expected one local-only pilot runtime-import corpus under tests/fixtures/perf-structure or via AIDN_PILOT_RUNTIME_IMPORT_ROOT");
    const sqliteFile = path.resolve(target, ".aidn/runtime/index/fixtures/pilot-runtime-import/workflow-index.sqlite");
    fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });

    runIndexSync(target, sqliteFile);
    const payload = readIndexFromSqlite(sqliteFile).payload;
    const artifactByPath = new Map((payload.artifacts ?? []).map((artifact) => [String(artifact?.path ?? ""), artifact]));
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const primarySession = selectPrimarySession(sessions);
    assert(primarySession, "expected at least one recovered session in the pilot corpus");
    const sqliteRuntimeHeads = readRuntimeHeadPayloads(sqliteFile);

    const currentState = artifactByPath.get("CURRENT-STATE.md");
    const runtimeState = artifactByPath.get("RUNTIME-STATE.md");
    const handoffPacket = artifactByPath.get("HANDOFF-PACKET.md");
    const expectedSessionId = String(primarySession?.session_id ?? "");
    const expectedCycleId = String(primarySession?.integration_target_cycle ?? "");

    assert(sessions.length >= 2, "expected multiple recovered sessions in the pilot corpus");
    assert(Boolean(String(primarySession?.branch_name ?? "").trim()), "expected recovered primary session branch_name");
    assert(Boolean(String(primarySession?.parent_session ?? "").trim()), "expected recovered primary session parent_session");
    assert(String(primarySession?.branch_kind ?? "") === "session", "expected recovered primary session branch_kind");
    assert(Boolean(expectedCycleId), "expected recovered primary session focus cycle");

    assert(String(currentState?.session_id ?? "") === expectedSessionId, "expected CURRENT-STATE session_id backfill from content");
    assert(String(currentState?.cycle_id ?? "") === expectedCycleId, "expected CURRENT-STATE cycle_id backfill from content");
    assert(String(currentState?.source_mode ?? "") === "inferred", "expected CURRENT-STATE content-derived source_mode");
    assert(String(currentState?.legacy_origin ?? "") === "runtime_artifact_content", "expected CURRENT-STATE content-derived legacy_origin");
    assert(String(currentState?.canonical?.derived_runtime_context?.active_session ?? "") === expectedSessionId, "expected CURRENT-STATE canonical derived runtime context");
    assert(String(currentState?.canonical?.derived_runtime_context?.active_cycle ?? "") === expectedCycleId, "expected CURRENT-STATE canonical derived cycle context");
    assert(String(currentState?.canonical?.contract_status ?? "") === "legacy_tolerated", "expected CURRENT-STATE legacy contract status");
    assert(String(currentState?.canonical?.legacy_shape_id ?? "") === "implicit_current_contract", "expected CURRENT-STATE implicit current-contract legacy shape");

    assert(String(runtimeState?.canonical?.derived_runtime_context?.runtime_state_mode ?? "") === "dual", "expected RUNTIME-STATE runtime mode derivation");
    assert(String(runtimeState?.canonical?.derived_runtime_context?.current_state_freshness ?? "") === "stale", "expected RUNTIME-STATE freshness derivation");
    assert(Array.isArray(runtimeState?.canonical?.derived_runtime_context?.blocking_findings), "expected RUNTIME-STATE blocking findings list");
    assert(String(runtimeState?.canonical?.contract_status ?? "") === "legacy_tolerated", "expected RUNTIME-STATE legacy contract status");

    assert(String(handoffPacket?.session_id ?? "") === expectedSessionId, "expected HANDOFF-PACKET session_id backfill from content");
    assert(String(handoffPacket?.cycle_id ?? "") === expectedCycleId, "expected HANDOFF-PACKET cycle_id backfill from content");
    assert(String(handoffPacket?.canonical?.derived_runtime_context?.mode ?? "") === "COMMITTING", "expected HANDOFF-PACKET derived mode");
    assert(String(handoffPacket?.canonical?.contract_status ?? "") === "legacy_tolerated", "expected HANDOFF-PACKET legacy contract status");

    assert(String(sqliteRuntimeHeads.current_state?.session_id ?? "") === expectedSessionId, "expected SQLite runtime head session_id backfill");
    assert(String(sqliteRuntimeHeads.current_state?.cycle_id ?? "") === expectedCycleId, "expected SQLite runtime head cycle_id backfill");
    assert(String(sqliteRuntimeHeads.current_state?.derived_runtime_context?.active_session ?? "") === expectedSessionId, "expected SQLite runtime head derived runtime context");
    assert(String(sqliteRuntimeHeads.handoff_packet?.derived_runtime_context?.active_cycle ?? "") === expectedCycleId, "expected SQLite handoff head derived runtime context");
    assert(String(sqliteRuntimeHeads.current_state?.contract_status ?? "") === "legacy_tolerated", "expected SQLite current_state legacy contract status");
    assert(String(sqliteRuntimeHeads.runtime_state?.contract_status ?? "") === "legacy_tolerated", "expected SQLite runtime_state legacy contract status");

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
    assert(String(postgresArtifactByPath.get("CURRENT-STATE.md")?.session_id ?? "") === expectedSessionId, "expected PostgreSQL payload CURRENT-STATE session_id parity");
    assert(String(postgresArtifactByPath.get("CURRENT-STATE.md")?.cycle_id ?? "") === expectedCycleId, "expected PostgreSQL payload CURRENT-STATE cycle_id parity");
    assert(String(postgresSnapshot.runtimeHeads.current_state?.session_id ?? "") === expectedSessionId, "expected PostgreSQL runtime head session_id parity");
    assert(String(postgresSnapshot.runtimeHeads.current_state?.cycle_id ?? "") === expectedCycleId, "expected PostgreSQL runtime head cycle_id parity");
    assert(String(postgresSnapshot.runtimeHeads.current_state?.derived_runtime_context?.active_session ?? "") === expectedSessionId, "expected PostgreSQL runtime head derived context parity");
    assert(String(postgresSnapshot.runtimeHeads.runtime_state?.derived_runtime_context?.runtime_state_mode ?? "") === "dual", "expected PostgreSQL runtime head runtime mode parity");
    assert(String(postgresSnapshot.runtimeHeads.current_state?.contract_status ?? "") === "legacy_tolerated", "expected PostgreSQL current_state legacy contract parity");
    assert(String(postgresSnapshot.runtimeHeads.handoff_packet?.contract_status ?? "") === "legacy_tolerated", "expected PostgreSQL handoff legacy contract parity");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
