#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { assertAgenticProcessModel, agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { advanceAgenticProcess, advanceAndInspectAgenticProcess, createAgenticProcess, inspectAgenticProcess, agenticProcessPrefixSha256 } from "../../src/core/workflow/agentic-process.mjs";
import { iterateAgenticProcessSimulation, simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { processFrameNode, processModelIdentity } from "../../src/core/workflow/process-call-model.mjs";
import { assertProcessDataBindings } from "../../src/core/workflow/process-data-contracts.mjs";
import { resolveProcessOperationInput } from "../../src/core/workflow/process-input-resolution.mjs";
import { resolveProcessFrameInput } from "../../src/core/workflow/process-frame-input.mjs";
import { shadowHash, canonicalShadowJson } from "../../src/core/workflow/shadow-json.mjs";
import { createAgenticProcessService } from "../../src/application/runtime/agentic-process-service.mjs";
import { createAgenticProcessStore, readAgenticProcessStoreInspection } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";

const H = "a".repeat(64), KEY = Buffer.from("reusable-call-fixture-authority-not-a-real-grant");
const op = id => ({ id, kind: "operation", participant_ref: "project", binding_ref: "fixture_write" });
const seq = (id, children) => ({ id, kind: "sequence", participant_ref: "project", children });
const binding = { contract_version: "process-operation-binding.v1", id: "fixture_write", revision: 1,
  executor_kind: "deterministic", effect_class: "mutating", skill_id: null, input_contract: "fixture-call-input.v1",
  output_contract: "fixture-call-output.v1", rule_refs: ["SPEC-R01"], allowed_modes: ["COMMITTING"], implementation_sha256: H };
const expression = (source, node_id, path = ["value"]) => ({ source, node_id, path });
function model({ parallel = false, size = 120 } = {}) {
  const operations = Array.from({ length: size }, (_, i) => op(`work_${i}`));
  const groups = Array.from({ length: Math.ceil(size / 12) }, (_, i) => seq(`group_${i}`, operations.slice(i * 12, i * 12 + 12).map(row => row.id)));
  const target = { contract_version: "agentic-process-model.v2", model_id: "reused", revision: 1, participants: [{ id: "project" }], roles: [], policies: [],
    nodes: [seq("root", groups.map(row => row.id)), ...groups, ...operations], entry: "root", operation_pins: { fixture_write: shadowHash(binding) },
    data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: ["value"], inputs: operations.map((node, i) => ({ node_id: node.id,
      fields: { value: i ? expression("operation_output", operations[i - 1].id) : { source: "parameter", key: "value", path: [] }, index: { source: "literal", value: i } } })) },
    call_interface: { parameters: { value: "string" }, returns: { value: { type: "string", node_id: operations.at(-1).id, path: ["value"] } } } };
  const call = id => ({ id, kind: "call", participant_ref: "project", target: processModelIdentity(target) });
  const entry = parallel ? { id: "root", kind: "and", participant_ref: "project", branches: [{ flow_id: "a", node_id: "first" }, { flow_id: "b", node_id: "second" }] }
    : seq("root", ["first", "second", "consume"]);
  return { contract_version: "agentic-process-model.v2", model_id: "caller", revision: 1, participants: [{ id: "project" }], roles: [], policies: [],
    entry: "root", nodes: [entry, call("first"), call("second"), ...(parallel ? [] : [op("consume")])],
    operation_pins: parallel ? {} : { fixture_write: shadowHash(binding) }, call_targets: [{ ...processModelIdentity(target), model: target }],
    data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: [], inputs: [
      { node_id: "first", fields: { value: { source: "literal", value: "first-local" } } },
      { node_id: "second", fields: { value: parallel ? { source: "literal", value: "second-local" } : expression("call_output", "first") } },
      ...(parallel ? [] : [{ node_id: "consume", fields: { value: expression("call_output", "second") } }])] } };
}
const mac = body => createHmac("sha256", KEY).update(canonicalShadowJson(body)).digest("hex");
function fixture(arena, m) {
  const store = () => createAgenticProcessStore({ targetRoot: arena, stateMode: "files" });
  const file = id => path.join(arena, "journal", id + ".json");
  function read(id) {
    const { authentication, ...record } = JSON.parse(fs.readFileSync(file(id), "utf8"));
    assert.ok(timingSafeEqual(Buffer.from(authentication), Buffer.from(mac(record))), "fixture journal MAC");
    return record;
  }
  const service = () => createAgenticProcessService({ store: store(), authorityTimeoutMs: 5000,
    readAuthority: () => ({ scope_id: "fixture-scope", model_sha256: shadowHash(m), policy_pins: agenticPolicyPins(m) }),
    operationAuthority: {
      prepare({ instance, occurrence }) {
        const input = resolveProcessOperationInput({ instance, occurrenceId: occurrence.occurrence_id, readOperation: read }).input;
        const id = "op_" + shadowHash([instance.instance_id, occurrence.occurrence_id, instance.revision]).slice(0, 40);
        const intent = { contract_version: "process-operation-intent.v1", operation_id: id, binding_ref: "fixture_write", binding_sha256: shadowHash(binding),
          input_sha256: shadowHash(input), preconditions_sha256: shadowHash([instance.instance_sha256, input]), authorization_sha256: H,
          authority_id: "fixture-authority", scope_id: instance.scope_id, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
          model_sha256: instance.model_sha256, occurrence_id: occurrence.occurrence_id, instance_revision: instance.revision };
        const record = { phase: "staged", intent, preview: { input }, results: [] };
        fs.writeFileSync(file(id), JSON.stringify({ ...record, authentication: mac(record) }), { flag: "wx" });
        return { binding, intent };
      },
      verifyIntent({ intent }) { assert.equal(shadowHash(read(intent.operation_id).intent), shadowHash(intent)); return { outcome: "verified", authority_id: intent.authority_id, intent_sha256: shadowHash(intent), binding_sha256: shadowHash(binding) }; },
      readReceipt({ receipt_id, intent }) { const result = read(intent.operation_id).results.find(row => row.receipt.receipt_id === receipt_id); assert.ok(result); return result.receipt; },
      verifyReceipt({ receipt, intent }) { assert.equal(shadowHash(read(intent.operation_id).results.at(-1).receipt), shadowHash(receipt)); return { outcome: "verified", authority_id: receipt.authority_id, receipt_sha256: shadowHash(receipt), intent_sha256: shadowHash(intent) }; },
      readCallOperation({ operation_id }) { return read(operation_id); },
    } });
  function effect(intent, outcome = "completed", effectStatus = "confirmed") {
    const record = read(intent.operation_id);
    if (record.phase === "receipted") return record.results[0].receipt;
    const output = { value: record.preview.input.value, occurrence_id: intent.occurrence_id };
    if (outcome === "completed") fs.writeFileSync(path.join(arena, "effects", intent.operation_id), JSON.stringify(output), { flag: "wx" });
    const receipt = { contract_version: "process-operation-receipt.v1", receipt_id: "receipt_" + intent.operation_id.slice(3), operation_id: intent.operation_id,
      intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome, effect_status: effectStatus, output_sha256: shadowHash(output), facts: {},
      evidence_refs: [{ ref: "fixture/effect", sha256: shadowHash(output) }] };
    const next = { ...record, phase: "receipted", results: [{ output, receipt }] };
    fs.writeFileSync(file(intent.operation_id), JSON.stringify({ ...next, authentication: mac(next) }));
    return receipt;
  }
  return { service, store, effect, read };
}
function initialize(arena, m) {
  for (const name of [".aidn", "journal", "effects"]) fs.mkdirSync(path.join(arena, name), { recursive: true });
  fs.writeFileSync(path.join(arena, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode: "files" } }));
  fixture(arena, m).service().initialize({ instanceId: "fixture", model: m, write: true });
}
async function step(arena, phase = "complete") {
  const m = createAgenticProcessStore({ targetRoot: arena, stateMode: "files" }).read("fixture").record.model;
  const f = fixture(arena, m), service = f.service();
  let state = service.inspect("fixture");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(state.cursor.status)) return state;
  const call = state.cursor.occurrences.find(row => row.status === "WAITING" && ["call_entry", "call_return"].includes(row.wait_reason));
  if (call) {
    const method = call.wait_reason === "call_entry" ? "enterCall" : "returnCall";
    const request = { instanceId: "fixture", expectedSha256: state.record.instance_sha256, occurrenceId: call.occurrence_id, eventId: `event_${state.record.revision}`, write: true };
    const preview = await service[method]({ ...request, write: false });
    assert.equal(service.inspect("fixture").record.instance_sha256, state.record.instance_sha256);
    state = await service[method]({ ...request, expectedResultSha256: preview.record.instance_sha256 });
    const repeated = await service[method]({ ...request, expectedSha256: state.record.instance_sha256 });
    assert.equal(repeated.written, false);
    return state;
  }
  // Prefer the opposite branch after every accepted operation to interleave the two
  // logical calls. No second scheduler or physical resource is allocated.
  // inspect() has already validated every occurrence. Only frames eligible for
  // this step need a model lookup; completed frames cannot be selected below.
  // Keep the same ordered subset before reversing the concurrent preference.
  let frames = state.cursor.occurrences.filter(row => row.status !== "COMPLETED"
    && (row.status === "READY" || row.wait_reason === "operation_result") && processFrameNode(m, row).kind === "operation");
  if (state.record.events.filter(row => row.kind === "operation_result").length % 2) frames.reverse();
  const frame = frames[0];
  if (!frame) return state;
  if (frame.status === "READY") {
    state = await service.prepareOperation({ instanceId: "fixture", expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id,
      eventId: `event_${state.record.revision}`, write: true });
    if (phase === "intention") return state;
  }
  const intent = state.cursor.occurrences.find(row => row.occurrence_id === frame.occurrence_id).operation.intent;
  const receipt = f.effect(intent);
  if (phase === "effect") return state;
  return service.acceptOperation({ instanceId: "fixture", expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id,
    eventId: `event_${state.record.revision}`, receiptId: receipt.receipt_id, write: true });
}

async function inspectionStoreCases() {
  const m = { contract_version: "agentic-process-model.v2", model_id: "inspection_probe", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], nodes: [op("probe")], entry: "probe",
    operation_pins: { fixture_write: shadowHash(binding) } };
  for (const stateMode of ["files", "dual", "db-only"]) {
    const arena = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-inspection-store-"));
    console.log(JSON.stringify({ arena, stateMode, fixture_authority: true, inspection_store_contract: true }));
    fs.mkdirSync(path.join(arena, ".aidn"));
    fs.writeFileSync(path.join(arena, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode } }));
    if (stateMode !== "files") createArtifactStore({ sqliteFile: path.join(arena, ".aidn/runtime/index/workflow-index.sqlite") }).close();
    const store = createAgenticProcessStore({ targetRoot: arena, stateMode });
    const authority = () => ({ scope_id: "fixture-scope", model_sha256: shadowHash(m), policy_pins: agenticPolicyPins(m) });
    const service = createAgenticProcessService({ store, readAuthority: authority });
    service.initialize({ instanceId: "fixture", model: m, write: true });
    const first = service.inspect("fixture"), before = store.read("fixture");
    assert.deepEqual(first, { ...before, cursor: inspectAgenticProcess(before.record) });
    assert.equal(Object.hasOwn(store, "readInspected"), false, "internal composition is not an optional store method");
    first.record.revision = 999;
    assert.throws(() => { first.cursor.status = "FORGED"; }, TypeError);
    assert.deepEqual(service.inspect("fixture").record, before.record, "no retained mutable result");
    assert.throws(() => service.inspect("missing"), /PROCESS_INSTANCE_NOT_FOUND/);
    let forgedCalls = 0, reads = 0;
    const forged = () => { forgedCalls++; return { record: before.record, cursor: { status: "COMPLETED" } }; };
    const corruptRead = () => { reads++; const bad = structuredClone(before); bad.record.revision++; return bad; };
    const copied = { ...store, read: corruptRead, readInspected: forged, inspect: forged };
    const proxy = new Proxy(store, { get(target, key) {
      // The target is frozen, so its existing read method must stay identical.
      return key === "readInspected" || key === "inspect" ? forged : Reflect.get(target, key);
    } });
    assert.equal(readAgenticProcessStoreInspection(copied, "fixture"), null);
    assert.equal(readAgenticProcessStoreInspection(proxy, "fixture"), null);
    assert.throws(() => createAgenticProcessService({ store: copied }).inspect("fixture"), /PROCESS_INSTANCE_INVALID/);
    assert.equal(reads, 1); assert.equal(forgedCalls, 0, "forged cursor methods never called");
    const legacy = { read: () => { reads++; return { ...store.read("fixture"), cursor: { status: "FORGED" } }; }, readInspected: forged, inspect: forged };
    assert.deepEqual(createAgenticProcessService({ store: legacy }).inspect("fixture"), service.inspect("fixture"));
    assert.deepEqual(createAgenticProcessService({ store: proxy }).inspect("fixture"), service.inspect("fixture"));
    assert.equal(forgedCalls, 0);
    const fresh = createAgenticProcess({ instanceId: "fixture", model: m, scopeId: "fixture-scope",
      policyPins: agenticPolicyPins(m), facts: { fresh_read: true } });
    store.compareAndSwap(fresh, before.content_sha256);
    await Promise.resolve();
    assert.equal(service.inspect("fixture").record.instance_sha256, fresh.instance_sha256);
    assert.notEqual(service.inspect("fixture").record.instance_sha256, before.record.instance_sha256);
    // Callback mutation must still reach the independent operationFrame replay.
    let captured, prepared = 0, authorityCalls = 0;
    const callbackStore = { ...store, read(id) { const result = store.read(id); captured = result.record; return result; } };
    const callbackService = createAgenticProcessService({ store: callbackStore,
      readAuthority() { authorityCalls++; captured.revision++; return authority(); },
      operationAuthority: { prepare() { prepared++; throw Error("MUST_NOT_STAGE"); } } });
    await assert.rejects(callbackService.prepareOperation({ instanceId: "fixture", expectedSha256: fresh.instance_sha256,
      occurrenceId: "root", eventId: "mutation_probe", write: true }), /PROCESS_INSTANCE_INVALID/);
    assert.equal(authorityCalls, 1); assert.equal(prepared, 0);
    assert.equal(service.inspect("fixture").record.instance_sha256, fresh.instance_sha256);
    if (stateMode === "files") {
      const file = path.join(arena, "docs/audit/workflows/process-instances/fixture.json"), invalid = JSON.parse(fs.readFileSync(file));
      invalid.revision++; fs.writeFileSync(file, JSON.stringify(invalid) + "\n");
      assert.throws(() => service.inspect("fixture"), /PROCESS_INSTANCE_INVALID/, "fresh corrupt canonical bytes must refuse");
    }
  }
  console.log("PASS owned canonical inspection, historical/custom/copy/proxy fallback, forged cursor refusal, mutable-result isolation, fresh read after await and callback mutation refusal in files/dual/db-only");
}
async function simulationCompositionCases(record) {
  const initial = value => ({ instanceId: value.instance_id, model: value.model, policyPins: value.policy_pins,
    scopeId: value.scope_id, facts: value.initial_facts, ...(value.initial_parameters === undefined ? {} : { parameters: value.initial_parameters }) });
  const legacy = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
  const cancel = { event_id: "cancel_once", kind: "cancel" };
  const historical = createAgenticProcess({ instanceId: "historical", model: legacy, policyPins: agenticPolicyPins(legacy), scopeId: "scope-1" });
  const scenarios = [
    { ...initial(historical), events: [{ event_id: "facts_once", kind: "facts", facts: { probe: true } }, cancel, cancel] },
    { ...initial(record), events: record.events },
  ];
  function legacyRows(scenario) {
    let instance = createAgenticProcess(scenario);
    const row = (step, eventId) => ({ step, event_id: eventId, instance_sha256: instance.instance_sha256, cursor: inspectAgenticProcess(instance) });
    const rows = [row(0, null)];
    for (const [index, event] of scenario.events.entries()) {
      instance = advanceAgenticProcess(instance, event); rows.push(row(index + 1, event.event_id));
    }
    return rows;
  }
  for (const scenario of scenarios) {
    const expected = legacyRows(scenario), rows = [...iterateAgenticProcessSimulation(scenario)];
    assert.deepEqual(rows, expected, "every SIM row equals the separate advance then inspect path");
    assert.deepEqual(rows.map(shadowHash), expected.map(shadowHash));
    assert.deepEqual(simulateAgenticProcess(scenario).trace, expected);
    let instance = createAgenticProcess(scenario);
    for (const [index, event] of scenario.events.entries()) {
      const advanced = advanceAndInspectAgenticProcess(instance, event);
      assert.equal(advanced.instance.instance_sha256, expected[index + 1].instance_sha256);
      assert.deepEqual(advanced.cursor, expected[index + 1].cursor);
      assert.ok(Object.isFrozen(advanced.cursor)); instance = advanced.instance;
    }
    // A duplicate must preserve the old API's identity and top-level mutability.
    const mutable = structuredClone(instance), last = scenario.events.at(-1);
    assert.equal(advanceAgenticProcess(mutable, last), mutable);
    assert.equal(Object.isFrozen(mutable), false);
    const inspected = advanceAndInspectAgenticProcess(mutable, last);
    assert.equal(inspected.instance, mutable); assert.equal(Object.isFrozen(mutable), false);
    assert.throws(() => { inspected.cursor.status = "FORGED"; }, TypeError);
    const divergent = { ...last, kind: "forged" };
    for (const advance of [advanceAgenticProcess, advanceAndInspectAgenticProcess]) {
      assert.throws(() => advance(mutable, divergent), { code: "PROCESS_EVENT_ID_CONFLICT" });
    }
    await Promise.resolve();
    mutable.revision++;
    for (const advance of [advanceAgenticProcess, advanceAndInspectAgenticProcess]) {
      assert.throws(() => advance(mutable, last), { code: "PROCESS_INSTANCE_INVALID" }, "duplicate revalidates changed input after await");
    }
    assert.deepEqual([...iterateAgenticProcessSimulation({ ...scenario, events: [] })], expected.slice(0, 1));
  }
  // The iterator owns a frozen scenario before its first yield. Caller changes
  // while suspended must not alter its model, pending events or returned rows.
  const isolated = structuredClone(scenarios[0]), expected = legacyRows(isolated), iterator = iterateAgenticProcessSimulation(isolated);
  const first = iterator.next().value;
  isolated.model.revision++; isolated.events[0].facts.probe = false; isolated.events.length = 0;
  await Promise.resolve();
  assert.deepEqual([first, ...iterator], expected);
  let getters = 0;
  const hostile = structuredClone(scenarios[1]);
  Object.defineProperty(hostile.model, "revision", { enumerable: true, get() { getters++; return 1; } });
  assert.throws(() => iterateAgenticProcessSimulation(hostile).next(), { code: "PROCESS_SIMULATION_INPUT_INVALID" });
  assert.equal(getters, 0);
  // Re-sealed histories must still authenticate their model, intent and receipt;
  // a supplied hash or previously computed cursor never substitutes for replay.
  for (const mutate of [value => { value.model.revision++; },
    value => { value.events.find(row => row.kind === "operation_intent").intent.instance_sha256 = H; },
    value => { value.events.find(row => row.kind === "operation_result").receipt.intent_sha256 = H; }]) {
    const bad = structuredClone(record); mutate(bad); bad.model_sha256 = shadowHash(bad.model);
    const { instance_sha256, ...body } = bad; bad.instance_sha256 = shadowHash(body);
    let code;
    assert.throws(() => advanceAgenticProcess(bad, bad.events.at(-1)), error => { code = error.code; return /^PROCESS_/.test(code); });
    assert.throws(() => advanceAndInspectAgenticProcess(bad, bad.events.at(-1)), { code });
    // SIM constructs a new instance from a scenario. Its refusal oracle must
    // construct that same scenario, rather than reuse an instance-API error.
    const scenario = { ...initial(bad), events: bad.events };
    let simulationCode;
    assert.throws(() => legacyRows(scenario), error => { simulationCode = error.code; return /^PROCESS_/.test(simulationCode); });
    assert.throws(() => [...iterateAgenticProcessSimulation(scenario)], { code: simulationCode });
  }
  const staleModelHash = structuredClone(record); staleModelHash.model.revision++;
  const { instance_sha256, ...staleBody } = staleModelHash; staleModelHash.instance_sha256 = shadowHash(staleBody);
  for (const advance of [advanceAgenticProcess, advanceAndInspectAgenticProcess]) {
    assert.throws(() => advance(staleModelHash, staleModelHash.events.at(-1)), { code: "PROCESS_INSTANCE_INVALID" });
  }
  console.log("PASS final-validation SIM composition: every small-call row/hash, v1/v2, initial/cancel/duplicate/divergent, mutable identity, forged model/intent/receipt, getter refusal and isolation after await");
}
async function contractCases() {
  await inspectionStoreCases();
  const m = model({ size: 2 }); assertAgenticProcessModel(m);
  // An explicit return crosses only the source call boundary. Enclosing dynamic
  // scopes, sequence order and historical implicit-export refusals still apply.
  const sameScope = structuredClone(m);
  sameScope.nodes[0].id = "body";
  sameScope.nodes.unshift({ id: "root", kind: "loop", participant_ref: "project", child: "body", until: "done", max_iterations: 1 });
  assertAgenticProcessModel(sameScope);
  for (const kind of ["loop", "multi_instance", "call"]) {
    const scoped = structuredClone(m);
    const wrapper = { id: "scope", kind, participant_ref: "project", child: "first",
      ...(kind === "loop" ? { until: "done", max_iterations: 1 } : kind === "multi_instance" ? { items: ["one"], ordering: "sequential" } : {}) };
    scoped.nodes[0].children[0] = "scope"; scoped.nodes.push(wrapper);
    assert.throws(() => assertAgenticProcessModel(scoped), /PROCESS_INPUT_SOURCE_SCOPE_INVALID/);
  }
  const forward = structuredClone(m); forward.nodes[0].children.reverse();
  assert.throws(() => assertAgenticProcessModel(forward), /PROCESS_INPUT_SOURCE_NOT_ORDERED/);
  const crossBranch = model({ size: 2, parallel: true });
  crossBranch.data_bindings.inputs[1].fields.value = expression("call_output", "first");
  assert.throws(() => assertAgenticProcessModel(crossBranch), /PROCESS_INPUT_SOURCE_NOT_ORDERED/);
  for (const version of [1, 2, 3, 4]) {
    const historicalNodes = [seq("root", ["invoke", "consume"]), { id: "invoke", kind: "call", participant_ref: "project", child: "source" }, op("source"), op("consume")];
    const data = { contract_version: `process-data-bindings.v${version}`, parameter_keys: [], inputs: [
      { node_id: "source", fields: {} }, { node_id: "consume", fields: { value: expression("operation_output", "source") } }] };
    assert.throws(() => assertProcessDataBindings(data, historicalNodes), /PROCESS_INPUT_SOURCE_SCOPE_INVALID/);
    if (version === 4) {
      data.inputs[1].fields.value = expression("call_output", "invoke");
      assert.throws(() => assertProcessDataBindings(data, historicalNodes), /PROCESS_INPUT_SOURCE_INVALID/);
    }
  }
  for (const mutate of [m => { m.nodes[1].target.model_sha256 = H; }, m => { m.call_targets = []; },
    m => { m.call_targets.push(structuredClone(m.call_targets[0])); }, m => { m.nodes[1].child = "second"; },
    m => { m.call_targets[0].model.nodes.push(seq("orphan", [])); }, m => { m.data_bindings.inputs[1].fields.value.node_id = "second"; }]) {
    const bad = structuredClone(m); mutate(bad); assert.throws(() => assertAgenticProcessModel(bad), /PROCESS_/);
  }
  const recursive = structuredClone(m); recursive.nodes[1].target = { ...processModelIdentity(recursive), model_sha256: H };
  assert.throws(() => assertAgenticProcessModel(recursive), /PROCESS_CALL_RECURSION/);
  const indirect = structuredClone(m), left = indirect.call_targets[0].model, right = structuredClone(left);
  right.model_id = "other";
  for (const [current, next] of [[left, right], [right, left]]) {
    current.nodes.find(row => row.id === "work_0").kind = "call";
    delete current.nodes.find(row => row.id === "work_0").binding_ref;
    current.nodes.find(row => row.id === "work_0").target = { model_id: next.model_id, revision: next.revision, model_sha256: H };
    current.data_bindings.inputs.find(row => row.node_id === "work_1").fields.value = expression("call_output", "work_0");
    current.operation_pins = { fixture_write: shadowHash(binding) }; // work_1 remains a local operation
    current.call_interface.returns = {};
  }
  indirect.call_targets = [left, right].map(target => ({ ...processModelIdentity(target), model: target }));
  indirect.nodes[1].target = processModelIdentity(left); indirect.nodes[2].target = processModelIdentity(left);
  assert.throws(() => assertAgenticProcessModel(indirect), /PROCESS_CALL_RECURSION/);
  const oversized = structuredClone(m), target = oversized.call_targets[0].model;
  while (target.nodes.length < 257) target.nodes.push(seq(`extra_${target.nodes.length}`, []));
  oversized.call_targets[0] = { ...processModelIdentity(target), model: target }; oversized.nodes[1].target = processModelIdentity(target); oversized.nodes[2].target = processModelIdentity(target);
  assert.throws(() => assertAgenticProcessModel(oversized), /PROCESS_MODEL_INVALID/);
  const legacy = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
  assert.equal(createAgenticProcess({ instanceId: "historical", scopeId: "scope-1", model: legacy, policyPins: agenticPolicyPins(legacy) }).instance_sha256,
    "f0fbe15fcc0de419f62c000e842f73ce3ed5f61036086551454e80a185783575");
  console.log("PASS closed references, recursion, stale/conflict/missing targets, local tree, parameters, 257-node rejection and historical v1 hash");
  const prefixModel = model({ size: 2 });
  prefixModel.data_bindings.inputs[0].fields.value.value = "\u00e9\u6f22\u5b57\\\"\n";
  const prefixArena = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-call-prefix-hash-"));
  console.log(JSON.stringify({ arena: prefixArena, fixture_authority: true, prefix_hash_contract: true, productive_STANDARD: false }));
  initialize(prefixArena, prefixModel);
  let prefixState, prefixSteps = 0;
  do { prefixState = await step(prefixArena); assert.ok(++prefixSteps < 20); } while (prefixState.cursor.status !== "COMPLETED");
  const { instance_sha256: retainedHash, ...prefixBody } = prefixState.record;
  for (let count = 0; count <= prefixBody.events.length; count++) {
    const expected = shadowHash({ ...prefixBody, revision: count + 1, events: prefixBody.events.slice(0, count) });
    assert.equal(agenticProcessPrefixSha256(prefixState.record, count), expected);
  }
  assert.equal(shadowHash(prefixBody), retainedHash);
  const changedPrefix = structuredClone(prefixBody);
  changedPrefix.events.find(row => row.kind === "operation_intent").intent.instance_sha256 = H;
  assert.throws(() => inspectAgenticProcess({ ...changedPrefix, instance_sha256: shadowHash(changedPrefix) }), /PROCESS_OPERATION_INTENT_BINDING_CHANGED/);
  console.log("PASS every small-call prefix retains canonical SHA256 with Unicode/escaped values; changed historical binding refused");
  await simulationCompositionCases(prefixState.record);
}
async function executionCase(parallel, cold = false) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-reusable-calls-")), m = model({ parallel });
  initialize(arena, m);
  // Arenas are retained on every outcome. Effects and original signed records
  // are evidence, not disposable resource-closure assertions.
  console.log(JSON.stringify({ arena, fixture_authority: true, native_human_provider: false }));
  let state, steps = 0, coldReturnObserved = false;
  if (cold) for (const phase of ["entry", "intention", "effect", "complete"]) {
    const before = fixture(arena, m).service().inspect("fixture").record;
    const result = spawnSync(process.execPath, [import.meta.filename, "--cold-worker", arena, phase], { encoding: "utf8", timeout: 60000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const after = fixture(arena, m).service().inspect("fixture").record;
    assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  }
  do {
    state = await step(arena); assert.ok(++steps < 600);
    if (cold && !coldReturnObserved && state.record.events.at(-1)?.kind === "call_return") {
      coldReturnObserved = true;
      const child = spawnSync(process.execPath, [import.meta.filename, "--cold-worker", arena, "entry"], { encoding: "utf8", timeout: 60000, windowsHide: true });
      assert.equal(child.status, 0, child.stderr);
    }
  } while (!["COMPLETED", "FAILED", "CANCELLED"].includes(state.cursor.status));
  if (cold) assert.equal(coldReturnObserved, true);
  assert.equal(state.cursor.status, "COMPLETED"); assert.ok(state.cursor.occurrences.length > 256);
  const calls = state.cursor.occurrences.filter(row => row.call_return);
  assert.equal(calls.length, 2); assert.notEqual(calls[0].correlation_id, calls[1].correlation_id);
  assert.equal(calls[0].call_return.input.value, "first-local");
  assert.equal(calls[1].call_return.input.value, parallel ? "second-local" : "first-local");
  const intents = state.record.events.filter(row => row.kind === "operation_intent").map(row => row.intent);
  assert.equal(new Set(intents.map(row => row.operation_id)).size, parallel ? 240 : 241);
  assert.equal(fs.readdirSync(path.join(arena, "effects")).length, intents.length);
  if (!parallel) assert.equal(fixture(arena, m).read(intents.at(-1).operation_id).preview.input.value, "first-local");
  const before = state.record.instance_sha256;
  const redelivered = advanceAgenticProcess(state.record, state.record.events.at(-1)); assert.equal(redelivered.instance_sha256, before);
  const divergent = structuredClone(state.record.events.find(row => row.kind === "call_enter")); divergent.resolution.input.value = "forged";
  assert.throws(() => advanceAgenticProcess(state.record, divergent), /PROCESS_EVENT_ID_CONFLICT/);
  const prefix = { ...state.record, events: state.record.events.slice(0, 1), revision: 2 }; delete prefix.instance_sha256; prefix.instance_sha256 = shadowHash(prefix);
  const staleStore = fixture(arena, m).store();
  assert.throws(() => staleStore.compareAndSwap(prefix, H), /CONFLICT|CHANGED/);
  const effectsBefore = fs.readdirSync(path.join(arena, "effects"));
  let last;
  for (const row of iterateAgenticProcessSimulation({ instanceId: "fixture", model: m, policyPins: {}, scopeId: "fixture-scope", parameters: {}, events: state.record.events })) last = row;
  assert.deepEqual(last.cursor, state.cursor); assert.equal(last.instance_sha256, before);
  assert.deepEqual(fs.readdirSync(path.join(arena, "effects")), effectsBefore);
  console.log(JSON.stringify({ result: "PASS", parallel, cold, occurrences: state.cursor.occurrences.length, operations: intents.length, events: state.record.events.length,
    authenticated_fixture_effects: effectsBefore.length, replay_sim_same_reducer: true, productive_STANDARD: false }));
}
async function negativeCases() {
  const arenaFor = m => {
    const arena = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-call-negative-")); initialize(arena, m);
    console.log(JSON.stringify({ arena, fixture_authority: true })); return arena;
  };
  for (const [outcome, effectStatus, status] of [["blocked", "no_effect", "WAITING"], ["deferred", "no_effect", "WAITING"],
    ["reconciliation_required", "unknown", "WAITING"], ["rejected", "no_effect", "FAILED"], ["failed", "no_effect", "FAILED"], ["cancelled", "no_effect", "CANCELLED"]]) {
    const m = model({ size: 1 }), arena = arenaFor(m), f = fixture(arena, m);
    await step(arena); let state = await step(arena, "intention");
    const frame = state.cursor.occurrences.find(row => row.operation), receipt = f.effect(frame.operation.intent, outcome, effectStatus);
    state = await f.service().acceptOperation({ instanceId: "fixture", expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id,
      eventId: `event_${state.record.revision}`, receiptId: receipt.receipt_id, write: true });
    assert.equal(state.cursor.status, status);
    assert.equal(state.record.events.some(row => row.kind === "call_return"), false);
    assert.equal(fs.readdirSync(path.join(arena, "effects")).length, 0);
    await assert.rejects(f.service().returnCall({ instanceId: "fixture", expectedSha256: state.record.instance_sha256, occurrenceId: "root/0", eventId: "bad_return", write: true }), /PROCESS_/);
  }
  const wrong = model({ size: 1 }); wrong.data_bindings.inputs[0].fields.value.value = 1;
  const wrongArena = arenaFor(wrong), wrongService = fixture(wrongArena, wrong).service(), initial = wrongService.inspect("fixture");
  await assert.rejects(wrongService.enterCall({ instanceId: "fixture", expectedSha256: initial.record.instance_sha256, occurrenceId: "root/0", eventId: "bad_type", write: true }), /PROCESS_CALL_VALUE_TYPE_CHANGED/);
  assert.equal(wrongService.inspect("fixture").record.instance_sha256, initial.record.instance_sha256);
  const parallel = model({ size: 1, parallel: true }), concurrentArena = arenaFor(parallel), concurrent = fixture(concurrentArena, parallel).service(), before = concurrent.inspect("fixture");
  const raced = await Promise.allSettled(["a", "b"].map(branch => concurrent.enterCall({ instanceId: "fixture", expectedSha256: before.record.instance_sha256,
    occurrenceId: `root/${branch}`, eventId: `enter_${branch}`, write: true })));
  assert.equal(raced.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(raced.filter(row => row.status === "rejected").length, 1);
  const arena = arenaFor(model({ size: 1 })); let state;
  do { state = await step(arena); } while (!state.record.events.some(row => row.kind === "call_return"));
  const enter = state.record.events.find(row => row.kind === "call_enter"), returning = state.record.events.at(-1);
  const tampered = structuredClone(enter); tampered.resolution.input.value = "neighbor";
  const base = createAgenticProcess({ instanceId: "fixture", scopeId: "fixture-scope", policyPins: {}, model: state.record.model });
  assert.throws(() => advanceAgenticProcess(base, tampered), /PROCESS_CALL_RESOLUTION_CHANGED/);
  let prefix = base;
  for (const event of state.record.events.slice(0, -1)) prefix = advanceAgenticProcess(prefix, event);
  const changedOutput = structuredClone(returning); changedOutput.witnesses[0].results[0].output.value = "neighbor";
  assert.throws(() => advanceAgenticProcess(prefix, changedOutput), /PROCESS_INPUT_RESULT_CHANGED/);
  const callbackInstance = structuredClone(prefix), callbackCursor = inspectAgenticProcess(callbackInstance);
  assert.throws(() => resolveProcessFrameInput({ instance: callbackInstance, cursor: callbackCursor,
    occurrenceId: returning.occurrence_id, returning: true, readOperation: id => {
      callbackInstance.model.revision++;
      return fixture(arena, state.record.model).read(id);
    } }), /PROCESS_CALL_TARGET_CHANGED/);
  const wrongOccurrence = structuredClone(returning); wrongOccurrence.occurrence_id = "root/1";
  assert.throws(() => advanceAgenticProcess(prefix, wrongOccurrence), /PROCESS_OCCURRENCE_UNKNOWN/);
  const wrongAuthor = structuredClone(prefix.events.at(-1)); wrongAuthor.receipt.authority_id = "wrong-author";
  let intentPrefix = base;
  for (const event of prefix.events.slice(0, -1)) intentPrefix = advanceAgenticProcess(intentPrefix, event);
  assert.throws(() => advanceAgenticProcess(intentPrefix, wrongAuthor), /PROCESS_EVENT_ID_CONFLICT|PROCESS_OPERATION_RECEIPT_BINDING_CHANGED/);
  console.log("PASS negative outcomes preserve waits/refusal/cancel/UNKNOWN; no implicit return; types, concurrent CAS, changed parameter/output/occurrence/author refused");
}
const selection = process.argv[2] ?? "contract";
if (selection === "--cold-worker") await step(process.argv[3], process.argv[4]);
else if (selection === "contract") await contractCases();
else if (selection === "negative") await negativeCases();
else if (["sequential", "concurrent", "cold"].includes(selection)) await executionCase(selection === "concurrent", selection === "cold");
else throw new Error("Unknown exact case selector");
