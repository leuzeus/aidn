import { createStandardWorkflowMixedHost } from "./standard-workflow-mixed-composition.mjs";
import { createStandardWorkflowOperationHost } from "./standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { verifyStandardWorkflowComponentAssets } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { loadWorkflowPackage } from "../workflow/workflow-package.mjs";
import descriptor from "../../../package/catalogs/standard.workflow-package.json" with { type: "json" };

export const STANDARD_WORKFLOW_CATALOG_PATH = descriptor.catalog;
export const STANDARD_WORKFLOW_MODEL_PATH = descriptor.model;
const root = new URL("../../../", import.meta.url);

export function loadStandardWorkflowAssets() {
  return loadWorkflowPackage(root, descriptor, assets =>
    verifyStandardWorkflowComponentAssets({ ...assets, bindings: standardWorkflowOperationBindings() }));
}

export function createStandardWorkflowHost(options) {
  const assets = loadStandardWorkflowAssets();
  const host = createStandardWorkflowOperationHost({ ...options, model: assets.model, modelSource: assets.source });
  return Object.freeze({ ...host, modelSource: assets.source });
}

// Composition of this published partial model. The ordinary entry selects it
// through its versioned configuration. The mixed host validates model identity,
// typed outputs and authenticated native allocations against this source.
export function createStandardWorkflowExecution(options, adapters = {}) {
  const assets = loadStandardWorkflowAssets();
  return createStandardWorkflowMixedHost({ ...options, modelSource: assets.source }, adapters);
}
