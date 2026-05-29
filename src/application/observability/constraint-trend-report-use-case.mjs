function topCounts(mapLike, keyLabel, limit = 10) {
  return Array.from(mapLike.entries())
    .map(([key, count]) => ({ [keyLabel]: key, count }))
    .sort((a, b) => b.count - a.count || String(a[keyLabel]).localeCompare(String(b[keyLabel])))
    .slice(0, limit);
}

export function buildConstraintTrendReport(runs) {
  const total = runs.length;
  const constraints = new Map();
  const actions = new Map();
  let switches = 0;
  let transitions = 0;
  let avgControlShare = 0;
  let avgActiveShare = 0;
  let highSeverityRuns = 0;
  let quickWinTopRuns = 0;

  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const skill = String(run?.active_constraint_skill ?? "").trim() || "none";
    const topAction = String(run?.top_action_id ?? "").trim();
    const topActionBatch = String(run?.top_action_batch ?? "").trim();
    const severity = String(run?.active_constraint_severity ?? "").trim();
    constraints.set(skill, (constraints.get(skill) ?? 0) + 1);
    if (topAction) {
      actions.set(topAction, (actions.get(topAction) ?? 0) + 1);
    }
    if (severity === "high") {
      highSeverityRuns += 1;
    }
    if (topActionBatch === "quick-win") {
      quickWinTopRuns += 1;
    }
    avgControlShare += Number(run?.control_share_of_total ?? 0);
    avgActiveShare += Number(run?.active_constraint_share ?? 0);

    if (i > 0) {
      transitions += 1;
      const previousSkill = String(runs[i - 1]?.active_constraint_skill ?? "").trim() || "none";
      if (previousSkill !== skill) {
        switches += 1;
      }
    }
  }

  const topConstraints = topCounts(constraints, "skill", 10);
  const topActions = topCounts(actions, "action_id", 10);
  const dominant = topConstraints[0] ?? null;
  const avgControl = total > 0 ? avgControlShare / total : 0;
  const avgActive = total > 0 ? avgActiveShare / total : 0;
  const stabilityRate = transitions > 0 ? (transitions - switches) / transitions : 1;

  return {
    runs_analyzed: total,
    unique_constraints: constraints.size,
    dominant_constraint_skill: dominant?.skill ?? null,
    dominant_constraint_share: dominant ? dominant.count / total : 0,
    constraint_switches: switches,
    constraint_stability_rate: stabilityRate,
    avg_control_share_of_total: avgControl,
    avg_active_constraint_share: avgActive,
    high_severity_runs: highSeverityRuns,
    quick_win_top_runs: quickWinTopRuns,
    top_constraints: topConstraints,
    top_actions: topActions,
  };
}
