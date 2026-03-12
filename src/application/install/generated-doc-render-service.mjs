import fs from "node:fs";
import path from "node:path";
import { filterRetainedImportedSections } from "../project/imported-sections-policy-lib.mjs";
import {
  extractPlaceholders,
  normalizeRelativePath,
} from "./custom-file-policy.mjs";
import {
  ensureDir,
  readUtf8,
  renderTemplateVariables,
  writeUtf8,
} from "./template-io.mjs";

const IMPORTED_EXTENSIONS_HEADING = "## Imported Local Extensions";

const GENERATED_DOCS = [
  {
    templateRelative: "template/docs_audit/PROJECT_WORKFLOW.md",
    targetRelative: "docs/audit/WORKFLOW.md",
    preserveImportedWorkflowExtensions: true,
  },
  {
    templateRelative: "template/docs_audit/WORKFLOW_SUMMARY.md",
    targetRelative: "docs/audit/WORKFLOW_SUMMARY.md",
  },
  {
    templateRelative: "template/codex/README_CodexOnline.md",
    targetRelative: "docs/audit/CODEX_ONLINE.md",
  },
  {
    templateRelative: "template/docs_audit/index.md",
    targetRelative: "docs/audit/index.md",
  },
];

function normalizeHeadingText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+\(project adapter\)$/i, "")
    .replace(/\s+\(Imported\)$/i, "")
    .trim()
    .toLowerCase();
}

function stripImportedExtensionTail(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const marker = `\n${IMPORTED_EXTENSIONS_HEADING}\n`;
  const index = normalized.indexOf(marker);
  if (index >= 0) {
    return normalized.slice(0, index).trimEnd();
  }
  if (normalized.startsWith(`${IMPORTED_EXTENSIONS_HEADING}\n`)) {
    return "";
  }
  return normalized.trimEnd();
}

function extractWorkflowExtensionSource(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trimEnd();
  const marker = `${IMPORTED_EXTENSIONS_HEADING}\n`;
  const index = normalized.indexOf(marker);
  if (index < 0) {
    return normalized;
  }
  const tail = normalized.slice(index + marker.length).trimStart();
  const lines = tail.split("\n");
  while (lines.length > 0 && !/^(#{2,3})\s+/.test(lines[0])) {
    lines.shift();
  }
  return lines.join("\n").trimEnd();
}

function collectCanonicalHeadingNames(renderedTemplate) {
  const names = new Set();
  const lines = String(renderedTemplate ?? "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) {
      continue;
    }
    names.add(normalizeHeadingText(match[2]));
  }
  names.add("runtime state policy");
  names.add("ci capacity gate (mandatory, project policy extension)");
  return names;
}

function collectImportedWorkflowSections(renderedTemplate, existingContent) {
  const source = extractWorkflowExtensionSource(existingContent);
  if (!source) {
    return [];
  }
  const canonicalHeadings = collectCanonicalHeadingNames(renderedTemplate);
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
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
      const headingName = normalizeHeadingText(match[2]);
      const isImportedWrapper = headingName === normalizeHeadingText(
        IMPORTED_EXTENSIONS_HEADING.replace(/^##\s+/, ""),
      );
      if (isImportedWrapper || canonicalHeadings.has(headingName)) {
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
  return sections;
}

function mergeImportedWorkflowSections(existingSections, adapterSections, adapterData = null) {
  const merged = [];
  const seen = new Set();
  const retained = filterRetainedImportedSections([
    ...existingSections,
    ...adapterSections,
  ], adapterData);
  for (const section of retained) {
    const normalized = String(section ?? "").replace(/\r\n/g, "\n").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

function appendImportedWorkflowSections(renderedTemplate, existingContent, adapterSections = [], adapterData = null) {
  const sections = mergeImportedWorkflowSections(
    collectImportedWorkflowSections(renderedTemplate, existingContent),
    filterRetainedImportedSections(Array.isArray(adapterSections) ? adapterSections : [], adapterData),
    adapterData,
  );
  if (sections.length === 0) {
    return renderedTemplate;
  }
  const normalized = stripImportedExtensionTail(renderedTemplate);
  const lines = [
    normalized,
    "",
    IMPORTED_EXTENSIONS_HEADING,
    "",
    "The sections below were preserved from the previous local adapter because they are not yet modeled by the canonical deterministic template or structured adapter config.",
    "They are compatibility-only and should be migrated out of legacy storage before relying on them as durable adapter policy.",
    "",
    ...sections.flatMap((section) => [section, ""]),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function normalizeRenderedSpacing(text) {
  return String(text ?? "").replace(/\n{3,}/g, "\n\n");
}

export function renderGeneratedDocContent({
  repoRoot,
  targetRoot,
  templateRelative,
  targetRelative,
  templateVars,
  preserveImportedWorkflowExtensions = false,
  existingContentOverride = null,
  workflowAdapterConfig = null,
}) {
  const templatePath = path.resolve(repoRoot, templateRelative);
  const targetPath = path.resolve(targetRoot, targetRelative);
  let rendered = renderTemplateVariables(readUtf8(templatePath), templateVars);
  const unresolved = extractPlaceholders(rendered);
  if (unresolved.length > 0) {
    throw new Error(
      `Unresolved placeholders in generated doc (${normalizeRelativePath(targetRelative)}): ${unresolved.join(", ")}`,
    );
  }
  const existingContent = typeof existingContentOverride === "string"
    ? existingContentOverride
    : (fs.existsSync(targetPath) ? readUtf8(targetPath) : null);
  if (preserveImportedWorkflowExtensions && typeof existingContent === "string") {
      rendered = appendImportedWorkflowSections(
      rendered,
      existingContent,
      workflowAdapterConfig?.data?.legacyPreserved?.importedSections ?? [],
      workflowAdapterConfig?.data ?? null,
    );
  }
  rendered = normalizeRenderedSpacing(rendered);
  return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}

export function renderManagedInstallDocs({
  repoRoot,
  targetRoot,
  dryRun = false,
  templateVars = {},
  existingContentByTarget = {},
  workflowAdapterConfig = null,
}) {
  const results = [];
  for (const item of GENERATED_DOCS) {
    const targetPath = path.resolve(targetRoot, item.targetRelative);
    const targetKey = normalizeRelativePath(item.targetRelative).toLowerCase();
    const content = renderGeneratedDocContent({
      repoRoot,
      targetRoot,
      templateRelative: item.templateRelative,
      targetRelative: item.targetRelative,
      templateVars,
      preserveImportedWorkflowExtensions: item.preserveImportedWorkflowExtensions === true,
      existingContentOverride: existingContentByTarget[targetKey] ?? null,
      workflowAdapterConfig,
    });
    const previous = fs.existsSync(targetPath) ? readUtf8(targetPath) : null;
    const changed = previous !== content;
    if (!dryRun) {
      ensureDir(path.dirname(targetPath), dryRun);
      writeUtf8(targetPath, content, dryRun);
    }
    results.push({
      targetRelative: normalizeRelativePath(item.targetRelative),
      targetPath,
      changed,
      written: !dryRun,
    });
  }
  return results;
}
