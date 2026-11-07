import assert from "node:assert/strict";
import { runStandardWorkflowAction } from "../../src/application/runtime/standard-workflow-entry.mjs";
import { standardWorkflowCallPort } from "../../src/application/runtime/standard-workflow-mixed-composition.mjs";
import { createWorkflowConsoleService } from "../../src/application/runtime/workflow-console-service.mjs";
import { createAgenticProcessService } from "../../src/application/runtime/agentic-process-service.mjs";
import { advanceAgenticProcess, createAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { processModelIdentity } from "../../src/core/workflow/process-call-model.mjs";
import { createOperationJournalSigner, operationJournalId } from "../../src/core/workflow/process-operation-journal.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { runWorkflowRunCli } from "../runtime/workflow-run.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import callActionSchema from "../../src/core/contracts/workflow-definition/standard-workflow-call-action.v1.schema.json" with { type: "json" };
import callResultSchema from "../../src/core/contracts/workflow-definition/standard-workflow-call-result.v1.schema.json" with { type: "json" };

const H = "a".repeat(64);
const node = (id, kind, fields) => ({ id, kind, participant_ref: "project", ...fields });
const component = { contract_version: "agentic-process-model.v2", revision: 1, participants: [{ id: "project" }], roles: [], policies: [] };

export async function verifyStandardWorkflowCallAction() {
  for (const schema of [callActionSchema, callResultSchema])
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  const target = { ...component, model_id: "target", entry: "retained_work", nodes: [node("retained_work", "operation", { binding_ref: "fixture" })],
    operation_pins: { fixture: H }, call_interface: { parameters: { value: "string" }, returns: { value: { type: "string", node_id: "retained_work", path: ["value"] } } },
    data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: ["value"], inputs: [{ node_id: "retained_work",
      fields: { value: { source: "parameter", key: "value", path: [] } } }] } };
  const identity = processModelIdentity(target);
  const model = { ...component, model_id: "fixture", entry: "invoke", nodes: [node("invoke", "call", { target: identity })],
    operation_pins: {}, call_targets: [{ ...identity, model: target }],
    data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: [], inputs: [{ node_id: "invoke",
      fields: { value: { source: "literal", value: "fixture" } } }] } };
  const instanceId = "fixture", parameters = {};
  let record = createAgenticProcess({ instanceId, scopeId: "fixture-scope", model, policyPins: {}, parameters });
  let writes = 0, scope = record.scope_id, journal, wrongFrame, corruptJournal = false, denyAtCommit = false, trust = H;
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 7));
  const read = id => { assert.equal(id, instanceId); return { record: structuredClone(record), content_sha256: shadowHash(record) }; };
  const service = createAgenticProcessService({
    store: { read, compareAndSwap(next, expected) {
      assert.equal(expected, shadowHash(record));
      assert.equal(next.events.length, record.events.length + 1);
      record = structuredClone(next);
      writes++;
      return { record: next, written: true, projection: "canonical" };
    } },
    readAuthority: () => ({ scope_id: scope, model_sha256: shadowHash(model), policy_pins: {} }),
    operationAuthority: { readCallOperation({ operation_id }) {
      assert.equal(operation_id, journal.intent.operation_id);
      if (denyAtCommit) scope = "revoked";
      return signer.verify(corruptJournal ? { ...journal, authentication: H } : wrongFrame ?? journal);
    } },
  });
  const call = standardWorkflowCallPort(service, instanceId);
  const ports = { authority: { keyId: () => signer.keyId, trustSha: () => trust, authorizeOperation: () => assert.fail("unexpected business effect") },
    compose: () => ({ inspect: () => service.inspect(instanceId), previewNative: () => ({}), applyCall: call.apply,
      step({ write, expectedInstanceSha256 }) {
        assert.equal(write, false, "ordinary call never invokes generic write step");
        const state = service.inspect(instanceId);
        assert.equal(state.record.instance_sha256, expectedInstanceSha256);
        const frame = state.cursor.occurrences.find(row => row.status === "WAITING" && ["call_entry", "call_return"].includes(row.wait_reason));
        return frame ? call.step(state, frame, write) : { kind: "terminal", status: state.cursor.status };
      },
    }) };
  const entry = opts => runStandardWorkflowAction({ request: { contract_version: "standard-workflow-execution.v1" },
    configuration: { instance_id: instanceId }, parameters, modelSource: { model_sha256: shadowHash(model) }, ...opts }, ports);
  const apply = (preparedAction, expectPlan = shadowHash(preparedAction)) => entry({ preparedAction, execute: true, expectPlan });
  async function refuses(attempt, code) {
    const before = shadowHash(record), count = writes;
    await assert.rejects(attempt, { code });
    assert.equal(writes, count);
    assert.equal(shadowHash(record), before);
  }

  const preview = await entry();
  assert.equal(writes, 0);
  assert.equal(preview.preview.contract_version, "standard-workflow-call-action.v1");
  assert.equal(preview.preview.payload.transition, "call_entry");
  assert.deepEqual(await entry({ preparedAction: preview.preview }), preview);
  await refuses(() => apply(preview.preview, H), "STANDARD_ENTRY_EXACT_ACTION_REQUIRED");
  for (const [field, value] of Object.entries({ transition: "call_return", occurrence_id: "root/other", event_id: "call_99",
    model_sha256: H, result_sha256: H, instance_id: "other" })) {
    const forged = structuredClone(preview.preview);
    forged.payload[field] = value;
    await refuses(() => apply(forged), "STANDARD_ENTRY_ACTION_CHANGED");
  }
  await refuses(() => apply({ ...preview.preview, contract_version: "standard-workflow-action.v1" }), "STANDARD_ENTRY_ACTION_INVALID");
  await refuses(() => call.apply({ ...preview.preview.payload, result_sha256: H }, { expectedSha256: record.instance_sha256, write: true }), "PROCESS_PREVIEW_CHANGED");
  trust = "b".repeat(64);
  await refuses(() => apply(preview.preview), "STANDARD_ENTRY_PRECONDITIONS_CHANGED");
  trust = H;
  // Exercise the real CLI argument transport with a fixture action document
  // in memory. The installed file loader and public host remain a separate case.
  const saved = JSON.stringify(preview.preview);
  const argv = ["--configuration", "fixture-standard.json", "--action-file", "saved-call.json", "--json"];
  const run = ({ configuration, actionFile, execute, expectPlan }) => {
    assert.equal(configuration, "fixture-standard.json");
    assert.equal(actionFile, "saved-call.json");
    return entry({ preparedAction: JSON.parse(saved), execute, expectPlan });
  };
  assert.deepEqual(await runWorkflowRunCli(argv, { run }), preview);
  assert.equal(writes, 0);
  const entered = await runWorkflowRunCli([...argv, "--execute", "--expect-plan", preview.action_sha256], { run });
  assert.equal(entered.written, true);
  assert.equal(entered.result.contract_version, "standard-workflow-call-result.v1");
  assert.equal(entered.result.native_started, false);
  assert.equal(entered.result.workflow_completed, false);
  assert.equal(record.events.at(-1).kind, "call_enter");
  assert.equal(record.instance_sha256, preview.preview.payload.result_sha256);
  await refuses(() => apply(preview.preview), "STANDARD_ENTRY_PRECONDITIONS_CHANGED");

  const replayed = await call.apply(preview.preview.payload, { expectedSha256: record.instance_sha256, write: true });
  assert.equal(replayed.written, false);
  assert.equal(writes, 1);

  // Seed already accepted work through the common reducer. Only call transitions
  // enter the service write port; this fixture never dispatches the child.
  const frame = service.inspect(instanceId).cursor.ready[0];
  const input = { value: "fixture" }, output = { value: "fixture-result" };
  const operationId = operationJournalId(record, frame);
  const intent = { contract_version: "process-operation-intent.v1", operation_id: operationId, binding_ref: "fixture", binding_sha256: H,
    input_sha256: shadowHash(input), preconditions_sha256: H, authorization_sha256: H, authority_id: "fixture",
    scope_id: scope, instance_id: instanceId, instance_sha256: record.instance_sha256, model_sha256: record.model_sha256,
    occurrence_id: frame, instance_revision: record.revision };
  const receipt = { contract_version: "process-operation-receipt.v1", receipt_id: "fixture_receipt", operation_id: operationId,
    intent_sha256: shadowHash(intent), authority_id: "fixture", outcome: "completed", effect_status: "no_effect",
    output_sha256: shadowHash(output), facts: {}, evidence_refs: [{ ref: "fixture/work", sha256: shadowHash(output) }] };
  record = advanceAgenticProcess(record, { event_id: "fixture_intent", kind: "operation_intent", occurrence_id: frame, intent });
  record = advanceAgenticProcess(record, { event_id: "fixture_result", kind: "operation_result", occurrence_id: frame, receipt });
  journal = signer.seal({ phase: "receipted", intent, preview: { input }, results: [{ output, receipt }] });

  const console = createWorkflowConsoleService({ targetIdentity: H, invokeRun: (request, flags) => entry({
    preparedAction: request.preparedAction ?? null, execute: flags.apply, expectPlan: flags.expectPlan,
  }) });
  const request = { operation: "run", input: { configuration: "fixture" } };
  const pending = await console.action(request);
  assert.deepEqual(pending.errors, []);
  assert.equal(writes, 1);
  const prepared = pending.action.request.input.preparedAction;
  assert.equal(prepared.payload.transition, "call_return");
  assert.deepEqual(prepared, pending.action.preview.preview);
  corruptJournal = true;
  await refuses(() => apply(prepared), "PROCESS_OPERATION_AUTHORITY_UNAVAILABLE");
  corruptJournal = false;
  wrongFrame = signer.seal({ ...journal, intent: { ...intent, occurrence_id: "root/other" } });
  await refuses(() => apply(prepared), "PROCESS_INPUT_RESULT_CHANGED");
  wrongFrame = null;
  denyAtCommit = true;
  await refuses(() => call.apply(prepared.payload, { expectedSha256: record.instance_sha256, write: true }), "PROCESS_AUTHORITY_CHANGED");
  denyAtCommit = false;
  scope = record.scope_id;
  const missing = await console.action(request, { execute: true, expectPlan: pending.action_sha256 });
  assert.deepEqual(missing.errors, ["WORKFLOW_CONSOLE_STANDARD_PREPARED_ACTION_REQUIRED"]);
  const applied = await console.action(pending.action.request, { execute: true, expectPlan: pending.action_sha256 });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.result.process_status, "COMPLETED");
  assert.equal(applied.result.result.details.projection, "canonical");
  assert.equal(record.events.at(-1).kind, "call_return");
  assert.deepEqual(record.events.at(-1).resolution.input, { value: "fixture-result" });
  assert.equal(record.events.at(-1).witnesses[0].operation_id, operationId);
  assert.equal(record.instance_sha256, prepared.payload.result_sha256);
  await refuses(() => apply(prepared), "STANDARD_ENTRY_PRECONDITIONS_CHANGED");
  const stale = await console.action(pending.action.request, { execute: true, expectPlan: pending.action_sha256 });
  assert.deepEqual(stale.errors, ["STANDARD_ENTRY_PRECONDITIONS_CHANGED"]);
  assert.equal(writes, 2);
  const observed = await entry();
  assert.equal(observed.preview.contract_version, "standard-workflow-action.v1");
  assert.equal(observed.preview.kind, "observe");
  assert.equal(observed.can_apply, false);
  return { entry: "PASS", return: "PASS", memory_cas_writes: writes, persistent_cas: "NOT_RUN", native: "NOT_RUN" };
}
