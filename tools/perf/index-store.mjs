import fs from "node:fs";
import path from "node:path";
import { buildSqlFromIndex } from "./index-sql-lib.mjs";
import { writeUtf8IfChanged } from "./io-lib.mjs";

function stableIndexProjection(indexPayload) {
  if (!indexPayload || typeof indexPayload !== "object") {
    return indexPayload;
  }
  const clone = JSON.parse(JSON.stringify(indexPayload));
  delete clone.generated_at;
  return clone;
}

function isJsonIndexEquivalent(previousContent, nextPayload) {
  try {
    const previous = JSON.parse(previousContent);
    const previousStable = stableIndexProjection(previous);
    const nextStable = stableIndexProjection(nextPayload);
    return JSON.stringify(previousStable) === JSON.stringify(nextStable);
  } catch {
    return false;
  }
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
  return writeUtf8IfChanged(outputPath, content, {
    isEquivalent(previous) {
      return isJsonIndexEquivalent(previous, payload);
    },
  });
}

function writeSqlIndex(outputPath, payload, schemaFile, includeSchema) {
  const schemaText = includeSchema ? readSchema(schemaFile) : "";
  const content = buildSqlFromIndex(payload, { includeSchema, schemaText });
  return writeUtf8IfChanged(outputPath, content);
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
        const out = writeJsonIndex(jsonOutput, payload);
        outputs.push({
          kind: "file",
          path: out.path,
          written: out.written,
          bytes_written: out.bytes_written,
        });
      }
      if (mode === "sql" || mode === "dual") {
        const out = writeSqlIndex(sqlOutput, payload, schemaFile, includeSchema);
        outputs.push({
          kind: "sql",
          path: out.path,
          written: out.written,
          bytes_written: out.bytes_written,
        });
      }
      return outputs;
    },
  };
}
