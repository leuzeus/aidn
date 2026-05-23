function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function uniqueItems(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeScalar(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function quoteArg(value) {
  return `"${String(value ?? "").replace(/"/g, '\\"')}"`;
}

function buildCommandLine(command, args) {
  return `${command} ${args.map((item) => (/\s/.test(item) ? quoteArg(item) : item)).join(" ")}`.trim();
}

function buildStep(command, args, label, platform = process.platform) {
  const executable = platform === "win32" && command === "npx" ? "npx.cmd" : command;
  return {
    label,
    command: executable,
    args,
    command_line: buildCommandLine(command, args),
  };
}

function deriveModeForInvocation(contextMode) {
  const normalized = String(contextMode ?? "").trim().toUpperCase();
  if (!normalized || normalized === "UNKNOWN") {
    return "THINKING";
  }
  return normalized;
}

function summarizeList(items, limit = 2) {
  const values = uniqueItems(items);
  if (values.length === 0) {
    return "";
  }
  const visible = values.slice(0, limit);
  if (values.length > limit) {
    visible.push(`+${values.length - limit} more`);
  }
  return visible.join("; ");
}

function summarizeAddenda(addenda, limit = 2) {
  const values = Array.isArray(addenda) ? addenda.slice(-limit) : [];
  return values
    .map((item) => {
      const agentRole = normalizeScalar(item?.agent_role) || "unknown";
      const rationale = normalizeScalar(item?.rationale) || "planning update";
      return `${agentRole}: ${rationale}`;
    })
    .join("; ");
}

function normalizeDecision(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveAppliedIntegrationDecision(loopState) {
  if (!loopState?.loop?.history?.arbitration_applied) {
    return null;
  }
  const decision = normalizeDecision(loopState.loop.history.last_arbitration?.decision ?? "");
  if (["integration_cycle", "report_forward", "rework_from_example"].includes(decision)) {
    return decision;
  }
  return null;
}

export function buildCoordinatorRecommendedRoleCoverage({ recommendation, adapters, rosterVerification, roster, adapterHealth }) {
  const role = recommendation.role;
  const summary = {
    ready: 0,
    degraded: 0,
    unavailable: 0,
    disabled: 0,
    unknown: 0,
  };
  const counted = new Set();
  for (const adapter of adapters) {
    const profile = adapter.getProfile();
    const override = roster?.agents?.[profile.id] ?? null;
    const visibleRoles = Array.isArray(override?.roles) && override.roles.length > 0
      ? override.roles
      : profile.supported_roles;
    if (!visibleRoles.includes(role)) {
      continue;
    }
    counted.add(profile.id);
    const healthStatus = String(adapterHealth?.[profile.id]?.health_status ?? "ready").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, healthStatus)) {
      summary[healthStatus] += 1;
    } else {
      summary.unknown += 1;
    }
  }
  for (const entry of rosterVerification.entries ?? []) {
    if (counted.has(entry.id)) {
      continue;
    }
    const visibleRoles = Array.isArray(entry.effective_roles) && entry.effective_roles.length > 0
      ? entry.effective_roles
      : (entry.supported_roles ?? []);
    if (!visibleRoles.includes(role)) {
      continue;
    }
    const healthStatus = String(entry.health_status ?? "unknown").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, healthStatus)) {
      summary[healthStatus] += 1;
    } else {
      summary.unknown += 1;
    }
  }
  const runnableCount = summary.ready + summary.degraded;
  if (runnableCount > 0) {
    return {
      role,
      status: "ok",
      summary,
      reason: `${runnableCount} runnable adapter(s) remain available for role ${role}`,
    };
  }
  if (summary.unavailable > 0) {
    return {
      role,
      status: "blocked",
      summary,
      reason: `no runnable adapter remains for role ${role}; fix adapter environment compatibility or roster configuration before dispatch`,
    };
  }
  if (summary.disabled > 0) {
    return {
      role,
      status: "blocked",
      summary,
      reason: `all adapters for role ${role} are disabled by roster`,
    };
  }
  return {
    role,
    status: "unknown",
    summary,
    reason: `no adapter is currently exposed for role ${role}`,
  };
}

export function buildCoordinatorIntegrationRiskGate({ loopState, assessment, recommendation, scope }) {
  const appliedDecision = resolveAppliedIntegrationDecision(loopState);
  const sessionScoped = scope?.scope_type === "session" || recommendation.role === "coordinator";
  if (!sessionScoped || assessment.candidate_cycles.length <= 1) {
    return {
      active: false,
      applied_decision: appliedDecision,
      reason: "integration gate not required for the current relay scope",
    };
  }
  if (assessment.recommended_strategy === "direct_merge") {
    return {
      active: false,
      applied_decision: appliedDecision,
      reason: "integration risk allows a direct merge path",
    };
  }
  if (appliedDecision && appliedDecision === assessment.recommended_strategy) {
    return {
      active: false,
      applied_decision: appliedDecision,
      reason: `user arbitration already selected ${appliedDecision}`,
    };
  }
  return {
    active: true,
    applied_decision: appliedDecision,
    reason: `integration strategy ${assessment.recommended_strategy} must be resolved explicitly before session-level relay`,
  };
}

export function buildCoordinatorDispatchEntryPlan({
  targetRoot,
  recommendation,
  context,
  hasSqliteIndex = false,
  platform = process.platform,
}) {
  const targetArg = targetRoot;
  const mode = deriveModeForInvocation(context.mode);
  const plan = {
    entrypoint_kind: "manual",
    entrypoint_name: "manual-review",
    steps: [],
    commands: [],
    notes: [],
  };

  if (recommendation.role === "coordinator" && recommendation.action === "reanchor") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "context-reload";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "context-reload", "--mode", mode, "--target", targetArg, "--strict", "--json"], "context-reload", platform),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "context-reload", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-context-reload", platform),
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "start-session", "--mode", mode, "--target", targetArg, "--strict", "--json"], "start-session", platform),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push("Re-anchor before any durable write.");
    return plan;
  }

  if (recommendation.role === "coordinator" && recommendation.action === "coordinate") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "start-session";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "start-session", "--mode", mode, "--target", targetArg, "--strict", "--json"], "start-session", platform),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "start-session", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-start-session", platform),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push("Restate the objective, constraints, and next compliant step.");
    return plan;
  }

  if (recommendation.role === "executor" && recommendation.action === "implement") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "branch-cycle-audit";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "branch-cycle-audit", "--mode", "COMMITTING", "--target", targetArg, "--strict", "--fail-on-repair-block", "--json"], "branch-cycle-audit", platform),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "branch-cycle-audit", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-branch-cycle-audit", platform),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Then implement: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "auditor" && recommendation.action === "audit") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "drift-check";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "drift-check", "--mode", mode, "--target", targetArg, "--strict", "--json"], "drift-check", platform),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "drift-check", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-drift-check", platform),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Audit focus: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "auditor" && recommendation.action === "analyze") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "requirements-delta";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "requirements-delta", "--mode", mode, "--target", targetArg, "--strict", "--json"], "requirements-delta", platform),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "requirements-delta", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-requirements-delta", platform),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Analysis focus: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "repair" && recommendation.action === "repair") {
    plan.entrypoint_kind = "runtime";
    if (hasSqliteIndex) {
      plan.entrypoint_name = "repair-layer-triage";
      plan.steps = [
        buildStep("npx", ["aidn", "runtime", "repair-layer-triage", "--target", targetArg, "--json"], "repair-layer-triage", platform),
        buildStep("npx", ["aidn", "runtime", "project-runtime-state", "--target", targetArg, "--json"], "project-runtime-state-after-repair", platform),
      ];
    } else {
      plan.entrypoint_name = "project-runtime-state";
      plan.steps = [
        buildStep("npx", ["aidn", "runtime", "project-runtime-state", "--target", targetArg, "--json"], "project-runtime-state-after-repair", platform),
      ];
      plan.notes.push("SQLite index is unavailable; repair triage cannot run yet, so only the runtime digest is refreshed.");
    }
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push("Repair routing is gated; do not resume implementation until blocking findings are cleared.");
    return plan;
  }

  plan.notes.push(`Manual relay required for ${recommendation.role} + ${recommendation.action}.`);
  return plan;
}

export function buildCoordinatorDispatchPlanResult({
  targetRoot,
  selection,
  profile,
  roster,
  rosterVerification,
  recommendedRoleCoverage,
  recommendation,
  coordinatorStatus,
  integrationRisk,
  integrationRiskGate,
  sharedPlanning,
  loopState,
  dispatchPlan,
} = {}) {
  const dispatch = {
    entrypoint_kind: dispatchPlan.entrypoint_kind,
    entrypoint_name: dispatchPlan.entrypoint_name,
    steps: Array.isArray(dispatchPlan.steps) ? [...dispatchPlan.steps] : [],
    commands: Array.isArray(dispatchPlan.commands) ? [...dispatchPlan.commands] : [],
    notes: Array.isArray(dispatchPlan.notes) ? [...dispatchPlan.notes] : [],
  };

  if (loopState.loop?.escalation?.level === "user_arbitration_required") {
    dispatch.entrypoint_kind = "manual";
    dispatch.entrypoint_name = "user-arbitration";
    dispatch.steps = [];
    dispatch.commands = [];
    dispatch.notes = [
      `User arbitration required: ${loopState.loop.escalation.reason}`,
      "Do not dispatch another agent automatically until the issue is resolved.",
      "Run `aidn runtime coordinator-suggest-arbitration --target . --json` to review the structured arbitration options.",
    ];
  }
  if (integrationRiskGate.active) {
    dispatch.entrypoint_kind = "manual";
    dispatch.entrypoint_name = "user-arbitration";
    dispatch.steps = [];
    dispatch.commands = [];
    dispatch.notes = [
      `Integration strategy requires explicit resolution: ${integrationRisk.recommended_strategy}.`,
      ...integrationRisk.rationale.map((reason) => `Rationale: ${reason}`),
      "Run `aidn runtime project-integration-risk --target . --json` to inspect the cycle collision assessment.",
      "Run `aidn runtime coordinator-suggest-arbitration --target . --json` to review the structured integration decisions.",
    ];
  } else if (integrationRisk.candidate_cycles.length > 1) {
    dispatch.notes = [
      ...dispatch.notes,
      `Integration strategy assessment: ${integrationRisk.recommended_strategy} (${integrationRisk.mergeability}).`,
    ];
  }
  if (recommendedRoleCoverage.status === "blocked") {
    dispatch.entrypoint_kind = "manual";
    dispatch.entrypoint_name = "user-arbitration";
    dispatch.steps = [];
    dispatch.commands = [];
    dispatch.notes = [
      `Recommended role coverage is blocked: ${recommendedRoleCoverage.reason}`,
      "Do not dispatch another agent automatically until adapter availability is restored or the user selects a different path.",
      "Run `aidn runtime coordinator-suggest-arbitration --target . --json` to review the structured arbitration options.",
    ];
  }
  if (sharedPlanning.gate_status === "blocked") {
    dispatch.entrypoint_kind = "manual";
    dispatch.entrypoint_name = "user-arbitration";
    dispatch.steps = [];
    dispatch.commands = [];
    dispatch.notes = [
      `Shared planning arbitration must be resolved before dispatch: ${sharedPlanning.gate_reason}.`,
      "Run `aidn runtime session-plan --target . --planning-arbitration-status resolved --promote --json` after the planning decision is explicit.",
      "Run `aidn runtime coordinator-suggest-arbitration --target . --json` if the next dispatch scope still needs user arbitration.",
    ];
  }
  if (sharedPlanning.enabled) {
    dispatch.notes = [
      ...dispatch.notes,
      `Shared planning backlog: ${sharedPlanning.active_backlog}.`,
    ];
    dispatch.notes.push(`Shared planning freshness: ${sharedPlanning.freshness_status} (${sharedPlanning.freshness_basis}).`);
    if (sharedPlanning.backlog_next_step !== "unknown") {
      dispatch.notes.push(`Shared planning next step: ${sharedPlanning.backlog_next_step}.`);
    }
    if (sharedPlanning.planning_arbitration_status !== "none") {
      dispatch.notes.push(`Planning arbitration status: ${sharedPlanning.planning_arbitration_status}.`);
    }
    if (sharedPlanning.backlog_items.length > 0) {
      dispatch.notes.push(`Shared planning items: ${summarizeList(sharedPlanning.backlog_items)}.`);
    }
    if (sharedPlanning.open_questions.length > 0) {
      dispatch.notes.push(`Shared planning open questions: ${summarizeList(sharedPlanning.open_questions)}.`);
    }
    if (sharedPlanning.addenda_count > 0) {
      dispatch.notes.push(`Shared planning addenda: ${sharedPlanning.addenda_count} (${summarizeAddenda(sharedPlanning.recent_addenda)}).`);
    }
    if (sharedPlanning.dispatch_ready) {
      dispatch.notes.push(`Shared planning dispatch candidate: ${sharedPlanning.next_dispatch_scope} + ${sharedPlanning.next_dispatch_action}.`);
    }
  }

  const supported = selection.status === "selected" && Boolean(profile);
  const dispatchStatus = (loopState.loop?.escalation?.level === "user_arbitration_required"
    || recommendedRoleCoverage.status === "blocked"
    || integrationRiskGate.active
    || sharedPlanning.gate_status === "blocked")
    ? "escalated"
    : (!supported
      ? "unsupported"
      : (recommendation.stop_required ? "gated" : "ready"));

  return {
    target_root: targetRoot,
    selected_agent: {
      id: profile?.id ?? "unsupported",
      label: profile?.label ?? "Unsupported Agent",
      default_role: profile?.default_role ?? "coordinator",
      supported_roles: profile?.supported_roles ?? [],
      selection_status: selection.status,
      selection_reason: selection.reason,
      candidate_ids: selection.candidate_profiles.map((candidate) => candidate.id),
    },
    agent_roster: {
      found: roster.found,
      file_path: roster.file_path,
      default_requested_agent: roster.default_requested_agent,
    },
    agent_roster_verification: {
      pass: rosterVerification.pass,
      issue_count: rosterVerification.issues.length,
      warning_count: rosterVerification.warnings.length,
    },
    recommended_role_coverage: recommendedRoleCoverage,
    coordinator_recommendation: recommendation,
    coordinator_status: coordinatorStatus,
    integration_risk: integrationRisk,
    integration_risk_gate: integrationRiskGate,
    shared_planning: sharedPlanning,
    dispatch_scope: loopState.scope ?? {
      scope_type: "none",
      scope_id: "none",
      target_branch: "none",
    },
    dispatch_status: dispatchStatus,
    entrypoint_kind: dispatch.entrypoint_kind,
    entrypoint_name: dispatch.entrypoint_name,
    steps: dispatch.steps,
    commands: dispatch.commands,
    notes: dispatch.notes,
    preconditions: [
      "reload prioritized artifacts before acting",
      ...(sharedPlanning.enabled ? ["read the active shared backlog artifact before acting"] : []),
      "complete the mandatory pre-write restatement before durable write",
      recommendation.stop_required
        ? "respect the stop gate before any normal implementation relay"
        : "follow workflow gates for the selected mode before writing",
    ],
    handoff: loopState.handoff,
    context: loopState.context,
    loop: loopState.loop,
    base_recommendation: loopState.base_recommendation,
  };
}
