import fs from "node:fs";
import { createStandardWorkflowOperationHost } from "./standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { verifyStandardWorkflowStartupAssets } from "../../core/workflow/standard-workflow-model-catalog.mjs";
import { freezeShadow } from "../../core/workflow/shadow-json.mjs";

export const STANDARD_STARTUP_CATALOG_PATH = "package/catalogs/standard-workflow-startup.v1.json";
export const STANDARD_STARTUP_MODEL_PATH = "package/catalogs/process-models/aidn-standard-startup.v1.json";
const root = new URL("../../../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root));
export function loadStandardWorkflowStartupAssets() {
  const catalog = JSON.parse(read(STANDARD_STARTUP_CATALOG_PATH)), model = JSON.parse(read(STANDARD_STARTUP_MODEL_PATH));
  // Paths are not executable selectors. Only these fixed package authorities
  // and fixed skill identities are read; the host resolves the actual code.
  const specification = read("docs/SPEC.md"), skills = Object.fromEntries(["context-reload", "start-session"]
    .map(id => { const path = `scaffold/codex/aidn-${id}/SKILL.md`; return [path, read(path)]; }));
  const input = { catalog, model, specification, skills, bindings: standardWorkflowOperationBindings() };
  const source = verifyStandardWorkflowStartupAssets(input);
  return freezeShadow({ catalog, model, source });
}
export function createStandardWorkflowStartupHost({ targetRoot, readSigningKey, authorize, humanSource, now }) {
  const assets = loadStandardWorkflowStartupAssets();
  const host = createStandardWorkflowOperationHost({ targetRoot, model: assets.model, modelSource: assets.source, readSigningKey, authorize, humanSource, now });
  return Object.freeze({ ...host, modelSource: assets.source });
}
