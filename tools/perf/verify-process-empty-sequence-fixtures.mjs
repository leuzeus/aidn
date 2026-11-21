import assert from "node:assert/strict";
import { createAgenticProcess, inspectAgenticProcess, advanceAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { assertAgenticProcessModel, agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
const empty = id => ({ id, kind: "sequence", participant_ref: "project", children: [] });
const model = (entry, rest = []) => ({ contract_version: "agentic-process-model.v2", model_id: "empty-branch", revision: 1,
  participants: [{ id: "project" }], roles: [], policies: [], operation_pins: {}, entry: entry.id, nodes: [entry, ...rest] });
const create = (definition, facts = {}) => createAgenticProcess({ instanceId: "empty-fixture", model: definition, policyPins: agenticPolicyPins(definition), scopeId: "fixture", facts });
let checks = 0;
function test(name, run) { run(); checks++; console.log("PASS " + name); }
test("empty v2 sequence finishes structurally without events resources or operation results", () => {
  const state = create(model(empty("skip"))), cursor = inspectAgenticProcess(state);
  assert.equal(cursor.status, "COMPLETED"); assert.equal(state.events.length, 0); assert.equal(cursor.occurrences.length, 1);
  assert.equal(cursor.occurrences[0].expected_children, 0); assert.equal(cursor.occurrences[0].operation, undefined);
});
test("empty sequence advances its parent to an actual durable event wait", () => {
  const definition = model({ id: "root_sequence", kind: "sequence", participant_ref: "project", children: ["skip", "review"] }, [empty("skip"),
    { id: "review", kind: "event", participant_ref: "project", branches: [{ flow_id: "accepted", node_id: "accepted", event_key: "accepted" }, { flow_id: "cancelled", node_id: "cancelled", event_key: "cancelled" }] }, empty("accepted"), empty("cancelled")]);
  const state = create(definition), cursor = inspectAgenticProcess(state); assert.equal(cursor.status, "WAITING");
  assert.equal(cursor.occurrences.find(row => row.node_id === "review").wait_reason, "event"); assert.equal(state.events.length, 0);
});
test("unknown choice facts still wait and cannot implicitly select an empty branch", () => {
  const definition = model({ id: "choice", kind: "xor", participant_ref: "project", branches: [{ flow_id: "requested", node_id: "requested", condition: "promotion_requested" },
    { flow_id: "not_requested", node_id: "not_requested", condition: "promotion_not_requested" }] }, [empty("requested"), empty("not_requested")]);
  assert.equal(inspectAgenticProcess(create(definition)).status, "WAITING");
  const state = create(definition, { promotion_requested: false, promotion_not_requested: true }), cursor = inspectAgenticProcess(state);
  assert.equal(cursor.status, "COMPLETED"); assert.ok(cursor.occurrences.some(row => row.node_id === "not_requested")); assert.ok(!cursor.occurrences.some(row => row.node_id === "requested"));
  const replay = simulateAgenticProcess({ instanceId: state.instance_id, model: state.model, policyPins: state.policy_pins, scopeId: state.scope_id, facts: state.initial_facts, events: state.events });
  assert.equal(replay.trace.at(-1).instance_sha256, state.instance_sha256);
});
test("an unresolved routing wait can be cancelled without a fabricated successful receipt", () => {
  const definition = model({ id: "choice", kind: "xor", participant_ref: "project", branches: [{ flow_id: "one", node_id: "one", condition: "one" }, { flow_id: "two", node_id: "two", condition: "two" }] }, [empty("one"), empty("two")]);
  const state = advanceAgenticProcess(create(definition), { event_id: "cancel", kind: "cancel" }); assert.equal(inspectAgenticProcess(state).status, "CANCELLED");
  assert.ok(state.events.every(row => row.kind !== "operation_result"));
});
test("historical v1 and non-sequence structures keep their nonempty restrictions", () => {
  const legacy = { ...model(empty("skip")), contract_version: "agentic-process-model.v1" }; delete legacy.operation_pins;
  assert.throws(() => assertAgenticProcessModel(legacy));
  assert.throws(() => assertAgenticProcessModel(model({ ...empty("skip"), kind: "call" })));
});
console.log(JSON.stringify({ status: "PASS", checks, proof: "v2-structural-optional-branch", model_calls: 0, application_effects: "NOT_RUN", full_standard_workflow: "NOT_COMPLETE" }));
