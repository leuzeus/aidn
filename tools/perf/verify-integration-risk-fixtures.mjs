#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

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
    const fixturesRoot = path.resolve(repoRoot, "tests/fixtures/perf-integration-risk");
    const script = path.resolve(repoRoot, "tools/runtime/project-integration-risk.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-integration-risk-"));
    const directTarget = path.join(tempRoot, "direct-merge");
    const integrationTarget = path.join(tempRoot, "integration-cycle");
    const reworkTarget = path.join(tempRoot, "rework-from-example");
    const reportTarget = path.join(tempRoot, "report-forward");
    const filelessTarget = path.join(tempRoot, "integration-cycle-fileless");

    fs.cpSync(path.join(fixturesRoot, "direct-merge"), directTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "integration-cycle"), integrationTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "rework-from-example"), reworkTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "report-forward"), reportTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "integration-cycle"), filelessTarget, { recursive: true });

    const direct = runJson(script, ["--target", directTarget, "--json"], repoRoot);
    const integration = runJson(script, ["--target", integrationTarget, "--json"], repoRoot);
    const rework = runJson(script, ["--target", reworkTarget, "--json"], repoRoot);
    const report = runJson(script, ["--target", reportTarget, "--json"], repoRoot);
    runJson(path.resolve(repoRoot, "tools", "perf", "index-sync.mjs"), [
      "--target", filelessTarget,
      "--store", "sqlite",
      "--with-content",
      "--json",
    ], repoRoot, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    for (const rel of [
      "docs/audit/CURRENT-STATE.md",
      "docs/audit/sessions/S311.md",
      "docs/audit/cycles/C311-feature-auth/status.md",
      "docs/audit/cycles/C311-feature-auth/plan.md",
      "docs/audit/cycles/C312-refactor-auth-core/status.md",
      "docs/audit/cycles/C312-refactor-auth-core/plan.md",
    ]) {
      fs.rmSync(path.join(filelessTarget, rel), { force: true });
    }
    const fileless = runJson(script, ["--target", filelessTarget, "--json"], repoRoot, {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    assert(direct.recommended_strategy === "direct_merge", "direct fixture should recommend direct_merge");
    assert(direct.mergeability === "merge_safe", "direct fixture should be merge_safe");
    assert(direct.overlap.overall_overlap === "none", "direct fixture should have no overlap");
    assert(direct.semantic.semantic_risk === "low", "direct fixture should have low semantic risk");

    assert(integration.recommended_strategy === "integration_cycle", "feature+refactor fixture should recommend integration_cycle");
    assert(integration.mergeability === "merge_risky", "feature+refactor fixture should be merge_risky");
    assert(integration.overlap.overall_overlap === "medium", "feature+refactor fixture should detect medium overlap");
    assert(fileless.recommended_strategy === "integration_cycle", "db-only fileless fixture should preserve integration_cycle strategy");
    assert(fileless.mergeability === "merge_risky", "db-only fileless fixture should preserve mergeability");
    assert(fileless.overlap.overall_overlap === "medium", "db-only fileless fixture should preserve overlap classification");
    assert(fileless.current_state_source === "sqlite", "db-only fileless fixture should load current state from SQLite");
    assert(fileless.session_source === "sqlite", "db-only fileless fixture should load session topology from SQLite");
    assert(fileless.candidate_cycles.every((cycle) => String(cycle.status_path).startsWith("docs/audit/cycles/")), "db-only fileless fixture should recover cycle status paths logically");

    assert(rework.recommended_strategy === "rework_from_example", "spike fixture should recommend rework_from_example");
    assert(rework.mergeability === "merge_not_recommended", "spike fixture should reject mechanical merge");
    assert(rework.semantic.semantic_risk === "high", "spike fixture should have high semantic risk");

    assert(report.recommended_strategy === "report_forward", "blocked fixture should recommend report_forward");
    assert(report.mergeability === "merge_not_recommended", "blocked fixture should reject direct merge");
    assert(report.readiness === "blocked", "blocked fixture should report blocked readiness");
    assert(report.candidate_cycles.some((cycle) => cycle.readiness === "blocked"), "blocked fixture should expose blocked cycle detail");

    const directText = fs.readFileSync(direct.output_file, "utf8");
    assert(directText.includes("# Integration Risk"), "integration risk digest should include title");
    assert(directText.includes("recommended_strategy: direct_merge"), "digest should expose direct_merge strategy");
    assert(directText.includes("mergeability: merge_safe"), "digest should expose mergeability");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
