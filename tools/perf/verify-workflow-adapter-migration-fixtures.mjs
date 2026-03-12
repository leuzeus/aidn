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
    fs.rmSync(path.join(targetRoot, ".aidn", "project", "workflow.adapter.legacy-source.md"), { force: true });
    fs.rmSync(path.join(targetRoot, ".aidn", "project", "workflow.adapter.migration-report.json"), { force: true });

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

    fs.writeFileSync(workflowPath, "# stale workflow\n", "utf8");

    const second = run(repoRoot, [
      "--target",
      targetRoot,
      "--migrate-adapter",
      "--version",
      version,
      "--json",
    ]);
    const secondPayload = JSON.parse(second.stdout || "{}");
    const workflowTextAfterSecond = readText(workflowPath);

    const generatedHashesAfterSecond = {
      workflow: sha256(workflowPath),
      summary: sha256(summaryPath),
      codexOnline: sha256(codexOnlinePath),
      index: sha256(indexPath),
    };

    const third = run(repoRoot, [
      "--target",
      targetRoot,
      "--migrate-adapter",
      "--version",
      version,
      "--json",
    ]);

    const generatedHashesAfterThird = {
      workflow: sha256(workflowPath),
      summary: sha256(summaryPath),
      codexOnline: sha256(codexOnlinePath),
      index: sha256(indexPath),
    };

    const checks = {
      first_ok: first.status === 0 && firstPayload.ok === true,
      second_ok: second.status === 0 && secondPayload.ok === true,
      third_ok: third.status === 0,
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
        && adapterConfig.constraints.additional.some((item) => String(item).includes("Dependency minimization constraints"))
        && adapterConfig.constraints.additional.some((item) => String(item).includes("Shared codegen boundary constraints")),
      adapter_legacy_project_constraints_preserved: Array.isArray(adapterConfig.legacyPreserved?.projectConstraintsBullets)
        && adapterConfig.legacyPreserved.projectConstraintsBullets.some((item) => String(item).includes("Shared codegen boundary constraints"))
        && adapterConfig.legacyPreserved.projectConstraintsBullets.some((item) => String(item).includes("Generated artifact constraints")),
      adapter_promoted_session_transition: adapterConfig.sessionPolicy?.transitionCleanliness?.enabled === true
        && Array.isArray(adapterConfig.sessionPolicy?.transitionCleanliness?.requiredDecisionOptions)
        && adapterConfig.sessionPolicy.transitionCleanliness.requiredDecisionOptions.includes("adopt-to-current-session")
        && adapterConfig.sessionPolicy.transitionCleanliness.requiredDecisionOptions.includes("archive-non-retained")
        && adapterConfig.sessionPolicy.transitionCleanliness.requiredDecisionOptions.includes("drop-with-rationale"),
      adapter_promoted_execution_policy: adapterConfig.executionPolicy?.enabled === true
        && adapterConfig.executionPolicy.evaluationScope === "dispatch-or-local-scope"
        && Array.isArray(adapterConfig.executionPolicy.hardGates)
        && adapterConfig.executionPolicy.hardGates.some((item) => String(item).includes("branch/cycle mapping validity"))
        && Array.isArray(adapterConfig.executionPolicy.lightGates)
        && adapterConfig.executionPolicy.lightGates.some((item) => String(item).includes("breadth of validation commands"))
        && adapterConfig.executionPolicy.fastPath?.enabled === true
        && adapterConfig.executionPolicy.fastPath?.maxTouchedFiles === 2
        && String(adapterConfig.executionPolicy.validationProfiles?.high ?? "").includes("full validation stack"),
      adapter_promoted_shared_codegen_boundary: adapterConfig.specializedGates?.sharedCodegenBoundary?.enabled === true
        && adapterConfig.specializedGates.sharedCodegenBoundary.sharedIntegrationSurface === true
        && Array.isArray(adapterConfig.specializedGates.sharedCodegenBoundary.generatorPaths)
        && adapterConfig.specializedGates.sharedCodegenBoundary.generatorPaths.includes("internal/builder/engines/components.go")
        && adapterConfig.specializedGates.sharedCodegenBoundary.generatorPaths.includes("internal/components/manifest.json")
        && adapterConfig.specializedGates.sharedCodegenBoundary.generatorPaths.includes("web/ce/elements.js")
        && Array.isArray(adapterConfig.specializedGates.sharedCodegenBoundary.requiredEvidence)
        && adapterConfig.specializedGates.sharedCodegenBoundary.requiredEvidence.includes("decisions.md")
        && adapterConfig.specializedGates.sharedCodegenBoundary.requiredEvidence.includes("traceability.md")
        && adapterConfig.specializedGates.sharedCodegenBoundary.forbidComponentSpecificGeneratorFixes === true,
      adapter_legacy_imported_sections_drained: Array.isArray(adapterConfig.legacyPreserved?.importedSections)
        && adapterConfig.legacyPreserved.importedSections.length === 0,
      adapter_legacy_native_core_sections_removed: Array.isArray(adapterConfig.legacyPreserved?.importedSections)
        && !adapterConfig.legacyPreserved.importedSections.some((item) => String(item).includes("### Incident Trigger Conditions"))
        && !adapterConfig.legacyPreserved.importedSections.some((item) => String(item).includes("### Mode mapping"))
        && !adapterConfig.legacyPreserved.importedSections.some((item) => String(item).includes("### Interactive Stop Prompt")),
      adapter_dor_policy: String(adapterConfig.dorPolicy ?? "").includes("Session branch commits are limited to integration/handover/PR orchestration."),
      adapter_snapshot_policy: String(adapterConfig.snapshotPolicy?.trigger ?? "").includes("At session close")
        && String(adapterConfig.snapshotPolicy?.owner ?? "").includes("Current session agent"),
      adapter_ci_policy: Array.isArray(adapterConfig.ciPolicy?.capacity)
        && adapterConfig.ciPolicy.capacity.some((item) => String(item).includes("Drone capacity is limited")),
      workflow_promoted_sections_rendered_natively: !workflowText.includes("## Imported Local Extensions")
        && workflowText.includes("### Session Transition Cleanliness Gate (Mandatory)")
        && workflowText.includes("## Execution Speed Policy (Project Optimization)")
        && workflowText.includes("## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)")
        && workflowText.includes("- Adapter policy scope: `session-topology`.")
        && workflowText.includes("- In multi-agent contexts, evaluate fast-path eligibility at the concrete dispatch/local execution scope")
        && workflowText.includes("- Treat this area as a shared integration surface.")
        && !workflowText.includes("### Mode mapping")
        && !workflowText.includes("### Incident Trigger Conditions"),
      workflow_preserved_shared_codegen_constraint: workflowText.includes("- Shared codegen boundary constraints:")
        && workflowText.includes("internal/components/manifest.json")
        && workflowText.includes("generated SSR tests"),
      workflow_renders_extracted_constraints: workflowText.includes("- Dependency minimization constraints: `Imports must follow the minimal-dependency principle")
        && workflowText.includes("Every hotfix touching hydration/dispatch"),
      workflow_renders_ci_capacity: workflowText.includes("Drone capacity is limited: only one PR may consume")
        && workflowText.includes("Dependency/security batches (Dependabot included) must be sequential"),
      workflow_renders_snapshot_policy: workflowText.includes("Snapshot update trigger: `At session close and whenever baseline")
        && workflowText.includes("Snapshot owner: `Current session agent, validated during review.`"),
      workflow_restored_from_config_after_stale_overwrite: workflowTextAfterSecond.includes("- Shared codegen boundary constraints:")
        && workflowTextAfterSecond.includes("## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)")
        && !workflowTextAfterSecond.includes("## Imported Local Extensions"),
      summary_regenerated: summaryText.includes("- Configured source branch: `dev`"),
      codex_online_regenerated: codexOnlineText.includes("- source branch: `dev`"),
      index_regenerated: indexText.includes("- Project: `gowire`"),
      baseline_current_preserved: beforeHashes.baselineCurrent === sha256(baselineCurrentPath),
      baseline_history_preserved: beforeHashes.baselineHistory === sha256(baselineHistoryPath),
      parking_lot_preserved: beforeHashes.parkingLot === sha256(parkingLotPath),
      snapshot_preserved: beforeHashes.snapshot === sha256(snapshotPath),
      second_workflow_restored: generatedHashesAfterFirst.workflow === generatedHashesAfterSecond.workflow,
      second_summary_stable: generatedHashesAfterFirst.summary === generatedHashesAfterSecond.summary,
      second_codex_online_stable: generatedHashesAfterFirst.codexOnline === generatedHashesAfterSecond.codexOnline,
      second_index_stable: generatedHashesAfterFirst.index === generatedHashesAfterSecond.index,
      third_workflow_stable: generatedHashesAfterSecond.workflow === generatedHashesAfterThird.workflow,
      third_summary_stable: generatedHashesAfterSecond.summary === generatedHashesAfterThird.summary,
      third_codex_online_stable: generatedHashesAfterSecond.codexOnline === generatedHashesAfterThird.codexOnline,
      third_index_stable: generatedHashesAfterSecond.index === generatedHashesAfterThird.index,
    };

    const pass = Object.values(checks).every((value) => value === true);
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        first_stderr: first.stderr.trim(),
        second_stderr: second.stderr.trim(),
        third_stderr: third.stderr.trim(),
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
