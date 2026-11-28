import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createProcessOperationJournalStore } from "../../src/adapters/runtime/process-operation-journal-store.mjs";
import { createOperationJournalSigner, operationOutputRef } from "../../src/core/workflow/process-operation-journal.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { compileBpmnProject } from "../../src/application/workflow/bpmn-project-service.mjs";
import { exportBpmnProject } from "../../src/core/workflow/bpmn-project-export.mjs";

const policy = { contract_version: "operation-reliability.v1", max_retries: 1, wait_timeout_ms: 100 };
const bindings = standardWorkflowOperationBindings();
function modelFor(binding, reliability = policy) {
  return { contract_version: "agentic-process-model.v2", model_id: "reliable-work", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [],
    nodes: [{ kind: "operation", id: "observe", binding_ref: binding.id, participant_ref: "project", reliability }],
    entry: "observe", operation_pins: { [binding.id]: shadowHash(binding) } };
}
const compiledModel = modelFor(bindings.find(binding => binding.id === "context_reload"));
const ownFile = fileURLToPath(import.meta.url);
function open(root, key, now, bindingId = "session_entry_admit") {
  return createStandardWorkflowOperationHost({ targetRoot: root, model: modelFor(bindings.find(binding => binding.id === bindingId)),
    readSigningKey: () => fs.readFileSync(key), now, authorize: async () => { throw Error("unexpected effect request"); } });
}
function initialize(host, id) {
  const initial = host.initialize({ instanceId: id });
  host.initialize({ instanceId: id, write: true, expectedResultSha256: initial.record.instance_sha256 });
}
function preview(host, id) {
  const state = host.inspect(id);
  const input = state.record.model.nodes[0].binding_ref === "session_entry_admit" ? {
    contract_version: "standard-session-entry-input.v1", session_id: "S001", session_branch: "S001-standard", objective: "Verify a retry through the installed observation"
  } : {};
  return host.preview({ instanceId: id, expectedSha256: state.record.instance_sha256, occurrenceId: "root", input });
}
function stage(host, candidate) {
  return host.stage(candidate, { write: true, expectedPreviewSha256: shadowHash(candidate) });
}
async function attempt(host, id) {
  const staged = await stage(host, await preview(host, id));
  const result = await host.dispatch(staged.operation_id, { write: true });
  await host.accept(staged.operation_id, { write: true });
  return result;
}

if (process.argv[2] === "--resume") {
  const [, , , root, key, id] = process.argv;
  const host = open(root, key, () => 1050);
  const candidate = await preview(host, id);
  const first = await stage(host, candidate), other = open(root, key, () => 1050);
  await assert.rejects(stage(other, candidate), { code: "STANDARD_HOST_PRECONDITIONS_CHANGED" });
  const racers = await Promise.allSettled([host.dispatch(first.operation_id, { write: true }), other.dispatch(first.operation_id, { write: true })]);
  assert.equal(racers.filter(r => r.status === "fulfilled" && r.value.status === "receipted").length, 1);
  for (const result of racers) {
    if (result.status === "fulfilled") assert.ok(["receipted", "reconciliation_required", "retained_result"].includes(result.value.status));
    else assert.match(result.reason.code, /(?:CONFLICT|OWNER_CHANGED|CAS|ALREADY)/);
  }
  await host.accept(first.operation_id, { write: true });
  assert.equal((await other.dispatch(first.operation_id, { write: true })).status, "retained_result");
  assert.equal(host.readJournal(first.operation_id).results.length, 1);
  const state = host.inspect(id);
  assert.deepEqual(state.record.events.filter(e => e.kind === "operation_result").map(e => e.receipt.outcome), ["blocked", "completed"]);
  assert.equal(state.record.events.filter(e => e.kind === "operation_intent").length, 2);
} else {
  const owned = [];
  try {
    const binding = bindings.find(b => b.id === "context_reload");
    const exported = exportBpmnProject(compiledModel, { "reliable-work.1.bpmn": [binding] });
    assert.deepEqual(compileBpmnProject(exported).model, compiledModel);
    const mutated = { ...binding, implementation_sha256: "0".repeat(64) };
    const foreign = exportBpmnProject(modelFor(mutated), { "reliable-work.1.bpmn": [mutated] });
    assert.throws(() => compileBpmnProject(foreign), { code: "PROCESS_OPERATION_RETRY_UNSUPPORTED", element_id: "N_observe" });
    const mutating = bindings.find(b => b.id === "session_initialize");
    const forbidden = exportBpmnProject(modelFor(mutating), { "reliable-work.1.bpmn": [mutating] });
    assert.throws(() => compileBpmnProject(forbidden), { code: "PROCESS_OPERATION_RETRY_UNSUPPORTED" });
    console.log("PASS authored windows and budgets round-trip; changed provider pins and unsupported mutating bindings reject retries");

    const root = createStandardWorkflowFixture("dual", owned);
    const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-reliability-key-"));
    owned.push(privateRoot);
    const key = path.join(privateRoot, "key"); fs.writeFileSync(key, randomBytes(32));
    let millis = 1000;
    const host = open(root, key, () => millis);
    const baseline = path.join(root, "docs", "audit", "baseline", "current.md");
    const original = fs.readFileSync(baseline);
    const owner = path.join(root, ".aidn", "runtime", "standard-workflow", "effects.lock");
    fs.mkdirSync(path.dirname(owner), { recursive: true });
    fs.writeFileSync(owner, "fixture-owned", { flag: "wx" });
    for (const id of ["retry", "expired", "exhausted"]) initialize(host, id);
    assert.equal((await attempt(host, "retry")).receipt.outcome, "blocked");
    assert.equal((await attempt(host, "expired")).receipt.outcome, "blocked");
    assert.equal((await attempt(host, "exhausted")).receipt.outcome, "blocked");
    assert.equal((await attempt(host, "exhausted")).receipt.outcome, "blocked");
    await assert.rejects(preview(host, "exhausted"), { code: "PROCESS_OPERATION_RETRY_EXHAUSTED" });
    fs.unlinkSync(owner);
    // A fresh Node process reopens signed journals and the process store.
    execFileSync(process.execPath, [ownFile, "--resume", root, key, "retry"], { windowsHide: true, stdio: "inherit" });
    assert.deepEqual(fs.readFileSync(baseline), original);
    console.log("PASS a fresh process resumes one admitted no-effect attempt, concurrent dispatch records one result and the retry budget survives restart");

    millis = 1099;
    const late = await stage(host, await preview(host, "expired"));
    millis = 1100;
    await assert.rejects(host.dispatch(late.operation_id, { write: true }), { code: "PROCESS_OPERATION_WAIT_EXPIRED" });
    assert.equal(host.readJournal(late.operation_id).phase, "staged");
    await assert.rejects(open(root, key, () => 1200).dispatch(late.operation_id, { write: true }), { code: "PROCESS_OPERATION_WAIT_EXPIRED" });
    console.log("PASS a staged retry keeps the first authenticated deadline and expiry prevents dispatch after reopening");

    const observer = open(root, key, () => millis, "context_reload");
    initialize(observer, "unknown");
    const pending = await stage(observer, await preview(observer, "unknown"));
    await observer.dispatch(pending.operation_id, { write: true });
    const journal = createProcessOperationJournalStore({ targetRoot: root, stateMode: "dual" });
    const observed = journal.read(pending.operation_id), result = observed.record.results[0];
    const output = { ...result.output, outcome: "reconciliation_required", effect_status: "unknown", facts: {},
      observations: { reason_code: "FIXTURE_ACK_LOST" }, evidence_refs: [] };
    const receipt = { ...result.receipt, outcome: output.outcome, effect_status: output.effect_status, facts: {},
      output_sha256: shadowHash(output), evidence_refs: [{ ref: operationOutputRef(pending.operation_id), sha256: shadowHash(output) }] };
    const signer = createOperationJournalSigner(() => fs.readFileSync(key));
    journal.compareAndSwap(signer.seal({ ...observed.record, revision: observed.record.revision + 1,
      results: [{ output, receipt }] }), observed.content_sha256);
    await observer.accept(pending.operation_id, { write: true });
    await assert.rejects(preview(observer, "unknown"), { code: "PROCESS_OPERATION_RECONCILIATION_REQUIRED" });
    assert.equal(observer.inspect("unknown").record.events.filter(row => row.kind === "operation_intent").length, 1);
    console.log("PASS an authenticated unknown outcome stays with its original intent for reconciliation");
  } finally {
    for (const root of owned) fs.rmSync(root, { recursive: true, force: true });
  }
}
