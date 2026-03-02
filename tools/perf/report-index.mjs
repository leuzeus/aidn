#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isJsonEquivalent, writeJsonIfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.json",
    parityFile: ".aidn/runtime/index/index-parity.json",
    sqliteParityFile: ".aidn/runtime/index/index-sqlite-parity.json",
    out: ".aidn/runtime/index/index-report.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--parity-file") {
      args.parityFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-parity-file") {
      args.sqliteParityFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
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
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-index.mjs");
  console.log("  node tools/perf/report-index.mjs --index-file .aidn/runtime/index/workflow-index.json --out .aidn/runtime/index/index-report.json");
  console.log("  node tools/perf/report-index.mjs --parity-file .aidn/runtime/index/index-parity.json --sqlite-parity-file .aidn/runtime/index/index-sqlite-parity.json");
}

function readJson(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function readJsonOptional(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return { absolute, data: null, exists: false };
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")), exists: true };
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function toCount(arr) {
  return Array.isArray(arr) ? arr.length : 0;
}

function hasCanonical(row) {
  if (row?.canonical && typeof row.canonical === "object") {
    return true;
  }
  if (typeof row?.canonical_json === "string" && row.canonical_json.trim().length > 0) {
    return true;
  }
  return typeof row?.canonical_format === "string" && row.canonical_format.trim().length > 0;
}

function hasContent(row) {
  return typeof row?.content === "string" && row.content.length > 0;
}

function boolNum(value) {
  return value ? 1 : 0;
}

function numericOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parityOkFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (typeof payload.ok === "boolean") {
    return payload.ok;
  }
  if (typeof payload.in_sync === "boolean") {
    return payload.in_sync;
  }
  if (typeof payload.status === "string") {
    if (payload.status === "pass") {
      return true;
    }
    if (payload.status === "fail") {
      return false;
    }
  }
  return null;
}

function parityStatusFrom(ok, exists) {
  if (!exists) {
    return "missing";
  }
  if (ok === true) {
    return "pass";
  }
  if (ok === false) {
    return "fail";
  }
  return "unknown";
}

function buildReport(indexData, sqlParityData, sqlParityExists, sqliteParityData, sqliteParityExists) {
  const declared = {
    cycles: numericOrNull(indexData?.summary?.cycles_count),
    artifacts: numericOrNull(indexData?.summary?.artifacts_count),
    file_map: numericOrNull(indexData?.summary?.file_map_count),
    tags: numericOrNull(indexData?.summary?.tags_count),
    run_metrics: numericOrNull(indexData?.summary?.run_metrics_count),
  };
  const actual = {
    cycles: toCount(indexData?.cycles),
    artifacts: toCount(indexData?.artifacts),
    artifacts_with_content: Array.isArray(indexData?.artifacts) ? indexData.artifacts.filter((row) => hasContent(row)).length : 0,
    artifacts_with_canonical: Array.isArray(indexData?.artifacts) ? indexData.artifacts.filter((row) => hasCanonical(row)).length : 0,
    file_map: toCount(indexData?.file_map),
    tags: toCount(indexData?.tags),
    artifact_tags: toCount(indexData?.artifact_tags),
    run_metrics: toCount(indexData?.run_metrics),
  };

  const consistency = {
    cycles_count_match: boolNum(declared.cycles === actual.cycles),
    artifacts_count_match: boolNum(declared.artifacts === actual.artifacts),
    file_map_count_match: boolNum(declared.file_map === actual.file_map),
    tags_count_match: boolNum(declared.tags === actual.tags),
    run_metrics_count_match: boolNum(declared.run_metrics === actual.run_metrics),
  };
  consistency.all_count_match = boolNum(
    consistency.cycles_count_match === 1
      && consistency.artifacts_count_match === 1
      && consistency.file_map_count_match === 1
      && consistency.tags_count_match === 1
      && consistency.run_metrics_count_match === 1,
  );

  const sqlParityOkRaw = parityOkFromPayload(sqlParityData);
  const sqliteParityOkRaw = parityOkFromPayload(sqliteParityData);
  const sqlParityStatus = parityStatusFrom(sqlParityOkRaw, sqlParityExists);
  const sqliteParityStatus = parityStatusFrom(sqliteParityOkRaw, sqliteParityExists);
  const activeParityChecks = [];
  if (sqlParityExists && sqlParityOkRaw != null) {
    activeParityChecks.push(sqlParityOkRaw === true);
  }
  if (sqliteParityExists && sqliteParityOkRaw != null) {
    activeParityChecks.push(sqliteParityOkRaw === true);
  }
  const parityAllOk = activeParityChecks.length > 0 && activeParityChecks.every(Boolean);
  const parityStatus = activeParityChecks.length === 0
    ? "missing"
    : (parityAllOk ? "pass" : "fail");
  const parityOk = boolNum(parityAllOk);
  const structureProfile = indexData?.structure_profile ?? null;
  const structureKind = String(structureProfile?.kind ?? "unknown");
  const declaredVersion = structureProfile?.declared_workflow_version ?? null;
  const declaredVersionNote = Array.isArray(structureProfile?.notes)
    && structureProfile.notes.some((note) => /Declared workflow_version/i.test(String(note)));
  const declaredVersionLooksStale = boolNum(
    declaredVersionNote
      || (structureKind === "modern"
        && typeof declaredVersion === "string"
        && /^0\.1\./.test(declaredVersion)),
  );

  return {
    ts: new Date().toISOString(),
    summary: {
      schema_version: numericOrNull(indexData?.schema_version),
      rows: actual,
      declared_counts: declared,
      consistency,
      run_metrics: {
        present: boolNum(actual.run_metrics > 0),
      },
      projection: {
        artifacts_with_content: actual.artifacts_with_content,
        artifacts_with_canonical: actual.artifacts_with_canonical,
        canonical_coverage_ratio: actual.artifacts > 0
          ? Number((actual.artifacts_with_canonical / actual.artifacts).toFixed(4))
          : 0,
      },
      parity: {
        status: parityStatus,
        ok_numeric: parityOk,
      },
      parity_sql: {
        status: sqlParityStatus,
        ok_numeric: boolNum(sqlParityOkRaw === true),
      },
      parity_sqlite: {
        status: sqliteParityStatus,
        ok_numeric: boolNum(sqliteParityOkRaw === true),
      },
      structure: {
        kind: structureKind,
        is_mixed: boolNum(structureKind === "mixed"),
        is_unknown: boolNum(structureKind === "unknown"),
        declared_workflow_version: declaredVersion,
        declared_version_looks_stale: declaredVersionLooksStale,
      },
    },
  };
}

function writeJson(filePath, payload) {
  return writeJsonIfChanged(filePath, payload, {
    isEquivalent(previousContent) {
      return isJsonEquivalent(previousContent, payload, ["ts"]);
    },
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const index = readJson(args.indexFile, "Index file");
    const parity = readJsonOptional(args.parityFile, "SQL parity file");
    const sqliteParity = readJsonOptional(args.sqliteParityFile, "SQLite parity file");
    const report = buildReport(index.data, parity.data, parity.exists, sqliteParity.data, sqliteParity.exists);
    report.index_file = index.absolute;
    report.parity_file = parity.absolute;
    report.parity_exists = parity.exists;
    report.sqlite_parity_file = sqliteParity.absolute;
    report.sqlite_parity_exists = sqliteParity.exists;
    const outWrite = writeJson(args.out, report);
    report.output_file = outWrite.path;
    report.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Index report generated: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
    console.log(
      `Rows: cycles=${report.summary.rows.cycles}, artifacts=${report.summary.rows.artifacts}, file_map=${report.summary.rows.file_map}, tags=${report.summary.rows.tags}, run_metrics=${report.summary.rows.run_metrics}`,
    );
    console.log(`Count consistency: ${report.summary.consistency.all_count_match === 1 ? "ok" : "mismatch"}`);
    console.log(`Parity status: ${report.summary.parity.status}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
