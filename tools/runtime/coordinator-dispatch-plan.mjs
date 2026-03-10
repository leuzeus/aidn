#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadRegisteredAgentAdapters } from "../../src/application/runtime/agent-adapter-registry-service.mjs";
import { loadAgentRoster } from "../../src/application/runtime/agent-roster-service.mjs";
import { assessIntegrationRisk } from "../../src/application/runtime/integration-risk-service.mjs";
import { selectAgentAdapter } from "../../src/core/agents/agent-selection-policy.mjs";
import { computeCoordinatorLoopState } from "./coordinator-loop.mjs";
import { buildAgentHealthMap, verifyAgentRoster } from "./verify-agent-roster.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    agent: "auto",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    agentRosterFile: "docs/audit/AGENT-ROSTER.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--agent") {
      args.agent = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--agent-roster-file") {
      args.agentRosterFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.agent) {
    throw new Error("Missing value for --agent");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-dispatch-plan.mjs --target .");
  console.log("  node tools/runtime/coordinator-dispatch-plan.mjs --target . --agent auto --json");
}

function quoteArg(value) {
  return `"${String(value ?? "").replace(/"/g, '\\"')}"`;
}

function resolveSelectedAgent({ requestedAgent, recommendation, roster, adapters, adapterHealth }) {
  return selectAgentAdapter({
    requestedAgent,
    role: recommendation.role,
    action: recommendation.action,
    adapters,
    roster,
    adapterHealth,
  });
}

function deriveModeForInvocation(contextMode) {
  const normalized = String(contextMode ?? "").trim().toUpperCase();
  if (!normalized || normalized === "UNKNOWN") {
    return "THINKING";
  }
  return normalized;
}

function buildCommandLine(command, args) {
  return `${command} ${args.map((item) => (/\s/.test(item) ? quoteArg(item) : item)).join(" ")}`.trim();
}

function buildStep(command, args, label) {
  const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  return {
    label,
    command: executable,
    args,
    command_line: buildCommandLine(command, args),
  };
}

function buildRecommendedRoleCoverage({ recommendation, adapters, rosterVerification, roster, adapterHealth }) {
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

function buildIntegrationRiskGate({ loopState, assessment, recommendation, scope }) {
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

function buildEntryPlan({ targetRoot, recommendation, context }) {
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
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "context-reload", "--mode", mode, "--target", targetArg, "--strict", "--json"], "context-reload"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "context-reload", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-context-reload"),
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "start-session", "--mode", mode, "--target", targetArg, "--strict", "--json"], "start-session"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push("Re-anchor before any durable write.");
    return plan;
  }

  if (recommendation.role === "coordinator" && recommendation.action === "coordinate") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "start-session";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "start-session", "--mode", mode, "--target", targetArg, "--strict", "--json"], "start-session"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "start-session", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-start-session"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push("Restate the objective, constraints, and next compliant step.");
    return plan;
  }

  if (recommendation.role === "executor" && recommendation.action === "implement") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "branch-cycle-audit";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "branch-cycle-audit", "--mode", "COMMITTING", "--target", targetArg, "--strict", "--fail-on-repair-block", "--json"], "branch-cycle-audit"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "branch-cycle-audit", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-branch-cycle-audit"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Then implement: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "auditor" && recommendation.action === "audit") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "drift-check";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "drift-check", "--mode", mode, "--target", targetArg, "--strict", "--json"], "drift-check"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "drift-check", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-drift-check"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Audit focus: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "auditor" && recommendation.action === "analyze") {
    plan.entrypoint_kind = "skill";
    plan.entrypoint_name = "requirements-delta";
    plan.steps = [
      buildStep("npx", ["aidn", "codex", "run-json-hook", "--skill", "requirements-delta", "--mode", mode, "--target", targetArg, "--strict", "--json"], "requirements-delta"),
      buildStep("npx", ["aidn", "codex", "hydrate-context", "--target", targetArg, "--skill", "requirements-delta", "--project-runtime-state", "--project-handoff-packet", "--json"], "hydrate-context-after-requirements-delta"),
    ];
    plan.commands = plan.steps.map((step) => step.command_line);
    plan.notes.push(`Analysis focus: ${recommendation.goal}`);
    return plan;
  }

  if (recommendation.role === "repair" && recommendation.action === "repair") {
    const sqliteIndex = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    plan.entrypoint_kind = "runtime";
    if (fs.existsSync(sqliteIndex)) {
      plan.entrypoint_name = "repair-layer-triage";
      plan.steps = [
        buildStep("npx", ["aidn", "runtime", "repair-layer-triage", "--target", targetArg, "--json"], "repair-layer-triage"),
        buildStep("npx", ["aidn", "runtime", "project-runtime-state", "--target", targetArg, "--json"], "project-runtime-state-after-repair"),
      ];
    } else {
      plan.entrypoint_name = "project-runtime-state";
      plan.steps = [
        buildStep("npx", ["aidn", "runtime", "project-runtime-state", "--target", targetArg, "--json"], "project-runtime-state-after-repair"),
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

export async function computeCoordinatorDispatchPlan({
  targetRoot,
  agent = "auto",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  agentRosterFile = "docs/audit/AGENT-ROSTER.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const loopState = computeCoordinatorLoopState({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
    runtimeStateFile,
    packetFile,
  });
  const recommendation = loopState.recommendation;
  const integrationRisk = assessIntegrationRisk({
    targetRoot: absoluteTargetRoot,
    currentStateFile,
  });
  const roster = loadAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile: agentRosterFile,
  });
  const rosterVerification = await verifyAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile: agentRosterFile,
  });
  const adapterHealth = buildAgentHealthMap(rosterVerification);
  const adapters = await loadRegisteredAgentAdapters({
    targetRoot: absoluteTargetRoot,
    roster,
    ignoreLoadFailures: true,
  });
  const selection = resolveSelectedAgent({
    requestedAgent: String(agent).trim().toLowerCase() || "auto",
    recommendation,
    roster,
    adapters,
    adapterHealth,
  });
  const profile = selection.selected_profile;
  const supported = selection.status === "selected" && Boolean(profile);
  const recommendedRoleCoverage = buildRecommendedRoleCoverage({
    recommendation,
    adapters,
    rosterVerification,
    roster,
    adapterHealth,
  });
  const dispatch = buildEntryPlan({
    targetRoot: absoluteTargetRoot,
    recommendation,
    context: loopState.context,
  });
  const integrationRiskGate = buildIntegrationRiskGate({
    loopState,
    assessment: integrationRisk,
    recommendation,
    scope: loopState.scope,
  });

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

  const dispatchStatus = (loopState.loop?.escalation?.level === "user_arbitration_required" || recommendedRoleCoverage.status === "blocked" || integrationRiskGate.active)
    ? "escalated"
    : (!supported
      ? "unsupported"
      : (recommendation.stop_required ? "gated" : "ready"));

  return {
    target_root: absoluteTargetRoot,
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
    integration_risk: integrationRisk,
    integration_risk_gate: integrationRiskGate,
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

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await computeCoordinatorDispatchPlan({
      targetRoot: args.target,
      agent: args.agent,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      packetFile: args.packetFile,
      agentRosterFile: args.agentRosterFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Coordinator dispatch plan:");
      console.log(`- agent=${result.selected_agent.id}`);
      console.log(`- role=${result.coordinator_recommendation.role}`);
      console.log(`- action=${result.coordinator_recommendation.action}`);
      console.log(`- scope=${result.dispatch_scope.scope_type}:${result.dispatch_scope.scope_id}`);
      console.log(`- dispatch_status=${result.dispatch_status}`);
      console.log(`- entrypoint=${result.entrypoint_kind}:${result.entrypoint_name}`);
      for (const command of result.commands) {
        console.log(`- command=${command}`);
      }
    }
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
