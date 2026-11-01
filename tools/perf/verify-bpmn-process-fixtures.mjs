import assert from "node:assert/strict";
import fs from "node:fs";
import { compileBpmnProcess } from "../../src/application/workflow/bpmn-process-service.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { createAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const xml = fs.readFileSync(new URL("../../tests/fixtures/agentic-process/structured-delivery.bpmn", import.meta.url), "utf8");
const { roles, policies } = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
const compile = (source = xml, overrides = {}) => compileBpmnProcess({ xml: source, modelId: "delivery", revision: 1, participantId: "delivery", roles, policies, ...overrides });
let count = 0;
function check(name, run) { run(); count++; console.log("PASS " + name); }
function refuses(source, code) { assert.throws(() => compile(source), error => error.code === code); }
const conditional = kind => xml.replaceAll("parallelGateway", kind).replace('id="InspectSplit"', 'id="InspectSplit" default="TestsBranch"')
  .replace('<bpmn:sequenceFlow id="CodeBranch" sourceRef="InspectSplit" targetRef="InspectCode"/>', '<bpmn:sequenceFlow id="CodeBranch" sourceRef="InspectSplit" targetRef="InspectCode"><bpmn:conditionExpression language="urn:aidn:bpmn:execution:v1">inspect_code</bpmn:conditionExpression></bpmn:sequenceFlow>');
const cursor = (compilation, facts = {}) => inspectAgenticProcess(createAgenticProcess({ instanceId: "fixture", model: compilation.model, policyPins: agenticPolicyPins(compilation.model), scopeId: "scope-1", facts }));

check("BPMN compilation is deterministic, immutable, source mapped and schema valid", () => {
  const first = compile(); assert.deepEqual(first, compile()); assert.equal(first.model_sha256, shadowHash(first.model));
  assert.equal(Object.isFrozen(first.model.nodes), true);
  assert.equal(first.source_map.find(row => row.bpmn_id === "InspectJoin").ir_node_id, first.source_map.find(row => row.bpmn_id === "InspectSplit").ir_node_id);
  assert.equal(first.model.nodes.find(n => n.kind === "and").branches.length, 2);
  assert.equal(cursor(first).ready.length, 1);
  assert.equal(compile(xml.replace("Analyze requirement", "Analyze the requirement")).model_sha256, first.model_sha256);
  assert.notEqual(compile(xml.replace("Analyze requirement", "Analyze the requirement")).source_sha256, first.source_sha256);
  for (const name of ["bpmn-process-compilation", "agentic-process-simulation"]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.v1.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
    if (name === "bpmn-process-compilation") {
      assert.deepEqual(validateJsonSchema(first, schema, "$", { contractKind: "workflow-definition" }), []);
      assert.notEqual(validateJsonSchema({ ...first, profile: "unknown" }, schema, "$", { contractKind: "workflow-definition" }).length, 0);
    }
  }
});
check("XOR and OR compile Boolean facts and explicit defaults without code evaluation", () => {
  for (const kind of ["exclusiveGateway", "inclusiveGateway"]) {
    const compiled = compile(conditional(kind));
    const gateway = compiled.model.nodes.find(n => ["xor", "or"].includes(n.kind));
    assert.deepEqual(gateway.branches.map(b => b.condition), ["inspect_code", null]);
    assert.equal(gateway.kind, kind === "exclusiveGateway" ? "xor" : "or");
  }
  refuses(conditional("exclusiveGateway").replace(">inspect_code<", ">process.exit()<"), "BPMN_CONDITION_INVALID");
  refuses(xml.replaceAll("parallelGateway", "exclusiveGateway"), "BPMN_CONDITION_REQUIRED");
});
check("XML namespaces are resolved independently of prefix, malformed and entity XML refuse", () => {
  assert.equal(compile(xml.replaceAll("<bpmn:", "<model:").replaceAll("</bpmn:", "</model:").replace("xmlns:bpmn=", "xmlns:model=")).model_sha256, compile().model_sha256);
  refuses(xml.replace("</bpmn:task>", "</bpmn:serviceTask>"), "BPMN_XML_INVALID");
  refuses(xml.replace("urn:aidn:bpmn:execution:v1", "urn:untrusted"), "BPMN_EXECUTION_BINDING_INVALID");
  refuses(xml.replace("<bpmn:definitions", '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///unreadable">]><bpmn:definitions'), "BPMN_XML_DECLARATION_UNSUPPORTED");
  refuses(xml.replace("Analyze requirement", "&unknown;"), "BPMN_XML_INVALID");
  refuses(xml.replace('id="Analyze" name=', 'id="Analyze" id="Duplicate" name='), "BPMN_XML_INVALID");
  refuses("x".repeat(262145), "BPMN_XML_LIMIT");
});
check("unsupported semantics, effects and binding changes refuse explicitly", () => {
  refuses(xml.replace('isExecutable="true"', 'isExecutable="false"'), "BPMN_PROCESS_INVALID");
  for (const tag of ["boundaryEvent", "subProcess", "callActivity", "eventBasedGateway", "complexGateway", "intermediateCatchEvent", "scriptTask", "messageFlow"]) {
    refuses(xml.replace('<bpmn:endEvent id="End"/>', `<bpmn:${tag} id="Unsupported"/><bpmn:endEvent id="End"/>`), "BPMN_PROFILE_ELEMENT_UNSUPPORTED");
  }
  refuses(xml.replace('<bpmn:startEvent id="Start"/>', '<bpmn:startEvent id="Start"><bpmn:timerEventDefinition/></bpmn:startEvent>'), "BPMN_PROFILE_ELEMENT_UNSUPPORTED");
  refuses(xml.replace('policyRef="work"', 'policyRef="missing"'), "PROCESS_ACTIVITY_INVALID");
  refuses(xml.replace('policyRef="work"', 'policyRef="work" spawn="true"'), "BPMN_EXECUTION_BINDING_INVALID");
  refuses(xml.replace('id="Analyze" name=', 'id="Analyze" implementation="script" name='), "BPMN_PROFILE_ATTRIBUTE_UNSUPPORTED");
  refuses(xml.replace('</bpmn:extensionElements>', '<aidn:execution roleRef="analysis" policyRef="work"/></bpmn:extensionElements>'), "BPMN_EXECUTION_BINDING_INVALID");
});
check("nested structured blocks compile while a disconnected cycle refuses", () => {
  const task = (key) => `<bpmn:task id="${key}"><bpmn:extensionElements><aidn:execution roleRef="implementation" policyRef="work"/></bpmn:extensionElements></bpmn:task>`;
  const flow = (key, from, to) => `<bpmn:sequenceFlow id="${key}" sourceRef="${from}" targetRef="${to}"/>`;
  const extraCycle = task("CycleA") + task("CycleB") + flow("CycleAB", "CycleA", "CycleB") + flow("CycleBA", "CycleB", "CycleA");
  refuses(xml.replace('</bpmn:process>', extraCycle + '</bpmn:process>'), "BPMN_CYCLE_UNSUPPORTED");
  const nested = '<bpmn:parallelGateway id="InnerSplit"/><bpmn:parallelGateway id="InnerJoin"/>' + task("InnerA") + task("InnerB")
    + flow("InnerOne", "InnerSplit", "InnerA") + flow("InnerTwo", "InnerSplit", "InnerB")
    + flow("InnerOneEnd", "InnerA", "InnerJoin") + flow("InnerTwoEnd", "InnerB", "InnerJoin") + flow("InnerExit", "InnerJoin", "InspectCode");
  const result = compile(xml.replace('sourceRef="InspectSplit" targetRef="InspectCode"', 'sourceRef="InspectSplit" targetRef="InnerSplit"').replace('</bpmn:process>', nested + '</bpmn:process>'));
  assert.equal(result.model.nodes.filter(n => n.kind === "and").length, 2);
  assert.equal(result.model.nodes.filter(n => n.kind === "activity").length, 6);
});
check("graph ambiguity, cycles, implicit joins and cross-scope shortcuts refuse", () => {
  refuses(xml.replace('id="InspectJoin"', 'id="InspectSplit"'), "BPMN_ID_INVALID");
  refuses(xml.replace('targetRef="InspectCode"', 'targetRef="Missing"'), "BPMN_FLOW_REFERENCE_INVALID");
  refuses(xml.replace('targetRef="InspectTests"', 'targetRef="InspectCode"'), "BPMN_NODE_DEGREE_INVALID");
  refuses(xml.replace('<bpmn:parallelGateway id="InspectJoin"/>', '<bpmn:exclusiveGateway id="InspectJoin"/>'), "BPMN_STRUCTURED_JOIN_REQUIRED");
  refuses(xml.replace('sourceRef="Start" targetRef="Analyze"', 'sourceRef="Review" targetRef="Analyze"'), "BPMN_NODE_DEGREE_INVALID");
  refuses(xml.replace('<bpmn:task id="InspectTests"', '<bpmn:task id="InspectTests" isForCompensation="true"'), "BPMN_PROFILE_ATTRIBUTE_UNSUPPORTED");
  refuses(xml.replace('roleRef="analysis"', 'roleRef="unknown"'), "PROCESS_ACTIVITY_INVALID");
});
check("explicit flow declarations and lane references are checked, lanes allocate no agents", () => {
  const lanes = '<bpmn:laneSet id="Responsibilities"><bpmn:lane id="Analysis"><bpmn:flowNodeRef>Analyze</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>';
  assert.equal(compile(xml.replace('<bpmn:startEvent', lanes + '<bpmn:startEvent')).model_sha256, compile().model_sha256);
  refuses(xml.replace('<bpmn:startEvent', lanes.replace(">Analyze<", ">Missing<") + '<bpmn:startEvent'), "BPMN_LANE_REFERENCE_INVALID");
  refuses(xml.replace('<bpmn:startEvent id="Start"/>', '<bpmn:startEvent id="Start"><bpmn:outgoing>Wrong</bpmn:outgoing></bpmn:startEvent>'), "BPMN_FLOW_DECLARATION_INVALID");
});
console.log(JSON.stringify({ status: "PASS", checks: count, evidence: "tracked fixtures", native_execution: "NOT_RUN", graphical_import: "NOT_RUN" }));
