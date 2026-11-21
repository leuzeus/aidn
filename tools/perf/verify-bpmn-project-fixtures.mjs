import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeNewBpmnProject } from "../author/export-bpmn-project.mjs";
import assert from "node:assert/strict";
import { compileBpmnProject } from "../../src/application/workflow/bpmn-project-service.mjs";
import { exportBpmnProject } from "../../src/core/workflow/bpmn-project-export.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const row = model_id => ({ model_id, revision: 1, participants: [{ id: "project" }], roles: [], policies: [], operation_bindings: [] });
const data = inputs => ({ contract_version: "process-data-bindings.v4", parameter_keys: [], inputs });
const child = { contract_version: "agentic-process-model.v2", model_id: "child", revision: 1, participants: [{ id: "project" }],
  roles: [], policies: [], nodes: [{ id: "empty", participant_ref: "project", kind: "sequence", children: [] }], entry: "empty",
  operation_pins: {}, data_bindings: { ...data([]), parameter_keys: ["answer"] }, call_interface: { parameters: { answer: "integer" }, returns: {} } };
const digest = shadowHash(child);
const flow = (a,b) => `<bpmn:sequenceFlow id="F_${a}_${b}" sourceRef="${a}" targetRef="${b}"/>`;
const sequence = (key, ids) => `<bpmn:startEvent id="S_${key}"/><bpmn:endEvent id="E_${key}"/>`
  + [`S_${key}`, ...ids].map((a,i) => flow(a, [...ids,`E_${key}`][i])).join("");
const diagram = (key, content) => `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:aidn="urn:aidn:bpmn:execution:v1" targetNamespace="urn:fixture"><bpmn:process id="P_${key}_1" isExecutable="true">
  ${content}</bpmn:process></bpmn:definitions>`;
const group = (id, body) => `<bpmn:subProcess id="N_${id}" aidn:order="0" aidn:participant="project" aidn:kind="sequence">${body}</bpmn:subProcess>`;
const call = (id, order) => `<bpmn:callActivity id="N_${id}" aidn:order="${order}" aidn:participant="project" calledElement="P_child_1" aidn:sha256="${digest}"/>`;
const project = {
  manifest: { contract_version: "bpmn-model-project.v1", models: [
    { ...row("parent"), data_bindings: data(["first", "second"].map((node_id,i) => ({ node_id, fields: { answer: { source: "literal", value: i } } }))) },
    { ...row("child"), model_sha256: digest, data_bindings: child.data_bindings, call_interface: child.call_interface }] },
  diagrams: { "parent.1.bpmn": diagram("parent", sequence("parent", ["N_root"]) +
    group("root", sequence("root", ["N_first", "N_second"]) + call("first", 1) + call("second", 2))),
    "child.1.bpmn": diagram("child", sequence("child", ["N_empty"]) + group("empty", sequence("empty", []))) }
};
const compiled = compileBpmnProject(project);
assert.deepEqual(compiled.model.call_targets[0].model, child);
assert.deepEqual(compiled.model.nodes[0].children, ["first", "second"]);
assert.deepEqual(compiled.model.nodes[1].target, compiled.model.nodes[2].target);
assert.deepEqual(compiled.model.data_bindings, project.manifest.models[0].data_bindings);
assert.deepEqual(compiled.source_maps.map(m => [m.model_id, m.source_map.length]), [["parent", 3], ["child", 1]]);
console.log("PASS two scoped calls retain the child identity, empty body and distinct arguments");
const missing = structuredClone(project);
delete missing.diagrams["child.1.bpmn"];
assert.throws(() => compileBpmnProject(missing), /BPMN_PROJECT_FILES_INVALID/);
missing.manifest.models.pop();
assert.throws(() => compileBpmnProject(missing), e => e.code === "PROCESS_CALL_TARGET_MISSING" && e.element_id === "N_first");
console.log("PASS missing diagram and missing call target refuse");
const changed = structuredClone(project);
changed.diagrams["child.1.bpmn"] = changed.diagrams["child.1.bpmn"].replaceAll("N_empty", "N_other");
assert.throws(() => compileBpmnProject(changed), e => e.code === "PROCESS_CALL_TARGET_CHANGED" && e.model_id === "child");
changed.diagrams["parent.1.bpmn"] = changed.diagrams["parent.1.bpmn"].replace(digest, "9".repeat(64));
assert.throws(() => compileBpmnProject(changed), e => e.code === "PROCESS_CALL_TARGET_CHANGED" && e.element_id === "N_first");
console.log("PASS changed child content and changed call pin refuse independently");

const exported = exportBpmnProject(compiled.model);
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "aidn-bpmn-export-"));
try {
  const dir = path.join(workspace, "project");
  await writeNewBpmnProject(dir, exported);
  await assert.rejects(writeNewBpmnProject(dir, exported), { code: "EEXIST" });
  for (const [file, xml] of Object.entries(exported.diagrams)) assert.equal(await fs.readFile(path.join(dir, file), "utf8"), xml);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")), exported.manifest);
} finally { await fs.rm(workspace, { recursive: true, force: true }); }
const roundTrip = compileBpmnProject(exported);
assert.deepEqual(roundTrip.model, compiled.model);
assert.equal(roundTrip.model_sha256, compiled.model_sha256);
const drawing = exported.diagrams["parent.1.bpmn"];
assert.match(drawing, /<bpmndi:BPMNPlane[^>]+bpmnElement="N_root"/);
assert.match(drawing, /<bpmndi:BPMNEdge/);
console.log("PASS pinned IR exports as editable planes and round-trips exactly");
const editParent = xml => compileBpmnProject({ manifest: exported.manifest, diagrams: { ...exported.diagrams, "parent.1.bpmn": xml } });
assert.equal(editParent(drawing.replace('x="60"', 'x="180"')).model_sha256, compiled.model_sha256);
console.log("PASS moving a shape preserves the IR hash");
const rewired = drawing.replace(/(sourceRef|targetRef)="N_(first|second)"/g, (_, attr, id) =>
  `${attr}="N_${id === "first" ? "second" : "first"}"`);
const candidate = editParent(rewired);
assert.deepEqual(candidate.model.nodes[0].children, ["second", "first"]);
assert.notEqual(candidate.model_sha256, compiled.model_sha256);
assert.deepEqual(candidate.model.data_bindings, compiled.model.data_bindings);
console.log("PASS editing sequence-flow endpoints changes call order while retaining bindings");
