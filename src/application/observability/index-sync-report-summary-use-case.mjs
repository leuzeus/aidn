function fmt(value, digits = 3) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return Number(value).toFixed(digits);
}

export function buildIndexSyncReportSummaryMarkdown(report, thresholds = null) {
  const summary = report?.summary ?? {};
  const thresholdStatus = thresholds?.summary?.overall_status ?? "not-generated";
  const checks = Array.isArray(thresholds?.checks) ? thresholds.checks : [];
  const topKeys = Array.isArray(summary.top_mismatch_keys) ? summary.top_mismatch_keys : [];
  const topReasonCodes = Array.isArray(summary.top_reason_codes) ? summary.top_reason_codes : [];

  const lines = [];
  lines.push("## Index Sync Trend");
  lines.push("");
  lines.push(`- Runs analyzed: ${summary.runs_analyzed ?? 0}`);
  lines.push(`- In-sync runs: ${summary.in_sync_runs ?? 0}`);
  lines.push(`- Drift runs: ${summary.drift_runs ?? 0}`);
  lines.push(`- Applied runs: ${summary.applied_runs ?? 0}`);
  lines.push(`- High-drift runs: ${summary.high_drift_runs ?? 0}`);
  lines.push(`- In-sync rate: ${fmt(summary.in_sync_rate)}`);
  lines.push(`- Avg mismatch count: ${fmt(summary.avg_mismatch_count, 2)}`);
  lines.push(`- Threshold status: ${thresholdStatus}`);
  lines.push("");

  if (topReasonCodes.length > 0) {
    lines.push("### Top Reason Codes");
    lines.push("");
    lines.push("| code | count |");
    lines.push("|---|---:|");
    for (const row of topReasonCodes) {
      lines.push(`| ${row.code ?? "n/a"} | ${row.count ?? 0} |`);
    }
    lines.push("");
  }

  if (topKeys.length > 0) {
    lines.push("### Top Mismatch Keys");
    lines.push("");
    lines.push("| key | count |");
    lines.push("|---|---:|");
    for (const row of topKeys) {
      lines.push(`| ${row.key ?? "n/a"} | ${row.count ?? 0} |`);
    }
    lines.push("");
  }

  if (checks.length > 0) {
    lines.push("### Sync Threshold Checks");
    lines.push("");
    lines.push("| id | status | severity | actual | op | expected |");
    lines.push("|---|---|---|---:|---|---:|");
    for (const check of checks) {
      lines.push(`| ${check.id ?? "n/a"} | ${check.status ?? "n/a"} | ${check.severity ?? "n/a"} | ${check.actual ?? "n/a"} | ${check.op ?? "n/a"} | ${check.expected ?? "n/a"} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
