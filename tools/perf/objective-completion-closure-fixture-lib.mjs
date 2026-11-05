import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runReloadCheckUseCase } from "../../src/application/runtime/reload-check-use-case.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";

// Scenario-authored graph, fixture Native/Human sources, real operation host,
// canonical writers, physical report/event readers and actual closure hook.
// This does not establish the published graph or genuine actor qualification.
export async function verifyObjectiveCompletionClosure({ f, artifacts, cyclePath, verifier, script }) {
  const targetRoot = f.configuration.target_root, sessions = f.t.sessions.length, checks = verifier.calls();
  // One warm host per phase; preserve the independent new Node reconstruction.
  // All host methods keep their own fresh context/authentication/CAS checks.
  const warm = f.open(), phaseStarted = performance.now();
  const git = (...args) => {
    const result = spawnSync("git", ["-C", targetRoot, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  // Diagnose AFTER the admitted terminal transition/checkpoint. No old context
  // or pre-checkpoint HEAD is silently reinterpreted as current approval.
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture reviewed terminal checkpoint before diagnosis");
  const reload = await runReloadCheckUseCase({ targetRoot, completionCycleId: "C001", args: {
    cache: ".aidn/runtime/cache/reload-state.json", stateMode: artifacts.describe().state_mode, stateModeExplicit: true,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: true,
  } });
  assert.notEqual(reload.decision, "stop");
  const native = await warm.step({ write: true, authorization: f.objectiveCompletionAuthorization });
  assert.equal(native.journal_phase, "closed", JSON.stringify(native));
  const evaluation = await warm.step({ write: true });
  assert.equal(warm.readOperation(evaluation.operation_id).results.at(-1).output.facts.drift_present, false);
  const waiting = await warm.step({ write: true });
  assert.equal(waiting.status, "waiting_for_human"); assert.equal(waiting.question.contract_version, "standard-drift-recovery-question.v2");
  assert.equal(waiting.question.review.session_objective, "Learn through an explicitly admitted bounded SPIKE");
  assert.equal(waiting.question.review.cycle_objective, "Determine whether a bounded prototype is useful");
  const claim = { contract_version: "human-drift-recovery-decision.v2", source_kind: "human", authority_id: "fixture_operator",
    source_event_id: "fixture-objective-closure-1", subject_sha256: shadowHash(waiting.question.review), question_sha256: shadowHash(waiting.question),
    choice: "confirm_alignment", rationale: "Fixture operator reviews the exact terminal goals and complete clean diagnostic.",
    evidence_refs: [{ ref: "fixture:operator/objective-closure", sha256: shadowHash(waiting.question.review) }] };
  const sources = JSON.parse(fs.readFileSync(f.closureSourceFile, "utf8"));
  fs.writeFileSync(f.closureSourceFile, JSON.stringify({ ...sources, objective: claim }));
  await warm.receiveDecision(waiting.operation_id, { write: true, sourceRef: "objective" });
  await warm.acceptOperation(waiting.operation_id, { write: true });
  const finalized = await warm.step({ write: true }), completion = warm.readOperation(finalized.operation_id).results.at(-1).output;
  assert.equal(completion.effect_status, "confirmed", JSON.stringify(completion)); assert.equal(completion.facts.drift_check_completed, true);
  const eventFile = path.join(targetRoot, ".aidn/runtime/perf/workflow-events.ndjson"), eventBytes = fs.readFileSync(eventFile);
  const status = artifacts.read(cyclePath + "/status.md"), current = artifacts.read("CURRENT-STATE.md"), snapshot = artifacts.read("snapshots/context-snapshot.md");
  const before = warm.inspect(), preview = await warm.step({ write: false });
  assert.equal(preview.preview.binding.id, "cycle_close_finalize"); assert.equal(preview.preview.prepared.can_apply, true, JSON.stringify(preview.preview.prepared));
  assert.equal(warm.inspect().record.instance_sha256, before.record.instance_sha256);
  assert.deepEqual(fs.readFileSync(eventFile), eventBytes);
  assert.deepEqual([artifacts.read(status.path).sha256, artifacts.read(current.path).sha256, artifacts.read(snapshot.path).sha256], [status.sha256, current.sha256, snapshot.sha256]);
  // A new Node host independently reconstructs the signed operations, inbox,
  // accepted diagnostic, canonical report and original physical completion line.
  const input = path.join(f.base, "objective-closure-restart.json");
  fs.writeFileSync(input, JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex"),
    validation_profile: verifier.profileRef, human_source_file: f.closureSourceFile }));
  const beforeCold = performance.now();
  const child = spawnSync(process.execPath, [script, "--closure-finalize", input], { encoding: "utf8", windowsHide: true, timeout: 900000 });
  assert.equal(child.status, 0, child.stderr); const accepted = JSON.parse(child.stdout);
  assert.equal(accepted.launches, 0); assert.equal(accepted.sessions, 0);
  const record = warm.readOperation(accepted.operation_id), output = record.results.at(-1).output;
  assert.equal(output.operation_ref, "cycle_close_finalize"); assert.equal(output.outcome, "completed", JSON.stringify(output)); assert.equal(output.effect_status, "confirmed");
  assert.deepEqual(output.facts, { cycle_close_completed: true, cycle_retained: true });
  assert.equal(output.observations.hook.invocation, "in_process_authenticated_objective_completion");
  assert.equal(output.observations.hook.payload.checkpoint.gate.levels.level2.required, false);
  const afterEvents = fs.readFileSync(eventFile), delta = afterEvents.subarray(eventBytes.length).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(delta.some(row => row.event === "gating_summary")); assert.ok(delta.some(row => row.event === "checkpoint_summary"));
  assert.ok(!delta.some(row => row.event === "drift_check_completed"));
  assert.match(artifacts.read(status.path).content, /"cycle_close_completed": true/); assert.equal(artifacts.ownerPending(), false);
  const digest = shadowHash(record);
  assert.equal((await warm.dispatchOperation(accepted.operation_id, { write: true })).status, "retained_result");
  assert.equal(shadowHash(warm.readOperation(accepted.operation_id)), digest); assert.deepEqual(fs.readFileSync(eventFile), afterEvents);
  const after = warm.inspect(), replay = simulateAgenticProcess({ instanceId: after.record.instance_id, model: after.record.model,
    parameters: after.record.initial_parameters, policyPins: after.record.policy_pins, scopeId: after.record.scope_id, events: after.record.events });
  assert.equal(replay.trace.at(-1).instance_sha256, after.record.instance_sha256);
  assert.equal(f.t.sessions.length, sessions + 1); assert.ok(f.t.sessions.every(row => row.closed)); assert.equal(verifier.calls(), checks);
  console.log(JSON.stringify({ proof: "fixture-actors-real-host-objective-completion-and-cycle-close", status: "PASS", target: targetRoot,
    phase_timings_ms: { warm_before_cold: beforeCold - phaseStarted, cold_and_verification: performance.now() - beforeCold },
    objective_finalization: finalized.operation_id, cycle_close_finalize: accepted.operation_id, cold_native_allocations: 0,
    preview: "nonmutating", redelivery: "retained_result", replay_and_simulation: "same-scenario-model-reducer", published_model: "NOT_RUN", full_standard: false }));
}
