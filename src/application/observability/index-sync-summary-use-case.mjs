function fmt(value) {
  if (value == null) {
    return "n/a";
  }
  return String(value);
}

export function buildIndexSyncSummaryMarkdown(payload) {
  const mismatches = Array.isArray(payload?.summary_mismatches) ? payload.summary_mismatches : [];
  const lines = [];
  lines.push("## Index Sync Check");
  lines.push("");
  lines.push(`- In sync: ${payload?.in_sync ? "yes" : "no"}`);
  lines.push(`- Drift level: ${fmt(payload?.drift_level)}`);
  lines.push(`- Reason codes: ${Array.isArray(payload?.reason_codes) && payload.reason_codes.length > 0 ? payload.reason_codes.join(", ") : "none"}`);
  lines.push(`- Action: ${fmt(payload?.action)}`);
  lines.push(`- Expected digest: ${fmt(payload?.expected?.digest)}`);
  lines.push(`- Current digest: ${fmt(payload?.current?.digest)}`);
  lines.push(`- Structure kind (expected): ${fmt(payload?.expected?.summary?.structure_kind)}`);
  lines.push("");

  if (mismatches.length > 0) {
    lines.push("### Drift Mismatches");
    lines.push("");
    lines.push("| key | expected | current |");
    lines.push("|---|---|---|");
    for (const row of mismatches) {
      lines.push(`| ${fmt(row?.key)} | ${fmt(row?.expected)} | ${fmt(row?.current)} |`);
    }
    lines.push("");
  }

  if (payload?.apply_result?.writes) {
    lines.push("### Apply Result");
    lines.push("");
    lines.push(`- Files written: ${fmt(payload.apply_result.writes.files_written_count)}`);
    lines.push(`- Bytes written: ${fmt(payload.apply_result.writes.bytes_written)}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
