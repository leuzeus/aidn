function buildCoordinationLogEntry(result) {
  const ts = new Date().toISOString();
  const lines = [];
  lines.push(`## Dispatch ${ts}`);
  lines.push("");
  lines.push(`timestamp: ${ts}`);
  lines.push(`selected_agent: ${result.selected_agent.id}`);
  lines.push(`recommended_role: ${result.coordinator_recommendation.role}`);
  lines.push(`recommended_action: ${result.coordinator_recommendation.action}`);
  lines.push(`dispatch_status: ${result.dispatch_status}`);
  lines.push(`execution_status: ${result.execution_status}`);
  lines.push(`entrypoint: ${result.entrypoint_kind}:${result.entrypoint_name}`);
  lines.push(`goal: ${result.coordinator_recommendation.goal}`);
  lines.push(`preferred_dispatch_source: ${result.preferred_dispatch_source ?? "workflow"}`);
  if (result.shared_planning_candidate?.candidate_ready) {
    lines.push(`shared_planning_candidate: ${result.shared_planning_candidate.next_dispatch_scope} + ${result.shared_planning_candidate.next_dispatch_action}`);
  }
  lines.push("");
  lines.push("notes:");
  if (Array.isArray(result.notes) && result.notes.length > 0) {
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("executed_steps:");
  if (Array.isArray(result.executed_steps) && result.executed_steps.length > 0) {
    for (const step of result.executed_steps) {
      lines.push(`- ${step.label}: exit=${step.exit_code} ok=${step.ok ? "yes" : "no"}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildCoordinationHistoryEvent(result) {
  return {
    ts: new Date().toISOString(),
    event: "coordinator_dispatch",
    selected_agent: result.selected_agent.id,
    recommended_role: result.coordinator_recommendation.role,
    recommended_action: result.coordinator_recommendation.action,
    goal: result.coordinator_recommendation.goal,
    dispatch_status: result.dispatch_status,
    execution_status: result.execution_status,
    entrypoint_kind: result.entrypoint_kind,
    entrypoint_name: result.entrypoint_name,
    preferred_dispatch_source: result.preferred_dispatch_source ?? "workflow",
    shared_planning_candidate_ready: Boolean(result.shared_planning_candidate?.candidate_ready),
    shared_planning_candidate_aligned: Boolean(result.shared_planning_candidate?.candidate_aligned),
    shared_planning_next_dispatch_scope: result.shared_planning_candidate?.next_dispatch_scope ?? "none",
    shared_planning_next_dispatch_action: result.shared_planning_candidate?.next_dispatch_action ?? "none",
    stop_required: Boolean(result.coordinator_recommendation.stop_required),
    executed: Boolean(result.executed),
    executed_steps: Array.isArray(result.executed_steps)
      ? result.executed_steps.map((step) => ({
        label: step.label,
        exit_code: step.exit_code,
        ok: Boolean(step.ok),
      }))
      : [],
  };
}

export {
  buildCoordinationHistoryEvent,
  buildCoordinationLogEntry,
};
