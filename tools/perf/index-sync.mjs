#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createIndexStore } from "./index-store.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    output: ".aidn/runtime/index/workflow-index.json",
    store: "file",
    sqlOutput: ".aidn/runtime/index/workflow-index.sql",
    schemaFile: "tools/perf/sql/schema.sql",
    includeSchema: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--output") {
      args.output = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--store") {
      args.store = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sql-output") {
      args.sqlOutput = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--schema-file") {
      args.schemaFile = argv[i + 1] ?? "";
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

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.output) {
    throw new Error("Missing value for --output");
  }
  args.store = String(args.store).toLowerCase();
  if (!["file", "sql", "dual"].includes(args.store)) {
    throw new Error(`Invalid --store mode: ${args.store}. Expected file|sql|dual.`);
  }
  if ((args.store === "sql" || args.store === "dual") && !args.sqlOutput) {
    throw new Error("Missing value for --sql-output");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-sync.mjs --target ../client");
  console.log("  node tools/perf/index-sync.mjs --target . --output .aidn/runtime/index/workflow-index.json");
  console.log("  node tools/perf/index-sync.mjs --target . --store dual --output .aidn/runtime/index/workflow-index.json --sql-output .aidn/runtime/index/workflow-index.sql");
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function toIsoFromStat(stats) {
  return new Date(stats.mtimeMs).toISOString();
}

function normalizeKey(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseStatusMetadata(content) {
  const wanted = new Set([
    "state",
    "outcome",
    "branch_name",
    "session_owner",
    "dor_state",
    "continuity_rule",
    "continuity_base_branch",
    "continuity_latest_cycle_branch",
    "continuity_decision_by",
    "last_updated",
  ]);
  const result = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = normalizeKey(match[1]);
    if (!wanted.has(key)) {
      continue;
    }
    result[key] = match[2].trim();
  }
  return result;
}

function inferArtifactKind(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "baseline/current.md") {
    return "baseline";
  }
  if (normalized === "snapshots/context-snapshot.md") {
    return "snapshot";
  }
  if (normalized === "WORKFLOW.md") {
    return "workflow";
  }
  if (normalized === "SPEC.md") {
    return "spec";
  }
  if (/^sessions\/S\d+.*\.md$/.test(normalized)) {
    return "session";
  }
  if (/^cycles\/C\d+.*\/status\.md$/.test(normalized)) {
    return "cycle_status";
  }
  return "other";
}

function extractCycleId(cycleDirName) {
  const match = cycleDirName.match(/(C\d+)/);
  return match ? match[1] : cycleDirName;
}

function extractCycleType(cycleDirName) {
  const cycleId = extractCycleId(cycleDirName);
  if (!cycleDirName.startsWith(`${cycleId}-`)) {
    return null;
  }
  const rest = cycleDirName.slice(cycleId.length + 1);
  const type = rest.split("-")[0];
  return type || null;
}

function buildCycleTables(auditRoot) {
  const cyclesDir = path.join(auditRoot, "cycles");
  if (!fs.existsSync(cyclesDir)) {
    return { cycles: [], fileMap: [], cycleTagPairs: [] };
  }

  const cycles = [];
  const fileMap = [];
  const cycleTagPairs = [];
  const cycleDirs = fs.readdirSync(cyclesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const cycleDirName of cycleDirs) {
    const cyclePath = path.join(cyclesDir, cycleDirName);
    const cycleId = extractCycleId(cycleDirName);
    const cycleType = extractCycleType(cycleDirName);
    const statusPath = path.join(cyclePath, "status.md");
    const statusExists = fs.existsSync(statusPath);
    const statusContent = statusExists ? fs.readFileSync(statusPath, "utf8") : "";
    const metadata = statusExists ? parseStatusMetadata(statusContent) : {};
    const statusStats = statusExists ? fs.statSync(statusPath) : null;

    const cycleRow = {
      cycle_id: cycleId,
      cycle_dir: cycleDirName,
      cycle_type: cycleType,
      session_id: metadata.session_owner ?? null,
      state: metadata.state ?? "UNKNOWN",
      outcome: metadata.outcome ?? null,
      branch_name: metadata.branch_name ?? null,
      dor_state: metadata.dor_state ?? null,
      continuity_rule: metadata.continuity_rule ?? null,
      continuity_base_branch: metadata.continuity_base_branch ?? null,
      continuity_latest_cycle_branch: metadata.continuity_latest_cycle_branch ?? null,
      continuity_decision_by: metadata.continuity_decision_by ?? null,
      updated_at: metadata.last_updated ?? (statusStats ? toIsoFromStat(statusStats) : null),
    };
    cycles.push(cycleRow);

    const files = walkFiles(cyclePath);
    for (const absolutePath of files) {
      const relativeToAudit = path.relative(auditRoot, absolutePath).replace(/\\/g, "/");
      const role = path.basename(absolutePath, path.extname(absolutePath));
      fileMap.push({
        cycle_id: cycleId,
        path: relativeToAudit,
        role,
        last_seen_at: toIsoFromStat(fs.statSync(absolutePath)),
      });
    }

    if (cycleRow.state && cycleRow.state !== "UNKNOWN") {
      cycleTagPairs.push({ cycle_id: cycleId, tag: `state:${cycleRow.state}` });
    }
    if (cycleRow.outcome) {
      cycleTagPairs.push({ cycle_id: cycleId, tag: `outcome:${cycleRow.outcome}` });
    }
    if (cycleRow.continuity_rule) {
      cycleTagPairs.push({ cycle_id: cycleId, tag: `continuity:${cycleRow.continuity_rule}` });
    }
    if (cycleType) {
      cycleTagPairs.push({ cycle_id: cycleId, tag: `type:${cycleType}` });
    }
  }

  return { cycles, fileMap, cycleTagPairs };
}

function buildArtifactRows(auditRoot) {
  const files = walkFiles(auditRoot);
  const artifacts = [];
  for (const absolutePath of files) {
    const stats = fs.statSync(absolutePath);
    const relativePath = path.relative(auditRoot, absolutePath).replace(/\\/g, "/");
    artifacts.push({
      path: relativePath,
      kind: inferArtifactKind(relativePath),
      sha256: sha256File(absolutePath),
      size_bytes: stats.size,
      mtime_ns: Math.round(stats.mtimeMs * 1_000_000),
      updated_at: toIsoFromStat(stats),
    });
  }
  return artifacts;
}

function buildTags(cycleTagPairs, artifacts) {
  const tagSet = new Set();
  const artifactTagPairs = [];

  for (const pair of cycleTagPairs) {
    tagSet.add(pair.tag);
  }
  for (const artifact of artifacts) {
    const tag = `kind:${artifact.kind}`;
    tagSet.add(tag);
    artifactTagPairs.push({
      path: artifact.path,
      tag,
    });
  }

  const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b)).map((tag) => ({ tag }));
  return { tags, artifactTagPairs };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const auditRoot = path.join(targetRoot, "docs", "audit");

    if (!fs.existsSync(auditRoot)) {
      throw new Error(`Missing audit root: ${auditRoot}`);
    }

    const artifacts = buildArtifactRows(auditRoot);
    const { cycles, fileMap, cycleTagPairs } = buildCycleTables(auditRoot);
    const { tags, artifactTagPairs } = buildTags(cycleTagPairs, artifacts);

    const payload = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      target_root: targetRoot,
      audit_root: auditRoot,
      cycles,
      artifacts,
      file_map: fileMap,
      tags,
      artifact_tags: artifactTagPairs,
      summary: {
        cycles_count: cycles.length,
        artifacts_count: artifacts.length,
        file_map_count: fileMap.length,
        tags_count: tags.length,
      },
    };

    const store = createIndexStore({
      mode: args.store,
      jsonOutput: args.output,
      sqlOutput: args.sqlOutput,
      schemaFile: args.schemaFile,
      includeSchema: args.includeSchema,
    });
    const outputs = store.write(payload);
    console.log(`Index synced.`);
    console.log(`Target: ${targetRoot}`);
    for (const out of outputs) {
      console.log(`Output (${out.kind}): ${out.path}`);
    }
    console.log(
      `Summary: cycles=${payload.summary.cycles_count}, artifacts=${payload.summary.artifacts_count}, file_map=${payload.summary.file_map_count}, tags=${payload.summary.tags_count}`,
    );
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
