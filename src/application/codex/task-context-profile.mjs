import { resolveSkillId } from "../../core/skills/skill-policy.mjs";
import { pruneWorkflowProjectionSources } from "./workflow-shared-projection.mjs";
import { isGovernanceAdoptionEffective } from "../../core/governance/adoption-policy.mjs";
import { sha256, stableContextJson } from "../../core/context/working-memory-policy.mjs";

export const TOKEN_CONTEXT_PROFILE = Object.freeze({ id: "token-efficiency.v1", target_bytes: 16384, hard_limit_bytes: 65536 });
const object = value => value && typeof value === "object" && !Array.isArray(value);
const ids = value => Array.isArray(value) && value.length <= 64 && value.every(id => typeof id === "string" && id.length > 0) && new Set(value).size === value.length;
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const safePath = value => typeof value === "string" && value && !value.includes("\\") && !value.startsWith("/")
  && !value.includes(":") && !value.split("/").some(part => ["", ".", ".."].includes(part));
const unique = values => [...new Set(values)];

function validRule(rule) {
  if (!keys(rule, ["when", "mandatory", "optional"]) || !ids(rule.mandatory) || !ids(rule.optional)
      || !keys(rule.when, ["modes", "operations", "pathPrefixes", "cycleStates", "blocked"])) return false;
  return Object.entries(rule.when).every(([key, value]) => key === "blocked" ? typeof value === "boolean"
    : ids(value) && value.length > 0 && (key !== "pathPrefixes" || value.every(safePath)));
}

function validPolicies(policies) {
  return keys(policies, ["schemaVersion", "mandatory", "skills"]) && policies.schemaVersion === 1
    && ids(policies.mandatory) && policies.mandatory.length > 0 && object(policies.skills)
    && Object.keys(policies.skills).length <= 64 && Object.values(policies.skills).every(policy =>
      keys(policy, ["mandatory", "optional", "rules"]) && ids(policy.mandatory) && ids(policy.optional)
      && Array.isArray(policy.rules) && policy.rules.length <= 64 && policy.rules.every(validRule));
}

// The client's accepted declaration supplies unit bindings and obligations.
// Query scope/labels can add obligations; they cannot remove the stable minimum,
// accept a new authority or change action-specific admission.
export function buildTaskContextRequest({ adoption, scope, admissions, skills, task = {}, asOf }) {
  const blocked = reason => ({ mode: "blocked", reason, write_authorization: false,
    remediation: "Accept a current client-owned task policy covering every requested skill and its complete authority dependencies, then reconsult. Use an explicit full view without the bounded context profile for compatibility diagnostics." });
  if (!keys(task, ["operation", "paths"]) || task.operation !== undefined && (typeof task.operation !== "string" || task.operation.length > 160)
      || task.paths !== undefined && (!Array.isArray(task.paths) || task.paths.length > 128 || !task.paths.every(safePath))) return blocked("invalid_task_query");
  const canonicalSkills = skills.map(resolveSkillId);
  if (canonicalSkills.some(skill => !skill)) return blocked("unknown_skill_requires_explicit_full_view");
  const policies = adoption?.extensions?.taskContextPolicies;
  if (policies === undefined) return blocked("client_task_policies_required");
  if (!validPolicies(policies)) return blocked("invalid_client_task_policies");
  if (!isGovernanceAdoptionEffective(adoption, { asOf, expectedScope: "installed-project" })) return blocked("client_adoption_not_effective");
  if (canonicalSkills.some(skill => !policies.skills[skill])) return blocked("skill_task_policy_required");
  const roots = [...policies.mandatory], optional = [], blockedSkill = Object.values(admissions).some(row => !row.ok);
  for (let index = 0; index < skills.length; index++) {
    const policy = policies.skills[canonicalSkills[index]], context = admissions[skills[index]]?.context ?? {};
    roots.push(...policy.mandatory); optional.push(...policy.optional);
    for (const rule of policy.rules) {
      const when = rule.when;
      if (when.modes && !when.modes.includes(context.mode)
          || when.operations && !when.operations.includes(task.operation)
          || when.cycleStates && !when.cycleStates.includes(context.cycle_state)
          || when.blocked !== undefined && when.blocked !== blockedSkill
          || when.pathPrefixes && !(task.paths ?? []).some(file => when.pathPrefixes.some(prefix => file === prefix || file.startsWith(`${prefix}/`)))) continue;
      roots.push(...rule.mandatory); optional.push(...rule.optional);
    }
  }
  if (unique(roots).length > 64 || unique(optional).length > 64) return blocked("task_obligations_limit");
  return { mode: "scoped", reason: "accepted_client_task_policy", write_authorization: false,
    policy_revision: sha256(stableContextJson({ adoption: adoption.adoptionId, revision: adoption.revision, policies })),
    request: { schemaVersion: 1, purpose: "effective", asOf, scope, roots: unique(roots),
      optional: unique(optional).filter(id => !roots.includes(id)), units: adoption.extensions.contextUnits } };
}

// Budget the final agent JSON, including admissions, delta, history, references
// and the counter itself. Optional closure is omitted as a whole; mandatory
// authorities are never split. A refusal preserves diagnostics and expansion
// references rather than presenting incomplete mandatory bodies as a success.
export function finalizeWorkflowContextBudget(output, { targetBytes, hardLimitBytes }) {
  const previous = output.bundle_budget?.profile === TOKEN_CONTEXT_PROFILE.id ? output.bundle_budget : null;
  if (previous && (previous.target_bytes !== targetBytes || previous.hard_limit_bytes !== hardLimitBytes))
    throw new Error("WORKFLOW_CONTEXT_BUDGET_REQUIRES_FRESH_SELECTION");
  const addedMetadata = previous ? Buffer.byteLength(JSON.stringify(output)) - previous.total_bytes : 0;
  const budget = previous ?? { profile: TOKEN_CONTEXT_PROFILE.id, scope: "complete-json", serialization: "compact-utf8",
    target_bytes: targetBytes, hard_limit_bytes: hardLimitBytes, total_bytes: 0, status: "within-target",
    minimum_required_bytes: null, fits_hard_limit: true, omitted_optional_ids: [], expansion_required: [] };
  output.bundle_budget = budget;
  if (budget.minimum_required_bytes !== null && addedMetadata > 0) budget.minimum_required_bytes += addedMetadata;
  const measure = () => {
    for (let pass = 0; pass < 16; pass++) {
      const query=output.artifact_consultation;
      if(query?.budget)for(let i=0;i<16;i++){
        const size=Buffer.byteLength(JSON.stringify(query));if(query.budget.total_bytes===size)break;
        query.budget.total_bytes=size;
      }
      const size = Buffer.byteLength(JSON.stringify(output));
      if (size === budget.total_bytes) return size;
      budget.total_bytes = size;
    }
    throw new Error("WORKFLOW_CONTEXT_BUDGET_UNSTABLE");
  };
  const remove = omitted => {
    const refs = new Set(omitted.map(row => row.id));
    output.artifacts = output.artifacts.filter(row => !refs.has(row.id));
    for (const context of output.contexts) context.artifact_refs = context.artifact_refs.filter(id => !refs.has(id));
    if (output.artifact_metadata) {
      const live = new Set(output.artifacts.map(row => row.artifact.canonical_ref).filter(Boolean));
      output.artifact_metadata = output.artifact_metadata.filter(row => live.has(row.id));
    }
    pruneWorkflowProjectionSources(output);
  };
  if (measure() > targetBytes) {
    const optional = output.artifacts.filter(row => row.artifact.selection_reasons?.every(reason => reason === "optional_consultation"));
    const unchanged = output.context_delta?.unchanged_optional_refs ?? [];
    budget.omitted_optional_ids = unique([...budget.omitted_optional_ids, ...optional.map(row => row.artifact.unit_id), ...unchanged.map(row => row.unit_id)]);
    remove(optional);
    if(output.artifact_consultation?.authorities) {
      const query=output.artifact_consultation,optional=query.authorities.filter(u=>u.selection_reasons.every(r=>r==='optional_consultation'));
      query.authorities=query.authorities.filter(u=>!optional.includes(u));
      query.omissions.push(...optional.map(u=>({id:u.unit_id,reason:'optional_workflow_budget'})));
    }
    if (output.context_delta) output.context_delta.unchanged_optional_refs = [];
    if (Array.isArray(output.context_selection?.expansions)) output.context_selection.expansions = output.context_selection.expansions
      .filter(row => !budget.omitted_optional_ids.includes(row.unit_id));
  }
  if (measure() > targetBytes && budget.status !== "blocked") {
    budget.status = "blocked"; output.ok = false;
    budget.minimum_required_bytes = measure();
    budget.expansion_required = output.artifacts.map(row => ({ id: row.id, path: row.artifact.path,
      unit_id: row.artifact.unit_id ?? null, sha256: row.artifact.sha256 ?? null }));
    remove([...output.artifacts]);
    if(output.artifact_consultation) {
      const query=output.artifact_consultation;
      query.status='blocked';query.errors.push({code:'ARTIFACT_QUERY_WORKFLOW_BUDGET_INSUFFICIENT',ref:null});
      query.expansions.push(...(query.authorities??[]).map(u=>({path:u.path,sha256:u.sha256})));
      query.fields=[];query.sections=[];query.authorities=[];
      if(query.preparation)query.preparation.ready=false;
    }
    // Include the size of the expansion metadata when declaring the minimum.
    const minimum = budget.minimum_required_bytes;
    budget.minimum_required_bytes = Math.max(minimum, measure());
  }
  if (measure() > targetBytes && budget.minimum_required_bytes === null) budget.minimum_required_bytes = measure();
  if (output.context_selection?.status === "blocked" || output.selection_policy?.mode === "blocked") {
    budget.status = "blocked"; output.ok = false;
  }
  budget.fits_hard_limit = measure() <= hardLimitBytes;
  measure();
  return output;
}
