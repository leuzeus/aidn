#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDbBackedMode } from "./db-first-runtime-view-lib.mjs";
import { computeCoordinatorDispatchPlan } from "./coordinator-dispatch-plan.mjs";

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
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--agent") {
      args.agent = String(argv[index + 1] ?? "").trim().toLowerCase();
      index += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--agent-roster-file") {
      args.agentRosterFile = String(argv[index + 1] ?? "").trim();
      index += 1;
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-suggest-arbitration.mjs --target .");
  console.log("  node tools/runtime/coordinator-suggest-arbitration.mjs --target . --json");
}

function quoteArg(value) {
  return `"${String(value ?? "").replace(/"/g, '\\"')}"`;
}

function buildRecordCommand({ targetRoot, decision, note, goal }) {
  const args = [
    "npx",
    "aidn",
    "runtime",
    "coordinator-record-arbitration",
    "--target",
    targetRoot,
    "--decision",
    decision,
    "--note",
    quoteArg(note),
  ];
  if (goal) {
    args.push("--goal", quoteArg(goal));
  }
  args.push("--json");
  return args.join(" ");
}

function buildSuggestion({ targetRoot, decision, recommended, immediatelyActionable, rationale, note, goal }) {
  return {
    decision,
    recommended,
    immediately_actionable: immediatelyActionable,
    rationale,
    note_template: note,
    goal,
    record_command: buildRecordCommand({
      targetRoot,
      decision,
      note,
      goal,
    }),
  };
}

function suggestForBlockedRoleCoverage(dispatch, targetRoot) {
  const role = dispatch.recommended_role_coverage?.role ?? dispatch.coordinator_recommendation.role;
  const reason = dispatch.recommended_role_coverage?.reason
    ?? `no runnable adapter remains for role ${role}`;
  return {
    preferred_decision: "reanchor",
    arbitration_required: true,
    arbitration_reason: reason,
    suggestions: [
      buildSuggestion({
        targetRoot,
        decision: "reanchor",
        recommended: true,
        immediatelyActionable: true,
        rationale: `Safest fallback while role ${role} has no runnable adapter.`,
        note: `restore adapter availability for role ${role}, then reanchor the workflow facts`,
        goal: `reanchor after restoring adapter availability for role ${role}`,
      }),
      buildSuggestion({
        targetRoot,
        decision: "continue",
        recommended: false,
        immediatelyActionable: false,
        rationale: `Only use continue after adapter availability is restored for role ${role}.`,
        note: `continue only after restoring adapter availability for role ${role}`,
        goal: dispatch.coordinator_recommendation.goal,
      }),
    ],
  };
}

function suggestForIntegrationStrategy(dispatch, targetRoot) {
  const strategy = String(dispatch.integration_risk?.recommended_strategy ?? "user_arbitration_required").trim().toLowerCase();
  const rationale = Array.isArray(dispatch.integration_risk?.rationale) && dispatch.integration_risk.rationale.length > 0
    ? dispatch.integration_risk.rationale.join(" ")
    : "integration strategy must be chosen explicitly";
  if (strategy === "integration_cycle") {
    return {
      preferred_decision: "integration_cycle",
      arbitration_required: true,
      arbitration_reason: rationale,
      suggestions: [
        buildSuggestion({
          targetRoot,
          decision: "integration_cycle",
          recommended: true,
          immediatelyActionable: true,
          rationale: "Open a dedicated integration vehicle before merging the candidate cycles into the session.",
          note: "route the candidate cycles through a dedicated integration cycle before session integration",
          goal: "open a dedicated integration cycle for the candidate session cycles",
        }),
        buildSuggestion({
          targetRoot,
          decision: "report_forward",
          recommended: false,
          immediatelyActionable: true,
          rationale: "Use report_forward if the integration vehicle should be deferred to a later session.",
          note: "defer integration of the candidate cycles to a later session",
          goal: "report the candidate cycles forward instead of integrating now",
        }),
      ],
    };
  }
  if (strategy === "report_forward") {
    return {
      preferred_decision: "report_forward",
      arbitration_required: true,
      arbitration_reason: rationale,
      suggestions: [
        buildSuggestion({
          targetRoot,
          decision: "report_forward",
          recommended: true,
          immediatelyActionable: true,
          rationale: "At least one candidate cycle is not integration-ready, so deferring is the safest compliant path.",
          note: "report the unfinished candidate cycles forward instead of integrating now",
          goal: "report the candidate cycles forward for a later integration decision",
        }),
        buildSuggestion({
          targetRoot,
          decision: "reanchor",
          recommended: false,
          immediatelyActionable: true,
          rationale: "Use reanchor first if you need to refresh facts before deciding how to defer the work.",
          note: "refresh workflow facts before deciding how to defer the candidate cycles",
          goal: "reanchor integration facts before deciding the deferred path",
        }),
      ],
    };
  }
  if (strategy === "rework_from_example") {
    return {
      preferred_decision: "rework_from_example",
      arbitration_required: true,
      arbitration_reason: rationale,
      suggestions: [
        buildSuggestion({
          targetRoot,
          decision: "rework_from_example",
          recommended: true,
          immediatelyActionable: true,
          rationale: "The candidate cycles should be replayed intentionally in a new integration vehicle instead of merged mechanically.",
          note: "open an integration vehicle and replay the selected cycle(s) from example instead of merging directly",
          goal: "rework from the candidate cycles as source material in a dedicated integration vehicle",
        }),
        buildSuggestion({
          targetRoot,
          decision: "integration_cycle",
          recommended: false,
          immediatelyActionable: true,
          rationale: "Use integration_cycle only if the user explicitly wants a harmonization pass instead of replay-based integration.",
          note: "route the cycles through an integration vehicle even though replay-based integration is preferred",
          goal: "open an integration cycle despite the replay-oriented recommendation",
        }),
      ],
    };
  }
  return {
    preferred_decision: "reanchor",
    arbitration_required: true,
    arbitration_reason: rationale,
    suggestions: [
      buildSuggestion({
        targetRoot,
        decision: "reanchor",
        recommended: true,
        immediatelyActionable: true,
        rationale: "Refresh workflow facts before choosing an integration path.",
        note: "reanchor before selecting an integration path",
        goal: "reanchor integration facts before deciding the next path",
      }),
      buildSuggestion({
        targetRoot,
        decision: "continue",
        recommended: false,
        immediatelyActionable: false,
        rationale: "Continue is not actionable until the integration strategy ambiguity is resolved.",
        note: "continue only after the integration strategy is made explicit",
        goal: dispatch.coordinator_recommendation.goal,
      }),
    ],
  };
}

function suggestForEscalation(dispatch, targetRoot) {
  const escalationReason = dispatch.loop?.escalation?.reason
    ?? "user arbitration is required before another coordinator dispatch";
  const baseSuggestions = [
    buildSuggestion({
      targetRoot,
      decision: "reanchor",
      recommended: true,
      immediatelyActionable: true,
      rationale: "Reload session, cycle, and runtime facts before selecting another path.",
      note: "reanchor before retrying the blocked coordinator flow",
      goal: "reanchor current session, cycle, and runtime facts before continuing",
    }),
    buildSuggestion({
      targetRoot,
      decision: "continue",
      recommended: false,
      immediatelyActionable: false,
      rationale: "Use continue only if the escalation condition was resolved externally and the intended relay should resume unchanged.",
      note: "continue after confirming the escalated condition is resolved",
      goal: dispatch.coordinator_recommendation.goal,
    }),
  ];
  return {
    preferred_decision: "reanchor",
    arbitration_required: true,
    arbitration_reason: escalationReason,
    suggestions: baseSuggestions,
  };
}

function suggestForReadyDispatch(dispatch, targetRoot) {
  return {
    preferred_decision: "continue",
    arbitration_required: false,
    arbitration_reason: "dispatch is already actionable",
    suggestions: [
      buildSuggestion({
        targetRoot,
        decision: "continue",
        recommended: true,
        immediatelyActionable: true,
        rationale: "The current dispatch is already actionable and does not require user arbitration.",
        note: "continue with the current coordinator recommendation",
        goal: dispatch.coordinator_recommendation.goal,
      }),
    ],
  };
}

export async function suggestCoordinatorArbitration({
  targetRoot,
  agent = "auto",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  agentRosterFile = "docs/audit/AGENT-ROSTER.md",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const dispatch = await computeCoordinatorDispatchPlan({
    targetRoot: absoluteTargetRoot,
    agent,
    currentStateFile,
    runtimeStateFile,
    packetFile,
    agentRosterFile,
    sharedCoordination,
    sharedCoordinationOptions,
  });

  let suggestionBundle;
  if (dispatch.recommended_role_coverage?.status === "blocked") {
    suggestionBundle = suggestForBlockedRoleCoverage(dispatch, absoluteTargetRoot);
  } else if (dispatch.integration_risk_gate?.active) {
    suggestionBundle = suggestForIntegrationStrategy(dispatch, absoluteTargetRoot);
  } else if (dispatch.dispatch_status === "escalated") {
    suggestionBundle = suggestForEscalation(dispatch, absoluteTargetRoot);
  } else {
    suggestionBundle = suggestForReadyDispatch(dispatch, absoluteTargetRoot);
  }

  return {
    target_root: absoluteTargetRoot,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    dispatch_status: dispatch.dispatch_status,
    coordinator_recommendation: dispatch.coordinator_recommendation,
    recommended_role_coverage: dispatch.recommended_role_coverage,
    arbitration_required: suggestionBundle.arbitration_required,
    arbitration_reason: suggestionBundle.arbitration_reason,
    preferred_decision: suggestionBundle.preferred_decision,
    suggestions: suggestionBundle.suggestions,
    dispatch,
  };
}

function renderText(result) {
  const lines = [];
  lines.push("Coordinator arbitration suggestions:");
  lines.push(`- dispatch_status=${result.dispatch_status}`);
  lines.push(`- arbitration_required=${result.arbitration_required ? "yes" : "no"}`);
  lines.push(`- preferred_decision=${result.preferred_decision}`);
  lines.push(`- arbitration_reason=${result.arbitration_reason}`);
  lines.push("- suggestions:");
  for (const suggestion of result.suggestions) {
    lines.push(`  - ${suggestion.decision} recommended=${suggestion.recommended ? "yes" : "no"} actionable=${suggestion.immediately_actionable ? "yes" : "no"}`);
    lines.push(`    rationale=${suggestion.rationale}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await suggestCoordinatorArbitration({
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
      process.stdout.write(renderText(result));
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
