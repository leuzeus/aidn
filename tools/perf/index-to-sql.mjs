#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildSqlFromIndex } from "./index-sql-lib.mjs";

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.json",
    schemaFile: "tools/perf/sql/schema.sql",
    out: ".aidn/runtime/index/workflow-index.sql",
    includeSchema: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--schema-file") {
      args.schemaFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--no-schema") {
      args.includeSchema = false;
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
  console.log("  node tools/perf/index-to-sql.mjs");
  console.log("  node tools/perf/index-to-sql.mjs --index-file .aidn/runtime/index/workflow-index.json --out .aidn/runtime/index/workflow-index.sql");
  console.log("  node tools/perf/index-to-sql.mjs --no-schema");
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

function readText(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Schema file not found: ${absolute}`);
  }
  return { absolute, text: fs.readFileSync(absolute, "utf8").trim() };
}

function writeFile(filePath, content) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
  return absolute;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { absolute: indexAbsolute, data: indexData } = readJson(args.indexFile);
    const schema = args.includeSchema ? readText(args.schemaFile) : { absolute: null, text: "" };
    const sql = buildSqlFromIndex(indexData, { includeSchema: args.includeSchema, schemaText: schema.text });
    const outputAbsolute = writeFile(args.out, sql);

    console.log("SQL export generated.");
    console.log(`Index: ${indexAbsolute}`);
    if (args.includeSchema) {
      console.log(`Schema: ${schema.absolute}`);
    }
    console.log(`Output: ${outputAbsolute}`);
    console.log(
      `Rows: cycles=${(indexData.cycles ?? []).length}, artifacts=${(indexData.artifacts ?? []).length}, file_map=${(indexData.file_map ?? []).length}, tags=${(indexData.tags ?? []).length}, artifact_tags=${(indexData.artifact_tags ?? []).length}`,
    );
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
