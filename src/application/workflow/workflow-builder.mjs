import { createWorkflowProject, updateWorkflowProject } from "./workflow-project-edit.mjs";
import { compileBpmnProject } from "./bpmn-project-service.mjs";
import { checkShadowJson } from "../../core/workflow/shadow-json.mjs";

function invalid() {
  throw Object.assign(new Error("WORKFLOW_AUTHOR_STRUCTURE_INVALID"), { code: "WORKFLOW_AUTHOR_STRUCTURE_INVALID" });
}

/**
 * Author a project using the same edits, role assignments and catalog as the
 * graphical editor. The order of the arrays is the sequence order on the diagram.
 */
export function buildWorkflowProject(definition, catalog) {
  if (checkShadowJson(definition) || !definition || typeof definition !== "object" ||
      Object.keys(definition).some(key => !["id", "steps"].includes(key))) invalid();
  let project = createWorkflowProject({ id: definition.id });
  function append(steps, parent, modelId) {
    if (!Array.isArray(steps)) invalid();
    for (const step of steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) invalid();
      const { then, otherwise, body, ...edit } = step;
      if (Object.hasOwn(edit, "parent") || Object.hasOwn(edit, "model_id") ||
          (edit.kind !== "xor" && (then !== undefined || otherwise !== undefined)) ||
          (edit.kind !== "call" && body !== undefined)) invalid();
      project = updateWorkflowProject(project, { ...edit, parent, model_id: modelId }, catalog);
      if (then !== undefined) append(then, edit.id + "_yes", modelId);
      if (otherwise !== undefined) append(otherwise, edit.id + "_no", modelId);
      if (body !== undefined) append(body, "root", edit.target);
    }
  }
  append(definition.steps, "root", definition.id);
  compileBpmnProject(project);
  return project;
}
