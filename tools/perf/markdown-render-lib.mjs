import path from "node:path";

function normalizeKey(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function parseKeyValues(lines) {
  const out = {};
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = normalizeKey(match[1]);
    if (!key) {
      continue;
    }
    out[key] = String(match[2] ?? "").trim();
  }
  return out;
}

function parseHeadings(lines) {
  const out = [];
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) {
      continue;
    }
    out.push({
      level: match[1].length,
      text: String(match[2] ?? "").trim(),
    });
  }
  return out;
}

function parseChecklist(lines) {
  let total = 0;
  let checked = 0;
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+/);
    if (!match) {
      continue;
    }
    total += 1;
    if (String(match[1]).toLowerCase() === "x") {
      checked += 1;
    }
  }
  return { total, checked };
}

function inferArtifactClass(relativePath, classification = {}) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/");
  const kind = String(classification.kind ?? "");
  const family = String(classification.family ?? "unknown");
  const subtype = String(classification.subtype ?? "unknown");

  if (kind === "cycle_status" || subtype === "status") {
    return "status";
  }
  if (kind === "session" || subtype === "session") {
    return "session";
  }
  if (normalized.startsWith("cycles/")) {
    return family === "normative" ? "cycle_normative" : "cycle_support";
  }
  if (normalized.startsWith("baseline/")) {
    return "baseline";
  }
  if (normalized.startsWith("snapshots/")) {
    return "snapshot";
  }
  if (kind === "workflow") {
    return "workflow";
  }
  if (kind === "spec") {
    return "spec";
  }
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
  const headings = parseHeadings(lines);
  const keyValues = parseKeyValues(lines);
  const checklist = parseChecklist(lines);

  return {
    schema_version: 1,
    format: "markdown-canonical-v1",
    artifact_class: inferArtifactClass(relPath, options.classification ?? {}),
    title: firstTitle(lines, basename || "artifact"),
    headings,
    key_values: keyValues,
    checklist,
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
    return [
      "## Key Values",
      "",
      "- none",
      "",
    ];
  }
  const lines = [
    "## Key Values",
    "",
    "| key | value |",
    "|---|---|",
  ];
  for (const key of keys) {
    const value = String(keyValues[key] ?? "").replace(/\|/g, "\\|");
    lines.push(`| ${key} | ${value} |`);
  }
  lines.push("");
  return lines;
}

function renderHeadings(headings) {
  if (!Array.isArray(headings) || headings.length === 0) {
    return [
      "## Headings",
      "",
      "- none",
      "",
    ];
  }
  const lines = [
    "## Headings",
    "",
  ];
  for (const item of headings) {
    const level = Number(item?.level ?? 0);
    const text = String(item?.text ?? "").trim();
    if (!text) {
      continue;
    }
    lines.push(`- h${Number.isFinite(level) && level > 0 ? level : "?"}: ${text}`);
  }
  lines.push("");
  return lines;
}

export function renderMarkdownFromCanonical(canonical, artifact = {}) {
  const title = String(canonical?.title ?? path.basename(String(artifact?.path ?? "artifact.md"), path.extname(String(artifact?.path ?? "artifact.md"))) ?? "artifact");
  const className = String(canonical?.artifact_class ?? "support");
  const lines = [
    `# ${title}`,
    "",
    "<!-- aidn:generated-from-canonical -->",
    "",
    "## Artifact Metadata",
    "",
    `- path: \`${String(artifact?.path ?? "")}\``,
    `- kind: \`${String(artifact?.kind ?? "other")}\``,
    `- family: \`${String(artifact?.family ?? "unknown")}\``,
    `- subtype: \`${String(artifact?.subtype ?? "unknown")}\``,
    `- class: \`${className}\``,
    `- gate_relevance: \`${String(artifact?.gate_relevance ?? 0)}\``,
    "",
  ];

  lines.push(...renderKeyValuesTable(canonical?.key_values ?? {}));
  lines.push(...renderHeadings(canonical?.headings ?? []));
  lines.push(
    "## Checklist",
    "",
    `- checked: ${Number(canonical?.checklist?.checked ?? 0)}`,
    `- total: ${Number(canonical?.checklist?.total ?? 0)}`,
    "",
    "## Notes",
    "",
    "- This Markdown file is a deterministic projection generated from canonical workflow state.",
    "",
  );

  return `${lines.join("\n")}`;
}
