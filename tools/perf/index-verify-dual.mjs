#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildSqlFromIndex } from "../../src/lib/index/index-sql-lib.mjs";

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.json",
    sqlFile: ".aidn/runtime/index/workflow-index.sql",
    schemaFile: "tools/perf/sql/schema.sql",
    includeSchema: true,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sql-file") {
      args.sqlFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--schema-file") {
      args.schemaFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--no-schema") {
      args.includeSchema = false;
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
  if (!args.sqlFile) {
    throw new Error("Missing value for --sql-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-verify-dual.mjs");
  console.log("  node tools/perf/index-verify-dual.mjs --index-file .aidn/runtime/index/workflow-index.json --sql-file .aidn/runtime/index/workflow-index.sql");
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index JSON not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`Invalid JSON in ${absolute}: ${error.message}`);
  }
}

function readSql(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`SQL file not found: ${absolute}`);
  }
  return { absolute, text: normalizeNewlines(fs.readFileSync(absolute, "utf8")) };
}

function readSchema(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Schema file not found: ${absolute}`);
  }
  return { absolute, text: fs.readFileSync(absolute, "utf8").trim() };
}

function findFirstDifferentLine(a, b) {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const max = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < max; i += 1) {
    if ((linesA[i] ?? "") !== (linesB[i] ?? "")) {
      return {
        line: i + 1,
        expected: linesA[i] ?? "",
        actual: linesB[i] ?? "",
      };
    }
  }
  return null;
}

function summarizeIndex(indexData) {
  return {
    cycles: Array.isArray(indexData.cycles) ? indexData.cycles.length : 0,
    artifacts: Array.isArray(indexData.artifacts) ? indexData.artifacts.length : 0,
    file_map: Array.isArray(indexData.file_map) ? indexData.file_map.length : 0,
    tags: Array.isArray(indexData.tags) ? indexData.tags.length : 0,
    artifact_tags: Array.isArray(indexData.artifact_tags) ? indexData.artifact_tags.length : 0,
    run_metrics: Array.isArray(indexData.run_metrics) ? indexData.run_metrics.length : 0,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { absolute: indexPath, data: indexData } = readJson(args.indexFile);
    const { absolute: sqlPath, text: sqlActual } = readSql(args.sqlFile);
    const schema = args.includeSchema ? readSchema(args.schemaFile) : { absolute: null, text: "" };
    const sqlExpected = normalizeNewlines(
      buildSqlFromIndex(indexData, {
        includeSchema: args.includeSchema,
        schemaText: schema.text,
      }),
    );

    const expectedHash = sha256(sqlExpected);
    const actualHash = sha256(sqlActual);
    const ok = expectedHash === actualHash;
    const diff = ok ? null : findFirstDifferentLine(sqlExpected, sqlActual);

    const result = {
      ok,
      index_file: indexPath,
      sql_file: sqlPath,
      schema_file: args.includeSchema ? schema.absolute : null,
      include_schema: args.includeSchema,
      expected_sha256: expectedHash,
      actual_sha256: actualHash,
      summary: summarizeIndex(indexData),
      first_diff: diff,
    };

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Dual-write parity: ${ok ? "OK" : "MISMATCH"}`);
      console.log(`Index: ${indexPath}`);
      console.log(`SQL: ${sqlPath}`);
      console.log(`Expected SHA256: ${expectedHash}`);
      console.log(`Actual SHA256:   ${actualHash}`);
      if (diff) {
        console.log(`First diff line: ${diff.line}`);
      }
      console.log(
        `Rows: cycles=${result.summary.cycles}, artifacts=${result.summary.artifacts}, file_map=${result.summary.file_map}, tags=${result.summary.tags}, artifact_tags=${result.summary.artifact_tags}, run_metrics=${result.summary.run_metrics}`,
      );
    }

    if (!ok) {
      process.exit(2);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
