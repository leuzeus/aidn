import { readProjectBpmnXml } from "../../adapters/workflow/bpmn-xml.mjs";
import { applyWorkflowRoleProfile } from "../../core/agents/workflow-role-profile.mjs";
import { assertAgenticProcessModel, exactKeys, processId } from "../../core/workflow/agentic-process-model.mjs";
import { bpmnFail as fail } from "../../core/workflow/bpmn-profile.mjs";
import { compileProjectDiagram, projectDiagramName, projectProcessId } from "../../core/workflow/bpmn-project-diagram.mjs";
import { indexBpmnOperationBindings } from "../../core/workflow/bpmn-operation-bindings.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "../../core/workflow/shadow-json.mjs";

import { assertOperationReliability, noOperationReliability } from "../../core/workflow/operation-reliability.mjs";
import { installedStandardOperationReliability } from "./installed-operation-reliability.mjs";

export function compileBpmnProject({ manifest, diagrams }, { resolveReliability = installedStandardOperationReliability } = {}) {
  if (checkShadowJson(manifest)) fail("BPMN_PROJECT_MANIFEST_INVALID");
  const project = manifest?.contract_version === "workflow-project.v1";
  if (!exactKeys(manifest, ["contract_version", "models", ...(project ? ["project_revision"] : [])], ["catalog_sha256"])
    || (project ? !Number.isSafeInteger(manifest.project_revision) || manifest.project_revision < 1 : manifest.contract_version !== "bpmn-model-project.v1")
    || !Array.isArray(manifest.models)
    || !manifest.models.length || manifest.models.length > 33 || (Object.hasOwn(manifest, "catalog_sha256") && !/^[a-f0-9]{64}$/.test(manifest.catalog_sha256))) fail("BPMN_PROJECT_MANIFEST_INVALID");
  const rows = structuredClone(manifest.models);
  const targets = new Map();
  for (const [i, row] of rows.entries()) {
    if (!exactKeys(row, ["model_id", "revision", "participants", "roles", "policies", "operation_bindings",
      ...(i ? ["model_sha256"] : [])], ["data_bindings", "call_interface", ...(project ? ["role_profile"] : [])]) || !processId(row.model_id)
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || (i && !/^[a-f0-9]{64}$/.test(row.model_sha256))
      || targets.has(projectProcessId(row))) fail("BPMN_PROJECT_MANIFEST_INVALID");
    targets.set(projectProcessId(row), row);
  }
  if (!exactKeys(diagrams, rows.map(projectDiagramName)) || ![Object.prototype, null].includes(Object.getPrototypeOf(diagrams))
    || Object.values(Object.getOwnPropertyDescriptors(diagrams)).some(d => !("value" in d))) fail("BPMN_PROJECT_FILES_INVALID");
  let total = 0;
  for (const xml of Object.values(diagrams)) {
    if (typeof xml !== "string" || (total += Buffer.byteLength(xml, "utf8")) > 8 * 1024 * 1024) fail("BPMN_PROJECT_LIMIT");
  }
  const source_maps = [], models = [];
  for (const row of rows) {
    try {
      const pins = indexBpmnOperationBindings(row.operation_bindings);
      const { model, source_map } = compileProjectDiagram(readProjectBpmnXml(diagrams[projectDiagramName(row)]), row, targets, pins);
      if (Object.hasOwn(row, "role_profile")) applyWorkflowRoleProfile(model, row.role_profile);
      for (const node of model.nodes) if (node.reliability) {
        const binding = row.operation_bindings.find(operation => operation.id === node.binding_ref);
        try { assertOperationReliability(node.reliability, resolveReliability(binding) ?? noOperationReliability); }
        catch (error) { error.element_id = "N_" + node.id; throw error; }
      }
      if (pins.size !== Object.keys(model.operation_pins).length) fail("BPMN_OPERATION_BINDINGS_UNUSED");
      if (row.model_sha256 && shadowHash(model) !== row.model_sha256) fail("PROCESS_CALL_TARGET_CHANGED");
      source_maps.push({ model_id: row.model_id, revision: row.revision, source_map });
      models.push(model);
    } catch (error) {
      error.model_id = row.model_id;
      error.revision = row.revision;
      throw error;
    }
  }
  const [model, ...children] = models;
  if (children.length) model.call_targets = children.map((child, i) => ({
    model_id: child.model_id, revision: child.revision, model_sha256: rows[i + 1].model_sha256, model: child }));
  assertAgenticProcessModel(model);
  return freezeShadow({ contract_version: "bpmn-project-compilation.v1", model, model_sha256: shadowHash(model), source_maps });
}
