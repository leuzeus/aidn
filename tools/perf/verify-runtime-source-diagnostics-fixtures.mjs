#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createIndexStore } from "../../src/lib/index/index-store.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCommand(scriptRelative, args) {
  const result = spawnSync(process.execPath, [path.resolve(process.cwd(), scriptRelative), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function runJson(scriptRelative, args) {
  const result = runCommand(scriptRelative, args);
  return {
    ...result,
    payload: (() => {
      try {
        return JSON.parse(result.stdout);
      } catch {
        return null;
      }
    })(),
  };
}

function writeSqlitePayload(sqliteFile, targetRoot, payloadOverrides = {}) {
  const store = createIndexStore({
    mode: "sqlite",
    sqliteOutput: sqliteFile,
  });
  store.write({
    schema_version: 2,
    target_root: targetRoot,
    audit_root: path.join(targetRoot, "docs", "audit"),
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
    ...payloadOverrides,
    cycles: Array.isArray(payloadOverrides?.cycles) ? payloadOverrides.cycles : [
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
    artifacts: Array.isArray(payloadOverrides?.artifacts) ? payloadOverrides.artifacts : [
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
    file_map: Array.isArray(payloadOverrides?.file_map) ? payloadOverrides.file_map : [
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
}

async function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-source-diagnostics-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    const sqliteRelative = ".aidn/runtime/index/workflow-index.sqlite";
    const sqliteFile = path.join(targetRoot, sqliteRelative);

    writeSqlitePayload(sqliteFile, targetRoot);

    const jsonResult = runJson("bin/aidn.mjs", [
      "runtime",
      "persistence-source-diagnose",
      "--target",
      targetRoot,
      "--sqlite-file",
      sqliteRelative,
      "--json",
    ]);
    assert(jsonResult.status === 0, "runtime source diagnostics json should succeed");
    assert(jsonResult.payload?.source_diagnostics?.reason_code === "source-cycle-identity-ambiguous", "json diagnostics should expose the ambiguity reason code");
    assert(jsonResult.payload?.source_diagnostics?.cycle_identity_collision_count === 1, "json diagnostics should count one ambiguous logical cycle id");
    assert(String(jsonResult.payload?.source_diagnostics?.cycle_identity_collisions?.[0]?.cycle_id ?? "") === "C004", "json diagnostics should identify the ambiguous logical cycle id");
    assert(Array.isArray(jsonResult.payload?.source_diagnostics?.cycle_identity_collisions?.[0]?.directories)
      && jsonResult.payload.source_diagnostics.cycle_identity_collisions[0].directories.length === 2, "json diagnostics should list both colliding cycle directories");

    const humanResult = runCommand("bin/aidn.mjs", [
      "runtime",
      "persistence-source-diagnose",
      "--target",
      targetRoot,
      "--sqlite-file",
      sqliteRelative,
    ]);
    assert(humanResult.status === 0, "runtime source diagnostics human output should succeed");
    assert(humanResult.stdout.includes("reason_code=source-cycle-identity-ambiguous"), "human diagnostics should print the ambiguity reason code");
    assert(humanResult.stdout.includes("collision_cycle_ids=C004"), "human diagnostics should print the colliding logical cycle id");
    assert(humanResult.stdout.includes("cycle C004: directories=C004-first, C004-second"), "human diagnostics should print the colliding directories");

    const scopeDriftTarget = path.join(tempRoot, "scope-drift");
    fs.mkdirSync(scopeDriftTarget, { recursive: true });
    const scopeDriftRelative = ".aidn/runtime/index/workflow-index.sqlite";
    const scopeDriftSqlite = path.join(scopeDriftTarget, scopeDriftRelative);
    writeSqlitePayload(scopeDriftSqlite, path.join(tempRoot, "other-root"), {
      cycles: [],
      artifacts: [],
      file_map: [],
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
    const driftJsonResult = runJson("bin/aidn.mjs", [
      "runtime",
      "persistence-source-diagnose",
      "--target",
      scopeDriftTarget,
      "--sqlite-file",
      scopeDriftRelative,
      "--json",
    ]);
    assert(driftJsonResult.status === 0, "runtime source diagnostics scope-drift json should succeed");
    assert(driftJsonResult.payload?.source_diagnostics?.reason_code === "source-scope-drift", "json diagnostics should expose the scope drift reason code");
    assert(driftJsonResult.payload?.source_diagnostics?.source_scope?.blocking === true, "json diagnostics should flag blocking scope drift");
    assert(driftJsonResult.payload?.source_diagnostics?.diagnostic_status === "scope-drift", "json diagnostics should expose scope-drift status");

    const driftHumanResult = runCommand("bin/aidn.mjs", [
      "runtime",
      "persistence-source-diagnose",
      "--target",
      scopeDriftTarget,
      "--sqlite-file",
      scopeDriftRelative,
    ]);
    assert(driftHumanResult.status === 0, "runtime source diagnostics scope-drift human output should succeed");
    assert(driftHumanResult.stdout.includes("reason_code=source-scope-drift"), "human diagnostics should print the scope drift reason code");
    assert(driftHumanResult.stdout.includes("source_scope_blocking=yes"), "human diagnostics should print the blocking scope drift marker");

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      checks: {
        json_reports_ambiguity_reason: true,
        json_reports_collision_details: true,
        human_reports_ambiguity_reason: true,
        human_reports_collision_directories: true,
        json_reports_scope_drift_reason: true,
        human_reports_scope_drift_reason: true,
      },
      pass: true,
    }, null, 2));
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
