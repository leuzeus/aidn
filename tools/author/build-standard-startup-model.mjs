// Explicit source authoring. Runtime loading never changes a model or its pins.
import fs from "node:fs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { assertAgenticProcessModel } from "../../src/core/workflow/agentic-process-model.mjs";
import { processModels } from "../../src/core/workflow/process-call-model.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { standardAssetHash, verifyStandardWorkflowStartupAssets } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";

if (process.argv.slice(2).some(arg => arg !== "--write")) throw Error("STANDARD_AUTHORING_ARGUMENT_INVALID");
const root = new URL("../../", import.meta.url), read = name => fs.readFileSync(new URL(name, root));
const modelPath = "package/catalogs/process-models/aidn-standard-startup.v1.json", catalogPath = "package/catalogs/standard-workflow-startup.v1.json";
const previous = JSON.parse(read(modelPath)), bindings = standardWorkflowOperationBindings();
const parameter = key => ({ source: "parameter", key, path: [] });
const sessionFields = Object.fromEntries(["session_id", "session_branch", "objective"].map(key => [key, parameter(key)]));
const admissionFields = { contract_version: { source: "literal", value: "standard-session-entry-input.v1" }, ...sessionFields };
const seq = (id, children) => ({ id, kind: "sequence", participant_ref: "project", children });
const op = (id, binding_ref = id) => ({ id, kind: "operation", participant_ref: "project", binding_ref });
const pins = nodes => Object.fromEntries(bindings.filter(binding => nodes.some(node => node.binding_ref === binding.id)).map(binding => [binding.id, shadowHash(binding)]));
const setup = { contract_version: "agentic-process-model.v2", model_id: "aidn-standard-session-setup", revision: 1,
  participants: [{ id: "project" }], roles: [], policies: [], entry: "session_setup",
  nodes: [seq("session_setup", ["session_admit", "session_creation_route", "session_mode_route"]), op("session_admit", "session_entry_admit"),
    { id: "session_creation_route", kind: "xor", participant_ref: "project", branches: [
      { flow_id: "create", node_id: "session_initialize", condition: "session_creation_allowed" },
      { flow_id: "resume", node_id: "session_existing", condition: null }] },
    op("session_initialize"), seq("session_existing", []),
    { id: "session_mode_route", kind: "xor", participant_ref: "project", branches: [
      { flow_id: "unknown", node_id: "session_mode_select", condition: "session_mode_pending" },
      { flow_id: "known", node_id: "session_mode_retained", condition: null }] },
    seq("session_mode_select", ["mode_decision", "session_mode_apply"]), seq("session_mode_retained", []), op("mode_decision"), op("session_mode_apply")],
  operation_pins: {}, call_interface: { parameters: Object.fromEntries(Object.keys(sessionFields).map(key => [key, "string"])), returns: {} },
  data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: Object.keys(sessionFields), inputs: [
    { node_id: "session_admit", fields: admissionFields }, { node_id: "session_initialize", fields: sessionFields },
    { node_id: "mode_decision", fields: { session_id: parameter("session_id") } },
    { node_id: "session_mode_apply", fields: { decision_operation_id: { source: "operation_id", node_id: "mode_decision" } } }] } };
const rootSession = Object.fromEntries(Object.keys(sessionFields).map(key => [key, { source: "parameter", key: "session", path: [key] }]));
const model = { contract_version: "agentic-process-model.v2", model_id: "aidn-standard-startup", revision: previous.revision,
  participants: [{ id: "project" }], roles: [], policies: [], entry: "startup",
  nodes: [seq("startup", ["context_reload", "session_admit", "session_creation_route", "session_mode_route", "session_start_finalize"]),
    op("context_reload"), ...setup.nodes.filter(node => node.id !== "session_setup"), op("session_start_finalize")],
  operation_pins: {},
  data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: ["session"], inputs: [
    { node_id: "context_reload", fields: {} }, ...structuredClone(setup.data_bindings.inputs),
    { node_id: "session_start_finalize", fields: { session_id: rootSession.session_id } }] } };
for (const input of model.data_bindings.inputs) for (const field of Object.values(input.fields)) {
  if (field.source === "parameter" && Object.hasOwn(rootSession, field.key)) Object.assign(field, rootSession[field.key]);
}
model.operation_pins = pins(model.nodes);
if (shadowHash(model) !== shadowHash(previous)) model.revision++;
assertAgenticProcessModel(model);
const specification = read("docs/SPEC.md"), skills = Object.fromEntries(["context-reload", "start-session"].map(id => {
  const path = `scaffold/codex/aidn-${id}/SKILL.md`; return [path, read(path)]; }));
const catalog = { contract_version: "standard-workflow-startup-catalog.v2", component_id: model.model_id, revision: model.revision,
  scope: { kind: "session_startup_component", complete_standard_workflow: false,
    entry_conditions: ["fresh_or_existing_session_admission", "canonical_mode_or_unknown_bootstrap"],
    remaining_activities: JSON.parse(read(catalogPath)).scope.remaining_activities.filter(value => value !== "existing_session_resume") },
  model: { path: modelPath, sha256: shadowHash(model), model_id: model.model_id, revision: model.revision },
  specification: { path: "docs/SPEC.md", sha256: standardAssetHash(specification) },
  bindings: processModels(model).flatMap(component => component.nodes.filter(node => node.kind === "operation").map(node => {
    const binding = bindings.find(binding => binding.id === node.binding_ref), path = `scaffold/codex/aidn-${binding.skill_id}/SKILL.md`;
    return { node_id: node.id, ...(component === model ? {} : { model_ref: processModelIdentity(component) }), binding,
      skill_source: { path, sha256: standardAssetHash(skills[path]) } }; })) };
verifyStandardWorkflowStartupAssets({ catalog, model, specification, skills, bindings });
if (process.argv.includes("--write")) for (const [name, value] of [[modelPath, model], [catalogPath, catalog]]) fs.writeFileSync(new URL(name, root), JSON.stringify(value, null, 2) + "\n");
console.log(JSON.stringify({ source_authoring_only: true, write: process.argv.includes("--write"), revision: model.revision, model_sha256: shadowHash(model), root_nodes: model.nodes.length }));
