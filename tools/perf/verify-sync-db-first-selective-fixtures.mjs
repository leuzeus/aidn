#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TOOL_FILE), "..", "..");
const RUNTIME_SYNC_SELECTIVE = path.resolve(REPO_ROOT, "tools", "runtime", "sync-db-first-selective.mjs");
const RUNTIME_SYNC_FULL = path.resolve(REPO_ROOT, "tools", "runtime", "sync-db-first.mjs");

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runJson(command, args, cwd) {
  const text = run(command, args, cwd).trim();
  if (!text) {
    throw new Error("Empty JSON output");
  }
  return JSON.parse(text);
}

function parseArgs(argv) {
  const args = {
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-sync-db-first-selective-fixtures.mjs --json");
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function normalizePathForNode(absolutePath) {
  return process.platform === "win32" && absolutePath.startsWith("/") && absolutePath[2] === ":"
    ? absolutePath.slice(1)
    : absolutePath;
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-sync-selective-"));
    const repoRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(repoRoot, { recursive: true });

    run("git", ["init"], repoRoot);
    run("git", ["config", "user.email", "aidn@example.com"], repoRoot);
    run("git", ["config", "user.name", "aidn-ci"], repoRoot);

    const auditRoot = path.join(repoRoot, "docs", "audit");
    const fileA = path.join(auditRoot, "snapshots", "context-snapshot.md");
    const fileB = path.join(auditRoot, "reports", "R001.md");
    writeFile(fileA, "# Snapshot\n\nv1\n");
    writeFile(fileB, "# Report\n\nv1\n");
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "init"], repoRoot);

    const fullInit = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_FULL),
      "--target",
      repoRoot,
      "--state-mode",
      "dual",
      "--json",
    ], REPO_ROOT);
    const triageFile = path.join(repoRoot, ".aidn/runtime/index/repair-layer-triage.json");
    const triageSummaryFile = path.join(repoRoot, ".aidn/runtime/index/repair-layer-triage-summary.md");

    writeFile(fileA, "# Snapshot\n\nv2\n");
    const selectiveUpdate = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_SELECTIVE),
      "--target",
      repoRoot,
      "--state-mode",
      "dual",
      "--json",
    ], REPO_ROOT);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "update snapshot"], repoRoot);

    fs.rmSync(fileA);
    const selectiveDelete = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_SELECTIVE),
      "--target",
      repoRoot,
      "--state-mode",
      "dual",
      "--json",
    ], REPO_ROOT);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "delete snapshot"], repoRoot);

    const fileBRenamed = path.join(auditRoot, "reports", "R002.md");
    run("git", ["mv", path.relative(repoRoot, fileB), path.relative(repoRoot, fileBRenamed)], repoRoot);
    const selectiveRename = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_SELECTIVE),
      "--target",
      repoRoot,
      "--state-mode",
      "dual",
      "--json",
    ], REPO_ROOT);

    const checks = {
      full_init_ok: fullInit.ok === true,
      full_init_repair_layer_completed: ["applied", "skipped"].includes(String(fullInit?.repair_layer_result?.action ?? "")),
      full_init_repair_layer_findings_field: Number(fullInit?.repair_layer_result?.summary?.migration_findings_count ?? -1) >= 0,
      full_init_triage_written: fs.existsSync(triageFile),
      full_init_triage_summary_written: fs.existsSync(triageSummaryFile),
      selective_update_ok: selectiveUpdate.ok === true,
      selective_update_synced: Number(selectiveUpdate?.summary?.synced_count ?? 0) >= 1,
      selective_update_no_fallback: selectiveUpdate.fallback_full_used === false,
      selective_update_repair_layer_completed: ["applied", "skipped"].includes(String(selectiveUpdate?.repair_layer_result?.action ?? "")),
      selective_update_triage_written: fs.existsSync(triageFile),
      selective_delete_triggers_fallback: selectiveDelete.fallback_full_used === true,
      selective_delete_fallback_reason: selectiveDelete.fallback_full_reason === "git_status_requires_full",
      selective_rename_triggers_fallback: selectiveRename.fallback_full_used === true,
      selective_rename_fallback_reason: selectiveRename.fallback_full_reason === "git_status_requires_full",
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      temp_root: repoRoot,
      checks,
      pass,
      samples: {
        selective_update: {
          synced_count: selectiveUpdate?.summary?.synced_count ?? 0,
          fallback_full_used: selectiveUpdate?.fallback_full_used ?? null,
          repair_layer_action: selectiveUpdate?.repair_layer_result?.action ?? null,
          triage_file: selectiveUpdate?.repair_layer_triage_result?.triage_file ?? null,
        },
        full_init: {
          repair_layer_action: fullInit?.repair_layer_result?.action ?? null,
          repair_layer_findings: fullInit?.repair_layer_result?.summary?.migration_findings_count ?? null,
          triage_file: fullInit?.repair_layer_triage_result?.triage_file ?? null,
          triage_summary_file: fullInit?.repair_layer_triage_result?.summary_file ?? null,
        },
        selective_delete: {
          fallback_full_used: selectiveDelete?.fallback_full_used ?? null,
          fallback_full_reason: selectiveDelete?.fallback_full_reason ?? null,
        },
        selective_rename: {
          fallback_full_used: selectiveRename?.fallback_full_used ?? null,
          fallback_full_reason: selectiveRename?.fallback_full_reason ?? null,
        },
      },
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`verify-sync-db-first-selective: ${pass ? "PASS" : "FAIL"}`);
    }
    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
