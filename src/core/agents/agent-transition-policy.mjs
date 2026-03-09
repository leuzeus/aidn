import {
  canAgentRolePerform,
  isKnownAgentRole,
  normalizeAgentAction,
  normalizeAgentRole,
} from "./agent-role-model.mjs";

export const AGENT_MODES = Object.freeze([
  "THINKING",
  "EXPLORING",
  "COMMITTING",
]);

const TRANSITION_POLICY = Object.freeze({
  THINKING: Object.freeze({
    coordinator: Object.freeze(["coordinator", "executor", "auditor", "repair"]),
    executor: Object.freeze(["coordinator", "executor", "auditor", "repair"]),
    auditor: Object.freeze(["coordinator", "executor", "auditor", "repair"]),
    repair: Object.freeze(["coordinator", "auditor", "repair"]),
  }),
  EXPLORING: Object.freeze({
    coordinator: Object.freeze(["coordinator", "auditor", "executor", "repair"]),
    executor: Object.freeze(["coordinator", "auditor", "repair"]),
    auditor: Object.freeze(["coordinator", "executor", "repair"]),
    repair: Object.freeze(["coordinator", "auditor", "repair"]),
  }),
  COMMITTING: Object.freeze({
    coordinator: Object.freeze(["coordinator", "executor", "auditor", "repair"]),
    executor: Object.freeze(["coordinator", "auditor", "repair"]),
    auditor: Object.freeze(["coordinator", "executor", "repair"]),
    repair: Object.freeze(["coordinator", "auditor", "repair"]),
  }),
});

export function normalizeAgentMode(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }
  return normalized;
}

export function isKnownAgentMode(value) {
  return AGENT_MODES.includes(normalizeAgentMode(value));
}

export function getAllowedTargetRolesForMode(mode, fromRole) {
  const normalizedMode = normalizeAgentMode(mode);
  const normalizedFromRole = normalizeAgentRole(fromRole);
  if (!isKnownAgentMode(normalizedMode) || !isKnownAgentRole(normalizedFromRole)) {
    return [];
  }
  return TRANSITION_POLICY[normalizedMode]?.[normalizedFromRole] ?? [];
}

export function evaluateAgentTransition({
  mode,
  fromRole,
  fromAction,
  toRole,
  toAction,
} = {}) {
  const normalizedMode = normalizeAgentMode(mode);
  const normalizedFromRole = normalizeAgentRole(fromRole);
  const normalizedFromAction = normalizeAgentAction(fromAction);
  const normalizedToRole = normalizeAgentRole(toRole);
  const normalizedToAction = normalizeAgentAction(toAction);

  if (!isKnownAgentMode(normalizedMode)) {
    return {
      allowed: false,
      status: "unknown_mode",
      reason: `unknown mode: ${mode || "missing"}`,
      mode: normalizedMode || "unknown",
      from_role: normalizedFromRole || "unknown",
      from_action: normalizedFromAction || "unknown",
      to_role: normalizedToRole || "unknown",
      to_action: normalizedToAction || "unknown",
    };
  }
  if (!isKnownAgentRole(normalizedFromRole)) {
    return {
      allowed: false,
      status: "unknown_from_role",
      reason: `unknown source role: ${fromRole || "missing"}`,
      mode: normalizedMode,
      from_role: normalizedFromRole || "unknown",
      from_action: normalizedFromAction || "unknown",
      to_role: normalizedToRole || "unknown",
      to_action: normalizedToAction || "unknown",
    };
  }
  if (!isKnownAgentRole(normalizedToRole)) {
    return {
      allowed: false,
      status: "unknown_to_role",
      reason: `unknown target role: ${toRole || "missing"}`,
      mode: normalizedMode,
      from_role: normalizedFromRole,
      from_action: normalizedFromAction || "unknown",
      to_role: normalizedToRole || "unknown",
      to_action: normalizedToAction || "unknown",
    };
  }
  if (normalizedFromAction && !canAgentRolePerform(normalizedFromRole, normalizedFromAction)) {
    return {
      allowed: false,
      status: "invalid_source_action",
      reason: `source role ${normalizedFromRole} cannot perform action ${normalizedFromAction}`,
      mode: normalizedMode,
      from_role: normalizedFromRole,
      from_action: normalizedFromAction || "unknown",
      to_role: normalizedToRole,
      to_action: normalizedToAction || "unknown",
    };
  }
  if (normalizedToAction && !canAgentRolePerform(normalizedToRole, normalizedToAction)) {
    return {
      allowed: false,
      status: "invalid_target_action",
      reason: `target role ${normalizedToRole} cannot perform action ${normalizedToAction}`,
      mode: normalizedMode,
      from_role: normalizedFromRole,
      from_action: normalizedFromAction || "unknown",
      to_role: normalizedToRole,
      to_action: normalizedToAction || "unknown",
    };
  }
  const allowedTargets = getAllowedTargetRolesForMode(normalizedMode, normalizedFromRole);
  if (!allowedTargets.includes(normalizedToRole)) {
    return {
      allowed: false,
      status: "transition_not_allowed",
      reason: `${normalizedMode} does not allow ${normalizedFromRole} -> ${normalizedToRole}`,
      mode: normalizedMode,
      from_role: normalizedFromRole,
      from_action: normalizedFromAction || "unknown",
      to_role: normalizedToRole,
      to_action: normalizedToAction || "unknown",
    };
  }
  return {
    allowed: true,
    status: "allowed",
    reason: `${normalizedMode} allows ${normalizedFromRole} -> ${normalizedToRole}`,
    mode: normalizedMode,
    from_role: normalizedFromRole,
    from_action: normalizedFromAction || "unknown",
    to_role: normalizedToRole,
    to_action: normalizedToAction || "unknown",
  };
}
