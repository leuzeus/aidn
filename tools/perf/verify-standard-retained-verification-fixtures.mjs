import assert from "node:assert/strict";
import fs from "node:fs";
import { shadowHash as H } from "../../src/core/workflow/shadow-json.mjs";
import { assertRetainedVerificationEntry, assertRetainedVerificationProof, assertRetainedVerificationInput,
  assertRetainedVerificationOutput, retainedVerificationContinuation } from "../../src/core/workflow/standard-retained-verification.mjs";
import { standardEntryPoint, selectStandardEntry } from "../../src/core/workflow/standard-workflow-entry-selection.mjs";
import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { createStandardOperationProvider } from "../../src/application/runtime/standard-operation-provider.mjs";
import { ownedResumeSourceContractFixture } from "./standard-owned-cycle-resume-contract-fixture-lib.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { processFrameNode } from "../../src/core/workflow/process-call-model.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";

let count = 0;
const check = async (name, run) => { await run(); count++; console.log("PASS " + name); };
const digest = "a".repeat(64), op = "op_" + "1".repeat(40);
const entry = { kind: "retained_verification", audit_operation_id: op, original_configuration: { path: "neutral-origin.json", sha256: digest } };
const proof = { original_instance_id: "origin", original_instance_sha256: digest, original_configuration_sha256: digest,
  native_journal_sha256: digest, audit_operation_id: op, audit_journal_sha256: digest,
  verification_operation_id: op, verification_journal_sha256: digest, evaluation_operation_id: op, evaluation_journal_sha256: digest,
  validation_operation_id: op, validation_journal_sha256: digest,
  context: { session_id: "S001", cycle_id: "C001", cycle_path: "cycles/C001-feature-fixture", branch: "feature/C001-fixture",
    head: "a".repeat(40), mode: "COMMITTING", cycle_state: "VERIFYING", product_sha256: digest },
  context_sha256: digest, audit_context_sha256: digest, product_sha256: digest, proposal_sha256: digest,
  contributors: [{ agent_id: "origin-worker", lineage_id: "origin-lineage" }] };
const continuation = retainedVerificationContinuation(proof), admission = ownedResumeSourceContractFixture("VERIFYING").source.output;
const output = () => ({ contract_version: "standard-retained-verification-admission-output.v1", operation_ref: "cycle_retained_verification_admit",
  outcome: "completed", effect_status: "no_effect", facts: { cycle_retained_verification_admitted: true },
  observations: { proof, proof_sha256: H(proof), entry_operation_id: op, implementation_authorized: false,
    current_native_work_evidence: false, current_validation_evidence: false }, evidence_refs: [] });
await check("retained verification contracts retain historical evidence without new validation or write claims", () => {
  assertRetainedVerificationEntry(entry); assertRetainedVerificationProof(proof); assertRetainedVerificationInput({});
  const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-retained-verification-admission-output.v1.schema.json", import.meta.url)));
  assert.deepEqual(validateJsonSchema(output(), schema, "$", { contractKind: "workflow-definition" }), []);
  assertRetainedVerificationOutput(output()); assertStandardOperationOutput(output());
});
for (const [name, mutate] of [
  ["wrong phase", p => p.context.cycle_state = "IMPLEMENTING"], ["wrong mode", p => p.context.mode = "THINKING"],
  ["changed product", p => p.context.product_sha256 = "b".repeat(64)], ["missing contributors", p => p.contributors = []],
  ["duplicate contributors", p => p.contributors.push(p.contributors[0])], ["unbound source", p => delete p.original_configuration_sha256],
  ["missing validation", p => delete p.validation_journal_sha256], ["embedded authorization", p => p.approved = true],
]) await check(name + " refuses the proof", () => { const changed = structuredClone(proof); mutate(changed); assert.throws(() => assertRetainedVerificationProof(changed)); });
await check("entry and admission cannot carry execution permission or a substituted proof", () => {
  assert.throws(() => assertRetainedVerificationEntry({ ...entry, approved: true }));
  assert.throws(() => assertRetainedVerificationInput({ proof }));
  assert.throws(() => assertRetainedVerificationOutput({ ...output(), observations: { ...output().observations, current_validation_evidence: true } }));
  assert.throws(() => assertRetainedVerificationOutput({ ...output(), observations: { ...output().observations, proof_sha256: "b".repeat(64) } }));
});
await check("entry selects the named verifying continuation and preserves the canonical observation", () => {
  const parameters = { entry_point: entry, session: { session_id: "S001" } };
  assert.equal(standardEntryPoint(parameters), "retained_verification");
  const selected = selectStandardEntry(parameters, admission, continuation); assertStandardOperationOutput(selected);
  assert.equal(selected.facts.retained_verification_requested, true); assert.equal(selected.facts.retained_validation_requested, false);
  assert.deepEqual(selected.observations.admission, admission);
  assert.throws(() => selectStandardEntry(parameters, admission, { ...continuation, audit_operation_id: "op_" + "2".repeat(40) }));
});
await check("fixed provider selects the new authority and refuses a changed instance", async () => {
  const record = { instance_id: "current", instance_sha256: digest, initial_parameters: { entry_point: entry, session: { session_id: "S001" } } };
  let revision = digest, calls = 0;
  const provider = createStandardOperationProvider({ current: () => ({ record: { ...record, instance_sha256: revision } }),
    operations: { admitCycleEntry: async () => admission }, reviewEffects: new Map(),
    processAuthority: { retainedVerificationEntry: async () => { calls++; return continuation; }, admitRetainedVerification: async () => output() },
    entryContinuation: () => assert.fail("ordinary entry must not run"), fail: code => { throw Object.assign(Error(code), { code }); } });
  const select = provider.operations.find(row => row.binding.id === "workflow_entry_select");
  assert.equal((await select.prepare({ state: { record } })).facts.retained_verification_requested, true); assert.equal(calls, 1);
  const admit = provider.operations.find(row => row.binding.id === "cycle_retained_verification_admit");
  assert.deepEqual(await admit.prepare({ state: { record } }), output());
  revision = "b".repeat(64); await assert.rejects(select.prepare({ state: { record } }), { code: "STANDARD_ENTRY_PROCESS_CHANGED" }); assert.equal(calls, 1);
});
await check("closed schemas use only supported definitions", () => {
  for (const name of ["standard-retained-verification-entry.v1", "standard-retained-verification-proof.v1", "standard-retained-verification-admission-output.v1",
    "standard-work-phase-selection-output.v2", "standard-workflow-entry-selection-output.v3"]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
});
await check("published reducer goes directly to independent audit with no mode, planning, work or validation replay", () => {
  const model = JSON.parse(fs.readFileSync(new URL("../../package/catalogs/process-models/aidn-standard.v1.json", import.meta.url))), bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row]));
  let instance = createAgenticProcess({ instanceId: "synthetic-verification", model, policyPins: agenticPolicyPins(model), scopeId: "synthetic",
    parameters: { entry_point: entry, session: { session_id: "S001", session_branch: "S001-fixture", objective: "Fixture" }, cycle: { cycle_id: "C001", cycle_type: "feature", title: "fixture", objective: "Fixture" } } });
  const sequence = ["workflow_entry_select", "cycle_retained_verification_admit", "cycle_work_phase_select", "cycle_audit_select"];
  for (const [index, binding] of sequence.entries()) {
    const cursor = inspectAgenticProcess(instance), occurrence = cursor.occurrences.find(row => row.occurrence_id === cursor.ready[0]), node = processFrameNode(instance.model, occurrence);
    assert.equal(node.kind, "operation"); assert.equal(node.binding_ref, binding);
    const intent = { contract_version: "process-operation-intent.v1", operation_id: "synthetic-" + index, binding_ref: binding,
      binding_sha256: H(bindings.get(binding)), input_sha256: digest, preconditions_sha256: digest, authorization_sha256: null, authority_id: "synthetic",
      scope_id: instance.scope_id, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256, model_sha256: instance.model_sha256, occurrence_id: occurrence.occurrence_id, instance_revision: instance.revision };
    instance = advanceAgenticProcess(instance, { event_id: "intent-" + index, kind: "operation_intent", occurrence_id: occurrence.occurrence_id, intent });
    const facts = index === 0 ? selectStandardEntry(instance.initial_parameters, admission, continuation).facts : index === 2
      ? { cycle_work_retained_verification: true, cycle_work_retained_validation: false, cycle_work_tasks_pending: false, cycle_work_product_ready: false } : {};
    instance = advanceAgenticProcess(instance, { event_id: "result-" + index, kind: "operation_result", occurrence_id: occurrence.occurrence_id,
      receipt: { contract_version: "process-operation-receipt.v1", receipt_id: "synthetic-result-" + index, operation_id: intent.operation_id, intent_sha256: H(intent),
        authority_id: "synthetic", outcome: "completed", effect_status: "no_effect", output_sha256: digest, facts, evidence_refs: [{ ref: "fixture:synthetic", sha256: digest }] } });
  }
  const cursor = inspectAgenticProcess(instance), node = processFrameNode(instance.model, cursor.occurrences.find(row => row.occurrence_id === cursor.ready[0]));
  assert.equal(node.kind, "activity"); assert.equal(node.id, "audit_review");
  assert.equal(instance.events.some(row => row.kind === "assign" || row.kind === "result"), false);
});
console.log(JSON.stringify({ ok: true, checks: count, Native: 0, historical_source: "NOT_EXERCISED_BY_PURE_FIXTURES", full_standard: false }));
