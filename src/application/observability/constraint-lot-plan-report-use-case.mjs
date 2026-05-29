const BATCH_ORDER = ["quick-win", "foundational", "deep-change"];
const BATCH_CODE = {
  "quick-win": "QW",
  foundational: "FD",
  "deep-change": "DC",
};

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function priorityBand(avgPriority) {
  if (avgPriority >= 20) {
    return "high";
  }
  if (avgPriority >= 8) {
    return "medium";
  }
  return "low";
}

function mostFrequent(values) {
  const map = new Map();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      continue;
    }
    map.set(normalized, (map.get(normalized) ?? 0) + 1);
  }
  const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted[0]?.[0] ?? null;
}

export function buildConstraintLotPlan(actions, trend = null, maxLotSize = 3, lotPrefix = "L4") {
  const byBatch = new Map();
  for (const batch of BATCH_ORDER) {
    byBatch.set(batch, []);
  }
  for (const action of actions) {
    const batch = String(action?.batch ?? "").trim();
    if (!byBatch.has(batch)) {
      byBatch.set(batch, []);
    }
    byBatch.get(batch).push(action);
  }

  for (const bucket of byBatch.values()) {
    bucket.sort((left, right) => Number(right?.priority_score ?? 0) - Number(left?.priority_score ?? 0));
  }

  const lots = [];
  for (const batch of BATCH_ORDER) {
    const items = byBatch.get(batch) ?? [];
    const groups = chunk(items, Math.max(1, maxLotSize));
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      const lotId = `${lotPrefix}-${BATCH_CODE[batch] ?? "OT"}-${String(i + 1).padStart(2, "0")}`;
      const avgPriority = group.length > 0
        ? group.reduce((sum, action) => sum + Number(action?.priority_score ?? 0), 0) / group.length
        : 0;
      const focusSkill = mostFrequent(group.map((action) => action?.skill));
      const exitCriteria = Array.from(new Set(group
        .map((action) => String(action?.acceptance_criteria ?? "").trim())
        .filter((line) => line.length > 0)));
      lots.push({
        lot_id: lotId,
        sequence: lots.length + 1,
        batch,
        status: "planned",
        priority_band: priorityBand(avgPriority),
        avg_priority_score: Number(avgPriority.toFixed(2)),
        focus_skill: focusSkill,
        actions: group.map((action) => ({
          action_id: action.action_id,
          skill: action.skill,
          title: action.title,
          status: "pending",
          priority_score: action.priority_score,
          impact_score: action.impact_score,
          effort: action.effort,
          recommendation: action.recommendation,
          acceptance_criteria: action.acceptance_criteria,
        })),
        exit_criteria: exitCriteria,
      });
    }
  }

  return {
    summary: summarizeConstraintLotPlan(lots, trend),
    lots,
  };
}

export function summarizeConstraintLotPlan(lots, trend = null) {
  const statusCount = new Map([
    ["planned", 0],
    ["in_progress", 0],
    ["completed", 0],
    ["blocked", 0],
  ]);
  let actionsTotal = 0;
  let actionsDone = 0;
  for (const lot of lots) {
    const status = String(lot?.status ?? "planned");
    statusCount.set(status, (statusCount.get(status) ?? 0) + 1);
    const actions = Array.isArray(lot?.actions) ? lot.actions : [];
    actionsTotal += actions.length;
    actionsDone += actions.filter((action) => String(action?.status ?? "pending") === "done").length;
  }
  const nextLot = lots.find((lot) => String(lot?.status ?? "planned") === "planned")
    ?? lots.find((lot) => String(lot?.status ?? "planned") === "in_progress")
    ?? null;

  return {
    lots_total: lots.length,
    lots_planned: statusCount.get("planned") ?? 0,
    lots_in_progress: statusCount.get("in_progress") ?? 0,
    lots_completed: statusCount.get("completed") ?? 0,
    lots_blocked: statusCount.get("blocked") ?? 0,
    actions_total: actionsTotal,
    actions_done: actionsDone,
    actions_pending: Math.max(0, actionsTotal - actionsDone),
    next_lot_id: nextLot?.lot_id ?? null,
    active_constraint_skill: trend?.summary?.dominant_constraint_skill ?? null,
    active_constraint_stability_rate: trend?.summary?.constraint_stability_rate ?? null,
  };
}
