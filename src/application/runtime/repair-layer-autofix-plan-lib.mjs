const SAFE_ANCHOR_RELATION_TYPES = new Set([
  "integration_target_cycle",
  "reported_from_previous_session",
]);

function normalizeOpenAmbiguityStatus(value) {
  const normalized = String(value ?? "open").trim().toLowerCase();
  return normalized || "open";
}

export function collectRepairLayerSafeAutofixPlan(payload, options = {}) {
  const sessionFilter = String(options.sessionId ?? "").trim();
  const links = Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [];
  const grouped = new Map();
  for (const row of links) {
    const sessionId = String(row?.session_id ?? "").trim();
    if (!sessionId) {
      continue;
    }
    if (sessionFilter && sessionId !== sessionFilter) {
      continue;
    }
    const list = grouped.get(sessionId) ?? [];
    list.push(row);
    grouped.set(sessionId, list);
  }

  const suggestions = [];
  for (const [sessionId, sessionLinks] of grouped.entries()) {
    const strongAnchors = sessionLinks
      .filter((row) =>
        SAFE_ANCHOR_RELATION_TYPES.has(String(row?.relation_type ?? ""))
        && !["rejected", "ambiguous"].includes(String(row?.relation_status ?? "").toLowerCase())
        && String(row?.ambiguity_status ?? "").toLowerCase() !== "rejected")
      .map((row) => String(row?.cycle_id ?? "").trim())
      .filter(Boolean);
    const uniqueAnchors = Array.from(new Set(strongAnchors));
    if (uniqueAnchors.length !== 1) {
      continue;
    }
    const anchorCycleId = uniqueAnchors[0];
    const conflictingCycleIds = sessionLinks
      .filter((row) =>
        String(row?.relation_type ?? "") === "attached_cycle"
        && String(row?.source_mode ?? "") === "ambiguous"
        && normalizeOpenAmbiguityStatus(row?.ambiguity_status) === "open"
        && String(row?.cycle_id ?? "").trim()
        && String(row?.cycle_id ?? "").trim() !== anchorCycleId)
      .map((row) => String(row?.cycle_id ?? "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (conflictingCycleIds.length === 0) {
      continue;
    }
    const relationTypes = Array.from(new Set(sessionLinks
      .filter((row) =>
        String(row?.cycle_id ?? "").trim() === anchorCycleId
        && SAFE_ANCHOR_RELATION_TYPES.has(String(row?.relation_type ?? "")))
      .map((row) => String(row?.relation_type ?? "").trim()))).sort((a, b) => a.localeCompare(b));
    suggestions.push({
      session_id: sessionId,
      anchor_cycle_id: anchorCycleId,
      conflicting_cycle_ids: conflictingCycleIds,
      relation_types: relationTypes,
    });
  }

  return suggestions.sort((left, right) => String(left.session_id).localeCompare(String(right.session_id)));
}
