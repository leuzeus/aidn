function fmtPct(value) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export function buildConstraintTrendSummaryMarkdown(report, thresholds = null) {
  const summary = report?.summary ?? {};
  const topConstraints = Array.isArray(summary?.top_constraints) ? summary.top_constraints : [];
  const topActions = Array.isArray(summary?.top_actions) ? summary.top_actions : [];
  const thresholdSummary = thresholds?.summary ?? null;
  const thresholdChecks = Array.isArray(thresholds?.checks) ? thresholds.checks : [];

  const lines = [];
  lines.push("## Constraint Trend");
  lines.push("");
  lines.push(`- Runs analyzed: ${summary?.runs_analyzed ?? 0}`);
  lines.push(`- Dominant constraint: ${summary?.dominant_constraint_skill ?? "n/a"} (${fmtPct(summary?.dominant_constraint_share)})`);
  lines.push(`- Constraint stability rate: ${fmtPct(summary?.constraint_stability_rate)}`);
  lines.push(`- Constraint switches: ${summary?.constraint_switches ?? 0}`);
  lines.push(`- Avg control share of total: ${fmtPct(summary?.avg_control_share_of_total)}`);
  lines.push(`- Avg active constraint share: ${fmtPct(summary?.avg_active_constraint_share)}`);
  lines.push(`- High severity runs: ${summary?.high_severity_runs ?? 0}`);
  lines.push(`- Quick-win top-action runs: ${summary?.quick_win_top_runs ?? 0}`);
  if (thresholdSummary != null) {
    lines.push(`- Threshold status: ${thresholdSummary.overall_status ?? "n/a"} (${thresholdSummary.pass ?? 0} pass, ${thresholdSummary.fail ?? 0} fail, ${thresholdSummary.blocking ?? 0} blocking)`);
  }
  lines.push("");

  if (topConstraints.length > 0) {
    lines.push("### Top Constraints");
    lines.push("");
    lines.push("| skill | count |");
    lines.push("|---|---:|");
    for (const row of topConstraints) {
      lines.push(`| ${row.skill ?? "n/a"} | ${row.count ?? 0} |`);
    }
    lines.push("");
  }

  if (topActions.length > 0) {
    lines.push("### Top Actions");
    lines.push("");
    lines.push("| action_id | count |");
    lines.push("|---|---:|");
    for (const row of topActions) {
      lines.push(`| ${row.action_id ?? "n/a"} | ${row.count ?? 0} |`);
    }
    lines.push("");
  }

  if (thresholdChecks.length > 0) {
    lines.push("### Trend Threshold Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of thresholdChecks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.actual ?? "n/a"} | ${check.op ?? "n/a"} | ${check.expected ?? "n/a"} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
