#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildIndexReport } from "../../src/application/observability/index-report-use-case.mjs";
import { isJsonEquivalent, writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

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
    const report = buildIndexReport(index.data, parity.data, parity.exists, sqliteParity.data, sqliteParity.exists);
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
