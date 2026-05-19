export function buildRuntimeStateMarkdown(digest) {
  const lines = [];
  lines.push("# Runtime State Digest");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- keep runtime-specific operational signals short and easy to reload");
  lines.push("- avoid scattering `dual` / `db-only` runtime facts across multiple hidden files");
  lines.push("- surface whether `CURRENT-STATE.md` still looks trustworthy");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a state digest, not a canonical workflow rules file");
  lines.push("- keep canonical workflow rules in `docs/audit/SPEC.md`");
  lines.push("- keep local policy extensions in `docs/audit/WORKFLOW.md`");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${digest.updated_at}`);
  lines.push(`project_id: ${digest.project_id}`);
  lines.push(`project_id_source: ${digest.project_id_source}`);
  lines.push(`project_root: ${digest.project_root}`);
  lines.push(`workspace_id: ${digest.workspace_id}`);
  lines.push(`worktree_id: ${digest.worktree_id}`);
  lines.push(`runtime_state_mode: ${digest.runtime_state_mode}`);
  lines.push(`repair_layer_status: ${digest.repair_layer_status}`);
  lines.push(`repair_layer_advice: ${digest.repair_layer_advice}`);
  lines.push(`repair_primary_reason: ${digest.repair_primary_reason}`);
  lines.push(`repair_routing_hint: ${digest.repair_routing_hint}`);
  lines.push(`repair_routing_reason: ${digest.repair_routing_reason}`);
  lines.push(`shared_runtime_validation_status: ${digest.shared_runtime_validation_status}`);
  lines.push(`active_backlog: ${digest.active_backlog}`);
  lines.push(`backlog_status: ${digest.backlog_status}`);
  lines.push(`backlog_next_step: ${digest.backlog_next_step}`);
  lines.push(`planning_arbitration_status: ${digest.planning_arbitration_status}`);
  lines.push(`shared_planning_source: ${digest.shared_planning_source}`);
  lines.push(`shared_planning_read_status: ${digest.shared_planning_read_status}`);
  lines.push("");
  lines.push("## Current State Freshness");
  lines.push("");
  lines.push(`current_state_freshness: ${digest.current_state_freshness}`);
  lines.push(`current_state_freshness_basis: ${digest.current_state_freshness_basis}`);
  lines.push("");
  lines.push("Meaning:");
  lines.push("");
  lines.push("- `ok`: `CURRENT-STATE.md` is not older than the active cycle timestamps currently checked");
  lines.push("- `stale`: `CURRENT-STATE.md` is older than the active cycle timestamps currently checked");
  lines.push("- `unknown`: no active cycle, missing timestamps, or freshness not evaluated yet");
  lines.push("");
  lines.push("## Blocking Findings");
  lines.push("");
  lines.push("blocking_findings:");
  if (digest.blocking_findings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of digest.blocking_findings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push("");
  lines.push("## Prioritized Reads");
  lines.push("");
  lines.push("prioritized_artifacts:");
  for (const item of digest.prioritized_artifacts) {
    lines.push(`- \`${item}\``);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(`- Source context file: \`${digest.context_source}\``);
  if (digest.consistency_status === "fail") {
    lines.push("- `CURRENT-STATE.md` consistency check did not fully pass; read the detailed checks before relying on this digest.");
  } else {
    lines.push("- `CURRENT-STATE.md` consistency check passed for the currently evaluated signals.");
  }
  lines.push("- In `files` mode, this digest may remain minimal.");
  lines.push("- In `dual` / `db-only`, refresh this digest whenever runtime hydration or repair-layer triage reveals new blocking facts.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function buildRuntimeStateDigest({
  updatedAt,
  workspace,
  dbBackedMode = false,
  effectiveStateMode = "",
  hydrated = null,
  repairSummary,
  repairPrimaryReason,
  repairRouting,
  sharedRuntimeValidation,
  sharedPlanning,
  freshness,
  blockingFindings = [],
  prioritizedArtifacts = [],
  contextSource = "none",
  consistency,
  currentStateResolution,
  sessionResolution,
  cycleStatusResolution,
} = {}) {
  return {
    updated_at: updatedAt ?? new Date().toISOString(),
    project_id: workspace.project_id,
    project_id_source: workspace.project_id_source,
    project_root: workspace.project_root,
    workspace_id: workspace.workspace_id,
    worktree_id: workspace.worktree_id,
    runtime_state_mode: String(dbBackedMode ? effectiveStateMode : (hydrated?.state_mode ?? "files")),
    repair_layer_status: repairSummary.status,
    repair_layer_advice: repairSummary.advice,
    repair_primary_reason: repairPrimaryReason,
    repair_routing_hint: repairRouting.routing_hint,
    repair_routing_reason: repairRouting.routing_reason,
    shared_runtime_validation_status: sharedRuntimeValidation.status,
    active_backlog: sharedPlanning.active_backlog,
    backlog_status: sharedPlanning.backlog_status,
    backlog_next_step: sharedPlanning.backlog_next_step,
    planning_arbitration_status: sharedPlanning.planning_arbitration_status,
    shared_planning_source: sharedPlanning.shared_planning_source,
    shared_planning_read_status: sharedPlanning.shared_planning_read_status,
    current_state_freshness: freshness.freshness,
    current_state_freshness_basis: freshness.basis,
    blocking_findings: blockingFindings,
    prioritized_artifacts: prioritizedArtifacts,
    context_source: contextSource,
    consistency_status: consistency.pass ? "pass" : "fail",
    current_state_source: currentStateResolution.source,
    session_artifact_source: sessionResolution.source,
    cycle_status_source: cycleStatusResolution.source,
  };
}
