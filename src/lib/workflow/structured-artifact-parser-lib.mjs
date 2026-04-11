import path from "node:path";

function normalizeScalar(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("`") && normalized.endsWith("`") && normalized.length >= 2) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function normalizeKey(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractIds(values, prefix) {
  const joined = Array.isArray(values) ? values.join(" ") : String(values ?? "");
  const pattern = new RegExp(`\\b(${prefix}[0-9]+)\\b`, "gi");
  const matches = joined.match(pattern) ?? [];
  return Array.from(new Set(matches.map((item) => String(item).toUpperCase())))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

function sectionKeyFromHeading(text) {
  return normalizeKey(String(text ?? "").replace(/[^\p{L}\p{N}_ -]/gu, ""));
}

function normalizeInlineMarkdown(text) {
  let normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const rewrites = [
    [/([^\n])\s{2,}(#{1,6}\s+)/gu, "$1\n\n$2"],
    [/(:)\s{2,}(-\s+)/gu, "$1\n$2"],
    [/([^\n])\s{2,}(-\s+\[[ xX]\]\s+)/gu, "$1\n$2"],
    [/([^\n])\s{2,}(-\s+[A-Za-z_][A-Za-z0-9_ ]{0,80}:\s+)/gu, "$1\n$2"],
    [/([^\n])\s{2,}([A-Za-z_][A-Za-z0-9_ ]{1,80}:\s+)/gu, "$1\n$2"],
    [/([^\n])\s{2,}(\d+[.)]\s+)/gu, "$1\n$2"],
  ];
  for (let pass = 0; pass < 4; pass += 1) {
    let next = normalized;
    for (const [pattern, replacement] of rewrites) {
      next = next.replace(pattern, replacement);
    }
    if (next === normalized) {
      break;
    }
    normalized = next;
  }
  return normalized.trim();
}

function extractFieldBlock(text, fieldName) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const pattern = new RegExp(
    `(?:^|\\n|\\s+-\\s+)(?:#{1,6}[^\\n]*?\\s+-\\s+)?(?:[-*]\\s+)?${escapeRegExp(fieldName)}:\\s*([\\s\\S]*?)(?=(?:\\s+-\\s+[A-Za-z_][A-Za-z0-9_ ]{0,80}:\\s*)|(?:\\n#{2,6}\\s+)|(?:\\n(?:#{1,6}[^\\n]*?\\s+-\\s+)?(?:[-*]\\s+)?[A-Za-z_][A-Za-z0-9_ ]{0,80}:\\s*)|$)`,
    "i",
  );
  const match = text.match(pattern);
  return match ? String(match[1] ?? "").trim() : null;
}

function hasStructuredField(text, fieldName) {
  return extractFieldBlock(text, fieldName) != null;
}

function extractStructuredScalarField(text, fieldName) {
  const block = extractFieldBlock(text, fieldName);
  if (block == null) {
    return null;
  }
  const firstLine = block
    .split("\n")
    .map((line) => normalizeScalar(line))
    .find((line) => line.length > 0 && !line.startsWith("- "));
  return firstLine ? normalizeScalar(firstLine) : "";
}

function splitInlineBulletItems(value) {
  const items = [];
  const line = String(value ?? "").trim();
  if (!line) {
    return items;
  }
  const pattern = /(?:^|\s)-\s+(.+?)(?=(?:\s+-\s+)|$)/g;
  for (const match of line.matchAll(pattern)) {
    const item = normalizeScalar(match[1]);
    if (item) {
      items.push(item);
    }
  }
  if (items.length > 0) {
    return items;
  }
  return [line];
}

function extractStructuredListField(text, fieldName) {
  const block = extractFieldBlock(text, fieldName);
  if (block == null) {
    return [];
  }
  const items = [];
  for (const rawLine of String(block).split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("- ")) {
      items.push(...splitInlineBulletItems(line));
      continue;
    }
    items.push(normalizeScalar(line));
  }
  return Array.from(new Set(items.map((item) => normalizeScalar(item)).filter((item) => item && !canonicalNone(item))));
}

function parseStructuredSections(normalizedText) {
  const sections = [];
  let current = null;
  const lines = String(normalizedText ?? "").split("\n");
  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (current) {
        sections.push({
          level: current.level,
          text: current.text,
          key: current.key,
          line_count: current.lines.length,
          first_content_line: current.lines.find((item) => item.trim().length > 0) ?? null,
        });
      }
      current = {
        level: headingMatch[1].length,
        text: String(headingMatch[2] ?? "").trim(),
        key: sectionKeyFromHeading(headingMatch[2]),
        lines: [],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    current.lines.push(line);
  }
  if (current) {
    sections.push({
      level: current.level,
      text: current.text,
      key: current.key,
      line_count: current.lines.length,
      first_content_line: current.lines.find((item) => item.trim().length > 0) ?? null,
    });
  }
  return sections;
}

function parseHeadings(normalizedText) {
  const headings = [];
  for (const line of String(normalizedText ?? "").split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({ level: match[1].length, text: String(match[2] ?? "").trim() });
    }
  }
  return headings;
}

function parseKeyValues(normalizedText) {
  const out = {};
  for (const line of String(normalizedText ?? "").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    out[normalizeKey(match[1])] = normalizeScalar(match[2]);
  }
  return out;
}

function parseChecklist(normalizedText) {
  let total = 0;
  let checked = 0;
  for (const line of String(normalizedText ?? "").split("\n")) {
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

function extractSessionMode(text) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const headingMode = text.match(/^##\s+WORK MODE\s*-\s*(COMMITTING|EXPLORING|THINKING)\b/im);
  if (headingMode) {
    return String(headingMode[1]).toUpperCase();
  }
  if (/\[\s*x\s*\]\s*COMMITTING/i.test(text)) return "COMMITTING";
  if (/\[\s*x\s*\]\s*EXPLORING/i.test(text)) return "EXPLORING";
  if (/\[\s*x\s*\]\s*THINKING/i.test(text)) return "THINKING";
  return null;
}

function extractSectionCheckbox(normalizedText, headingText) {
  const inlinePattern = new RegExp(`${escapeRegExp(headingText)}\\s*-\\s*\\[(x| )\\]\\s*Yes`, "i");
  const inlineMatch = String(normalizedText ?? "").match(inlinePattern);
  if (inlineMatch) {
    return String(inlineMatch[1]).toLowerCase() === "x";
  }
  const lines = String(normalizedText ?? "").split("\n");
  let active = false;
  for (const line of lines) {
    if (line.trim().toLowerCase() === headingText.trim().toLowerCase()) {
      active = true;
      continue;
    }
    if (active && /^###\s+/.test(line)) {
      break;
    }
    if (!active) {
      continue;
    }
    const match = line.match(/^\s*-\s*\[(x| )\]\s*Yes\s*$/i);
    if (match) {
      return String(match[1]).toLowerCase() === "x";
    }
  }
  return null;
}

function parseSessionArtifactContext(normalizedText) {
  const integrationTargetCycles = extractIds(extractStructuredListField(normalizedText, "integration_target_cycles"), "C");
  const attachedCycles = extractIds(extractStructuredListField(normalizedText, "attached_cycles"), "C");
  const reportedCycles = extractIds(extractStructuredListField(normalizedText, "reported_from_previous_session"), "C");
  const primaryFocusCycle = extractIds(extractStructuredScalarField(normalizedText, "primary_focus_cycle") ?? "", "C").at(0) ?? null;
  const legacyIntegrationTargetCycles = extractIds(extractStructuredScalarField(normalizedText, "integration_target_cycle") ?? "", "C");
  const effectiveIntegrationTargets = integrationTargetCycles.length > 0
    ? integrationTargetCycles
    : legacyIntegrationTargetCycles;
  const cycleBranch = extractStructuredScalarField(normalizedText, "cycle_branch");
  const intermediateBranch = extractStructuredScalarField(normalizedText, "intermediate_branch");
  return {
    mode: extractSessionMode(normalizedText),
    session_branch: extractStructuredScalarField(normalizedText, "session_branch"),
    parent_session: extractStructuredScalarField(normalizedText, "parent_session"),
    branch_kind: extractStructuredScalarField(normalizedText, "branch_kind"),
    cycle_branch: cycleBranch,
    intermediate_branch: intermediateBranch,
    integration_target_cycle: effectiveIntegrationTargets.length === 1 ? effectiveIntegrationTargets[0] : null,
    integration_target_cycles: effectiveIntegrationTargets,
    integration_target_cycles_declared: hasStructuredField(normalizedText, "integration_target_cycles"),
    primary_focus_cycle: primaryFocusCycle,
    legacy_integration_target_cycle: extractStructuredScalarField(normalizedText, "integration_target_cycle"),
    legacy_multi_target_scalar: integrationTargetCycles.length === 0 && legacyIntegrationTargetCycles.length > 1,
    attached_cycles: attachedCycles,
    reported_from_previous_session: reportedCycles,
    reported_cycles: reportedCycles,
    branch_cycles: extractIds([cycleBranch, intermediateBranch].filter(Boolean), "C"),
    carry_over_pending: extractStructuredScalarField(normalizedText, "carry_over_pending"),
    pr_status: extractStructuredScalarField(normalizedText, "pr_status"),
    pr_url: canonicalNone(extractStructuredScalarField(normalizedText, "pr_url")) ? null : extractStructuredScalarField(normalizedText, "pr_url"),
    pr_number: canonicalNone(extractStructuredScalarField(normalizedText, "pr_number")) ? null : extractStructuredScalarField(normalizedText, "pr_number"),
    pr_base_branch: canonicalNone(extractStructuredScalarField(normalizedText, "pr_base_branch")) ? null : extractStructuredScalarField(normalizedText, "pr_base_branch"),
    pr_head_branch: canonicalNone(extractStructuredScalarField(normalizedText, "pr_head_branch")) ? null : extractStructuredScalarField(normalizedText, "pr_head_branch"),
    pr_review_status: extractStructuredScalarField(normalizedText, "pr_review_status"),
    post_merge_sync_status: extractStructuredScalarField(normalizedText, "post_merge_sync_status"),
    post_merge_sync_basis: canonicalNone(extractStructuredScalarField(normalizedText, "post_merge_sync_basis"))
      ? null
      : extractStructuredScalarField(normalizedText, "post_merge_sync_basis"),
    close_gate_satisfied: extractSectionCheckbox(normalizedText, "### Session close gate satisfied?"),
    snapshot_updated: extractSectionCheckbox(normalizedText, "### Snapshot updated?"),
  };
}

const RUNTIME_ROOT_FILES = new Set([
  "CURRENT-STATE.md",
  "RUNTIME-STATE.md",
  "HANDOFF-PACKET.md",
  "AGENT-ROSTER.md",
  "AGENT-HEALTH-SUMMARY.md",
  "AGENT-SELECTION-SUMMARY.md",
  "MULTI-AGENT-STATUS.md",
  "COORDINATION-SUMMARY.md",
]);

function isRuntimeRootArtifact(options = {}) {
  const relativePath = String(options.relativePath ?? "").replace(/\\/g, "/");
  if (relativePath && !relativePath.includes("/") && RUNTIME_ROOT_FILES.has(path.basename(relativePath))) {
    return true;
  }
  const subtype = normalizeKey(options.classification?.subtype ?? options.subtype ?? "");
  return [
    "current_state",
    "runtime_state",
    "handoff_packet",
    "agent_roster",
    "agent_health_summary",
    "agent_selection_summary",
    "multi_agent_status",
    "coordination_summary",
  ].includes(subtype);
}

function parseRuntimeArtifactContext(normalizedText, options = {}) {
  if (!isRuntimeRootArtifact(options)) {
    return null;
  }
  const keyValues = parseKeyValues(normalizedText);
  const valueOrNull = (key) => {
    const value = normalizeScalar(keyValues[key] ?? "");
    if (!value || canonicalNone(value) || canonicalUnknown(value)) {
      return null;
    }
    return value;
  };
  return {
    active_session: valueOrNull("active_session"),
    active_cycle: valueOrNull("active_cycle"),
    session_branch: valueOrNull("session_branch"),
    branch_kind: valueOrNull("branch_kind"),
    mode: valueOrNull("mode"),
    dor_state: valueOrNull("dor_state"),
    runtime_state_mode: valueOrNull("runtime_state_mode"),
    repair_layer_status: valueOrNull("repair_layer_status"),
    repair_primary_reason: valueOrNull("repair_primary_reason"),
    repair_routing_hint: valueOrNull("repair_routing_hint"),
    current_state_freshness: valueOrNull("current_state_freshness"),
    prioritized_artifacts: extractStructuredListField(normalizedText, "prioritized_artifacts"),
    blocking_findings: extractStructuredListField(normalizedText, "blocking_findings"),
  };
}

export function normalizeStructuredMarkdown(text) {
  return normalizeInlineMarkdown(text);
}

export function parseStructuredMarkdownMap(text) {
  return parseKeyValues(normalizeStructuredMarkdown(text));
}

export function extractStructuredField(text, fieldName) {
  return extractStructuredScalarField(normalizeStructuredMarkdown(text), fieldName);
}

export function extractStructuredList(text, fieldName) {
  return extractStructuredListField(normalizeStructuredMarkdown(text), fieldName);
}

export function hasStructuredMarkdownField(text, fieldName) {
  return hasStructuredField(normalizeStructuredMarkdown(text), fieldName);
}

export function inspectStructuredField(text, fieldName) {
  const normalizedText = normalizeStructuredMarkdown(text);
  const block = extractFieldBlock(normalizedText, fieldName);
  if (block == null) {
    return {
      present: false,
      field_name: fieldName,
      style: null,
      scalar: null,
      list_items: [],
      raw_block: null,
      line_count: 0,
    };
  }
  const lines = String(block)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const bulletLineCount = lines.filter((line) => line.startsWith("- ")).length;
  const style = bulletLineCount === 0
    ? "scalar"
    : (bulletLineCount === lines.length ? "list" : "mixed");
  return {
    present: true,
    field_name: fieldName,
    style,
    scalar: extractStructuredScalarField(normalizedText, fieldName),
    list_items: extractStructuredListField(normalizedText, fieldName),
    raw_block: String(block),
    line_count: lines.length,
  };
}

export function analyzeStructuredArtifact(content, options = {}) {
  const normalizedText = normalizeStructuredMarkdown(content);
  return {
    normalized_text: normalizedText,
    headings: parseHeadings(normalizedText),
    key_values: parseKeyValues(normalizedText),
    checklist: parseChecklist(normalizedText),
    structured_sections: parseStructuredSections(normalizedText),
    derived_session_context: options.classification?.kind === "session" || normalizeKey(options.classification?.subtype ?? "") === "session"
      ? parseSessionArtifactContext(normalizedText)
      : null,
    derived_runtime_context: parseRuntimeArtifactContext(normalizedText, options),
  };
}
