import { verifyCycleCloseRecordExecution } from "./cycle-close-record-fixture-lib.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";

export function attachCycleClosureModel(model) {
  model.nodes[0].children.splice(-1, 0, "closure_decide");
  model.nodes.push({ id: "closure_decide", kind: "operation", participant_ref: "delivery", binding_ref: "cycle_closure_decision" });
  model.data_bindings.inputs.push({ node_id: "closure_decide", fields: { audit_operation_id: { source: "operation_id", node_id: "audit_evaluate" } } });
  model.operation_pins.cycle_closure_decision = shadowHash(standardWorkflowOperationBindings().find(row => row.id === "cycle_closure_decision"));
}
export function closureHumanSource(file) {
  return { read: ({ sourceRef }) => JSON.parse(fs.readFileSync(file, "utf8"))[sourceRef] ?? null,
    verify({ source, sourceRef, question }) {
      const actual = JSON.parse(fs.readFileSync(file, "utf8"))[sourceRef];
      return sourceRef !== "unverified" && actual && shadowHash(actual) === shadowHash(source) && source.question_sha256 === shadowHash(question)
        ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" };
    } };
}
export async function verifyCycleClosureExecution({ f, artifacts, cyclePath, script, verifier, closeRecord = false, setAllowed }) {
  const before = f.open().inspect(), waiting = before.cursor.occurrences.find(row => row.node_id === "closure_decide"), id = waiting.operation.intent.operation_id;
  process.stderr.write("cycle-closure: durable human question preparation\n");
  const request = await f.open().dispatchOperation(id, { write: true }), question = request.question;
  assert.equal(request.status, "waiting_for_human"); assert.equal(question.contract_version, "standard-cycle-closure-question.v1");
  assert.equal(question.review.cycle_id, "C001"); assert.ok(question.choices.includes("retain"));
  const sessionCount = f.t.sessions.length, checks = verifier.calls(), stateSha = before.record.instance_sha256;
  assert.equal((await f.open().step()).kind, "human_wait");
  assert.equal((await f.open().receiveDecision(id, { sourceRef: "missing", write: true })).status, "waiting_for_human");
  assert.equal(f.open().inspect().record.instance_sha256, stateSha); assert.equal(f.t.sessions.length, sessionCount); assert.equal(verifier.calls(), checks);
  const claim = { contract_version: "human-cycle-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "closure:event:001",
    subject_sha256: shadowHash(question.review), question_sha256: shadowHash(question), choice: "retain", rationale: "Explicit fixture request after reviewing the exact final audit",
    risk_acceptances: [], evidence_refs: [{ ref: "fixture:operator-closure-choice", sha256: "a".repeat(64) }] };
  const publish = (ref, value) => fs.writeFileSync(f.closureSourceFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(f.closureSourceFile, "utf8")), [ref]: value }));
  publish("wrong", { ...claim, question_sha256: "b".repeat(64) });
  await assert.rejects(f.open().receiveDecision(id, { sourceRef: "wrong", write: true }), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
  publish("unverified", claim); await assert.rejects(f.open().receiveDecision(id, { sourceRef: "unverified", write: true }), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
  publish("retained", claim); const received = await f.open().receiveDecision(id, { sourceRef: "retained", write: true });
  assert.equal(received.status, "receipted");
  process.stderr.write("cycle-closure: authenticated human source receipted\n");
  const retained = f.open().readOperation(id), output = retained.results.at(-1).output;
  assert.equal(output.facts.cycle_retention_requested, true); assert.equal(output.observations.lifecycle_transition, "none"); assert.equal(output.observations.skill_completion, "pending");
  const product = path.join(f.configuration.product_root, "app.mjs"), bytes = fs.readFileSync(product);
  try {
    fs.writeFileSync(product, Buffer.concat([bytes, Buffer.from("\n// changed after human capture\n")]));
    await assert.rejects(f.open().acceptOperation(id, { write: true }), { code: "PROCESS_OPERATION_AUTHORITY_UNAVAILABLE" });
  } finally { fs.writeFileSync(product, bytes); }
  assert.equal(f.open().inspect().record.instance_sha256, stateSha);
  process.stderr.write("cycle-closure: changed product rejected; accepting in cold process\n");
  const input = path.join(f.base, "closure-restart.json");
  fs.writeFileSync(input, JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex"),
    validation_profile: verifier.profileRef, human_source_file: f.closureSourceFile, operation_id: id }));
  const child = spawnSync(process.execPath, [script, "--closure-accept", input], { encoding: "utf8", shell: false, windowsHide: true, timeout: 900000 });
  assert.equal(child.status, 0, child.stderr); const accepted = JSON.parse(child.stdout);
  assert.equal(accepted.launches, 0); assert.equal(accepted.sessions, 0);
  const after = f.open().inspect(); assert.notEqual(after.record.instance_sha256, stateSha); if (!closeRecord) assert.equal(after.cursor.status, "WAITING");
  assert.match(artifacts.read(`${cyclePath}/status.md`).content, /^state: VERIFYING$/m);
  assert.equal(artifacts.ownerPending(), false); assert.equal(f.t.sessions.length, sessionCount); assert.equal(verifier.calls(), checks);
  const digest = shadowHash(f.open().readOperation(id));
  assert.equal((await f.open().receiveDecision(id, { sourceRef: "retained", write: true })).status, "retained_result");
  assert.equal(shadowHash(f.open().readOperation(id)), digest);
  const replay = simulateAgenticProcess({ instanceId: after.record.instance_id, model: after.record.model, parameters: after.record.initial_parameters,
    policyPins: after.record.policy_pins, scopeId: after.record.scope_id, events: after.record.events });
  assert.equal(replay.trace.at(-1).instance_sha256, after.record.instance_sha256);
  if (closeRecord) await verifyCycleCloseRecordExecution({ f, artifacts, cyclePath, verifier, setAllowed });
}
