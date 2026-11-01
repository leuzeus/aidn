import assert from "node:assert/strict";
import fs from "node:fs";
import { compileBpmnProcess } from "../../src/application/workflow/bpmn-process-service.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { createAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertAgenticProcessModel, agenticProcessCapabilities } from "../../src/core/workflow/agentic-process-model.mjs";

const xml = fs.readFileSync(new URL("../../tests/fixtures/agentic-process/structured-delivery.bpmn", import.meta.url), "utf8");
const extendedXml = fs.readFileSync(new URL("../../tests/fixtures/agentic-process/extended-delivery.bpmn", import.meta.url), "utf8");
const { roles, policies } = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
const compile = (source = xml, overrides = {}) => compileBpmnProcess({ xml: source, modelId: "delivery", revision: 1, participantId: "delivery", roles, policies, ...overrides });
const extended = (source = extendedXml, overrides = {}) => compile(source, { profile: "aidn-bpmn-structured.v2", processRef: "ExtendedDelivery", ...overrides });
function refusesExtended(source, code, overrides) { assert.throws(() => extended(source, overrides), error => error.code === code); }
let count = 0;
function check(name, run) { run(); count++; console.log("PASS " + name); }
function refuses(source, code) { assert.throws(() => compile(source), error => error.code === code); }
const conditional = kind => xml.replaceAll("parallelGateway", kind).replace('id="InspectSplit"', 'id="InspectSplit" default="TestsBranch"')
  .replace('<bpmn:sequenceFlow id="CodeBranch" sourceRef="InspectSplit" targetRef="InspectCode"/>', '<bpmn:sequenceFlow id="CodeBranch" sourceRef="InspectSplit" targetRef="InspectCode"><bpmn:conditionExpression language="urn:aidn:bpmn:execution:v1">inspect_code</bpmn:conditionExpression></bpmn:sequenceFlow>');
const cursor = (compilation, facts = {}) => inspectAgenticProcess(createAgenticProcess({ instanceId: "fixture", model: compilation.model, policyPins: agenticPolicyPins(compilation.model), scopeId: "scope-1", facts }));

check("BPMN compilation is deterministic, immutable, source mapped and schema valid", () => {
  const first = compile(); assert.deepEqual(first, compile()); assert.equal(first.model_sha256, shadowHash(first.model));
  assert.equal(first.model_sha256, "caa608f501c5b9543be005610ede3cca58e4aad774c11d7487cf664a495882b9");
  assert.deepEqual(first.source_map.map(row => [row.bpmn_id, row.ir_node_id]), [
    ["Analyze", "n_1"], ["InspectCode", "n_3"], ["InspectTests", "n_4"], ["InspectSplit", "n_2"],
    ["InspectJoin", "n_2"], ["Review", "n_6"], ["Delivery", "s_0"]]);
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
check("V2 is opt-in, preserves V1 output and publishes separate capabilities", () => {
  const v1 = compile(), v2 = compile(xml, { profile: "aidn-bpmn-structured.v2" });
  assert.deepEqual(v1.model, v2.model); assert.deepEqual(v1.source_map, v2.source_map);
  assert.equal(v1.profile, "aidn-bpmn-structured.v1"); assert.equal(v2.profile, "aidn-bpmn-structured.v2");
  assert.deepEqual(agenticProcessCapabilities().bpmn_xml_profiles, [v1.profile, v2.profile]);
  refuses(extendedXml, "BPMN_PROFILE_ELEMENT_UNSUPPORTED");
  assert.throws(() => compile(xml, { profile: "unknown" }), /BPMN_PROFILE_UNSUPPORTED/);
  assert.throws(() => compile(xml, { profile: null }), /BPMN_PROFILE_UNSUPPORTED/);
  assert.throws(() => compile(xml, { processRef: "Delivery" }), /BPMN_PROFILE_UNSUPPORTED/);
  const compiled = extended(); assertAgenticProcessModel(compiled.model);
  assert.deepEqual(compiled, extended());
  const kinds = compiled.model.nodes.map(n => n.kind);
  for (const kind of ["activity", "sequence", "event", "loop", "multi_instance", "call"]) assert.equal(kinds.includes(kind), true);
  const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/bpmn-process-compilation.v1.schema.json", import.meta.url)));
  assert.deepEqual(validateJsonSchema(compiled, schema, "$", { contractKind: "workflow-definition" }), []);
  assert.equal(compiled.source_map.filter(row => row.bpmn_id === "InspectItem").length, 2);
  assert.equal(new Set(compiled.model.nodes.map(n => n.id)).size, compiled.model.nodes.length);
});
check("V2 rejects event semantics unavailable in the reducer and invalid original declarations", () => {
  refusesExtended(extendedXml.replace('instantiate="false"', 'instantiate="true"'), "BPMN_EVENT_GATEWAY_UNSUPPORTED");
  refusesExtended(extendedXml.replace('eventGatewayType="Exclusive"', 'eventGatewayType="Parallel"'), "BPMN_EVENT_GATEWAY_UNSUPPORTED");
  refusesExtended(extendedXml.replace('messageRef="reconsider"', 'messageRef="approved"'), "BPMN_EVENT_KEY_INVALID");
  refusesExtended(extendedXml.replace('messageRef="approved"', 'messageRef="unknown"'), "BPMN_EVENT_KEY_INVALID");
  for (const kind of ["timerEventDefinition", "signalEventDefinition", "conditionalEventDefinition"]) {
    refusesExtended(extendedXml.replace('<bpmn:messageEventDefinition messageRef="approved"/>', `<bpmn:${kind}/>`), "BPMN_PROFILE_ELEMENT_UNSUPPORTED");
  }
  refusesExtended(extendedXml.replace('<bpmn:intermediateCatchEvent id="CatchApproved">', '<bpmn:intermediateCatchEvent id="CatchApproved"><bpmn:incoming>EnterDecision</bpmn:incoming>'), "BPMN_FLOW_DECLARATION_INVALID");
  refusesExtended(extendedXml.replace('<bpmn:task id="ApprovedWork">', '<bpmn:task id="ApprovedWork"><bpmn:incoming>ApprovedBranch</bpmn:incoming>'), "BPMN_FLOW_DECLARATION_INVALID");
  const declared = extendedXml.replace('<bpmn:task id="ApprovedWork">', '<bpmn:task id="ApprovedWork"><bpmn:incoming>ApprovedCaught</bpmn:incoming>');
  assert.deepEqual(extended(declared).model, extended().model);
});
check("V2 checks namespaces before removing catches and their outgoing flows", () => {
  const foreignCatch = extendedXml.replace('<bpmn:intermediateCatchEvent id="CatchApproved">', '<foreign:intermediateCatchEvent xmlns:foreign="urn:foreign" id="CatchApproved">')
    .replace('</bpmn:intermediateCatchEvent>', '</foreign:intermediateCatchEvent>');
  refusesExtended(foreignCatch, "BPMN_PROFILE_ELEMENT_UNSUPPORTED");
  const foreignFlow = extendedXml.replace('<bpmn:sequenceFlow id="ApprovedCaught"', '<foreign:sequenceFlow xmlns:foreign="urn:foreign" id="ApprovedCaught"');
  refusesExtended(foreignFlow, "BPMN_PROFILE_ELEMENT_UNSUPPORTED");
  const renamed = extendedXml.replaceAll('<bpmn:', '<model:').replaceAll('</bpmn:', '</model:').replace('xmlns:bpmn=', 'xmlns:model=');
  assert.equal(extended(renamed).model_sha256, extended().model_sha256);
});
check("V2 loops require explicit polarity, post-test semantics and a failing iteration guard", () => {
  const loop = extended().model.nodes.find(n => n.kind === "loop");
  assert.equal(loop.until, "refinement_done"); assert.equal(loop.max_iterations, 2);
  refusesExtended(extendedXml.replace('testBefore="false"', 'testBefore="true"'), "BPMN_LOOP_INVALID");
  refusesExtended(extendedXml.replace('testBefore="false"', 'testBefore="false" loopMaximum="2"'), "BPMN_LOOP_MAXIMUM_UNSUPPORTED");
  refusesExtended(extendedXml.replace('not(refinement_done)', 'refinement_done'), "BPMN_LOOP_CONDITION_INVALID");
  refusesExtended(extendedXml.replace('not(refinement_done)', '!refinement_done'), "BPMN_LOOP_CONDITION_INVALID");
  refusesExtended(extendedXml.replace('<aidn:iterationLimit maxIterations="2" onLimit="fail"/>', ''), "BPMN_LOOP_INVALID");
  for (const limit of ["0", "33", "2.0", "unbounded"]) refusesExtended(extendedXml.replace('maxIterations="2"', `maxIterations="${limit}"`), "BPMN_LOOP_LIMIT_INVALID");
  refusesExtended(extendedXml.replace('onLimit="fail"', 'onLimit="complete"'), "BPMN_LOOP_LIMIT_INVALID");
});
check("V2 multi-instance cardinality is a bounded collection identity, with no early completion", () => {
  const multi = extended().model.nodes.find(n => n.kind === "multi_instance");
  assert.deepEqual(multi.items, ["first", "second"]); assert.equal(multi.ordering, "parallel");
  assert.equal(extended(extendedXml.replace('isSequential="false"', 'isSequential="true"')).model.nodes.find(n => n.kind === "multi_instance").ordering, "sequential");
  refusesExtended(extendedXml.replace('items="first second"', 'items="first first"'), "BPMN_COLLECTION_INVALID");
  refusesExtended(extendedXml.replace('>2</bpmn:loopCardinality>', '>3</bpmn:loopCardinality>'), "BPMN_COLLECTION_INVALID");
  refusesExtended(extendedXml.replace('>2</bpmn:loopCardinality>', '>items.length</bpmn:loopCardinality>'), "BPMN_COLLECTION_INVALID");
  refusesExtended(extendedXml.replace('</bpmn:multiInstanceLoopCharacteristics>', '<bpmn:completionCondition>true</bpmn:completionCondition></bpmn:multiInstanceLoopCharacteristics>'), "BPMN_PROFILE_ELEMENT_UNSUPPORTED");
  refusesExtended(extendedXml.replace('isSequential="false"', 'isSequential="sometimes"'), "BPMN_MULTI_INSTANCE_INVALID");
  const empty = extended(extendedXml.replace('items="first second"', 'items=""').replace('>2</bpmn:loopCardinality>', '>0</bpmn:loopCardinality>'));
  assert.deepEqual(empty.model.nodes.find(n => n.kind === "multi_instance").items, []);
});
check("V2 calls resolve only local declared procedures, refuse recursion and require an exact entry", () => {
  refusesExtended(extendedXml, "BPMN_PROCESS_SELECTION_REQUIRED", { processRef: "Unknown" });
  assert.throws(() => compile(extendedXml, { profile: "aidn-bpmn-structured.v2" }), /BPMN_PROCESS_SELECTION_REQUIRED/);
  refusesExtended(extendedXml.replaceAll('calledElement="Procedure"', 'calledElement="Missing"'), "BPMN_CALL_REFERENCE_INVALID");
  refusesExtended(extendedXml.replace('calledElement="LeafProcedure"', 'calledElement="ExtendedDelivery"'), "BPMN_CALL_RECURSION_UNSUPPORTED");
  refusesExtended(extendedXml.replace('calledElement="LeafProcedure"', 'calledElement="Procedure"'), "BPMN_CALL_RECURSION_UNSUPPORTED");
  refusesExtended(extendedXml.replace('calledElement="LeafProcedure"', 'calledElement="https://example.invalid/process"'), "BPMN_CALL_REFERENCE_INVALID");
  assert.throws(() => extended(extendedXml.replace('calledElement="LeafProcedure"', 'calledElement="https://example.invalid/private"')),
    error => error.code === "BPMN_CALL_REFERENCE_INVALID" && error.element_id === "NestedCall" && !error.message.includes("private"));
  refusesExtended(extendedXml.replace('id="LeafStart"', 'id="ProcedureStart"'), "BPMN_ID_INVALID");
});
check("V2 bounds call expansion, refuses unused procedures and supports repetition on tasks and calls", () => {
  const task = key => `<bpmn:task id="${key}"><bpmn:extensionElements><aidn:execution roleRef="implementation" policyRef="work"/></bpmn:extensionElements></bpmn:task>`;
  const procedure = (name, steps) => `<bpmn:process id="${name}" isExecutable="true"><bpmn:startEvent id="${name}_start"/>`
    + steps.map(([key, body]) => body ?? task(key)).join("") + `<bpmn:endEvent id="${name}_end"/>`
    + [name + "_start", ...steps.map(([key]) => key)].map((key, index) => `<bpmn:sequenceFlow id="${name}_f${index}" sourceRef="${key}" targetRef="${steps[index]?.[0] ?? name + "_end"}"/>`).join("") + '</bpmn:process>';
  const definitions = processes => `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:aidn="urn:aidn:bpmn:execution:v1" targetNamespace="urn:aidn:fixtures">${processes}</bpmn:definitions>`;
  const expanded = definitions(procedure("Root", Array.from({ length: 14 }, (_, i) => [`Call${i}`, `<bpmn:callActivity id="Call${i}" calledElement="Large"/>`]))
    + procedure("Large", Array.from({ length: 10 }, (_, i) => [`Task${i}`])));
  refusesExtended(expanded, "BPMN_EXPANSION_LIMIT", { processRef: "Root" });
  refusesExtended(extendedXml.replace('</bpmn:definitions>', procedure("Unused", [["UnusedTask"]]) + '</bpmn:definitions>'), "BPMN_UNUSED_PROCESS_DEFINITION");
  const excessiveDepth = definitions(Array.from({ length: 17 }, (_, i) => procedure(`Depth${i}`, i === 16 ? [["DeepTask"]]
    : [[`DeepCall${i}`, `<bpmn:callActivity id="DeepCall${i}" calledElement="Depth${i + 1}"/>`]])).join(""));
  refusesExtended(excessiveDepth, "BPMN_STRUCTURE_LIMIT", { processRef: "Depth0" });
  const loopCall = extended(extendedXml.replace('<bpmn:callActivity id="FollowUp" calledElement="Procedure"/>',
    '<bpmn:callActivity id="FollowUp" calledElement="Procedure"><bpmn:extensionElements><aidn:iterationLimit maxIterations="2" onLimit="fail"/></bpmn:extensionElements><bpmn:standardLoopCharacteristics><bpmn:loopCondition language="urn:aidn:bpmn:execution:v1">not(call_done)</bpmn:loopCondition></bpmn:standardLoopCharacteristics></bpmn:callActivity>'));
  const wrapper = loopCall.model.nodes.find(n => n.kind === "loop" && n.until === "call_done");
  assert.equal(loopCall.model.nodes.find(n => n.id === wrapper.child).kind, "call");
  const multiTask = extended(extendedXml.replace('<aidn:iterationLimit maxIterations="2" onLimit="fail"/>', '<aidn:collection items="one two"/>')
    .replace(/<bpmn:standardLoopCharacteristics[\s\S]*?<\/bpmn:standardLoopCharacteristics>/, '<bpmn:multiInstanceLoopCharacteristics isSequential="true"><bpmn:loopCardinality>2</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>'));
  const taskWrapper = multiTask.model.nodes.find(n => n.kind === "multi_instance" && n.ordering === "sequential");
  assert.equal(multiTask.model.nodes.find(n => n.id === taskWrapper.child).kind, "activity");
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
