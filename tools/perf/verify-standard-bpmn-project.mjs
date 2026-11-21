import assert from "node:assert/strict";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { exportStandardBpmnProject, compareStandardBpmnProject } from "../../src/application/workflow/standard-bpmn-project.mjs";
import { compileBpmnProject } from "../../src/application/workflow/bpmn-project-service.mjs";
import { readBpmnXml, readProjectBpmnXml } from "../../src/adapters/workflow/bpmn-xml.mjs";
import { processModels } from "../../src/core/workflow/process-call-model.mjs";
import { assertStandardWorkflowActivityOutputs } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";
import { projectDiagramName } from "../../src/core/workflow/bpmn-project-diagram.mjs";

const assets = loadStandardWorkflowAssets(), project = exportStandardBpmnProject(assets);
const rootFile = projectDiagramName(assets.model), result = compileBpmnProject(project);
assert.deepEqual(result.model, assets.model);
const comparison = compareStandardBpmnProject(project, assets);
assert.equal(comparison.count, 0);
assert.equal(comparison.candidate_sha256, assets.catalog.model.sha256);
const models = processModels(result.model);
assert.equal(result.source_maps.length, models.length);
for (const [i, model] of models.entries())
  assert.deepEqual(result.source_maps[i].source_map.map(r => r.ir_node_id), model.nodes.map(n => n.id));
assertStandardWorkflowActivityOutputs(assets.source, result.model, Object.fromEntries(assets.catalog.activities.map(a => [a.node_id, a.output_contract])));
console.log(`PASS published STANDARD: ${models.length} models, ${models.reduce((n,m)=>n+m.nodes.length,0)} nodes, ${assets.catalog.bindings.length} operation bindings, ${assets.catalog.activities.length} activity contracts, SHA-256 ${comparison.candidate_sha256}`);
assert.throws(() => readBpmnXml(project.diagrams[rootFile]), /BPMN_XML_LIMIT/);
assert.throws(() => readProjectBpmnXml(" ".repeat(1048577)), /BPMN_XML_LIMIT/);
console.log("PASS the project XML allowance is bounded and scoped to project compilation");
const changed = structuredClone(project);
const definition = changed.manifest.models[0].operation_bindings[0];
definition.revision++;
assert.throws(() => compareStandardBpmnProject(changed, assets), e =>
  e.code === "BPMN_OPERATION_BINDING_CHANGED" && e.model_id === assets.model.model_id && e.element_id?.startsWith("N_"));
const changedCatalog = structuredClone(project);
changedCatalog.manifest.catalog_sha256 = "0".repeat(64);
assert.throws(() => compareStandardBpmnProject(changedCatalog, assets), /BPMN_PROJECT_CATALOG_CHANGED/);
console.log("PASS an altered binding identifies its diagram and task, and a substituted catalog refuses");

const stripped = structuredClone(project);
const task = assets.model.nodes.find(node => node.kind === "operation");
const elementId = "N_" + task.id;
const xml = stripped.diagrams[rootFile];
const taskStart = xml.indexOf('id="' + elementId + '"');
assert.ok(taskStart >= 0);
const bindingStart = xml.indexOf("<aidn:operation ", taskStart);
assert.ok(bindingStart > taskStart && bindingStart < xml.indexOf("</bpmn:serviceTask>", taskStart));
const bindingEnd = xml.indexOf("/>", bindingStart) + 2;
stripped.diagrams[rootFile] = xml.slice(0, bindingStart) + xml.slice(bindingEnd);
assert.throws(() => compileBpmnProject(stripped), error =>
  error.code === "BPMN_EXECUTION_BINDING_INVALID" &&
  error.model_id === assets.model.model_id && error.element_id === elementId);
console.log("PASS a stripped operation extension identifies the published model and BPMN task");
