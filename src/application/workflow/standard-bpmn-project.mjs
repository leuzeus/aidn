import { loadStandardWorkflowAssets } from "../runtime/standard-workflow-composition.mjs";
import { compileBpmnProject } from "./bpmn-project-service.mjs";
import { exportBpmnProject } from "../../core/workflow/bpmn-project-export.mjs";
import { projectDiagramName } from "../../core/workflow/bpmn-project-diagram.mjs";
import { assertStandardWorkflowModelSource } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { bpmnFail as fail } from "../../core/workflow/bpmn-profile.mjs";
import { freezeShadow } from "../../core/workflow/shadow-json.mjs";

export function exportStandardBpmnProject(assets = loadStandardWorkflowAssets()) {
  const definitions = new Map();
  for (const row of assets.catalog.bindings) {
    const file = projectDiagramName(row.model_ref ?? assets.model);
    if (!definitions.has(file)) definitions.set(file, new Map());
    definitions.get(file).set(row.binding.id, row.binding);
  }
  const project = exportBpmnProject(assets.model, Object.fromEntries([...definitions].map(([file, byId]) => [file, [...byId.values()]])));
  return freezeShadow({ manifest: { ...project.manifest, catalog_sha256: assets.source.catalog_sha256 }, diagrams: project.diagrams });
}

export function compareBpmnModels(before, after) {
  const differences = [];
  let count = 0;
  function visit(left, right, path, node) {
    if (left === right) return;
    if (left && right && typeof left === "object" && typeof right === "object" && Array.isArray(left) === Array.isArray(right)) {
      if (!Array.isArray(left) && left.kind && left.id) node = left.id;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
        visit(left[key], right[key], [...path, key], node);
      return;
    }
    count++;
    if (count <= 24) differences.push({ path: "/" + path.map(k => k.replaceAll("~", "~0").replaceAll("/", "~1")).join("/"),
      ...(node ? { node_id: node } : {}), before: left ?? null, after: right ?? null });
  }
  visit(before, after, [], null);
  return { count, differences };
}

export function compareStandardBpmnProject(project, assets = loadStandardWorkflowAssets()) {
  if (project.manifest?.catalog_sha256 !== assets.source.catalog_sha256) fail("BPMN_PROJECT_CATALOG_CHANGED");
  const result = compileBpmnProject(project);
  const delta = compareBpmnModels(assets.model, result.model);
  if (delta.count === 0) assertStandardWorkflowModelSource(assets.source, result.model);
  return { baseline_sha256: assets.source.model_sha256, candidate_sha256: result.model_sha256, ...delta };
}
