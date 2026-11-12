import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadStandardWorkflowAssets, STANDARD_WORKFLOW_MODEL_PATH, STANDARD_WORKFLOW_CATALOG_PATH } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { loadStandardWorkflowStartupAssets } from "../../src/application/runtime/standard-workflow-startup-composition.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { verifyStandardWorkflowComponentAssets, assertStandardWorkflowActivityOutputs, refreshStandardWorkflowComponentBindings } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import catalogSchemaV3 from "../../src/core/contracts/workflow-definition/standard-workflow-catalog.v3.schema.json" with { type: "json" };
import catalogSchemaV4 from "../../src/core/contracts/workflow-definition/standard-workflow-catalog.v4.schema.json" with { type: "json" };
import { processModelIdentity } from "../../src/core/workflow/process-call-model.mjs";
import { advanceAgenticProcess, createAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { resolveProcessFrameInput } from "../../src/core/workflow/process-frame-input.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { assertDecisionInbox, decisionInboxId } from "../../src/core/workflow/process-decision-inbox.mjs";
import { assertHumanResolutionException, assertResolutionExceptionSubject, resolutionExceptionQuestion, resolutionExceptionOutput } from "../../src/core/workflow/standard-pr-resolution-exception.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { resolveStandardWorkflowConfiguration, standardWorkflowControlOccurrence } from "../../src/application/runtime/standard-workflow-entry.mjs";
import { createProjectAgenticProcessExecution } from "../../src/application/runtime/agentic-process-execution-composition.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
import { PR_TRIAGE_CONTRACT } from "../../src/core/workflow/standard-pr-triage.mjs";
import { CYCLE_WORK_CONTRACT } from "../../src/core/workflow/standard-cycle-work.mjs";

const root = new URL("../../", import.meta.url), read = name => fs.readFileSync(new URL(name, root));
const assets = loadStandardWorkflowAssets();
const fresh = () => ({ catalog: structuredClone(assets.catalog), model: structuredClone(assets.model),
  bindings: standardWorkflowOperationBindings(), specification: read("docs/SPEC.md"),
  skills: Object.fromEntries([...new Set(assets.catalog.bindings.map(row => row.skill_source.path))].map(name => [name, read(name)])) });
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
const reject = (name, change, code) => test(name, () => {
  const input = fresh(); change(input); assert.throws(() => verifyStandardWorkflowComponentAssets(input), { code });
});

test("the published activity outputs pass project composition, which refuses mismatched bindings", () => {
  const physical = name => fs.realpathSync(new URL(name, root));
  const criteria = { path: physical("AGENTS.md"), sha256: createHash("sha256").update(read("AGENTS.md")).digest("hex") };
  const home = physical("scaffold"), hook = "sha256:" + "0".repeat(64);
  const { configuration } = resolveStandardWorkflowConfiguration({
    contract_version: "standard-workflow-execution.v1", parameters: {},
    execution: { instance_id: "standard-activity-output-fixture", target_root: physical("tests/fixtures"),
      product_root: physical("tests/fixtures/standard-workflow"), control_root: physical("tools"), review_root: physical("docs"),
      product_files: ["composed-positive.v1.json"], criteria, authorities: {}, controller: {},
      native: { executable: process.execPath, sha256: "0".repeat(64), home, tool_roots: [], model: "unused", effort: "low",
        hook_hashes: { work: [hook, hook], review: [] }, startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [],
          environment_names: CODEX_STARTUP_ENVIRONMENT_PROFILES.worker, environment_override_names: [], log_dir: home, sqlite_home: home } } },
  });
  const compose = config => createProjectAgenticProcessExecution(config, {
    processAuthority: { profile: "standard-mixed.v1", read() { assert.fail("Unexpected authority read"); } },
  });
  // Stop at the project authority precondition after validating every published
  // output. The fixture needs neither project activation nor an executor.
  assert.throws(() => compose(configuration), { code: "PROCESS_EXECUTION_PROJECT_AUTHORITY_REQUIRED" });
  for (const [node, contract] of [["audit_review", PR_TRIAGE_CONTRACT], ["implement", CYCLE_WORK_CONTRACT]]) {
    const mismatched = { ...configuration, activity_outputs: { ...configuration.activity_outputs, [node]: contract } };
    assert.throws(() => compose(mismatched), { code: "PROCESS_ACTIVITY_OUTPUT_BINDING_INVALID" });
  }
});

test("ordinary entry selects the common reducer's event wait and refuses absent or ambiguous waits", () => {
  const model = { contract_version: "agentic-process-model.v2", model_id: "control-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], operation_pins: {}, entry: "wait_review",
    nodes: [{ id: "wait_review", kind: "event", participant_ref: "project", branches: [
      { flow_id: "review", node_id: "reviewed", event_key: "review_snapshot" }, { flow_id: "checks", node_id: "checked", event_key: "checks_snapshot" }] },
      ...["reviewed", "checked"].map(id => ({ id, kind: "sequence", participant_ref: "project", children: [] }))] };
  const record = createAgenticProcess({ instanceId: "control-fixture", scopeId: "fixture", model, policyPins: agenticPolicyPins(model) });
  const state = { record, cursor: inspectAgenticProcess(record) };
  assert.equal(standardWorkflowControlOccurrence(state), "root");
  const rejected = { code: "STANDARD_ENTRY_CONTROL_WAIT_REQUIRED" };
  assert.throws(() => standardWorkflowControlOccurrence({ ...state, cursor: { occurrences: [] } }), rejected);
  assert.throws(() => standardWorkflowControlOccurrence({ ...state, cursor: { occurrences: [...state.cursor.occurrences, ...state.cursor.occurrences] } }), rejected);
  for (const field of [{ status: "READY" }, { wait_reason: "deferred" }])
    assert.throws(() => standardWorkflowControlOccurrence({ ...state, cursor: { occurrences: [{ ...state.cursor.occurrences[0], ...field }] } }), rejected);
  assert.throws(() => standardWorkflowControlOccurrence({ ...state, record: { model: { nodes: [{ id: "wait_review", kind: "operation" }] } } }), rejected);
});
test("the published JSON is loaded as the exact common IR with fixed real operation bindings", () => {
  assert.equal(assets.model.model_id, "aidn-standard"); assert.equal(assets.model.contract_version, "agentic-process-model.v2");
  assert.deepEqual(verifyStandardWorkflowComponentAssets(fresh()), assets.source);
  const correctionSequence = assets.model.nodes.find(row => row.id === "correction_cycle").children;
  assert.deepEqual(correctionSequence, ["correction_initialize", "correction_branch_audit", "correction_cycle_drift", "correction_cycle_checkpoint", "correction_session_start_finalize", "correction_plan", "correction_plan_evaluate", "correction_plan_record", "correction_readiness", "correction_implementation_enter",
    "correction_task_loop", "correction_audit_select", "correction_audit_review", "correction_audit_evaluate", "correction_closure_decide", "correction_close_record", "correction_cycle_terminal_checkpoint", "correction_closure_drift", "correction_close_finalize",
    "correction_promotion_eligibility", "correction_session_preclose_checkpoint", "correction_session_close_admit", "correction_session_closure_drift", "correction_session_closure_decide", "correction_session_close_record", "correction_session_close_checkpoint", "correction_session_close_finalize", "correction_session_delivery_checkpoint", "correction_session_branch_integration_decide", "correction_session_branch_integrate", "correction_pr_redelivery"]);
  assert.equal(assets.model.nodes.find(row => row.id === "correction_initialize").binding_ref, "session_pr_correction_cycle_initialize");
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "correction_initialize").fields.decision_operation_id, { source: "operation_id", node_id: "session_pr_correction_decide" });
  for (const key of ["cycle_id", "title", "objective"]) assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "correction_initialize").fields[key],
    { source: "operation_output", node_id: "session_pr_correction_decide", path: ["observations", "candidate_cycle", key] });
  assert.equal(assets.catalog.bindings.length, 190); assert.equal(assets.catalog.activities.length, 23);
});
test("correction work and closure consume the new implementation and new validation authorities", () => {
  const fields = id => assets.model.data_bindings.inputs.find(row => row.node_id === id).fields;
  assert.deepEqual(fields("correction_task_select").implementation_operation_id, { source: "operation_id", node_id: "correction_implementation_enter" });
  assert.deepEqual(fields("correction_audit_select").implementation_operation_id, { source: "operation_id", node_id: "correction_implementation_enter" });
  assert.deepEqual(fields("correction_validate").work_operation_id, { source: "operation_id", node_id: "correction_work_evaluate" });
  assert.deepEqual(fields("correction_final_verification"), {
    validation_operation_id: { source: "operation_id", node_id: "correction_validate" },
    progress_operation_id: { source: "operation_id", node_id: "correction_task_advance" },
  });
  assert.deepEqual(fields("correction_close_record").decision_operation_id, { source: "operation_id", node_id: "correction_closure_decide" });
  assert.deepEqual(fields("correction_cycle_terminal_checkpoint").closure_operation_id, { source: "operation_id", node_id: "correction_close_record" });
  assert.deepEqual(fields("correction_close_finalize").closure_operation_id, { source: "operation_id", node_id: "correction_close_record" });
  const operations = assets.catalog.bindings.filter(row => row.node_id.startsWith("correction_") && !["correction_initialize", "correction_branch_audit", "correction_cycle_checkpoint", "correction_cycle_drift_evaluate", "correction_cycle_drift_finalize", "correction_plan_evaluate", "correction_plan_record", "correction_readiness", "correction_implementation_enter"].includes(row.node_id));
  assert.equal(operations.length, 37);
  assert.ok(operations.every(row => row.binding.id !== "session_pr_open" && row.binding.id !== "session_push"));
  const audit = assets.model.nodes.find(row => row.id === "correction_audit_review"); assert.equal(audit.policy_ref, "audit");
  const sequence = assets.model.nodes.find(row => row.id === "correction_cycle").children;
  assert.ok(sequence.indexOf("correction_task_loop") > sequence.indexOf("correction_implementation_enter"));
  assert.equal(sequence.at(-1), "correction_pr_redelivery");
});
test("correction promotion and session reclosure use new cycle, R05, human and delivery identities", () => {
  const fields = id => assets.model.data_bindings.inputs.find(row => row.node_id === id).fields;
  for (const [node, field, source] of [
    ["promotion_decide", "closure_operation_id", "close_finalize"], ["session_preclose_checkpoint", "closure_operation_id", "close_finalize"],
    ["session_closure_decide", "admission_operation_id", "session_close_admit"], ["session_closure_decide", "drift_evaluation_operation_id", "session_closure_drift_evaluate"],
    ["session_close_record", "decision_operation_id", "session_closure_decide"], ["session_close_finalize", "record_operation_id", "session_close_record"],
    ["session_close_finalize", "checkpoint_operation_id", "session_close_checkpoint"], ["session_delivery_checkpoint", "finalization_operation_id", "session_close_finalize"],
    ["session_branch_integration_decide", "closure_operation_id", "close_finalize"], ["session_branch_integration_decide", "delivery_operation_id", "session_delivery_checkpoint"],
    ["session_branch_integrate", "decision_operation_id", "session_branch_integration_decide"]]) {
    assert.deepEqual(fields("correction_" + node)[field], { source: "operation_id", node_id: "correction_" + source });
  }
  assert.equal(assets.model.nodes.find(row => row.id === "correction_session_start_finalize").binding_ref, "session_start_finalize");
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
});
test("authored literal/operation-only inputs satisfy their actual closed operation contracts", () => {
  for (const spec of assets.model.data_bindings.inputs) {
    if (Object.values(spec.fields).some(row => !["literal", "operation_id"].includes(row.source))) continue;
    const node = assets.model.nodes.find(row => row.id === spec.node_id);
    if (node.kind !== "operation") continue;
    const input = Object.fromEntries(Object.entries(spec.fields).map(([name, row]) => [name, row.source === "literal" ? row.value : "op_" + "a".repeat(40)]));
    assertStandardOperationInput(node.binding_ref, input);
  }
});
function committingSteps() {
  const node = assets.model.nodes.find(row => row.id === "cycle_work"), delivery = assets.model.nodes.find(row => row.id === "session_pr_delivery");
  assert.equal(delivery.kind, "sequence"); assert.equal(node.children.at(-1), delivery.id);
  const review = assets.model.nodes.find(row => row.id === "session_pr_nominal_review");
  return [...node.children.slice(0, -1), ...delivery.children, ...review.children];
}
test("review evidence is a deterministic observation after confirmed update, with no merge or triage success", () => {
  const children = committingSteps(), binding = assets.catalog.bindings.find(row => row.node_id === "session_pr_review_observe").binding;
  assert.equal(children.indexOf("session_pr_review_observe"), children.indexOf("session_pr_update_push") + 1);
  assert.equal(binding.id, "session_pr_review_content_observe"); assert.equal(binding.effect_class, "read-only"); assert.equal(binding.executor_kind, "deterministic"); assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_review_observe").fields.update_operation_id,
    { source: "operation_id", node_id: "session_pr_update_push" });
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
});
test("published standard selects an external PR wait before the deterministic signed-content consumer", () => {
  const children = committingSteps(), capture = assets.model.call_targets.find(row => row.model_id === "aidn-standard-pr-review-capture");
  const wait = capture.model.nodes.find(row => row.id === capture.model.entry);
  assert.equal(children.indexOf("session_pr_review_capture"), children.indexOf("session_pr_review_observe") + 1);
  assert.equal(children.indexOf("session_pr_review_event_route"), children.indexOf("session_pr_review_capture") + 1);
  assert.equal(wait.kind, "event");
  assert.deepEqual(wait.branches.map(row => row.event_key), ["review_snapshot", "checks_snapshot", "external_merge_observed"]);
  for (const [prefix, delivery] of [["session", "session_pr_update_push"], ["correction", "correction_pr_redelivery_push"]]) {
    const site = id => assets.model.nodes.find(row => row.id === prefix + "_pr_" + id);
    assert.equal(site("review_capture").target.model_sha256, capture.model_sha256);
    assert.equal(site("pretriage_route").branches[0].node_id, site("pretriage_completion").id);
    assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === site("pretriage_completion").id).fields,
      { update_operation_id: { source: "operation_id", node_id: delivery } });
  }
  const continuation = name => assets.model.call_targets.find(row => row.model_id === name).model;
  const existing = continuation("aidn-standard-pr-review-completion"), external = continuation("aidn-standard-pr-pretriage-completion");
  const suffix = model => model.nodes.slice(model.nodes.findIndex(row => row.id === "pr_merge_basis"));
  assert.deepEqual(suffix(external), suffix(existing));
  const downstreamInputs = model => model.data_bindings.inputs.filter(row => row.node_id.startsWith("pr_post_merge_"));
  assert.deepEqual(downstreamInputs(external), downstreamInputs(existing));
  const consumer = assets.catalog.bindings.find(row => row.node_id === "session_pr_review_receive").binding;
  assert.equal(consumer.effect_class, "read-only"); assert.equal(consumer.executor_kind, "deterministic");
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_review_receive").fields.update_operation_id,
    { source: "operation_id", node_id: "session_pr_update_push" });
});

test("native PR triage consumes a selected accepted source before host evaluation", () => {
  const children = committingSteps(), ids = ["session_pr_review_receive", "session_pr_triage_select", "session_pr_triage", "session_pr_triage_evaluate"];
  for (let i = 1; i < ids.length; i++) assert.equal(children.indexOf(ids[i]), children.indexOf(ids[i - 1]) + 1);
  const activity = assets.model.nodes.find(row => row.id === "session_pr_triage"), policy = assets.model.policies.find(row => row.id === activity.policy_ref);
  assert.equal(activity.kind, "activity"); assert.equal(policy.independent_review, true); assert.deepEqual(policy.allowed_permissions, ["read:product"]);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === activity.id).fields,
    { selection_operation_id: { source: "operation_id", node_id: "session_pr_triage_select" } });
  assert.equal(assets.catalog.activities.find(row => row.node_id === activity.id).output_contract, "standard-pr-triage-report.v1");
  for (const id of ["session_pr_triage_select", "session_pr_triage_evaluate"]) {
    const binding = assets.catalog.bindings.find(row => row.node_id === id).binding;
    assert.equal(binding.executor_kind, "deterministic"); assert.equal(binding.effect_class, "read-only"); assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  }
});
test("valid findings select an explicit granted canonical reopen with an accepted triage identity only", () => {
  const route = assets.model.nodes.find(row => row.id === "session_pr_after_triage");
  assert.deepEqual(route.branches, [
    { flow_id: "corrections", node_id: "session_pr_correction", condition: "session_pr_corrections_required" },
    { flow_id: "effects_pending", node_id: "session_pr_effects_pending", condition: null }]);
  const binding = assets.catalog.bindings.find(row => row.node_id === "session_pr_correction_reopen").binding;
  assert.equal(binding.effect_class, "mutating"); assert.equal(binding.executor_kind, "deterministic");
  assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_correction_reopen").fields,
    { contract_version: { source: "literal", value: "standard-pr-correction-reopen-input.v1" }, triage_operation_id: { source: "operation_id", node_id: "session_pr_triage_evaluate" } });
  assert.deepEqual(assets.model.nodes.find(row => row.id === "session_pr_correction").children, ["session_pr_correction_reopen", "session_pr_correction_checkpoint", "session_pr_correction_decide", "session_pr_correction_requested"]);
  const checkpoint = assets.catalog.bindings.find(row => row.node_id === "session_pr_correction_checkpoint").binding;
  assert.equal(checkpoint.effect_class, "mutating"); assert.equal(checkpoint.executor_kind, "deterministic"); assert.deepEqual(checkpoint.allowed_modes, ["COMMITTING"]);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_correction_checkpoint").fields,
    { contract_version: { source: "literal", value: "standard-pr-correction-checkpoint-input.v1" }, reopen_operation_id: { source: "operation_id", node_id: "session_pr_correction_reopen" } });
});
test("R08 exception contracts bind the exact question, signed capture shape and outcome", () => {
  for (const name of ["standard-pr-review-resolution-select-output.v2", "standard-pr-review-resolution-exception-input.v1",
    "standard-pr-review-resolution-exception-question.v1", "standard-pr-review-resolution-exception-output.v1",
    "human-pr-review-resolution-exception.v1", "process-decision-inbox.v13"]) {
    const schema = JSON.parse(read(`src/core/contracts/workflow-definition/${name}.schema.json`));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const hash = "a".repeat(64), oid = "b".repeat(40), op = "op_" + oid;
  const input = { triage_operation_id: op, selection_operation_id: op };
  const subject = { triage_operation_id: op, update_operation_id: op, source_sha256: hash, repository_id: "R_1",
    pull_request_id: "PR_1", pull_request_number: 7, head_oid: oid, base_oid: oid, head_ref: "session", base_ref: "dev",
    unresolved_thread_ids: ["T_1", "T_2"], thread_observation_sha256: hash, review_evidence_sha256: hash, reply_proof_sha256: hash, actor_id: "U_1" };
  const intent = { instance_id: "fixture", scope_id: "fixture", occurrence_id: "call/0" };
  const prepared = { subject, prepared_at_ms: 1000 };
  const question = resolutionExceptionQuestion({ intent, operation_id: op, preview: { input, prepared } });
  for (const unresolved_thread_ids of [[], ["T_1", "T_1"], ["T_2", "T_1"], Array.from({ length: 32 }, (_, i) => "T_" + i)]) {
    assert.throws(() => assertResolutionExceptionSubject({ ...subject, unresolved_thread_ids }),
    { code: "STANDARD_PR_RESOLUTION_EXCEPTION_SUBJECT_INVALID" });
  }
  for (const [choice, outcome] of [["accept_resolution_exception", "completed"], ["refused", "rejected"], ["deferred", "deferred"], ["cancelled", "cancelled"]]) {
    const source = { contract_version: "human-pr-review-resolution-exception.v1", source_kind: "human", authority_id: "fixture_human",
      source_event_id: "decision_" + choice, choice, rationale: "The note repeats the accepted triage.",
      question_sha256: shadowHash(question), subject_sha256: shadowHash(question.subject), evidence_refs: [{ ref: "github:thread/T_1", sha256: hash }] };
    const capture = { contract_version: "process-decision-inbox.v13", inbox_id: decisionInboxId(source), operation_id: op,
      source_ref: "fixture", source, phase: "reserved", receipt_sha256: null, key_id: hash, authentication: hash };
    assert.deepEqual(assertDecisionInbox(capture), capture);
    const output = resolutionExceptionOutput(question, capture);
    assert.equal(assertStandardOperationOutput(output).outcome, outcome);
    assert.throws(() => assertStandardOperationOutput({ ...output, facts: { session_pr_threads_observed_resolved: true } }),
      { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
    assert.throws(() => assertHumanResolutionException({ ...source, rationale: "\t " }, question),
      { code: "STANDARD_PR_RESOLUTION_EXCEPTION_DECISION_INVALID" });
    assert.throws(() => assertHumanResolutionException(source, { ...question, subject: { ...subject, unresolved_thread_ids: ["T_2"] } }),
      { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
  }
});
test("both PR effects boundaries pass their own accepted triage to the same pinned continuation", () => {
  for (const kind of ["fetch-input", "fetch-output", "alignment-input", "alignment-output",
    "measure-output", "decision-input", "decision-question", "decision-output", "fast-forward-input", "fast-forward-plan", "fast-forward-output"]) {
    const contract = JSON.parse(read("src/core/contracts/workflow-definition/standard-pr-post-merge-" + kind + ".v1.schema.json"));
    assert.deepEqual(validateJsonSchemaDefinition(contract, "#", { contractKind: "workflow-definition" }), []);
  }
  for (const name of ["human-pr-post-merge-decision.v1", "process-decision-inbox.v15"]) {
    const schema = JSON.parse(read("src/core/contracts/workflow-definition/" + name + ".schema.json"));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const target = assets.model.call_targets.find(row => row.model_id === "aidn-standard-pr-review-completion");
  const { model: child, ...identity } = target;
  assert.deepEqual(identity, processModelIdentity(child));
  assert.deepEqual(child.call_interface, { parameters: { triage_operation_id: "string" }, returns: {} });
  assert.deepEqual(child.nodes.find(row => row.id === child.entry).children, ["pr_premerge_observe", "pr_review_route", "pr_merge_basis", "pr_post_merge_fetch", "pr_post_merge_measure", "pr_post_merge_route"]);
  assert.deepEqual(child.nodes.find(row => row.id === "pr_post_merge_route").branches, [
    { flow_id: "diverged", node_id: "pr_post_merge_reconcile", condition: "session_pr_post_merge_diverged" },
    { flow_id: "aligned", node_id: "pr_post_merge_complete", condition: null },
  ]);
  assert.deepEqual(child.nodes.find(row => row.id === "pr_post_merge_reconcile").children,
    ["pr_post_merge_decision", "pr_post_merge_strategy", "pr_post_merge_alignment", "pr_post_merge_reconciled_complete"]);
  assert.deepEqual(child.nodes.find(row => row.id === "pr_post_merge_strategy").branches, [
    { flow_id: "fast_forward", node_id: "pr_post_merge_fast_forward", condition: "session_pr_post_merge_fast_forward" },
    { flow_id: "manual", node_id: "pr_post_merge_manual", condition: null },
  ]);
  for (const prefix of ["session", "correction"]) {
    const id = prefix + "_pr_effects_pending";
    const call = assets.model.nodes.find(row => row.id === id);
    assert.equal(call.kind, "call");
    assert.deepEqual(call.target, identity);
    assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === id).fields, {
      triage_operation_id: { source: "operation_id", node_id: prefix + "_pr_triage_evaluate" },
    });
  }
  for (const [id, effect, rules, fields] of [
    ["pr_merge_execute", "executor", ["SPEC-R08", "SPEC-R11"], {
      triage_operation_id: { source: "parameter", key: "triage_operation_id", path: [] },
      checks_operation_id: { source: "operation_id", node_id: "pr_checks_accept" },
      consent_operation_id: { source: "operation_id", node_id: "pr_merge_consent" },
    }],
    ["pr_post_merge_fetch", "executor", ["SPEC-R09", "SPEC-R11"], {
      merge_operation_id: { source: "operation_output", node_id: "pr_merge_basis", path: ["observations", "merge_operation_id"] },
    }],
    ["pr_post_merge_measure", "read-only", ["SPEC-R09"], {
      fetch_operation_id: { source: "operation_id", node_id: "pr_post_merge_fetch" },
    }],
    ["pr_post_merge_decision", "read-only", ["SPEC-R09", "SPEC-R11"], {
      measurement_operation_id: { source: "operation_id", node_id: "pr_post_merge_measure" },
      allow_fast_forward: { source: "literal", value: true },
    }],
    ["pr_post_merge_fast_forward", "executor", ["SPEC-R09", "SPEC-R11"], {
      decision_operation_id: { source: "operation_id", node_id: "pr_post_merge_decision" },
    }],
    ["pr_post_merge_alignment", "read-only", ["SPEC-R09"], {
      fetch_operation_id: { source: "operation_id", node_id: "pr_post_merge_fetch" },
    }],
    ["pr_post_merge_complete", "mutating", ["SPEC-R09"], {
      alignment_operation_id: { source: "operation_id", node_id: "pr_post_merge_measure" },
    }],
    ["pr_post_merge_reconciled_complete", "mutating", ["SPEC-R09"], {
      alignment_operation_id: { source: "operation_id", node_id: "pr_post_merge_alignment" },
    }],
  ]) {
    const row = assets.catalog.bindings.find(row => row.node_id === id), { binding } = row;
    assert.deepEqual(row.model_ref, identity);
    assert.equal(binding.effect_class, effect);
    assert.deepEqual(binding.rule_refs, rules);
    assert.equal(child.operation_pins[binding.id], shadowHash(binding));
    assert.deepEqual(child.data_bindings.inputs.find(row => row.node_id === id).fields, {
      contract_version: { source: "literal", value: binding.input_contract }, ...fields,
    });
  }
  assert.equal(assets.catalog.bindings.find(row => row.node_id === "pr_post_merge_decision").binding.executor_kind, "human");
  const loop = child.nodes.find(row => row.id === "pr_reply_loop");
  assert.equal(loop.max_iterations, 32);
  assert.equal(loop.until, "session_pr_replies_observed");
  const publish = assets.catalog.bindings.find(row => row.node_id === "pr_reply_publish");
  assert.equal(publish.binding.effect_class, "executor");
  assert.deepEqual(publish.binding.allowed_modes, ["COMMITTING"]);
  assert.equal(child.operation_pins[publish.binding.id], shadowHash(publish.binding));
  assert.deepEqual(child.data_bindings.inputs.find(row => row.node_id === "pr_reply_publish").fields, {
    contract_version: { source: "literal", value: "standard-pr-review-reply-publish-input.v1" },
    triage_operation_id: { source: "parameter", key: "triage_operation_id", path: [] },
    selection_operation_id: { source: "operation_id", node_id: "pr_reply_select" },
  });
  const resolutionLoop = child.nodes.find(row => row.id === "pr_resolution_loop");
  assert.equal(resolutionLoop.max_iterations, 32);
  assert.equal(resolutionLoop.until, "session_pr_resolution_gate_met");
  const route = child.nodes.find(row => row.id === "pr_resolution_route");
  assert.equal(route.branches.find(row => row.flow_id === "observed").node_id, "pr_review_effects_verify");
  assert.equal(route.branches.find(row => row.flow_id === "exception").node_id, "pr_resolution_exception");
  const exception = assets.catalog.bindings.find(row => row.node_id === "pr_resolution_exception");
  assert.deepEqual(exception.model_ref, identity);
  assert.equal(exception.binding.id, "session_pr_review_resolution_exception");
  assert.equal(exception.binding.effect_class, "read-only");
  assert.equal(exception.binding.executor_kind, "human");
  assert.deepEqual(exception.binding.allowed_modes, ["COMMITTING"]);
  assert.deepEqual(child.data_bindings.inputs.find(row => row.node_id === "pr_resolution_exception").fields, {
    contract_version: { source: "literal", value: "standard-pr-review-resolution-exception-input.v1" },
    triage_operation_id: { source: "parameter", key: "triage_operation_id", path: [] },
    selection_operation_id: { source: "operation_id", node_id: "pr_resolution_select" },
  });
  const resolve = assets.catalog.bindings.find(row => row.node_id === "pr_thread_resolve");
  assert.deepEqual(resolve.model_ref, identity);
  assert.equal(resolve.binding.id, "session_pr_review_thread_resolve");
  assert.equal(resolve.binding.effect_class, "executor");
  assert.equal(resolve.binding.executor_kind, "deterministic");
  assert.deepEqual(resolve.binding.allowed_modes, ["COMMITTING"]);
  assert.deepEqual(resolve.binding.rule_refs, ["SPEC-R08", "SPEC-R11"]);
  assert.equal(child.operation_pins[resolve.binding.id], shadowHash(resolve.binding));
  assert.deepEqual(child.data_bindings.inputs.find(row => row.node_id === "pr_thread_resolve").fields, {
    contract_version: { source: "literal", value: "standard-pr-review-thread-resolve-input.v1" },
    triage_operation_id: { source: "parameter", key: "triage_operation_id", path: [] },
    selection_operation_id: { source: "operation_id", node_id: "pr_resolution_select" },
  });
  for (const [node_id, id, contract, rule_refs] of [
    ["pr_resolution_select", "session_pr_review_resolution_select", "standard-pr-review-resolution-select-input.v1", ["SPEC-R08", "SPEC-R11"]],
    ["pr_reply_select", "session_pr_review_reply_select", "standard-pr-review-reply-select-input.v1", ["SPEC-R08", "SPEC-R11"]],
    ["pr_review_effects_verify", "session_pr_review_effects_verify", "standard-session-pr-review-effects-input.v1", ["SPEC-R08", "SPEC-R11"]],
    ["pr_premerge_observe", "session_pr_premerge_observe", "standard-session-pr-merge-observe-input.v2", ["SPEC-R08", "SPEC-R09"]],
    ["pr_checks_accept", "session_pr_checks_accept", "standard-pr-checks-accept-input.v2", ["SPEC-R08", "SPEC-R11"]],
  ]) {
    const row = assets.catalog.bindings.find(row => row.node_id === node_id);
    assert.deepEqual(row.model_ref, identity);
    assert.equal(row.binding.id, id);
    assert.equal(row.binding.effect_class, "read-only");
    assert.equal(row.binding.executor_kind, "deterministic");
    assert.deepEqual(row.binding.rule_refs, rule_refs);
    assert.equal(child.operation_pins[id], shadowHash(row.binding));
    assert.deepEqual(child.data_bindings.inputs.find(row => row.node_id === node_id).fields, {
      contract_version: { source: "literal", value: contract },
      triage_operation_id: { source: "parameter", key: "triage_operation_id", path: [] },
    });
  }
  for (const id of ["pr_premerge_external_delivery", "pr_external_delivery"]) {
    const disposition = assets.catalog.bindings.find(row => row.node_id === id);
    assert.equal(disposition.binding.id, "session_pr_external_merge_disposition");
    assert.equal(disposition.binding.executor_kind, "human");
    assert.equal(disposition.binding.effect_class, "read-only");
    assert.deepEqual(disposition.binding.rule_refs, ["SPEC-R08", "SPEC-R09", "SPEC-R10"]);
  }
  const consent = assets.catalog.bindings.find(row => row.node_id === "pr_merge_consent");
  assert.equal(consent.binding.id, "session_pr_merge_consent");
  assert.equal(consent.binding.effect_class, "read-only");
  assert.equal(consent.binding.executor_kind, "human");
  assert.equal(child.operation_pins[consent.binding.id], shadowHash(consent.binding));
  assert.deepEqual(child.data_bindings.inputs.find(row => row.node_id === "pr_merge_consent").fields, {
    contract_version: { source: "literal", value: "standard-pr-merge-consent-input.v1" },
    triage_operation_id: { source: "parameter", key: "triage_operation_id", path: [] },
    checks_operation_id: { source: "operation_id", node_id: "pr_checks_accept" },
  });
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
});

test("ordinary correction request uses the human executor after its accepted checkpoint", () => {
  const binding = assets.catalog.bindings.find(row => row.node_id === "session_pr_correction_decide").binding;
  assert.equal(binding.executor_kind, "human"); assert.equal(binding.effect_class, "read-only"); assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_correction_decide").fields,
    { contract_version: { source: "literal", value: "standard-pr-correction-review-input.v3" }, checkpoint_operation_id: { source: "operation_id", node_id: "session_pr_correction_checkpoint" } });
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
});

test("successor checkpoint and update follow the accepted canonical PR record with explicit inputs", () => {
  const children = committingSteps();
  assert.equal(children.indexOf("session_pr_checkpoint"), children.indexOf("session_pr_record") + 1);
  assert.equal(children.indexOf("session_pr_update_push"), children.indexOf("session_pr_checkpoint") + 1);
  for (const id of ["session_pr_checkpoint", "session_pr_update_push"]) assert.equal(assets.catalog.bindings.find(row => row.node_id === id).binding.executor_kind, "deterministic");
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_checkpoint").fields.record_operation_id, { source: "operation_id", node_id: "session_pr_record" });
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_update_push").fields.checkpoint_operation_id, { source: "operation_id", node_id: "session_pr_checkpoint" });
});
test("canonical PR lifecycle recording follows its authenticated open receipt and leaves checkpoint separate", () => {
  const binding = assets.catalog.bindings.find(row => row.node_id === "session_pr_record").binding;
  assert.equal(binding.executor_kind, "deterministic"); assert.equal(binding.effect_class, "mutating");
  const children = committingSteps();
  assert.equal(children.indexOf("session_pr_record"), children.indexOf("session_pr_open") + 1);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_record").fields.open_operation_id,
    { source: "operation_id", node_id: "session_pr_open" });
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
});

test("PR creation/recovery follows confirmed push through an independent host transport", () => {
  const binding = assets.catalog.bindings.find(row => row.node_id === "session_pr_open").binding;
  assert.equal(binding.executor_kind, "deterministic"); assert.equal(binding.effect_class, "executor");
  assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  const children = committingSteps();
  assert.equal(children.indexOf("session_pr_open"), children.indexOf("session_push") + 1);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_open").fields.push_operation_id,
    { source: "operation_id", node_id: "session_push" });
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
});

test("session push is a separate exact-plan effect after read-only admission, with host-owned transport", () => {
  const binding = assets.catalog.bindings.find(row => row.node_id === "session_push").binding;
  assert.equal(binding.executor_kind, "deterministic"); assert.equal(binding.effect_class, "executor");
  assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  const children = committingSteps();
  assert.equal(children.indexOf("session_push"), children.indexOf("session_pr_admit") + 1);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_push").fields.admission_operation_id,
    { source: "operation_id", node_id: "session_pr_admit" });
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
});

test("session close admission is a deterministic read-only continuation, separate from closure", () => {
  const node = assets.model.nodes.find(row => row.id === "session_close_admit");
  const binding = assets.catalog.bindings.find(row => row.node_id === node.id).binding;
  assert.equal(node.kind, "operation"); assert.equal(binding.skill_id, "close-session"); assert.equal(binding.effect_class, "read-only");
  assert.equal(binding.input_contract, "standard-session-reference-input.v1"); assert.equal(binding.output_contract, "standard-session-close-admission-output.v1");
  const children = committingSteps();
  assert.equal(children.indexOf("session_preclose_checkpoint"), children.indexOf("promotion_eligibility") + 1);
  assert.equal(children.indexOf("session_close_admit"), children.indexOf("session_preclose_checkpoint") + 1);
  assert.ok(assets.catalog.scope.remaining_activities.includes("session_close"));
});
test("preclose checkpoint is a granted deterministic Git effect before session admission and R05", () => {
  const binding = assets.catalog.bindings.find(row => row.node_id === "session_preclose_checkpoint").binding;
  assert.equal(binding.effect_class, "mutating"); assert.equal(binding.executor_kind, "deterministic");
  assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  assert.equal(binding.input_contract, "standard-session-preclose-checkpoint-input.v1");
  assert.equal(binding.output_contract, "standard-session-preclose-checkpoint-output.v1");
  const fields = assets.model.data_bindings.inputs.find(row => row.node_id === "session_preclose_checkpoint").fields;
  assert.deepEqual(fields.closure_operation_id, { source: "operation_output", node_id: "close_completed_select", path: ["observations", "closure_operation_id"] });
});
test("delivery checkpoint follows confirmed session finalization with no implied integration or PR", () => {
  const binding = assets.catalog.bindings.find(row => row.node_id === "session_delivery_checkpoint").binding;
  assert.equal(binding.executor_kind, "deterministic"); assert.equal(binding.effect_class, "mutating");
  assert.equal(binding.input_contract, "standard-session-delivery-checkpoint-input.v1");
  const children = committingSteps();
  assert.equal(children.indexOf("session_delivery_checkpoint"), children.indexOf("session_close_finalize") + 1);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_delivery_checkpoint").fields.finalization_operation_id,
    { source: "operation_id", node_id: "session_close_finalize" });
});
test("local integration has a separate explicit human subject and deterministic Git effect after delivery", () => {
  const children = committingSteps();
  assert.equal(children.indexOf("session_branch_integration_decide"), children.indexOf("session_delivery_checkpoint") + 1);
  assert.equal(children.indexOf("session_branch_integrate"), children.indexOf("session_branch_integration_decide") + 1);
  const human = assets.catalog.bindings.find(row => row.node_id === "session_branch_integration_decide").binding;
  const effect = assets.catalog.bindings.find(row => row.node_id === "session_branch_integrate").binding;
  assert.equal(human.executor_kind, "human"); assert.equal(human.effect_class, "read-only");
  assert.equal(effect.executor_kind, "deterministic"); assert.equal(effect.effect_class, "mutating");
  assert.equal(human.skill_id, "pr-orchestrate"); assert.equal(effect.skill_id, "pr-orchestrate");
  assert.deepEqual(human.allowed_modes, ["COMMITTING"]); assert.deepEqual(effect.allowed_modes, ["COMMITTING"]);
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_branch_integrate").fields.decision_operation_id,
    { source: "operation_id", node_id: "session_branch_integration_decide" });
});
test("PR admission is a read-only re-anchor after the separately confirmed Git integration", () => {
  const children = committingSteps();
  assert.equal(children.indexOf("session_pr_admit"), children.indexOf("session_branch_integrate") + 1);
  const binding = assets.catalog.bindings.find(row => row.node_id === "session_pr_admit").binding;
  assert.equal(binding.effect_class, "read-only"); assert.equal(binding.executor_kind, "deterministic");
  assert.deepEqual(binding.allowed_modes, ["COMMITTING"]); assert.equal(binding.skill_id, "pr-orchestrate");
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === "session_pr_admit").fields.integration_operation_id,
    { source: "operation_id", node_id: "session_branch_integrate" });
});

test("corrective redelivery and review select fresh integration, cycle and update occurrences", () => {
  const fields = id => assets.model.data_bindings.inputs.find(row => row.node_id === id).fields;
  assert.equal(assets.model.nodes.find(row => row.id === "correction_pr_redelivery_push").binding_ref, "session_pr_redelivery_push");
  assert.deepEqual(fields("correction_pr_redelivery_push").integration_operation_id, { source: "operation_id", node_id: "correction_session_branch_integrate" });
  assert.deepEqual(fields("correction_pr_redelivery_push").cycle_operation_id, { source: "operation_id", node_id: "correction_initialize" });
  for (const id of ["correction_pr_review_observe", "correction_pr_review_receive"])
    assert.deepEqual(fields(id).update_operation_id, { source: "operation_id", node_id: "correction_pr_redelivery_push" });
  assert.deepEqual(fields("correction_pr_triage_select").received_operation_id, { source: "operation_id", node_id: "correction_pr_review_receive" });
  assert.deepEqual(fields("correction_pr_triage").selection_operation_id, { source: "operation_id", node_id: "correction_pr_triage_select" });
  assert.deepEqual(fields("correction_pr_triage_evaluate").report_occurrence_id, { source: "occurrence_id", node_id: "correction_pr_triage" });
});
test("the published recovery call routes confirmed findings to the selected CR, checkpoint or rollback port", () => {
  for (const contract of ["standard-drift-recovery-cycle-selection-input.v1", "standard-drift-recovery-cycle-subject.v1",
    "standard-drift-recovery-cycle-question.v1", "standard-drift-recovery-cycle-question.v2", "human-drift-recovery-cycle-decision.v1",
    "standard-drift-recovery-cycle-selection-output.v1", "process-decision-inbox.v17",
    "standard-drift-rollback-input.v1", "standard-drift-rollback-plan.v1", "standard-drift-rollback-output.v1"]) {
    const schema = JSON.parse(read(`src/core/contracts/workflow-definition/${contract}.schema.json`));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  const site = assets.model.nodes.find(node => node.id === "closure_drift_recovery_execution");
  const { model, ...identity } = assets.model.call_targets.find(row => row.model_id === "aidn-standard-drift-recovery");
  assert.deepEqual(site.target, identity);
  assert.deepEqual(assets.model.nodes.find(node => node.id === "closure_drift_recovery_route").branches[0],
    { flow_id: "recovery", node_id: site.id, condition: "drift_recovery_chosen" });
  assert.deepEqual(assets.model.data_bindings.inputs.find(row => row.node_id === site.id).fields,
    { decision_operation_id: { source: "operation_id", node_id: "closure_drift_review" } });
  const H = "a".repeat(64), decision = "decision-fixture";
  for (const choice of ["requirements_delta", "new_cycle", "rollback"]) {
    const instance = createAgenticProcess({ instanceId: "drift-recovery-fixture", scopeId: "fixture", model,
      policyPins: agenticPolicyPins(model), parameters: { decision_operation_id: decision } });
    const cursor = inspectAgenticProcess(instance);
    const recovery = cursor.occurrences.find(row => row.node_id === "recovery_record");
    assert.equal(resolveProcessFrameInput({ instance, cursor, occurrenceId: recovery.occurrence_id }).input.decision_operation_id, decision);
    const intent = { contract_version: "process-operation-intent.v1", operation_id: "recovery-fixture",
      binding_ref: "drift_recovery_record", binding_sha256: model.operation_pins.drift_recovery_record,
      input_sha256: H, preconditions_sha256: H, authorization_sha256: null, authority_id: "fixture",
      scope_id: instance.scope_id, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
      model_sha256: instance.model_sha256, occurrence_id: recovery.occurrence_id, instance_revision: instance.revision };
    const staged = advanceAgenticProcess(instance, { event_id: "intent", kind: "operation_intent", occurrence_id: recovery.occurrence_id, intent });
    const facts = { drift_recovery_recorded: true, drift_recovery_requirements_delta: choice === "requirements_delta",
      drift_recovery_new_cycle: choice === "new_cycle", drift_recovery_rollback: choice === "rollback",
      drift_recovery_required: true, drift_check_completed: false };
    const accepted = advanceAgenticProcess(staged, { event_id: "result", kind: "operation_result", occurrence_id: recovery.occurrence_id,
      receipt: { contract_version: "process-operation-receipt.v1", receipt_id: "recovery-receipt", operation_id: intent.operation_id,
        intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome: "completed", effect_status: "confirmed",
        output_sha256: H, facts, evidence_refs: [{ ref: "fixture/recovery", sha256: H }] } });
    const after = inspectAgenticProcess(accepted), cr = after.occurrences.find(row => row.node_id === "change_request_record");
    if (choice === "requirements_delta") {
      assert.equal(cr.status, "READY");
      assert.equal(resolveProcessFrameInput({ instance: accepted, cursor: after, occurrenceId: cr.occurrence_id }).input.recovery_record_operation_id,
        intent.operation_id);
    } else if (choice === "new_cycle") {
      assert.equal(cr, undefined);
      const refresh = after.occurrences.find(row => row.node_id === "recovery_context_refresh");
      assert.equal(refresh.status, "READY");
      assert.equal(resolveProcessFrameInput({ instance: accepted, cursor: after, occurrenceId: refresh.occurrence_id }).input.recovery_operation_id,
        intent.operation_id);
      assert.deepEqual(model.data_bindings.inputs.find(row => row.node_id === "recovery_checkpoint_observe").fields.context_operation_id,
        { source: "operation_id", node_id: "recovery_context_refresh" });
      assert.equal(model.nodes.find(row => row.id === "recovery_cycle_decide").binding_ref, "drift_recovery_cycle_decision");
      assert.deepEqual(model.data_bindings.inputs.find(row => row.node_id === "recovery_cycle_decide").fields.checkpoint_operation_id,
        { source: "operation_id", node_id: "recovery_checkpoint_observe" });
      const fields = model.data_bindings.inputs.find(row => row.node_id === "recovery_cycle_initialize").fields;
      assert.deepEqual(fields.checkpoint_operation_id, { source: "operation_id", node_id: "recovery_checkpoint_observe" });
      for (const key of ["cycle_id", "cycle_type", "title"]) assert.deepEqual(fields[key],
        { source: "operation_output", node_id: "recovery_cycle_decide", path: ["observations", "selected_cycle", key] });
    } else {
      assert.equal(cr, undefined);
      const rollback = after.occurrences.find(row => row.node_id === "scope_rollback");
      assert.equal(rollback.status, "READY");
      assert.equal(resolveProcessFrameInput({ instance: accepted, cursor: after, occurrenceId: rollback.occurrence_id }).input.recovery_record_operation_id,
        intent.operation_id);
    }
  }
});
test("completion of this component cannot claim completion of the standard workflow", () => {
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
  assert.ok(assets.catalog.scope.entry_conditions.includes("fresh_or_existing_session_admission"));
  assert.equal(assets.catalog.scope.remaining_activities.includes("existing_session_resume"), false);
  for (const id of ["thinking_session_closure", "exploring_experiments_and_spike_conversion", "cycle_choice_and_carryover",
    "startup_and_work_drift_routes", "incidents_and_recovery", "session_close", "pr_review_and_merge", "post_merge_sync", "full_mixed_resume"])
    assert.ok(assets.catalog.scope.remaining_activities.includes(id));
});
reject("changing the graph order cannot retain its source identity", x => x.model.nodes.find(row => row.id === "committing").children.reverse(), "PROCESS_INPUT_SOURCE_NOT_ORDERED");
reject("the partial catalog cannot be relabeled as complete", x => { x.catalog.scope.complete_standard_workflow = true; }, "STANDARD_STARTUP_CATALOG_INVALID");
reject("native activities cannot disappear from the provenance catalog", x => { x.catalog.activities.pop(); }, "STANDARD_ACTIVITY_COVERAGE_INVALID");
reject("duplicate native activity identities are rejected", x => { x.catalog.activities[1].node_id = x.catalog.activities[0].node_id; }, "STANDARD_ACTIVITY_COVERAGE_INVALID");
reject("a domain implementation activity cannot acquire an invented governance skill", x => { x.catalog.activities[1].skill_sources.push(x.catalog.activities[0].skill_sources[0]); }, "STANDARD_ACTIVITY_BINDING_INVALID");
reject("a native activity must reference actual current SPEC rules", x => { x.catalog.activities[0].rule_refs = ["SPEC-R99"]; }, "STANDARD_STARTUP_CATALOG_INVALID");
reject("native skill bytes cannot be changed behind the source descriptor", x => { x.catalog.activities[0].skill_sources[0].sha256 = "0".repeat(64); }, "STANDARD_ACTIVITY_SKILL_CHANGED");
reject("an operation's changed implementation is rejected rather than repaired", x => {
  const selected = x.bindings.find(binding => binding.id === x.catalog.bindings[0].binding.id);
  assert.ok(selected); selected.implementation_sha256 = "0".repeat(64);
}, "STANDARD_STARTUP_IMPLEMENTATION_CHANGED");
test("native configuration must use exactly the declared typed activity reports", () => {
  const outputs = Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, row.output_contract]));
  assertStandardWorkflowActivityOutputs(assets.source, assets.model, outputs);
  assert.throws(() => assertStandardWorkflowActivityOutputs(assets.source, assets.model, { ...outputs, implement: outputs.plan }), { code: "STANDARD_ACTIVITY_OUTPUT_CONTRACT_CHANGED" });
  assert.throws(() => assertStandardWorkflowActivityOutputs(assets.source, assets.model, { ...outputs, extra: outputs.plan }), { code: "STANDARD_ACTIVITY_OUTPUT_CONTRACT_CHANGED" });
});
// Substitute only the fixed package reads when exercising adversarial assets.
function loadFixture({ catalog, model }) {
  const original = fs.readFileSync;
  const overrides = new Map([[STANDARD_WORKFLOW_CATALOG_PATH, catalog], [STANDARD_WORKFLOW_MODEL_PATH, model]]
    .map(([name, value]) => [new URL(name, root).href, Buffer.from(JSON.stringify(value))]));
  fs.readFileSync = (file, ...args) => overrides.get(String(file)) ?? Reflect.apply(original, fs, [file, ...args]);
  try { return loadStandardWorkflowAssets(); }
  finally { fs.readFileSync = original; }
}
function reauthorTarget({ catalog, model }, change) {
  const [previous] = model.call_targets, target = previous.model;
  change(target);
  const identity = processModelIdentity(target);
  model.call_targets[0] = { ...identity, model: target };
  for (const node of model.nodes) if (node.target?.model_id === previous.model_id) node.target = identity;
  for (const row of catalog.bindings) if (row.model_ref?.model_id === previous.model_id) row.model_ref = identity;
  catalog.model.sha256 = shadowHash(model);
}
const targetRow = input => input.catalog.bindings.find(row => row.model_ref);
test("the composed entry reuses authored session setup and rereads canonical mode in the root", () => {
  const startup = loadStandardWorkflowStartupAssets().model;
  const setup = assets.model.call_targets.find(target => target.model_id === "aidn-standard-session-setup");
  assert.ok(setup); assert.deepEqual(assets.model.nodes.find(node => node.id === assets.model.entry).children.slice(0, 5),
    ["context_reload", "session_setup", "session_admit", "mode_preflight", "session_start_finalize"]);
  const expected = structuredClone(startup.nodes).filter(node => !["context_reload", "session_start_finalize"].includes(node.id));
  const entry = expected.find(node => node.id === "startup"); entry.id = "session_setup";
  entry.children = entry.children.filter(id => !["context_reload", "session_start_finalize"].includes(id));
  assert.deepEqual(setup.model.nodes, expected);
  assert.equal(assets.model.nodes.find(node => node.id === "session_admit").binding_ref, "session_entry_admit");
  assert.equal(assets.model.nodes.some(node => node.id === "session_initialize"), false);
  assert.equal(assets.model.data_bindings.inputs.some(input => Object.values(input.fields).some(field =>
    field.source === "operation_input" && field.node_id === "session_initialize")), false);
});
const legacyCatalogScope = (catalog, version) => {
  catalog.contract_version = "standard-workflow-catalog.v" + version;
  catalog.scope.entry_conditions = ["fresh_session_admission", "single_new_cycle"];
};
const rejectFixture = (name, change, code) => test(name, () => {
  const input = fresh();
  change(input);
  const before = shadowHash({ catalog: input.catalog, model: input.model });
  assert.throws(() => loadFixture(input), { code });
  assert.equal(shadowHash({ catalog: input.catalog, model: input.model }), before);
});
test("both analysis modes call the same closure suffix after their own R05 observations", () => {
  const target = assets.model.call_targets.find(row => row.model_id === "aidn-standard-mode-session-closure");
  assert.ok(target);
  assert.deepEqual(target.model.nodes.map(row => row.kind === "operation" ? row.binding_ref : row.kind),
    ["sequence", "session_closure_decision", "session_close_record", "session_close_checkpoint", "session_close_finalize"]);
  assert.deepEqual(target.model.call_interface.returns, {});
  const parameters = ["admission_operation_id", "drift_evaluation_operation_id", "drift_finalization_operation_id"];
  assert.deepEqual(target.model.call_interface.parameters, Object.fromEntries(parameters.map(key => [key, "string"])));
  for (const prefix of ["thinking", "exploring"]) {
    const call = assets.model.nodes.find(row => row.id === prefix + "_session_closure");
    assert.equal(call.kind, "call"); assert.deepEqual(call.target, processModelIdentity(target.model));
    const fields = assets.model.data_bindings.inputs.find(row => row.node_id === call.id).fields;
    for (const [key, source] of [["admission_operation_id", "session_close_admit"], ["drift_evaluation_operation_id", "session_closure_drift_evaluate"], ["drift_finalization_operation_id", "session_closure_drift_finalize"]])
      assert.deepEqual(fields[key], { source: "operation_id", node_id: prefix + "_" + source });
    assert.equal(assets.model.nodes.find(row => row.id === prefix + "_session_closure_drift_report").kind, "activity");
  }
});

test("the ordinary loader authenticates the two final-verification operations for both calls", () => {
  assert.deepEqual(validateJsonSchemaDefinition(catalogSchemaV3, "#", { contractKind: "workflow-definition" }), []);
  assert.deepEqual(validateJsonSchemaDefinition(catalogSchemaV4, "#", { contractKind: "workflow-definition" }), []);
  const input = fresh(), loaded = assets;
  assert.equal(loaded.model.nodes.length, 248);
  assert.equal(loaded.catalog.bindings.filter(row => !row.model_ref).length, 140);
  assert.equal(loaded.catalog.bindings.filter(row => row.model_ref).length, 50);
  const [target] = loaded.model.call_targets, { model: child, ...identity } = target;
  assert.equal(loaded.model.call_targets.length, 8);
  assert.equal(child.model_id, "aidn-standard-final-verification");
  assert.deepEqual(identity, processModelIdentity(child));
  const sites = loaded.model.nodes.filter(node => node.target?.model_id === child.model_id);
  assert.deepEqual(sites.map(node => node.id), ["final_verification", "correction_final_verification"]);
  for (const site of sites) assert.deepEqual(site.target, identity);
  assert.deepEqual(child.nodes.map(node => node.id), ["final_verification", "final_validation", "verification_enter"]);
  assert.deepEqual(child.call_interface.returns, {});
  assert.deepEqual(loaded.model, input.model); assert.deepEqual(loaded.catalog, input.catalog);
  assert.ok(Object.isFrozen(loaded.model.call_targets[0].model.operation_pins));
  assert.deepEqual(loaded.catalog.activities, assets.catalog.activities);
  const outputs = Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, row.output_contract]));
  assertStandardWorkflowActivityOutputs(loaded.source, loaded.model, outputs);
  assert.throws(() => assertStandardWorkflowActivityOutputs(loaded.source, loaded.model, {}), { code: "STANDARD_ACTIVITY_OUTPUT_CONTRACT_CHANGED" });
  assert.deepEqual(refreshStandardWorkflowComponentBindings(input).changed, []);
  const binding = input.bindings.find(row => row.id === targetRow(input).binding.id);
  binding.implementation_sha256 = "f".repeat(64);
  assert.throws(() => refreshStandardWorkflowComponentBindings(input), { code: "STANDARD_EMBEDDED_PIN_REAUTHOR_REQUIRED" });
  assert.deepEqual(loaded.model, input.model); assert.deepEqual(loaded.catalog, input.catalog);
});
test("distinct pinned targets may share both local operation IDs", () => {
  const input = fresh(), { catalog, model } = input;
  const second = structuredClone(model.call_targets[0].model);
  second.model_id += "-alternate";
  const identity = processModelIdentity(second);
  model.call_targets.push({ ...identity, model: second });
  model.nodes.find(node => node.id === "correction_final_verification").target = identity;
  catalog.bindings.push(...catalog.bindings.filter(row => row.model_ref?.model_id === model.call_targets[0].model_id).map(row => ({ ...row, model_ref: identity })));
  catalog.model.sha256 = shadowHash(model);
  assert.equal(loadFixture(input).catalog.bindings.filter(row => row.model_ref && row.node_id === "final_validation").length, 2);
});
test("a target operation may share a root node ID while pinning a different binding", () => {
  const input = fresh(), row = targetRow(input);
  const localId = row.node_id, rootRow = input.catalog.bindings.find(row => row.node_id === "validate");
  assert.notEqual(row.binding.id, rootRow.binding.id);
  reauthorTarget(input, target => {
    target.nodes.find(node => node.id === localId).id = rootRow.node_id;
    target.nodes[0].children[0] = rootRow.node_id;
    target.data_bindings.inputs[0].node_id = rootRow.node_id;
    target.data_bindings.inputs[1].fields.evaluation_operation_id.node_id = rootRow.node_id;
  });
  row.node_id = rootRow.node_id;
  const matches = loadFixture(input).catalog.bindings.filter(row => row.node_id === rootRow.node_id);
  assert.deepEqual(matches.map(row => row.binding.id), [rootRow.binding.id, row.binding.id]);
});
for (const version of [1, 2]) test("catalog v" + version + " still retains exact root rows and activity contracts", () => {
  const input = fresh(), { catalog, model } = input;
  const [operation] = catalog.bindings, [activity] = catalog.activities;
  const children = [operation.node_id, activity.node_id];
  model.nodes = [{ id: model.entry, kind: "sequence", participant_ref: "project", children },
    ...model.nodes.filter(node => children.includes(node.id))];
  model.operation_pins = { [operation.binding.id]: model.operation_pins[operation.binding.id] };
  delete model.data_bindings;
  delete model.call_targets;
  legacyCatalogScope(catalog, version);
  catalog.bindings = [operation];
  catalog.activities = [activity];
  catalog.model.sha256 = shadowHash(model);
  const loaded = loadFixture(input);
  assert.deepEqual(loaded.source.catalog, catalog);
  assertStandardWorkflowActivityOutputs(loaded.source, loaded.model, { [activity.node_id]: activity.output_contract });
});
test("catalog v3 keeps its original fresh-only scope and embedded rows", () => {
  const input = fresh(); legacyCatalogScope(input.catalog, 3);
  assert.deepEqual(loadFixture(input).source.catalog, input.catalog);
});
rejectFixture("catalog v2 keeps its closed rows", x => { legacyCatalogScope(x.catalog, 2); }, "STANDARD_STARTUP_CATALOG_INVALID");
rejectFixture("legacy catalog rows cannot cover the embedded operations", x => {
  legacyCatalogScope(x.catalog, 2);
  for (const row of x.catalog.bindings) delete row.model_ref;
}, "STANDARD_STARTUP_COVERAGE_INVALID");
rejectFixture("historical rows do not cover the moved operations", x => {
  legacyCatalogScope(x.catalog, 2);
  const formerTargets = x.catalog.bindings.filter(row => row.model_ref);
  for (const row of formerTargets) delete row.model_ref;
  x.catalog.bindings.push(...formerTargets.map(row => ({ ...row, node_id: "correction_" + row.node_id })));
}, "STANDARD_STARTUP_COVERAGE_INVALID");
rejectFixture("a missing embedded row fails coverage", x => x.catalog.bindings.pop(), "STANDARD_STARTUP_COVERAGE_INVALID");
rejectFixture("an embedded row cannot replace a different row with a duplicate", x => {
  x.catalog.bindings[x.catalog.bindings.length - 1] = structuredClone(targetRow(x));
}, "STANDARD_STARTUP_COVERAGE_INVALID");
rejectFixture("an unqualified v3 row only addresses a root operation", x => { delete targetRow(x).model_ref; }, "STANDARD_STARTUP_BINDING_CHANGED");
for (const [field, value] of [["model_id", "unknown"], ["revision", assets.model.call_targets[0].revision + 1], ["model_sha256", "f".repeat(64)]])
  rejectFixture("an incorrect target " + field + " fails identity", x => {
    const row = targetRow(x); row.model_ref = { ...row.model_ref, [field]: value };
  }, "STANDARD_STARTUP_TARGET_CHANGED");
rejectFixture("a target reference cannot inject a path", x => {
  const row = targetRow(x); row.model_ref = { ...row.model_ref, path: "other.json" };
}, "STANDARD_STARTUP_CATALOG_INVALID");
rejectFixture("changed target bytes with a stale embedded reference are never repaired", x => {
  x.model.call_targets[0].model.revision++;
  x.catalog.model.sha256 = shadowHash(x.model);
}, "PROCESS_CALL_TARGET_CHANGED");
rejectFixture("a target operation must use its exact binding pin", x => {
  targetRow(x).binding.implementation_sha256 = "f".repeat(64);
}, "STANDARD_STARTUP_BINDING_CHANGED");
rejectFixture("a repinned target cannot override the implementation registry", x => {
  const binding = targetRow(x).binding;
  binding.implementation_sha256 = "f".repeat(64);
  reauthorTarget(x, target => { target.operation_pins[binding.id] = shadowHash(binding); });
}, "STANDARD_STARTUP_IMPLEMENTATION_CHANGED");
rejectFixture("an embedded operation must pin actual skill bytes", x => {
  targetRow(x).skill_source.sha256 = "f".repeat(64);
}, "STANDARD_STARTUP_SKILL_CHANGED");
rejectFixture("an embedded operation cannot redirect to a different skill", x => {
  targetRow(x).skill_source.path = "scaffold/codex/aidn-start-session/SKILL.md";
}, "STANDARD_STARTUP_BINDING_CHANGED");
rejectFixture("even a repinned target must cite an existing SPEC rule", x => {
  const binding = targetRow(x).binding;
  binding.rule_refs = ["SPEC-R99"];
  reauthorTarget(x, target => { target.operation_pins[binding.id] = shadowHash(binding); });
}, "STANDARD_STARTUP_RULE_MISSING");
rejectFixture("STANDARD refuses an embedded activity before resolving its output contract", x => {
  reauthorTarget(x, target => {
    const activity = structuredClone(x.model.nodes.find(node => node.kind === "activity"));
    target.roles = structuredClone(x.model.roles);
    target.policies = structuredClone(x.model.policies);
    target.nodes.push(activity);
    target.nodes[0].children.push(activity.id);
  });
}, "STANDARD_EMBEDDED_ACTIVITY_UNSUPPORTED");
rejectFixture("STANDARD v3 refuses a repinned embedded event before it can reach a control wait", x => {
  reauthorTarget(x, target => {
    const entry = target.nodes[0], participant_ref = entry.participant_ref;
    const id = "embedded_review_wait";
    const branches = [
      { flow_id: "review", node_id: "embedded_reviewed", event_key: "review_snapshot" },
      { flow_id: "checks", node_id: "embedded_checked", event_key: "checks_snapshot" },
    ];
    entry.children.push(id);
    target.nodes.push({ id, kind: "event", participant_ref, branches },
      ...branches.map(branch => ({ id: branch.node_id, kind: "sequence", participant_ref, children: [] })));
  });
}, "STANDARD_EMBEDDED_EVENT_UNSUPPORTED");
test("execution and simulation start the same model and reducer with the same durable identity", () => {
  const options = { instanceId: "standard-composition-fixture", model: assets.model, scopeId: "offline-composition", policyPins: agenticPolicyPins(assets.model), facts: {},
    parameters: { session: { session_id: "S900", session_branch: "session/example", objective: "Disposable composition qualification" },
      cycle: { cycle_id: "C900", cycle_type: "FEATURE", title: "Example", objective: "Example" } } };
  const instance = createAgenticProcess(options), cursor = inspectAgenticProcess(instance);
  const simulation = simulateAgenticProcess({ ...options, events: [] });
  assert.equal(simulation.trace.at(-1).instance_sha256, instance.instance_sha256);
  assert.equal(cursor.occurrences.find(row => row.status === "READY").node_id, "context_reload");
  assert.equal(instance.events.length, 0);
});
test("optional continuation is structural and requests no dummy context operation or native activity", () => {
  for (const id of ["task_continue", "promotion_not_requested"])
    assert.deepEqual(assets.model.nodes.find(row => row.id === id).children, []);
});
test("source authoring preview leaves the exact published JSON bytes unchanged", () => {
  const names = [STANDARD_WORKFLOW_MODEL_PATH, STANDARD_WORKFLOW_CATALOG_PATH], before = names.map(name => shadowHash([...read(name)]));
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("tools/author/build-standard-workflow-model.mjs", root))], { encoding: "utf8", windowsHide: true }));
  assert.equal(result.write, false); assert.deepEqual(names.map(name => shadowHash([...read(name)])), before);
  assert.equal(result.model_sha256, assets.source.model_sha256);
});
console.log(JSON.stringify({ status: "PASS", checks, scope: "offline-source-composition", application_ports: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: "NOT_COMPLETE" }));
