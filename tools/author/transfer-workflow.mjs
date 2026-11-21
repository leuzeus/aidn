import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { compileBpmnProject } from "../../src/application/workflow/bpmn-project-service.mjs";
import { exportStandardBpmnProject } from "../../src/application/workflow/standard-bpmn-project.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { exportPortableWorkflowProject, importPortableWorkflowProject } from "./portable-workflow-project.mjs";

const usage = "Usage: transfer-workflow.mjs (--standard | --project editor-dir [--dependencies assets.json] | --import portable-dir) [--out new-dir] [--duplicate-as new-id]";
const { values } = parseArgs({ options: { help: { type: "boolean" }, standard: { type: "boolean" }, project: { type: "string" },
  import: { type: "string" }, out: { type: "string" }, "duplicate-as": { type: "string" }, dependencies: { type: "string" } } });
if (values.help) {
  console.log(usage);
  process.exit(0);
}
if ([values.standard, values.project, values.import].filter(Boolean).length !== 1 ||
    (!values.out && !values.import) || (values["duplicate-as"] && !values.out) ||
    (values.dependencies && (values.import || values.standard)))
  throw Error(usage);

let project, dependencies;
if (values.import) {
  const imported = await importPortableWorkflowProject(values.import);
  project = imported.project;
  dependencies = { schemas: imported.schemas, catalogs: imported.catalogs };
} else {
  if (values.standard) project = exportStandardBpmnProject();
  else {
    const { readEditorProject } = await import("./workflow-project-store.mjs");
    project = await readEditorProject(values.project);
  }
  dependencies = values.dependencies ? JSON.parse(await fs.readFile(values.dependencies, "utf8")) : {};
  if (project.manifest.catalog_sha256 && !dependencies.catalogs?.length) {
    const assets = loadStandardWorkflowAssets();
    if (assets.source.catalog_sha256 !== project.manifest.catalog_sha256)
      throw Error("WORKFLOW_PORTABLE_CATALOG_PIN_MISSING: " + project.manifest.catalog_sha256);
    dependencies.catalogs = [{ id: assets.catalog.component_id, revision: assets.catalog.revision, document: assets.catalog }];
  }
}
if (values["duplicate-as"]) {
  const { duplicateWorkflowProject } = await import("../../src/application/workflow/workflow-project-edit.mjs");
  project = duplicateWorkflowProject(project, values["duplicate-as"]);
}
if (values.out) await exportPortableWorkflowProject(values.out, project, dependencies);
const { model, model_sha256 } = compileBpmnProject(project);
console.log(`${model.model_id}@${model.revision} ${model_sha256}`);
