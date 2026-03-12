#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run(repoRoot, argv) {
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "tools", "project", "config.mjs"),
    ...argv,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function main() {
  let tempRoot = "";
  try {
    const repoRoot = process.cwd();
    const version = readText(path.join(repoRoot, "VERSION")).trim();
    const sourceFixture = path.join(repoRoot, "tests", "fixtures", "repo-installed-core");
    const workflowFixture = path.join(repoRoot, "tests", "fixtures", "project-migration-gowire-like", "WORKFLOW.md");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-migrate-adapter-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(sourceFixture, targetRoot, { recursive: true });

    const workflowPath = path.join(targetRoot, "docs", "audit", "WORKFLOW.md");
    const summaryPath = path.join(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md");
    const codexOnlinePath = path.join(targetRoot, "docs", "audit", "CODEX_ONLINE.md");
    const indexPath = path.join(targetRoot, "docs", "audit", "index.md");
    const baselineCurrentPath = path.join(targetRoot, "docs", "audit", "baseline", "current.md");
    const baselineHistoryPath = path.join(targetRoot, "docs", "audit", "baseline", "history.md");
    const parkingLotPath = path.join(targetRoot, "docs", "audit", "parking-lot.md");
    const snapshotPath = path.join(targetRoot, "docs", "audit", "snapshots", "context-snapshot.md");
    const configPath = path.join(targetRoot, ".aidn", "config.json");

    fs.writeFileSync(workflowPath, readText(workflowFixture), "utf8");
    fs.writeFileSync(summaryPath, "# stale summary\n", "utf8");
    fs.writeFileSync(codexOnlinePath, "# stale codex\n", "utf8");
    fs.writeFileSync(indexPath, "# stale index\n", "utf8");
    fs.writeFileSync(baselineCurrentPath, `${readText(baselineCurrentPath).trimEnd()}\n\n<!-- preserve:baseline-current -->\n`, "utf8");
    fs.writeFileSync(baselineHistoryPath, `${readText(baselineHistoryPath).trimEnd()}\n\n<!-- preserve:baseline-history -->\n`, "utf8");
    fs.writeFileSync(parkingLotPath, `${readText(parkingLotPath).trimEnd()}\n\n<!-- preserve:parking-lot -->\n`, "utf8");
    fs.writeFileSync(snapshotPath, `${readText(snapshotPath).trimEnd()}\n\n<!-- preserve:snapshot -->\n`, "utf8");
    const config = JSON.parse(readText(configPath));
    delete config.workflow;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const beforeHashes = {
      baselineCurrent: sha256(baselineCurrentPath),
      baselineHistory: sha256(baselineHistoryPath),
      parkingLot: sha256(parkingLotPath),
      snapshot: sha256(snapshotPath),
    };

    const first = run(repoRoot, [
      "--target",
      targetRoot,
      "--migrate-adapter",
      "--version",
      version,
      "--json",
    ]);
    const firstPayload = JSON.parse(first.stdout || "{}");
    const adapterPath = path.join(targetRoot, ".aidn", "project", "workflow.adapter.json");
    const reportPath = path.join(targetRoot, ".aidn", "project", "workflow.adapter.migration-report.json");
    const legacyWorkflowSourcePath = path.join(targetRoot, ".aidn", "project", "workflow.adapter.legacy-source.md");
    const afterConfig = JSON.parse(readText(configPath));
    const adapterConfig = JSON.parse(readText(adapterPath));
    const workflowText = readText(workflowPath);
    const summaryText = readText(summaryPath);
    const codexOnlineText = readText(codexOnlinePath);
    const indexText = readText(indexPath);

    const generatedHashesAfterFirst = {
      workflow: sha256(workflowPath),
      summary: sha256(summaryPath),
      codexOnline: sha256(codexOnlinePath),
      index: sha256(indexPath),
    };

    const second = run(repoRoot, [
      "--target",
      targetRoot,
      "--migrate-adapter",
      "--version",
      version,
      "--json",
    ]);

    const generatedHashesAfterSecond = {
      workflow: sha256(workflowPath),
      summary: sha256(summaryPath),
      codexOnline: sha256(codexOnlinePath),
      index: sha256(indexPath),
    };

    const checks = {
      first_ok: first.status === 0 && firstPayload.ok === true,
      second_ok: second.status === 0,
      adapter_written: fs.existsSync(adapterPath),
      report_written: fs.existsSync(reportPath),
      legacy_source_written: fs.existsSync(legacyWorkflowSourcePath)
        && readText(legacyWorkflowSourcePath).includes("### Session Transition Cleanliness Gate (Mandatory)"),
      source_branch_restored_in_config: String(afterConfig.workflow?.sourceBranch ?? "") === "dev",
      adapter_project_name: String(adapterConfig.projectName ?? "") === "gowire",
      adapter_runtime_constraint: String(adapterConfig.constraints?.runtime ?? "").includes("TinyGo-compatible WASM runtime"),
      adapter_architecture_constraint: String(adapterConfig.constraints?.architecture ?? "").includes("SSR-first custom elements"),
      adapter_delivery_constraint: String(adapterConfig.constraints?.delivery ?? "").includes("CI orchestration is managed by Drone"),
      adapter_additional_constraints: Array.isArray(adapterConfig.constraints?.additional)
        && adapterConfig.constraints.additional.some((item) => String(item).includes("Dependency/data constraints"))
        && adapterConfig.constraints.additional.some((item) => String(item).includes("Generated artifact constraints")),
      adapter_dor_policy: String(adapterConfig.dorPolicy ?? "").includes("minimal core gate"),
      adapter_snapshot_policy: String(adapterConfig.snapshotPolicy?.trigger ?? "").includes("At session close")
        && String(adapterConfig.snapshotPolicy?.owner ?? "").includes("Current session agent"),
      adapter_ci_policy: Array.isArray(adapterConfig.ciPolicy?.capacity)
        && adapterConfig.ciPolicy.capacity.some((item) => String(item).includes("Drone capacity is limited")),
      workflow_preserved_noncanonical_sections: workflowText.includes("## Imported Local Extensions")
        && workflowText.includes("### Session Transition Cleanliness Gate (Mandatory)")
        && workflowText.includes("### Mode mapping"),
      workflow_renders_extracted_constraints: workflowText.includes("- Dependency/data constraints: `Imports must follow the minimal-dependency principle")
        && workflowText.includes("Every hotfix touching hydration/dispatch"),
      workflow_renders_ci_capacity: workflowText.includes("Drone capacity is limited: only one PR may consume")
        && workflowText.includes("Dependency/security batches (Dependabot included) must be sequential"),
      workflow_renders_snapshot_policy: workflowText.includes("Snapshot update trigger: `At session close and whenever baseline")
        && workflowText.includes("Snapshot owner: `Current session agent, validated during review.`"),
      summary_regenerated: summaryText.includes("- Configured source branch: `dev`"),
      codex_online_regenerated: codexOnlineText.includes("- source branch: `dev`"),
      index_regenerated: indexText.includes("- Project: `gowire`"),
      baseline_current_preserved: beforeHashes.baselineCurrent === sha256(baselineCurrentPath),
      baseline_history_preserved: beforeHashes.baselineHistory === sha256(baselineHistoryPath),
      parking_lot_preserved: beforeHashes.parkingLot === sha256(parkingLotPath),
      snapshot_preserved: beforeHashes.snapshot === sha256(snapshotPath),
      second_workflow_stable: generatedHashesAfterFirst.workflow === generatedHashesAfterSecond.workflow,
      second_summary_stable: generatedHashesAfterFirst.summary === generatedHashesAfterSecond.summary,
      second_codex_online_stable: generatedHashesAfterFirst.codexOnline === generatedHashesAfterSecond.codexOnline,
      second_index_stable: generatedHashesAfterFirst.index === generatedHashesAfterSecond.index,
    };

    const pass = Object.values(checks).every((value) => value === true);
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        first_stderr: first.stderr.trim(),
        second_stderr: second.stderr.trim(),
        adapter_excerpt: adapterConfig,
      },
      pass,
    }, null, 2));
    if (!pass) {
      process.exit(1);
    }
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
