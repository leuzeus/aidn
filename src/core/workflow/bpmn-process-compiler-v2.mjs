import { BPMN_NS, AIDN_BPMN_NS, BPMN_EXTENDED_EXECUTION_PROFILE, bpmnAttribute as attr, bpmnId as id, assertBpmnShape as shape, bpmnFail as fail } from "./bpmn-profile.mjs";
import { assertAgenticProcessModel, processId } from "./agentic-process-model.mjs";
import { compileBpmnProcessTree } from "./bpmn-process-compiler.mjs";
import { readBpmnActivity } from "./bpmn-activity-profile.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";
import schema from "../contracts/workflow-definition/bpmn-process-compilation.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";

const tasks = ["task", "serviceTask", "userTask", "callActivity"];
const xmlNode = (name, attributes = {}, children = [], text = "") => ({ name, uri: BPMN_NS,
  attributes: Object.entries(attributes).map(([name, value]) => ({ name, uri: "", value })), children, text });
const execution = binding => ({ name: "execution", uri: AIDN_BPMN_NS, attributes: [
  { name: "roleRef", uri: "", value: binding.role_ref }, { name: "policyRef", uri: "", value: binding.policy_ref }], children: [], text: "" });

// V2 lowers new constructs to the V1 structured graph checker, then replaces
// validated placeholders with existing IR primitives. No alternate reducer.
export function compileExtendedBpmnProcessTree(input) {
  if (checkShadowJson(input)) fail("BPMN_BINDINGS_INVALID");
  const { root, sourceSha256, modelId, revision, participantId, roles, policies, processRef } = input;
  if (!root || root.uri !== BPMN_NS || root.name !== "definitions") fail("BPMN_DEFINITIONS_REQUIRED");
  const semantic = structuredClone(root);
  semantic.children = semantic.children.filter(c => !(c.uri === "http://www.omg.org/spec/BPMN/20100524/DI" && c.name === "BPMNDiagram"));
  shape(semantic, ["id", "targetNamespace", "exporter", "exporterVersion"], ["process", "message"]);
  const ids = new Set();
  function scan(node) {
    const key = id(node);
    if (key !== null) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key) || ids.has(key)) fail("BPMN_ID_INVALID", key);
      ids.add(key);
    }
    node.children.forEach(scan);
  }
  scan(semantic);
  const processes = new Map(semantic.children.filter(n => n.name === "process").map(n => [id(n), n]));
  if (!processes.size || processes.size > 32 || processes.has(null)) fail("BPMN_PROCESS_INVALID");
  const messages = new Set();
  for (const message of semantic.children.filter(n => n.name === "message")) {
    shape(message, ["id", "name"], []);
    if (!id(message)) fail("BPMN_ID_INVALID"); messages.add(id(message));
  }
  const selected = processRef ?? (processes.size === 1 ? processes.keys().next().value : null);
  if (!selected || !processes.has(selected)) fail("BPMN_PROCESS_SELECTION_REQUIRED", selected);
  const sourceElements = [...processes.values()].flatMap(p => p.children.filter(n => n.name !== "laneSet"));
  if (sourceElements.length > 384 || sourceElements.filter(n => n.name !== "sequenceFlow").length > 128) fail("BPMN_GRAPH_LIMIT");
  const active = new Set(), used = new Set(); let serial = 0;
  function compileProcess(processKey) {
    if (!processes.has(processKey)) fail("BPMN_CALL_REFERENCE_INVALID");
    if (active.has(processKey)) fail("BPMN_CALL_RECURSION_UNSUPPORTED", processKey);
    if (active.size >= 16) fail("BPMN_STRUCTURE_LIMIT", processKey);
    active.add(processKey); used.add(processKey);
    const process = structuredClone(processes.get(processKey));
    shape(process, ["id", "name", "isExecutable"], ["startEvent", "endEvent", ...tasks, "exclusiveGateway", "parallelGateway", "inclusiveGateway",
      "eventBasedGateway", "intermediateCatchEvent", "sequenceFlow", "laneSet"]);
    const flows = process.children.filter(n => n.name === "sequenceFlow"), vertices = process.children.filter(n => !["sequenceFlow", "laneSet"].includes(n.name));
    const byId = new Map(vertices.map(n => [id(n), n]));
    const incoming = new Map(vertices.map(n => [id(n), []])), outgoing = new Map(vertices.map(n => [id(n), []]));
    for (const flow of flows) {
      shape(flow, ["id", "name", "sourceRef", "targetRef"], ["conditionExpression"]);
      if (!id(flow) || !byId.has(attr(flow, "sourceRef")) || !byId.has(attr(flow, "targetRef"))) fail("BPMN_FLOW_REFERENCE_INVALID", id(flow));
      outgoing.get(attr(flow, "sourceRef")).push(flow); incoming.get(attr(flow, "targetRef")).push(flow);
    }
    // Validate original declarations before removing catch delimiters. A wrong
    // authored reference must never become valid just through normalization.
    for (const node of vertices) {
      if (!id(node)) fail("BPMN_ID_INVALID");
      for (const direction of ["incoming", "outgoing"]) {
        const declared = node.children.filter(c => c.name === direction);
        declared.forEach(ref => shape(ref, [], [], true));
        const actual = (direction === "incoming" ? incoming : outgoing).get(id(node)).map(id).sort();
        if (declared.length && (new Set(declared.map(c => c.text.trim())).size !== declared.length
          || shadowHash(declared.map(c => c.text.trim()).sort()) !== shadowHash(actual))) fail("BPMN_FLOW_DECLARATION_INVALID", id(node));
      }
    }
    const activities = new Map(), called = new Map(), eventKeys = new Map(), catchOwners = new Map(), removedFlows = new Map();
    for (const node of vertices.filter(n => tasks.includes(n.name))) {
      const spec = readBpmnActivity(node); activities.set(id(node), spec);
      if (node.name === "callActivity") {
        if (!processes.has(spec.calledElement)) fail("BPMN_CALL_REFERENCE_INVALID", id(node));
        called.set(id(node), compileProcess(spec.calledElement));
      }
    }
    for (const node of vertices.filter(n => n.name === "eventBasedGateway")) {
      shape(node, ["id", "name", "gatewayDirection", "instantiate", "eventGatewayType"], ["incoming", "outgoing"]);
      if (![undefined, "false"].includes(attr(node, "instantiate")) || ![undefined, "Exclusive"].includes(attr(node, "eventGatewayType"))) fail("BPMN_EVENT_GATEWAY_UNSUPPORTED", id(node));
      if (incoming.get(id(node)).length !== 1 || outgoing.get(id(node)).length < 2 || outgoing.get(id(node)).length > 16) fail("BPMN_NODE_DEGREE_INVALID", id(node));
      const keys = [];
      for (const branch of outgoing.get(id(node))) {
        if (branch.children.length) fail("BPMN_CONDITION_UNSUPPORTED", id(branch));
        const catcher = byId.get(attr(branch, "targetRef"));
        if (catcher.name !== "intermediateCatchEvent") fail("BPMN_EVENT_CATCH_REQUIRED", id(catcher));
        shape(catcher, ["id", "name"], ["incoming", "outgoing", "messageEventDefinition"]);
        const definitions = catcher.children.filter(c => c.name === "messageEventDefinition");
        if (definitions.length !== 1 || incoming.get(id(catcher)).length !== 1 || outgoing.get(id(catcher)).length !== 1) fail("BPMN_EVENT_CATCH_INVALID", id(catcher));
        shape(definitions[0], ["id", "messageRef"], []);
        const key = attr(definitions[0], "messageRef");
        if (!messages.has(key) || !processId(key)) fail("BPMN_EVENT_KEY_INVALID", id(catcher));
        const exit = outgoing.get(id(catcher))[0];
        if (exit.children.length || byId.get(attr(exit, "targetRef")).name === "intermediateCatchEvent") fail("BPMN_EVENT_CATCH_INVALID", id(catcher));
        keys.push(key); eventKeys.set(id(branch), key); catchOwners.set(id(catcher), id(node)); removedFlows.set(id(exit), branch);
      }
      if (new Set(keys).size !== keys.length) fail("BPMN_EVENT_KEY_INVALID", id(node));
      // An exclusive event race converges at an ordinary XOR merge in BPMN.
      node.name = "exclusiveGateway";
      node.attributes = node.attributes.filter(a => !["instantiate", "eventGatewayType"].includes(a.name));
    }
    for (const catcher of vertices.filter(n => n.name === "intermediateCatchEvent")) if (!catchOwners.has(id(catcher))) fail("BPMN_EVENT_CATCH_SCOPE_UNSUPPORTED", id(catcher));
    // The graph checker still owns scopes, postdominators, reachability and joins.
    const normalized = structuredClone(process);
    normalized.children = process.children.filter(n => !catchOwners.has(id(n)) && !removedFlows.has(id(n))).map(node => {
      const copy = structuredClone(node), spec = activities.get(id(node));
      if (spec) {
        const binding = spec.binding ?? called.get(id(node)).model.nodes.find(n => n.kind === "activity");
        copy.name = "task"; copy.attributes = copy.attributes.filter(a => ["id", "name"].includes(a.name));
        copy.children = [...copy.children.filter(c => ["incoming", "outgoing"].includes(c.name)), xmlNode("extensionElements", {}, [execution(binding)])];
      }
      if (copy.name === "sequenceFlow" && eventKeys.has(id(copy))) {
        const catcher = byId.get(attr(copy, "targetRef"));
        copy.attributes.find(a => a.name === "targetRef").value = attr(outgoing.get(id(catcher))[0], "targetRef");
        copy.children = [xmlNode("conditionExpression", { language: AIDN_BPMN_NS }, [], eventKeys.get(id(copy)))];
      }
      function declarations(element) {
        if (["incoming", "outgoing"].includes(element.name) && removedFlows.has(element.text.trim())) element.text = id(removedFlows.get(element.text.trim()));
        element.children.forEach(declarations);
      }
      declarations(copy); return copy;
    });
    // Catch responsibility cannot be collapsed into a gateway lane: preserve
    // original lane membership validation, then omit catch refs in the skeleton.
    const laneMembers = new Set();
    for (const laneSet of process.children.filter(n => n.name === "laneSet")) {
      shape(laneSet, ["id", "name"], ["lane"]);
      for (const lane of laneSet.children) {
        shape(lane, ["id", "name"], ["flowNodeRef"]);
        for (const ref of lane.children) {
          shape(ref, [], [], true); const member = ref.text.trim();
          if (!byId.has(member) || laneMembers.has(member)) fail("BPMN_LANE_REFERENCE_INVALID", id(lane)); laneMembers.add(member);
        }
      }
    }
    for (const laneSet of normalized.children.filter(n => n.name === "laneSet")) for (const lane of laneSet.children) {
      // Regenerate refs from authored membership; catch refs have no IR activity.
      const original = process.children.find(n => id(n) === id(laneSet)).children.find(n => id(n) === id(lane));
      lane.children = structuredClone(original.children.filter(ref => !catchOwners.has(ref.text.trim())));
    }
    const skeleton = compileBpmnProcessTree({ root: { ...semantic, children: [normalized] }, sourceSha256, modelId, revision, participantId, roles, policies });
    const model = structuredClone(skeleton.model), sourceMap = structuredClone(skeleton.source_map);
    function append(sourceId, node) {
      if (model.nodes.length >= 128) fail("BPMN_EXPANSION_LIMIT", sourceId);
      model.nodes.push(node); sourceMap.push({ bpmn_id: sourceId, ir_node_id: node.id });
    }
    for (const [sourceId, spec] of activities) {
      const node = model.nodes.find(n => n.id === sourceMap.find(row => row.bpmn_id === sourceId).ir_node_id);
      if (called.has(sourceId)) {
        const child = called.get(sourceId);
        if (model.nodes.length + child.model.nodes.length > 128) fail("BPMN_EXPANSION_LIMIT", sourceId);
        const remap = new Map(child.model.nodes.map(n => [n.id, `x_${serial++}`]));
        for (const original of child.model.nodes) {
          const cloned = { ...structuredClone(original), id: remap.get(original.id) };
          if (cloned.child) cloned.child = remap.get(cloned.child);
          if (cloned.children) cloned.children = cloned.children.map(c => remap.get(c));
          if (cloned.branches) cloned.branches.forEach(b => { b.node_id = remap.get(b.node_id); });
          model.nodes.push(cloned);
        }
        sourceMap.push(...child.source_map.map(row => ({ ...row, ir_node_id: remap.get(row.ir_node_id) })));
        delete node.role_ref; delete node.policy_ref; node.kind = "call"; node.child = remap.get(child.model.entry);
      }
      if (spec.repetition) {
        const body = { ...node, id: `x_${serial++}` }; append(sourceId, body);
        for (const key of Object.keys(node)) if (!["id", "participant_ref"].includes(key)) delete node[key];
        Object.assign(node, spec.repetition, { child: body.id });
      }
    }
    for (const [catchId, owner] of catchOwners) {
      const node = model.nodes.find(n => n.id === sourceMap.find(row => row.bpmn_id === owner).ir_node_id);
      if (node.kind !== "event") {
        node.kind = "event";
        node.branches.forEach(branch => { branch.event_key = branch.condition; delete branch.condition; });
      }
      sourceMap.push({ bpmn_id: catchId, ir_node_id: node.id });
    }
    assertAgenticProcessModel(model);
    const result = { ...skeleton, profile: BPMN_EXTENDED_EXECUTION_PROFILE, model, model_sha256: shadowHash(model), source_map: sourceMap };
    if (validateJsonSchema(result, schema, "$", { contractKind: "workflow-definition" }).length) fail("BPMN_COMPILATION_INVALID");
    active.delete(processKey); return result;
  }
  const compiled = compileProcess(selected);
  if (used.size !== processes.size) fail("BPMN_UNUSED_PROCESS_DEFINITION");
  return freezeShadow(compiled);
}
