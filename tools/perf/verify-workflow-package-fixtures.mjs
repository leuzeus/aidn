import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadWorkflowPackage } from "../../src/application/workflow/workflow-package.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { verifyStandardWorkflowComponentAssets } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";
import { createAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import descriptor from "../../package/catalogs/standard.workflow-package.json" with { type: "json" };
import projectSchema from "../../src/core/contracts/workflow-definition/workflow-project.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import { exportStandardBpmnProject } from "../../src/application/workflow/standard-bpmn-project.mjs";
import { compileBpmnProject } from "../../src/application/workflow/bpmn-project-service.mjs";

const root = new URL("../../", import.meta.url);
const verify = assets => verifyStandardWorkflowComponentAssets({ ...assets, bindings: standardWorkflowOperationBindings() });
const startup = { ...descriptor, model: "package/catalogs/process-models/aidn-standard-startup.v1.json",
  catalog: "package/catalogs/standard-workflow-startup.v1.json", skills: descriptor.skills.filter(name => /aidn-(context-reload|start-session)\//.test(name)) };
assert.equal(loadWorkflowPackage(root, startup, verify).model.model_id, "aidn-standard-startup");
assert.throws(() => loadWorkflowPackage(root, { ...startup, model: "../outside" }, verify), /WORKFLOW_PACKAGE_INVALID/);
assert.throws(() => loadWorkflowPackage(root, { ...startup, skills: [] }, verify), /SKILL_CHANGED/);
assert.throws(() => loadWorkflowPackage(root, { ...startup, model: descriptor.model }, verify), /MODEL_CHANGED/);
assert.throws(() => loadWorkflowPackage(root, { ...startup, module: "other.mjs" }, verify), /WORKFLOW_PACKAGE_INVALID/);
const standard = loadStandardWorkflowAssets();
const project = exportStandardBpmnProject(standard);
assert.deepEqual(validateJsonSchema(project.manifest, projectSchema, "$", { contractKind: "workflow-definition" }), []);
const revised = { ...project.manifest, project_revision: project.manifest.project_revision + 1 };
assert.equal(compileBpmnProject({ ...project, manifest: revised }).model_sha256, standard.source.model_sha256);
console.log("PASS common package loader, resource restrictions and independent author revision");

if (process.argv[2]) {
  const priorRoot = path.resolve(process.argv[2]);
  const read = name => fs.readFileSync(path.join(priorRoot, name));
  const model = JSON.parse(read(descriptor.model));
  const catalog = JSON.parse(read(descriptor.catalog));
  const instance = createAgenticProcess({ instanceId: "archived", scopeId: "fixture", model, policyPins: agenticPolicyPins(model),
    parameters: { session: {}, cycle: {} } });
  const retained = JSON.parse(JSON.stringify(instance));
  inspectAgenticProcess(retained);
  assert.equal(retained.model_sha256, catalog.model.sha256);
  assert.deepEqual(retained.model.operation_pins, model.operation_pins);
  assert.throws(() => verify({ catalog, model, specification: read(descriptor.specification),
    skills: Object.fromEntries(descriptor.skills.map(name => [name, read(name)])) }), /IMPLEMENTATION_CHANGED/);
  assert.equal(shadowHash(retained), shadowHash(instance));
  console.log("PASS historical model revision", model.revision, "replays and refuses unavailable implementation pins");
}
