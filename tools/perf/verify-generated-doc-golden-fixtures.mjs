#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import {
  readAidnProjectConfig,
  resolveConfigIndexStore,
  resolveConfigSourceBranch,
  resolveConfigStateMode,
} from "../../src/lib/config/aidn-config-lib.mjs";
import { readWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { buildGeneratedDocTemplateVars } from "../../src/application/install/generated-doc-template-vars.mjs";
import { renderGeneratedDocContent } from "../../src/application/install/generated-doc-render-service.mjs";
import { readUtf8 } from "../../src/application/install/template-io.mjs";

const GENERATED_DOC_CASES = [
  {
    key: "workflow",
    templateRelative: "scaffold/docs_audit/PROJECT_WORKFLOW.md",
    targetRelative: "docs/audit/WORKFLOW.md",
    preserveImportedWorkflowExtensions: true,
  },
  {
    key: "summary",
    templateRelative: "scaffold/docs_audit/WORKFLOW_SUMMARY.md",
    targetRelative: "docs/audit/WORKFLOW_SUMMARY.md",
  },
  {
    key: "codex_online",
    templateRelative: "scaffold/codex/README_CodexOnline.md",
    targetRelative: "docs/audit/CODEX_ONLINE.md",
  },
  {
    key: "index",
    templateRelative: "scaffold/docs_audit/index.md",
    targetRelative: "docs/audit/index.md",
  },
];

// This installed corpus is a retained rendering snapshot, not the current
// package version. Only this known metadata scalar is version-dependent.
const GOLDEN_WORKFLOW_VERSION = "0.12.0";
const workflowVersions = text => [...text.matchAll(/^workflow_version: (.+)$/gm)].map(row => row[1]);
function matchesGolden(expected, rendered, key, version) {
  if (key !== "workflow") return rendered === expected;
  if (JSON.stringify(workflowVersions(expected)) !== JSON.stringify([GOLDEN_WORKFLOW_VERSION])
    || JSON.stringify(workflowVersions(rendered)) !== JSON.stringify([version])) return false;
  return rendered === expected.replace(`workflow_version: ${GOLDEN_WORKFLOW_VERSION}`, `workflow_version: ${version}`);
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function main() {
  const repoRoot = process.cwd();
  const targetRoot = path.resolve(repoRoot, "tests", "fixtures", "repo-installed-core");
  const version = readUtf8(path.join(repoRoot, "VERSION")).trim();
  const aidnConfig = readAidnProjectConfig(targetRoot);
  const adapterConfig = readWorkflowAdapterConfig(targetRoot, {
    projectName: path.basename(targetRoot),
    preferredStateMode: resolveConfigStateMode(aidnConfig.data),
    defaultIndexStore: resolveConfigIndexStore(aidnConfig.data),
  });

  const templateVars = {
    VERSION: version,
    PROJECT_NAME: adapterConfig.data.projectName || path.basename(targetRoot),
    SOURCE_BRANCH: resolveConfigSourceBranch(aidnConfig.data) || "main",
  };
  Object.assign(templateVars, buildGeneratedDocTemplateVars({
    repoRoot,
    templateVars,
    aidnConfigData: aidnConfig.data,
    workflowAdapterConfig: adapterConfig,
  }));

  const checks = {};
  const samples = {};
  for (const item of GENERATED_DOC_CASES) {
    const targetPath = path.join(targetRoot, item.targetRelative);
    const expected = readUtf8(targetPath);
    const first = renderGeneratedDocContent({
      repoRoot,
      targetRoot,
      templateRelative: item.templateRelative,
      targetRelative: item.targetRelative,
      templateVars,
      preserveImportedWorkflowExtensions: item.preserveImportedWorkflowExtensions === true,
    });
    const second = renderGeneratedDocContent({
      repoRoot,
      targetRoot,
      templateRelative: item.templateRelative,
      targetRelative: item.targetRelative,
      templateVars,
      preserveImportedWorkflowExtensions: item.preserveImportedWorkflowExtensions === true,
    });
    checks[`${item.key}_matches_fixture`] = matchesGolden(expected, first, item.key, version);
    if (item.key === "workflow") {
      checks.workflow_snapshot_version_is_pinned = JSON.stringify(workflowVersions(expected)) === JSON.stringify([GOLDEN_WORKFLOW_VERSION]);
      checks.workflow_current_version_rendered = JSON.stringify(workflowVersions(first)) === JSON.stringify([version]);
      checks.workflow_wrong_rendered_version_rejected = !matchesGolden(expected,
        first.replace(`workflow_version: ${version}`, "workflow_version: 999.0.0"), item.key, version);
      checks.workflow_nonversion_drift_rejected = !matchesGolden(expected, first + "\nUnexpected rendering drift\n", item.key, version);
      checks.workflow_unpinned_snapshot_rejected = !matchesGolden(expected.replace(`workflow_version: ${GOLDEN_WORKFLOW_VERSION}`,
        "workflow_version: 999.0.0"), first, item.key, version);
    }
    checks[`${item.key}_repeatable`] = first === second;
    checks[`${item.key}_has_no_placeholders`] = !/\{\{[A-Z0-9_]+\}\}/.test(first);
    samples[item.key] = {
      target: item.targetRelative,
      rendered_sha256: sha256(first),
      expected_sha256: sha256(expected),
    };
  }

  const pass = Object.values(checks).every((value) => value === true);
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    target_root: targetRoot,
    snapshot_workflow_version: GOLDEN_WORKFLOW_VERSION,
    rendered_package_version: version,
    checks,
    samples,
    pass,
  }, null, 2));
  if (!pass) {
    process.exit(1);
  }
}

main();
