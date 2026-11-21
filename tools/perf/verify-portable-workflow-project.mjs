import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { exportStandardBpmnProject } from "../../src/application/workflow/standard-bpmn-project.mjs";
import { createWorkflowProject, duplicateWorkflowProject } from "../../src/application/workflow/workflow-project-edit.mjs";
import roles from "../../package/catalogs/standard-role-profile.v1.json" with { type: "json" };
import { exportBpmnProject } from "../../src/core/workflow/bpmn-project-export.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { projectDiagramName } from "../../src/core/workflow/bpmn-project-diagram.mjs";
import { exportPortableWorkflowProject, importPortableWorkflowProject } from "../author/portable-workflow-project.mjs";

const assets = loadStandardWorkflowAssets();
const project = structuredClone(exportStandardBpmnProject(assets));
const file = projectDiagramName(project.manifest.models[0]);
const moved = project.diagrams[file].replace('x="60"', 'x="179"');
assert.notEqual(moved, project.diagrams[file]);
project.diagrams[file] = moved;
const catalogs = [{ id: assets.catalog.component_id, revision: assets.catalog.revision, document: assets.catalog }];
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "aidn-workflow-transfer-"));
try {
  const { binding } = assets.catalog.bindings.find(row => row.binding.id === "context_reload");
  const reliability = { contract_version: "operation-reliability.v1", max_retries: 1 };
  const reliable = { contract_version: "agentic-process-model.v2", model_id: "portable-observer", revision: 1,
    participants: [{ id: "team" }], roles: [], policies: [], entry: "observe",
    nodes: [{ id: "observe", kind: "operation", participant_ref: "team", binding_ref: binding.id, reliability }],
    operation_pins: { [binding.id]: shadowHash(binding) } };
  const reliableProject = exportBpmnProject(reliable, { [projectDiagramName(reliable)]: [binding] });
  const reliableDir = path.join(scratch, "reliable");
  await exportPortableWorkflowProject(reliableDir, reliableProject);
  const reliableCopy = await importPortableWorkflowProject(reliableDir);
  assert.deepEqual(reliableCopy.compilation.model, reliable);
  assert.ok(reliableCopy.schemas[reliability.contract_version]);
  console.log("PASS portable retry policy preserves the binding pin, policy and schema");

  const custom = structuredClone(createWorkflowProject({ id: "role-transfer" }));
  custom.manifest.models[0].role_profile = { ...roles, id: "business-roles" };
  const customDir = path.join(scratch, "roles");
  const roleLock = await exportPortableWorkflowProject(customDir, custom);
  const roleCopy = await importPortableWorkflowProject(customDir);
  assert.deepEqual(roleCopy.project, custom);
  assert.ok(roleCopy.schemas["role-profile.v1"]);
  assert.ok(roleLock.catalogs.some(row => row.id + "@" + row.revision === roles.transition_policy_ref));
  const transition = roleLock.catalogs.find(row => row.id === "standard-transitions");
  const transitionPath = `catalogs/${transition.id}.${transition.revision}.json`;
  await fs.unlink(path.join(customDir, transitionPath));
  await assert.rejects(importPortableWorkflowProject(customDir), { code: "WORKFLOW_PORTABLE_RESOURCE_MISSING", resource: transitionPath });
  console.log("PASS authored roles retain their schema, host capability catalog and transition policy");

  const out = path.join(scratch, "first"), copy = path.join(scratch, "copy");
  const lock = await exportPortableWorkflowProject(out, project, { catalogs });
  await assert.rejects(exportPortableWorkflowProject(out, project, { catalogs }), { code: "EEXIST" });
  await fs.cp(out, copy, { recursive: true });
  await fs.rename(out, path.join(scratch, "original-moved"));
  const imported = await importPortableWorkflowProject(copy);
  assert.equal(imported.compilation.model_sha256, assets.source.model_sha256);
  assert.deepEqual(imported.compilation.model.call_targets, assets.model.call_targets);
  assert.deepEqual(imported.project, project);
  assert.deepEqual(imported.catalogs, catalogs);
  assert.ok(Object.keys(imported.schemas).length > 10);
  const second = await exportPortableWorkflowProject(path.join(scratch, "second"), imported.project, imported);
  assert.deepEqual(second, lock);
  console.log("PASS offline copied STANDARD preserves model identity, call pins, versioned dependencies and the edited BPMNDI coordinates");

  const fork = duplicateWorkflowProject(imported.project, "standard-copy");
  assert.equal(fork.manifest.project_revision, 1);
  const forkDir = path.join(scratch, "fork");
  await exportPortableWorkflowProject(forkDir, fork, imported);
  const reopened = await importPortableWorkflowProject(forkDir);
  assert.equal(reopened.compilation.model.model_id, "standard-copy");
  assert.notEqual(reopened.compilation.model_sha256, lock.model_sha256);
  assert.deepEqual(reopened.compilation.model.call_targets, assets.model.call_targets);
  assert.match(reopened.project.diagrams["standard-copy.1.bpmn"], /x="179"/);
  assert.deepEqual(imported.project, project);
  console.log("PASS explicit duplication creates a fresh root identity while retaining layout and child pins");

  const schemaName = "schemas/" + lock.schemas[0].id + ".schema.json";
  const schemaPath = path.join(copy, schemaName), original = await fs.readFile(schemaPath);
  await fs.unlink(schemaPath);
  await assert.rejects(importPortableWorkflowProject(copy), { code: "WORKFLOW_PORTABLE_RESOURCE_MISSING", resource: schemaName });
  await fs.writeFile(schemaPath, Buffer.concat([original, Buffer.from(" ")]));
  await assert.rejects(importPortableWorkflowProject(copy), { code: "WORKFLOW_PORTABLE_RESOURCE_CHANGED", resource: schemaName });
  await fs.writeFile(schemaPath, original);
  await assert.rejects(exportPortableWorkflowProject(path.join(scratch, "unresolved"), project),
    { code: "WORKFLOW_PORTABLE_CATALOG_PIN_MISSING", resource: project.manifest.catalog_sha256 });
  await assert.rejects(fs.stat(path.join(scratch, "unresolved")), { code: "ENOENT" });
  const index = path.join(copy, "workflow-transfer.json");
  const missing = structuredClone(lock);
  const [lost] = missing.schemas.splice(0, 1);
  await fs.writeFile(index, JSON.stringify(missing));
  await assert.rejects(importPortableWorkflowProject(copy), { code: "WORKFLOW_PORTABLE_SCHEMA_MISSING", resource: lost.id });
  await fs.writeFile(index, JSON.stringify(lock));
  const catalog = lock.catalogs[0], catalogName = `catalogs/${catalog.id}.${catalog.revision}.json`;
  await fs.appendFile(path.join(copy, catalogName), " ");
  await assert.rejects(importPortableWorkflowProject(copy), { code: "WORKFLOW_PORTABLE_RESOURCE_CHANGED", resource: catalogName });
  console.log("PASS a missing or modified schema, deleted schema reference, changed catalog or missing published pin names the resource");
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
