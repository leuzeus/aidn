import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { runReloadCheckUseCase } from "../../src/application/runtime/reload-check-use-case.mjs";
import { completeDriftCheckFixture } from "./test-activation-fixture-lib.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { verifyObjectiveCompletionClosure } from "./objective-completion-closure-fixture-lib.mjs";

export function attachCycleCloseHookModel(model) {
  model.nodes[0].children.splice(-1, 0, "close_finalize");
  model.nodes.push({ id: "close_finalize", kind: "operation", participant_ref: "delivery", binding_ref: "cycle_close_finalize" });
  model.data_bindings.inputs.push({ node_id: "close_finalize", fields: { closure_operation_id: { source: "operation_id", node_id: "close_record" } } });
  model.operation_pins.cycle_close_finalize = shadowHash(standardWorkflowOperationBindings().find(row => row.id === "cycle_close_finalize"));
}

export async function verifyCycleCloseHookExecution({ f, artifacts, cyclePath, verifier, script, setAllowed }) {
  if (f.objectiveCompletion) return verifyObjectiveCompletionClosure({ f, artifacts, cyclePath, verifier, script });
  const before = f.open().inspect(), sessions = f.t.sessions.length, checks = verifier.calls(), targetRoot = f.configuration.target_root;
  const pending = await f.open().step();
  assert.equal(pending.preview.binding.id, "cycle_close_finalize");
  assert.equal(pending.preview.prepared.can_apply, false);
  assert.equal(pending.preview.prepared.reason_code, "STANDARD_CYCLE_CLOSE_HOOK_GATE_REQUIRED");
  assert.equal(f.open().inspect().record.instance_sha256, before.record.instance_sha256);
  assert.equal(artifacts.ownerPending(), false);
  const eventFile = path.join(targetRoot, ".aidn/runtime/perf/workflow-events.ndjson");
  const initialEvents = () => fs.existsSync(eventFile) ? fs.readFileSync(eventFile) : Buffer.alloc(0), beforeBlockedEvents = initialEvents();
  const blocked = await f.open().step({ write: true }), blockedOutput = f.open().readOperation(blocked.operation_id).results.at(-1).output;
  assert.equal(blockedOutput.outcome, "blocked"); assert.equal(blockedOutput.effect_status, "no_effect"); assert.deepEqual(blockedOutput.facts, {});
  const waiting = f.open().inspect(); assert.equal(waiting.cursor.status, "WAITING"); assert.notEqual(waiting.record.instance_sha256, before.record.instance_sha256);
  assert.deepEqual(initialEvents(), beforeBlockedEvents); assert.equal(artifacts.ownerPending(), false);
  // These explicit external fixture preconditions are not a claim that the
  // shipped standard IR already models its checkpoint/R05 wait and recovery.
  const git = (...args) => { const child = spawnSync("git", ["-c", "core.hooksPath=NUL", ...args], { cwd: targetRoot, encoding: "utf8", shell: false, windowsHide: true });
    assert.equal(child.status, 0, child.stderr); return child.stdout.trim(); };
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture explicitly reviewed terminal checkpoint");
  const reload = await runReloadCheckUseCase({ targetRoot, completionCycleId: "C001", args: {
    cache: ".aidn/runtime/cache/reload-state.json", stateMode: artifacts.describe().state_mode, stateModeExplicit: true,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: true,
  } });
  assert.notEqual(reload.decision, "stop"); completeDriftCheckFixture(targetRoot);
  const preview = await f.open().step();
  assert.equal(preview.preview.binding.id, "cycle_close_finalize"); assert.equal(preview.preview.prepared.can_apply, true);
  const product = path.join(f.configuration.product_root, "app.mjs"), bytes = fs.readFileSync(product);
  try {
    fs.writeFileSync(product, Buffer.concat([bytes, Buffer.from("\n// changed after terminal record\n")]));
    await assert.rejects(f.open().step(), error => ["PROCESS_OPERATION_AUTHORITY_UNAVAILABLE", "STANDARD_AUDIT_NATIVE_SOURCE_CHANGED"].includes(error.code));
  } finally { fs.writeFileSync(product, bytes); }
  const intent = before.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_validation_execute").at(-1);
  const validation = f.open().readOperation(intent.intent.operation_id).results.at(-1).output;
  const profile = JSON.parse(fs.readFileSync(verifier.profileRef.path, "utf8"));
  const manifestRef = validation.evidence_refs.find(row => row.ref.endsWith("/result.json")); assert.ok(manifestRef);
  const manifest = JSON.parse(fs.readFileSync(path.join(profile.evidence_root, manifestRef.ref.slice("validation/".length))));
  const ref = manifest.evidence_refs.find(row => row.ref.endsWith(".stdout")); assert.ok(ref);
  const log = path.join(profile.evidence_root, ref.ref.slice("validation/".length)), logBytes = fs.readFileSync(log);
  try {
    fs.writeFileSync(log, Buffer.concat([logBytes, Buffer.from(" ")]));
    await assert.rejects(f.open().step(), { code: "AGENT_RUN_FILE_CHANGED" });
  } finally { fs.writeFileSync(log, logBytes); }
  const originalEvents = fs.readFileSync(eventFile);
  setAllowed(false);
  try { await assert.rejects(f.open().step({ write: true }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" }); }
  finally { setAllowed(true); }
  assert.equal(f.open().inspect().record.instance_sha256, waiting.record.instance_sha256);
  assert.deepEqual(fs.readFileSync(eventFile), originalEvents); assert.equal(artifacts.ownerPending(), false);
  const input = path.join(f.base, "closure-finalize-restart.json");
  fs.writeFileSync(input, JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex"),
    validation_profile: verifier.profileRef, human_source_file: f.closureSourceFile }));
  const child = spawnSync(process.execPath, [script, "--closure-finalize", input], { encoding: "utf8", shell: false, windowsHide: true, timeout: 900000 });
  assert.equal(child.status, 0, child.stderr); const accepted = JSON.parse(child.stdout);
  assert.equal(accepted.launches, 0); assert.equal(accepted.sessions, 0);
  const record = f.open().readOperation(accepted.operation_id), output = record.results.at(-1).output;
  assert.equal(output.operation_ref, "cycle_close_finalize"); assert.equal(output.outcome, "completed", JSON.stringify(output));
  assert.equal(output.effect_status, "confirmed"); assert.deepEqual(output.facts, { cycle_close_completed: true, cycle_retained: true });
  assert.equal(output.observations.committed.length, 3); assert.equal(output.observations.hook.payload.checkpoint.run_id, output.observations.event.run_id);
  assert.match(artifacts.read(cyclePath + "/status.md").content, /"cycle_close_completed": true/);
  assert.equal(artifacts.ownerPending(), false);
  assert.equal(f.t.sessions.length, sessions); assert.equal(verifier.calls(), checks);
  const afterEvents = fs.readFileSync(eventFile), digest = shadowHash(record);
  assert.equal((await f.open().dispatchOperation(accepted.operation_id, { write: true })).status, "retained_result");
  assert.equal(shadowHash(f.open().readOperation(accepted.operation_id)), digest); assert.deepEqual(fs.readFileSync(eventFile), afterEvents);
  const after = f.open().inspect(); assert.equal(after.cursor.status, "WAITING");
  const replay = simulateAgenticProcess({ instanceId: after.record.instance_id, model: after.record.model, parameters: after.record.initial_parameters,
    policyPins: after.record.policy_pins, scopeId: after.record.scope_id, events: after.record.events });
  assert.equal(replay.trace.at(-1).instance_sha256, after.record.instance_sha256);
}
