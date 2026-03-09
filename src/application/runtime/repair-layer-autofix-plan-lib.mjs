const SAFE_DIRECT_ANCHOR_RELATION_TYPES = new Set([
  "integration_target_cycle",
  "reported_from_previous_session",
]);

function normalizeOpenAmbiguityStatus(value) {
  const normalized = String(value ?? "open").trim().toLowerCase();
  return normalized || "open";
}

function collectCarryOverParents(sessionLinks, sessionId) {
  return sessionLinks
    .filter((row) =>
      String(row?.source_session_id ?? "") === sessionId
      && String(row?.relation_type ?? "") === "carry_over_pending_from_session"
      && !["rejected", "ambiguous"].includes(String(row?.relation_status ?? "").toLowerCase()))
    .map((row) => String(row?.target_session_id ?? "").trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

function collectParentCarryOverAnchors(sessionCycleLinks, parentSessionId) {
  return sessionCycleLinks
    .filter((row) =>
      String(row?.session_id ?? "") === parentSessionId
      && String(row?.relation_type ?? "") === "attached_cycle"
      && String(row?.ambiguity_status ?? "").toLowerCase() !== "rejected"
      && !["ambiguous", "rejected"].includes(String(row?.relation_status ?? "").toLowerCase()))
    .map((row) => String(row?.cycle_id ?? "").trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

export function collectRepairLayerSafeAutofixPlan(payload, options = {}) {
  const sessionFilter = String(options.sessionId ?? "").trim();
  const sessionCycleLinks = Array.isArray(payload?.session_cycle_links) ? payload.session_cycle_links : [];
  const sessionLinks = Array.isArray(payload?.session_links) ? payload.session_links : [];
  const grouped = new Map();
  for (const row of sessionCycleLinks) {
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
  for (const [sessionId, linksForSession] of grouped.entries()) {
    const directAnchors = linksForSession
      .filter((row) =>
        SAFE_DIRECT_ANCHOR_RELATION_TYPES.has(String(row?.relation_type ?? ""))
        && !["rejected", "ambiguous"].includes(String(row?.relation_status ?? "").toLowerCase())
        && String(row?.ambiguity_status ?? "").toLowerCase() !== "rejected")
      .map((row) => String(row?.cycle_id ?? "").trim())
      .filter(Boolean);

    let uniqueAnchors = Array.from(new Set(directAnchors));
    let anchorReason = "direct_strong_relation";
    let anchorRelationTypes = Array.from(new Set(linksForSession
      .filter((row) =>
        SAFE_DIRECT_ANCHOR_RELATION_TYPES.has(String(row?.relation_type ?? ""))
        && uniqueAnchors.includes(String(row?.cycle_id ?? "").trim()))
      .map((row) => String(row?.relation_type ?? "").trim()))).sort((a, b) => a.localeCompare(b));

    if (uniqueAnchors.length === 0) {
      const carryOverParents = collectCarryOverParents(sessionLinks, sessionId);
      if (carryOverParents.length === 1) {
        const parentAnchors = collectParentCarryOverAnchors(sessionCycleLinks, carryOverParents[0]);
        if (parentAnchors.length === 1) {
          uniqueAnchors = parentAnchors;
          anchorReason = "parent_carry_over_cycle";
          anchorRelationTypes = ["carry_over_pending_from_session", "attached_cycle"];
        }
      }
    }

    if (uniqueAnchors.length !== 1) {
      continue;
    }
    const anchorCycleId = uniqueAnchors[0];
    const conflictingCycleIds = linksForSession
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

    suggestions.push({
      session_id: sessionId,
      anchor_cycle_id: anchorCycleId,
      anchor_reason: anchorReason,
      conflicting_cycle_ids: conflictingCycleIds,
      relation_types: anchorRelationTypes,
    });
  }

  return suggestions.sort((left, right) => String(left.session_id).localeCompare(String(right.session_id)));
}
