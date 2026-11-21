import { assertAgenticProcessModel } from "./agentic-process-model.mjs";
import { processModels } from "./process-call-model.mjs";
import { BPMN_NS, AIDN_BPMN_NS, bpmnFail as fail } from "./bpmn-profile.mjs";
import { projectProcessId, projectDiagramName } from "./bpmn-project-diagram.mjs";
import { indexBpmnOperationBindings, resolveBpmnOperation } from "./bpmn-operation-bindings.mjs";
import { checkShadowJson, freezeShadow } from "./shadow-json.mjs";

const attrText = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const properties = values => Object.entries(values).map(([key, value]) => ` ${key}="${attrText(value)}"`).join("");
const tag = (name, attributes, body = "") => body
  ? `<${name}${properties(attributes)}>${body}</${name}>` : `<${name}${properties(attributes)}/>`;
const bpmn = (name, attributes, content) => tag("bpmn:" + name, attributes, content);
const gatewayTypes = { xor: "exclusiveGateway", and: "parallelGateway", or: "inclusiveGateway", event: "eventBasedGateway" };

function exportDiagram(model) {
  const nodes = new Map(model.nodes.map((node, order) => [node.id, { node, order }]));
  const planes = [], messages = new Set();
  let serial = 0;
  const allocate = prefix => prefix + "_" + (++serial);
  function scope(owner, kind, children, branches = []) {
    const elements = [], flows = [], shapes = [], edges = [], bounds = new Map();
    const plane = { id: owner, shapes, edges };
    planes.push(plane);
    function place(id, name, attributes, body, column, row) {
      const small = name.endsWith("Event") || name.endsWith("Gateway");
      const width = small ? 42 : 150, height = small ? 42 : 80;
      const x = 60 + column * 220, y = 60 + row * 125 + (80 - height) / 2;
      bounds.set(id, { x, y, width, height });
      elements.push(bpmn(name, { id, ...attributes }, body));
      shapes.push(tag("bpmndi:BPMNShape", { id: "DI_" + id, bpmnElement: id, ...(name === "subProcess" ? { isExpanded: false } : {}) },
        tag("dc:Bounds", { x, y, width, height })));
      return id;
    }
    function connect(a, b, attributes = {}, body = "", flowId = allocate("F")) {
      flows.push(bpmn("sequenceFlow", { id: flowId, sourceRef: a, targetRef: b, ...attributes }, body));
      const from = bounds.get(a), to = bounds.get(b);
      const x1 = from.x + from.width, y1 = from.y + from.height / 2, x2 = to.x, y2 = to.y + to.height / 2;
      const mid = Math.round((x1 + x2) / 2);
      const points = [[x1,y1], ...(y1 === y2 ? [] : [[mid,y1],[mid,y2]]), [x2,y2]];
      edges.push(tag("bpmndi:BPMNEdge", { id: "DI_" + flowId, bpmnElement: flowId },
        points.map(([x,y]) => tag("di:waypoint", { x,y })).join("")));
    }
    function placeNode(key, column, row) {
      const { node, order } = nodes.get(key), id = "N_" + key;
      const meta = { name: key, "aidn:participant": node.participant_ref, "aidn:order": order };
      if (node.kind === "activity" || node.kind === "operation") {
        const operation = node.kind === "operation";
        const binding = operation ? tag("aidn:operation", { bindingRef: node.binding_ref, sha256: model.operation_pins[node.binding_ref] })
          : tag("aidn:execution", { roleRef: node.role_ref, policyRef: node.policy_ref });
        return place(id, operation ? "serviceTask" : "task", meta, bpmn("extensionElements", {}, binding), column, row);
      }
      if (node.target) return place(id, "callActivity", { ...meta, calledElement: projectProcessId(node.target),
        "aidn:sha256": node.target.model_sha256 }, "", column, row);
      let extension = "", repetition = "";
      if (node.kind === "loop") {
        extension = tag("aidn:iterationLimit", { maxIterations: node.max_iterations, onLimit: "fail" });
        repetition = bpmn("standardLoopCharacteristics", { testBefore: false },
          bpmn("loopCondition", { language: AIDN_BPMN_NS, "xsi:type": "bpmn:tFormalExpression" }, `not(${node.until})`));
      } else if (node.kind === "multi_instance") {
        extension = tag("aidn:collection", { items: node.items.join(" ") });
        repetition = bpmn("multiInstanceLoopCharacteristics", { isSequential: node.ordering === "sequential" },
          bpmn("loopCardinality", {}, String(node.items.length)));
      }
      const nested = scope(id, node.kind, node.children ?? (node.child ? [node.child] : []), node.branches);
      return place(id, "subProcess", { ...meta, "aidn:kind": node.kind },
        (extension ? bpmn("extensionElements", {}, extension) : "") + nested + repetition, column, row);
    }
    const center = branches.length ? (branches.length - 1) / 2 : 0;
    const start = place(allocate("Start"), "startEvent", {}, "", 0, center);
    if (Object.hasOwn(gatewayTypes, kind)) {
      const ids = branches.map(() => allocate("F"));
      const defaultIndex = branches.findIndex(b => b.condition === null);
      const split = place(allocate("Split"), gatewayTypes[kind], { gatewayDirection: "Diverging",
        ...(defaultIndex >= 0 ? { default: ids[defaultIndex] } : {}) }, "", 1, center);
      const join = place(allocate("Join"), kind === "event" ? "exclusiveGateway" : gatewayTypes[kind], { gatewayDirection: "Converging" }, "", 4, center);
      connect(start, split);
      for (const [i, branch] of branches.entries()) {
        const target = placeNode(branch.node_id, 3, i);
        let first = target;
        if (kind === "event") {
          messages.add(branch.event_key);
          first = place(allocate("Catch"), "intermediateCatchEvent", {}, bpmn("messageEventDefinition", { messageRef: "M_" + branch.event_key }), 2, i);
          connect(first, target);
        }
        const expression = branch.condition ? bpmn("conditionExpression",
          { language: AIDN_BPMN_NS, "xsi:type": "bpmn:tFormalExpression" }, branch.condition) : "";
        connect(split, first, { "aidn:flowId": branch.flow_id, "aidn:order": i }, expression, ids[i]);
        connect(target, join);
      }
      connect(join, place(allocate("End"), "endEvent", {}, "", 5, center));
    } else {
      let last = start;
      for (const [i, child] of children.entries()) {
        const current = placeNode(child, i + 1, 0);
        connect(last, current);
        last = current;
      }
      connect(last, place(allocate("End"), "endEvent", {}, "", children.length + 1, 0));
    }
    return elements.join("\n") + "\n" + flows.join("\n");
  }
  const process = projectProcessId(model);
  const content = scope(process, "sequence", [model.entry]);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + bpmn("definitions", {
    "xmlns:bpmn": BPMN_NS, "xmlns:aidn": AIDN_BPMN_NS, "xmlns:bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "xmlns:dc": "http://www.omg.org/spec/DD/20100524/DC", "xmlns:di": "http://www.omg.org/spec/DD/20100524/DI",
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance", targetNamespace: "urn:aidn:bpmn:project:v1" },
  [...messages].map(key => bpmn("message", { id: "M_" + key, name: key })).join("") + bpmn("process", { id: process, isExecutable: true }, content)
    + planes.map(p => tag("bpmndi:BPMNDiagram", { id: "Diagram_" + p.id }, tag("bpmndi:BPMNPlane", { id: "Plane_" + p.id, bpmnElement: p.id },
      p.shapes.join("\n") + "\n" + p.edges.join("\n")))).join("\n")) + "\n";
}

export function exportBpmnProject(model, definitionsByDiagram = {}) {
  assertAgenticProcessModel(model);
  if (model.contract_version !== "agentic-process-model.v2" || checkShadowJson(definitionsByDiagram))
    fail("BPMN_PROJECT_EXPORT_INVALID");
  const manifest = { contract_version: "workflow-project.v1", project_revision: 1, models: [] }, diagrams = {};
  for (const [i, current] of processModels(model).entries()) {
    const file = projectDiagramName(current);
    const definitions = Object.hasOwn(definitionsByDiagram, file) ? definitionsByDiagram[file] : [];
    const pins = indexBpmnOperationBindings(definitions);
    for (const [ref, digest] of Object.entries(current.operation_pins)) resolveBpmnOperation(pins, ref, digest, file);
    if (pins.size !== Object.keys(current.operation_pins).length) fail("BPMN_OPERATION_BINDINGS_UNUSED", file);
    const row = { model_id: current.model_id, revision: current.revision, participants: current.participants, roles: current.roles,
      policies: current.policies, operation_bindings: definitions };
    for (const key of ["data_bindings", "call_interface"]) if (Object.hasOwn(current, key)) row[key] = current[key];
    if (i) row.model_sha256 = model.call_targets[i-1].model_sha256;
    manifest.models.push(structuredClone(row));
    diagrams[file] = exportDiagram(current);
  }
  if (Object.keys(definitionsByDiagram).some(file => !Object.hasOwn(diagrams, file))) fail("BPMN_PROJECT_FILES_INVALID");
  return freezeShadow({ manifest, diagrams });
}
