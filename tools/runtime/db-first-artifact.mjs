#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanonicalFromMarkdown } from "../perf/markdown-render-lib.mjs";
import {
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigStateMode,
} from "../aidn-config-lib.mjs";
import { createArtifactStore } from "./artifact-store.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    auditRoot: "docs/audit",
    path: "",
    sourceFile: "",
    content: "",
    kind: "other",
    family: "unknown",
    subtype: "",
    cycleId: "",
    sessionId: "",
    stateMode: "",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    materialize: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--audit-root") {
      args.auditRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--path") {
      args.path = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--source-file" || token === "--content-file") {
      args.sourceFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--content") {
      args.content = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--kind") {
      args.kind = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--family") {
      args.family = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--subtype") {
      args.subtype = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--cycle-id") {
      args.cycleId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--session-id") {
      args.sessionId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--materialize") {
      args.materialize = "true";
    } else if (token === "--no-materialize") {
      args.materialize = "false";
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.path) {
    throw new Error("Missing value for --path");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/db-first-artifact.mjs --target . --path snapshots/context-snapshot.md --source-file docs/audit/snapshots/context-snapshot.md --kind snapshot --family normative --json");
  console.log("  node tools/runtime/db-first-artifact.mjs --target . --path sessions/S001.md --content \"# Session\" --kind session --family normative --materialize --json");
}

export function resolveStateMode(targetRoot, requested) {
  const requestedMode = normalizeStateMode(requested);
  if (requestedMode) {
    return requestedMode;
  }
  const envMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envMode) {
    return envMode;
  }
  const config = readAidnProjectConfig(targetRoot);
  return resolveConfigStateMode(config.data) ?? "files";
}

export function inferKind(relPath, explicitKind) {
  if (explicitKind && explicitKind !== "other") {
    return explicitKind;
  }
  const rel = String(relPath).replace(/\\/g, "/");
  if (rel === "SPEC.md") return "spec";
  if (rel === "WORKFLOW.md") return "workflow";
  if (rel === "snapshots/context-snapshot.md") return "snapshot";
  if (rel === "baseline/current.md" || rel === "baseline/history.md") return "baseline";
  if (/^sessions\/S[0-9]+.*\.md$/i.test(rel)) return "session";
  if (/^cycles\/C[0-9]+.*\/status\.md$/i.test(rel)) return "cycle_status";
  return "other";
}

export function inferFamily(relPath, explicitFamily) {
  if (explicitFamily && explicitFamily !== "unknown") {
    return explicitFamily;
  }
  const rel = String(relPath).replace(/\\/g, "/");
  const normative = new Set([
    "SPEC.md",
    "WORKFLOW.md",
    "WORKFLOW_SUMMARY.md",
    "baseline/current.md",
    "baseline/history.md",
    "snapshots/context-snapshot.md",
    "CONTINUITY_GATE.md",
    "RULE_STATE_BOUNDARY.md",
    "CODEX_ONLINE.md",
    "index.md",
    "parking-lot.md",
  ]);
  if (normative.has(rel)) {
    return "normative";
  }
  if (rel.startsWith("cycles/") || rel.startsWith("sessions/")) {
    return "normative";
  }
  return "support";
}

export function shouldMaterialize(stateMode, materializeFlag) {
  if (materializeFlag === "true") {
    return true;
  }
  if (materializeFlag === "false") {
    return false;
  }
  return stateMode === "dual" || stateMode === "files";
}

export function loadContent(targetRoot, sourceFile, inlineContent) {
  if (sourceFile) {
    const absolute = path.isAbsolute(sourceFile) ? sourceFile : path.resolve(targetRoot, sourceFile);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Source file not found: ${absolute}`);
    }
    return fs.readFileSync(absolute, "utf8");
  }
  if (inlineContent.length > 0) {
    return inlineContent;
  }
  throw new Error("Missing content source. Use --source-file or --content");
}

export function upsertDbFirstArtifact(options = {}) {
  const targetRoot = path.resolve(process.cwd(), options.target ?? ".");
  const stateMode = resolveStateMode(targetRoot, options.stateMode);
  const relPath = String(options.path ?? "").replace(/\\/g, "/");
  if (!relPath) {
    throw new Error("Missing path for upsertDbFirstArtifact");
  }
  const content = loadContent(targetRoot, options.sourceFile ?? "", options.content ?? "");
  const kind = inferKind(relPath, options.kind ?? "other");
  const family = inferFamily(relPath, options.family ?? "unknown");
  const canonical = relPath.toLowerCase().endsWith(".md")
    ? buildCanonicalFromMarkdown(content, {
      relativePath: relPath,
      kind,
    })
    : null;

  const store = createArtifactStore({
    sqliteFile: path.isAbsolute(options.sqliteFile ?? "")
      ? options.sqliteFile
      : path.resolve(targetRoot, options.sqliteFile ?? ".aidn/runtime/index/workflow-index.sqlite"),
  });
  try {
    const artifact = store.upsertArtifact({
      path: relPath,
      kind,
      family,
      subtype: options.subtype || null,
      content,
      content_format: "utf8",
      canonical_format: canonical ? "markdown-canonical-v1" : null,
      canonical,
      session_id: options.sessionId || null,
      cycle_id: options.cycleId || null,
    });
    const materialize = shouldMaterialize(stateMode, options.materialize ?? "");
    let materializeResult = null;
    if (materialize) {
      materializeResult = store.materializeArtifacts({
        targetRoot,
        auditRoot: options.auditRoot ?? "docs/audit",
        onlyPaths: [relPath],
        dryRun: false,
        limit: 10,
      });
    }
    return {
      ts: new Date().toISOString(),
      ok: true,
      target_root: targetRoot,
      state_mode: stateMode,
      materialized: materialize,
      artifact,
      materialize_result: materializeResult,
    };
  } finally {
    store.close();
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const out = upsertDbFirstArtifact(args);
    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`DB-first artifact upsert OK: ${out.artifact.path} (state_mode=${out.state_mode}, materialized=${out.materialized ? "yes" : "no"})`);
    }
  } catch (error) {
    const out = {
      ts: new Date().toISOString(),
      ok: false,
      message: String(error.message ?? error),
    };
    console.error(JSON.stringify(out, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
