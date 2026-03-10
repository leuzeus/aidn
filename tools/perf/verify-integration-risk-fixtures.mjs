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

function runJson(script, args, repoRoot) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
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

    fs.cpSync(path.join(fixturesRoot, "direct-merge"), directTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "integration-cycle"), integrationTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "rework-from-example"), reworkTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "report-forward"), reportTarget, { recursive: true });

    const direct = runJson(script, ["--target", directTarget, "--json"], repoRoot);
    const integration = runJson(script, ["--target", integrationTarget, "--json"], repoRoot);
    const rework = runJson(script, ["--target", reworkTarget, "--json"], repoRoot);
    const report = runJson(script, ["--target", reportTarget, "--json"], repoRoot);

    assert(direct.recommended_strategy === "direct_merge", "direct fixture should recommend direct_merge");
    assert(direct.mergeability === "merge_safe", "direct fixture should be merge_safe");
    assert(direct.overlap.overall_overlap === "none", "direct fixture should have no overlap");
    assert(direct.semantic.semantic_risk === "low", "direct fixture should have low semantic risk");

    assert(integration.recommended_strategy === "integration_cycle", "feature+refactor fixture should recommend integration_cycle");
    assert(integration.mergeability === "merge_risky", "feature+refactor fixture should be merge_risky");
    assert(integration.overlap.overall_overlap === "medium", "feature+refactor fixture should detect medium overlap");

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
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
