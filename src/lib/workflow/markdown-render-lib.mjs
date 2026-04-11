import path from "node:path";
import { analyzeStructuredArtifact } from "./structured-artifact-parser-lib.mjs";
import { validateCriticalMarkdownContract } from "./markdown-contract-registry-lib.mjs";

const GENERATED_MARKER = "aidn:generated-from-canonical";
const MANAGED_BLOCK_IDS = ["artifact_metadata", "key_values", "headings", "checklist", "notes"];

function inferArtifactClass(relativePath, classification = {}) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/");
  const kind = String(classification.kind ?? "");
  const family = String(classification.family ?? "unknown");
  const subtype = String(classification.subtype ?? "unknown");
  if (kind === "cycle_status" || subtype === "status") return "status";
  if (kind === "session" || subtype === "session") return "session";
  if (normalized.startsWith("cycles/")) return family === "normative" ? "cycle_normative" : "cycle_support";
  if (normalized.startsWith("baseline/")) return "baseline";
  if (normalized.startsWith("snapshots/")) return "snapshot";
  if (kind === "workflow") return "workflow";
  if (kind === "spec") return "spec";
  return family === "normative" ? "normative" : "support";
}

function firstTitle(lines, fallback) {
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      return String(match[1]).trim();
    }
  }
  return fallback;
}

export function buildCanonicalFromMarkdown(content, options = {}) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const relPath = String(options.relativePath ?? "");
  const basename = path.basename(relPath || "artifact.md", path.extname(relPath || "artifact.md"));
  const analysis = analyzeStructuredArtifact(normalized, options);
  const contract = validateCriticalMarkdownContract(normalized, {
    ...options,
    analysis,
  });
  const normalizedLines = String(analysis.normalized_text ?? normalized).split("\n");
  return {
    schema_version: 1,
    format: "markdown-canonical-v1",
    artifact_class: inferArtifactClass(relPath, options.classification ?? {}),
    title: firstTitle(normalizedLines, basename || "artifact"),
    headings: analysis.headings,
    key_values: analysis.key_values,
    checklist: analysis.checklist,
    structured_sections: analysis.structured_sections,
    derived_runtime_context: analysis.derived_runtime_context,
    derived_session_context: analysis.derived_session_context,
    ...(contract ? {
      contract_version: contract.contract_version,
      contract_status: contract.contract_status,
      contract_findings: contract.contract_findings,
      legacy_shape_id: contract.legacy_shape_id,
    } : {}),
    stats: {
      line_count: lines.length,
      non_empty_line_count: lines.filter((line) => line.trim().length > 0).length,
      char_count: normalized.length,
    },
  };
}

function renderKeyValuesTable(keyValues) {
  const keys = Object.keys(keyValues ?? {}).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    return ["## Key Values", "", "- none", ""];
  }
  const lines = ["## Key Values", "", "| key | value |", "|---|---|"];
  for (const key of keys) {
    const value = String(keyValues[key] ?? "").replace(/\|/g, "\\|");
    lines.push(`| ${key} | ${value} |`);
  }
  lines.push("");
  return lines;
}

function renderHeadings(headings) {
  if (!Array.isArray(headings) || headings.length === 0) {
    return ["## Headings", "", "- none", ""];
  }
  const lines = ["## Headings", ""];
  for (const item of headings) {
    const level = Number(item?.level ?? 0);
    const text = String(item?.text ?? "").trim();
    if (text) {
      lines.push(`- h${Number.isFinite(level) && level > 0 ? level : "?"}: ${text}`);
    }
  }
  lines.push("");
  return lines;
}

function blockStart(id) {
  return `<!-- aidn:block:${id}:start -->`;
}

function blockEnd(id) {
  return `<!-- aidn:block:${id}:end -->`;
}

function renderManagedBlock(id, lines) {
  return [blockStart(id), ...lines, blockEnd(id), ""];
}

function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderBlocks(canonical, artifact, className) {
  return {
    artifact_metadata: [
      "## Artifact Metadata",
      "",
      `- path: \`${String(artifact?.path ?? "")}\``,
      `- kind: \`${String(artifact?.kind ?? "other")}\``,
      `- family: \`${String(artifact?.family ?? "unknown")}\``,
      `- subtype: \`${String(artifact?.subtype ?? "unknown")}\``,
      `- class: \`${className}\``,
      `- gate_relevance: \`${String(artifact?.gate_relevance ?? 0)}\``,
      "",
    ],
    key_values: renderKeyValuesTable(canonical?.key_values ?? {}),
    headings: renderHeadings(canonical?.headings ?? []),
    checklist: [
      "## Checklist",
      "",
      `- checked: ${Number(canonical?.checklist?.checked ?? 0)}`,
      `- total: ${Number(canonical?.checklist?.total ?? 0)}`,
      "",
    ],
    notes: [
      "## Notes",
      "",
      "- This Markdown file is a deterministic projection generated from canonical workflow state.",
      "",
    ],
  };
}

function blockText(id, lines) {
  return `${blockStart(id)}\n${lines.join("\n")}\n${blockEnd(id)}`;
}

function applyTitle(text, title) {
  const value = normalizeNewlines(text);
  if (value.startsWith("# ")) {
    const newlineIndex = value.indexOf("\n");
    if (newlineIndex < 0) {
      return `# ${title}\n`;
    }
    return `# ${title}${value.slice(newlineIndex)}`;
  }
  return `# ${title}\n\n${value}`;
}

function upsertManagedBlock(text, id, lines) {
  const start = blockStart(id);
  const end = blockEnd(id);
  const nextBlock = blockText(id, lines);
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
  if (pattern.test(text)) {
    return text.replace(pattern, nextBlock);
  }
  return `${text.trimEnd()}\n\n${nextBlock}\n`;
}

export function renderMarkdownFromCanonical(canonical, artifact = {}) {
  const title = String(canonical?.title ?? path.basename(String(artifact?.path ?? "artifact.md"), path.extname(String(artifact?.path ?? "artifact.md"))) ?? "artifact");
  const className = String(canonical?.artifact_class ?? "support");
  const blocks = renderBlocks(canonical, artifact, className);
  const lines = [`# ${title}`, "", `<!-- ${GENERATED_MARKER} -->`, ""];
  for (const id of MANAGED_BLOCK_IDS) {
    lines.push(...renderManagedBlock(id, blocks[id] ?? []));
  }
  return `${lines.join("\n")}\n`;
}

export function renderOrMergeCanonicalMarkdown(canonical, artifact = {}, existingContent = null) {
  if (typeof existingContent !== "string" || existingContent.trim().length === 0) {
    return { mode: "full", content: renderMarkdownFromCanonical(canonical, artifact) };
  }
  const normalizedExisting = normalizeNewlines(existingContent);
  if (!normalizedExisting.includes(`<!-- ${GENERATED_MARKER} -->`)) {
    return { mode: "full", content: renderMarkdownFromCanonical(canonical, artifact) };
  }
  const title = String(canonical?.title ?? path.basename(String(artifact?.path ?? "artifact.md"), path.extname(String(artifact?.path ?? "artifact.md"))) ?? "artifact");
  const className = String(canonical?.artifact_class ?? "support");
  const blocks = renderBlocks(canonical, artifact, className);
  let next = applyTitle(normalizedExisting, title);
  for (const id of MANAGED_BLOCK_IDS) {
    next = upsertManagedBlock(next, id, blocks[id] ?? []);
  }
  return { mode: "incremental", content: `${next.trimEnd()}\n` };
}
