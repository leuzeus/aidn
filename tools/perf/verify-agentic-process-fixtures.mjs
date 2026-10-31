#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertAgenticProcessModel, agenticPolicyPins, agenticProcessCapabilities } from "../../src/core/workflow/agentic-process-model.mjs";
import { createAgenticProcess, inspectAgenticProcess, advanceAgenticProcess, assertAgenticProcessInstance } from "../../src/core/workflow/agentic-process.mjs";
import { createAgenticProcessService } from "../../src/application/runtime/agentic-process-service.mjs";
import { decideAgentReuse } from "../../src/application/runtime/agent-reuse-decision-service.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { evaluateAgentReuse, fingerprintAgentReuse } from "../../src/core/agents/agent-reuse-policy.mjs";
import { AGENT_ROLES, buildAgentProfile, canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";

const example = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
const H = "a".repeat(64), OTHER = "b".repeat(64), NOW = Date.now();
const cases = []; let serial = 0;
async function check(name, run) { await run(); cases.push(name); console.log("PASS " + name); }
const event = value => ({ event_id: "event-" + ++serial, ...value });
const leaf = id => ({ id, kind: "activity", participant_ref: "delivery", role_ref: "implementation", policy_ref: "work" });
function model(root = leaf("task"), children = []) { return { ...structuredClone(example), model_id: "fixture", entry: root.id, nodes: [root, ...children] }; }
const initial = (m = model(), facts = {}) => createAgenticProcess({ instanceId: "fixture", model: m, policyPins: agenticPolicyPins(m), scopeId: "scope-1", facts });
const inspect = inspectAgenticProcess;
function executor(suffix = "author") { return { execution_id: `execution-${suffix}`, agent_id: suffix, lineage_id: `lineage-${suffix}`, session_id: `session-${suffix}`,
  adapter_id: "fixture-adapter", role: "executor", action: "implement", permissions: ["read:product"],
  guarantees: ["context-isolated", "protected-verdict"], context_sha256: [H], contributions: [] }; }
function requestFor(state, occurrence) {
  const frame = inspect(state).occurrences.find(row => row.occurrence_id === occurrence), node = state.model.nodes.find(row => row.id === frame.node_id);
  const role = state.model.roles.find(row => row.id === node.role_ref), policy = state.model.policies.find(row => row.id === node.policy_ref);
  return { contract_version: "agent-reuse-request.v1", activity_id: occurrence, scope_id: state.scope_id, revision: "revision-1", artifact_sha256: H, criteria_sha256: H,
    ...Object.fromEntries(["assurance_profile", "mode", "independent_review", "context_isolation_required", "required_permissions", "allowed_permissions"].map(key => [key, policy[key]])),
    role: role.role, action: role.action, allowed_context_sha256: [H], reviewed_contributors: policy.independent_review ? [{ agent_id: "author", lineage_id: "lineage-author" }] : [] };
}
function observation(request, resource = executor()) { return { contract_version: "agent-reuse-observation.v1", authority_id: "fixture-authority", observation_id: "snapshot-1",
  request_sha256: fingerprintAgentReuse(request), scope_id: request.scope_id, revision: request.revision, assurance_profile: request.assurance_profile,
  artifact_sha256: request.artifact_sha256, criteria_sha256: request.criteria_sha256, observed_at: new Date(NOW - 1).toISOString(), expires_at: new Date(NOW + 5000).toISOString(),
  current_execution_id: resource.execution_id, executors: [resource], evidence_refs: [{ ref: "fixture/snapshot", sha256: H }] }; }
function assigned(state, occurrence = inspect(state).ready[0], resource = executor()) {
  const request = requestFor(state, occurrence), decision = evaluateAgentReuse({ request, observation: observation(request, resource), eligibleAdapterIds: ["fixture-adapter"], now: NOW });
  return advanceAgenticProcess(state, event({ kind: "assign", occurrence_id: occurrence, request, decision }));
}
function resultFor(frame, outcome = "completed") { return { result_id: "result-" + ++serial, request_sha256: fingerprintAgentReuse(frame.assignment.request),
  execution_id: frame.assignment.decision.execution_id, revision: frame.assignment.request.revision, artifact_sha256: frame.assignment.request.artifact_sha256,
  criteria_sha256: frame.assignment.request.criteria_sha256, outcome, evidence_refs: [{ ref: "fixture/result", sha256: H }] }; }
function completed(state, occurrence = inspect(state).ready[0], outcome = "completed") {
  const active = assigned(state, occurrence), frame = inspect(active).occurrences.find(row => row.occurrence_id === occurrence);
  return advanceAgenticProcess(active, event({ kind: "result", occurrence_id: occurrence, result: resultFor(frame, outcome) }));
}
function gateway(kind, size = 2) { return model({ id: "gate", kind, participant_ref: "delivery", branches: Array.from({ length: size }, (_, index) => ({ flow_id: "flow-" + index,
  node_id: "task-" + index, ...(["xor", "or"].includes(kind) ? { condition: "condition-" + index } : kind === "event" ? { event_key: "message-" + index } : {}) })) },
  Array.from({ length: size }, (_, index) => leaf("task-" + index))); }

await check("contracts: closed schemas, role vocabulary and safe JSON", () => {
  for (const name of ["agentic-process-model", "agentic-process-instance"]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.v1.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  assertAgenticProcessModel(example); assertAgenticProcessInstance(initial());
  assert.throws(() => assertAgenticProcessModel({ ...example, agents_per_role: 1 }), /PROCESS_MODEL_INVALID/);
  const malicious = { ...example }; Object.defineProperty(malicious, "nodes", { enumerable: true, get() { throw Error("getter executed"); } });
  assert.throws(() => assertAgenticProcessModel(malicious), /PROCESS_MODEL_INVALID/);
});
await check("participants, roles, skills and executors remain distinct", () => {
  const state = initial(example); assert.equal(inspect(state).ready.length, 1);
  assert.deepEqual(example.roles[0].skills, example.roles[2].skills);
  const second = completed(completed(state)); assert.equal(inspect(second).ready.length, 1);
  assert.equal(second.events.filter(row => row.kind === "assign").every(row => row.decision.execution_id === "execution-author"), true);
  assert.throws(() => assigned(second), /PROCESS_ASSIGNMENT_NOT_ADMISSIBLE/);
  assert.equal(inspect(assigned(second, inspect(second).ready[0], executor("reviewer"))).status, "RUNNING");
});
await check("G01/G02: XOR default, explicit incident and deterministic first matching flow", () => {
  const m = gateway("xor");
  assert.equal(inspect(initial(m, { "condition-0": false, "condition-1": false })).first_failure, "PROCESS_NO_BRANCH_SELECTED");
  assert.deepEqual(inspect(initial(m, { "condition-0": true, "condition-1": true })).ready, ["root/flow-0"]);
  m.nodes[0].branches[1].condition = null;
  assert.deepEqual(inspect(initial(m, { "condition-0": false })).ready, ["root/flow-1"]);
});
await check("G04/G05: AND requires each distinct flow; duplicate event cannot release join", () => {
  let state = initial(gateway("and")); assert.equal(inspect(state).ready.length, 2);
  state = assigned(state, "root/flow-0"); const frame = inspect(state).occurrences.find(row => row.occurrence_id === "root/flow-0");
  const resultEvent = event({ kind: "result", occurrence_id: frame.occurrence_id, result: resultFor(frame) });
  state = advanceAgenticProcess(state, resultEvent);
  assert.equal(inspect(state).status, "RUNNING"); assert.equal(advanceAgenticProcess(state, resultEvent), state);
  assert.throws(() => advanceAgenticProcess(state, { ...resultEvent, event_id: "another-event" }), /PROCESS_RESULT_ORDER_INVALID/);
  assert.equal(inspect(completed(state, "root/flow-1")).status, "COMPLETED");
});
await check("G06/G07: OR joins only selected flows, but waits for all selected work", () => {
  const one = initial(gateway("or", 3), { "condition-0": true, "condition-1": false, "condition-2": false });
  assert.equal(inspect(completed(one)).status, "COMPLETED");
  let two = initial(gateway("or", 3), { "condition-0": true, "condition-1": false, "condition-2": true });
  two = completed(two, "root/flow-0"); assert.equal(inspect(two).status, "RUNNING");
  assert.deepEqual(inspect(two).ready, ["root/flow-2"]);
});
await check("G08: unstructured shared OR child and cycles are explicitly refused", () => {
  const m = gateway("or"); m.nodes[0].branches[1].node_id = "task-0";
  assert.throws(() => initial(m), /PROCESS_NOT_STRUCTURED/);
  assert.throws(() => initial(model({ id: "cycle", kind: "call", participant_ref: "delivery", child: "cycle" })), /PROCESS_NOT_STRUCTURED/);
});
await check("G09/G10: correlated event winner survives serialization; losing signal and conflicting duplicate refuse", () => {
  let state = initial(gateway("event")); assert.deepEqual(inspect(state).waiting, ["root"]);
  const signal = event({ kind: "message", occurrence_id: "root", correlation_id: "fixture:root", event_key: "message-0" });
  assert.throws(() => advanceAgenticProcess(state, { ...signal, correlation_id: "foreign:root" }), /PROCESS_EVENT_CORRELATION_INVALID/);
  state = advanceAgenticProcess(state, signal); const retained = JSON.parse(JSON.stringify(state));
  assert.equal(advanceAgenticProcess(retained, signal), retained);
  assert.throws(() => advanceAgenticProcess(state, { ...signal, event_id: "late", event_key: "message-1" }), /PROCESS_EVENT_CORRELATION_INVALID/);
  assert.throws(() => advanceAgenticProcess(state, { ...signal, event_key: "message-1" }), /PROCESS_EVENT_ID_CONFLICT/);
});
await check("G11/G12/G13: unsupported instantiation, complex and mixed constructs remain explicit", () => {
  for (const kind of ["event_start_exclusive", "event_start_parallel", "complex", "mixed", "message_review"]) {
    const m = model({ id: "unsupported", kind, participant_ref: "delivery", specification: { required: true } });
    assertAgenticProcessModel(m, { executable: false });
    assert.throws(() => initial(m), /PROCESS_CONSTRUCT_UNSUPPORTED/);
    assert.equal(agenticProcessCapabilities().constructs.find(row => row.kind === kind).executable, false);
    assert.equal(agenticProcessCapabilities().constructs.find(row => row.kind === kind).tested, false);
  }
});
await check("G14: loop occurrences cannot consume a result from an earlier iteration", () => {
  let state = initial(model({ id: "loop", kind: "loop", participant_ref: "delivery", child: "task", until: "finished", max_iterations: 2 }, [leaf("task")]), { finished: false });
  state = completed(state); assert.deepEqual(inspect(state).ready, ["root/iteration-2"]);
  const oldResult = state.events.find(row => row.kind === "result");
  assert.throws(() => advanceAgenticProcess(state, { ...oldResult, event_id: "late-old-result" }), /PROCESS_RESULT_ORDER_INVALID/);
  state = advanceAgenticProcess(state, event({ kind: "facts", facts: { finished: true } }));
  assert.equal(inspect(completed(state)).status, "COMPLETED");
});
await check("G15/G16: multi-instance empty, sequential and failed parallel children retain honest outcomes", () => {
  const root = { id: "many", kind: "multi_instance", participant_ref: "delivery", child: "task", items: [], ordering: "parallel" };
  assert.equal(inspect(initial(model(root, [leaf("task")]))).status, "COMPLETED");
  root.items = ["one", "two"];
  const parallel = initial(model(root, [leaf("task")])); assert.equal(inspect(parallel).ready.length, 2);
  const failed = completed(parallel, "root/item-0", "failed"); assert.equal(inspect(failed).status, "FAILED");
  assert.equal(inspect(failed).occurrences.find(row => row.occurrence_id === "root/item-1").status, "CANCELLED");
  root.ordering = "sequential";
  const sequential = completed(initial(model(root, [leaf("task")]))); assert.deepEqual(inspect(sequential).ready, ["root/item-1"]);
});
await check("G17: event wait does not serialize unrelated ready work", () => {
  const waiting = gateway("event"); waiting.nodes[0].id = "wait";
  const m = model({ id: "outer", kind: "and", participant_ref: "delivery", branches: [{ flow_id: "wait", node_id: "wait" }, { flow_id: "work", node_id: "work" }] }, [...waiting.nodes, leaf("work")]);
  const state = completed(initial(m), "root/work"); assert.equal(inspect(state).status, "RUNNING"); assert.deepEqual(inspect(state).waiting, ["root/wait"]);
});
await check("G18: join does not merge contents or replace a reconciliation activity", () => {
  const split = gateway("and"); split.nodes[0].id = "split";
  const m = model({ id: "outer", kind: "sequence", participant_ref: "delivery", children: ["split", "reconcile"] }, [...split.nodes, leaf("reconcile")]);
  const state = completed(completed(initial(m), "root/0/flow-0"), "root/0/flow-1");
  assert.deepEqual(inspect(state).ready, ["root/1"]); assert.equal(inspect(state).occurrences.at(-1).result, null);
});
await check("R10: missing or altered required policy cannot be hidden by import/hash recomputation", () => {
  const m = model(), pins = agenticPolicyPins(m), changed = structuredClone(m); changed.policies[0].allowed_permissions.push("write:product");
  assert.throws(() => createAgenticProcess({ instanceId: "fixture", model: changed, policyPins: pins, scopeId: "scope-1" }), /PROCESS_REQUIRED_POLICY_CHANGED/);
  changed.policies = []; assert.throws(() => assertAgenticProcessModel(changed), /PROCESS_MODEL_INVALID/);
});
await check("R12: call procedure creates a scoped occurrence, never independent identity", () => {
  const state = assigned(initial(model({ id: "call", kind: "call", participant_ref: "delivery", child: "task" }, [leaf("task")])));
  assert.equal(inspect(state).occurrences.at(-1).assignment.decision.agent_id, "author");
  const cross = model({ id: "call", kind: "call", participant_ref: "delivery", child: "task" }, [{ ...leaf("task"), participant_ref: "assurance" }]);
  cross.participants.push({ id: "assurance" }); assert.throws(() => initial(cross), /PROCESS_CROSS_PARTICIPANT_SEQUENCE/);
});

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agentic-process-"));
const profile = buildAgentProfile({ id: "fixture-adapter", label: "Fixture", defaultRole: "coordinator", roles: AGENT_ROLES });
const adapter = { getProfile: () => profile, canHandleRole: ({ role, action }) => canAgentRolePerform(role, action) };
function composition(m = model(), { stateMode = "files", resultTimeoutMs = 1000 } = {}) {
  const targetRoot = fs.mkdtempSync(path.join(temp, "client-"));
  if (stateMode !== "files") {
    fs.mkdirSync(path.join(targetRoot, ".aidn"));
    fs.writeFileSync(path.join(targetRoot, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode } }));
    createArtifactStore({ sqliteFile: path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite") }).close();
  }
  const store = createAgenticProcessStore({ targetRoot, stateMode });
  const state = { resource: executor(), binding: { revision: "revision-1", artifact_sha256: H, criteria_sha256: H, allowed_context_sha256: [H], reviewed_contributors: [] }, proof: "verified", result: null, capabilities: true,
    authority: { scope_id: "scope-1", model_sha256: shadowHash(m), policy_pins: agenticPolicyPins(m) }, resultRead: null };
  const service = createAgenticProcessService({ store, adapters: [adapter], now: () => NOW, authorityTimeoutMs: resultTimeoutMs,
    readAuthority: () => structuredClone(state.authority),
    readBinding: () => structuredClone(state.binding),
    assignmentAuthority: { observe: ({ request }) => observation(request, structuredClone(state.resource)), verify: ({ request, observation: observed, requirements }) => ({
      outcome: "verified", authority_id: observed.authority_id, request_sha256: shadowHash(request), observation_sha256: shadowHash(observed),
      ...(requirements && state.capabilities ? { requirements_sha256: shadowHash(requirements) } : {}) }) },
    resultAuthority: { read: () => state.resultRead ? state.resultRead() : structuredClone(state.result), verify: ({ result, request }) => ({ outcome: state.proof, result_sha256: shadowHash(result), request_sha256: shadowHash(request), execution_id: result.execution_id, authority_id: "fixture-authority" }) } });
  return { service, store, state, targetRoot, initialize: (write = true) => service.initialize({ instanceId: "fixture", model: m, write }) };
}
try {
  await check("required skill snapshot cannot be weakened while authority observation is pending", async () => {
    const request = requestFor(initial(), "root"), requiredSkills = ["tests"];
    const result = await decideAgentReuse({ request, requiredSkills, adapters: [adapter], now: () => NOW,
      scope: { scope_id: request.scope_id }, recommendation: { role: request.role, action: request.action, mode: request.mode },
      authority: { observe: () => { requiredSkills.pop(); return observation(request); },
        verify: ({ request: r, observation: o }) => ({ outcome: "verified", authority_id: o.authority_id, request_sha256: shadowHash(r), observation_sha256: shadowHash(o) }) } });
    assert.equal(result.decision, "wait"); assert.equal(result.reason_code, "OBSERVATION_NOT_AUTHENTICATED");
  });
  await check("real service: preview is read-only, durable assignment precedes authenticated result acceptance", async () => {
    const c = composition(); assert.equal(c.initialize(false).written, false); assert.deepEqual(fs.readdirSync(c.targetRoot), []);
    const start = c.initialize();
    const assignment = await c.service.assign({ instanceId: "fixture", expectedSha256: start.record.instance_sha256, occurrenceId: "root", eventId: "assigned", write: true });
    assert.equal(assignment.decision.decision, "reuse"); c.state.result = resultFor(inspect(assignment.record).occurrences[0]);
    const accepted = await c.service.accept({ instanceId: "fixture", expectedSha256: assignment.record.instance_sha256, occurrenceId: "root", eventId: "accepted", resultId: c.state.result.result_id, write: true });
    assert.equal(accepted.cursor.status, "COMPLETED"); assert.equal(createAgenticProcessStore({ targetRoot: c.targetRoot, stateMode: "files" }).read("fixture").record.instance_sha256, accepted.record.instance_sha256);
    const repeated = await c.service.accept({ instanceId: "fixture", expectedSha256: accepted.record.instance_sha256, occurrenceId: "root", eventId: "accepted", resultId: c.state.result.result_id, write: true });
    assert.equal(repeated.written, false); assert.equal(repeated.record.revision, accepted.record.revision);
    assert.throws(() => c.store.compareAndSwap(assignment.record, assignment.content_sha256), /REVISION_CONFLICT/);
  });
  await check("R01/R02/R03/R04/R07: independent review checks identity, lineage, copied context and missing resource", async () => {
    const m = model({ ...leaf("review"), role_ref: "review", policy_ref: "review" }), c = composition(m);
    c.state.binding.reviewed_contributors = [{ agent_id: "author", lineage_id: "lineage-author" }];
    const start = c.initialize(); const invoke = () => c.service.assign({ instanceId: "fixture", expectedSha256: start.record.instance_sha256, occurrenceId: "root", eventId: "assigned" });
    assert.equal((await invoke()).decision.decision, "wait");
    c.state.resource = { ...executor("renamed"), lineage_id: "lineage-author" }; assert.equal((await invoke()).decision.decision, "wait");
    c.state.resource = { ...executor("reviewer"), context_sha256: [OTHER] }; assert.equal((await invoke()).decision.decision, "wait");
    c.state.resource = executor("reviewer"); assert.equal((await invoke()).decision.decision, "reuse");
    c.state.capabilities = false; assert.equal((await invoke()).decision.reason_code, "OBSERVATION_NOT_AUTHENTICATED");
  });
  await check("R05/R06/R11: corrected work, changed revision and unauthenticated verdict cannot be accepted", async () => {
    const m = model({ ...leaf("review"), role_ref: "review", policy_ref: "review" }), c = composition(m);
    c.state.resource = executor("reviewer"); c.state.binding.reviewed_contributors = [{ agent_id: "author", lineage_id: "lineage-author" }];
    const start = c.initialize();
    const assignment = await c.service.assign({ instanceId: "fixture", expectedSha256: start.record.instance_sha256, occurrenceId: "root", eventId: "assigned", write: true });
    c.state.result = resultFor(inspect(assignment.record).occurrences[0]);
    const accept = () => c.service.accept({ instanceId: "fixture", expectedSha256: assignment.record.instance_sha256, occurrenceId: "root", eventId: "accepted", resultId: c.state.result.result_id, write: true });
    c.state.proof = "untrusted"; await assert.rejects(accept, /PROCESS_RESULT_NOT_AUTHENTICATED/);
    c.state.proof = "verified"; c.state.binding.revision = "revision-2"; await assert.rejects(accept, /PROCESS_REVIEWED_REVISION_CHANGED/);
    c.state.binding.revision = "revision-1";
    c.state.resource.contributions.push({ scope_id: "scope-1", revision: "revision-2", activity_id: "fix", artifact_sha256: OTHER, role: "repair" });
    assert.equal((await accept()).status, "RESULT_NOT_ACCEPTED");
    assert.equal(c.store.read("fixture").record.events.length, 2);
    assert.equal(c.store.read("fixture").record.events[1].kind, "refusal");
  });
  await check("durable event race: two previews, one CAS winner, retained wait after restart", () => {
    const c = composition(gateway("event")), start = c.initialize();
    const signal = index => c.service.signal({ instanceId: "fixture", expectedSha256: start.record.instance_sha256,
      event: event({ kind: "message", occurrence_id: "root", correlation_id: "fixture:root", event_key: "message-" + index }) });
    const first = signal(0), second = signal(1), previous = c.store.read("fixture");
    c.store.compareAndSwap(first.record, previous.content_sha256);
    assert.throws(() => c.store.compareAndSwap(second.record, previous.content_sha256), /REVISION_CONFLICT/);
    assert.deepEqual(c.service.inspect("fixture").cursor.ready, ["root/flow-0"]);
  });
  await check("result acceptance cannot substitute agent, lineage or session behind an unchanged execution ID", async () => {
    for (const key of ["agent_id", "lineage_id", "session_id"]) {
      const c = composition(), start = c.initialize();
      const allocated = await c.service.assign({ instanceId: "fixture", expectedSha256: start.record.instance_sha256, occurrenceId: "root", eventId: "assigned", write: true });
      c.state.result = resultFor(inspect(allocated.record).occurrences[0]); c.state.resource[key] = "substituted";
      const refused = await c.service.accept({ instanceId: "fixture", expectedSha256: allocated.record.instance_sha256, occurrenceId: "root", eventId: "result", resultId: c.state.result.result_id, write: true });
      assert.equal(refused.decision.reason_code, "RESULT_EXECUTION_IDENTITY_CHANGED");
      assert.equal(refused.cursor.occurrences[0].result, null);
    }
  });
  for (const stateMode of ["dual", "db-only"]) await check("canonical database restart and projection rules: " + stateMode, () => {
    const c = composition(gateway("event"), { stateMode }), start = c.initialize();
    const visible = path.join(c.targetRoot, "docs/audit/workflows/process-instances/fixture.json");
    assert.equal(fs.existsSync(visible), stateMode === "dual");
    if (stateMode === "dual") fs.writeFileSync(visible, "stale non-authoritative projection");
    assert.equal(createAgenticProcessStore({ targetRoot: c.targetRoot, stateMode }).read("fixture").record.instance_sha256, start.record.instance_sha256);
    const previous = c.store.read("fixture");
    const next = advanceAgenticProcess(previous.record, event({ kind: "message", occurrence_id: "root", correlation_id: "fixture:root", event_key: "message-0" }));
    c.store.compareAndSwap(next, previous.content_sha256);
    assert.throws(() => c.store.compareAndSwap(next, previous.content_sha256), /REVISION_CONFLICT/);
  });
  await check("R08/R13: one participant permits distinct agents or interleaved reuse on parallel flows", async () => {
    for (const separate of [false, true]) {
      const c = composition(gateway("and")), start = c.initialize();
      const first = await c.service.assign({ instanceId: "fixture", expectedSha256: start.record.instance_sha256, occurrenceId: "root/flow-0", eventId: "assign-first", write: true });
      if (separate) c.state.resource = executor("other");
      const second = await c.service.assign({ instanceId: "fixture", expectedSha256: first.record.instance_sha256, occurrenceId: "root/flow-1", eventId: "assign-second", write: true });
      const assignments = second.record.events.filter(row => row.kind === "assign");
      assert.equal(new Set(assignments.map(row => row.decision.agent_id)).size, separate ? 2 : 1);
      assert.equal(second.cursor.occurrences.every(row => row.participant_ref === "delivery"), true);
    }
  });
  await check("missing authority fails closed, retained refusal is not a zero cost/assurance claim", async () => {
    const m = model(), c = composition(m), start = c.initialize();
    const unavailable = createAgenticProcessService({ store: c.store, adapters: [adapter], now: () => NOW,
      readAuthority: () => c.state.authority, readBinding: () => c.state.binding });
    const result = await unavailable.assign({ instanceId: "fixture", expectedSha256: start.record.instance_sha256, occurrenceId: "root", eventId: "refused", write: true });
    assert.equal(result.decision.reason_code, "ASSIGNMENT_AUTHORITY_UNAVAILABLE");
    assert.equal(result.record.events[0].kind, "refusal"); assert.equal(result.cursor.status, "READY");
    assert.equal(Object.hasOwn(result, "tokens"), false);
    c.state.authority.scope_id = "foreign-scope";
    assert.throws(() => c.service.signal({ instanceId: "fixture", expectedSha256: result.record.instance_sha256, event: event({ kind: "cancel" }), write: true }), /PROCESS_AUTHORITY_CHANGED/);
    assert.equal(c.store.read("fixture").record.instance_sha256, result.record.instance_sha256);
  });
  await check("result authority timeout and sensitive errors leave canonical state untouched", async () => {
    const c = composition(model(), { resultTimeoutMs: 5 }), start = c.initialize();
    const assignedState = await c.service.assign({ instanceId: "fixture", expectedSha256: start.record.instance_sha256, occurrenceId: "root", eventId: "assigned", write: true });
    const accept = () => c.service.accept({ instanceId: "fixture", expectedSha256: assignedState.record.instance_sha256, occurrenceId: "root", eventId: "result", resultId: "result-unknown", write: true });
    c.state.resultRead = () => new Promise(() => {}); await assert.rejects(accept, /PROCESS_RESULT_AUTHORITY_TIMEOUT/);
    c.state.resultRead = () => { throw Error("sensitive fixture text must not propagate"); };
    await assert.rejects(accept, error => error.message === "PROCESS_RESULT_AUTHORITY_UNAVAILABLE");
    assert.equal(c.store.read("fixture").record.instance_sha256, assignedState.record.instance_sha256);
  });
  await check("rejection and cancellation stay terminal; no automatic favorable replacement", async () => {
    const c = composition(), start = c.initialize();
    const assignedState = await c.service.assign({ instanceId: "fixture", expectedSha256: start.record.instance_sha256, occurrenceId: "root", eventId: "assigned", write: true });
    c.state.result = resultFor(inspect(assignedState.record).occurrences[0], "rejected");
    const rejected = await c.service.accept({ instanceId: "fixture", expectedSha256: assignedState.record.instance_sha256, occurrenceId: "root", eventId: "rejected", resultId: c.state.result.result_id, write: true });
    assert.equal(rejected.cursor.first_failure, "PROCESS_REVIEW_REJECTED");
    await assert.rejects(() => c.service.assign({ instanceId: "fixture", expectedSha256: rejected.record.instance_sha256, occurrenceId: "root", eventId: "retry", write: true }), /PROCESS_ASSIGNMENT_ORDER_INVALID/);
    const state = initial(gateway("and")), cancel = event({ kind: "cancel" }), stopped = advanceAgenticProcess(state, cancel);
    assert.equal(inspect(stopped).status, "CANCELLED");
    assert.throws(() => completed(stopped, "root/flow-0"), /PROCESS_EVENT_ORDER_INVALID/);
  });
} finally {
  const resolvedTemp = fs.realpathSync(temp), tempParent = fs.realpathSync(os.tmpdir());
  assert.equal(resolvedTemp.startsWith(tempParent + path.sep) && path.basename(resolvedTemp).startsWith("aidn-agentic-process-"), true);
  fs.rmSync(resolvedTemp, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: "PASS", checks: cases.length, native_execution: "NOT_RUN", message_review: "UNSUPPORTED", arbitrary_bpmn: "UNSUPPORTED" }));
