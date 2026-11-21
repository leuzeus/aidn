import schema from "../contracts/workflow-definition/native-host-state.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { assertAgenticProcessInstance, assertProcessResult, inspectAgenticProcess } from "./agentic-process.mjs";
import { canAgentRolePerform } from "../agents/agent-role-model.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// Structural/provenance closure only. The owner must authenticate the retained
// envelope and supervisor closure before using this as resume authority.
export function assertNativeHostState(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail("NATIVE_HOST_STATE_INVALID");
  assertAgenticProcessInstance(value.instance);
  const cursor = inspectAgenticProcess(value.instance);
  const resources = new Map(value.resources.map(row => [row.executor.execution_id, row]));
  if (resources.size !== value.resources.length || new Set(value.results.map(row => row.result.result_id)).size !== value.results.length
    || new Set(value.resources.map(row => row.executor.session_id)).size !== value.resources.length) fail("NATIVE_HOST_STATE_IDENTITY_AMBIGUOUS");
  for (const row of value.resources) {
    const e = row.executor;
    if (!canAgentRolePerform(e.role, e.action) || new Set(e.permissions).size !== e.permissions.length
      || new Set(e.guarantees).size !== e.guarantees.length || new Set(row.skills).size !== row.skills.length) fail("NATIVE_HOST_STATE_RESOURCE_INVALID");
  }
  for (const event of value.instance.events.filter(event => event.kind === "assign")) {
    const row = resources.get(event.decision.execution_id);
    if (!row || ["agent_id", "lineage_id", "session_id", "adapter_id"].some(key => row.executor[key] !== event.decision[key])
      || event.decision.authority_id !== value.authority_id) fail("NATIVE_HOST_STATE_ASSIGNMENT_UNBOUND");
  }
  for (const row of value.results) {
    const assignment = value.instance.events.find(event => event.kind === "assign" && event.decision.execution_id === row.resource
      && shadowHash(event.request) === row.result.request_sha256);
    if (!assignment || row.resource !== row.result.execution_id || !resources.has(row.resource)) fail("NATIVE_HOST_STATE_RESULT_UNBOUND");
    assertProcessResult(row.result, assignment);
    const frame = cursor.occurrences.find(frame => frame.occurrence_id === assignment.occurrence_id), node = value.instance.model.nodes.find(node => node.id === frame?.node_id);
    const policy = value.instance.model.policies.find(policy => policy.id === node?.policy_ref);
    if (!policy?.independent_review && !resources.get(row.resource).executor.contributions.some(c => c.scope_id === value.instance.scope_id
      && c.revision === assignment.request.revision && c.activity_id === assignment.occurrence_id
      && c.artifact_sha256 === assignment.request.artifact_sha256 && c.role === assignment.request.role)) fail("NATIVE_HOST_STATE_CONTRIBUTION_MISSING");
  }
  for (const event of value.instance.events.filter(event => event.kind === "result")) {
    const row = value.results.find(row => row.result.result_id === event.result.result_id);
    if (!row || shadowHash(row.result) !== shadowHash(event.result)) fail("NATIVE_HOST_STATE_RESULT_UNBOUND");
  }
  return value;
}
