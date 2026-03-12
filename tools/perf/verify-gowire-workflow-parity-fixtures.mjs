#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-gowire-parity-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(sourceFixture, targetRoot, { recursive: true });

    const workflowPath = path.join(targetRoot, "docs", "audit", "WORKFLOW.md");
    const legacyWorkflowSourcePath = path.join(targetRoot, ".aidn", "project", "workflow.adapter.legacy-source.md");
    fs.writeFileSync(workflowPath, readText(workflowFixture), "utf8");
    fs.rmSync(legacyWorkflowSourcePath, { force: true });
    fs.rmSync(path.join(targetRoot, ".aidn", "project", "workflow.adapter.migration-report.json"), { force: true });

    const result = run(repoRoot, [
      "--target",
      targetRoot,
      "--migrate-adapter",
      "--version",
      version,
      "--json",
    ]);
    const payload = JSON.parse(result.stdout || "{}");
    const migratedWorkflow = readText(workflowPath);
    const legacyWorkflow = readText(legacyWorkflowSourcePath);

    const acceptedRemovedLegacyOnlyHeadings = [
      "## Imported Local Extensions",
      "### Incident Trigger Conditions",
      "### Noise Control (Anti-Noise)",
      "### Temporary Incident Tracking File",
      "### Authorization Gate (Mandatory for L3/L4)",
      "### Workflow Self-Improvement Scope",
      "### Resume and Cleanup",
      "### Rule Set (choose exactly one)",
      "### Mode mapping",
      "### Interactive Stop Prompt (selection list)",
    ];
    const requiredLegacyAnchors = [
      "`adopt-to-current-session`",
      "`archive-non-retained`",
      "`drop-with-rationale`",
      "branch/cycle mapping validity",
      "breadth of validation commands",
      "reporting granularity",
      "touched files exceed threshold",
      "requirement/scope drift appears",
      "no API/contract/schema/security change",
      "no shared codegen boundary impact",
      "`LOW` risk:",
      "`MEDIUM` risk:",
      "`HIGH` risk:",
      "`decisions.md`",
      "`traceability.md`",
      "explicit note that the change lives in patch/mutation/component layer",
      "impact >= medium and user approval",
    ];

    const checks = {
      migrate_ok: result.status === 0 && payload.ok === true,
      legacy_source_written: fs.existsSync(legacyWorkflowSourcePath),
      promoted_sections_present_natively: migratedWorkflow.includes("### Session Transition Cleanliness Gate (Mandatory)")
        && migratedWorkflow.includes("## Execution Speed Policy (Project Optimization)")
        && migratedWorkflow.includes("## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)"),
      imported_extensions_removed_after_promotion: !migratedWorkflow.includes("## Imported Local Extensions"),
      expected_legacy_only_headings_absent: acceptedRemovedLegacyOnlyHeadings.every((heading) => !migratedWorkflow.includes(heading)),
      required_legacy_semantics_preserved: requiredLegacyAnchors.every((anchor) => legacyWorkflow.includes(anchor) && migratedWorkflow.includes(anchor)),
      migrated_workflow_adds_expected_native_scope_wording: migratedWorkflow.includes("- Adapter policy scope: `session-topology`.")
        && migratedWorkflow.includes("dispatch/local execution scope")
        && migratedWorkflow.includes("shared integration surface"),
      migrated_workflow_keeps_shared_codegen_constraint_block: migratedWorkflow.includes("- Shared codegen boundary constraints:")
        && migratedWorkflow.includes("internal/components/manifest.json")
        && migratedWorkflow.includes("generated SSR tests"),
    };

    const pass = Object.values(checks).every((value) => value === true);
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        accepted_removed_headings: acceptedRemovedLegacyOnlyHeadings,
        required_semantic_anchors: requiredLegacyAnchors,
        migrated_workflow_excerpt: migratedWorkflow.split(/\r?\n/).filter((line) =>
          line.includes("Session Transition Cleanliness")
          || line.includes("Execution Speed Policy")
          || line.includes("Shared Codegen Boundary Gate")
          || line.includes("dispatch/local execution scope")
          || line.includes("shared integration surface")
        ),
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
