function renderRepairStep(step) {
  if (!step || typeof step !== "object") {
    return null;
  }
  if (step.kind === "query" && step.command) {
    return `- Query: \`${step.command}\``;
  }
  if (step.kind === "autofix_safe_only" && step.command) {
    return `- Safe autofix: \`${step.command}\``;
  }
  if (step.kind === "resolve" && Array.isArray(step.commands) && step.commands.length > 0) {
    const commands = step.commands
      .slice(0, 3)
      .map((command) => `\`${command.accept}\``)
      .join(", ");
    return `- Resolve candidates: ${commands}`;
  }
  return null;
}

export function buildRepairLayerTriageSummaryMarkdown(triage, topLimit = 10) {
  const summary = triage?.summary ?? {};
  const items = Array.isArray(triage?.items) ? triage.items.slice(0, topLimit) : [];
  const severityCounts = summary?.severity_counts ?? {};
  const lines = [];
  lines.push("## Repair Layer Triage");
  lines.push("");
  lines.push(`- Open findings: ${summary?.open_findings_count ?? 0}`);
  lines.push(`- Actionable findings: ${summary?.actionable_count ?? 0}`);
  lines.push(`- Severity counts: error=${severityCounts.error ?? 0}, warning=${severityCounts.warning ?? 0}, info=${severityCounts.info ?? 0}`);
  lines.push("");
  if (items.length === 0) {
    lines.push("No open repair findings.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const item of items) {
    lines.push(`### ${item.finding_type ?? "UNKNOWN"}${item.entity_id ? ` ${item.entity_id}` : ""}`);
    lines.push("");
    lines.push(`- Severity: ${item.severity ?? "n/a"}`);
    lines.push(`- Confidence: ${item.confidence ?? "n/a"}`);
    if (item.artifact_path) {
      lines.push(`- Artifact: ${item.artifact_path}`);
    }
    if (item.message) {
      lines.push(`- Message: ${item.message}`);
    }
    if (item.suggested_action) {
      lines.push(`- Suggested action: ${item.suggested_action}`);
    }
    if (Array.isArray(item.next_steps) && item.next_steps.length > 0) {
      lines.push("- Next steps:");
      for (const step of item.next_steps) {
        const rendered = renderRepairStep(step);
        if (rendered) {
          lines.push(`  ${rendered}`);
        }
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
