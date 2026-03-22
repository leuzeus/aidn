#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessDbOnlyReadiness } from "../../src/application/runtime/db-only-readiness-service.mjs";

const AUDIT_MARKERS = [
  "docs/audit/",
  "CURRENT-STATE.md",
  "RUNTIME-STATE.md",
  "HANDOFF-PACKET.md",
  "active_session",
  "active_cycle",
  "backlog/",
  "sessions/",
  "cycles/",
];

const DB_FIRST_MARKERS = [
  "db-first-runtime-view-lib.mjs",
  "db-first-artifact-lib.mjs",
  "resolveAuditArtifactText",
  "resolveSessionArtifact",
  "resolveCycleStatusArtifact",
  "loadSqliteIndexPayloadSafe",
  "readIndexFromSqlite",
];

const FILESYSTEM_MARKERS = [
  "fs.existsSync(",
  "fs.readFileSync(",
  "fs.statSync(",
  "readTextSafe(",
];

function parseArgs(argv) {
  const args = {
    target: ".",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/db-only-readiness.mjs --target .");
  console.log("  node tools/runtime/db-only-readiness.mjs --target . --json");
}

function walkMjsFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
        out.push(absolute);
      }
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
}

function relative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).replace(/\\/g, "/");
}

function scanFileForDbOnly(packageRoot, absolutePath) {
  const rel = relative(packageRoot, absolutePath);
  if (rel.endsWith("db-first-runtime-view-lib.mjs") || rel.endsWith("db-first-artifact-lib.mjs")) {
    return null;
  }
  const text = fs.readFileSync(absolutePath, "utf8");
  const touchesAuditArtifacts = AUDIT_MARKERS.some((marker) => text.includes(marker));
  if (!touchesAuditArtifacts) {
    return null;
  }
  const hasDbFirstSupport = DB_FIRST_MARKERS.some((marker) => text.includes(marker));
  const hasFileSystemReads = FILESYSTEM_MARKERS.some((marker) => text.includes(marker));

  let status = "manual-review";
  const reasons = [];
  if (hasDbFirstSupport) {
    status = "db-first-aware";
    reasons.push("imports or references DB-first helpers");
  } else if (hasFileSystemReads) {
    status = "likely-file-bound";
    reasons.push("reads audit artifacts through filesystem calls without DB-first helpers");
  } else {
    reasons.push("touches audit/runtime artifacts but DB-first support was not detected");
  }
  return {
    path: rel,
    status,
    reasons,
  };
}

function scanPackageForDbOnlyReadiness() {
  const toolsDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(toolsDir, "../..");
  const scanRoots = [
    path.join(packageRoot, "tools", "runtime"),
    path.join(packageRoot, "tools", "codex"),
    path.join(packageRoot, "src", "application", "runtime"),
    path.join(packageRoot, "src", "application", "codex"),
  ];

  const findings = scanRoots
    .flatMap((scanRoot) => walkMjsFiles(scanRoot))
    .map((absolutePath) => scanFileForDbOnly(packageRoot, absolutePath))
    .filter(Boolean);

  const likelyFileBound = findings.filter((entry) => entry.status === "likely-file-bound");
  const manualReview = findings.filter((entry) => entry.status === "manual-review");
  const dbFirstAware = findings.filter((entry) => entry.status === "db-first-aware");

  return {
    package_root: packageRoot,
    scanned_files_count: findings.length,
    db_first_aware_count: dbFirstAware.length,
    likely_file_bound_count: likelyFileBound.length,
    manual_review_count: manualReview.length,
    likely_file_bound: likelyFileBound,
    manual_review: manualReview,
  };
}

function buildSummary(operational, sourceScan) {
  if (operational.status !== "pass") {
    return {
      status: "fail",
      reason: "operational db-only resolution checks failed",
    };
  }
  if (sourceScan.likely_file_bound_count > 0 || sourceScan.manual_review_count > 0) {
    return {
      status: "warn",
      reason: "operational checks passed, but the package scan still reports potentially file-bound entrypoints",
    };
  }
  return {
    status: "pass",
    reason: "operational checks passed and no remaining file-bound entrypoints were detected",
  };
}

function printHuman(result) {
  console.log(`Status: ${result.summary.status}`);
  console.log(`Reason: ${result.summary.reason}`);
  console.log(`Target: ${result.target_root}`);
  console.log(`Effective state mode: ${result.operational.effective_state_mode}`);
  console.log(`SQLite index: ${result.operational.sqlite_index.exists ? "present" : "missing"}`);
  console.log(`SQLite content artifacts: ${result.operational.sqlite_index.content_artifacts_count}`);
  for (const check of result.operational.checks) {
    console.log(`${check.pass ? "PASS" : "FAIL"} ${check.id} - ${check.details}`);
  }
  console.log(`Likely file-bound entrypoints: ${result.source_scan.likely_file_bound_count}`);
  for (const entry of result.source_scan.likely_file_bound.slice(0, 10)) {
    console.log(`- ${entry.path}: ${entry.reasons.join("; ")}`);
  }
  if (result.source_scan.manual_review_count > 0) {
    console.log(`Manual review candidates: ${result.source_scan.manual_review_count}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const operational = assessDbOnlyReadiness({ targetRoot });
    const sourceScan = scanPackageForDbOnlyReadiness();
    const summary = buildSummary(operational, sourceScan);
    const result = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      summary,
      operational,
      source_scan: sourceScan,
    };

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHuman(result);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
