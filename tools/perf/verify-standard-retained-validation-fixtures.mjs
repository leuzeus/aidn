import assert from "node:assert/strict";
import "./verify-standard-retained-verification-fixtures.mjs";
import fs from "node:fs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { ownedResumeSourceContractFixture } from "./standard-owned-cycle-resume-contract-fixture-lib.mjs";
import { shadowHash as H } from "../../src/core/workflow/shadow-json.mjs";
import { assertRetainedValidationProof, assertRetainedValidationOutput, retainedValidationPins } from "../../src/core/workflow/standard-retained-validation.mjs";
import { standardEntryPoint, selectStandardEntry } from "../../src/core/workflow/standard-workflow-entry-selection.mjs";
import { createStandardOperationProvider } from "../../src/application/runtime/standard-operation-provider.mjs";
import { createAgenticProcessExecutionHost } from "../../src/application/runtime/agentic-process-execution-host.mjs";
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { processFrameNode } from "../../src/core/workflow/process-call-model.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
let count = 0;
const check = async (name, run) => { await run(); count++; console.log("PASS " + name); };
const digest = "a".repeat(64), op = "op_" + "1".repeat(40);
const entry = { kind: "retained_validation", recovery_operation_id: op, original_configuration: { path: "neutral-original.json", sha256: digest } };
const proposal = cyclePlanProposal({ context_sha256: digest, context: { session_id: "S001", cycle_id: "C001", cycle_type: "feature",
  mode: "COMMITTING", original_objective: "Update the local value", allowed_product_files: ["product/app.mjs"] }, evidence_refs: [{ ref: "audit:SPEC.md", sha256: digest }] });
const files = [{ path: "app.mjs", present: true, bytes: 1, sha256: digest }], scope = H(proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })));
const output = { contract_version: "standard-cycle-task-work-output.v1", operation_ref: "cycle_task_work_evaluate", outcome: "completed", effect_status: "no_effect",
  facts: { cycle_work_observed: true, cycle_validation_required: true }, observations: { task: proposal.tasks[0], after_product_sha256: H(files), scope_sha256: scope,
    producer: { instance_id: "original", model_sha256: digest, occurrence_id: "root/1", result_id: "result-original" } }, evidence_refs: [] };
const proof = { original_instance_id: "original", original_instance_sha256: digest, recovery_operation_id: op, recovery_sha256: digest,
  original_configuration_sha256: digest, work_operation_id: op, work_journal_sha256: digest, work_output_sha256: H(output),
  native_journal_sha256: digest, dispatch_sha256: digest, validation_journal_sha256: digest, proposal,
  context: { session_id: "S001", cycle_id: "C001", cycle_path: "cycles/C001-feature-owned", branch: "cycle/C001", head: "a".repeat(40),
    mode: "COMMITTING", cycle_state: "IMPLEMENTING", product_sha256: H(files) }, context_sha256: digest, output, product_snapshot: files,
  product_sha256: H(files), validation_test_refs: ["TEST-001"], contributors: [{ agent_id: "original-actor", lineage_id: "original-lineage" }] };
const continuation = { source_instance_id: proof.original_instance_id, source_instance_sha256: proof.original_instance_sha256,
  recovery_operation_id: op, recovery_sha256: digest, work_operation_id: op, proof_sha256: H(proof) };
await check("retained proof is bounded single-task evidence with original authorship and fresh validation still required", () => {
  assertRetainedValidationProof(proof); assert.equal(retainedValidationPins(proof).work_output_sha256, H(output));
  assert.equal(proof.output.observations.producer.instance_id, "original");
});
for (const [name, mutate] of [
  ["modified product", p => { p.product_snapshot[0].sha256 = "b".repeat(64); }],
  ["foreign session", p => { p.context.session_id = "S999"; }],
  ["foreign cycle", p => { p.context.cycle_id = "C999"; }],
  ["unsupported phase", p => { p.context.cycle_state = "VERIFYING"; }],
  ["omitted contributor", p => { p.contributors = []; }],
  ["invented current producer", p => { p.output.observations.producer.instance_id = "current"; p.work_output_sha256 = H(p.output); }],
  ["different scope", p => { p.output.observations.scope_sha256 = "b".repeat(64); p.work_output_sha256 = H(p.output); }],
  ["omitted validation", p => { p.validation_test_refs = []; }],
  ["extra permission", p => { p.implementation_authorized = true; }],
  ["multiple tasks", p => { p.proposal.tasks.push({ ...structuredClone(p.proposal.tasks[0]), id: "TASK-002" }); }],
]) await check(name + " refuses before continuation", () => { const bad = structuredClone(proof); mutate(bad); assert.throws(() => assertRetainedValidationProof(bad)); });
await check("entry cannot author approvals, source callbacks or a missing recovery identity", () => {
  assert.equal(standardEntryPoint({ entry_point: entry, session: { session_id: "S001" } }), "retained_validation");
  for (const extra of [{ approved: true }, { observer: "caller" }, { recovery_operation_id: "missing" }])
    assert.throws(() => standardEntryPoint({ entry_point: { ...entry, ...extra }, session: { session_id: "S001" } }));
  const selected = selectStandardEntry({ entry_point: entry, session: { session_id: "S001" } }, ownedResumeSourceContractFixture().source.output, continuation);
  assert.equal(selected.facts.mode_committing, true); assert.equal(selected.facts.retained_validation_requested, true);
  assert.throws(() => selectStandardEntry({ entry_point: entry, session: { session_id: "S001" } }, ownedResumeSourceContractFixture().source.output));
});
await check("provider uses its fixed retained authority and checks process changes", async () => {
  const record = { instance_id: "current", instance_sha256: digest, initial_parameters: { entry_point: entry, session: { session_id: "S001" } } };
  let current = digest, reads = 0;
  const provider = createStandardOperationProvider({ current: () => ({ record: { ...record, instance_sha256: current } }),
    operations: { admitCycleEntry: async () => ownedResumeSourceContractFixture().source.output }, reviewEffects: new Map(),
    processAuthority: { retainedValidationEntry: async () => { reads++; return continuation; } },
    entryContinuation: () => assert.fail("ordinary OPEN continuation must not run"), fail: code => { throw Object.assign(Error(code), { code }); } });
  const operation = provider.operations.find(row => row.binding.id === "workflow_entry_select");
  assert.equal((await operation.prepare({ state: { record } })).facts.retained_validation_requested, true); assert.equal(reads, 1);
  current = "b".repeat(64); await assert.rejects(operation.prepare({ state: { record } }), { code: "STANDARD_ENTRY_PROCESS_CHANGED" }); assert.equal(reads, 1);
});
await check("all new closed schemas are supported definitions", () => {
  for (const name of ["standard-retained-validation-entry.v1", "standard-retained-validation-pins.v1", "standard-retained-validation-proof.v1",
    "standard-retained-validation-admission-output.v1", "standard-work-phase-selection-output.v1", "standard-retained-task-work-input.v1",
    "standard-retained-task-work-output.v1", "standard-workflow-entry-selection-output.v2"]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
});
await check("retained model route reaches validation without mode, planning or implementation activities", () => {
  const model = JSON.parse(fs.readFileSync(new URL("../../package/catalogs/process-models/aidn-standard.v1.json", import.meta.url))),
    bindings = new Map(standardWorkflowOperationBindings().map(row => [row.id, row]));
  let instance = createAgenticProcess({ instanceId: "synthetic-retained", model, policyPins: agenticPolicyPins(model), scopeId: "synthetic",
    parameters: { entry_point: entry, session: { session_id: "S001", session_branch: "S001-fixture", objective: "Fixture" }, cycle: { cycle_id: "C001", cycle_type: "feature", title: "fixture", objective: "Fixture" } } });
  const sequence = ["workflow_entry_select", "cycle_retained_validation_admit", "cycle_work_phase_select", "cycle_task_select", "cycle_retained_task_work_observe", "cycle_validation_execute"];
  const entryFacts = selectStandardEntry({ entry_point: entry, session: { session_id: "S001" } }, ownedResumeSourceContractFixture().source.output, continuation).facts;
  for (const [index, binding] of sequence.entries()) {
    const cursor = inspectAgenticProcess(instance), occurrence = cursor.occurrences.find(row => row.occurrence_id === cursor.ready[0]), node = processFrameNode(instance.model, occurrence);
    assert.equal(node.kind, "operation"); assert.equal(node.binding_ref, binding);
    if (binding === "cycle_validation_execute") break;
    const intent = { contract_version: "process-operation-intent.v1", operation_id: "synthetic-" + index, binding_ref: binding,
      binding_sha256: H(bindings.get(binding)), input_sha256: digest, preconditions_sha256: digest, authorization_sha256: null,
      authority_id: "synthetic", scope_id: instance.scope_id, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
      model_sha256: instance.model_sha256, occurrence_id: occurrence.occurrence_id, instance_revision: instance.revision };
    instance = advanceAgenticProcess(instance, { event_id: "intent-" + index, kind: "operation_intent", occurrence_id: occurrence.occurrence_id, intent });
    const facts = index === 0 ? entryFacts : index === 2 ? { cycle_work_retained_validation: true, cycle_work_retained_verification: false, cycle_work_tasks_pending: false, cycle_work_product_ready: false } : {};
    instance = advanceAgenticProcess(instance, { event_id: "result-" + index, kind: "operation_result", occurrence_id: occurrence.occurrence_id,
      receipt: { contract_version: "process-operation-receipt.v1", receipt_id: "synthetic-result-" + index, operation_id: intent.operation_id,
        intent_sha256: H(intent), authority_id: "synthetic", outcome: "completed", effect_status: "no_effect", output_sha256: digest, facts, evidence_refs: [{ ref: "fixture:synthetic", sha256: digest }] } });
  }
  assert.equal(instance.events.some(row => row.kind === "assign" || row.kind === "result"), false);
});
await check("historical contributor identities reach review admission without importing prior resources", async () => {
  let opened = 0, read = false;
  const host = createAgenticProcessExecutionHost({ deadline: Date.now() + 10000, inputs: { prepare: async () => ({ instruction: "Fixture", developer_instructions: "Fixture", binding: {} }) },
    readPriorContributors: () => { read = true; return proof.contributors; }, evidence: {},
    sessionFactory: { open: async () => { assert.equal(read, true); opened++; return { observe: async () => ({ session_id: "fresh", binding_sha256: digest,
      closed: false, permissions: ["read:product"], guarantees: [], context_sha256: [digest], skills: [] }), close: async () => ({ closed: true }) }; } } });
  const binding = await host.prepare({ instance: { instance_id: "current", scope_id: "new-scope", model_sha256: digest }, frame: { occurrence_id: "audit" },
    role: { role: "auditor", action: "audit", skills: [] }, policy: { independent_review: true, context_isolation_required: true, allowed_permissions: ["read:product"] } });
  assert.deepEqual(binding.reviewed_contributors, proof.contributors); assert.equal(opened, 1); await host.close();
});
await check("a failed contributor observation prevents opening any Native session", async () => {
  let opened = 0;
  const host = createAgenticProcessExecutionHost({ deadline: Date.now() + 10000, inputs: { prepare: async () => ({ instruction: "Fixture", developer_instructions: "Fixture", binding: {} }) },
    readPriorContributors: () => [{ agent_id: "invented" }], sessionFactory: { open: async () => { opened++; } }, evidence: {} });
  await assert.rejects(host.prepare({ instance: {}, frame: {}, role: {}, policy: {} }), { code: "PROCESS_HOST_PRIOR_CONTRIBUTORS_INVALID" }); assert.equal(opened, 0);
});
console.log(JSON.stringify({ status: "PASS", checks: count, scope: "CONTROLLED_CONTRACT_PROVIDER_REDUCER_AND_REVIEW_ADMISSION", real_native: "NOT_RUN", p0: false }));
