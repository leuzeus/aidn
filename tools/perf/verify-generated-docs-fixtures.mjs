#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function run(repoRoot, argv) {
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "tools", "install.mjs"),
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

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function main() {
  let tmpRoot = "";
  try {
    const repoRoot = process.cwd();
    const fixtureRoot = path.resolve(repoRoot, "tests", "fixtures", "repo-installed-core");
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-generated-docs-"));
    const targetRoot = path.join(tmpRoot, "repo");
    fs.cpSync(fixtureRoot, targetRoot, { recursive: true });

    const workflowPath = path.join(targetRoot, "docs", "audit", "WORKFLOW.md");
    const summaryPath = path.join(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md");
    const codexOnlinePath = path.join(targetRoot, "docs", "audit", "CODEX_ONLINE.md");
    const indexPath = path.join(targetRoot, "docs", "audit", "index.md");
    const baselineCurrentPath = path.join(targetRoot, "docs", "audit", "baseline", "current.md");
    const baselineHistoryPath = path.join(targetRoot, "docs", "audit", "baseline", "history.md");
    const parkingLotPath = path.join(targetRoot, "docs", "audit", "parking-lot.md");
    const snapshotPath = path.join(targetRoot, "docs", "audit", "snapshots", "context-snapshot.md");

    fs.writeFileSync(workflowPath, `${read(workflowPath).trimEnd()}\n\n## Local Fast Path Override\n\n- preserved local extension\n`, "utf8");
    fs.writeFileSync(summaryPath, "# stale summary\n", "utf8");
    fs.writeFileSync(codexOnlinePath, "# stale codex online\n", "utf8");
    fs.writeFileSync(indexPath, "# stale index\n", "utf8");
    fs.writeFileSync(baselineCurrentPath, `${read(baselineCurrentPath).trimEnd()}\n\n<!-- keep:baseline-current -->\n`, "utf8");
    fs.writeFileSync(baselineHistoryPath, `${read(baselineHistoryPath).trimEnd()}\n\n<!-- keep:baseline-history -->\n`, "utf8");
    fs.writeFileSync(parkingLotPath, `${read(parkingLotPath).trimEnd()}\n\n<!-- keep:parking-lot -->\n`, "utf8");
    fs.writeFileSync(snapshotPath, `${read(snapshotPath).trimEnd()}\n\n<!-- keep:snapshot -->\n`, "utf8");

    const beforeHashes = {
      baselineCurrent: sha256(baselineCurrentPath),
      baselineHistory: sha256(baselineHistoryPath),
      parkingLot: sha256(parkingLotPath),
      snapshot: sha256(snapshotPath),
    };

    const installArgs = [
      "--target",
      targetRoot,
      "--pack",
      "core",
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
      "--force-agents-merge",
    ];

    const first = run(repoRoot, installArgs);

    const afterFirst = {
      workflow: read(workflowPath),
      summary: read(summaryPath),
      codexOnline: read(codexOnlinePath),
      index: read(indexPath),
      baselineCurrentHash: sha256(baselineCurrentPath),
      baselineHistoryHash: sha256(baselineHistoryPath),
      parkingLotHash: sha256(parkingLotPath),
      snapshotHash: sha256(snapshotPath),
    };

    const generatedHashesAfterFirst = {
      workflow: sha256(workflowPath),
      summary: sha256(summaryPath),
      codexOnline: sha256(codexOnlinePath),
      index: sha256(indexPath),
    };

    const second = run(repoRoot, installArgs);

    const generatedHashesAfterSecond = {
      workflow: sha256(workflowPath),
      summary: sha256(summaryPath),
      codexOnline: sha256(codexOnlinePath),
      index: sha256(indexPath),
    };

    const checks = {
      first_install_ok: first.status === 0,
      second_install_ok: second.status === 0,
      workflow_rendered_project_name: afterFirst.workflow.includes("project_name: repo-installed-core"),
      workflow_rendered_source_branch: afterFirst.workflow.includes("source_branch: dev"),
      workflow_rendered_runtime_policy: afterFirst.workflow.includes("- Preferred runtime state mode: `dual`."),
      workflow_rendered_index_store: afterFirst.workflow.includes("- Default install/runtime index store: `dual-sqlite`."),
      workflow_imported_extension_preserved: afterFirst.workflow.includes("## Imported Local Extensions")
        && afterFirst.workflow.includes("## Local Fast Path Override"),
      workflow_no_placeholders: !/\{\{[A-Z0-9_]+\}\}/.test(afterFirst.workflow),
      summary_rendered_config: afterFirst.summary.includes("- Configured source branch: `dev`")
        && afterFirst.summary.includes("- Preferred runtime state mode: `dual`")
        && afterFirst.summary.includes("- Default index store: `dual-sqlite`"),
      codex_online_rendered_config: afterFirst.codexOnline.includes("- source branch: `dev`")
        && afterFirst.codexOnline.includes("- preferred runtime state mode: `dual`")
        && afterFirst.codexOnline.includes("- default index store: `dual-sqlite`"),
      index_rendered_config: afterFirst.index.includes("- Project: `repo-installed-core`")
        && afterFirst.index.includes("- Source branch: `dev`"),
      baseline_current_preserved: beforeHashes.baselineCurrent === afterFirst.baselineCurrentHash,
      baseline_history_preserved: beforeHashes.baselineHistory === afterFirst.baselineHistoryHash,
      parking_lot_preserved: beforeHashes.parkingLot === afterFirst.parkingLotHash,
      snapshot_preserved: beforeHashes.snapshot === afterFirst.snapshotHash,
      second_install_stable_workflow: generatedHashesAfterFirst.workflow === generatedHashesAfterSecond.workflow,
      second_install_stable_summary: generatedHashesAfterFirst.summary === generatedHashesAfterSecond.summary,
      second_install_stable_codex_online: generatedHashesAfterFirst.codexOnline === generatedHashesAfterSecond.codexOnline,
      second_install_stable_index: generatedHashesAfterFirst.index === generatedHashesAfterSecond.index,
      generated_render_logged: first.stdout.includes("render generated doc: docs/audit/WORKFLOW.md")
        && first.stdout.includes("render generated doc: docs/audit/index.md"),
      workflow_not_preserved_custom: !first.stdout.includes("- docs/audit/WORKFLOW.md"),
      index_not_preserved_custom: !first.stdout.includes("- docs/audit/index.md"),
    };

    const pass = Object.values(checks).every((value) => value === true);
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        first_stdout_head: first.stdout.trim().split(/\r?\n/).slice(0, 20),
        first_stderr_tail: first.stderr.trim().split(/\r?\n/).slice(-20),
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
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      const cleanup = removePathWithRetry(tmpRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
