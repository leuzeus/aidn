import fs from "node:fs";
import path from "node:path";
import { buildSqlFromIndex } from "./index-sql-lib.mjs";

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

function writeUtf8(filePath, content) {
  const absolute = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  if (fs.existsSync(absolute)) {
    const previous = fs.readFileSync(absolute, "utf8");
    if (previous === content) {
      return {
        path: absolute,
        written: false,
        bytes_written: 0,
      };
    }
  }
  fs.writeFileSync(absolute, content, "utf8");
  return {
    path: absolute,
    written: true,
    bytes_written: Buffer.byteLength(content, "utf8"),
  };
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
  const absolute = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  if (fs.existsSync(absolute)) {
    const previous = fs.readFileSync(absolute, "utf8");
    if (previous === content || isJsonIndexEquivalent(previous, payload)) {
      return {
        path: absolute,
        written: false,
        bytes_written: 0,
      };
    }
  }
  fs.writeFileSync(absolute, content, "utf8");
  return {
    path: absolute,
    written: true,
    bytes_written: Buffer.byteLength(content, "utf8"),
  };
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
