import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  cleanupOrphanArtifactBlobs,
  ensureWorkflowDbSchema,
  getDatabaseSync,
  getDefaultWorkflowSchemaFile,
  normalizeHotArtifactSubtype,
  rebuildRuntimeHeads,
  upsertArtifactBlobByPath,
} from "../../lib/sqlite/workflow-db-schema-lib.mjs";

function canonicalToJson(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return JSON.stringify(value);
}

function parseCanonical(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolveContent(input) {
  if (Buffer.isBuffer(input.content)) {
    const format = input.content_format ?? "base64";
    return {
      content_format: format,
      content: format === "utf8" ? input.content.toString("utf8") : input.content.toString("base64"),
      bytes: input.content.length,
      sha256: input.sha256 ?? hashBuffer(input.content),
    };
  }
  if (typeof input.content === "string") {
    if (input.content_format === "base64") {
      const buffer = Buffer.from(input.content, "base64");
      return {
        content_format: "base64",
        content: input.content,
        bytes: buffer.length,
        sha256: input.sha256 ?? hashBuffer(buffer),
      };
    }
    const buffer = Buffer.from(input.content, "utf8");
    return {
      content_format: "utf8",
      content: input.content,
      bytes: buffer.length,
      sha256: input.sha256 ?? hashBuffer(buffer),
    };
  }
  const canonicalJson = canonicalToJson(input.canonical);
  if (canonicalJson) {
    const buffer = Buffer.from(canonicalJson, "utf8");
    return {
      content_format: null,
      content: null,
      bytes: buffer.length,
      sha256: input.sha256 ?? hashBuffer(buffer),
    };
  }
  return {
    content_format: null,
    content: null,
    bytes: Number(input.size_bytes ?? 0),
    sha256: input.sha256 ?? hashBuffer(Buffer.from(String(input.path ?? ""), "utf8")),
  };
}

function normalizeArtifact(input) {
  const now = new Date();
  const content = resolveContent(input);
  const mtimeNsRaw = input.mtime_ns ?? `${Math.round(now.getTime() * 1_000_000)}`;
  const mtimeNs = String(mtimeNsRaw);
  return {
    path: String(input.path ?? "").replace(/\\/g, "/"),
    kind: String(input.kind ?? "other"),
    family: String(input.family ?? "unknown"),
    subtype: normalizeHotArtifactSubtype(input.path, input.subtype) ?? input.subtype ?? null,
    gate_relevance: Number(input.gate_relevance ?? 0),
    classification_reason: input.classification_reason ?? null,
    content_format: content.content_format,
    content: content.content,
    canonical_format: input.canonical_format ?? null,
    canonical_json: canonicalToJson(input.canonical),
    sha256: content.sha256,
    size_bytes: Number(input.size_bytes ?? content.bytes),
    mtime_ns: mtimeNs,
    session_id: input.session_id ?? null,
    cycle_id: input.cycle_id ?? null,
    source_mode: input.source_mode ?? "explicit",
    entity_confidence: Number(input.entity_confidence ?? 1),
    legacy_origin: input.legacy_origin ?? null,
    updated_at: input.updated_at ?? now.toISOString(),
  };
}

function parseFrontMatterLike(text) {
  const out = {};
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
    out[key] = String(match[2] ?? "").trim();
  }
  return out;
}

function extractCycleIdFromPath(relPath) {
  const normalized = String(relPath ?? "").replace(/\\/g, "/");
  const match = normalized.match(/^cycles\/(C[0-9]+)[^/]*\/status\.md$/i);
  if (!match) {
    return null;
  }
  return match[1].toUpperCase();
}

function isSafeRelativePath(relPath) {
  if (!relPath || path.isAbsolute(relPath)) {
    return false;
  }
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") {
    return false;
  }
  return true;
}

function decodeContentToBuffer(artifact) {
  if (typeof artifact?.content !== "string") {
    return null;
  }
  const format = String(artifact?.content_format ?? "utf8").toLowerCase();
  if (format === "utf8") {
    return Buffer.from(artifact.content, "utf8");
  }
  if (format === "base64") {
    return Buffer.from(artifact.content, "base64");
  }
  return null;
}

function mapArtifactRow(row) {
  if (!row) {
    return null;
  }
  return {
    path: row.path ?? null,
    kind: row.kind ?? "other",
    family: row.family ?? "unknown",
    subtype: row.subtype ?? null,
    gate_relevance: Number(row.gate_relevance ?? 0),
    classification_reason: row.classification_reason ?? null,
    content_format: row.content_format ?? null,
    content: row.content ?? null,
    canonical_format: row.canonical_format ?? null,
    canonical: parseCanonical(row.canonical_json),
    sha256: row.sha256 ?? null,
    size_bytes: Number(row.size_bytes ?? 0),
    mtime_ns: row.mtime_ns ?? null,
    session_id: row.session_id ?? null,
    cycle_id: row.cycle_id ?? null,
    source_mode: row.source_mode ?? "explicit",
    entity_confidence: Number(row.entity_confidence ?? 1),
    legacy_origin: row.legacy_origin ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function buildArtifactSelectSql() {
  return `
    SELECT
      path,
      kind,
      family,
      subtype,
      gate_relevance,
      classification_reason,
      content_format,
      content,
      canonical_format,
      canonical_json,
      sha256,
      size_bytes,
      CAST(mtime_ns AS TEXT) AS mtime_ns,
      session_id,
      cycle_id,
      source_mode,
      entity_confidence,
      legacy_origin,
      updated_at
    FROM v_materializable_artifacts
  `;
}

export function createArtifactStore(options = {}) {
  const sqliteFile = path.resolve(process.cwd(), options.sqliteFile ?? ".aidn/runtime/index/workflow-index.sqlite");
  const schemaFile = options.schemaFile
    ? path.resolve(process.cwd(), options.schemaFile)
    : getDefaultWorkflowSchemaFile();
  const DatabaseSync = getDatabaseSync();

  fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
  const db = new DatabaseSync(sqliteFile);
  db.exec("PRAGMA foreign_keys=OFF;");
  ensureWorkflowDbSchema({
    db,
    sqliteFile,
    schemaFile,
    role: "artifact-store-adapter",
  });

  const upsertStmt = db.prepare(`
    INSERT INTO artifacts (
      path, kind, family, subtype, gate_relevance, classification_reason, content_format, content, canonical_format, canonical_json, sha256, size_bytes, mtime_ns, session_id, cycle_id, source_mode, entity_confidence, legacy_origin, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      kind = excluded.kind,
      family = excluded.family,
      subtype = excluded.subtype,
      gate_relevance = excluded.gate_relevance,
      classification_reason = excluded.classification_reason,
      content_format = excluded.content_format,
      content = excluded.content,
      canonical_format = excluded.canonical_format,
      canonical_json = excluded.canonical_json,
      sha256 = excluded.sha256,
      size_bytes = excluded.size_bytes,
      mtime_ns = excluded.mtime_ns,
      session_id = excluded.session_id,
      cycle_id = excluded.cycle_id,
      source_mode = excluded.source_mode,
      entity_confidence = excluded.entity_confidence,
      legacy_origin = excluded.legacy_origin,
      updated_at = excluded.updated_at;
  `);

  const getStmt = db.prepare(`
    ${buildArtifactSelectSql()}
    WHERE path = ?
  `);

  const listStmt = db.prepare(`
    ${buildArtifactSelectSql()}
    ORDER BY updated_at DESC, path ASC
    LIMIT ?
  `);

  const listByPathsStmt = db.prepare(`
    ${buildArtifactSelectSql()}
    WHERE path = ?
  `);

  const upsertCycleStmt = db.prepare(`
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

  return {
    sqlite_file: sqliteFile,
    upsertArtifact(input) {
      const artifact = normalizeArtifact(input);
      if (!artifact.path) {
        throw new Error("Artifact path is required");
      }
      upsertStmt.run(
        artifact.path,
        artifact.kind,
        artifact.family,
        artifact.subtype,
        artifact.gate_relevance,
        artifact.classification_reason,
        artifact.content_format,
        artifact.content,
        artifact.canonical_format,
        artifact.canonical_json,
        artifact.sha256,
        artifact.size_bytes,
        artifact.mtime_ns,
        artifact.session_id,
        artifact.cycle_id,
        artifact.source_mode,
        artifact.entity_confidence,
        artifact.legacy_origin,
        artifact.updated_at,
      );
      upsertArtifactBlobByPath(db, artifact.path);
      rebuildRuntimeHeads(db);
      cleanupOrphanArtifactBlobs(db);
      const cycleId = extractCycleIdFromPath(artifact.path);
      if (cycleId && artifact.content_format === "utf8" && typeof artifact.content === "string") {
        const meta = parseFrontMatterLike(artifact.content);
        upsertCycleStmt.run(
          cycleId,
          meta.session_owner ?? null,
          String(meta.state ?? "UNKNOWN").toUpperCase(),
          meta.outcome ?? null,
          meta.branch_name ?? null,
          meta.dor_state ?? null,
          meta.continuity_rule ?? null,
          meta.continuity_base_branch ?? null,
          meta.continuity_latest_cycle_branch ?? null,
          artifact.updated_at,
        );
      }
      return mapArtifactRow(getStmt.get(artifact.path));
    },
    getArtifact(artifactPath) {
      const rel = String(artifactPath ?? "").replace(/\\/g, "/");
      if (!rel) {
        return null;
      }
      return mapArtifactRow(getStmt.get(rel));
    },
    listArtifacts(limit = 50) {
      const safeLimit = Math.max(1, Number(limit || 50));
      return listStmt.all(safeLimit).map((row) => mapArtifactRow(row));
    },
    materializeArtifacts(options = {}) {
      const targetRoot = path.resolve(process.cwd(), options.targetRoot ?? ".");
      const auditRoot = path.resolve(targetRoot, options.auditRoot ?? "docs/audit");
      const onlyPaths = Array.isArray(options.onlyPaths)
        ? options.onlyPaths.map((item) => String(item).replace(/\\/g, "/")).filter((item) => item.length > 0)
        : [];
      const dryRun = options.dryRun === true;
      const rows = onlyPaths.length > 0
        ? onlyPaths.map((rel) => listByPathsStmt.get(rel)).filter((row) => row != null)
        : listStmt.all(Number(options.limit ?? 500));
      let exported = 0;
      let unchanged = 0;
      let missingContent = 0;
      let unsafe = 0;
      let bytesWritten = 0;
      for (const row of rows) {
        const artifact = mapArtifactRow(row);
        const rel = String(artifact?.path ?? "").replace(/\\/g, "/");
        if (!isSafeRelativePath(rel)) {
          unsafe += 1;
          continue;
        }
        const content = decodeContentToBuffer(artifact);
        if (!content) {
          missingContent += 1;
          continue;
        }
        const absolute = path.resolve(auditRoot, rel);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        if (fs.existsSync(absolute)) {
          const previous = fs.readFileSync(absolute);
          if (previous.equals(content)) {
            unchanged += 1;
            continue;
          }
        }
        if (!dryRun) {
          fs.writeFileSync(absolute, content);
        }
        exported += 1;
        bytesWritten += content.length;
      }
      return {
        target_root: targetRoot,
        audit_root: auditRoot,
        dry_run: dryRun,
        selected_count: rows.length,
        exported,
        unchanged,
        missing_content: missingContent,
        skipped_unsafe_path: unsafe,
        bytes_written: bytesWritten,
      };
    },
    close() {
      db.close();
    },
  };
}

function parseArgs(argv) {
  const args = {
    action: "",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    path: "",
    kind: "other",
    family: "unknown",
    contentFile: "",
    contentFormat: "utf8",
    auditRoot: "docs/audit",
    onlyPaths: [],
    dryRun: false,
    limit: 10,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "upsert" || token === "get" || token === "list" || token === "materialize") {
      args.action = token;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--path") {
      args.path = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--kind") {
      args.kind = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--family") {
      args.family = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--content-file") {
      args.contentFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--content-format") {
      args.contentFormat = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--audit-root") {
      args.auditRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--only-path") {
      const raw = String(argv[i + 1] ?? "").trim();
      i += 1;
      if (!raw) {
        throw new Error("Missing value for --only-path");
      }
      args.onlyPaths.push(raw.replace(/\\/g, "/"));
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--limit") {
      args.limit = Number(argv[i + 1] ?? 10);
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
  if (!args.action) {
    throw new Error("Missing action. Expected upsert|get|list|materialize");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime artifact-store list --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
  console.log("  npx aidn runtime artifact-store get --path snapshots/context-snapshot.md --json");
  console.log("  npx aidn runtime artifact-store upsert --path snapshots/context-snapshot.md --kind snapshot --family normative --content-file docs/audit/snapshots/context-snapshot.md --json");
  console.log("  npx aidn runtime artifact-store materialize --audit-root docs/audit --only-path snapshots/context-snapshot.md --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const store = createArtifactStore({
      sqliteFile: args.sqliteFile,
    });
    try {
      let payload = null;
      if (args.action === "list") {
        payload = {
          sqlite_file: store.sqlite_file,
          artifacts: store.listArtifacts(args.limit),
        };
      } else if (args.action === "get") {
        if (!args.path) {
          throw new Error("Missing value for --path");
        }
        payload = {
          sqlite_file: store.sqlite_file,
          artifact: store.getArtifact(args.path),
        };
      } else if (args.action === "upsert") {
        if (!args.path) {
          throw new Error("Missing value for --path");
        }
        if (!args.contentFile) {
          throw new Error("Missing value for --content-file");
        }
        const absolute = path.resolve(process.cwd(), args.contentFile);
        if (!fs.existsSync(absolute)) {
          throw new Error(`Content file not found: ${absolute}`);
        }
        const buffer = fs.readFileSync(absolute);
        const artifact = store.upsertArtifact({
          path: args.path,
          kind: args.kind,
          family: args.family,
          content: args.contentFormat === "base64" ? buffer.toString("base64") : buffer.toString("utf8"),
          content_format: args.contentFormat === "base64" ? "base64" : "utf8",
        });
        payload = {
          sqlite_file: store.sqlite_file,
          artifact,
        };
      } else if (args.action === "materialize") {
        payload = {
          sqlite_file: store.sqlite_file,
          result: store.materializeArtifacts({
            targetRoot: ".",
            auditRoot: args.auditRoot,
            onlyPaths: args.onlyPaths,
            dryRun: args.dryRun,
            limit: args.limit,
          }),
        };
      }
      if (args.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Artifact store OK: ${args.action}`);
      }
    } finally {
      store.close();
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}


