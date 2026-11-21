import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowProject, updateWorkflowProject } from "../../src/application/workflow/workflow-project-edit.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { standardPropertyCatalog } from "../author/bpmn-editor/property-catalog.mjs";
import { compileBpmnProject } from "../../src/application/workflow/bpmn-project-service.mjs";
import { createAgenticProcess, inspectAgenticProcess, advanceAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { resolveProcessCallData } from "../../src/core/workflow/process-call-data.mjs";
import { writeNewBpmnProject } from "../author/export-bpmn-project.mjs";
import { readEditorProject, commitEditorProject, projectHash } from "../author/workflow-project-store.mjs";

const catalog = standardPropertyCatalog(loadStandardWorkflowAssets());
const initial = createWorkflowProject({ id: "intake" });
const update = (project, edit) => updateWorkflowProject(project, edit, catalog);
assert.throws(() => update(initial, { id: "gate", kind: "evaluation", evaluator_ref: "gating@1" }),
  { code: "WORKFLOW_AUTHOR_OPERATION_UNKNOWN" });
const call = update(initial, { id: "inspect", kind: "call", target: "inspect_case", parameters: { ticket: "string" },
  fields: { ticket: { source: "parameter", key: "request", path: ["id"] } } });
const model = compileBpmnProject(call).model;
let record = createAgenticProcess({ instanceId: "case", scopeId: "intake", policyPins: {}, model, parameters: { request: { id: "T-12" } } });
for (const kind of ["call_enter", "call_return"]) {
  const cursor = inspectAgenticProcess(record), occurrenceId = "root/0";
  const transition = resolveProcessCallData({ instance: record, cursor, occurrenceId, returning: kind === "call_return" });
  if (kind === "call_enter") assert.deepEqual(transition.resolution.input, { ticket: "T-12" });
  record = advanceAgenticProcess(record, { kind, event_id: kind, occurrence_id: occurrenceId, ...transition });
}
assert.equal(record.events.at(-1).kind, "call_return");
const custom = structuredClone(initial);
const owner = custom.manifest.models[0];
owner.role_profile = { contract_version: "role-profile.v1", id: "intake", revision: 1, transition_policy_ref: "standard-transitions@1",
  capabilities: ["analyze@1"], role_aliases: {}, capability_aliases: {},
  roles: [{ id: "business_analyst", host_role: "auditor", capabilities: ["analyze@1"], required_permissions: [] }] };
owner.roles = [{ id: "analyst", profile_role: "business_analyst", capability_ref: "analyze@1", skills: [] }];
const edited = update(custom, { id: "quality", kind: "evaluation", evaluator_ref: "cycle_validation@1",
  fields: { validation_operation_id: { source: "parameter", key: "validation_id", path: [] } } });
const role = update(edited, { id: "review", kind: "activity", role_ref: "analyst", policy_ref: "thinking_analysis_policy" });
assert.deepEqual(role.manifest.models[0].roles, owner.roles);
assert.deepEqual(role.manifest.models[0].role_profile, owner.role_profile);
assert.equal(compileBpmnProject(role).model.nodes.find(node => node.id === "quality").binding_ref, "cycle_validation_evaluate");

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "aidn-edit-cas-")), dir = path.join(workspace, "project");
try {
  await writeNewBpmnProject(dir, call);
  const original = await readEditorProject(dir), candidate = update(original, { kind: "xor", id: "decision", condition: "ready" });
  await fs.appendFile(path.join(dir, "inspect_case.1.bpmn"), "\n");
  await assert.rejects(commitEditorProject(dir, projectHash(original), candidate), { code: "BPMN_PROJECT_FILE_CONFLICT" });
  const after = await readEditorProject(dir);
  assert.deepEqual(after.manifest, original.manifest);
  assert.equal(after.diagrams["intake.1.bpmn"], original.diagrams["intake.1.bpmn"]);
  assert.equal(after.diagrams["inspect_case.1.bpmn"], original.diagrams["inspect_case.1.bpmn"] + "\n");
  const fresh = update(after, { kind: "xor", id: "decision", condition: "ready" });
  await commitEditorProject(dir, projectHash(after), fresh);
  assert.deepEqual(await readEditorProject(dir), fresh);
} finally { await fs.rm(workspace, { recursive: true, force: true }); }
console.log("PASS evaluator operation selection, authored role profile, mapped reducer call, sibling-file conflict and complete reopen");
