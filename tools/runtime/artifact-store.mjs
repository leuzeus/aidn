#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
