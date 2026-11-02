#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";
import { analyzeStructuredArtifact } from "../../src/lib/workflow/structured-artifact-parser-lib.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
const H = "a".repeat(64), temp = fs.realpathSync(os.tmpdir()), owned = [];
const inputs = { session_initialize: { session_id: "S001", session_branch: "S001-start", objective: "Start a governed session through the common process IR" },
  mode_decision: { session_id: "S001" }, session_start_finalize: { session_id: "S001" } };
function model(humanOnly = false) {
  const ids = humanOnly ? ["mode_decision"] : ["context_reload", "session_admit", "session_initialize", "mode_decision", "session_mode_apply", "session_start_finalize"];
  const bindings = standardWorkflowOperationBindings().filter(binding => ids.includes(binding.id));
  return { contract_version: "agentic-process-model.v2", model_id: "session-mode-fixture", revision: 1, participants: [{ id: "project" }], roles: [], policies: [], entry: "start",
    operation_pins: Object.fromEntries(bindings.map(binding => [binding.id, shadowHash(binding)])),
    nodes: [{ id: "start", kind: "sequence", participant_ref: "project", children: ids }, ...ids.map(id => ({ id, kind: "operation", participant_ref: "project", binding_ref: id }))] };
}
function humanSource(sourcesFile, onRead = () => {}) {
  return { read({ sourceRef }) { onRead(); return JSON.parse(fs.readFileSync(sourcesFile, "utf8"))[sourceRef] ?? null; },
    verify({ source: value, sourceRef, question }) {
      const actual = JSON.parse(fs.readFileSync(sourcesFile, "utf8"))[sourceRef];
      return sourceRef !== "unverified" && actual && shadowHash(actual) === shadowHash(value) && value.question_sha256 === shadowHash(question)
        ? { outcome: "verified", authority_id: value.authority_id, source_sha256: shadowHash(value) } : { outcome: "unverified" };
    } };
}
function openHost(root, keyFile, humanOnly = false, onRead) {
  return createStandardWorkflowOperationHost({ targetRoot: root, model: model(humanOnly), readSigningKey: () => fs.readFileSync(keyFile),
    humanSource: humanSource(path.join(path.dirname(keyFile), "sources.json"), onRead),
    authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H }) });
}
const here = fileURLToPath(import.meta.url);
function acceptInChild(root, keyFile, id, humanOnly = false) {
  return JSON.parse(execFileSync(process.execPath, [here, "--accept", root, keyFile, id, String(humanOnly)],
    { encoding: "utf8", timeout: 30000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
}
if (process.argv[2] === "--accept") {
  const [, , , root, keyFile, id, humanOnly] = process.argv;
  const accepted = await openHost(root, keyFile, humanOnly === "true").accept(id, { write: true });
  process.stdout.write(JSON.stringify({ instance_sha256: accepted.record.instance_sha256 }) + "\n");
} else {
let passed = 0;
try {
  for (const mode of ["files", "dual", "db-only"]) {
    const root = createStandardWorkflowFixture(mode, owned), privateRoot = fs.mkdtempSync(path.join(temp, "aidn-standard-mode-")); owned.push(privateRoot);
    const keyFile = path.join(privateRoot, "host.key"), sourcesFile = path.join(privateRoot, "sources.json"); fs.writeFileSync(keyFile, randomBytes(32)); fs.writeFileSync(sourcesFile, "{}");
    let reads = 0;
    const makeHost = () => openHost(root, keyFile, false, () => reads++);
    const publish = (ref, claim) => fs.writeFileSync(sourcesFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(sourcesFile, "utf8")), [ref]: claim }));
    let runtime = makeHost(); const initial = runtime.initialize({ instanceId: "start" });
    runtime.initialize({ instanceId: "start", write: true, expectedResultSha256: initial.record.instance_sha256 });
    let decisionId;
    for (const id of ["context_reload", "session_admit", "session_initialize", "mode_decision", "session_mode_apply", "session_start_finalize"]) {
      const before = runtime.inspect("start"), occurrence = before.cursor.occurrences.find(row => row.node_id === id && row.status === "READY"); assert.ok(occurrence, id);
      const input = id === "session_mode_apply" ? { decision_operation_id: decisionId } : inputs[id] ?? {};
      if (id === "session_mode_apply") await assert.rejects(runtime.preview({ instanceId: "start", expectedSha256: before.record.instance_sha256,
        occurrenceId: occurrence.occurrence_id, input: { session_id: "S001", mode: "THINKING" } }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
      const preview = await runtime.preview({ instanceId: "start", expectedSha256: before.record.instance_sha256, occurrenceId: occurrence.occurrence_id, input });
      assert.equal(preview.prepared?.can_apply ?? true, true, JSON.stringify(preview.prepared));
      const staged = await runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      let dispatched = await runtime.dispatch(staged.operation_id, { write: true });
      if (id === "mode_decision") {
        decisionId = staged.operation_id;
        assert.equal(dispatched.status, "waiting_for_human"); assert.equal(reads, 0);
        assert.equal((await runtime.receiveDecision(decisionId, { sourceRef: "missing", write: true })).status, "waiting_for_human");
        const claim = { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id: "fixture_user_channel", source_event_id: `decision-${mode}`,
          subject_sha256: H, question_sha256: shadowHash(dispatched.question), choice: "THINKING", evidence_refs: [{ ref: "fixture:operator/mode", sha256: H }] };
        publish("choice", claim);
        dispatched = await runtime.receiveDecision(decisionId, { sourceRef: "choice", write: true });
        const unselected = createStandardWorkflowArtifacts({ targetRoot: root }).read("sessions/S001.md").content;
        assert.equal(analyzeStructuredArtifact(unselected).key_values.mode, "UNKNOWN");
        assert.equal(parseSessionMetadata(unselected).mode, null);
      }
      const output = dispatched.receipt ? runtime.readOutput(dispatched.receipt.evidence_refs[0].ref) : null;
      const expectedGateRefusal = mode === "db-only" && id === "session_start_finalize";
      assert.equal(dispatched.receipt?.outcome, expectedGateRefusal ? "reconciliation_required" : "completed",
        JSON.stringify({ id, status: dispatched.status, outcome: dispatched.receipt?.outcome, reason: output?.observations?.reason_code }));
      if (expectedGateRefusal) {
        // The legacy corpus has a canonical open cycle without a defined goal.
        // The real hook exits successfully but its nested gate requires work.
        // Preserve that refusal; do not manufacture a fresh/complete startup.
        assert.equal(output.effect_status, "unknown"); assert.deepEqual(output.facts, {});
        assert.equal(output.observations.reason_code, "STANDARD_START_HOOK_POSTCONDITION_FAILED");
        const hook = output.observations.hook;
        assert.equal(hook.ok, true); assert.equal(hook.payload.workflow_hook.checkpoint.gate.result, "warn");
        assert.ok(hook.payload.workflow_hook.checkpoint.gate.levels.level2.active_signals.includes("uncertain_intent"));
        assert.equal(createStandardWorkflowArtifacts({ targetRoot: root }).ownerPending(), true);
      }
      const journalHash = shadowHash(runtime.readJournal(staged.operation_id));
      const accepted = acceptInChild(root, keyFile, staged.operation_id);
      runtime = makeHost(); assert.equal(runtime.inspect("start").record.instance_sha256, accepted.instance_sha256);
      assert.equal(shadowHash(runtime.readJournal(staged.operation_id)), journalHash);
      assert.equal((await runtime.dispatch(staged.operation_id, { write: true })).status, "retained_result");
      if (id === "mode_decision") {
        const proof = output.evidence_refs[0]; assert.equal(shadowHash(runtime.readDecisionSource(proof.ref)), proof.sha256);
      }
      process.stdout.write(`PASS ${mode}: ${id}${expectedGateRefusal ? ", nested gate refusal retained despite successful hook exit" : ""}\n`); passed++;
    }
    const final = runtime.inspect("start"); assert.equal(final.cursor.status, mode === "db-only" ? "WAITING" : "COMPLETED");
    if (mode === "db-only") assert.ok(final.cursor.occurrences.some(row => row.node_id === "session_start_finalize" && row.wait_reason === "reconciliation_required"));
    assert.equal(parseSessionMetadata(createStandardWorkflowArtifacts({ targetRoot: root }).read("sessions/S001.md").content).mode, "THINKING");
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
    process.stdout.write(`PASS ${mode}: exact simulation of human choice and ${mode === "db-only" ? "unresolved startup" : "real completed startup"}\n`); passed++;
    const business = createStandardWorkflowArtifacts({ targetRoot: root }), beforeBusiness = [business.read("CURRENT-STATE.md").sha256, business.read("sessions/S001.md").sha256];
    const capture = async (name, choice, reusedId = null) => {
      const host = openHost(root, keyFile, true), initial = host.initialize({ instanceId: name });
      host.initialize({ instanceId: name, write: true, expectedResultSha256: initial.record.instance_sha256 });
      async function stage() {
        const state = host.inspect(name), frame = state.cursor.occurrences.find(row => row.node_id === "mode_decision");
        const preview = await host.preview({ instanceId: name, expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id, input: { session_id: "S001" } });
        const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
        const waiting = await host.dispatch(staged.operation_id, { write: true }); assert.equal(waiting.status, "waiting_for_human");
        return { id: staged.operation_id, question: waiting.question };
      }
      let request = await stage(); const before = host.inspect(name).record.instance_sha256, journal = shadowHash(host.readJournal(request.id));
      await assert.rejects(host.receiveDecision(request.id, { sourceRef: "absent" }), { code: "STANDARD_HOST_EXPLICIT_WRITE_REQUIRED" });
      assert.equal((await host.receiveDecision(request.id, { sourceRef: "absent", write: true })).status, "waiting_for_human");
      assert.equal(host.inspect(name).record.instance_sha256, before); assert.equal(shadowHash(host.readJournal(request.id)), journal);
      const claim = { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id: "fixture_user_channel", source_event_id: reusedId ?? `${name}-${mode}`,
        subject_sha256: H, question_sha256: shadowHash(request.question), choice, evidence_refs: [{ ref: "fixture:operator/decision", sha256: H }] };
      publish("wrong-question", { ...claim, question_sha256: H });
      await assert.rejects(host.receiveDecision(request.id, { sourceRef: "wrong-question", write: true }), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
      publish("unverified", claim);
      await assert.rejects(host.receiveDecision(request.id, { sourceRef: "unverified", write: true }), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
      assert.equal(host.inspect(name).record.instance_sha256, before); assert.equal(shadowHash(host.readJournal(request.id)), journal);
      publish(name, claim);
      if (reusedId) {
        await assert.rejects(host.receiveDecision(request.id, { sourceRef: name, write: true }), { code: "PROCESS_HUMAN_SOURCE_ALREADY_USED" });
        assert.equal(host.inspect(name).record.instance_sha256, before); return;
      }
      const received = await host.receiveDecision(request.id, { sourceRef: name, write: true });
      assert.equal(received.receipt.outcome, choice === "refused" ? "rejected" : choice);
      const sourceProof = host.readOutput(received.receipt.evidence_refs[0].ref).evidence_refs[0];
      assert.equal(shadowHash(host.readDecisionSource(sourceProof.ref)), sourceProof.sha256);
      acceptInChild(root, keyFile, request.id, true);
      assert.equal(host.inspect(name).cursor.status, choice === "refused" ? "FAILED" : choice === "cancelled" ? "CANCELLED" : "WAITING");
      if (choice === "deferred") {
        const old = request; request = await stage(); assert.notEqual(request.id, old.id);
        await assert.rejects(host.receiveDecision(request.id, { sourceRef: name, write: true }), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
        publish("resumed", { ...claim, source_event_id: `${name}-${mode}-resumed`, question_sha256: shadowHash(request.question), choice: "EXPLORING" });
        await host.receiveDecision(request.id, { sourceRef: "resumed", write: true }); acceptInChild(root, keyFile, request.id, true);
        assert.equal(host.inspect(name).cursor.status, "COMPLETED");
      }
      const state = host.inspect(name), simulated = simulateAgenticProcess({ instanceId: state.record.instance_id, model: state.record.model,
        policyPins: state.record.policy_pins, scopeId: state.record.scope_id, events: state.record.events });
      assert.equal(simulated.trace.at(-1).instance_sha256, state.record.instance_sha256);
    };
    for (const choice of ["refused", "deferred", "cancelled"]) {
      await capture(choice, choice); process.stdout.write(`PASS ${mode}: ${choice}, authenticated waiting/resume and exact simulation\n`); passed++;
    }
    await capture("duplicate", "COMMITTING", `decision-${mode}`);
    assert.deepEqual([business.read("CURRENT-STATE.md").sha256, business.read("sessions/S001.md").sha256], beforeBusiness);
    process.stdout.write(`PASS ${mode}: source identity cannot be reused; human protocol never reapplies business effects\n`); passed++;
  }
  process.stdout.write(JSON.stringify({ status: "PASS", checks: passed, human_authority: "fixture-source-adapter", native: "NOT_RUN", full_standard_workflow: "NOT_YET_DELIVERED" }) + "\n");
} finally {
  for (const root of owned) { const real = fs.realpathSync(root); if (path.dirname(real) !== temp || !path.basename(real).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID"); fs.rmSync(real, { recursive: true, force: true }); }
}
}
