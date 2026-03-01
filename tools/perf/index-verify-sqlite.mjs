#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readIndexFromSqlite } from "./index-sqlite-lib.mjs";
import { writeJsonIfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.json",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    out: "",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  if (!args.sqliteFile) {
    throw new Error("Missing value for --sqlite-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-verify-sqlite.mjs");
  console.log("  node tools/perf/index-verify-sqlite.mjs --index-file .aidn/runtime/index/workflow-index.json --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
  console.log("  node tools/perf/index-verify-sqlite.mjs --strict");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`JSON index file not found: ${absolute}`);
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON index file ${absolute}: ${error.message}`);
  }
  return { absolute, payload };
}

function sortBy(rows, keyFn) {
  return [...rows].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function toNumberOrNull(value) {
  if (value == null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMtimeMs(value, updatedAt) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return Math.trunc(n / 1_000_000);
  }
  const parsed = Date.parse(updatedAt ?? "");
  return Number.isNaN(parsed) ? null : parsed;
}

function projectForParity(payload) {
  const cycles = sortBy(Array.isArray(payload.cycles) ? payload.cycles : [], (row) => String(row.cycle_id ?? ""));
  const artifacts = sortBy(Array.isArray(payload.artifacts) ? payload.artifacts : [], (row) => String(row.path ?? ""));
  const fileMap = sortBy(Array.isArray(payload.file_map) ? payload.file_map : [], (row) => `${row.cycle_id ?? ""}::${row.path ?? ""}`);
  const tags = sortBy(Array.isArray(payload.tags) ? payload.tags : [], (row) => String(row.tag ?? ""));
  const artifactTags = sortBy(Array.isArray(payload.artifact_tags) ? payload.artifact_tags : [], (row) => `${row.path ?? ""}::${row.tag ?? ""}`);
  const runMetrics = sortBy(Array.isArray(payload.run_metrics) ? payload.run_metrics : [], (row) => String(row.run_id ?? ""));
  const structureKind = payload?.summary?.structure_kind
    ?? payload?.structure_profile?.kind
    ?? "unknown";

  return {
    schema_version: Number(payload?.schema_version ?? 1),
    cycles: cycles.map((row) => ({
      cycle_id: row.cycle_id ?? null,
      session_id: row.session_id ?? null,
      state: row.state ?? "UNKNOWN",
      outcome: row.outcome ?? null,
      branch_name: row.branch_name ?? null,
      dor_state: row.dor_state ?? null,
      continuity_rule: row.continuity_rule ?? null,
      continuity_base_branch: row.continuity_base_branch ?? null,
      continuity_latest_cycle_branch: row.continuity_latest_cycle_branch ?? null,
      updated_at: row.updated_at ?? null,
    })),
    artifacts: artifacts.map((row) => ({
      path: row.path ?? null,
      kind: row.kind ?? null,
      sha256: row.sha256 ?? null,
      size_bytes: Number(row.size_bytes ?? 0),
      mtime_ms: toMtimeMs(row.mtime_ns, row.updated_at),
      session_id: row.session_id ?? null,
      cycle_id: row.cycle_id ?? null,
      updated_at: row.updated_at ?? null,
    })),
    file_map: fileMap.map((row) => ({
      cycle_id: row.cycle_id ?? null,
      path: row.path ?? null,
      role: row.role ?? null,
      last_seen_at: row.last_seen_at ?? null,
    })),
    tags: tags.map((row) => ({
      tag: row.tag ?? null,
    })),
    artifact_tags: artifactTags.map((row) => ({
      path: row.path ?? null,
      tag: row.tag ?? null,
    })),
    run_metrics: runMetrics.map((row) => ({
      run_id: row.run_id ?? null,
      started_at: row.started_at ?? null,
      ended_at: row.ended_at ?? null,
      overhead_ratio: toNumberOrNull(row.overhead_ratio),
      artifacts_churn: toNumberOrNull(row.artifacts_churn),
      gates_frequency: toNumberOrNull(row.gates_frequency),
    })),
    summary: {
      cycles_count: cycles.length,
      artifacts_count: artifacts.length,
      file_map_count: fileMap.length,
      tags_count: tags.length,
      run_metrics_count: runMetrics.length,
      structure_kind: structureKind,
    },
  };
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mismatchSummary(left, right) {
  const keys = [
    "cycles_count",
    "artifacts_count",
    "file_map_count",
    "tags_count",
    "run_metrics_count",
    "structure_kind",
  ];
  const mismatches = [];
  for (const key of keys) {
    const a = left?.summary?.[key] ?? null;
    const b = right?.summary?.[key] ?? null;
    if (a !== b) {
      mismatches.push({
        key,
        index_json: a,
        index_sqlite: b,
      });
    }
  }
  return mismatches;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { absolute: indexAbsolute, payload: indexPayload } = readJson(args.indexFile);
    const { absolute: sqliteAbsolute, payload: sqlitePayload } = readIndexFromSqlite(args.sqliteFile);
    const projectedJson = projectForParity(indexPayload);
    const projectedSqlite = projectForParity(sqlitePayload);
    const digestJson = digest(projectedJson);
    const digestSqlite = digest(projectedSqlite);
    const inSync = digestJson === digestSqlite;
    const summaryMismatches = mismatchSummary(projectedJson, projectedSqlite);
    const reasonCodes = [];
    if (!inSync) {
      reasonCodes.push("DIGEST_MISMATCH");
    }
    if (summaryMismatches.length > 0) {
      reasonCodes.push("SUMMARY_MISMATCH");
    }

    const result = {
      ts: new Date().toISOString(),
      index_file: indexAbsolute,
      sqlite_file: sqliteAbsolute,
      in_sync: inSync,
      reason_codes: reasonCodes,
      digests: {
        index_json: digestJson,
        index_sqlite: digestSqlite,
      },
      summary_mismatches: summaryMismatches,
      summary: {
        mismatch_count: summaryMismatches.length,
      },
      action: inSync ? "in_sync" : "drift_detected",
    };

    if (args.out) {
      writeJsonIfChanged(args.out, result);
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`JSON index: ${result.index_file}`);
      console.log(`SQLite index: ${result.sqlite_file}`);
      console.log(`In sync: ${result.in_sync ? "yes" : "no"}`);
      console.log(`Digest (json): ${result.digests.index_json}`);
      console.log(`Digest (sqlite): ${result.digests.index_sqlite}`);
      console.log(`Summary mismatches: ${result.summary.mismatch_count}`);
      if (result.reason_codes.length > 0) {
        console.log(`Reason codes: ${result.reason_codes.join(", ")}`);
      }
    }

    if (args.strict && !inSync) {
      process.exit(2);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
