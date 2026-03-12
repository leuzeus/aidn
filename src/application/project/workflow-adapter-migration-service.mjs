import fs from "node:fs";
import path from "node:path";
import {
  readAidnProjectConfig,
  resolveConfigIndexStore,
  resolveConfigSourceBranch,
  resolveConfigStateMode,
  writeAidnProjectConfig,
} from "../../lib/config/aidn-config-lib.mjs";
import {
  normalizeWorkflowAdapterConfig,
  resolveWorkflowAdapterConfigPath,
  writeWorkflowAdapterConfig,
} from "../../lib/config/workflow-adapter-config-lib.mjs";
import {
  collectPlaceholderValuesFromText,
} from "../install/custom-file-policy.mjs";
import { buildGeneratedDocTemplateVars } from "../install/generated-doc-template-vars.mjs";
import { renderManagedInstallDocs } from "../install/generated-doc-render-service.mjs";
import { readUtf8, renderTemplateVariables, writeUtf8 } from "../install/template-io.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function matchBacktickValue(text, expression) {
  const match = String(text ?? "").match(expression);
  return clean(match?.[1] ?? "");
}

function parseSections(markdown) {
  const sections = new Map();
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  let current = null;
  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      current = {
        heading: clean(match[2]),
        level: match[1].length,
        lines: [],
      };
      sections.set(current.heading, current);
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function parseBacktickBullets(sectionLines) {
  const out = [];
  for (const rawLine of sectionLines) {
    const line = String(rawLine ?? "");
    const bulletMatch = line.match(/^\s*-\s*(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    const body = clean(bulletMatch[1]);
    const firstColon = body.indexOf(":");
    const firstBacktick = body.indexOf("`");
    const lastBacktick = body.lastIndexOf("`");
    if (firstColon <= 0 || firstBacktick <= firstColon || lastBacktick <= firstBacktick) {
      continue;
    }
    const label = clean(body.slice(0, firstColon));
    const value = clean(body.slice(firstBacktick + 1, lastBacktick));
    if (!label || !value) {
      continue;
    }
    out.push({
      label,
      value,
      raw: `${label}: \`${value}\``,
    });
  }
  return out;
}

function parsePlainBullets(sectionLines) {
  const out = [];
  for (const rawLine of sectionLines) {
    const line = String(rawLine ?? "");
    const match = line.match(/^\s*-\s+(.+)$/);
    if (!match) {
      continue;
    }
    const value = clean(match[1]);
    if (value) {
      out.push(value);
    }
  }
  return out;
}

function extractCiCapacityLines(sections) {
  const explicitSection = parsePlainBullets(
    sections.get("CI Capacity Gate (Mandatory, project policy extension)")?.lines ?? [],
  );
  if (explicitSection.length > 0) {
    return explicitSection;
  }
  const sessionCloseLines = parsePlainBullets(
    sections.get("Session Close & PR Review")?.lines ?? [],
  );
  return sessionCloseLines.filter((line) => ![
    "Session close and PR review gates are canonical in `docs/audit/SPEC.md` (`SPEC-R07`, `SPEC-R08`).",
    "Add local CI/review capacity policy here if your repository needs it.",
    "Project-specific CI/review capacity policy: `none`",
  ].includes(line));
}

function extractProjectConstraintBullets(sections) {
  return parsePlainBullets(sections.get("Project Constraints")?.lines ?? []);
}

function collectCanonicalHeadingNames(renderedTemplate) {
  const names = new Set();
  const lines = String(renderedTemplate ?? "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) {
      continue;
    }
    names.add(clean(match[2]).replace(/\s+\(project adapter\)$/i, "").replace(/\s+\(Imported\)$/i, "").trim().toLowerCase());
  }
  names.add("runtime state policy");
  names.add("ci capacity gate (mandatory, project policy extension)");
  return names;
}

function collectImportedSectionsFromLegacy(renderedTemplate, sourceText) {
  const canonicalHeadings = collectCanonicalHeadingNames(renderedTemplate);
  const lines = String(sourceText ?? "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;

  function flush() {
    if (!current) {
      return;
    }
    const body = current.lines.join("\n").trimEnd();
    if (body) {
      sections.push(body);
    }
    current = null;
  }

  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      const headingName = clean(match[2]).replace(/\s+\(project adapter\)$/i, "").replace(/\s+\(Imported\)$/i, "").trim().toLowerCase();
      if (headingName === "imported local extensions" || canonicalHeadings.has(headingName)) {
        flush();
        current = null;
        continue;
      }
      flush();
      current = { lines: [line] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return Array.from(new Set(sections.map((item) => item.trim()).filter((item) => item.length > 0)));
}

function extractFromWorkflowMarkdown(text, defaults = {}) {
  const placeholders = collectPlaceholderValuesFromText(text);
  const sections = parseSections(text);
  const projectConstraintBullets = extractProjectConstraintBullets(sections);
  const projectConstraints = parseBacktickBullets(sections.get("Project Constraints")?.lines ?? []);
  const runtimePolicyLines = parsePlainBullets(sections.get("Runtime State Policy")?.lines ?? []);
  const branchPolicyLines = parseBacktickBullets(sections.get("Branch & Cycle Policy")?.lines ?? []);
  const snapshotBullets = parseBacktickBullets(sections.get("Snapshot Discipline")?.lines ?? []);
  const ciCapacityLines = extractCiCapacityLines(sections);

  const runtimeConstraint = projectConstraints.find((item) => /runtime\/platform constraints/i.test(item.label))?.value ?? "";
  const architectureConstraint = projectConstraints.find((item) => /architecture constraints/i.test(item.label))?.value ?? "";
  const deliveryConstraint = projectConstraints.find((item) => /delivery constraints/i.test(item.label))?.value ?? "";
  const knownProjectLabels = new Set([
    "runtime/platform constraints",
    "architecture constraints",
    "delivery constraints (ci/release/compliance)",
    "additional local constraints",
  ]);
  const additionalConstraints = projectConstraints
    .filter((item) => {
      const normalizedLabel = item.label.toLowerCase();
      if (knownProjectLabels.has(normalizedLabel)) {
        return false;
      }
      if (
        item.value === "TO_DEFINE"
        && [
          "dependency/data constraints",
          "generated artifact constraints",
          "testing/regression constraints",
        ].includes(normalizedLabel)
      ) {
        return false;
      }
      return true;
    })
    .map((item) => item.raw);

  const snapshotMap = Object.fromEntries(
    snapshotBullets.map((item) => [item.label.toLowerCase(), item.value]),
  );
  const dorPolicy = branchPolicyLines.find((item) => /dor policy/i.test(item.label))?.value
    ?? matchBacktickValue(text, /DoR policy:.*?`([^`]+)`/i)
    ?? placeholders.DOR_POLICY
    ?? "";
  const preferredStateMode = matchBacktickValue(
    runtimePolicyLines.join("\n"),
    /Preferred runtime state mode:\s*`([^`]+)`/i,
  ) || clean(defaults.preferredStateMode);
  const defaultIndexStore = matchBacktickValue(
    runtimePolicyLines.join("\n"),
    /Default install\/runtime index store:\s*`([^`]+)`/i,
  ) || matchBacktickValue(
    runtimePolicyLines.join("\n"),
    /with\s+`([^`]+)`\s+index storage/i,
  ) || clean(defaults.defaultIndexStore);

  return normalizeWorkflowAdapterConfig({
    projectName: placeholders.PROJECT_NAME || defaults.projectName,
    constraints: {
      runtime: runtimeConstraint,
      architecture: architectureConstraint,
      delivery: deliveryConstraint,
      additional: additionalConstraints,
    },
    dorPolicy,
    runtimePolicy: {
      preferredStateMode,
      defaultIndexStore,
    },
    snapshotPolicy: {
      trigger: snapshotMap["snapshot update trigger"] ?? placeholders.SNAPSHOT_TRIGGER,
      owner: snapshotMap["snapshot owner"] ?? placeholders.SNAPSHOT_OWNER,
      freshnessRule: snapshotMap["freshness rule before commit/review"] ?? placeholders.SNAPSHOT_FRESHNESS_RULE,
      parkingLotRule: snapshotMap["parking lot rule for non-essential ideas (entropy isolation)"] ?? placeholders.PARKING_LOT_RULE,
    },
    ciPolicy: {
      capacity: ciCapacityLines,
    },
    legacyPreserved: {
      projectConstraintsBullets: projectConstraintBullets,
      importedSections: defaults.importedSections ?? [],
    },
  }, defaults);
}

function buildCiCapacityBlock(capacityLines = []) {
  const lines = Array.isArray(capacityLines)
    ? capacityLines.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  if (lines.length === 0) {
    return "- Project-specific CI/review capacity policy: `none`";
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

function buildMigrationReportPath(targetRoot) {
  return path.resolve(targetRoot, ".aidn", "project", "workflow.adapter.migration-report.json");
}

function buildLegacyWorkflowSourcePath(targetRoot) {
  return path.resolve(targetRoot, ".aidn", "project", "workflow.adapter.legacy-source.md");
}

export function buildWorkflowAdapterMigrationTemplateVars({
  aidnConfigData,
  workflowAdapterConfig,
  version,
  projectName,
  sourceBranch,
}) {
  const templateVars = {
    VERSION: clean(version),
    PROJECT_NAME: clean(projectName),
    SOURCE_BRANCH: clean(sourceBranch),
  };
  const generated = buildGeneratedDocTemplateVars({
    templateVars,
    aidnConfigData,
    workflowAdapterConfig,
  });
  const adapterData = workflowAdapterConfig?.data ?? {};
  const additionalLines = Array.isArray(adapterData.constraints?.additional)
    ? adapterData.constraints.additional.map((item) => clean(item)).filter((item) => item.length > 0)
    : [];
  generated.ADDITIONAL_CONSTRAINT_BLOCK = additionalLines.length === 0
    ? "- Additional local constraints: `none`"
    : additionalLines.map((item) => `- ${item}`).join("\n");
  generated.CI_CAPACITY_BLOCK = buildCiCapacityBlock(adapterData.ciPolicy?.capacity);
  generated.DOR_POLICY = clean(adapterData.dorPolicy) || generated.DOR_POLICY;
  generated.SNAPSHOT_TRIGGER = clean(adapterData.snapshotPolicy?.trigger) || generated.SNAPSHOT_TRIGGER;
  generated.SNAPSHOT_OWNER = clean(adapterData.snapshotPolicy?.owner) || generated.SNAPSHOT_OWNER;
  generated.SNAPSHOT_FRESHNESS_RULE = clean(adapterData.snapshotPolicy?.freshnessRule) || generated.SNAPSHOT_FRESHNESS_RULE;
  generated.PARKING_LOT_RULE = clean(adapterData.snapshotPolicy?.parkingLotRule) || generated.PARKING_LOT_RULE;
  return generated;
}

export function previewWorkflowAdapterMigration({
  repoRoot,
  targetRoot,
  version,
}) {
  const workflowPath = path.resolve(targetRoot, "docs", "audit", "WORKFLOW.md");
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Missing workflow file for migration: ${workflowPath}`);
  }
  const legacyWorkflowSourcePath = buildLegacyWorkflowSourcePath(targetRoot);
  const aidnConfigState = readAidnProjectConfig(targetRoot);
  const workflowText = readUtf8(workflowPath);
  const extractionSourceText = fs.existsSync(legacyWorkflowSourcePath)
    ? readUtf8(legacyWorkflowSourcePath)
    : workflowText;
  const extractedPlaceholders = collectPlaceholderValuesFromText(extractionSourceText);
  const extractedSourceBranch = clean(resolveConfigSourceBranch(aidnConfigState.data))
    || clean(extractedPlaceholders.SOURCE_BRANCH);
  const extractedProjectName = clean(extractedPlaceholders.PROJECT_NAME) || path.basename(targetRoot);
  const extractedConfig = extractFromWorkflowMarkdown(extractionSourceText, {
    projectName: extractedProjectName,
    preferredStateMode: resolveConfigStateMode(aidnConfigState.data),
    defaultIndexStore: resolveConfigIndexStore(aidnConfigState.data),
    importedSections: [],
  });
  const provisionalWorkflowAdapterConfig = {
    path: resolveWorkflowAdapterConfigPath(targetRoot),
    data: extractedConfig,
  };
  const provisionalTemplateVars = buildWorkflowAdapterMigrationTemplateVars({
    aidnConfigData: aidnConfigState.data,
    workflowAdapterConfig: provisionalWorkflowAdapterConfig,
    version,
    projectName: extractedProjectName,
    sourceBranch: extractedSourceBranch,
  });
  const renderedTemplate = renderTemplateVariables(
    readUtf8(path.resolve(repoRoot, "template", "docs_audit", "PROJECT_WORKFLOW.md")),
    provisionalTemplateVars,
  );
  const importedSections = collectImportedSectionsFromLegacy(renderedTemplate, extractionSourceText);
  const finalizedConfig = normalizeWorkflowAdapterConfig({
    ...extractedConfig,
    legacyPreserved: {
      ...(extractedConfig.legacyPreserved ?? {}),
      importedSections,
    },
  }, {
    projectName: extractedProjectName,
    preferredStateMode: resolveConfigStateMode(aidnConfigState.data),
    defaultIndexStore: resolveConfigIndexStore(aidnConfigState.data),
  });
  const workflowAdapterConfig = {
    path: resolveWorkflowAdapterConfigPath(targetRoot),
    data: finalizedConfig,
  };
  const templateVars = buildWorkflowAdapterMigrationTemplateVars({
    aidnConfigData: aidnConfigState.data,
    workflowAdapterConfig,
    version,
    projectName: extractedProjectName,
    sourceBranch: extractedSourceBranch,
  });
  const generatedPreview = renderManagedInstallDocs({
    repoRoot,
    targetRoot,
    dryRun: true,
    templateVars,
    existingContentByTarget: {
      "docs/audit/workflow.md": workflowText,
      "docs/audit/workflow_summary.md": fs.existsSync(path.resolve(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md"))
        ? readUtf8(path.resolve(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md"))
        : null,
      "docs/audit/codex_online.md": fs.existsSync(path.resolve(targetRoot, "docs", "audit", "CODEX_ONLINE.md"))
        ? readUtf8(path.resolve(targetRoot, "docs", "audit", "CODEX_ONLINE.md"))
        : null,
      "docs/audit/index.md": fs.existsSync(path.resolve(targetRoot, "docs", "audit", "index.md"))
        ? readUtf8(path.resolve(targetRoot, "docs", "audit", "index.md"))
        : null,
    },
    workflowAdapterConfig,
  });

  return {
    targetRoot,
    aidnConfigState,
    extractedSourceBranch,
    extractedProjectName,
    workflowPath,
    legacyWorkflowSourcePath,
    extractionSourcePath: fs.existsSync(legacyWorkflowSourcePath) ? legacyWorkflowSourcePath : workflowPath,
    workflowAdapterConfig,
    templateVars,
    generatedPreview,
    workflowText,
  };
}

export function executeWorkflowAdapterMigration({
  repoRoot,
  targetRoot,
  version,
  dryRun = false,
}) {
  const preview = previewWorkflowAdapterMigration({
    repoRoot,
    targetRoot,
    version,
  });
  const nextAidnConfig = {
    ...(preview.aidnConfigState.data ?? {}),
    workflow: {
      ...((preview.aidnConfigState.data ?? {}).workflow ?? {}),
      sourceBranch: preview.extractedSourceBranch || resolveConfigSourceBranch(preview.aidnConfigState.data) || "main",
    },
  };

  if (!dryRun) {
    fs.mkdirSync(path.dirname(preview.legacyWorkflowSourcePath), { recursive: true });
    if (!fs.existsSync(preview.legacyWorkflowSourcePath)) {
      writeUtf8(preview.legacyWorkflowSourcePath, preview.workflowText, false);
    }
    writeWorkflowAdapterConfig(targetRoot, preview.workflowAdapterConfig.data, {
      projectName: preview.extractedProjectName,
      preferredStateMode: preview.workflowAdapterConfig.data.runtimePolicy?.preferredStateMode,
      defaultIndexStore: preview.workflowAdapterConfig.data.runtimePolicy?.defaultIndexStore,
    });
    writeAidnProjectConfig(targetRoot, nextAidnConfig);
    renderManagedInstallDocs({
      repoRoot,
      targetRoot,
      dryRun: false,
      templateVars: preview.templateVars,
      existingContentByTarget: {
        "docs/audit/workflow.md": readUtf8(preview.workflowPath),
        "docs/audit/workflow_summary.md": fs.existsSync(path.resolve(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md"))
          ? readUtf8(path.resolve(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md"))
          : null,
        "docs/audit/codex_online.md": fs.existsSync(path.resolve(targetRoot, "docs", "audit", "CODEX_ONLINE.md"))
          ? readUtf8(path.resolve(targetRoot, "docs", "audit", "CODEX_ONLINE.md"))
          : null,
        "docs/audit/index.md": fs.existsSync(path.resolve(targetRoot, "docs", "audit", "index.md"))
          ? readUtf8(path.resolve(targetRoot, "docs", "audit", "index.md"))
          : null,
      },
      workflowAdapterConfig: preview.workflowAdapterConfig,
    });
    const reportPath = buildMigrationReportPath(targetRoot);
    const report = {
      migrated_at: new Date().toISOString(),
      target_root: targetRoot,
      workflow_path: preview.workflowPath,
      adapter_path: preview.workflowAdapterConfig.path,
      source_branch: nextAidnConfig.workflow.sourceBranch,
      extracted_config: preview.workflowAdapterConfig.data,
      generated_docs: preview.generatedPreview.map((item) => ({
        target: item.targetRelative,
        changed: item.changed,
      })),
      preserved_files: [
        "docs/audit/baseline/current.md",
        "docs/audit/baseline/history.md",
        "docs/audit/parking-lot.md",
        "docs/audit/snapshots/context-snapshot.md",
      ],
      legacy_workflow_source_path: preview.legacyWorkflowSourcePath,
      extraction_source_path: preview.extractionSourcePath,
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    writeUtf8(reportPath, `${JSON.stringify(report, null, 2)}\n`, false);
  }

  return {
    ok: true,
    action: dryRun ? "preview-migrate-adapter" : "migrate-adapter",
    target_root: targetRoot,
    source_branch: nextAidnConfig.workflow.sourceBranch,
    adapter_path: preview.workflowAdapterConfig.path,
    report_path: buildMigrationReportPath(targetRoot),
    legacy_workflow_source_path: preview.legacyWorkflowSourcePath,
    extraction_source_path: preview.extractionSourcePath,
    extracted_config: preview.workflowAdapterConfig.data,
    generated_docs: preview.generatedPreview.map((item) => ({
      target: item.targetRelative,
      changed: item.changed,
    })),
    preserved_files: [
      "docs/audit/baseline/current.md",
      "docs/audit/baseline/history.md",
      "docs/audit/parking-lot.md",
      "docs/audit/snapshots/context-snapshot.md",
    ],
  };
}
