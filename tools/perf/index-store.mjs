import fs from "node:fs";
import path from "node:path";
import { buildSqlFromIndex } from "./index-sql-lib.mjs";

function writeUtf8(filePath, content) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
  return absolute;
}

function readSchema(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Schema file not found: ${absolute}`);
  }
  return fs.readFileSync(absolute, "utf8").trim();
}

function writeJsonIndex(outputPath, payload) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  return writeUtf8(outputPath, content);
}

function writeSqlIndex(outputPath, payload, schemaFile, includeSchema) {
  const schemaText = includeSchema ? readSchema(schemaFile) : "";
  const content = buildSqlFromIndex(payload, { includeSchema, schemaText });
  return writeUtf8(outputPath, content);
}

export function createIndexStore(options = {}) {
  const mode = String(options.mode ?? "file").trim().toLowerCase();
  const jsonOutput = options.jsonOutput ?? ".aidn/runtime/index/workflow-index.json";
  const sqlOutput = options.sqlOutput ?? ".aidn/runtime/index/workflow-index.sql";
  const schemaFile = options.schemaFile ?? "tools/perf/sql/schema.sql";
  const includeSchema = options.includeSchema !== false;

  if (!["file", "sql", "dual"].includes(mode)) {
    throw new Error(`Invalid --store mode: ${mode}. Expected file|sql|dual.`);
  }

  return {
    mode,
    write(payload) {
      const outputs = [];
      if (mode === "file" || mode === "dual") {
        outputs.push({
          kind: "file",
          path: writeJsonIndex(jsonOutput, payload),
        });
      }
      if (mode === "sql" || mode === "dual") {
        outputs.push({
          kind: "sql",
          path: writeSqlIndex(sqlOutput, payload, schemaFile, includeSchema),
        });
      }
      return outputs;
    },
  };
}
