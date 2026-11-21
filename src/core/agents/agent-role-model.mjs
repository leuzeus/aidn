import definition from "../../../package/catalogs/standard-role-profile.v1.json" with { type: "json" };
import { freezeShadow } from "../workflow/shadow-json.mjs";

export const standardRoleProfile = freezeShadow(definition);
export const AGENT_ROLES = Object.freeze(definition.roles.map(role => role.id));
const actionOf = ref => ref.split("@")[0];
export const AGENT_ACTIONS = Object.freeze(definition.capabilities.map(actionOf));
const capabilities = new Map(definition.roles.map(role => [role.id, Object.freeze(role.capabilities.map(actionOf))]));

function normalized(value, aliases) {
  const id = String(value ?? "").trim().toLowerCase();
  return Object.hasOwn(aliases, id) ? aliases[id] : id;
}
export const normalizeAgentRole = value => normalized(value, definition.role_aliases);
export const normalizeAgentAction = value => normalized(value, definition.capability_aliases);
export const isKnownAgentRole = value => AGENT_ROLES.includes(normalizeAgentRole(value));
export const isKnownAgentAction = value => AGENT_ACTIONS.includes(normalizeAgentAction(value));
export const getAgentRoleCapabilities = role => capabilities.get(normalizeAgentRole(role)) ?? [];
export const canAgentRolePerform = (role, action) => getAgentRoleCapabilities(role).includes(normalizeAgentAction(action));

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
