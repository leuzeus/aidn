#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, args, repoRoot, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed (${path.basename(script)}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function main() {
  let tempRoot = "";
  try {
    const repoRoot = process.cwd();
    const sourceTarget = path.resolve(repoRoot, "tests/fixtures/perf-handoff/ready");
    const script = path.resolve(repoRoot, "tools/runtime/db-only-readiness.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-db-only-readiness-"));
    const target = path.join(tempRoot, "ready-fileless");
    fs.cpSync(sourceTarget, target, { recursive: true });

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    runJson(path.resolve(repoRoot, "tools/perf/index-sync.mjs"), [
      "--target", target,
      "--store", "sqlite",
      "--with-content",
      "--json",
    ], repoRoot, env);

    for (const rel of [
      "docs/audit/CURRENT-STATE.md",
      "docs/audit/RUNTIME-STATE.md",
      "docs/audit/HANDOFF-PACKET.md",
      "docs/audit/sessions/S101-alpha.md",
      "docs/audit/cycles/C101-feature-alpha/status.md",
    ]) {
      fs.rmSync(path.join(target, rel), { force: true });
    }

    const report = runJson(script, ["--target", target, "--json"], repoRoot, env);
    assert(report.summary.status === "pass", "db-only readiness should pass once operational checks and source scan are fully DB-first");
    assert(report.operational.status === "pass", "db-only readiness operational checks should pass in fileless SQLite mode");
    assert(report.operational.effective_state_mode === "db-only", "db-only readiness should resolve effective state mode from env");
    assert(report.operational.sqlite_index.exists === true, "db-only readiness should detect SQLite index");
    assert(report.operational.sqlite_index.content_artifacts_count > 0, "db-only readiness should require embedded SQLite content");
    assert(report.operational.resolutions.current_state.source === "sqlite", "db-only readiness should resolve CURRENT-STATE from SQLite");
    assert(report.operational.resolutions.runtime_state.source === "sqlite", "db-only readiness should resolve RUNTIME-STATE from SQLite");
    assert(report.operational.resolutions.handoff_packet.source === "sqlite", "db-only readiness should resolve HANDOFF-PACKET from SQLite");
    assert(report.operational.resolutions.session_artifact.source === "sqlite", "db-only readiness should resolve active session from SQLite");
    assert(report.operational.resolutions.cycle_status.source === "sqlite", "db-only readiness should resolve active cycle status from SQLite");
    assert(report.source_scan.likely_file_bound_count === 0, "db-only readiness should clear likely file-bound entrypoints once DB-first fallbacks are wired");
    assert(report.source_scan.manual_review_count === 0, "db-only readiness should clear manual-review candidates once rollout is complete");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
