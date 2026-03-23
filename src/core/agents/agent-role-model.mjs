export const AGENT_ROLES = Object.freeze([
  "coordinator",
  "executor",
  "auditor",
  "repair",
]);

export const AGENT_ACTIONS = Object.freeze([
  "reanchor",
  "implement",
  "audit",
  "analyze",
  "repair",
  "relay",
  "close",
  "coordinate",
]);

const ROLE_ALIASES = Object.freeze({
  implementer: "executor",
  analyst: "auditor",
  review: "auditor",
  reviewer: "auditor",
});

const ACTION_ALIASES = Object.freeze({
  analyse: "analyze",
  review: "audit",
  fix: "repair",
});

const ROLE_CAPABILITIES = Object.freeze({
  coordinator: Object.freeze(["reanchor", "relay", "close", "coordinate"]),
  executor: Object.freeze(["implement", "relay"]),
  auditor: Object.freeze(["audit", "analyze", "relay"]),
  repair: Object.freeze(["repair", "relay"]),
});

export function normalizeAgentRole(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return ROLE_ALIASES[normalized] ?? normalized;
}

export function normalizeAgentAction(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return ACTION_ALIASES[normalized] ?? normalized;
}

export function isKnownAgentRole(value) {
  return AGENT_ROLES.includes(normalizeAgentRole(value));
}

export function isKnownAgentAction(value) {
  return AGENT_ACTIONS.includes(normalizeAgentAction(value));
}

export function getAgentRoleCapabilities(role) {
  const normalized = normalizeAgentRole(role);
  return ROLE_CAPABILITIES[normalized] ?? [];
}

export function canAgentRolePerform(role, action) {
  const normalizedRole = normalizeAgentRole(role);
  const normalizedAction = normalizeAgentAction(action);
  if (!isKnownAgentRole(normalizedRole) || !isKnownAgentAction(normalizedAction)) {
    return false;
  }
  return getAgentRoleCapabilities(normalizedRole).includes(normalizedAction);
}

export function buildAgentProfile({
  id = "unknown",
  label = "Unknown Agent",
  defaultRole = "coordinator",
  roles = AGENT_ROLES,
} = {}) {
  const normalizedRoles = roles
    .map((role) => normalizeAgentRole(role))
    .filter((role, index, array) => isKnownAgentRole(role) && array.indexOf(role) === index);
  const normalizedDefaultRole = normalizeAgentRole(defaultRole) || "coordinator";
  return {
    id,
    label,
    default_role: isKnownAgentRole(normalizedDefaultRole) ? normalizedDefaultRole : "coordinator",
    supported_roles: normalizedRoles.length > 0 ? normalizedRoles : [...AGENT_ROLES],
    capabilities_by_role: Object.fromEntries(
      (normalizedRoles.length > 0 ? normalizedRoles : [...AGENT_ROLES]).map((role) => [role, [...getAgentRoleCapabilities(role)]]),
    ),
  };
}

export function assertAgentProfile(profile, label = "AgentProfile") {
  if (!profile || typeof profile !== "object") {
    throw new Error(`${label} must be an object`);
  }
  if (!String(profile.id ?? "").trim()) {
    throw new Error(`${label} is missing id`);
  }
  if (!String(profile.label ?? "").trim()) {
    throw new Error(`${label} is missing label`);
  }
  if (!isKnownAgentRole(profile.default_role)) {
    throw new Error(`${label} has unknown default_role: ${profile.default_role}`);
  }
  const supportedRoles = Array.isArray(profile.supported_roles) ? profile.supported_roles : [];
  if (supportedRoles.length === 0) {
    throw new Error(`${label} must declare at least one supported role`);
  }
  for (const role of supportedRoles) {
    if (!isKnownAgentRole(role)) {
      throw new Error(`${label} has unknown supported role: ${role}`);
    }
  }
  return profile;
}
