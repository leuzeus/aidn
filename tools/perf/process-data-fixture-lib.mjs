import assert from "node:assert/strict";
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess, assertAgenticProcessInstance } from "../../src/core/workflow/agentic-process.mjs";
import { assertAgenticProcessModel } from "../../src/core/workflow/agentic-process-model.mjs";
import { resolveProcessOperationInput } from "../../src/core/workflow/process-input-resolution.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Synthetic reducer data. Real journal MACs/ports are exercised separately by
// the source-installed mixed-host fixture; these records grant no authority.
const H = "a".repeat(64), op = id => ({ id, kind: "operation", participant_ref: "project", binding_ref: id });
const seq = (id, children) => ({ id, kind: "sequence", participant_ref: "project", children });
const fields = { name: { source: "parameter", key: "session", path: ["name"] }, producer: { source: "operation_id", node_id: "source" },
  value: { source: "operation_output", node_id: "source", path: ["value"] }, prior_input: { source: "operation_input", node_id: "source", path: ["input"] } };
function model(root = seq("root_node", ["source", "target"]), nodes = [op("source"), op("target")], boundFields = fields) {
  const all = [root, ...nodes];
  return { contract_version: "agentic-process-model.v2", model_id: "data-fixture", revision: 1, participants: [{ id: "project" }], roles: [], policies: [],
    entry: root.id, nodes: all, operation_pins: Object.fromEntries(all.filter(row => row.kind === "operation").map(row => [row.id, H])),
    data_bindings: { contract_version: "process-data-bindings.v1", parameter_keys: ["session"], inputs: all.filter(row => row.kind === "operation")
      .map(row => ({ node_id: row.id, fields: row.id === "target" ? structuredClone(boundFields) : {} })) } };
}
const initial = m => createAgenticProcess({ instanceId: "data", scopeId: "fixture", model: m, policyPins: {}, parameters: { session: { name: "S001", approved: true } } });
export async function verifyProcessDataFixtures(check) {
  let serial = 0;
  function execute(state, nodeId, { value = "first", facts = {}, outcome = "completed", input = "observed" } = {}, occurrenceId) {
    const frame = inspectAgenticProcess(state).occurrences.find(row => row.node_id === nodeId && row.status === "READY" && (!occurrenceId || row.occurrence_id === occurrenceId));
    const intent = { contract_version: "process-operation-intent.v1", operation_id: "operation_" + ++serial, binding_ref: nodeId, binding_sha256: H,
      input_sha256: shadowHash({ input }), preconditions_sha256: H, authorization_sha256: null, authority_id: "fixture", scope_id: state.scope_id,
      instance_id: state.instance_id, instance_sha256: state.instance_sha256, model_sha256: state.model_sha256, occurrence_id: frame.occurrence_id, instance_revision: state.revision };
    state = advanceAgenticProcess(state, { event_id: "intent_" + serial, kind: "operation_intent", occurrence_id: frame.occurrence_id, intent });
    const output = { value, facts }, receipt = { contract_version: "process-operation-receipt.v1", receipt_id: "receipt_" + serial,
      operation_id: intent.operation_id, intent_sha256: shadowHash(intent), authority_id: "fixture", outcome, effect_status: "no_effect", output_sha256: shadowHash(output), facts,
      evidence_refs: [{ ref: "fixture/output", sha256: shadowHash(output) }] };
    state = advanceAgenticProcess(state, { event_id: "result_" + serial, kind: "operation_result", occurrence_id: frame.occurrence_id, receipt });
    return { state, record: { phase: "receipted", intent, preview: { input: { input } }, results: [{ output, receipt }] } };
  }
  const resolve = (state, records, occurrenceId = inspectAgenticProcess(state).ready[0]) => resolveProcessOperationInput({ instance: state, occurrenceId, readOperation: id => records.get(id) });
  await check("data: parameters are durable hashed input, never initial approval facts", () => {
    const state = initial(model()); assert.equal(state.initial_parameters.session.name, "S001"); assert.deepEqual(state.initial_facts, {});
    const gate = model({ id: "choice", kind: "xor", participant_ref: "project", branches: [
      { flow_id: "yes", node_id: "yes", condition: "approved" }, { flow_id: "no", node_id: "no", condition: null }] }, [op("yes"), op("no")]);
    assert.equal(inspectAgenticProcess(initial(gate)).occurrences[0].wait_reason, "routing_fact");
    const copy = structuredClone(state); copy.initial_parameters.session.name = "changed"; assert.throws(() => assertAgenticProcessInstance(copy), /INSTANCE_INVALID/);
    assert.throws(() => createAgenticProcess({ instanceId: "data", scopeId: "fixture", model: model(), policyPins: {} }), /PARAMETERS_INVALID/);
    const m = model(); delete m.data_bindings;
    assert.throws(() => createAgenticProcess({ instanceId: "data", scopeId: "fixture", model: m, policyPins: {}, parameters: {} }), /PARAMETERS_UNDECLARED/);
    const multi = model(undefined, undefined, {}); multi.data_bindings.parameter_keys = ["a", "b"];
    assert.throws(() => createAgenticProcess({ instanceId: "data", scopeId: "fixture", model: multi, policyPins: {}, parameters: { "a,b": 0 } }), /PARAMETERS_INVALID/);
    assertAgenticProcessInstance(createAgenticProcess({ instanceId: "data", scopeId: "fixture", model: multi, policyPins: {}, parameters: { a: 1, b: 2 } }));
  });
  await check("data: completed identities, journal inputs and outputs resolve without a driver-authored ID", () => {
    const result = execute(initial(model()), "source"), records = new Map([[result.record.intent.operation_id, result.record]]);
    const resolved = resolve(result.state, records);
    assert.deepEqual(resolved.input, { name: "S001", producer: result.record.intent.operation_id, value: "first", prior_input: "observed" });
    assert.equal(resolved.instance_sha256, result.state.instance_sha256); assert.equal(resolved.sources.length, 4);
    const tampered = structuredClone(result.state); tampered.initial_parameters.session.name = "forged";
    const { instance_sha256, ...body } = tampered; tampered.instance_sha256 = shadowHash(body);
    assert.throws(() => assertAgenticProcessInstance(tampered), /INTENT_BINDING_CHANGED/);
  });
  await check("data: missing fields, unauthenticated reader and changed retained results cannot supply data", () => {
    const result = execute(initial(model()), "source"), records = new Map([[result.record.intent.operation_id, result.record]]);
    assert.throws(() => resolveProcessOperationInput({ instance: result.state, occurrenceId: inspectAgenticProcess(result.state).ready[0] }), /AUTHORITY_REQUIRED/);
    const changed = structuredClone(result.record); changed.results[0].output.value = "forged";
    assert.throws(() => resolve(result.state, new Map([[changed.intent.operation_id, changed]])), /RESULT_CHANGED/);
    const changedInput = structuredClone(result.record); changedInput.preview.input.input = "forged";
    assert.throws(() => resolve(result.state, new Map([[changedInput.intent.operation_id, changedInput]])), /RESULT_CHANGED/);
    let accessed = 0; const accessor = structuredClone(result.record);
    Object.defineProperty(accessor, "results", { enumerable: true, get() { accessed++; return []; } });
    assert.throws(() => resolve(result.state, new Map([[accessor.intent.operation_id, accessor]])), /RESULT_CHANGED/);
    assert.equal(accessed, 0);
    for (const change of [record => { delete record.preview.input; }, record => { delete record.intent; }, record => { delete record.results[0].receipt; }]) {
      const malformed = structuredClone(result.record); change(malformed);
      assert.throws(() => resolve(result.state, new Map([[result.record.intent.operation_id, malformed]])), /RESULT_CHANGED/);
    }
    const m = model(); m.data_bindings.inputs[1].fields.value.path = ["missing"];
    const missing = execute(initial(m), "source"); assert.throws(() => resolve(missing.state, new Map([[missing.record.intent.operation_id, missing.record]])), /VALUE_MISSING/);
  });
  await check("data: loop iteration chooses its own result and replay retains parameters exactly", () => {
    const m = model({ id: "repeat", kind: "loop", participant_ref: "project", child: "body", until: "done", max_iterations: 2 },
      [seq("body", ["source", "target"]), op("source"), op("target")]);
    const first = execute(initial(m), "source"), next = execute(first.state, "target", { facts: { done: false } });
    const second = execute(next.state, "source", { value: "second" }), records = new Map([first, second].map(row => [row.record.intent.operation_id, row.record]));
    const resolved = resolve(second.state, records); assert.equal(resolved.input.value, "second");
    assert.equal(resolved.input.producer, second.record.intent.operation_id); assert.ok(resolved.sources.some(row => row.occurrence_id?.includes("iteration-2")));
    const done = execute(second.state, "target", { facts: { done: true } }).state;
    const replay = simulateAgenticProcess({ instanceId: done.instance_id, scopeId: done.scope_id, model: done.model, policyPins: done.policy_pins,
      parameters: done.initial_parameters, events: done.events }); assert.equal(replay.trace.at(-1).instance_sha256, done.instance_sha256);
    assert.throws(() => simulateAgenticProcess({ instanceId: done.instance_id, scopeId: done.scope_id, model: done.model, policyPins: done.policy_pins, events: done.events }), /PARAMETERS_INVALID/);
  });
  await check("data: parallel multi-instances nested in calls cannot consume another item's result", () => {
    const m = model({ id: "items", kind: "multi_instance", participant_ref: "project", child: "invoke", ordering: "parallel", items: ["left", "right"] },
      [{ id: "invoke", kind: "call", participant_ref: "project", child: "body" }, seq("body", ["source", "target"]), op("source"), op("target")],
      { ...fields, item: { source: "item", node_id: "items" } });
    let state = initial(m); const records = new Map();
    for (const item of ["left", "right"]) {
      const frame = inspectAgenticProcess(state).occurrences.find(row => row.node_id === "source" && row.status === "READY");
      const done = execute(state, "source", { value: item }, frame.occurrence_id); state = done.state; records.set(done.record.intent.operation_id, done.record);
    }
    const targets = inspectAgenticProcess(state).occurrences.filter(row => row.node_id === "target");
    for (const [index, item] of ["left", "right"].entries()) { const input = resolve(state, records, targets[index].occurrence_id).input;
      assert.equal(input.item, item); assert.equal(input.value, item); }
  });
  await check("data: literals and ancestor-scope parameters are deterministic", () => {
    const m = model(undefined, undefined, { literal: { source: "literal", value: { selected: true } }, name: fields.name });
    const ready = execute(initial(m), "source"); assert.deepEqual(resolve(ready.state, new Map()).input, { literal: { selected: true }, name: "S001" });
  });
  await check("data: equivalent JSON key orders retain the same input resolution fingerprint", () => {
    const left = model(), right = model(); right.data_bindings.inputs[1].fields = Object.fromEntries(Object.entries(right.data_bindings.inputs[1].fields).reverse());
    assert.equal(shadowHash(left), shadowHash(right));
    const result = execute(initial(left), "source"), records = new Map([[result.record.intent.operation_id, result.record]]);
    let reordered = initial(right); for (const event of result.state.events) reordered = advanceAgenticProcess(reordered, event);
    assert.equal(reordered.instance_sha256, result.state.instance_sha256);
    assert.equal(shadowHash(resolve(result.state, records)), shadowHash(resolve(reordered, records)));
  });
  await check("data: forward, cross-branch and implicit call exports are refused before execution", () => {
    const forward = model(); forward.nodes[0].children.reverse(); assert.throws(() => assertAgenticProcessModel(forward), /SOURCE_NOT_ORDERED/);
    const parallel = model({ id: "split", kind: "and", participant_ref: "project", branches: [{ flow_id: "a", node_id: "source" }, { flow_id: "b", node_id: "target" }] });
    assert.throws(() => assertAgenticProcessModel(parallel), /SOURCE_NOT_ORDERED/);
    const call = model(seq("root_node", ["invoke", "target"]), [{ id: "invoke", kind: "call", participant_ref: "project", child: "source" }, op("source"), op("target")]);
    assert.throws(() => assertAgenticProcessModel(call), /SOURCE_SCOPE_INVALID/);
  });
  await check("data: closed mappings reject executable selectors, unsafe paths and incomplete inputs", () => {
    for (const mutate of [m => { m.data_bindings.inputs.pop(); }, m => { m.data_bindings.inputs[1].fields.name.path = ["constructor"]; },
      m => { m.data_bindings.inputs[1].fields.name.module = "arbitrary.mjs"; }, m => { m.data_bindings.inputs[1].fields.name.key = "unknown"; },
      m => { m.data_bindings.parameter_keys.push("session"); }, m => { m.data_bindings.inputs[1].fields.value.node_id = "target"; }]) {
      const m = model(); mutate(m); assert.throws(() => assertAgenticProcessModel(m));
    }
  });
  await check("data: a refused or deferred source cannot become a successful input", () => {
    for (const outcome of ["blocked", "deferred", "rejected", "cancelled"]) {
      const result = execute(initial(model()), "source", { outcome });
      assert.equal(inspectAgenticProcess(result.state).ready.length, 0);
      assert.throws(() => resolveProcessOperationInput({ instance: result.state, occurrenceId: "root/1" }), /BINDING_REQUIRED/);
    }
  });
}
