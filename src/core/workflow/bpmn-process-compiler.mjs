import { BPMN_NS, AIDN_BPMN_NS, BPMN_EXECUTION_PROFILE, bpmnFail as fail } from "./bpmn-profile.mjs";
import { assertAgenticProcessModel, processId } from "./agentic-process-model.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";
import schema from "../contracts/workflow-definition/bpmn-process-compilation.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";

const attr = (node, name) => node.attributes.find(a => a.name === name && !a.uri)?.value;
const id = node => attr(node, "id") ?? null;
const gatewayKinds = { exclusiveGateway: "xor", parallelGateway: "and", inclusiveGateway: "or" };
const tasks = ["task", "serviceTask", "userTask"];
const graphics = new Set(["http://www.omg.org/spec/BPMN/20100524/DI", "http://www.omg.org/spec/DD/20100524/DC", "http://www.omg.org/spec/DD/20100524/DI"]);

function shape(node, attributes, children, text = false) {
  if (node.attributes.some(a => a.uri || !attributes.includes(a.name)) || (!text && node.text.trim())) fail("BPMN_PROFILE_ATTRIBUTE_UNSUPPORTED", id(node));
  for (const child of node.children) if (child.uri !== BPMN_NS || !children.includes(child.name)) fail("BPMN_PROFILE_ELEMENT_UNSUPPORTED", id(child) ?? id(node));
}

// Compile only a lossless, explicit single-process profile. A successful return
// has passed the existing executable IR validator; it grants no host authority.
export function compileBpmnProcessTree({ root, sourceSha256, modelId, revision, participantId, roles, policies }) {
  if (checkShadowJson({ root, sourceSha256, modelId, revision, participantId, roles, policies }) || !/^[a-f0-9]{64}$/.test(sourceSha256)
    || !processId(modelId) || !processId(participantId)) fail("BPMN_BINDINGS_INVALID");
  if (root.uri !== BPMN_NS || root.name !== "definitions") fail("BPMN_DEFINITIONS_REQUIRED");
  // Diagram interchange is presentation data, never executable metadata.
  const semantic = { ...root, children: root.children.filter(c => !(graphics.has(c.uri) && c.name === "BPMNDiagram")) };
  shape(semantic, ["id", "targetNamespace", "exporter", "exporterVersion"], ["process"]);
  if (semantic.children.length !== 1) fail("BPMN_SINGLE_PROCESS_REQUIRED");
  const process = semantic.children[0];
  shape(process, ["id", "name", "isExecutable"], ["startEvent", "endEvent", ...tasks, ...Object.keys(gatewayKinds), "sequenceFlow", "laneSet"]);
  if (!id(process) || attr(process, "isExecutable") !== "true") fail("BPMN_PROCESS_INVALID", id(process));
  const allIds = new Set();
  function unique(node) {
    const value = id(node);
    if (!value || !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(value) || allIds.has(value)) fail("BPMN_ID_INVALID", value);
    allIds.add(value);
  }
  unique(process);
  const elements = process.children.filter(n => n.name !== "laneSet");
  if (elements.length > 384) fail("BPMN_GRAPH_LIMIT");
  elements.forEach(unique);
  const flows = elements.filter(n => n.name === "sequenceFlow"), vertices = elements.filter(n => n.name !== "sequenceFlow");
  if (!vertices.length || vertices.length > 128) fail("BPMN_GRAPH_LIMIT");
  const byId = new Map(vertices.map(n => [id(n), n]));
  const incoming = new Map(vertices.map(n => [id(n), []])), outgoing = new Map(vertices.map(n => [id(n), []]));
  const conditions = new Map();
  for (const flow of flows) {
    shape(flow, ["id", "name", "sourceRef", "targetRef"], ["conditionExpression"]);
    if (!byId.has(attr(flow, "sourceRef")) || !byId.has(attr(flow, "targetRef"))) fail("BPMN_FLOW_REFERENCE_INVALID", id(flow));
    outgoing.get(attr(flow, "sourceRef")).push(flow); incoming.get(attr(flow, "targetRef")).push(flow);
    if (flow.children.length > 1) fail("BPMN_CONDITION_INVALID", id(flow));
    if (flow.children.length) {
      const condition = flow.children[0];
      // A Boolean fact name is the complete language. Never evaluate an expression.
      shape(condition, ["language"], [], true);
      if (attr(condition, "language") !== AIDN_BPMN_NS || !processId(condition.text.trim())) fail("BPMN_CONDITION_INVALID", id(flow));
      conditions.set(id(flow), condition.text.trim());
    }
  }
  const bindings = new Map();
  for (const node of vertices) {
    const isTask = tasks.includes(node.name), isGate = Object.hasOwn(gatewayKinds, node.name);
    if (isTask) {
      shape(node, ["id", "name"], ["incoming", "outgoing", "extensionElements"]);
      const extensions = node.children.filter(c => c.name === "extensionElements");
      if (extensions.length !== 1) fail("BPMN_EXECUTION_BINDING_REQUIRED", id(node));
      const container = extensions[0];
      if (container.attributes.length || container.text.trim() || container.children.length !== 1) fail("BPMN_EXECUTION_BINDING_INVALID", id(node));
      const execution = container.children[0];
      if (execution.uri !== AIDN_BPMN_NS || execution.name !== "execution" || execution.children.length || execution.text.trim()
        || execution.attributes.some(a => a.uri || !["roleRef", "policyRef"].includes(a.name))
        || !processId(attr(execution, "roleRef")) || !processId(attr(execution, "policyRef"))) fail("BPMN_EXECUTION_BINDING_INVALID", id(node));
      bindings.set(id(node), { role_ref: attr(execution, "roleRef"), policy_ref: attr(execution, "policyRef") });
    } else shape(node, ["id", "name", ...(isGate ? ["default", "gatewayDirection"] : [])], ["incoming", "outgoing"]);
    for (const direction of ["incoming", "outgoing"]) {
      const declared = node.children.filter(c => c.name === direction);
      for (const ref of declared) shape(ref, [], [], true);
      const actual = (direction === "incoming" ? incoming : outgoing).get(id(node)).map(id);
      if (declared.length && (new Set(declared.map(c => c.text.trim())).size !== declared.length
        || shadowHash(declared.map(c => c.text.trim()).sort()) !== shadowHash([...actual].sort()))) fail("BPMN_FLOW_DECLARATION_INVALID", id(node));
    }
    const ins = incoming.get(id(node)).length, outs = outgoing.get(id(node)).length;
    if (node.name === "startEvent" ? ins !== 0 || outs !== 1 : node.name === "endEvent" ? ins !== 1 || outs !== 0
      : isTask ? ins !== 1 || outs !== 1 : !((ins === 1 && outs >= 2 && outs <= 16) || (ins >= 2 && ins <= 16 && outs === 1))) fail("BPMN_NODE_DEGREE_INVALID", id(node));
    if (isGate) {
      const direction = attr(node, "gatewayDirection");
      if (direction && direction !== "Unspecified" && direction !== (outs > 1 ? "Diverging" : "Converging")) fail("BPMN_GATEWAY_DIRECTION_INVALID", id(node));
      const defaultFlow = attr(node, "default");
      if (defaultFlow && (!outgoing.get(id(node)).some(f => id(f) === defaultFlow) || node.name === "parallelGateway" || outs === 1)) fail("BPMN_DEFAULT_INVALID", id(node));
    }
  }
  // Lanes are responsibilities, never resource allocation. Bindings remain on tasks.
  const laneMembers = new Set();
  for (const laneSet of process.children.filter(n => n.name === "laneSet")) {
    unique(laneSet); shape(laneSet, ["id", "name"], ["lane"]);
    for (const lane of laneSet.children) {
      unique(lane); shape(lane, ["id", "name"], ["flowNodeRef"]);
      for (const ref of lane.children) {
        shape(ref, [], [], true); const member = ref.text.trim();
        if (!byId.has(member) || laneMembers.has(member)) fail("BPMN_LANE_REFERENCE_INVALID", id(lane));
        laneMembers.add(member);
      }
    }
  }
  const starts = vertices.filter(n => n.name === "startEvent"), ends = vertices.filter(n => n.name === "endEvent");
  if (starts.length !== 1 || ends.length !== 1) fail("BPMN_SINGLE_START_END_REQUIRED");
  for (const flow of flows) {
    const source = byId.get(attr(flow, "sourceRef"));
    if (["exclusiveGateway", "inclusiveGateway"].includes(source.name) && outgoing.get(id(source)).length > 1) {
      if (attr(source, "default") === id(flow) ? conditions.has(id(flow)) : !conditions.has(id(flow))) fail("BPMN_CONDITION_REQUIRED", id(flow));
    } else if (conditions.has(id(flow))) fail("BPMN_CONDITION_UNSUPPORTED", id(flow));
  }
  // Postdominators on a DAG identify the nearest mandatory convergence. Cycles,
  // overlapping scopes and branches bypassing their join are refused.
  const post = new Map(), active = new Set();
  function postdominators(key) {
    if (active.has(key)) fail("BPMN_CYCLE_UNSUPPORTED", key);
    if (post.has(key)) return post.get(key);
    active.add(key);
    const successors = outgoing.get(key).map(f => postdominators(attr(f, "targetRef")));
    const intersection = successors.length ? [...successors[0]].filter(v => successors.every(s => s.has(v))) : [];
    const result = new Set([key, ...intersection]); post.set(key, result); active.delete(key); return result;
  }
  vertices.forEach(n => postdominators(id(n)));
  const nodes = [], sourceMap = [], visited = new Set(); let serial = 0;
  const irIds = new Map(vertices.map((n, i) => [id(n), `n_${i}`]));
  const flowIds = new Map(flows.map((n, i) => [id(n), `f_${i}`]));
  const emit = (sourceId, node) => { nodes.push({ ...node, participant_ref: participantId }); sourceMap.push({ bpmn_id: sourceId, ir_node_id: node.id }); return node.id; };
  function block(key, stop, depth = 0) {
    if (depth > 16) fail("BPMN_STRUCTURE_LIMIT", key);
    const children = [];
    while (key !== stop) {
      if (visited.has(key)) fail("BPMN_NOT_STRUCTURED", key);
      visited.add(key); const node = byId.get(key), edges = outgoing.get(key);
      if (tasks.includes(node.name)) children.push(emit(key, { id: irIds.get(key), kind: "activity", ...bindings.get(key) }));
      else if (edges.length > 1) {
        const candidates = [...post.get(key)].filter(v => v !== key).sort((a, b) => post.get(b).size - post.get(a).size);
        const joinId = candidates[0], join = byId.get(joinId);
        if (!join || joinId === stop || join.name !== node.name || incoming.get(joinId).length !== edges.length || outgoing.get(joinId).length !== 1
          || attr(join, "default")) fail("BPMN_STRUCTURED_JOIN_REQUIRED", key);
        const branches = edges.map(flow => ({ flow_id: flowIds.get(id(flow)), node_id: block(attr(flow, "targetRef"), joinId, depth + 1),
          ...(node.name === "parallelGateway" ? {} : { condition: attr(node, "default") === id(flow) ? null : conditions.get(id(flow)) }) }));
        if (visited.has(joinId)) fail("BPMN_NOT_STRUCTURED", joinId);
        visited.add(joinId);
        children.push(emit(key, { id: irIds.get(key), kind: gatewayKinds[node.name], branches }));
        sourceMap.push({ bpmn_id: joinId, ir_node_id: irIds.get(key) });
        key = attr(outgoing.get(joinId)[0], "targetRef"); continue;
      } else if (Object.hasOwn(gatewayKinds, node.name)) fail("BPMN_UNMATCHED_JOIN", key);
      if (!edges.length) { if (stop !== null) fail("BPMN_NOT_STRUCTURED", key); break; }
      key = attr(edges[0], "targetRef");
    }
    if (!children.length) fail("BPMN_EMPTY_BLOCK_UNSUPPORTED", key);
    return children.length === 1 ? children[0] : emit(id(process), { id: `s_${serial++}`, kind: "sequence", children });
  }
  const entry = block(id(starts[0]), null);
  if (visited.size !== vertices.length) fail("BPMN_UNREACHABLE_ELEMENT");
  const model = { contract_version: "agentic-process-model.v1", model_id: modelId, revision,
    participants: [{ id: participantId }], roles: structuredClone(roles), policies: structuredClone(policies), nodes, entry };
  assertAgenticProcessModel(model);
  const compilation = { contract_version: "bpmn-process-compilation.v1", profile: BPMN_EXECUTION_PROFILE,
    source_sha256: sourceSha256, model_sha256: shadowHash(model), model, source_map: sourceMap };
  if (validateJsonSchema(compilation, schema, "$", { contractKind: "workflow-definition" }).length) fail("BPMN_COMPILATION_INVALID");
  return freezeShadow(compilation);
}
