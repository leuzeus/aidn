import assert from "node:assert/strict";

export const standardDataCallTargets = new Map([
  ["fresh_entry", "aidn-standard-fresh-cycle-entry"], ["fresh_checkpoint", "aidn-standard-fresh-cycle-checkpoint"],
  ["owned_cycle", "aidn-standard-owned-entry"], ["selected_cycle", "aidn-standard-selected-entry"],
  ["work_prepare", "aidn-standard-cycle-preparation"], ["canonical_verification", "aidn-standard-canonical-verification"],
  ["thinking_session_closure", "aidn-standard-mode-session-closure"], ["exploring_session_closure", "aidn-standard-mode-session-closure"],
]);

// Fixture assertions over real accepted journals. These helpers grant no call,
// operation, actor or effect authority and never author a receipt.
export function verifyStandardDataCallFixture({ call, model, parameters, cursor, event, entering, accepted, readOperation }) {

  const site = model.nodes.find(row => row.id === call.node_id);
  const targetId = standardDataCallTargets.get(call.node_id);
  assert.equal(site?.target?.model_id, targetId, "fixture call target must match the published interface");
  const target = model.call_targets.find(row => row.model_id === targetId)?.model;
  assert.ok(target); assert.ok(target.nodes.every(row => row.kind !== "activity"));
  const at = (value, parts) => (parts ?? []).reduce((row, key) => row?.[key], value);

  const witnessIds = new Set();
  const verifyWitness = journal => {
    const witness = event.witnesses.find(row => row.operation_id === journal.operation_id);
    assert.ok(witness, "call data must carry its actual accepted operation witness");
    assert.equal(witness.phase, journal.phase); assert.deepEqual(witness.intent, journal.intent);
    assert.deepEqual(witness.preview.input, journal.preview.input);
    assert.deepEqual(witness.results.at(-1).receipt, journal.results.at(-1).receipt);
    assert.deepEqual(witness.results.at(-1).output, journal.results.at(-1).output);
    witnessIds.add(journal.operation_id);
  };
  if (entering) {
    assert.deepEqual(Object.keys(event.resolution.input).sort(), Object.keys(target.call_interface.parameters).sort());
    const fields = model.data_bindings.inputs.find(row => row.node_id === call.node_id).fields;
    for (const [field, source] of Object.entries(fields)) {
      const resolved = event.resolution.sources.find(row => row.field === field);
      assert.ok(resolved, "fixture must retain each declared call input source");
      assert.equal(resolved.source, source.source);
      if (source.source === "parameter") {
        assert.deepEqual(event.resolution.input[field], at(parameters[source.key], source.path));
      } else {
        assert.ok(["operation_id", "operation_input", "operation_output"].includes(source.source), "unsupported fixture call input source");
        assert.ok(resolved.operation_id, "call input must name an actual accepted journal");
        const parent = model.nodes.find(row => row.id === source.node_id);
        const journal = accepted(resolved.operation_id, parent.binding_ref);
        if (source.source !== "operation_id") verifyWitness(journal);
        assert.equal(journal.intent.occurrence_id, resolved.occurrence_id);
        assert.deepEqual(event.resolution.input[field], source.source === "operation_id" ? journal.operation_id
          : at(source.source === "operation_input" ? journal.preview.input : journal.results.at(-1).output, source.path));
      }
    }
    assert.equal(event.witnesses.length, witnessIds.size);
  } else {
    const executed = cursor.occurrences.filter(row => row.call_scope_id === call.occurrence_id && row.operation?.intent);
    const children = new Map();
    for (const row of executed) {
      const leaf = target.nodes.find(node => node.id === row.node_id && node.kind === "operation");
      assert.ok(leaf, "only a declared target operation may produce this call result");
      children.set(row.node_id, accepted(row.operation.intent.operation_id, leaf.binding_ref));
    }
    const selected = children.get("plan_select");
    if (targetId === "aidn-standard-cycle-preparation") assert.ok(selected, "fixture requires the accepted planning selector");
    const expected = targetId === "aidn-standard-cycle-preparation"
      ? selected.results.at(-1).output.facts.cycle_implementation_entry_required ? ["plan_select", "readiness", "implementation_enter"] : ["plan_select"]
      : target.nodes.filter(row => row.kind === "operation").map(row => row.id);
    assert.deepEqual([...children.keys()].sort(), expected.sort());
    const returns = target.call_interface.returns;
    assert.deepEqual(Object.keys(event.resolution.input).sort(), Object.keys(returns).sort());
    for (const [field, source] of Object.entries(returns)) {
      const journal = children.get(source.node_id); assert.ok(journal);
      assert.deepEqual(event.resolution.input[field], at(journal.results.at(-1).output, source.path));
      verifyWitness(journal);
    }
    assert.equal(event.witnesses.length, witnessIds.size);
    if (selected) {
      const recordId = event.resolution.input.record_operation_id; assert.ok(recordId);
      const origin = readOperation(recordId);
      assert.ok(["cycle_plan_record", "cycle_plan_adopt", "cycle_owned_resume_admit", "cycle_canonical_resume_admit"].includes(origin.intent.binding_ref));
      accepted(recordId, origin.intent.binding_ref);
      if (children.has("readiness")) {
        assert.equal(children.get("readiness").preview.input.record_operation_id, recordId);
        assert.equal(children.get("implementation_enter").preview.input.evaluation_operation_id, children.get("readiness").operation_id);
      }
    }
  }
}
