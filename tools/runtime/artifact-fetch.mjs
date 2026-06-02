#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import {
  readAidnProjectConfig,
  resolveConfigRuntimePersistenceBackend,
} from "../../src/lib/config/aidn-config-lib.mjs";
import { readRuntimeSnapshot } from "../../src/application/runtime/runtime-snapshot-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
    artifactId: "",
    path: "",
    sessionId: "",
    cycleId: "",
    metadataOnly: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--artifact-id") {
      args.artifactId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--path") {
      args.path = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--session-id") {
      args.sessionId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--cycle-id") {
      args.cycleId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--metadata-only") {
      args.metadataOnly = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!["auto", "json", "sqlite", "postgres"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite|postgres");
  }
  if (!args.artifactId && !args.path && !args.sessionId && !args.cycleId) {
    throw new Error("Provide one selector: --artifact-id, --path, --session-id, or --cycle-id.");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime artifact-fetch --target . --path CURRENT-STATE.md --json");
  console.log("  npx aidn runtime artifact-fetch --target . --artifact-id 42 --json");
  console.log("  npx aidn runtime artifact-fetch --target . --session-id S001 --metadata-only --json");
}

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^docs\/audit\//i, "");
}

function sourceDigest(payload, artifact) {
  return crypto.createHash("sha256").update(JSON.stringify({
    generated_at: payload?.generated_at ?? null,
    schema_version: payload?.schema_version ?? null,
    artifact_id: artifact?.artifact_id ?? null,
    path: artifact?.path ?? null,
    sha256: artifact?.sha256 ?? null,
    updated_at: artifact?.updated_at ?? null,
  }), "utf8").digest("hex");
}

function findArtifact(payload, args) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  if (args.artifactId) {
    const needle = String(args.artifactId);
    return artifacts.find((artifact) => String(artifact?.artifact_id ?? "") === needle) ?? null;
  }
  if (args.path) {
    const needle = normalizePath(args.path);
    return artifacts.find((artifact) => normalizePath(artifact?.path) === needle) ?? null;
  }
  if (args.sessionId) {
    const needle = String(args.sessionId);
    return artifacts.find((artifact) => String(artifact?.session_id ?? "") === needle) ?? null;
  }
  if (args.cycleId) {
    const needle = String(args.cycleId);
    return artifacts.find((artifact) => String(artifact?.cycle_id ?? "") === needle) ?? null;
  }
  return null;
}

function artifactForOutput(artifact, metadataOnly) {
  if (!artifact) {
    return null;
  }
  const base = {
    artifact_id: artifact.artifact_id ?? null,
    path: artifact.path ?? null,
    kind: artifact.kind ?? "other",
    family: artifact.family ?? "unknown",
    session_id: artifact.session_id ?? null,
    cycle_id: artifact.cycle_id ?? null,
    source_mode: artifact.source_mode ?? "explicit",
    sha256: artifact.sha256 ?? null,
    size_bytes: Number(artifact.size_bytes ?? 0),
    updated_at: artifact.updated_at ?? null,
    has_content: typeof artifact.content === "string",
  };
  if (!metadataOnly) {
    base.content_format = artifact.content_format ?? "utf8";
    base.content = artifact.content ?? null;
    base.canonical = artifact.canonical ?? null;
  }
  return base;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const config = readAidnProjectConfig(targetRoot);
    const configuredBackend = resolveConfigRuntimePersistenceBackend(config.data);
    const backend = args.backend === "auto" && configuredBackend ? configuredBackend : args.backend;
    const indexFile = path.resolve(targetRoot, args.indexFile);
    const snapshot = await readRuntimeSnapshot({
      indexFile,
      backend,
      targetRoot,
      configData: config.data,
    });
    const artifact = findArtifact(snapshot.payload, args);
    const result = {
      kind: "runtime-artifact-fetch",
      target_root: targetRoot,
      selector: {
        artifact_id: args.artifactId || null,
        path: args.path || null,
        session_id: args.sessionId || null,
        cycle_id: args.cycleId || null,
      },
      found: artifact != null,
      source_backend: snapshot.backend,
      source_file: snapshot.absolute,
      source_revision: artifact ? sourceDigest(snapshot.payload, artifact) : null,
      project_context: snapshot.payload?.project_context ?? null,
      artifact: artifactForOutput(artifact, args.metadataOnly),
    };
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.found) {
      console.log(`Artifact: ${result.artifact.path} (${result.source_backend})`);
    } else {
      console.log("Artifact: not found");
    }
    if (!result.found) {
      process.exit(2);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
