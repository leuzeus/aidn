import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildSqlFromIndex } from "./index-sql-lib.mjs";
import { writeUtf8IfChanged } from "./io-lib.mjs";

const require = createRequire(import.meta.url);
const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function getDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch (error) {
    throw new Error(`SQLite backend unavailable: ${error.message}`);
  }
}

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

function toIdempotentSchema(schemaText) {
  return String(schemaText).replace(/CREATE TABLE\s+/gi, "CREATE TABLE IF NOT EXISTS ");
}

function payloadDigest(payload) {
  const stable = stableIndexProjection(payload);
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
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

function runInsert(statement, rows, projector) {
  for (const row of rows) {
    statement.run(...projector(row));
  }
}

function ensureMetaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
  `);
}

function getMeta(db, key) {
  const stmt = db.prepare("SELECT value FROM index_meta WHERE key = ?");
  const row = stmt.get(key);
  return row?.value ?? null;
}

function setMeta(db, key, value) {
  const stmt = db.prepare(`
    INSERT INTO index_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;
  `);
  stmt.run(key, value, new Date().toISOString());
}

function writeSqliteIndex(outputPath, payload, schemaFile) {
  const DatabaseSync = getDatabaseSync();
  const absolute = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const schemaText = toIdempotentSchema(readSchema(schemaFile));
  const nextDigest = payloadDigest(payload);
  const existedBefore = fs.existsSync(absolute);
  const sizeBefore = existedBefore ? fs.statSync(absolute).size : 0;

  const db = new DatabaseSync(absolute);
  try {
    db.exec("PRAGMA foreign_keys=OFF;");
    db.exec(schemaText);
    ensureMetaTable(db);
    const prevDigest = getMeta(db, "payload_digest");
    if (prevDigest === nextDigest) {
      return {
        path: absolute,
        written: false,
        bytes_written: 0,
      };
    }

    db.exec("BEGIN TRANSACTION;");
    try {
      db.exec("DELETE FROM artifact_tags;");
      db.exec("DELETE FROM tags;");
      db.exec("DELETE FROM file_map;");
      db.exec("DELETE FROM artifacts;");
      db.exec("DELETE FROM cycles;");
      db.exec("DELETE FROM run_metrics;");

      const cycles = Array.isArray(payload.cycles) ? payload.cycles : [];
      const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
      const fileMap = Array.isArray(payload.file_map) ? payload.file_map : [];
      const tags = Array.isArray(payload.tags) ? payload.tags : [];
      const artifactTags = Array.isArray(payload.artifact_tags) ? payload.artifact_tags : [];
      const runMetrics = Array.isArray(payload.run_metrics) ? payload.run_metrics : [];

      const cycleStmt = db.prepare(`
        INSERT INTO cycles (
          cycle_id, session_id, state, outcome, branch_name, dor_state,
          continuity_rule, continuity_base_branch, continuity_latest_cycle_branch, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cycle_id) DO UPDATE SET
          session_id = excluded.session_id,
          state = excluded.state,
          outcome = excluded.outcome,
          branch_name = excluded.branch_name,
          dor_state = excluded.dor_state,
          continuity_rule = excluded.continuity_rule,
          continuity_base_branch = excluded.continuity_base_branch,
          continuity_latest_cycle_branch = excluded.continuity_latest_cycle_branch,
          updated_at = excluded.updated_at;
      `);
      runInsert(cycleStmt, cycles, (row) => ([
        row.cycle_id ?? null,
        row.session_id ?? null,
        row.state ?? "UNKNOWN",
        row.outcome ?? null,
        row.branch_name ?? null,
        row.dor_state ?? null,
        row.continuity_rule ?? null,
        row.continuity_base_branch ?? null,
        row.continuity_latest_cycle_branch ?? null,
        row.updated_at ?? new Date().toISOString(),
      ]));

      const artifactStmt = db.prepare(`
        INSERT INTO artifacts (
          path, kind, sha256, size_bytes, mtime_ns, session_id, cycle_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `);
      runInsert(artifactStmt, artifacts, (row) => ([
        row.path ?? null,
        row.kind ?? "other",
        row.sha256 ?? null,
        Number(row.size_bytes ?? 0),
        Number(row.mtime_ns ?? 0),
        row.session_id ?? null,
        row.cycle_id ?? null,
        row.updated_at ?? new Date().toISOString(),
      ]));

      const fileMapStmt = db.prepare(`
        INSERT INTO file_map (cycle_id, path, role, last_seen_at)
        VALUES (?, ?, ?, ?);
      `);
      runInsert(fileMapStmt, fileMap, (row) => ([
        row.cycle_id ?? null,
        row.path ?? null,
        row.role ?? null,
        row.last_seen_at ?? new Date().toISOString(),
      ]));

      const tagStmt = db.prepare("INSERT INTO tags (tag) VALUES (?);");
      runInsert(tagStmt, tags, (row) => [row.tag ?? ""]);

      const artifactIdStmt = db.prepare("SELECT artifact_id FROM artifacts WHERE path = ?;");
      const tagIdStmt = db.prepare("SELECT tag_id FROM tags WHERE tag = ?;");
      const artifactTagStmt = db.prepare("INSERT INTO artifact_tags (artifact_id, tag_id) VALUES (?, ?);");
      for (const row of artifactTags) {
        const artifactId = artifactIdStmt.get(row.path ?? "")?.artifact_id ?? null;
        const tagId = tagIdStmt.get(row.tag ?? "")?.tag_id ?? null;
        if (artifactId == null || tagId == null) {
          continue;
        }
        artifactTagStmt.run(artifactId, tagId);
      }

      const runMetricsStmt = db.prepare(`
        INSERT INTO run_metrics (
          run_id, started_at, ended_at, overhead_ratio, artifacts_churn, gates_frequency
        ) VALUES (?, ?, ?, ?, ?, ?);
      `);
      runInsert(runMetricsStmt, runMetrics, (row) => ([
        row.run_id ?? null,
        row.started_at ?? new Date().toISOString(),
        row.ended_at ?? null,
        row.overhead_ratio ?? null,
        row.artifacts_churn ?? null,
        row.gates_frequency ?? null,
      ]));

      setMeta(db, "payload_digest", nextDigest);
      setMeta(db, "schema_version", String(payload?.schema_version ?? 1));
      setMeta(db, "structure_kind", String(payload?.summary?.structure_kind ?? "unknown"));
      setMeta(db, "target_root", String(payload?.target_root ?? ""));
      setMeta(db, "audit_root", String(payload?.audit_root ?? ""));
      setMeta(db, "structure_profile_json", JSON.stringify(payload?.structure_profile ?? null));
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    try {
      db.exec("PRAGMA foreign_keys=ON;");
    } catch {
      // ignore best-effort pragma restore
    }
    db.close();
  }

  const sizeAfter = fs.existsSync(absolute) ? fs.statSync(absolute).size : sizeBefore;
  return {
    path: absolute,
    written: true,
    bytes_written: sizeAfter,
  };
}

export function createIndexStore(options = {}) {
  const mode = String(options.mode ?? "file").trim().toLowerCase();
  const jsonOutput = options.jsonOutput ?? ".aidn/runtime/index/workflow-index.json";
  const sqlOutput = options.sqlOutput ?? ".aidn/runtime/index/workflow-index.sql";
  const sqliteOutput = options.sqliteOutput ?? ".aidn/runtime/index/workflow-index.sqlite";
  const schemaFile = options.schemaFile ?? path.join(PERF_DIR, "sql", "schema.sql");
  const includeSchema = options.includeSchema !== false;

  if (!["file", "sql", "dual", "sqlite", "dual-sqlite", "all"].includes(mode)) {
    throw new Error(`Invalid --store mode: ${mode}. Expected file|sql|dual|sqlite|dual-sqlite|all.`);
  }

  return {
    mode,
    write(payload) {
      const outputs = [];
      if (mode === "file" || mode === "dual" || mode === "dual-sqlite" || mode === "all") {
        const out = writeJsonIndex(jsonOutput, payload);
        outputs.push({
          kind: "file",
          path: out.path,
          written: out.written,
          bytes_written: out.bytes_written,
        });
      }
      if (mode === "sql" || mode === "dual" || mode === "all") {
        const out = writeSqlIndex(sqlOutput, payload, schemaFile, includeSchema);
        outputs.push({
          kind: "sql",
          path: out.path,
          written: out.written,
          bytes_written: out.bytes_written,
        });
      }
      if (mode === "sqlite" || mode === "dual-sqlite" || mode === "all") {
        const out = writeSqliteIndex(sqliteOutput, payload, schemaFile);
        outputs.push({
          kind: "sqlite",
          path: out.path,
          written: out.written,
          bytes_written: out.bytes_written,
        });
      }
      return outputs;
    },
  };
}
