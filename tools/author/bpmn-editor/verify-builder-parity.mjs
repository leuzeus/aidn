import assert from "node:assert/strict";
import { buildWorkflowProject } from "../../../src/application/workflow/workflow-builder.mjs";
import { compileBpmnProject } from "../../../src/application/workflow/bpmn-project-service.mjs";

export function verifyBuilderParity({ project, diagnostic }, catalog) {
  const id = project.manifest.models[0].model_id;
  const definition = { id, steps: [
    { kind: "operation", id: "reload_context", operation_ref: "context_reload@1" },
    { kind: "evaluation", id: "quality", evaluator_ref: "cycle_validation@1",
      fields: { validation_operation_id: { source: "parameter", key: "validation_id", path: [] } } },
    { kind: "xor", id: "route", condition: "cycle_checks_passed", then: [
      { kind: "activity", id: "review", role_ref: "mode_analyst", policy_ref: "thinking_analysis_policy" }
    ], otherwise: [
      { kind: "call", id: "rework", target: "repair_flow", fields: {}, body: [] }
    ] }
  ] };
  const built = buildWorkflowProject(definition, catalog);
  assert.equal(built.manifest.contract_version, "workflow-project.v1");
  assert.deepEqual(built.manifest.models, project.manifest.models);
  const source = compileBpmnProject(built), graphic = compileBpmnProject(project);
  assert.deepEqual(source.model, graphic.model);
  assert.equal(source.model_sha256, graphic.model_sha256);
  const invalid = { ...definition, steps: [...definition.steps, { kind: "xor", id: "bad_route", condition: "not a fact" }] };
  assert.throws(() => buildWorkflowProject(invalid, catalog),
    error => error.code === diagnostic.error && error.element_id === diagnostic.element_id);
  assert.equal(diagnostic.error, "BPMN_CONDITION_INVALID");
  assert.equal(diagnostic.element_id, "bad_route");
  console.log("PASS the JS builder and saved graphical workflow have identical IR, hash, bindings, calls and rejected-edit diagnostics");
}
