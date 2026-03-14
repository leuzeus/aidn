import {
  assertAgentProfile,
  canAgentRolePerform,
  isKnownAgentRole,
  normalizeAgentAction,
  normalizeAgentRole,
} from "../agents/agent-role-model.mjs";

const REQUIRED_METHODS = [
  "runCommand",
  "getProfile",
  "canHandleRole",
];

export function assertAgentAdapter(candidate, label = "AgentAdapter") {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`${label} must be an object`);
  }
  for (const methodName of REQUIRED_METHODS) {
    if (typeof candidate[methodName] !== "function") {
      throw new Error(`${label} is missing required method: ${methodName}()`);
    }
  }
  const profile = assertAgentProfile(candidate.getProfile(), `${label}.profile`);
  for (const role of profile.supported_roles) {
    if (candidate.canHandleRole({ role }) !== true) {
      throw new Error(`${label} must handle its declared role: ${role}`);
    }
  }
  return candidate;
}

export function normalizeRequestedAgentRole(value) {
  return normalizeAgentRole(value);
}

export function normalizeRequestedAgentAction(value) {
  return normalizeAgentAction(value);
}

export function validateAgentRoleRequest({ role, action }, label = "AgentRoleRequest") {
  const normalizedRole = normalizeAgentRole(role);
  const normalizedAction = normalizeAgentAction(action);
  if (normalizedRole && !isKnownAgentRole(normalizedRole)) {
    throw new Error(`${label} has unknown role: ${role}`);
  }
  if (normalizedRole && normalizedAction && !canAgentRolePerform(normalizedRole, normalizedAction)) {
    throw new Error(`${label} is incompatible: role=${normalizedRole} action=${normalizedAction}`);
  }
  return {
    role: normalizedRole,
    action: normalizedAction,
  };
}
