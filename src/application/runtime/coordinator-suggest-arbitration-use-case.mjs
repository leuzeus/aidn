function quoteArg(value) {
  return `"${String(value ?? "").replace(/"/g, '\\"')}"`;
}

export function buildCoordinatorArbitrationRecordCommand({ targetRoot, decision, note, goal }) {
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

export function buildCoordinatorArbitrationSuggestion({
  targetRoot,
  decision,
  recommended,
  immediatelyActionable,
  rationale,
  note,
  goal,
}) {
  return {
    decision,
    recommended,
    immediately_actionable: immediatelyActionable,
    rationale,
    note_template: note,
    goal,
    record_command: buildCoordinatorArbitrationRecordCommand({
      targetRoot,
      decision,
      note,
      goal,
    }),
  };
}

export function suggestCoordinatorForBlockedRoleCoverage(dispatch, targetRoot) {
  const role = dispatch.recommended_role_coverage?.role ?? dispatch.coordinator_recommendation.role;
  const reason = dispatch.recommended_role_coverage?.reason
    ?? `no runnable adapter remains for role ${role}`;
  return {
    preferred_decision: "reanchor",
    arbitration_required: true,
    arbitration_reason: reason,
    suggestions: [
      buildCoordinatorArbitrationSuggestion({
        targetRoot,
        decision: "reanchor",
        recommended: true,
        immediatelyActionable: true,
        rationale: `Safest fallback while role ${role} has no runnable adapter.`,
        note: `restore adapter availability for role ${role}, then reanchor the workflow facts`,
        goal: `reanchor after restoring adapter availability for role ${role}`,
      }),
      buildCoordinatorArbitrationSuggestion({
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

export function suggestCoordinatorForIntegrationStrategy(dispatch, targetRoot) {
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
        buildCoordinatorArbitrationSuggestion({
          targetRoot,
          decision: "integration_cycle",
          recommended: true,
          immediatelyActionable: true,
          rationale: "Open a dedicated integration vehicle before merging the candidate cycles into the session.",
          note: "route the candidate cycles through a dedicated integration cycle before session integration",
          goal: "open a dedicated integration cycle for the candidate session cycles",
        }),
        buildCoordinatorArbitrationSuggestion({
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
        buildCoordinatorArbitrationSuggestion({
          targetRoot,
          decision: "report_forward",
          recommended: true,
          immediatelyActionable: true,
          rationale: "At least one candidate cycle is not integration-ready, so deferring is the safest compliant path.",
          note: "report the unfinished candidate cycles forward instead of integrating now",
          goal: "report the candidate cycles forward for a later integration decision",
        }),
        buildCoordinatorArbitrationSuggestion({
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
        buildCoordinatorArbitrationSuggestion({
          targetRoot,
          decision: "rework_from_example",
          recommended: true,
          immediatelyActionable: true,
          rationale: "The candidate cycles should be replayed intentionally in a new integration vehicle instead of merged mechanically.",
          note: "open an integration vehicle and replay the selected cycle(s) from example instead of merging directly",
          goal: "rework from the candidate cycles as source material in a dedicated integration vehicle",
        }),
        buildCoordinatorArbitrationSuggestion({
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
      buildCoordinatorArbitrationSuggestion({
        targetRoot,
        decision: "reanchor",
        recommended: true,
        immediatelyActionable: true,
        rationale: "Refresh workflow facts before choosing an integration path.",
        note: "reanchor before selecting an integration path",
        goal: "reanchor integration facts before deciding the next path",
      }),
      buildCoordinatorArbitrationSuggestion({
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

export function suggestCoordinatorForEscalation(dispatch, targetRoot) {
  const escalationReason = dispatch.loop?.escalation?.reason
    ?? "user arbitration is required before another coordinator dispatch";
  return {
    preferred_decision: "reanchor",
    arbitration_required: true,
    arbitration_reason: escalationReason,
    suggestions: [
      buildCoordinatorArbitrationSuggestion({
        targetRoot,
        decision: "reanchor",
        recommended: true,
        immediatelyActionable: true,
        rationale: "Reload session, cycle, and runtime facts before selecting another path.",
        note: "reanchor before retrying the blocked coordinator flow",
        goal: "reanchor current session, cycle, and runtime facts before continuing",
      }),
      buildCoordinatorArbitrationSuggestion({
        targetRoot,
        decision: "continue",
        recommended: false,
        immediatelyActionable: false,
        rationale: "Use continue only if the escalation condition was resolved externally and the intended relay should resume unchanged.",
        note: "continue after confirming the escalated condition is resolved",
        goal: dispatch.coordinator_recommendation.goal,
      }),
    ],
  };
}

export function suggestCoordinatorForReadyDispatch(dispatch, targetRoot) {
  return {
    preferred_decision: "continue",
    arbitration_required: false,
    arbitration_reason: "dispatch is already actionable",
    suggestions: [
      buildCoordinatorArbitrationSuggestion({
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

export function selectCoordinatorArbitrationSuggestionBundle(dispatch, targetRoot) {
  if (dispatch.recommended_role_coverage?.status === "blocked") {
    return suggestCoordinatorForBlockedRoleCoverage(dispatch, targetRoot);
  }
  if (dispatch.integration_risk_gate?.active) {
    return suggestCoordinatorForIntegrationStrategy(dispatch, targetRoot);
  }
  if (dispatch.dispatch_status === "escalated") {
    return suggestCoordinatorForEscalation(dispatch, targetRoot);
  }
  return suggestCoordinatorForReadyDispatch(dispatch, targetRoot);
}

export function buildCoordinatorArbitrationResult({
  absoluteTargetRoot,
  effectiveStateMode,
  dbBackedMode,
  dispatch,
  suggestionBundle,
}) {
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
