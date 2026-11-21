import { BPMN_NS, AIDN_BPMN_NS, bpmnFail as fail, bpmnAttribute as attr, bpmnId as id } from "./bpmn-profile.mjs";
import { processId } from "./agentic-process-model.mjs";
import { readBpmnActivity } from "./bpmn-activity-profile.mjs";

export const projectProcessId = row => `P_${row.model_id}_${row.revision}`;
export const projectDiagramName = row => `${row.model_id}.${row.revision}.bpmn`;
const di = "http://www.omg.org/spec/BPMN/20100524/DI";
const xsi = "http://www.w3.org/2001/XMLSchema-instance";
const aidn = (node, key) => node.attributes.find(a => a.uri === AIDN_BPMN_NS && a.name === key)?.value;
const gatewayTypes = { xor: "exclusiveGateway", or: "inclusiveGateway", and: "parallelGateway", event: "eventBasedGateway" };
const vertices = ["startEvent", "endEvent", "task", "serviceTask", "userTask", "subProcess", "callActivity",
  ...Object.values(gatewayTypes), "intermediateCatchEvent"];
const links = ["incoming", "outgoing"];
const decorations = ["extensionElements", "standardLoopCharacteristics", "multiInstanceLoopCharacteristics"];
function shape(node, attributes, extensions, children, text = false) {
  if (node.uri !== BPMN_NS || (!text && node.text.trim()) || node.attributes.some(a =>
    !(a.uri === "" && attributes.includes(a.name) || a.uri === AIDN_BPMN_NS && extensions.includes(a.name)
      || node.name === "conditionExpression" && a.uri === xsi && a.name === "type" && /^(?:\w+:)?tFormalExpression$/.test(a.value))))
    fail("BPMN_PROFILE_ATTRIBUTE_UNSUPPORTED", id(node));
  for (const child of node.children)
    if (child.uri !== BPMN_NS || !children.includes(child.name)) fail("BPMN_PROFILE_ELEMENT_UNSUPPORTED", id(child) ?? id(node));
}
function index(node, key) {
  const raw = aidn(node, key);
  if (!/^(?:0|[1-9]\d{0,2})$/.test(raw ?? "")) fail("BPMN_PROJECT_ORDER_INVALID", id(node));
  return Number(raw);
}
function one(list, owner) {
  if (list.length !== 1) fail("BPMN_PROJECT_STRUCTURE_INVALID", id(owner));
  return list[0];
}

export function compileProjectDiagram(root, row, targets, pins) {
  if (root.name !== "definitions") fail("BPMN_DEFINITIONS_REQUIRED");
  const semantic = { ...root, children: root.children.filter(n => !(n.name === "BPMNDiagram" && n.uri === di)) };
  shape(semantic, ["id", "targetNamespace", "exporter", "exporterVersion"], [], ["process", "message"]);
  const identifiers = new Set();
  function identify(node) {
    const key = id(node);
    if (key !== null) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key) || identifiers.has(key)) fail("BPMN_ID_INVALID", key);
      identifiers.add(key);
    }
    node.children.forEach(identify);
  }
  identify(semantic);
  const messages = new Set();
  for (const message of semantic.children.filter(n => n.name === "message")) {
    shape(message, ["id", "name"], [], []);
    if (!id(message)?.startsWith("M_") || !processId(id(message).slice(2))) fail("BPMN_EVENT_KEY_INVALID", id(message));
    messages.add(id(message));
  }
  const process = one(semantic.children.filter(n => n.name === "process"), semantic);
  if (id(process) !== projectProcessId(row) || attr(process, "isExecutable") !== "true") fail("BPMN_PROCESS_INVALID", id(process));
  shape(process, ["id", "name", "isExecutable"], [], [...vertices, "sequenceFlow"]);
  const records = [], usedPins = new Map();
  function readNode(element, depth) {
    if (depth > 16 || records.length >= 256) fail("BPMN_STRUCTURE_LIMIT", id(element));
    const nodeId = id(element)?.slice(2);
    if (!id(element)?.startsWith("N_") || !processId(nodeId)) fail("BPMN_ID_INVALID", id(element));
    const order = index(element, "order");
    const node = { id: nodeId, participant_ref: aidn(element, "participant") };
    records.push({ order, node, bpmn_id: id(element) });
    const metadata = ["order", "participant"];
    if (["task", "serviceTask", "userTask"].includes(element.name)) {
      shape(element, ["id", "name"], [...metadata, "reliability", "maxRetries", "waitTimeoutMs"], [...links, "extensionElements"]);
      const task = { ...element, attributes: element.attributes.filter(a => !a.uri) };
      const { binding } = readBpmnActivity(task, pins);
      Object.assign(node, { kind: "activity" }, binding);
      const version = aidn(element, "reliability"), retries = aidn(element, "maxRetries"), timeout = aidn(element, "waitTimeoutMs");
      if (version !== undefined || retries !== undefined || timeout !== undefined) {
        if (node.kind !== "operation" || version !== "operation-reliability.v1" ||
            [retries, timeout].some(value => value !== undefined && !/^(?:0|[1-9][0-9]{0,15})$/.test(value)))
          fail("PROCESS_OPERATION_RELIABILITY_INVALID", id(element));
        node.reliability = { contract_version: version,
          ...(retries === undefined ? {} : { max_retries: Number(retries) }),
          ...(timeout === undefined ? {} : { wait_timeout_ms: Number(timeout) }) };
      }
      if (node.kind === "operation") usedPins.set(node.binding_ref, pins.get(node.binding_ref));
    } else if (element.name === "callActivity") {
      shape(element, ["id", "name", "calledElement"], [...metadata, "sha256"], links);
      const target = targets.get(attr(element, "calledElement"));
      if (!target) fail("PROCESS_CALL_TARGET_MISSING", id(element));
      if (!target.model_sha256 || aidn(element, "sha256") !== target.model_sha256) fail("PROCESS_CALL_TARGET_CHANGED", id(element));
      node.kind = "call";
      node.target = { model_id: target.model_id, revision: target.revision, model_sha256: target.model_sha256 };
    } else if (element.name === "subProcess") {
      shape(element, ["id", "name"], [...metadata, "kind"], [...vertices, "sequenceFlow", ...links, ...decorations]);
      node.kind = aidn(element, "kind");
      const body = readScope(element, node.kind, depth + 1);
      const extra = element.children.filter(c => decorations.includes(c.name));
      if (["loop", "multi_instance"].includes(node.kind)) {
        const repetitionElements = structuredClone(extra);
        for (const repeat of repetitionElements) for (const child of repeat.children) {
          if (["loopCondition", "loopCardinality"].includes(child.name)) child.attributes = child.attributes.filter(a =>
            !(a.uri === xsi && a.name === "type" && /^(?:\w+:)?tFormalExpression$/.test(a.value)));
        }
        const synthetic = { ...element, name: "callActivity", attributes: [], children: repetitionElements };
        const { repetition } = readBpmnActivity(synthetic);
        if (repetition?.kind !== node.kind) fail("BPMN_REPETITION_INVALID", id(element));
        Object.assign(node, repetition);
      } else if (extra.length) fail("BPMN_REPETITION_INVALID", id(element));
      if (node.kind === "sequence") node.children = body;
      else if (Object.hasOwn(gatewayTypes, node.kind)) node.branches = body;
      else if (["loop", "multi_instance", "call"].includes(node.kind)) node.child = one(body, element);
      else fail("BPMN_PROFILE_ELEMENT_UNSUPPORTED", id(element));
    } else fail("BPMN_PROFILE_ELEMENT_UNSUPPORTED", id(element));
    return nodeId;
  }

  function readScope(owner, kind, depth) {
    const nodes = owner.children.filter(n => vertices.includes(n.name));
    const flows = owner.children.filter(n => n.name === "sequenceFlow");
    const incoming = new Map(nodes.map(n => [id(n), []])), outgoing = new Map(nodes.map(n => [id(n), []]));
    const byId = new Map(nodes.map(n => [id(n), n]));
    for (const flow of flows) {
      shape(flow, ["id", "name", "sourceRef", "targetRef"], ["flowId", "order"], ["conditionExpression"]);
      if (!id(flow) || !outgoing.has(attr(flow, "sourceRef")) || !incoming.has(attr(flow, "targetRef")))
        fail("BPMN_FLOW_REFERENCE_INVALID", id(flow));
      outgoing.get(attr(flow, "sourceRef")).push(flow);
      incoming.get(attr(flow, "targetRef")).push(flow);
    }
    const visited = new Set(), usedFlows = new Set();
    function visit(node) {
      if (!node || !id(node) || visited.has(node)) fail("BPMN_NOT_STRUCTURED", id(node ?? owner));
      visited.add(node);
      for (const [name, edges] of [["incoming", incoming], ["outgoing", outgoing]]) {
        const declared = node.children.filter(c => c.name === name);
        for (const ref of declared) shape(ref, [], [], [], true);
        if (declared.length && (declared.length !== edges.get(id(node)).length ||
          edges.get(id(node)).some(f => !declared.some(c => c.text.trim() === id(f))))) fail("BPMN_FLOW_DECLARATION_INVALID", id(node));
      }
      return node;
    }
    function through(flow, branch = false) {
      if (!branch && (flow.children.length || flow.attributes.some(a => a.uri))) fail("BPMN_CONDITION_UNSUPPORTED", id(flow));
      usedFlows.add(flow);
      return byId.get(attr(flow, "targetRef"));
    }
    const next = node => through(one(outgoing.get(id(node)), node));
    const start = visit(one(nodes.filter(n => n.name === "startEvent"), owner));
    const end = one(nodes.filter(n => n.name === "endEvent"), owner);
    for (const delimiter of [start, end]) shape(delimiter, ["id", "name"], [], links);
    let current = next(start);
    const body = [];
    if (Object.hasOwn(gatewayTypes, kind)) {
      const split = visit(current);
      shape(split, ["id", "name", "default", "gatewayDirection"], [], links);
      if (split.name !== gatewayTypes[kind] || ![undefined, "Diverging", "Unspecified"].includes(attr(split, "gatewayDirection")))
        fail("BPMN_GATEWAY_DIRECTION_INVALID", id(split));
      const branches = outgoing.get(id(split)).map(flow => ({ order: index(flow, "order"), flow })).sort((a,b) => a.order - b.order);
      let join;
      for (const [position, { order, flow }] of branches.entries()) {
        if (order !== position) fail("BPMN_PROJECT_ORDER_INVALID", id(flow));
        let child = through(flow, true);
        const branch = { flow_id: aidn(flow, "flowId") };
        if (["xor", "or"].includes(kind) && attr(split, "default") !== id(flow)) {
          const condition = one(flow.children, flow);
          shape(condition, ["language"], [], [], true);
          if (attr(condition, "language") !== AIDN_BPMN_NS || !processId(condition.text.trim())) fail("BPMN_CONDITION_INVALID", id(flow));
          branch.condition = condition.text.trim();
        } else {
          if (flow.children.length) fail("BPMN_CONDITION_INVALID", id(flow));
          if (["xor", "or"].includes(kind)) branch.condition = null;
        }
        if (kind === "event") {
          const catcher = visit(child);
          if (catcher.name !== "intermediateCatchEvent") fail("BPMN_EVENT_CATCH_REQUIRED", id(catcher));
          shape(catcher, ["id", "name"], [], [...links, "messageEventDefinition"]);
          const definition = one(catcher.children.filter(c => c.name === "messageEventDefinition"), catcher);
          shape(definition, ["id", "messageRef"], [], []);
          const key = attr(definition, "messageRef");
          if (!messages.has(key)) fail("BPMN_EVENT_KEY_INVALID", id(catcher));
          branch.event_key = key.slice(2);
          child = next(catcher);
        }
        branch.node_id = readNode(visit(child), depth);
        body.push(branch);
        const candidate = next(child);
        if (join && candidate !== join) fail("BPMN_STRUCTURED_JOIN_REQUIRED", id(split));
        join = candidate;
      }
      if (attr(split, "default") && (!["xor", "or"].includes(kind) || !branches.some(b => id(b.flow) === attr(split, "default"))))
        fail("BPMN_DEFAULT_INVALID", id(split));
      visit(join);
      shape(join, ["id", "name", "gatewayDirection"], [], links);
      if (join.name !== (kind === "event" ? "exclusiveGateway" : gatewayTypes[kind])
        || ![undefined, "Converging", "Unspecified"].includes(attr(join, "gatewayDirection"))) fail("BPMN_STRUCTURED_JOIN_REQUIRED", id(join));
      current = next(join);
    } else {
      while (current !== end) {
        body.push(readNode(visit(current), depth));
        current = next(current);
      }
    }
    if (current !== end) fail("BPMN_PROJECT_STRUCTURE_INVALID", id(owner));
    visit(end);
    if (usedFlows.size !== flows.length || visited.size !== nodes.length) fail("BPMN_UNREACHABLE_ELEMENT", id(owner));
    return body;
  }

  const entry = one(readScope(process, "sequence", 0), process);
  records.sort((a,b) => a.order - b.order);
  records.forEach((r, i) => { if (r.order !== i) fail("BPMN_PROJECT_ORDER_INVALID", r.bpmn_id); });
  const model = { contract_version: "agentic-process-model.v2", model_id: row.model_id, revision: row.revision,
    participants: row.participants, roles: row.roles, policies: row.policies, entry,
    nodes: records.map(r => r.node), operation_pins: Object.fromEntries(usedPins) };
  for (const key of ["data_bindings", "call_interface"]) if (Object.hasOwn(row, key)) model[key] = row[key];
  return { model, source_map: records.map(r => ({ bpmn_id: r.bpmn_id, ir_node_id: r.node.id })) };
}
