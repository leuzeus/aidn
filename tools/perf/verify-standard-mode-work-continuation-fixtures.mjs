import assert from "node:assert/strict";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { observeModeWorkReport, assertModeWorkObservationOutput, assertModeWorkQuestion, assertHumanModeWorkDecision, observeHumanModeWorkDecision, assertModeWorkDecisionOutput } from "../../src/core/workflow/standard-mode-work-continuation.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { assertDecisionInbox, decisionInboxId } from "../../src/core/workflow/process-decision-inbox.mjs";
const H = "a".repeat(64), reference = { ref: "fixture:native-result", sha256: H };
let checks = 0;
const check = (name, run) => { run(); checks++; console.log("PASS " + name); };
const produce = (mode, disposition) => {
  const context = { session_id: "S001", mode, objective: "Understand the current observation", product_sha256: H,
    git: { head: "b".repeat(40), branch: "S001-analysis" }, preflight_operation_id: "op_" + "b".repeat(40) };
  const current = { context, context_sha256: shadowHash(context), evidence_refs: [reference] };
  const report = { contract_version: "standard-mode-work-report.v1", context_sha256: current.context_sha256, mode, objective: context.objective,
    disposition, findings: ["Observed bounded behavior"], rationale: "Explicit fixture reasoning", evidence_refs: [reference] };
  return observeModeWorkReport({ report, reference, producer: { instance_id: "instance", model_sha256: H, occurrence_id: "root/analysis", result_id: "result-one" } }, current);
};
for (const [mode, dispositions] of [["THINKING", ["waiting", "thinking_complete"]], ["EXPLORING", ["waiting", "retain_requested", "nonretained"]]]) {
  for (const disposition of dispositions) check(`${mode}/${disposition} report observation preserves the original evaluation`, () => {
    const output = produce(mode, disposition); assertStandardOperationOutput(output);
    const complete = ["thinking_complete", "nonretained"].includes(disposition);
    assert.equal(output.facts.mode_analysis_completed, false); assert.equal(output.facts.mode_work_report_complete, complete);
    assert.equal(output.observations.evaluation.outcome, complete ? "completed" : "blocked");
    if (!complete) assert.deepEqual(output.observations.evaluation.facts, {});
    const forged = structuredClone(output); forged.facts.mode_analysis_completed = true;
    assert.throws(() => assertModeWorkObservationOutput(forged), { code: "STANDARD_MODE_WORK_OBSERVATION_INVALID" });
  });
  const review = produce(mode, "waiting").observations.review;
  const question = { contract_version: "standard-mode-work-question.v1", operation_id: "op_" + "c".repeat(40), instance_id: "instance", scope_id: "fixture",
    occurrence_id: "root/decide", intent_sha256: H, session_id: "S001", review_operation_id: "op_" + "d".repeat(40), review,
    choices: ["continue_analysis", "refused", "deferred", "cancelled"] };
  assertModeWorkQuestion(question);
  const makeSource = choice => ({ contract_version: "human-mode-work-decision.v1", source_kind: "human", authority_id: "fixture_user",
    source_event_id: "fresh-event-" + choice, question_sha256: shadowHash(question), subject_sha256: shadowHash(review), choice,
    rationale: "Explicit fixture continuation decision", evidence_refs: [reference] });
  for (const choice of question.choices) check(`${mode}/${choice} has explicit outcome without analysis completion or Native renewal`, () => {
    const source = makeSource(choice), observed = observeHumanModeWorkDecision({ question, decision: source });
    const output = { contract_version: "standard-mode-work-decision-output.v1", operation_ref: "mode_work_continue_decision", ...observed,
      observations: { ...observed.observations, inbox_id: decisionInboxId(source), source_ref: "fixture:decision" }, evidence_refs: [reference] };
    assertModeWorkDecisionOutput(output); assertStandardOperationOutput(output);
    assert.equal(output.observations.native_authority_renewed, false);
    if (choice !== "continue_analysis") assert.deepEqual(output.facts, {});
    const inbox = { contract_version: "process-decision-inbox.v10", inbox_id: decisionInboxId(source), operation_id: question.operation_id,
      source_ref: "fixture:decision", source, phase: "reserved", receipt_sha256: null, key_id: H, authentication: H };
    assertDecisionInbox(inbox);
    assert.throws(() => assertDecisionInbox({ ...inbox, phase: "receipted" }), { code: "PROCESS_DECISION_INBOX_BINDING_CHANGED" });
    assert.throws(() => assertStandardOperationOutput({ ...output, facts: { mode_analysis_completed: true } }), { code: "STANDARD_MODE_WORK_DECISION_OUTPUT_INVALID" });
  });
  check(`${mode} wrong question, subject, branch/head and unsupported retention refuse`, () => {
    for (const change of [{ question_sha256: "e".repeat(64) }, { subject_sha256: "e".repeat(64) }])
      assert.throws(() => assertHumanModeWorkDecision({ ...makeSource("continue_analysis"), ...change }, question), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
    const changed = structuredClone(question); changed.review.head = "f".repeat(40);
    assert.throws(() => assertHumanModeWorkDecision(makeSource("continue_analysis"), changed), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
    assert.throws(() => assertHumanModeWorkDecision(makeSource("retain"), question), { code: "STANDARD_MODE_WORK_DECISION_INVALID" });
    const fabricated = structuredClone(question); fabricated.review.report.disposition = mode === "THINKING" ? "thinking_complete" : "nonretained";
    fabricated.review.report_sha256 = shadowHash(fabricated.review.report);
    assert.throws(() => assertModeWorkQuestion(fabricated), { code: "STANDARD_MODE_WORK_QUESTION_INVALID" });
  });
}
check("new operations use closed input contracts", () => {
  assertStandardOperationInput("mode_work_observe", { report_occurrence_id: "root/analysis" });
  assertStandardOperationInput("mode_work_continue_decision", { review_operation_id: "op_" + "a".repeat(40) });
  assert.throws(() => assertStandardOperationInput("mode_work_continue_decision", { report_occurrence_id: "root/analysis" }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
});
console.log(JSON.stringify({ status: "PASS", checks, proof_class: "offline-contracts", native_human_real: "NOT_RUN", complete_standard_workflow: false }));
