#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { assertAgenticProcessModel, agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { assertProcessOperationBinding } from "../../src/core/workflow/process-operation-contracts.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { createAgenticProcessService } from "../../src/application/runtime/agentic-process-service.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { evaluateAgentReuse, fingerprintAgentReuse } from "../../src/core/agents/agent-reuse-policy.mjs";
import { activateWorkflowConsoleFixture } from "./workflow-console-fixture-lib.mjs";
import { createProjectWorkflowConsole } from "../../src/application/runtime/workflow-console-composition.mjs";

const H = "a".repeat(64), OTHER = "b".repeat(64), root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-process-operations-"));
let count = 0, serial = 0;
const op = id => ({ id, kind: "operation", participant_ref: "project", binding_ref: id });
const model = (entry = op("reload"), children = []) => ({ contract_version: "agentic-process-model.v2", model_id: "operation-fixture", revision: 1,
  participants: [{ id: "project" }], roles: [], policies: [], entry: entry.id, nodes: [entry, ...children],
  operation_pins: Object.fromEntries([entry, ...children].filter(node => node.kind === "operation").map(node => [node.binding_ref, shadowHash(binding(node.binding_ref))])) });
const wait = id => ({ id, kind: "event", participant_ref: "project", branches: [{ flow_id: "approved", node_id: id + "-yes", event_key: "approved" }, { flow_id: "declined", node_id: id + "-no", event_key: "declined" }] });
const eventModel = () => model(wait("review"), [op("review-yes"), op("review-no")]);
function delivery(state, id = "delivery", source = "provider-event") {
  const frame = inspectAgenticProcess(state).occurrences.find(row => row.wait_reason === "event");
  return { contract_version: "process-control-event.v1", delivery_id: id, authority_id: "review-host", source_kind: "external", source_event_id: source,
    subject_sha256: H, scope_id: state.scope_id, instance_id: state.instance_id, instance_sha256: state.instance_sha256, model_sha256: state.model_sha256, instance_revision: state.revision,
    occurrence_id: frame.occurrence_id, correlation_id: frame.correlation_id, event_key: "approved", payload_sha256: H, evidence_refs: [{ ref: "fixture/review", sha256: H }] };
}
function control(state, value = delivery(state)) {
  return advanceAgenticProcess(state, { event_id: "control-" + ++serial, kind: "control", occurrence_id: value.occurrence_id, delivery: value });
}
const initial = m => createAgenticProcess({ instanceId: "fixture", model: m, policyPins: agenticPolicyPins(m), scopeId: "scope-1" });
const binding = (id = "reload", executor = "deterministic", effect = "read-only") => ({ contract_version: "process-operation-binding.v1", id, revision: 1,
  executor_kind: executor, effect_class: effect, skill_id: "context-reload", input_contract: "reload-input.v1", output_contract: "reload-output.v1",
  rule_refs: ["SPEC-R01"], allowed_modes: ["UNKNOWN", "COMMITTING"], implementation_sha256: H });
function intent(state, occurrence = inspectAgenticProcess(state).ready[0], id = "op-" + ++serial, bound = null) {
  const frame = inspectAgenticProcess(state).occurrences.find(row => row.occurrence_id === occurrence);
  const node = state.model.nodes.find(row => row.id === frame.node_id), b = bound ?? binding(node.binding_ref);
  return { contract_version: "process-operation-intent.v1", operation_id: id, binding_ref: node.binding_ref,
    binding_sha256: shadowHash(b), input_sha256: H, preconditions_sha256: H, authorization_sha256: null,
    authority_id: "fixture-host", scope_id: state.scope_id, instance_id: state.instance_id, instance_sha256: state.instance_sha256,
    model_sha256: state.model_sha256, occurrence_id: occurrence, instance_revision: state.revision };
}
function prepare(state, id = "op-" + ++serial) {
  const occurrence_id = inspectAgenticProcess(state).ready[0];
  return advanceAgenticProcess(state, { event_id: "intent-" + ++serial, kind: "operation_intent", occurrence_id, intent: intent(state, occurrence_id, id) });
}
function receipt(value, outcome = "completed", facts = {}, effect = "no_effect") {
  return { contract_version: "process-operation-receipt.v1", receipt_id: "receipt-" + ++serial, operation_id: value.operation_id,
    intent_sha256: shadowHash(value), authority_id: value.authority_id, outcome, effect_status: effect, output_sha256: H, facts,
    evidence_refs: [{ ref: "fixture/operation", sha256: H }] };
}
function result(state, outcome = "completed", facts = {}, effect = "no_effect") {
  const frame = inspectAgenticProcess(state).occurrences.find(row => row.operation && row.status === "WAITING");
  return advanceAgenticProcess(state, { event_id: "result-" + ++serial, kind: "operation_result", occurrence_id: frame.occurrence_id,
    receipt: receipt(frame.operation.intent, outcome, facts, effect) });
}
async function check(name, callback) { await callback(); count++; console.log("PASS " + name); }
function fixture(mode = "files", timeout = 1000, m = model()) {
  const targetRoot = path.join(root, "case-" + ++serial); fs.mkdirSync(path.join(targetRoot, ".aidn"), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode: mode } }));
  if (mode !== "files") createArtifactStore({ sqliteFile: path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite") }).close();
  const b = binding(), store = () => createAgenticProcessStore({ targetRoot, stateMode: mode });
  const state = { authentic: true, binding: b, intent: null, receipt: null, scope: "scope-1", onVerifyReceipt: () => {}, prepare: null };
  const operationAuthority = {
    prepare({ instance, occurrence }) { const value = state.prepare ? state.prepare() : intent(instance, occurrence.occurrence_id, "service-op", state.binding); state.intent = value; return { binding: state.binding, intent: value }; },
    verifyIntent({ binding, intent }) { return { outcome: state.authentic ? "verified" : "refused", authority_id: intent.authority_id, intent_sha256: shadowHash(intent), binding_sha256: shadowHash(binding) }; },
    readReceipt() { return state.receipt; },
    verifyReceipt({ receipt, intent }) { state.onVerifyReceipt(); return { outcome: state.authentic ? "verified" : "refused", authority_id: intent.authority_id, receipt_sha256: shadowHash(receipt), intent_sha256: shadowHash(intent) }; },
  };
  const service = (overrides = {}) => createAgenticProcessService({ store: store(), readAuthority: () => ({ scope_id: state.scope, model_sha256: shadowHash(m), policy_pins: {} }),
    operationAuthority, authorityTimeoutMs: timeout, ...overrides });
  const start = service().initialize({ instanceId: "fixture", model: m, write: true });
  return { state, store, service, start, operationAuthority };
}
try {
  await check("v1 historical hashes match the frozen dd1dbab reducer without conversion", () => {
    const m = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
    const state = createAgenticProcess({ instanceId: "historical", scopeId: "scope-1", model: m, policyPins: agenticPolicyPins(m) });
    assert.equal(state.contract_version, "agentic-process-instance.v1");
    assert.equal(state.instance_sha256, "f0fbe15fcc0de419f62c000e842f73ce3ed5f61036086551454e80a185783575");
    const next = advanceAgenticProcess(state, { event_id: "observed", kind: "facts", facts: { ready: true } });
    assert.equal(next.instance_sha256, "e3d1234cc571c12a01951a555f7db03e141bdeda0f6d6c130ec436e13a5ed1ff");
  });
  await check("closed versioned operation schemas reject unknown fields and do not alter v1", () => {
    for (const name of ["process-operation-binding.v1", "process-operation-intent.v1", "process-operation-receipt.v1", "process-control-event.v1", "agentic-process-model.v2", "agentic-process-instance.v2"]) {
      const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)));
      assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
    }
    for (const kind of ["deterministic", "human", "external"]) assertProcessOperationBinding(binding("reload", kind));
    assert.throws(() => assertProcessOperationBinding({ ...binding(), command: "arbitrary" }), /BINDING_INVALID/);
    assert.throws(() => assertProcessOperationBinding({ ...binding(), rule_refs: ["SPEC-R01", "SPEC-R01"] }), /BINDING_INVALID/);
    assert.throws(() => assertAgenticProcessModel({ ...model(), contract_version: "agentic-process-model.v1" }), /PROCESS_MODEL_INVALID/);
    assert.throws(() => assertAgenticProcessModel(model({ ...op("reload"), role_ref: "fake" })), /PROCESS_OPERATION_NODE_INVALID/);
    assert.throws(() => assertAgenticProcessModel({ ...model(), operation_pins: {} }), /PROCESS_OPERATION_PINS_INVALID/);
  });
  await check("operations need no fabricated role, agent, assignment or session; v2 waits are explicit", () => {
    const start = initial(model()), waiting = prepare(start);
    assert.equal(start.contract_version, "agentic-process-instance.v2"); assert.deepEqual(start.policy_pins, {});
    assert.equal(inspectAgenticProcess(waiting).status, "WAITING");
    const done = result(waiting); assert.equal(inspectAgenticProcess(done).status, "COMPLETED");
    assert.equal(done.events.some(row => row.kind === "assign"), false);
  });
  await check("v2 interleaves host operations and unchanged native assignment/result semantics in one reducer", () => {
    const example = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
    const m = { ...model({ id: "sequence", kind: "sequence", participant_ref: "project", children: ["reload", "work"] },
      [op("reload"), { id: "work", kind: "activity", participant_ref: "project", role_ref: "implementation", policy_ref: "work" }]), roles: example.roles, policies: example.policies };
    const state = result(prepare(initial(m))), activity = inspectAgenticProcess(state).ready[0], policy = m.policies.find(row => row.id === "work");
    const request = { contract_version: "agent-reuse-request.v1", activity_id: activity, scope_id: "scope-1", revision: "revision-1", artifact_sha256: H, criteria_sha256: H,
      ...Object.fromEntries(["assurance_profile", "mode", "independent_review", "context_isolation_required", "required_permissions", "allowed_permissions"].map(key => [key, policy[key]])),
      role: "executor", action: "implement", allowed_context_sha256: [H], reviewed_contributors: [] };
    const now = 1700000000000, executor = { execution_id: "native-execution", agent_id: "author", lineage_id: "author", session_id: "native-session", adapter_id: "fixture-adapter",
      role: "executor", action: "implement", permissions: policy.allowed_permissions, guarantees: [], context_sha256: [H], contributions: [] };
    const observation = { contract_version: "agent-reuse-observation.v1", authority_id: "native-authority", observation_id: "native-observation", request_sha256: fingerprintAgentReuse(request),
      ...Object.fromEntries(["scope_id", "revision", "assurance_profile", "artifact_sha256", "criteria_sha256"].map(key => [key, request[key]])),
      observed_at: new Date(now - 1).toISOString(), expires_at: new Date(now + 5000).toISOString(), current_execution_id: executor.execution_id, executors: [executor], evidence_refs: [{ ref: "fixture/native", sha256: H }] };
    const decision = evaluateAgentReuse({ request, observation, eligibleAdapterIds: ["fixture-adapter"], now });
    assert.equal(decision.decision, "reuse");
    const assigned = advanceAgenticProcess(state, { event_id: "native-assignment", kind: "assign", occurrence_id: activity, request, decision });
    const completed = advanceAgenticProcess(assigned, { event_id: "native-result", kind: "result", occurrence_id: activity, result: {
      result_id: "native-result", request_sha256: fingerprintAgentReuse(request), execution_id: executor.execution_id, revision: request.revision,
      artifact_sha256: H, criteria_sha256: H, outcome: "completed", evidence_refs: [{ ref: "fixture/native-result", sha256: H }],
    } });
    assert.equal(inspectAgenticProcess(completed).status, "COMPLETED");
  });
  for (const outcome of ["blocked", "deferred", "reconciliation_required", "failed", "rejected", "cancelled"]) await check("non-success operation outcome remains explicit: " + outcome, () => {
    const state = result(prepare(initial(model())), outcome, {}, outcome === "reconciliation_required" ? "unknown" : "no_effect");
    assert.equal(inspectAgenticProcess(state).status, outcome === "cancelled" ? "CANCELLED" : ["failed", "rejected"].includes(outcome) ? "FAILED" : "WAITING");
    if (["failed", "rejected", "cancelled"].includes(outcome)) assert.throws(() => result(state), /./);
  });
  await check("unknown effects require a reconciled receipt, never a fresh dispatch intent", () => {
    const waiting = result(prepare(initial(model())), "reconciliation_required", {}, "unknown");
    const frame = inspectAgenticProcess(waiting).occurrences[0];
    assert.throws(() => advanceAgenticProcess(waiting, { event_id: "retry", kind: "operation_intent", occurrence_id: "root", intent: intent(waiting, "root") }), /ORDER_INVALID/);
    const completed = result(waiting, "completed", {}, "confirmed");
    assert.equal(completed.events.length, 3); assert.equal(inspectAgenticProcess(completed).status, "COMPLETED");
    assert.equal(completed.events[2].receipt.intent_sha256, shadowHash(frame.operation.intent));
  });
  await check("deferred work requires an explicit fresh intent; an operation identity is never reused", () => {
    const deferred = result(prepare(initial(model()), "first"), "deferred");
    const next = { event_id: "retry", kind: "operation_intent", occurrence_id: "root", intent: intent(deferred, "root", "first") };
    assert.throws(() => advanceAgenticProcess(deferred, next), /ID_REUSED/);
    next.intent = intent(deferred, "root", "second");
    assert.equal(inspectAgenticProcess(result(advanceAgenticProcess(deferred, next))).status, "COMPLETED");
  });
  await check("receipt facts wake existing parallel routing waits with the common reducer", () => {
    const m = model({ id: "parallel", kind: "and", participant_ref: "project", branches: [{ flow_id: "set", node_id: "setter" }, { flow_id: "choose", node_id: "choice" }] }, [op("setter"),
      { id: "choice", kind: "xor", participant_ref: "project", branches: [{ flow_id: "approved", node_id: "accept", condition: "approved" }, { flow_id: "default", node_id: "decline", condition: null }] }, op("accept"), op("decline")]);
    const state = result(prepare(initial(m)), "completed", { approved: true });
    assert.equal(inspectAgenticProcess(state).occurrences.find(row => row.occurrence_id === inspectAgenticProcess(state).ready[0]).node_id, "accept");
    assert.equal(inspectAgenticProcess(result(prepare(state))).status, "COMPLETED");
  });
  await check("replay and simulation preserve exact v2 cursor and hash, with idempotent events", () => {
    const m = model(), done = result(prepare(initial(m)));
    let replay = initial(m); for (const event of done.events) replay = advanceAgenticProcess(replay, event);
    assert.equal(replay.instance_sha256, done.instance_sha256);
    assert.equal(advanceAgenticProcess(replay, done.events[1]).instance_sha256, replay.instance_sha256);
    const simulated = simulateAgenticProcess({ instanceId: "fixture", model: m, policyPins: {}, scopeId: "scope-1", events: done.events });
    assert.deepEqual(simulated.trace.at(-1).cursor, inspectAgenticProcess(done)); assert.equal(simulated.trace.at(-1).instance_sha256, done.instance_sha256);
  });
  await check("foreign receipt/intent, premature completion and unsafe facts/effects are rejected", () => {
    const start = initial(model()), waiting = prepare(start), frame = inspectAgenticProcess(waiting).occurrences[0];
    const value = receipt(frame.operation.intent);
    for (const changed of [{ ...value, intent_sha256: OTHER }, { ...value, authority_id: "foreign" }, { ...value, outcome: "deferred", facts: { approved: true } }, { ...value, outcome: "blocked", effect_status: "confirmed" }])
      assert.throws(() => advanceAgenticProcess(waiting, { event_id: "bad", kind: "operation_result", occurrence_id: "root", receipt: changed }), /PROCESS_OPERATION_/);
    assert.throws(() => advanceAgenticProcess(start, { event_id: "early", kind: "operation_result", occurrence_id: "root", receipt: value }), /ORDER_INVALID/);
    assert.throws(() => advanceAgenticProcess(start, { event_id: "foreign", kind: "operation_intent", occurrence_id: "root", intent: { ...intent(start), scope_id: "foreign" } }), /BINDING_CHANGED/);
    for (const patch of [{ instance_id: "foreign" }, { instance_sha256: OTHER }, { model_sha256: OTHER }, { occurrence_id: "foreign" }])
      assert.throws(() => advanceAgenticProcess(start, { event_id: "foreign", kind: "operation_intent", occurrence_id: "root", intent: { ...intent(start), ...patch } }), /BINDING_CHANGED/);
  });
  for (const mode of ["files", "dual", "db-only"]) await check("trusted operation ports preserve CAS, preview and durable waiting: " + mode, async () => {
    const c = fixture(mode), args = { instanceId: "fixture", expectedSha256: c.start.record.instance_sha256, occurrenceId: "root", eventId: "admit" };
    const preview = await c.service().prepareOperation(args);
    assert.equal(c.store().read("fixture").record.revision, 1); assert.equal(preview.written, false);
    let current = await c.service().prepareOperation({ ...args, write: true, expectedResultSha256: preview.record.instance_sha256 });
    assert.equal(c.service().inspect("fixture").cursor.status, "WAITING");
    c.state.receipt = receipt(c.state.intent);
    current = await c.service().acceptOperation({ instanceId: "fixture", expectedSha256: current.record.instance_sha256, occurrenceId: "root", eventId: "accepted", receiptId: c.state.receipt.receipt_id, write: true });
    assert.equal(current.cursor.status, "COMPLETED");
    assert.equal(c.service().inspect("fixture").record.instance_sha256, current.record.instance_sha256);
  });
  await check("unverified ports, missing permission and forged caller controls leave canonical state unchanged", async () => {
    const c = fixture(), args = { instanceId: "fixture", expectedSha256: c.start.record.instance_sha256, occurrenceId: "root", eventId: "admit", write: true };
    c.state.authentic = false; await assert.rejects(() => c.service().prepareOperation(args), /INTENT_NOT_AUTHENTICATED/);
    c.state.authentic = true; c.state.binding = binding("reload", "deterministic", "mutating");
    await assert.rejects(() => c.service().prepareOperation(args), /INTENT_BINDING_CHANGED/);
    assert.throws(() => c.service().signal({ ...args, event: { event_id: "fake", kind: "facts", facts: { approved: true } } }), /AUTHENTICATED_CONTROL_REQUIRED/);
    assert.equal(c.store().read("fixture").record.revision, 1);
  });
  await check("a matching mutating binding still requires explicit authorization before canonical intent", async () => {
    const b = binding("reload", "deterministic", "mutating"), m = { ...model(), operation_pins: { reload: shadowHash(b) } };
    const c = fixture("files", 1000, m); c.state.binding = b;
    await assert.rejects(() => c.service().prepareOperation({ instanceId: "fixture", expectedSha256: c.start.record.instance_sha256, occurrenceId: "root", eventId: "admit", write: true }), /INTENT_BINDING_CHANGED/);
    assert.equal(c.store().read("fixture").record.revision, 1);
  });
  await check("receipt authority and current project authority are rechecked before CAS", async () => {
    const c = fixture(), current = await c.service().prepareOperation({ instanceId: "fixture", expectedSha256: c.start.record.instance_sha256, occurrenceId: "root", eventId: "admit", write: true });
    c.state.receipt = receipt(c.state.intent); c.state.authentic = false;
    const args = { instanceId: "fixture", expectedSha256: current.record.instance_sha256, occurrenceId: "root", eventId: "accepted", receiptId: c.state.receipt.receipt_id, write: true };
    await assert.rejects(() => c.service().acceptOperation(args), /RESULT_NOT_AUTHENTICATED/);
    c.state.authentic = true; c.state.onVerifyReceipt = () => { c.state.scope = "changed"; };
    await assert.rejects(() => c.service().acceptOperation(args), /PROCESS_AUTHORITY_CHANGED/);
    assert.equal(c.store().read("fixture").record.instance_sha256, current.record.instance_sha256);
  });
  await check("two competing authenticated receipts produce one canonical CAS winner", async () => {
    const c = fixture(), waiting = await c.service().prepareOperation({ instanceId: "fixture", expectedSha256: c.start.record.instance_sha256, occurrenceId: "root", eventId: "admit", write: true });
    const receipts = [receipt(c.state.intent), receipt(c.state.intent)];
    const service = c.service({ operationAuthority: { ...c.operationAuthority, readReceipt({ receipt_id }) { return receipts.find(row => row.receipt_id === receipt_id); } } });
    const results = await Promise.allSettled(receipts.map((value, index) => service.acceptOperation({ instanceId: "fixture", expectedSha256: waiting.record.instance_sha256,
      occurrenceId: "root", eventId: "race-" + index, receiptId: value.receipt_id, write: true })));
    assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
    assert.equal(c.store().read("fixture").record.events.length, 2);
  });
  await check("operation authority timeouts are bounded, aborted and retain no partial canonical intent", async () => {
    const c = fixture("files", 15); let signal;
    const service = createAgenticProcessService({ store: c.store(), readAuthority: () => ({ scope_id: "scope-1", model_sha256: c.start.record.model_sha256, policy_pins: {} }),
      authorityTimeoutMs: 15, operationAuthority: { prepare(input) { signal = input.signal; return new Promise(() => {}); } } });
    await assert.rejects(() => service.prepareOperation({ instanceId: "fixture", expectedSha256: c.start.record.instance_sha256, occurrenceId: "root", eventId: "admit", write: true }), /AUTHORITY_TIMEOUT/);
    assert.equal(signal.aborted, true); assert.equal(c.store().read("fixture").record.revision, 1);
  });
  await check("human/external deliveries bind scope, revision and correlation; raw v2 messages refuse", () => {
    const state = initial(eventModel()), value = delivery(state);
    assert.equal(inspectAgenticProcess(state).status, "WAITING");
    for (const patch of [{ scope_id: "foreign" }, { instance_id: "foreign" }, { instance_sha256: OTHER }, { model_sha256: OTHER }, { correlation_id: "foreign" }, { instance_revision: 2 }])
      assert.throws(() => control(state, { ...value, ...patch }), /CONTROL_BINDING_CHANGED/);
    assert.throws(() => advanceAgenticProcess(state, { event_id: "raw", kind: "message", occurrence_id: "root", correlation_id: "fixture:root", event_key: "approved" }), /AUTHENTICATED_CONTROL_REQUIRED/);
    const accepted = control(state);
    assert.equal(inspectAgenticProcess(accepted).occurrences.find(row => row.occurrence_id === inspectAgenticProcess(accepted).ready[0]).node_id, "review-yes");
    const simulation = simulateAgenticProcess({ instanceId: "fixture", model: eventModel(), policyPins: {}, scopeId: "scope-1", events: accepted.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, accepted.instance_sha256);
  });
  await check("a provider event cannot authorize two different waiting occurrences", () => {
    const m = model({ id: "sequence", kind: "sequence", participant_ref: "project", children: ["first", "second"] },
      [wait("first"), op("first-yes"), op("first-no"), wait("second"), op("second-yes"), op("second-no")]);
    const first = control(initial(m));
    const second = result(prepare(first));
    assert.throws(() => control(second, delivery(second, "different-delivery", "provider-event")), /CONTROL_REUSED/);
  });
  await check("service delivers only host-authenticated human/external envelopes and retains preview purity", async () => {
    const c = fixture("files", 1000, eventModel()), value = { ...delivery(c.start.record), source_kind: "human" }; let authentic = false;
    const service = c.service({ controlAuthority: {
      read() { return value; }, verify() { return { outcome: authentic ? "verified" : "refused", authority_id: value.authority_id, delivery_sha256: shadowHash(value) }; },
    } });
    const args = { instanceId: "fixture", expectedSha256: c.start.record.instance_sha256, occurrenceId: "root", eventId: "review", deliveryId: value.delivery_id };
    await assert.rejects(() => service.deliverControl({ ...args, write: true }), /CONTROL_NOT_AUTHENTICATED/);
    assert.equal(c.store().read("fixture").record.revision, 1);
    authentic = true; const preview = await service.deliverControl(args);
    assert.equal(preview.written, false); assert.equal(c.store().read("fixture").record.revision, 1);
    const accepted = await service.deliverControl({ ...args, write: true, expectedResultSha256: preview.record.instance_sha256 });
    const duplicate = await service.deliverControl({ ...args, expectedSha256: accepted.record.instance_sha256, write: true });
    assert.equal(duplicate.written, false); assert.equal(c.store().read("fixture").record.events.length, 1);
  });
  await check("common project composition and console retain v2 identity without accepting raw control facts", async () => {
    const targetRoot = path.join(root, "console-project"); activateWorkflowConsoleFixture(targetRoot, path.join(root, "package"));
    const service = createProjectWorkflowConsole({ targetRoot });
    const request = { operation: "initialize", input: { instanceId: "typed", model: model() } };
    const preview = await service.action(request); assert.deepEqual(preview.errors, []);
    const created = await service.action(request, { write: true, expectPlan: preview.action_sha256 });
    assert.deepEqual(created.errors, []); assert.equal(created.result.record.contract_version, "agentic-process-instance.v2");
    const view = await service.inspect({ instanceId: "typed" });
    assert.deepEqual(view.errors, []); assert.equal(view.view.instances[0].engine, "agentic");
    assert.equal(view.view.instances[0].model.contract_version, "agentic-process-model.v2");
    const refused = await service.action({ operation: "signal", input: { instanceId: "typed", expectedSha256: created.result.record.instance_sha256,
      event: { kind: "facts", event_id: "forged", facts: { approved: true } } } });
    assert.deepEqual(refused.errors, ["PROCESS_AUTHENTICATED_CONTROL_REQUIRED"]);
  });
  await import('./verify-process-prefix-hashing-fixtures.mjs');
  await import('./verify-process-model-capacity-fixtures.mjs');
  await import('./verify-standard-session-closure-history-fixtures.mjs');
  console.log(JSON.stringify({ status: "PASS", checks: count, proof: "offline-contracts-reducer-service", native_calls: 0, standard_workflow_integration: "NOT_YET_DELIVERED" }));
} finally {
  const physical = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir());
  if (path.dirname(physical) !== parent || !path.basename(physical).startsWith("aidn-process-operations-")) throw new Error("PROCESS_FIXTURE_CLEANUP_OUT_OF_SCOPE");
  fs.rmSync(physical, { recursive: true, force: true });
}
