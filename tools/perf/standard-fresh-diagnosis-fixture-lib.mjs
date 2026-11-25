import assert from "node:assert/strict";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";

// Use the published loop and its pinned checkpoint call verbatim. Only its bootstrap
// boundary is supplied by the focused fixture, which creates an OPEN cycle.
export function attachFreshDiagnosisFixture({ model, published, configuration }) {
  const selected = new Set();
  function visit(id) {
    selected.add(id);
    const node = published.nodes.find(row => row.id === id);
    for (const child of [...(node.children ?? []), ...(node.child ? [node.child] : []), ...(node.branches ?? []).map(row => row.node_id)]) visit(child);
  }
  visit("cycle_drift_loop");
  const nodes = structuredClone(published.nodes.filter(row => selected.has(row.id)));
  const activity = nodes.find(row => row.id === "cycle_drift_report"), oldActivity = model.nodes.find(row => row.id === "analyze");
  activity.role_ref = oldActivity.role_ref; activity.policy_ref = oldActivity.policy_ref;
  const bootstrap = ["mixed", "reload", "admit", "initialize", "recovery_action_pending", "action_executed", "action_cancelled"];
  model.nodes = [...model.nodes.filter(row => bootstrap.includes(row.id)), ...nodes];
  model.nodes.find(row => row.id === "mixed").children = ["reload", "admit", "initialize", "cycle_drift_loop", "recovery_action_pending"];
  model.participants = published.participants;
  for (const node of model.nodes) node.participant_ref = published.participants[0].id;
  model.call_targets = published.call_targets.filter(row => row.model_id === "aidn-standard-fresh-cycle-checkpoint");
  const pins = { ...model.operation_pins, ...published.operation_pins };
  model.operation_pins = Object.fromEntries(model.nodes.filter(row => row.kind === "operation").map(row => [row.binding_ref, pins[row.binding_ref]]));
  model.data_bindings.contract_version = "process-data-bindings.v4";
  model.data_bindings.parameter_keys = ["session", "cycle"];
  model.data_bindings.inputs = [...model.data_bindings.inputs.filter(row => bootstrap.includes(row.node_id)),
    ...structuredClone(published.data_bindings.inputs.filter(row => selected.has(row.node_id)))];
  model.data_bindings.inputs.find(row => row.node_id === "fresh_checkpoint").fields.session_id =
    { source: "operation_input", node_id: "initialize", path: ["session_id"] };
  configuration.activity_outputs = { cycle_drift_report: "standard-drift-report.v1" };
}

export async function verifyFreshDiagnosisFixture({ finalizationFixture, bootstrapMixed, prepareCompletionCycle }) {
  const claims = new Map();
  const f = finalizationFixture("files", { recovery: true, objectiveFinalize: true, publishedFreshDiagnosis: true, humanSource: {
    read: ({ sourceRef }) => claims.get(sourceRef) ?? null,
    verify({ source, sourceRef }) { assert.deepEqual(source, claims.get(sourceRef)); return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) }; },
  } });
  f.sessionObjective = "Implement and test membership in a bounded range";
  f.cycleObjective = "Verify inclusive bounds and invalid ranges";
  f.cycleParameters = { cycle_id: "C001" };
  const auth = await bootstrapMixed(f), context = await prepareCompletionCycle(f, "OPEN");
  const decisions = [], evaluations = [], occurrences = [];
  const initialHead = context.git("rev-parse", "HEAD");
  for (const choice of ["request_diagnosis", "confirm_alignment"]) {
    const native = await f.open().step({ write: true, authorization: auth });
    assert.equal(native.journal_phase, "closed", JSON.stringify(native));
    assert.equal(native.first_failure, null);
    const evaluated = await f.open().step({ write: true });
    const journal = f.open().readOperation(evaluated.operation_id);
    assert.equal(journal.intent.binding_ref, "drift_report_evaluate");
    evaluations.push(evaluated.operation_id); occurrences.push(journal.preview.input.report_occurrence_id);
    const selected = await f.open().step({ write: true });
    assert.equal(f.open().readOperation(selected.operation_id).results.at(-1).output.observations.evaluation_operation_id, evaluated.operation_id);
    const waiting = await f.open().step({ write: true });
    assert.equal(waiting.status, "waiting_for_human");
    assert.equal(waiting.question.contract_version, "standard-drift-recovery-question.v2");
    const parked = f.open().inspect().record.instance_sha256;
    assert.equal(f.reopen().inspect().record.instance_sha256, parked);
    assert.equal((await f.open().receiveDecision(waiting.operation_id, { write: true, sourceRef: "absent" })).status, "waiting_for_human");
    assert.equal(f.open().inspect().record.instance_sha256, parked);
    const claim = { contract_version: "human-drift-recovery-decision.v2", source_kind: "human", authority_id: "fixture_operator",
      source_event_id: "fixture-fresh-" + choice, subject_sha256: shadowHash(waiting.question.review), question_sha256: shadowHash(waiting.question),
      choice, rationale: "Explicit fixture choice for this occurrence only.", evidence_refs: [{ ref: "fixture:fresh-diagnosis", sha256: shadowHash(waiting.question) }] };
    claims.set(choice, claim);
    await f.open().receiveDecision(waiting.operation_id, { write: true, sourceRef: choice });
    await f.open().acceptOperation(waiting.operation_id, { write: true });
    const accepted = f.open().readOperation(waiting.operation_id);
    assert.equal(accepted.results.length, 1);
    assert.equal(accepted.results[0].output.observations.choice, choice);
    decisions.push({ operation_id: waiting.operation_id, sha256: shadowHash(accepted), question_sha256: shadowHash(waiting.question) });
    const acceptedHash = f.open().inspect().record.instance_sha256;
    assert.equal(f.reopen().inspect().record.instance_sha256, acceptedHash);
    assert.equal(shadowHash(f.open().readOperation(waiting.operation_id)), decisions.at(-1).sha256);
    if (choice === "request_diagnosis") {
      const state = f.open().inspect();
      assert.ok(state.cursor.occurrences.some(row => row.node_id === "cycle_drift_report" && row.status === "READY"));
      assert.ok(!state.record.events.some(row => row.kind === "operation_intent" && ["drift_check_finalize", "cycle_checkpoint_finalize"].includes(row.intent.binding_ref)));
      assert.equal(context.git("rev-parse", "HEAD"), initialHead);
      assert.equal(f.t.sessions.length, 1);
    }
  }
  assert.equal(new Set(evaluations).size, 2); assert.equal(new Set(occurrences).size, 2);
  assert.equal(new Set(decisions.map(row => row.question_sha256)).size, 2);
  const finalized = await f.open().step({ write: true });
  const finalization = f.open().readOperation(finalized.operation_id);
  assert.equal(finalization.preview.input.evaluation_operation_id, evaluations[1]);
  assert.equal(finalization.results.at(-1).output.effect_status, "confirmed");
  assert.equal(finalization.results.at(-1).output.observations.hook.payload.objective_alignment.source_sha256, shadowHash(claims.get("confirm_alignment")));
  assert.equal((await f.open().step({ write: true })).kind, "call");
  const checkpoint = await f.open().step({ write: true });
  const checkpointJournal = f.open().readOperation(checkpoint.operation_id);
  assert.equal(checkpointJournal.intent.binding_ref, "cycle_checkpoint_finalize");
  assert.equal(checkpointJournal.preview.input.evaluation_operation_id, evaluations[1]);
  assert.equal(checkpointJournal.results.at(-1).output.effect_status, "confirmed");
  await f.open().step({ write: true }); // Real cycle context refresh.
  assert.equal((await f.open().step({ write: true })).kind, "call");
  const state = f.reopen().inspect();
  for (const binding of ["drift_check_finalize", "cycle_checkpoint_finalize"])
    assert.equal(state.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === binding).length, 1);
  for (const decision of decisions) assert.equal(shadowHash(f.open().readOperation(decision.operation_id)), decision.sha256);
  assert.equal(state.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "drift_completion_decision").length, 0);
  assert.equal((await f.open().dispatchOperation(checkpoint.operation_id, { write: true })).status, "retained_result");
  const replay = simulateAgenticProcess({ instanceId: state.record.instance_id, scopeId: state.record.scope_id, model: state.record.model,
    parameters: state.record.initial_parameters, policyPins: state.record.policy_pins, events: state.record.events });
  assert.equal(replay.trace.at(-1).instance_sha256, state.record.instance_sha256);
  assert.equal(f.t.sessions.length, 2); assert.ok(f.t.sessions.every(row => row.closed)); assert.equal(context.artifacts.ownerPending(), false);
  console.log(JSON.stringify({ fresh_diagnosis: "PASS", native_fixture_responses: 2, human_fixture_decisions: 2, finalizations: 1, checkpoints: 1,
    retained_diagnosis: true, replay_exact: true, complete_standard: false }));
}
