import fs from "node:fs";
import { createStandardWorkflowMixedHost } from "./standard-workflow-mixed-composition.mjs";
import { createStandardWorkflowOperationHost } from "./standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { verifyStandardWorkflowComponentAssets } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { freezeShadow } from "../../core/workflow/shadow-json.mjs";

export const STANDARD_WORKFLOW_CATALOG_PATH = "package/catalogs/standard-workflow.v1.json";
export const STANDARD_WORKFLOW_MODEL_PATH = "package/catalogs/process-models/aidn-standard.v1.json";
const root = new URL("../../../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root));
const skillIds = ["drift-check", "context-reload", "start-session", "cycle-create", "branch-cycle-audit", "cycle-close", "promote-baseline", "close-session", "pr-orchestrate"];

// Explicitly partial composition. This loader is not the ordinary/default
// workflow selector, and cannot claim full standard-workflow completion.
export function loadStandardWorkflowAssets() {
  const catalog = JSON.parse(read(STANDARD_WORKFLOW_CATALOG_PATH)), model = JSON.parse(read(STANDARD_WORKFLOW_MODEL_PATH));
  const skills = Object.fromEntries(skillIds.map(id => {
    const path = `scaffold/codex/aidn-${id}/SKILL.md`; return [path, read(path)];
  }));
  const source = verifyStandardWorkflowComponentAssets({ catalog, model, skills, specification: read("docs/SPEC.md"), bindings: standardWorkflowOperationBindings() });
  return freezeShadow({ catalog, model, source });
}

export function createStandardWorkflowHost(options) {
  const assets = loadStandardWorkflowAssets();
  const host = createStandardWorkflowOperationHost({ ...options, model: assets.model, modelSource: assets.source });
  return Object.freeze({ ...host, modelSource: assets.source });
}

// Internal composition of this published partial model; ordinary selection is
// still separate. The common mixed host validates configuration/model identity,
// typed outputs and authenticated native allocations against this source.
export function createStandardWorkflowExecution(options, adapters = {}) {
  const assets = loadStandardWorkflowAssets();
  return createStandardWorkflowMixedHost({ ...options, modelSource: assets.source }, adapters);
}
