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
    templateRelative: "template/docs_audit/PROJECT_WORKFLOW.md",
    targetRelative: "docs/audit/WORKFLOW.md",
    preserveImportedWorkflowExtensions: true,
  },
  {
    key: "summary",
    templateRelative: "template/docs_audit/WORKFLOW_SUMMARY.md",
    targetRelative: "docs/audit/WORKFLOW_SUMMARY.md",
  },
  {
    key: "codex_online",
    templateRelative: "template/codex/README_CodexOnline.md",
    targetRelative: "docs/audit/CODEX_ONLINE.md",
  },
  {
    key: "index",
    templateRelative: "template/docs_audit/index.md",
    targetRelative: "docs/audit/index.md",
  },
];

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
    checks[`${item.key}_matches_fixture`] = first === expected;
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
    checks,
    samples,
    pass,
  }, null, 2));
  if (!pass) {
    process.exit(1);
  }
}

main();
