function fmt(value) {
  return value == null ? "n/a" : String(value);
}

function iconForStatus(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "pass") {
    return "PASS";
  }
  if (normalized === "warn") {
    return "WARN";
  }
  if (normalized === "fail") {
    return "FAIL";
  }
  return "N/A";
}

export function buildIndexCanonicalCheckSummaryMarkdown(payload) {
  const coverage = payload?.coverage ?? {};
  const summary = payload?.summary ?? {};
  const thresholds = payload?.thresholds ?? {};
  const thresholdSources = thresholds?.sources ?? {};
  const reasonCodes = Array.isArray(payload?.reason_codes) ? payload.reason_codes : [];
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];

  const lines = [];
  lines.push("## Index Canonical Coverage Check");
  lines.push("");
  lines.push(`- Status: ${iconForStatus(summary.overall_status)}`);
  lines.push(`- Coverage markdown: ${fmt(coverage.canonical_coverage_ratio_markdown)} (threshold >= ${fmt(thresholds.min_coverage_markdown)})`);
  lines.push(`- Artifacts with canonical: ${fmt(coverage.artifacts_with_canonical)} (threshold >= ${fmt(thresholds.min_canonical_artifacts)})`);
  lines.push(`- Markdown artifacts: ${fmt(coverage.artifacts_markdown)} (threshold >= ${fmt(thresholds.min_markdown_artifacts)})`);
  lines.push(`- Threshold sources: coverage=${fmt(thresholdSources.min_coverage_markdown)}, canonical=${fmt(thresholdSources.min_canonical_artifacts)}, markdown=${fmt(thresholdSources.min_markdown_artifacts)}`);
  lines.push(`- Target rule warnings: ${reasonCodes.length}`);
  lines.push(`- Blocking checks: ${fmt(summary.blocking)}`);
  lines.push("");

  if (reasonCodes.length > 0) {
    lines.push("### Target Rule Warnings");
    lines.push("");
    for (const code of reasonCodes) {
      lines.push(`- ${code}`);
    }
    lines.push("");
  }

  if (checks.length > 0) {
    lines.push("### Canonical Check Rules");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of checks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${fmt(check.actual)} | ${check.op ?? "n/a"} | ${fmt(check.expected)} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
