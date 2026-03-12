#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";

function makeCodexStub(tmpRoot) {
  const binDir = path.resolve(tmpRoot, ".tmp-codex-bin");
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "codex.cmd"), [
      "@echo off",
      "if \"%1\"==\"login\" if \"%2\"==\"status\" (",
      "  echo Logged in",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"exec\" (",
      "  exit /b 0",
      ")",
      "exit /b 0",
      "",
    ].join("\r\n"), "utf8");
  } else {
    const scriptPath = path.join(binDir, "codex");
    fs.writeFileSync(scriptPath, [
      "#!/usr/bin/env sh",
      "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then",
      "  echo \"Logged in\"",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"exec\" ]; then",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"), "utf8");
    fs.chmodSync(scriptPath, 0o755);
  }
  return binDir;
}

function runInstall(repoRoot, targetRoot, codexStubBin, extraEnv = {}) {
  const separator = process.platform === "win32" ? ";" : ":";
  const result = spawnSync(process.execPath, [
    path.resolve(repoRoot, "tools", "install.mjs"),
    "--target",
    targetRoot,
    "--pack",
    "core",
    "--no-codex-migrate-custom",
    "--force-agents-merge",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: `${codexStubBin}${separator}${String(process.env.PATH ?? "")}`,
      ...extraEnv,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function writeAdapterConfig(targetRoot) {
  const filePath = path.join(targetRoot, ".aidn", "project", "workflow.adapter.json");
  const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  config.sessionPolicy = {
    transitionCleanliness: {
      enabled: true,
      scope: "session-topology",
      requiredDecisionOptions: [
        "adopt-to-current-session",
        "archive-non-retained",
        "drop-with-rationale",
      ],
    },
  };
  config.executionPolicy = {
    enabled: true,
    evaluationScope: "dispatch-or-local-scope",
    escalateOnParallelAttachedCycles: true,
    escalateOnSharedIntegrationSurface: true,
    hardGates: [
      "branch-cycle-mapping",
      "continuity-rule-selection",
      "stop-conditions",
      "session-close-validity",
    ],
    lightGates: [
      "artifact-depth",
      "validation-breadth",
      "reporting-granularity",
    ],
    fastPath: {
      enabled: true,
      maxTouchedFiles: 2,
      forbidApiContractSchemaSecurityChange: true,
      forbidSharedCodegenBoundaryImpact: true,
      requireNoContinuityAmbiguity: true,
    },
    validationProfiles: {
      low: "targeted tests plus focused lint on impacted packages/components",
      medium: "targeted validations plus cross-package checks relevant to the change surface",
      high: "full validation stack (`make lint`, `make test`, and required runtime/browser stress checks by cycle type)",
    },
  };
  config.specializedGates = {
    sharedCodegenBoundary: {
      enabled: true,
      sharedIntegrationSurface: true,
      escalateOnMultiAgentOverlap: true,
      generatorPaths: [
        "internal/builder/engines/components.go",
        "internal/components/manifest.json",
        "web/ce/elements.js",
      ],
      requiredEvidence: [
        "decisions.md",
        "traceability.md",
      ],
      forbidComponentSpecificGeneratorFixes: true,
    },
  };
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function findWorkflowArtifact(payload) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  return artifacts.find((row) => String(row?.path ?? "").toLowerCase().endsWith("workflow.md")) ?? null;
}

function hasPromotedSections(text) {
  const value = String(text ?? "");
  return value.includes("### Session Transition Cleanliness Gate (Mandatory)")
    && value.includes("## Execution Speed Policy (Project Optimization)")
    && value.includes("## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)");
}

function makeTarget(tmpRoot, sourceTarget, suffix) {
  const targetRoot = path.join(tmpRoot, `repo-${suffix}`);
  fs.cpSync(sourceTarget, targetRoot, { recursive: true });
  fs.rmSync(path.join(targetRoot, ".aidn", "runtime", "index"), { recursive: true, force: true });
  writeAdapterConfig(targetRoot);
  return targetRoot;
}

function main() {
  let tmpRoot = "";
  let codexStubBin = "";
  try {
    const repoRoot = process.cwd();
    const sourceTarget = path.resolve(repoRoot, "tests", "fixtures", "repo-installed-core");
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-promoted-visibility-"));
    codexStubBin = makeCodexStub(tmpRoot);

    const dualTarget = makeTarget(tmpRoot, sourceTarget, "dual");
    const dualInstall = runInstall(repoRoot, dualTarget, codexStubBin);
    const dualWorkflow = fs.readFileSync(path.join(dualTarget, "docs", "audit", "WORKFLOW.md"), "utf8");
    const dualSqlitePath = path.join(dualTarget, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const dualPayload = fs.existsSync(dualSqlitePath) ? readIndexFromSqlite(dualSqlitePath).payload : null;
    const dualArtifact = findWorkflowArtifact(dualPayload);

    const dbOnlyTarget = makeTarget(tmpRoot, sourceTarget, "db-only");
    const dbOnlyInstall = runInstall(repoRoot, dbOnlyTarget, codexStubBin, {
      AIDN_STATE_MODE: "db-only",
    });
    const dbOnlyWorkflow = fs.readFileSync(path.join(dbOnlyTarget, "docs", "audit", "WORKFLOW.md"), "utf8");
    const dbOnlySqlitePath = path.join(dbOnlyTarget, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const dbOnlyPayload = fs.existsSync(dbOnlySqlitePath) ? readIndexFromSqlite(dbOnlySqlitePath).payload : null;
    const dbOnlyArtifact = findWorkflowArtifact(dbOnlyPayload);

    const checks = {
      dual_install_ok: dualInstall.status === 0 && dualInstall.stdout.includes("artifact import: OK"),
      dual_workflow_has_promoted_sections: hasPromotedSections(dualWorkflow),
      dual_sqlite_exists: fs.existsSync(dualSqlitePath),
      dual_sqlite_workflow_artifact_present: Boolean(dualArtifact),
      dual_sqlite_workflow_content_has_promoted_sections: hasPromotedSections(dualArtifact?.content),
      db_only_install_ok: dbOnlyInstall.status === 0 && dbOnlyInstall.stdout.includes("store=sqlite"),
      db_only_workflow_has_promoted_sections: hasPromotedSections(dbOnlyWorkflow),
      db_only_sqlite_exists: fs.existsSync(dbOnlySqlitePath),
      db_only_sqlite_workflow_artifact_present: Boolean(dbOnlyArtifact),
      db_only_sqlite_workflow_content_has_promoted_sections: hasPromotedSections(dbOnlyArtifact?.content),
    };

    const pass = Object.values(checks).every((value) => value === true);
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      checks,
      samples: {
        dual_workflow_excerpt: dualWorkflow.split(/\r?\n/).filter((line) =>
          line.includes("Session Transition Cleanliness")
          || line.includes("Execution Speed Policy")
          || line.includes("Shared Codegen Boundary Gate")
        ),
        db_only_workflow_excerpt: dbOnlyWorkflow.split(/\r?\n/).filter((line) =>
          line.includes("Session Transition Cleanliness")
          || line.includes("Execution Speed Policy")
          || line.includes("Shared Codegen Boundary Gate")
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
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
    if (codexStubBin && fs.existsSync(codexStubBin)) {
      fs.rmSync(codexStubBin, { recursive: true, force: true });
    }
  }
}

main();
