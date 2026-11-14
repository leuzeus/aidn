import fs from "node:fs";
import { createStandardWorkflowOperationHost } from "./standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { verifyStandardWorkflowComponentAssets } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { freezeShadow } from "../../core/workflow/shadow-json.mjs";

export const STANDARD_CYCLE_CATALOG_PATH = "package/catalogs/standard-workflow-cycle-create.v1.json";
export const STANDARD_CYCLE_MODEL_PATH = "package/catalogs/process-models/aidn-standard-cycle-create.v1.json";
const root = new URL("../../../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root));
export function loadStandardWorkflowCycleAssets() {
  const catalog = JSON.parse(read(STANDARD_CYCLE_CATALOG_PATH)), model = JSON.parse(read(STANDARD_CYCLE_MODEL_PATH));
  const skills = Object.fromEntries(["context-reload", "cycle-create", "branch-cycle-audit"].map(id => {
    const path = `scaffold/codex/aidn-${id}/SKILL.md`; return [path, read(path)];
  }));
  const source = verifyStandardWorkflowComponentAssets({ catalog, model, skills,
    specification: read("docs/SPEC.md"), bindings: standardWorkflowOperationBindings() });
  return freezeShadow({ catalog, model, source });
}
export function createStandardWorkflowCycleHost({ targetRoot, readSigningKey, authorize, now }) {
  const assets = loadStandardWorkflowCycleAssets();
  const host = createStandardWorkflowOperationHost({ targetRoot, model: assets.model, modelSource: assets.source, readSigningKey, authorize, now });
  return Object.freeze({ ...host, modelSource: assets.source });
}
