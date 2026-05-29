export function buildConstraintLotPlanSummaryMarkdown(plan, advance = null, topLots = 5) {
  const summary = plan?.summary ?? {};
  const lots = Array.isArray(plan?.lots) ? plan.lots.slice(0, topLots) : [];
  const nextLotId = String(summary?.next_lot_id ?? "").trim();
  const nextLot = Array.isArray(plan?.lots)
    ? plan.lots.find((lot) => String(lot?.lot_id ?? "") === nextLotId)
    : null;

  const lines = [];
  lines.push("## Constraint Lot Plan");
  lines.push("");
  lines.push(`- Lots total: ${summary?.lots_total ?? 0}`);
  lines.push(`- Lots planned/in_progress/completed/blocked: ${summary?.lots_planned ?? 0}/${summary?.lots_in_progress ?? 0}/${summary?.lots_completed ?? 0}/${summary?.lots_blocked ?? 0}`);
  lines.push(`- Actions done/total: ${summary?.actions_done ?? 0}/${summary?.actions_total ?? 0}`);
  lines.push(`- Next lot: ${summary?.next_lot_id ?? "n/a"}`);
  lines.push("");

  if (lots.length > 0) {
    lines.push("### Lots");
    lines.push("");
    lines.push("| lot_id | status | batch | actions | avg_priority | focus_skill |");
    lines.push("|---|---|---|---:|---:|---|");
    for (const lot of lots) {
      const actions = Array.isArray(lot?.actions) ? lot.actions : [];
      lines.push(`| ${lot?.lot_id ?? "n/a"} | ${lot?.status ?? "n/a"} | ${lot?.batch ?? "n/a"} | ${actions.length} | ${lot?.avg_priority_score ?? "n/a"} | ${lot?.focus_skill ?? "n/a"} |`);
    }
    lines.push("");
  }

  if (nextLot != null) {
    const actions = Array.isArray(nextLot?.actions) ? nextLot.actions : [];
    lines.push("### Next Lot Actions");
    lines.push("");
    lines.push(`- Lot: ${nextLot.lot_id} (${nextLot.batch}, ${nextLot.priority_band})`);
    lines.push("");
    lines.push("| action_id | status | priority | impact | effort |");
    lines.push("|---|---|---:|---:|---:|");
    for (const action of actions) {
      lines.push(`| ${action?.action_id ?? "n/a"} | ${action?.status ?? "n/a"} | ${action?.priority_score ?? "n/a"} | ${action?.impact_score ?? "n/a"} | ${action?.effort ?? "n/a"} |`);
    }
    lines.push("");
  }

  const transitions = Array.isArray(advance?.transitions) ? advance.transitions : [];
  if (transitions.length > 0) {
    lines.push("### Latest Transitions");
    lines.push("");
    lines.push("| type | lot_id |");
    lines.push("|---|---|");
    for (const transition of transitions) {
      lines.push(`| ${transition?.type ?? "n/a"} | ${transition?.lot_id ?? "n/a"} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
