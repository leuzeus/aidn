import {
  normalizeScalar,
  parseSimpleMap,
  parseTimestamp,
} from "./db-first-runtime-view-lib.mjs";

export function readPacketSummary(packetResolution) {
  if (!packetResolution?.exists) {
    return {
      exists: false,
      updated_at: "",
      updated_at_ms: null,
      recommended_role: "",
      recommended_action: "",
      goal: "",
      scope_type: "",
      scope_id: "",
      preferred_dispatch_source: "",
    };
  }
  const packetMap = parseSimpleMap(packetResolution.text);
  const updatedAt = normalizeScalar(packetMap.get("updated_at") ?? "");
  return {
    exists: true,
    updated_at: updatedAt,
    updated_at_ms: parseTimestamp(updatedAt),
    recommended_role: normalizeScalar(packetMap.get("recommended_next_agent_role") ?? ""),
    recommended_action: normalizeScalar(packetMap.get("recommended_next_agent_action") ?? ""),
    goal: normalizeScalar(packetMap.get("next_agent_goal") ?? ""),
    scope_type: normalizeScalar(packetMap.get("scope_type") ?? ""),
    scope_id: normalizeScalar(packetMap.get("scope_id") ?? ""),
    preferred_dispatch_source: normalizeScalar(packetMap.get("preferred_dispatch_source") ?? ""),
  };
}

export function readSharedRelaySummary(relay) {
  if (!relay || typeof relay !== "object") {
    return {
      exists: false,
      updated_at: "",
      updated_at_ms: null,
      recommended_role: "",
      recommended_action: "",
      goal: "",
      scope_type: "",
      scope_id: "",
      preferred_dispatch_source: "",
    };
  }
  const metadata = relay.metadata && typeof relay.metadata === "object"
    ? relay.metadata
    : {};
  const updatedAt = normalizeScalar(metadata.updated_at || relay.created_at || "");
  return {
    exists: true,
    updated_at: updatedAt,
    updated_at_ms: parseTimestamp(updatedAt),
    recommended_role: normalizeScalar(metadata.recommended_next_agent_role || relay.recommended_next_agent_role || ""),
    recommended_action: normalizeScalar(metadata.recommended_next_agent_action || relay.recommended_next_agent_action || ""),
    goal: normalizeScalar(metadata.next_agent_goal || ""),
    scope_type: normalizeScalar(metadata.scope_type || relay.scope_type || ""),
    scope_id: normalizeScalar(metadata.scope_id || relay.scope_id || ""),
    preferred_dispatch_source: normalizeScalar(metadata.preferred_dispatch_source || ""),
  };
}

export function derivePacketResolution(localPacket, sharedRelay) {
  if (!localPacket.exists && !sharedRelay.exists) {
    return {
      selected_source: "none",
      selection_reason: "no local packet or shared handoff relay is available",
      freshness_status: "missing",
      conflict_status: "not_applicable",
      local_packet_updated_at: "",
      shared_relay_updated_at: "",
    };
  }
  if (!localPacket.exists && sharedRelay.exists) {
    return {
      selected_source: "shared-coordination",
      selection_reason: "local handoff packet is missing",
      freshness_status: "local-missing",
      conflict_status: "not_applicable",
      local_packet_updated_at: "",
      shared_relay_updated_at: sharedRelay.updated_at,
    };
  }
  if (localPacket.exists && !sharedRelay.exists) {
    return {
      selected_source: "local-packet",
      selection_reason: "no shared handoff relay is available",
      freshness_status: "shared-missing",
      conflict_status: "not_applicable",
      local_packet_updated_at: localPacket.updated_at,
      shared_relay_updated_at: "",
    };
  }

  const diverged = localPacket.recommended_role !== sharedRelay.recommended_role
    || localPacket.recommended_action !== sharedRelay.recommended_action
    || localPacket.goal !== sharedRelay.goal
    || localPacket.scope_type !== sharedRelay.scope_type
    || localPacket.scope_id !== sharedRelay.scope_id
    || localPacket.preferred_dispatch_source !== sharedRelay.preferred_dispatch_source;

  if (localPacket.updated_at_ms === null && sharedRelay.updated_at_ms !== null) {
    return {
      selected_source: "shared-coordination",
      selection_reason: "local handoff packet has no parseable timestamp while the shared relay does",
      freshness_status: "shared-newer",
      conflict_status: diverged ? "diverged-shared-preferred" : "aligned-shared-preferred",
      local_packet_updated_at: localPacket.updated_at,
      shared_relay_updated_at: sharedRelay.updated_at,
    };
  }
  if (localPacket.updated_at_ms !== null && sharedRelay.updated_at_ms === null) {
    return {
      selected_source: "local-packet",
      selection_reason: "shared handoff relay has no parseable timestamp while the local packet does",
      freshness_status: "local-newer",
      conflict_status: diverged ? "diverged-local-preferred" : "aligned-local-preferred",
      local_packet_updated_at: localPacket.updated_at,
      shared_relay_updated_at: sharedRelay.updated_at,
    };
  }
  if (localPacket.updated_at_ms !== null && sharedRelay.updated_at_ms !== null) {
    if (sharedRelay.updated_at_ms > localPacket.updated_at_ms) {
      return {
        selected_source: "shared-coordination",
        selection_reason: "shared handoff relay is newer than the local packet",
        freshness_status: "shared-newer",
        conflict_status: diverged ? "diverged-shared-preferred" : "aligned-shared-preferred",
        local_packet_updated_at: localPacket.updated_at,
        shared_relay_updated_at: sharedRelay.updated_at,
      };
    }
    if (localPacket.updated_at_ms > sharedRelay.updated_at_ms) {
      return {
        selected_source: "local-packet",
        selection_reason: "local handoff packet is newer than the shared relay",
        freshness_status: "local-newer",
        conflict_status: diverged ? "diverged-local-preferred" : "aligned-local-preferred",
        local_packet_updated_at: localPacket.updated_at,
        shared_relay_updated_at: sharedRelay.updated_at,
      };
    }
  }
  return {
    selected_source: "local-packet",
    selection_reason: diverged
      ? "local and shared handoff timestamps are tied; local packet stays authoritative for this worktree"
      : "local and shared handoff timestamps are tied and aligned",
    freshness_status: "same-age",
    conflict_status: diverged ? "diverged-local-preferred" : "aligned",
    local_packet_updated_at: localPacket.updated_at,
    shared_relay_updated_at: sharedRelay.updated_at,
  };
}

export function buildSharedRelayHandoff(relay) {
  const metadata = relay?.metadata && typeof relay.metadata === "object"
    ? relay.metadata
    : {};
  const packet = {
    handoff_status: normalizeScalar(metadata.handoff_status || relay?.handoff_status || "unknown") || "unknown",
    handoff_from_agent_role: normalizeScalar(metadata.handoff_from_agent_role || relay?.from_agent_role || "coordinator") || "coordinator",
    handoff_from_agent_action: normalizeScalar(metadata.handoff_from_agent_action || relay?.from_agent_action || "relay") || "relay",
    recommended_next_agent_role: normalizeScalar(metadata.recommended_next_agent_role || relay?.recommended_next_agent_role || "coordinator") || "coordinator",
    recommended_next_agent_action: normalizeScalar(metadata.recommended_next_agent_action || relay?.recommended_next_agent_action || "coordinate") || "coordinate",
    next_agent_goal: normalizeScalar(metadata.next_agent_goal || "reload the shared relay and continue") || "reload the shared relay and continue",
    preferred_dispatch_source: normalizeScalar(metadata.preferred_dispatch_source || "workflow") || "workflow",
    active_backlog: normalizeScalar(metadata.active_backlog || metadata.backlog_refs || "none") || "none",
    backlog_refs: normalizeScalar(metadata.backlog_refs || metadata.active_backlog || "none") || "none",
    backlog_next_step: normalizeScalar(metadata.backlog_next_step || "unknown") || "unknown",
    planning_arbitration_status: normalizeScalar(metadata.planning_arbitration_status || "none") || "none",
    shared_planning_candidate_ready: normalizeScalar(metadata.shared_planning_candidate_ready || "no") || "no",
    shared_planning_candidate_aligned: normalizeScalar(metadata.shared_planning_candidate_aligned || "no") || "no",
    shared_planning_dispatch_scope: normalizeScalar(metadata.shared_planning_dispatch_scope || "none") || "none",
    shared_planning_dispatch_action: normalizeScalar(metadata.shared_planning_dispatch_action || "none") || "none",
    shared_planning_freshness: normalizeScalar(metadata.shared_planning_freshness || "not_applicable") || "not_applicable",
    shared_planning_gate_status: normalizeScalar(metadata.shared_planning_gate_status || "not_applicable") || "not_applicable",
    shared_planning_gate_reason: normalizeScalar(metadata.shared_planning_gate_reason || "none") || "none",
    scope_type: normalizeScalar(metadata.scope_type || relay?.scope_type || "none") || "none",
    scope_id: normalizeScalar(metadata.scope_id || relay?.scope_id || "none") || "none",
    target_branch: normalizeScalar(metadata.target_branch || "none") || "none",
    repair_layer_status: normalizeScalar(metadata.repair_layer_status || "unknown") || "unknown",
    repair_primary_reason: normalizeScalar(metadata.repair_primary_reason || "unknown") || "unknown",
    updated_at: normalizeScalar(metadata.updated_at || relay?.created_at || ""),
    prioritized_artifacts: Array.isArray(metadata.prioritized_artifacts)
      ? metadata.prioritized_artifacts.map((item) => normalizeScalar(item)).filter(Boolean)
      : (Array.isArray(relay?.prioritized_artifacts)
        ? relay.prioritized_artifacts.map((item) => normalizeScalar(item)).filter(Boolean)
        : []),
  };
  return {
    admission_status: "admitted",
    status: {
      admission_status: "admitted",
      admitted: true,
      issues: [],
      warnings: [],
    },
    packet,
    recommended_next_agent_role: packet.recommended_next_agent_role,
    recommended_action: packet.recommended_next_agent_action,
    next_agent_goal: packet.next_agent_goal,
    preferred_dispatch_source: packet.preferred_dispatch_source,
    scope_type: packet.scope_type,
    scope_id: packet.scope_id,
    target_branch: packet.target_branch,
    transition_policy: {
      status: "shared_relay_fallback",
      reason: "shared coordination handoff relay used because the local packet is missing or older",
    },
    route: {
      role: packet.recommended_next_agent_role,
      action: packet.recommended_next_agent_action,
      goal: packet.next_agent_goal,
    },
    source: "shared-coordination",
  };
}
