import schema from "../contracts/workflow-definition/role-profile.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { standardRoleProfile, canAgentRolePerform } from "./agent-role-model.mjs";
import { STANDARD_TRANSITION_POLICY_REF } from "./agent-transition-policy.mjs";
import { checkShadowJson } from "../workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const unique = values => new Set(values).size === values.length;
const simple = id => typeof id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(id);

export function compileRoleProfile(profile) {
  if (checkShadowJson(profile) || validateJsonSchema(profile, schema, "$", { contractKind: "workflow-definition" }).length ||
      profile.transition_policy_ref !== STANDARD_TRANSITION_POLICY_REF || !unique(profile.capabilities) ||
      !unique(profile.roles.map(role => role.id))) fail("WORKFLOW_ROLE_PROFILE_INVALID");
  const roles = new Map(profile.roles.map(role => [role.id, structuredClone(role)]));
  for (const ref of profile.capabilities) if (!standardRoleProfile.capabilities.includes(ref)) fail("WORKFLOW_CAPABILITY_UNKNOWN");
  for (const role of roles.values()) {
    if (!standardRoleProfile.roles.some(row => row.id === role.host_role) ||
        !unique(role.capabilities) || !unique(role.required_permissions) ||
        role.capabilities.some(ref => !profile.capabilities.includes(ref) || !canAgentRolePerform(role.host_role, ref.split("@")[0])))
      fail("WORKFLOW_ROLE_CAPABILITY_INVALID");
  }
  const roleAliases = new Map(Object.entries(profile.role_aliases));
  for (const [alias, target] of roleAliases) {
    if (!simple(alias) || roles.has(alias) || !roles.has(target)) fail("WORKFLOW_ROLE_ALIAS_INVALID");
  }
  for (const [alias, target] of Object.entries(profile.capability_aliases)) {
    if (!simple(alias) || profile.capabilities.includes(alias + "@1") || !profile.capabilities.includes(target + "@1"))
      fail("WORKFLOW_CAPABILITY_ALIAS_INVALID");
  }
  return Object.freeze({
    resolve({ id, profile_role = id, capability_ref, skills, ...extra }) {
      const role = roles.get(roleAliases.get(profile_role) ?? profile_role);
      if (Object.keys(extra).length || !role || !role.capabilities.includes(capability_ref) ||
          !Array.isArray(skills) || !simple(id)) fail("WORKFLOW_ROLE_BINDING_INVALID");
      return { role: { id, role: role.host_role, action: capability_ref.split("@")[0], skills: [...skills] },
        required_permissions: [...role.required_permissions] };
    },
  });
}

export function compileWorkflowRole(profile, binding) {
  return compileRoleProfile(profile).resolve(binding).role;
}

// The author can narrow eligibility. Every activity using the business role must
// retain its required permissions in the policy actually pinned in the runtime IR.
export function applyWorkflowRoleProfile(model, profile) {
  const resolver = compileRoleProfile(profile);
  const policies = new Map(model.policies.map(policy => [policy.id, policy]));
  const bindings = new Map(model.roles.map(row => [row.id, resolver.resolve(row)]));
  for (const node of model.nodes.filter(row => row.kind === "activity")) {
    const policy = policies.get(node.policy_ref), binding = bindings.get(node.role_ref);
    if (!binding || !Array.isArray(policy?.required_permissions) ||
        binding.required_permissions.some(required => !policy.required_permissions.includes(required)))
      fail("WORKFLOW_ROLE_PERMISSION_REQUIRED");
  }
  model.roles = model.roles.map(row => bindings.get(row.id).role);
}
