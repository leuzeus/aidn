import { compileBpmnProject } from "./bpmn-project-service.mjs";
import { exportBpmnProject } from "../../core/workflow/bpmn-project-export.mjs";
import { projectDiagramName, projectProcessId } from "../../core/workflow/bpmn-project-diagram.mjs";
import { processId } from "../../core/workflow/agentic-process-model.mjs";
import { processModels, processModelIdentity } from "../../core/workflow/process-call-model.mjs";
import { bpmnAttribute } from "../../core/workflow/bpmn-profile.mjs";
import { readProjectBpmnXml } from "../../adapters/workflow/bpmn-xml.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = (code, element_id) => { throw Object.assign(new Error(code), { code, element_id }); };
const safeId = id => processId(id) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id);
function emptyModel(id, participant = "project") {
  if (!safeId(id)) fail("WORKFLOW_AUTHOR_ID_INVALID", id);
  return { contract_version: "agentic-process-model.v2", model_id: id, revision: 1, participants: [{ id: participant }],
    roles: [], policies: [], nodes: [{ id: "root", kind: "sequence", children: [], participant_ref: participant }], entry: "root",
    operation_pins: {}, data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: [], inputs: [] } };
}
export function createWorkflowProject({ id }) {
  return exportBpmnProject(emptyModel(id));
}

export function duplicateWorkflowProject(project, id) {
  compileBpmnProject(project);
  if (!safeId(id) || project.manifest.models.some(row => row.model_id === id)) fail("WORKFLOW_AUTHOR_ID_INVALID", id);
  const result = structuredClone(project);
  delete result.manifest.catalog_sha256;
  const root = result.manifest.models[0], oldFile = projectDiagramName(root), before = projectProcessId(root);
  root.model_id = id; root.revision = 1;
  if (Object.hasOwn(result.manifest, "project_revision")) result.manifest.project_revision = 1;
  const after = projectProcessId(root);
  const xml = result.diagrams[oldFile].replaceAll('"' + before + '"', '"' + after + '"');
  delete result.diagrams[oldFile];
  result.diagrams[projectDiagramName(root)] = xml;
  compileBpmnProject(result);
  return result;
}

function carryLayout(before, after) {
  // Preserve authored bounds and routes whenever both endpoint identities survive.
  const shapes = new Map(), endpoints = new Map(), edges = new Map(), di = [];
  function visit(node) {
    if (node.name === "sequenceFlow") endpoints.set(bpmnAttribute(node, "id"),
      [bpmnAttribute(node, "sourceRef"), bpmnAttribute(node, "targetRef")].join(" "));
    if (node.name === "BPMNShape" || node.name === "BPMNEdge") di.push(node);
    node.children.forEach(visit);
  }
  visit(readProjectBpmnXml(before));
  function geometry(node, attrs) {
    const numbers = attrs.map(key => bpmnAttribute(node, key));
    if (!numbers.every(n => n !== undefined && /^-?\d+(?:\.\d+)?$/.test(n))) return null;
    return attrs.map((key, index) => key + '="' + numbers[index] + '"').join(" ");
  }
  for (const node of di) {
    const key = bpmnAttribute(node, "bpmnElement");
    if (node.name === "BPMNShape") {
      const bounds = node.children.find(c => c.name === "Bounds");
      if (bounds) shapes.set(key, geometry(bounds, ["x", "y", "width", "height"]));
    } else {
      const points = node.children.filter(c => c.name === "waypoint").map(c => geometry(c, ["x", "y"]));
      if (points.length >= 2 && points.every(Boolean)) edges.set(endpoints.get(key), points.map(p => "<di:waypoint " + p + "/>").join(""));
    }
  }
  const targetEndpoints = new Map();
  for (const match of after.matchAll(/<bpmn:sequenceFlow id="([^"]+)" sourceRef="([^"]+)" targetRef="([^"]+)"/g))
    targetEndpoints.set(match[1], match[2] + " " + match[3]);
  return after.replace(/(<bpmndi:BPMNShape [^>]*bpmnElement="([^"]+)"[^>]*>)<dc:Bounds [^>]*\/>/g,
    (original, start, key) => shapes.get(key) ? start + "<dc:Bounds " + shapes.get(key) + "/>" : original)
    .replace(/(<bpmndi:BPMNEdge [^>]*bpmnElement="([^"]+)"[^>]*>)(?:<di:waypoint [^>]*\/>)+/g,
      (original, start, key) => edges.has(targetEndpoints.get(key)) ? start + edges.get(targetEndpoints.get(key)) : original);
}

function mapping(model, id, fields) {
  model.data_bindings ??= { contract_version: "process-data-bindings.v4", parameter_keys: [], inputs: [] };
  for (const expr of Object.values(fields)) if (expr.source === "parameter" && !model.data_bindings.parameter_keys.includes(expr.key)) {
    model.data_bindings.parameter_keys.push(expr.key);
    if (model.call_interface && !Object.hasOwn(model.call_interface.parameters, expr.key))
      fail("WORKFLOW_AUTHOR_CALL_PARAMETER_UNDECLARED", id);
  }
  const previous = model.data_bindings.inputs.find(row => row.node_id === id);
  if (previous) previous.fields = structuredClone(fields);
  else model.data_bindings.inputs.push({ node_id: id, fields: structuredClone(fields) });
}

export function updateWorkflowProject(project, edit, catalog) {
  const originalRoot = compileBpmnProject(project).model;
  const originalModels = new Map(processModels(originalRoot).map(m => [projectDiagramName(m), m]));
  const root = structuredClone(originalRoot);
  const models = processModels(root), targetModel = edit.model_id ?? root.model_id;
  const candidates = models.filter(row => row.model_id === targetModel &&
    (edit.model_revision === undefined || row.revision === edit.model_revision));
  if (candidates.length > 1) fail("WORKFLOW_AUTHOR_MODEL_REVISION_REQUIRED", targetModel);
  const [model] = candidates;
  if (!model || !processId(edit.id)) fail("WORKFLOW_AUTHOR_ID_INVALID", edit.id);
  const definitions = new Map(project.manifest.models.map(row => [projectDiagramName(row), row.operation_bindings]));
  const parent = model.nodes.find(row => row.id === (edit.parent ?? model.entry));
  const existing = model.nodes.find(row => row.id === edit.id);
  if (!existing && parent?.kind !== "sequence") fail("WORKFLOW_AUTHOR_SEQUENCE_REQUIRED", edit.parent);
  const participant_ref = existing?.participant_ref ?? parent.participant_ref;
  let node = { id: edit.id, kind: edit.kind, participant_ref };
  if (edit.kind === "activity") {
    for (const [table, ref] of [["roles", edit.role_ref], ["policies", edit.policy_ref]]) {
      const item = catalog[table].find(row => row.id === ref) ?? model[table].find(row => row.id === ref);
      if (!item) fail("WORKFLOW_AUTHOR_REFERENCE_UNKNOWN", ref);
      if (!model[table].some(row => row.id === ref)) model[table].push(structuredClone(item));
    }
    node = { ...node, role_ref: edit.role_ref, policy_ref: edit.policy_ref };
  } else if (edit.kind === "operation" || edit.kind === "evaluation") {
    const ref = edit.kind === "evaluation" ? catalog.evaluators.find(row => row.id + "@" + row.revision === edit.evaluator_ref)?.operation_ref : edit.operation_ref;
    const op = catalog.operations.find(row => row.ref === ref);
    if (!op) fail("WORKFLOW_AUTHOR_OPERATION_UNKNOWN", edit.evaluator_ref ?? ref);
    node = { ...node, kind: "operation", binding_ref: op.binding.id };
    const file = projectDiagramName(model);
    const listed = definitions.get(file) ?? [];
    const prior = listed.find(row => row.id === op.binding.id);
    if (prior && shadowHash(prior) !== shadowHash(op.binding)) fail("WORKFLOW_AUTHOR_BINDING_CONFLICT", op.binding.id);
    if (!prior) definitions.set(file, [...listed, op.binding]);
    model.operation_pins[op.binding.id] = shadowHash(op.binding);
    const fields = { ...(edit.fields ?? {}) };
    for (const field of op.inputs) {
      if (Object.hasOwn(field.schema, "const")) fields[field.name] = { source: "literal", value: field.schema.const };
      if (field.required && !Object.hasOwn(fields, field.name)) fail("WORKFLOW_AUTHOR_INPUT_REQUIRED", field.name);
    }
    if (Object.keys(fields).some(name => !op.inputs.some(field => field.name === name))) fail("WORKFLOW_AUTHOR_INPUT_UNKNOWN", edit.id);
    mapping(model, edit.id, fields);
  } else if (edit.kind === "xor") {
    if (!processId(edit.condition)) fail("BPMN_CONDITION_INVALID", edit.id);
    if (existing) {
      if (existing.kind !== "xor") fail("WORKFLOW_AUTHOR_KIND_CONFLICT", edit.id);
      const branch = existing.branches.find(row => row.flow_id === (edit.flow_id ?? existing.branches.find(b => b.condition)?.flow_id));
      if (!branch) fail("WORKFLOW_AUTHOR_REFERENCE_UNKNOWN", edit.flow_id);
      branch.condition = edit.condition; node = existing;
    } else {
      const branch = (suffix, condition) => {
        const node_id = edit.id + "_" + suffix;
        model.nodes.push({ id: node_id, participant_ref, kind: "sequence", children: [] });
        return { flow_id: suffix, node_id, condition };
      };
      node.branches = [branch("yes", edit.condition), branch("no", null)];
    }
  } else if (edit.kind === "call") {
    const choices = (root.call_targets ?? []).filter(row => row.model_id === edit.target &&
      (edit.target_revision === undefined || row.revision === edit.target_revision));
    if (choices.length > 1) fail("WORKFLOW_AUTHOR_MODEL_REVISION_REQUIRED", edit.target);
    let [child] = choices;
    if (!child) {
      if (edit.target === root.model_id) fail("PROCESS_CALL_RECURSION", edit.id);
      const target = emptyModel(edit.target, participant_ref);
      target.call_interface = { parameters: structuredClone(edit.parameters ?? {}), returns: {} };
      target.data_bindings.parameter_keys = Object.keys(target.call_interface.parameters);
      child = { ...processModelIdentity(target), model: target };
      (root.call_targets ??= []).push(child); models.push(target);
    } else if (edit.parameters && shadowHash(edit.parameters) !== shadowHash(child.model.call_interface.parameters)) {
      child.model.call_interface.parameters = structuredClone(edit.parameters);
      child.model.data_bindings.parameter_keys = Object.keys(edit.parameters);
    }
    model.data_bindings ??= { contract_version: "process-data-bindings.v4", parameter_keys: [], inputs: [] };
    model.data_bindings.contract_version = "process-data-bindings.v4";
    node.target = processModelIdentity(child.model); mapping(model, edit.id, edit.fields ?? {});
  } else fail("WORKFLOW_AUTHOR_KIND_UNKNOWN", edit.kind);
  if (existing) {
    if (existing.kind !== node.kind) fail("WORKFLOW_AUTHOR_KIND_CONFLICT", edit.id);
    model.nodes[model.nodes.indexOf(existing)] = node;
  } else { model.nodes.push(node); parent.children.push(edit.id); }
  for (const [ref] of Object.entries(model.operation_pins)) if (!model.nodes.some(n => n.binding_ref === ref)) delete model.operation_pins[ref];
  const file = projectDiagramName(model);
  definitions.set(file, (definitions.get(file) ?? []).filter(def => Object.hasOwn(model.operation_pins, def.id)));

  const visited = new Set(), visiting = new Set();
  function repin(current) {
    if (visiting.has(current)) fail("PROCESS_CALL_RECURSION", current.model_id);
    if (visited.has(current)) return;
    visiting.add(current);
    for (const call of current.nodes.filter(n => n.target)) {
      const child = root.call_targets.find(row => row.model_id === call.target.model_id && row.revision === call.target.revision);
      repin(child.model); Object.assign(child, processModelIdentity(child.model)); call.target = processModelIdentity(child.model);
    }
    visiting.delete(current); visited.add(current);
  }
  repin(root);
  const result = structuredClone(exportBpmnProject(root, Object.fromEntries(definitions)));
  if (Object.hasOwn(project.manifest, "catalog_sha256")) result.manifest.catalog_sha256 = project.manifest.catalog_sha256;
  if (Object.hasOwn(result.manifest, "project_revision")) result.manifest.project_revision = (project.manifest.project_revision ?? 0) + 1;
  for (const name of Object.keys(result.diagrams)) if (Object.hasOwn(project.diagrams, name)) {
    const original = project.manifest.models.find(row => projectDiagramName(row) === name);
    const before = project.diagrams[name], updated = models.find(row => projectDiagramName(row) === name);
    const newRow = result.manifest.models.find(row => projectDiagramName(row) === name);
    if (original.role_profile) {
      if (updated.roles.some(role => !original.roles.some(row => row.id === role.id))) fail("WORKFLOW_AUTHOR_ROLE_BINDING_REQUIRED", edit.role_ref);
      newRow.roles = structuredClone(original.roles);
      newRow.role_profile = structuredClone(original.role_profile);
    }
    const diagramSemantics = m => ({ nodes: m.nodes, entry: m.entry, operation_pins: m.operation_pins });
    result.diagrams[name] = shadowHash(diagramSemantics(originalModels.get(name))) === shadowHash(diagramSemantics(updated)) ?
      before : carryLayout(before, result.diagrams[name]);
  }
  compileBpmnProject(result);
  return result;
}
