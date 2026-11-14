import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { diagnosticFixtureWitness } from "./standard-terminal-diagnostic-fixture-lib.mjs";
import { createStandardProcessAuthority } from "../../src/application/runtime/standard-process-authority.mjs";
import { createStandardWorkflowMixedHost } from "../../src/application/runtime/standard-workflow-mixed-composition.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { readWorkflowProjectExecutionAuthority } from "../../src/application/runtime/workflow-instance-composition.mjs";
import { createOperationJournalSigner, operationJournalId, operationJournalPath, operationOutputRef } from "../../src/core/workflow/process-operation-journal.mjs";
import { createProcessOperationJournalStore } from "../../src/adapters/runtime/process-operation-journal-store.mjs";
import { createNativeAllocationJournalStore } from "../../src/adapters/runtime/native-allocation-journal-store.mjs";
import { nativeJournalId, assertNativeCheckpointEvidence } from "../../src/core/workflow/native-allocation-journal.mjs";
import { createAgenticProcess, advanceAgenticProcess, agenticProcessPrefixSha256 } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { fileURLToPath } from "node:url";

// An owned, signed historical corpus exercises authentication only. Native/H/
// provider evidence below is explicitly synthetic; it grants no live authority.
export async function verifyStandardHistoricalDiagnosticFixtures() {
const owned = [], key = randomBytes(32), signer = createOperationJournalSigner(() => key);
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
try {
  const root = createStandardWorkflowFixture("files", owned);
  const privateRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-history-key-")); owned.push(privateRoot);
  const configuration = { target_root: root, instance_id: "history", control_root: privateRoot,
    product_root: path.join(privateRoot, "product"), review_root: path.join(privateRoot, "review"), native: { home: path.join(privateRoot, "home") } };
  const binding = structuredClone(standardWorkflowOperationBindings().find(row => row.id === "context_reload"));
  binding.implementation_sha256 = "0".repeat(64);
  const model = { contract_version: "agentic-process-model.v2", model_id: "historical-diagnostic", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], operation_pins: { context_reload: shadowHash(binding) }, entry: "history",
    nodes: [{ id: "history", kind: "sequence", participant_ref: "project", children: ["first", "second"] },
      ...["first", "second"].map(id => ({ id, kind: "operation", participant_ref: "project", binding_ref: "context_reload" }))] };
  const modelFile = path.join(privateRoot, "model.json"), modelBytes = Buffer.from(JSON.stringify(model)); fs.writeFileSync(modelFile, modelBytes);
  configuration.model = { path: modelFile, sha256: createHash("sha256").update(modelBytes).digest("hex") };
  const { project, persistence } = readWorkflowProjectExecutionAuthority({ targetRoot: root });
  const scopeId = shadowHash({ project: project.scope, persistence: persistence.binding_sha256,
    process_host: { version: 1, profile: "standard-mixed.v1", state_mode: project.stateMode, key_id: signer.keyId, model_sha256: shadowHash(model), model_source_sha256: null } });
  let instance = createAgenticProcess({ instanceId: configuration.instance_id, scopeId, model, policyPins: agenticPolicyPins(model) });
  const store = createProcessOperationJournalStore({ targetRoot: root, stateMode: "files" }), journals = [];
  for (const [index, node] of ["first", "second"].entries()) {
    const occurrenceId = "root/" + index, id = operationJournalId(instance, occurrenceId), input = {}, snapshot = {};
    const preview = signer.seal({ contract_version: "standard-operation-preview.v1", instance_id: instance.instance_id,
      instance_sha256: instance.instance_sha256, scope_id: scopeId, model_sha256: instance.model_sha256, occurrence_id: occurrenceId,
      binding, input, prepared: null, snapshot, prepared_at_ms: 0 });
    const intent = { contract_version: "process-operation-intent.v1", operation_id: id, binding_ref: binding.id, binding_sha256: shadowHash(binding),
      input_sha256: shadowHash(input), preconditions_sha256: shadowHash({ snapshot, prepared: null }), authorization_sha256: null,
      authority_id: "fixture_history", scope_id: scopeId, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
      model_sha256: instance.model_sha256, occurrence_id: occurrenceId, instance_revision: instance.revision };
    instance = advanceAgenticProcess(instance, { event_id: "intent_" + node, kind: "operation_intent", occurrence_id: occurrenceId, intent });
    const output = { contract_version: "standard-operation-output.v1", operation_ref: binding.id, outcome: index ? "blocked" : "completed",
      effect_status: "no_effect", facts: {}, observations: { fixture: true }, evidence_refs: [] };
    const receipt = { contract_version: "process-operation-receipt.v1", receipt_id: "receipt_" + node, operation_id: id,
      intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome: output.outcome, effect_status: output.effect_status,
      output_sha256: shadowHash(output), facts: {}, evidence_refs: [{ ref: operationOutputRef(id), sha256: shadowHash(output) }] };
    const record = signer.seal({ contract_version: "process-operation-journal.v1", operation_id: id, revision: 1, phase: "receipted", preview, intent,
      grant: null, owner: { generation: "11111111-1111-1111-1111-111111111111", pid: process.pid }, results: [{ output, receipt }] });
    store.compareAndSwap(record, null); journals.push(record);
    instance = advanceAgenticProcess(instance, { event_id: "result_" + node, kind: "operation_result", occurrence_id: occurrenceId, receipt });
  }
  const open = (config = configuration, readSigningKey = () => key) => createStandardProcessAuthority({ configuration: config, model, readSigningKey });
  const authority = open();
  createAgenticProcessStore({ targetRoot: root, stateMode: "files" }).compareAndSwap(instance, null);
  let authorizations = 0, nativeControllers = 0;
  const host = createStandardWorkflowMixedHost({ configuration, readSigningKey: () => key,
    authorize: async () => { authorizations++; throw Error("UNEXPECTED_AUTHORIZATION"); } },
    { controllerFactory: () => { nativeControllers++; throw Error("UNEXPECTED_NATIVE_CONTROLLER"); } });
  test("retained binding pins authenticate expired signed previews without current implementation equality", () => {
    const result = authority.inspectDiagnostic(instance);
    assert.equal(result.journal, null); assert.equal(result.written, false); assert.equal(result.native_started, false);
  });
  const retainedBefore = diagnosticFixtureWitness(configuration);
  test("the public mixed port authenticates the same historical journals", () => assert.deepEqual(host.inspectDiagnostic().native, authority.inspectDiagnostic(instance)));
  test("history reads leave exact fixture bytes and physical identities unchanged", () => assert.deepEqual(diagnosticFixtureWitness(configuration), retainedBefore));
  test("current authority and native admission keep rejecting old model bindings", () => {
    for (const run of [() => authority.read(), () => authority.readExecutionAuthority(),
      () => authority.authenticate(instance, { diagnostic: true, forNative: false }),
      () => authority.authenticate(instance, { diagnostic: true, historical: true, forNative: true })])
      assert.throws(run, { code: "STANDARD_PROCESS_BINDING_CHANGED" });
  });
  test("foreign instance and scope remain rejected", () => {
    for (const [instanceId, scope] of [["other", scopeId], [instance.instance_id, "f".repeat(64)]])
      assert.throws(() => authority.inspectDiagnostic(createAgenticProcess({ instanceId, scopeId: scope, model, policyPins: agenticPolicyPins(model) })), { code: "STANDARD_PROCESS_AUTHORITY_CHANGED" });
  });
  let effects = 0;
  await assert.rejects(authority.withNativeOwner({ diagnostic: true }, async () => { effects++; }), { code: "STANDARD_PROCESS_BINDING_CHANGED" });
  test("untrusted diagnostic options cannot run an action under the old grant", () => assert.equal(effects, 0));
  assert.throws(() => host.inspect(), { code: "STANDARD_HOST_BINDING_CHANGED" });
  for (const action of [() => host.step({ write: true, authorization: { diagnostic: true } }),
    () => host.dispatchOperation(journals[0].operation_id, { write: true, diagnostic: true }),
    () => host.acceptOperation(journals[0].operation_id, { write: true, diagnostic: true })]) await assert.rejects(action);
  test("public effect and dispatch ports retain current binding fences", () => assert.deepEqual({ authorizations, nativeControllers }, { authorizations: 0, nativeControllers: 0 }));
  const file = path.join(root, "docs/audit", operationJournalPath(journals[0].operation_id));
  function changedRecord(name, mutate, expected) {
    test(name, () => {
      const bytes = fs.readFileSync(file);
      try {
        const value = JSON.parse(bytes); mutate(value); fs.writeFileSync(file, JSON.stringify(value));
        for (const read of [() => authority.inspectDiagnostic(instance), () => host.inspectDiagnostic()]) assert.throws(read, expected);
      }
      finally { fs.writeFileSync(file, bytes); }
    });
  }
  changedRecord("a forged historical journal fails HMAC", row => { row.preview.prepared_at_ms++; }, { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
  changedRecord("a separately signed substituted binding cannot authenticate under the historical pin", row => {
    row.preview = signer.seal({ ...row.preview, binding: { ...binding, implementation_sha256: "e".repeat(64) } });
    Object.assign(row, signer.seal(row));
  }, { code: "STANDARD_PROCESS_OPERATION_NOT_AUTHENTICATED" });
  changedRecord("a changed old result is not authenticated by a later accepted history", row => {
    row.results[0].output.observations.changed = true;
    row.results[0].receipt.output_sha256 = shadowHash(row.results[0].output);
    Object.assign(row, signer.seal(row));
  }, { code: "STANDARD_PROCESS_OPERATION_NOT_AUTHENTICATED" });
  test("another signing key cannot authenticate the old records", () => assert.throws(() => open(configuration, () => Buffer.alloc(32, 19)).inspectDiagnostic(instance)));
  // A synthetic allocation envelope retains exact checkpoint/result references.
  // No executor or model is called and no resource cessation is claimed.
  const configHash = shadowHash(configuration), limits = { configuration_sha256: configHash, authorized_at_ms: 1,
    global_deadline_ms: 100, workflow_deadline_ms: 100, max_turn_ms: 10, max_responses: 1, max_bytes: 1048576 };
  const state = { contract_version: "native-host-state.v1", authority_id: "fixture_history", instance, parent_closed: true, resources: [], results: [], native_usage: null };
  const evidence = { state, responses_observed: 0, response_sha256: [],
    authorized_budget_sha256: "a".repeat(64), authorized_limits: limits, resume_authority: "NOT_ESTABLISHED_SUPERVISOR_AND_AUTHENTICATED_JOURNAL_REQUIRED" };
  assertNativeCheckpointEvidence(evidence, { instanceId: instance.instance_id, scopeId, modelSha256: shadowHash(model), authorizationSha256: "a".repeat(64), limits });
  const directory = path.join(privateRoot, instance.instance_id); fs.mkdirSync(directory);
  const checkpointFile = path.join(directory, "00001-native-host-state.json"), closureFile = path.join(privateRoot, instance.instance_id + "-CLOSURE.json");
  fs.writeFileSync(checkpointFile, JSON.stringify(evidence));
  const closure = { status: "COMPLETED", first_failure: null, global_deadline_ms: 100, authorized_at_ms: 1,
    process_tree: { termination_state: "confirmed", termination_proof: { active_processes: 0 } }, fixture: true };
  fs.writeFileSync(closureFile, JSON.stringify(closure));
  const bytesHash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const journal = signer.seal({ contract_version: "native-allocation-journal.v1", journal_id: nativeJournalId(instance), instance_id: instance.instance_id,
    scope_id: scopeId, model_sha256: shadowHash(model), revision: 1, allocations: [{ generation: 1, owner_id: "fixture_history", configuration_sha256: configHash,
      authorization_sha256: "a".repeat(64), initial_instance_sha256: agenticProcessPrefixSha256(instance, 0), limits, phase: "closed", owned_result_sha256: shadowHash(closure),
      tree_proof_sha256: shadowHash(closure.process_tree), tree_closed: true, owned_status: "COMPLETED", first_failure: null,
      checkpoint: { path: checkpointFile, sha256: bytesHash(checkpointFile), state_sha256: shadowHash(state), instance_sha256: instance.instance_sha256 },
      consumption: { responses_observed: 0, response_sha256: [], storage_debit_bytes: 0, native_usage_sha256: null }, closure_ref: { path: closureFile, sha256: bytesHash(closureFile) } }] });
  createNativeAllocationJournalStore({ targetRoot: root, stateMode: "files" }).compareAndSwap(journal, null);
  test("signed historical checkpoint remains readable after code changes and grant expiry", () => {
    assert.deepEqual(authority.inspectDiagnostic(instance).checkpoint, state);
    assert.deepEqual(host.inspectDiagnostic().native.checkpoint, state);
  });
  test("checkpoint tampering and missing checkpoint remain rejected", () => {
    const bytes = fs.readFileSync(checkpointFile);
    try {
      fs.appendFileSync(checkpointFile, "\n");
      for (const read of [() => authority.inspectDiagnostic(instance), () => host.inspectDiagnostic()]) assert.throws(read, { code: "NATIVE_ALLOCATION_EVIDENCE_CHANGED" });
      fs.unlinkSync(checkpointFile);
      for (const read of [() => authority.inspectDiagnostic(instance), () => host.inspectDiagnostic()]) assert.throws(read);
    }
    finally { fs.writeFileSync(checkpointFile, bytes); }
  });
  test("the retained signed configuration cannot be replaced by caller options", () => assert.throws(() => open({ ...configuration, product_root: configuration.review_root }).inspectDiagnostic(instance), { code: "STANDARD_PROCESS_NATIVE_HISTORY_CHANGED" }));
  const instanceFile = path.join(root, "docs/audit/workflows/process-instances/history.json");
  test("the public diagnostic port rejects a structurally valid foreign scope", () => {
    const bytes = fs.readFileSync(instanceFile);
    try {
      fs.writeFileSync(instanceFile, JSON.stringify(createAgenticProcess({ instanceId: "history", scopeId: "f".repeat(64), model, policyPins: agenticPolicyPins(model) })));
      assert.throws(() => host.inspectDiagnostic(), { code: "STANDARD_PROCESS_AUTHORITY_CHANGED" });
    } finally { fs.writeFileSync(instanceFile, bytes); }
  });
  const final = diagnosticFixtureWitness(configuration); authority.inspectDiagnostic(instance); host.inspectDiagnostic();
  test("checkpoint history authentication is read-only", () => assert.deepEqual(diagnosticFixtureWitness(configuration), final));
  console.log(JSON.stringify({ status: "PASS", checks, scope: "public-mixed-historical-diagnostic", native: "NOT_RUN", effects: "DENIED", general_reconciliation: "NOT_RUN", whole_goal_complete: false }));
} finally {
  for (const directory of owned.reverse()) {
    const resolved = fs.realpathSync(directory), temporary = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temporary); assert.ok(/^aidn-(standard-ports|history-key)-/.test(path.basename(resolved)));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyStandardHistoricalDiagnosticFixtures();
