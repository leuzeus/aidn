#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function buildArtifactStoreDiagnostic(action, payload, args) {
  const normalizedAction = normalizeScalar(action) || "unknown";
  if (normalizedAction === "list") {
    const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
    return {
      scope: "runtime-artifact-store-list",
      action: normalizedAction,
      artifact_count: artifacts.length,
      path: "",
      dry_run: false,
      summary: `listed ${artifacts.length} artifact store row(s)`,
      recommended_action: "use get for a specific artifact path or upsert to refresh stored content",
    };
  }
  if (normalizedAction === "get") {
    return {
      scope: "runtime-artifact-store-get",
      action: normalizedAction,
      artifact_count: payload?.artifact ? 1 : 0,
      path: normalizeScalar(payload?.artifact?.path || args?.path),
      dry_run: false,
      summary: payload?.artifact
        ? `loaded artifact ${normalizeScalar(payload.artifact.path) || "unknown"}`
        : `artifact ${normalizeScalar(args?.path) || "unknown"} is not present in the store`,
      recommended_action: payload?.artifact
        ? "inspect the canonical payload or materialize when a file projection is needed"
        : "upsert the artifact before retrying get",
    };
  }
  if (normalizedAction === "upsert") {
    return {
      scope: "runtime-artifact-store-upsert",
      action: normalizedAction,
      artifact_count: payload?.artifact ? 1 : 0,
      path: normalizeScalar(payload?.artifact?.path || args?.path),
      dry_run: false,
      summary: `upserted artifact ${normalizeScalar(payload?.artifact?.path || args?.path) || "unknown"}`,
      recommended_action: "materialize the artifact if filesystem projections must be refreshed immediately",
    };
  }
  const materializedCount = Number(payload?.result?.materialized_count ?? 0);
  return {
    scope: "runtime-artifact-store-materialize",
    action: normalizedAction,
    artifact_count: materializedCount,
    path: Array.isArray(args?.onlyPaths) && args.onlyPaths.length === 1 ? normalizeScalar(args.onlyPaths[0]) : "",
    dry_run: args?.dryRun === true,
    summary: args?.dryRun === true
      ? `previewed materialization for ${materializedCount} artifact(s)`
      : `materialized ${materializedCount} artifact(s)`,
    recommended_action: args?.dryRun === true
      ? "rerun without --dry-run only after reviewing the materialization plan"
      : "review the written audit files and store contents for consistency",
  };
}

function parseArgs(argv) {
  const args = {
    action: "",
    target: ".",
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
    } else if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
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
  console.log("  npx aidn runtime artifact-store list --target . --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
  console.log("  npx aidn runtime artifact-store get --target . --path snapshots/context-snapshot.md --json");
  console.log("  npx aidn runtime artifact-store upsert --target . --path snapshots/context-snapshot.md --kind snapshot --family normative --content-file docs/audit/snapshots/context-snapshot.md --json");
  console.log("  npx aidn runtime artifact-store materialize --target . --audit-root docs/audit --only-path snapshots/context-snapshot.md --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target || ".");
    const store = createArtifactStore({
      sqliteFile: path.isAbsolute(args.sqliteFile)
        ? args.sqliteFile
        : path.resolve(targetRoot, args.sqliteFile),
    });
    try {
      let payload = null;
      if (args.action === "list") {
        payload = {
          action: args.action,
          sqlite_file: store.sqlite_file,
          artifacts: store.listArtifacts(args.limit),
        };
      } else if (args.action === "get") {
        if (!args.path) {
          throw new Error("Missing value for --path");
        }
        payload = {
          action: args.action,
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
        const absolute = path.isAbsolute(args.contentFile)
          ? args.contentFile
          : path.resolve(targetRoot, args.contentFile);
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
          action: args.action,
          sqlite_file: store.sqlite_file,
          artifact,
        };
      } else if (args.action === "materialize") {
        payload = {
          action: args.action,
          sqlite_file: store.sqlite_file,
          result: store.materializeArtifacts({
            targetRoot,
            auditRoot: args.auditRoot,
            onlyPaths: args.onlyPaths,
            dryRun: args.dryRun,
            limit: args.limit,
          }),
        };
      }
      payload.artifact_store_diagnostic = buildArtifactStoreDiagnostic(args.action, payload, args);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
