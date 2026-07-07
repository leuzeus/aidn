#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

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

function digestFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
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
      "--store",
      "sqlite",
      "--json",
    ], REPO_ROOT);
    const triageFile = path.join(repoRoot, ".aidn/runtime/index/repair-layer-triage.json");
    const triageSummaryFile = path.join(repoRoot, ".aidn/runtime/index/repair-layer-triage-summary.md");
    const triageDigestBeforeFastPath = digestFile(triageFile);
    const triageSummaryDigestBeforeFastPath = digestFile(triageSummaryFile);

    const selectiveNoChange = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_SELECTIVE),
      "--target",
      repoRoot,
      "--state-mode",
      "dual",
      "--json",
    ], REPO_ROOT);
    const triageDigestAfterFastPath = digestFile(triageFile);
    const triageSummaryDigestAfterFastPath = digestFile(triageSummaryFile);

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

    const warningRepoRoot = path.join(tempRoot, "warning-repo");
    fs.mkdirSync(warningRepoRoot, { recursive: true });
    run("git", ["init"], warningRepoRoot);
    run("git", ["config", "user.email", "aidn@example.com"], warningRepoRoot);
    run("git", ["config", "user.name", "aidn-ci"], warningRepoRoot);
    const warningAuditRoot = path.join(warningRepoRoot, "docs", "audit");
    const warningSnapshot = path.join(warningAuditRoot, "snapshots", "context-snapshot.md");
    writeFile(warningSnapshot, [
      "# Snapshot",
      "",
      "- active_session: S201",
      "- active_cycles: C902",
      "- referenced_cycles: C902",
      "",
    ].join("\n"));
    run("git", ["add", "."], warningRepoRoot);
    run("git", ["commit", "-m", "warning snapshot"], warningRepoRoot);
    const warningFullInit = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_FULL),
      "--target",
      warningRepoRoot,
      "--state-mode",
      "dual",
      "--store",
      "sqlite",
      "--json",
    ], REPO_ROOT);
    const warningStatus = path.join(warningAuditRoot, "cycles", "C902-tracked-late", "status.md");
    writeFile(warningStatus, [
      "# C902 Status",
      "",
      "state: IN_PROGRESS",
      "outcome: pending",
      "branch_name: feature/test-warning",
      "session_owner: S201",
      "",
    ].join("\n"));
    run("git", ["add", "."], warningRepoRoot);
    run("git", ["commit", "-m", "tracked late cycle"], warningRepoRoot);
    const warningNoChange = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_SELECTIVE),
      "--target",
      warningRepoRoot,
      "--state-mode",
      "dual",
      "--json",
    ], REPO_ROOT);

    const postgresRepoRoot = path.join(tempRoot, "postgres-canonical-repo");
    fs.mkdirSync(postgresRepoRoot, { recursive: true });
    run("git", ["init"], postgresRepoRoot);
    run("git", ["config", "user.email", "aidn@example.com"], postgresRepoRoot);
    run("git", ["config", "user.name", "aidn-ci"], postgresRepoRoot);
    writeFile(path.join(postgresRepoRoot, ".aidn", "config.json"), `${JSON.stringify({
      runtime: {
        stateMode: "db-only",
        dbOnly: {
          strict: true,
        },
        persistence: {
          backend: "postgres",
          localProjectionPolicy: "none",
          connectionRef: "env:AIDN_PG_URL",
        },
      },
    }, null, 2)}\n`);
    writeFile(path.join(postgresRepoRoot, "docs", "audit", "snapshots", "context-snapshot.md"), [
      "# Snapshot",
      "",
      "- active_session: S301",
      "- active_cycles: C301",
      "",
    ].join("\n"));
    run("git", ["add", "."], postgresRepoRoot);
    run("git", ["commit", "-m", "postgres canonical fixture"], postgresRepoRoot);
    const postgresCanonicalNoChange = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_SELECTIVE),
      "--target",
      postgresRepoRoot,
      "--json",
    ], REPO_ROOT);
    const postgresCanonicalChangedFile = path.join(postgresRepoRoot, "docs", "audit", "reports", "R301.md");
    writeFile(postgresCanonicalChangedFile, "# Report\n\npostgres canonical changed path\n");
    const postgresCanonicalChanged = runJson(process.execPath, [
      normalizePathForNode(RUNTIME_SYNC_SELECTIVE),
      "--target",
      postgresRepoRoot,
      "--json",
    ], REPO_ROOT);

    const checks = {
      full_init_ok: fullInit.ok === true,
      full_init_repair_layer_completed: ["applied", "skipped"].includes(String(fullInit?.repair_layer_result?.action ?? "")),
      full_init_repair_layer_findings_field: Number(fullInit?.repair_layer_result?.summary?.migration_findings_count ?? -1) >= 0,
      full_init_exposes_diagnostic: fullInit?.sync_db_first_diagnostic?.scope === "runtime-db-first-sync"
        && typeof fullInit?.sync_db_first_diagnostic?.output_count === "number",
      full_init_triage_written: fs.existsSync(triageFile),
      full_init_triage_summary_written: fs.existsSync(triageSummaryFile),
      selective_no_change_ok: selectiveNoChange.ok === true,
      selective_no_change_fast_path_used: selectiveNoChange?.fast_path?.used === true,
      selective_no_change_fast_path_reason: selectiveNoChange?.fast_path?.reason === "unchanged_clean_runtime_index",
      selective_no_change_skips_repair: selectiveNoChange?.repair_layer_result?.skip_reason === "fast_path_unchanged_clean_runtime_index",
      selective_no_change_triage_unchanged: triageDigestBeforeFastPath === triageDigestAfterFastPath
        && triageSummaryDigestBeforeFastPath === triageSummaryDigestAfterFastPath,
      selective_update_ok: selectiveUpdate.ok === true,
      selective_update_synced: Number(selectiveUpdate?.summary?.synced_count ?? 0) >= 1,
      selective_update_no_fallback: selectiveUpdate.fallback_full_used === false,
      selective_update_fast_path_disabled: selectiveUpdate?.fast_path?.used === false
        && selectiveUpdate?.fast_path?.reason === "changed_workflow_artifacts",
      selective_update_exposes_diagnostic: selectiveUpdate?.sync_db_first_selective_diagnostic?.scope === "runtime-db-first-sync-selective"
        && selectiveUpdate?.sync_db_first_selective_diagnostic?.fallback_full_used === false,
      selective_update_repair_layer_completed: ["applied", "skipped"].includes(String(selectiveUpdate?.repair_layer_result?.action ?? "")),
      selective_update_triage_written: fs.existsSync(triageFile),
      selective_delete_triggers_fallback: selectiveDelete.fallback_full_used === true,
      selective_delete_fallback_reason: selectiveDelete.fallback_full_reason === "git_status_requires_full",
      selective_delete_exposes_diagnostic: selectiveDelete?.sync_db_first_selective_diagnostic?.fallback_full_used === true
        && selectiveDelete?.sync_db_first_selective_diagnostic?.fallback_full_reason === "git_status_requires_full",
      selective_rename_triggers_fallback: selectiveRename.fallback_full_used === true,
      selective_rename_fallback_reason: selectiveRename.fallback_full_reason === "git_status_requires_full",
      warning_full_init_has_repair_finding: Number(warningFullInit?.repair_layer_result?.summary?.migration_findings_count ?? 0) > 0,
      warning_no_change_fast_path_disabled: warningNoChange?.fast_path?.used === false
        && warningNoChange?.fast_path?.reason === "repair_findings_open",
      warning_no_change_refreshes_index: warningNoChange.fallback_full_used === true
        && warningNoChange.fallback_full_reason === "repair_layer_tracked_not_indexed",
      warning_no_change_final_repair_clean: Number(warningNoChange?.repair_layer_result?.summary?.migration_findings_count ?? -1) === 0,
      postgres_canonical_no_change_skips_sqlite: postgresCanonicalNoChange?.skipped === true
        && postgresCanonicalNoChange?.reason === "postgres_canonical_backend"
        && postgresCanonicalNoChange?.fast_path?.reason === "postgres_canonical_backend",
      postgres_canonical_no_fallback: postgresCanonicalNoChange?.fallback_full_used === false,
      postgres_canonical_no_repair_layer_sqlite: postgresCanonicalNoChange?.repair_layer_result?.skip_reason === "postgres_canonical_backend",
      postgres_canonical_changed_skips_sqlite_sync: postgresCanonicalChanged?.skipped === true
        && postgresCanonicalChanged?.summary?.synced_count === 0
        && postgresCanonicalChanged?.summary?.changed_paths_count === 1,
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
          fast_path: selectiveUpdate?.fast_path ?? null,
          repair_layer_action: selectiveUpdate?.repair_layer_result?.action ?? null,
          diagnostic: selectiveUpdate?.sync_db_first_selective_diagnostic ?? null,
          triage_file: selectiveUpdate?.repair_layer_triage_result?.triage_file ?? null,
        },
        selective_no_change: {
          fast_path: selectiveNoChange?.fast_path ?? null,
          repair_layer_skip_reason: selectiveNoChange?.repair_layer_result?.skip_reason ?? null,
        },
        full_init: {
          repair_layer_action: fullInit?.repair_layer_result?.action ?? null,
          repair_layer_findings: fullInit?.repair_layer_result?.summary?.migration_findings_count ?? null,
          diagnostic: fullInit?.sync_db_first_diagnostic ?? null,
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
        warning_no_change: {
          initial_top_findings: warningFullInit?.repair_layer_result?.summary?.top_findings ?? null,
          fast_path: warningNoChange?.fast_path ?? null,
          fallback_full_used: warningNoChange?.fallback_full_used ?? null,
          fallback_full_reason: warningNoChange?.fallback_full_reason ?? null,
          repair_layer_action: warningNoChange?.repair_layer_result?.action ?? null,
          repair_findings: warningNoChange?.repair_layer_result?.summary?.migration_findings_count ?? null,
        },
        postgres_canonical: {
          no_change: {
            skipped: postgresCanonicalNoChange?.skipped ?? null,
            reason: postgresCanonicalNoChange?.reason ?? null,
            fast_path: postgresCanonicalNoChange?.fast_path ?? null,
            fallback_full_used: postgresCanonicalNoChange?.fallback_full_used ?? null,
            repair_layer_skip_reason: postgresCanonicalNoChange?.repair_layer_result?.skip_reason ?? null,
          },
          changed: {
            skipped: postgresCanonicalChanged?.skipped ?? null,
            reason: postgresCanonicalChanged?.reason ?? null,
            changed_paths_count: postgresCanonicalChanged?.summary?.changed_paths_count ?? null,
            synced_count: postgresCanonicalChanged?.summary?.synced_count ?? null,
          },
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
      removePathWithRetry(tempRoot);
    }
  }
}

main();
