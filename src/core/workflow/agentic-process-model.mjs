import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";
import { canAgentRolePerform, normalizeAgentRole, normalizeAgentAction } from "../agents/agent-role-model.mjs";
import { isKnownAgentMode } from "../agents/agent-transition-policy.mjs";
import schema from "../contracts/workflow-definition/agentic-process-model.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";

export const AGENTIC_PROCESS_PROFILE = "structured-agentic-process.v1";
export const processFail = code => { throw Object.assign(new Error(code), { code }); };
const fail = processFail;
export const processId = value => typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const strings = values => Array.isArray(values) && values.length <= 128
  && values.every(value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value))
  && new Set(values).size === values.length;
export const exactKeys = (value, required, optional = []) => value && typeof value === "object" && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const implemented = ["activity", "sequence", "xor", "and", "or", "event", "loop", "multi_instance", "call"];
const descriptive = ["complex", "mixed", "event_start_exclusive", "event_start_parallel", "message_review"];
export const agenticProcessCapabilities = () => freezeShadow({ profile: AGENTIC_PROCESS_PROFILE,
  formats: ["agentic-process-model.v1"], bpmn_xml_import: false,
  constructs: [...implemented, ...descriptive].map(kind => ({ kind, representable: true, validatable: true,
    executable: implemented.includes(kind), tested: implemented.includes(kind),
    verification: implemented.includes(kind) ? "offline_runtime_fixtures" : "explicit_execution_refusal" })),
  limits: { structured_single_entry: true, cross_pool_sequence: false, arbitrary_graphs: false,
    physical_parallelism_required: false, native_execution_qualified: false } });

export function assertAgenticProcessModel(model, { executable = true, policyPins = null } = {}) {
  if (checkShadowJson(model) || validateJsonSchema(model, schema, "$", { contractKind: "workflow-definition" }).length || !exactKeys(model, ["contract_version", "model_id", "revision", "participants", "roles", "policies", "nodes", "entry"])
    || model.contract_version !== "agentic-process-model.v1" || !processId(model.model_id)
    || !Number.isSafeInteger(model.revision) || model.revision < 1) fail("PROCESS_MODEL_INVALID");
  const table = (rows, max) => {
    if (!Array.isArray(rows) || !rows.length || rows.length > max || rows.some(row => !processId(row?.id))
      || new Set(rows.map(row => row.id)).size !== rows.length) fail("PROCESS_IDS_INVALID");
    return new Map(rows.map(row => [row.id, row]));
  };
  const participants = table(model.participants, 32), roles = table(model.roles, 32), policies = table(model.policies, 32), nodes = table(model.nodes, 128);
  for (const participant of participants.values()) if (!exactKeys(participant, ["id"])) fail("PROCESS_PARTICIPANT_INVALID");
  for (const role of roles.values()) if (!exactKeys(role, ["id", "role", "action", "skills"])
    || normalizeAgentRole(role.role) !== role.role || normalizeAgentAction(role.action) !== role.action
    || !canAgentRolePerform(role.role, role.action) || !strings(role.skills)) fail("PROCESS_ROLE_INVALID");
  for (const policy of policies.values()) {
    if (!exactKeys(policy, ["id", "version", "assurance_profile", "mode", "independent_review", "context_isolation_required", "required_permissions", "allowed_permissions"])
      || !Number.isSafeInteger(policy.version) || policy.version < 1 || !strings([policy.assurance_profile])
      || !isKnownAgentMode(policy.mode) || policy.mode !== policy.mode.toUpperCase()
      || typeof policy.independent_review !== "boolean" || typeof policy.context_isolation_required !== "boolean"
      || !strings(policy.required_permissions) || !strings(policy.allowed_permissions)
      || !policy.required_permissions.every(p => policy.allowed_permissions.includes(p))) fail("PROCESS_POLICY_INVALID");
  }
  if (policyPins !== null && (!exactKeys(policyPins, [...policies.keys()])
    || [...policies].some(([id, policy]) => policyPins[id] !== shadowHash(policy)))) fail("PROCESS_REQUIRED_POLICY_CHANGED");
  const references = new Map();
  for (const node of nodes.values()) {
    if (!participants.has(node.participant_ref) || ![...implemented, ...descriptive].includes(node.kind)) fail("PROCESS_NODE_INVALID");
    const base = ["id", "kind", "participant_ref"];
    let children = [];
    if (descriptive.includes(node.kind)) {
      if (!exactKeys(node, [...base, "specification"]) || !node.specification || typeof node.specification !== "object") fail("PROCESS_DESCRIPTION_INVALID");
      if (executable) fail("PROCESS_CONSTRUCT_UNSUPPORTED");
    } else if (node.kind === "activity") {
      if (!exactKeys(node, [...base, "role_ref", "policy_ref"]) || !roles.has(node.role_ref) || !policies.has(node.policy_ref)) fail("PROCESS_ACTIVITY_INVALID");
      const role = roles.get(node.role_ref), policy = policies.get(node.policy_ref);
      if (policy.independent_review && (role.role !== "auditor" || role.action !== "audit")) fail("PROCESS_REVIEW_ROLE_INVALID");
    } else if (["sequence", "call", "loop", "multi_instance"].includes(node.kind)) {
      const extras = node.kind === "sequence" ? ["children"] : node.kind === "loop" ? ["child", "until", "max_iterations"]
        : node.kind === "multi_instance" ? ["child", "items", "ordering"] : ["child"];
      if (!exactKeys(node, [...base, ...extras])) fail("PROCESS_STRUCTURE_INVALID");
      children = node.kind === "sequence" ? node.children : [node.child];
      if (!Array.isArray(children) || !children.length || children.length > 32 || !children.every(processId) || new Set(children).size !== children.length) fail("PROCESS_STRUCTURE_INVALID");
      if (node.kind === "loop" && (!processId(node.until) || !Number.isSafeInteger(node.max_iterations) || node.max_iterations < 1 || node.max_iterations > 32)) fail("PROCESS_LOOP_INVALID");
      if (node.kind === "multi_instance" && (!Array.isArray(node.items) || node.items.length > 32 || !node.items.every(processId)
        || new Set(node.items).size !== node.items.length || !["sequential", "parallel"].includes(node.ordering))) fail("PROCESS_COLLECTION_INVALID");
    } else {
      if (!exactKeys(node, [...base, "branches"]) || !Array.isArray(node.branches) || node.branches.length < 2 || node.branches.length > 16
        || new Set(node.branches.map(b => b.flow_id)).size !== node.branches.length) fail("PROCESS_GATEWAY_INVALID");
      let defaults = 0;
      for (const branch of node.branches) {
        const extra = node.kind === "and" ? [] : node.kind === "event" ? ["event_key"] : ["condition"];
        if (!exactKeys(branch, ["flow_id", "node_id", ...extra]) || !processId(branch.flow_id) || !processId(branch.node_id)) fail("PROCESS_BRANCH_INVALID");
        if (["xor", "or"].includes(node.kind) && branch.condition !== null && !processId(branch.condition)) fail("PROCESS_CONDITION_INVALID");
        if (["xor", "or"].includes(node.kind) && branch.condition === null) defaults++;
        if (node.kind === "event" && !processId(branch.event_key)) fail("PROCESS_EVENT_INVALID");
      }
      if (defaults > 1 || node.kind === "event" && new Set(node.branches.map(b => b.event_key)).size !== node.branches.length) fail("PROCESS_AMBIGUOUS_DEFAULT_OR_EVENT");
      children = node.branches.map(b => b.node_id);
    }
    for (const child of children) {
      if (!nodes.has(child) || nodes.get(child).participant_ref !== node.participant_ref) fail("PROCESS_CROSS_PARTICIPANT_SEQUENCE");
      references.set(child, (references.get(child) ?? 0) + 1);
    }
  }
  // A tree gives every split a bounded, unambiguous join. Unsupported arbitrary
  // graphs must not be silently interpreted as structured OR or as AND.
  if (!nodes.has(model.entry) || references.has(model.entry)
    || [...nodes.keys()].some(id => id !== model.entry && references.get(id) !== 1)) fail("PROCESS_NOT_STRUCTURED");
  const visited = new Set();
  function visit(id, depth, occurrence = "root") {
    if (visited.has(id) || depth > 16) fail("PROCESS_NOT_STRUCTURED");
    // Occurrences are passed intact to agent-reuse activity_id (max 256).
    // Validate every possible suffix before execution, without truncation.
    if (executable && occurrence.length > 256) fail("PROCESS_OCCURRENCE_ID_LIMIT");
    visited.add(id); const node = nodes.get(id);
    if (node.kind === "sequence") node.children.forEach((child, index) => visit(child, depth + 1, `${occurrence}/${index}`));
    else if (node.child) {
      const suffix = node.kind === "loop" ? `iteration-${node.max_iterations}`
        : node.kind === "multi_instance" ? `item-${Math.max(0, node.items.length - 1)}` : "call";
      visit(node.child, depth + 1, `${occurrence}/${suffix}`);
    } else for (const branch of node.branches ?? []) visit(branch.node_id, depth + 1, `${occurrence}/${branch.flow_id}`);
  }
  visit(model.entry, 0);
  if (visited.size !== nodes.size) fail("PROCESS_NOT_STRUCTURED");
  return model;
}

export function agenticPolicyPins(model) {
  assertAgenticProcessModel(model, { executable: false });
  return Object.fromEntries(model.policies.map(policy => [policy.id, shadowHash(policy)]));
}
