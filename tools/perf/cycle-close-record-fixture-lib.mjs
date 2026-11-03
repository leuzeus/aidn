import assert from "node:assert/strict";
import fs from "node:fs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";

export function attachCycleCloseRecordModel(model) {
  model.nodes[0].children.splice(-1, 0, "close_record");
  model.nodes.push({ id: "close_record", kind: "operation", participant_ref: "delivery", binding_ref: "cycle_close_record" });
  model.data_bindings.inputs.push({ node_id: "close_record", fields: { decision_operation_id: { source: "operation_id", node_id: "closure_decide" } } });
  model.operation_pins.cycle_close_record = shadowHash(standardWorkflowOperationBindings().find(row => row.id === "cycle_close_record"));
}

export async function verifyCycleCloseRecordExecution({ f, artifacts, cyclePath, verifier, setAllowed }) {
  const sessions = f.t.sessions.length, checks = verifier.calls(), before = f.open().inspect();
  const preview = await f.open().step({ write: false });
  assert.equal(preview.preview.binding.id, "cycle_close_record"); assert.equal(preview.preview.prepared.can_apply, true);
  const frozenPlan = artifacts.read(`${cyclePath}/plan.md`).sha256;
  setAllowed(false);
  try { await assert.rejects(f.open().step({ write: true }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" }); }
  finally { setAllowed(true); }
  assert.equal(f.open().inspect().record.instance_sha256, before.record.instance_sha256);
  assert.match(artifacts.read(`${cyclePath}/status.md`).content, /^state: VERIFYING$/m); assert.equal(artifacts.ownerPending(), false);
  // The human was authenticated and accepted before provider disappearance.
  // The separate metadata effect still needs its fresh grant and current audit.
  fs.writeFileSync(f.closureSourceFile, "{}");
  process.stderr.write("cycle-close-record: accepted human proof retained; executing separately granted canonical mutation\n");
  const attemptStarted = Date.now();
  const executed = await f.open().step({ write: true }), record = f.open().readOperation(executed.operation_id), output = record.results.at(-1).output;
  assert.equal(output.outcome, "completed", JSON.stringify({ output, attempt_elapsed_ms: Date.now() - attemptStarted, preview_age_ms: Date.now() - record.preview.prepared.plan.prepared_at_ms })); assert.equal(output.effect_status, "confirmed");
  assert.deepEqual(output.facts, { cycle_terminal_recorded: true, cycle_retained: true, cycle_close_completed: false });
  assert.equal(output.observations.closure_hook, "pending"); assert.equal(output.observations.skill_completion, "pending"); assert.equal(output.observations.committed.length, 6);
  assert.match(artifacts.read(`${cyclePath}/status.md`).content, /^state: DONE$/m);
  assert.match(artifacts.read("CURRENT-STATE.md").content, /^active_cycle: none$/m);
  assert.equal(artifacts.read(`${cyclePath}/plan.md`).sha256, frozenPlan); assert.equal(artifacts.ownerPending(), false);
  assert.equal(f.t.sessions.length, sessions); assert.equal(verifier.calls(), checks);
  const digest = shadowHash(record); assert.equal((await f.open().dispatchOperation(executed.operation_id, { write: true })).status, "retained_result");
  assert.equal(shadowHash(f.open().readOperation(executed.operation_id)), digest);
  const after = f.open().inspect(); assert.equal(after.cursor.status, "WAITING");
  const replay = simulateAgenticProcess({ instanceId: after.record.instance_id, model: after.record.model, parameters: after.record.initial_parameters,
    policyPins: after.record.policy_pins, scopeId: after.record.scope_id, events: after.record.events });
  assert.equal(replay.trace.at(-1).instance_sha256, after.record.instance_sha256);
}
