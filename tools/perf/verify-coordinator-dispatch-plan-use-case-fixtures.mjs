#!/usr/bin/env node
import {
  buildCoordinatorDispatchEntryPlan,
  buildCoordinatorDispatchPlanResult,
  buildCoordinatorIntegrationRiskGate,
  buildCoordinatorRecommendedRoleCoverage,
} from "../../src/application/runtime/coordinator-dispatch-plan-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildAdapter(id, supportedRoles = ["executor"]) {
  return {
    getProfile() {
      return {
        id,
        label: `${id} label`,
        default_role: supportedRoles[0] ?? "coordinator",
        supported_roles: supportedRoles,
      };
    },
  };
}

function verifyEntryPlan() {
  const plan = buildCoordinatorDispatchEntryPlan({
    targetRoot: "G:/fixture/project",
    recommendation: {
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
    },
    context: {
      mode: "COMMITTING",
    },
    platform: "win32",
  });
  assert(plan.entrypoint_name === "branch-cycle-audit", "entry plan should route executor work to branch-cycle-audit");
  assert(plan.commands.some((item) => item.includes("--skill branch-cycle-audit")), "entry plan should include branch-cycle-audit command");
}

function verifyRecommendedRoleCoverage() {
  const coverage = buildCoordinatorRecommendedRoleCoverage({
    recommendation: { role: "auditor" },
    adapters: [],
    rosterVerification: {
      entries: [
        {
          id: "probe-failing-auditor",
          effective_roles: ["auditor"],
          health_status: "unavailable",
        },
      ],
    },
    roster: { agents: {} },
    adapterHealth: {},
  });
  assert(coverage.status === "blocked", "role coverage should block when no runnable adapter remains");
}

function verifyIntegrationRiskGate() {
  const gate = buildCoordinatorIntegrationRiskGate({
    loopState: {
      loop: {
        history: {
          arbitration_applied: false,
        },
      },
    },
    assessment: {
      candidate_cycles: ["C101", "C102"],
      recommended_strategy: "integration_cycle",
    },
    recommendation: {
      role: "coordinator",
    },
    scope: {
      scope_type: "session",
    },
  });
  assert(gate.active === true, "integration gate should activate for unresolved session-level integration risk");
}

function verifyResultAssembly() {
  const result = buildCoordinatorDispatchPlanResult({
    targetRoot: "G:/fixture/project",
    selection: {
      status: "selected",
      reason: "fixture selection",
      candidate_profiles: [buildAdapter("codex", ["executor"]).getProfile()],
    },
    profile: buildAdapter("codex", ["executor"]).getProfile(),
    roster: {
      found: true,
      file_path: "docs/audit/AGENT-ROSTER.md",
      default_requested_agent: "auto",
    },
    rosterVerification: {
      pass: true,
      issues: [],
      warnings: [],
    },
    recommendedRoleCoverage: {
      role: "executor",
      status: "ok",
      summary: { ready: 1, degraded: 0, unavailable: 0, disabled: 0, unknown: 0 },
      reason: "1 runnable adapter(s) remain available for role executor",
    },
    recommendation: {
      role: "executor",
      action: "implement",
      goal: "implement alpha feature validation",
      stop_required: false,
    },
    coordinatorStatus: {
      admission_status: "admitted",
      admitted: true,
      issues: [],
      warnings: [],
    },
    integrationRisk: {
      candidate_cycles: ["C101"],
      recommended_strategy: "direct_merge",
      mergeability: "clean",
      rationale: [],
    },
    integrationRiskGate: {
      active: false,
      applied_decision: null,
      reason: "integration gate not required for the current relay scope",
    },
    sharedPlanning: {
      enabled: true,
      gate_status: "blocked",
      gate_reason: "planning arbitration remains unresolved: review_requested",
      active_backlog: "backlog/BL-S101-session-planning.md",
      freshness_status: "ok",
      freshness_basis: "backlog updated_at is aligned with CURRENT-STATE.md",
      backlog_next_step: "validate shared planning before dispatch",
      planning_arbitration_status: "review_requested",
      backlog_items: ["validate shared planning before dispatch", "preserve session-level arbitration trace"],
      open_questions: ["should coordinator dispatch session or cycle work next?"],
      addenda_count: 1,
      recent_addenda: [
        {
          agent_role: "coordinator",
          rationale: "initial session backlog promotion",
        },
      ],
      dispatch_ready: true,
      next_dispatch_scope: "session",
      next_dispatch_action: "coordinate",
    },
    loopState: {
      scope: {
        scope_type: "cycle",
        scope_id: "C101",
        target_branch: "feature/C101-alpha",
      },
      handoff: {
        status: {
          admission_status: "admitted",
          admitted: true,
          issues: [],
          warnings: [],
        },
      },
      context: {
        mode: "COMMITTING",
      },
      loop: {
        escalation: {
          level: "none",
        },
      },
      base_recommendation: {
        role: "executor",
        action: "implement",
      },
    },
    dispatchPlan: {
      entrypoint_kind: "skill",
      entrypoint_name: "branch-cycle-audit",
      steps: [
        {
          label: "branch-cycle-audit",
          command: "npx.cmd",
          args: [],
          command_line: "npx aidn codex run-json-hook --skill branch-cycle-audit",
        },
      ],
      commands: ["npx aidn codex run-json-hook --skill branch-cycle-audit"],
      notes: ["Then implement: implement alpha feature validation"],
    },
  });
  assert(result.dispatch_status === "escalated", "result assembly should escalate blocked shared planning");
  assert(result.entrypoint_name === "user-arbitration", "result assembly should reroute to user arbitration");
  assert(result.notes.some((note) => note.includes("Shared planning backlog: backlog/BL-S101-session-planning.md")), "result assembly should append shared planning backlog note");
  assert(result.preconditions.includes("read the active shared backlog artifact before acting"), "result assembly should require reading the active shared backlog");
}

function main() {
  try {
    verifyEntryPlan();
    verifyRecommendedRoleCoverage();
    verifyIntegrationRiskGate();
    verifyResultAssembly();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
