import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import assert from "node:assert/strict";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import questionSchema from "../../src/core/contracts/workflow-definition/standard-baseline-promotion-question.v1.schema.json" with { type: "json" };
import sourceSchema from "../../src/core/contracts/workflow-definition/human-baseline-promotion-decision.v1.schema.json" with { type: "json" };
import { assertBaselinePromotionQuestion, assertHumanBaselinePromotionDecision, observeHumanBaselinePromotionDecision,
  buildBaselinePromotionRequest, baselinePromotionChoices } from "../../src/core/workflow/standard-baseline-promotion-decision.mjs";
import { assertDecisionInbox, decisionInboxId } from "../../src/core/workflow/process-decision-inbox.mjs";
import inboxSchema from "../../src/core/contracts/workflow-definition/process-decision-inbox.v4.schema.json" with { type: "json" };
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
let checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
const sha = "a".repeat(64), op = "op_" + "b".repeat(40);
function question() { return { contract_version: "standard-baseline-promotion-question.v1", operation_id: op, instance_id: "fixture", scope_id: "scope",
  occurrence_id: "promotion:0", intent_sha256: sha, session_id: "S001", choices: [...baselinePromotionChoices],
  review: { session_id: "S001", cycle_id: "C001", cycle_path: "cycles/C001-build-example", closure_operation_id: "op_" + "c".repeat(40),
    closure_output_sha256: sha, context_sha256: sha, product_sha256: sha, baseline_sha256: sha, history_sha256: sha, current_version: "v0.1",
    evidence_refs: [{ ref: "closure/result", sha256: sha }] } }; }
function source(q, choice = "promote") { return { contract_version: "human-baseline-promotion-decision.v1", source_kind: "human", authority_id: "fixture_operator",
  source_event_id: "promotion:1", question_sha256: shadowHash(q), subject_sha256: shadowHash(q.review), choice, rationale: "Explicit fixture decision",
  promotion: choice === "promote" ? { version: "v0.2", summary: "Retained work" } : null, evidence_refs: [{ ref: "human/selection", sha256: sha }] }; }
test("closed question and source schemas use supported validation vocabulary", () => {
  for (const schema of [questionSchema, sourceSchema, inboxSchema]) assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
});
test("promotion choice constructs the existing typed request without completion or permission", () => {
  const q = question(), d = source(q), observation = observeHumanBaselinePromotionDecision({ question: q, decision: d });
  assert.equal(observation.outcome, "completed"); assert.equal(observation.effect_status, "no_effect"); assert.equal(observation.facts.baseline_promotion_requested, true);
  assert.equal(observation.facts.baseline_recorded, undefined); assert.equal(observation.facts.baseline_promotion_completed, undefined);
  const request = buildBaselinePromotionRequest(q, d); assert.equal(request.decision_operation_id, q.operation_id); assert.equal(request.closure_operation_id, q.review.closure_operation_id);
  assert.equal(request.product_sha256, q.review.product_sha256); assert.equal(request.version, d.promotion.version); assert.equal(request.evidence_refs.length, 2);
});
test("not requested is an explicit decision and never a promotion or end-of-workflow fact", () => {
  const q = question(), d = source(q, "not_requested"), observed = observeHumanBaselinePromotionDecision({ question: q, decision: d });
  assert.equal(observed.outcome, "completed"); assert.equal(observed.facts.baseline_promotion_requested, false); assert.equal(observed.facts.baseline_promotion_not_requested, true);
  assert.throws(() => buildBaselinePromotionRequest(q, d), { code: "PROCESS_PROMOTION_NOT_REQUESTED" });
});
test("refusal deferral and cancellation retain their outcomes and empty success facts", () => {
  const q = question(); for (const choice of ["refused", "deferred", "cancelled"]) {
    const d = source(q, choice), observed = observeHumanBaselinePromotionDecision({ question: q, decision: d });
    assert.equal(observed.outcome, choice === "refused" ? "rejected" : choice); assert.deepEqual(observed.facts, {});
    assert.throws(() => buildBaselinePromotionRequest(q, d), { code: "PROCESS_PROMOTION_NOT_REQUESTED" });
  }
});
test("source cannot supply promotion data for a non-promotion or omit it for a promotion", () => {
  const q = question(); for (const choice of baselinePromotionChoices) { const d = source(q, choice); d.promotion = choice === "promote" ? null : source(q).promotion;
    assert.throws(() => assertHumanBaselinePromotionDecision(d, q), { code: "PROCESS_PROMOTION_SOURCE_INVALID" }); }
});
test("human response binds exact question and reviewed closure state", () => {
  const q = question(); for (const key of ["question_sha256", "subject_sha256"]) { const d = source(q); d[key] = "f".repeat(64);
    assert.throws(() => assertHumanBaselinePromotionDecision(d, q), { code: "PROCESS_HUMAN_QUESTION_CHANGED" }); }
  const d = source(q); q.review.baseline_sha256 = "f".repeat(64); assert.throws(() => assertHumanBaselinePromotionDecision(d, q), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
});
test("foreign cycle/session, reordered choices and invented authority fields refuse", () => {
  for (const mutate of [q => q.review.cycle_id = "C002", q => q.review.session_id = "S002", q => q.choices.reverse(), q => q.authorized = true]) {
    const q = question(); mutate(q); assert.throws(() => assertBaselinePromotionQuestion(q), { code: "PROCESS_PROMOTION_QUESTION_INVALID" }); }
  const q = question(), d = source(q); d.authenticated = true; assert.throws(() => assertHumanBaselinePromotionDecision(d, q), { code: "PROCESS_PROMOTION_SOURCE_INVALID" });
});
test("empty decisions and duplicate evidence cannot create a request", () => {
  const q = question(); for (const mutate of [d => d.rationale = " ", d => d.promotion.summary = " ", d => d.evidence_refs.push(d.evidence_refs[0])]) {
    const d = source(q); mutate(d); assert.throws(() => assertHumanBaselinePromotionDecision(d, q), { code: "PROCESS_PROMOTION_SOURCE_INVALID" }); }
});
test("evidence merging preserves all refs, rejects conflicting hashes and never truncates overflow", () => {
  const q = question(); let d = source(q); d.evidence_refs = structuredClone(q.review.evidence_refs); assert.equal(buildBaselinePromotionRequest(q, d).evidence_refs.length, 1);
  d.evidence_refs[0].sha256 = "f".repeat(64); assert.throws(() => buildBaselinePromotionRequest(q, d), { code: "PROCESS_PROMOTION_EVIDENCE_CHANGED" });
  q.review.evidence_refs = Array.from({ length: 16 }, (_, i) => ({ ref: "closure/" + i, sha256: sha })); d = source(q);
  assert.throws(() => buildBaselinePromotionRequest(q, d), { code: "PROCESS_PROMOTION_EVIDENCE_LIMIT" });
});
test("v4 inbox binds the promotion source, event identity and acknowledgement without converting older records", () => {
  const q = question(), d = source(q), row = { contract_version: "process-decision-inbox.v4", inbox_id: decisionInboxId(d), operation_id: q.operation_id,
    source_ref: "fixture:promotion:1", source: d, phase: "reserved", receipt_sha256: null, key_id: sha, authentication: sha };
  assert.deepEqual(assertDecisionInbox(row), row); row.phase = "receipted"; row.receipt_sha256 = sha; assertDecisionInbox(row);
  row.receipt_sha256 = null; assert.throws(() => assertDecisionInbox(row), { code: "PROCESS_DECISION_INBOX_BINDING_CHANGED" });
  row.phase = "reserved"; row.inbox_id = "decision_" + "f".repeat(40); assert.throws(() => assertDecisionInbox(row), { code: "PROCESS_DECISION_INBOX_BINDING_CHANGED" });
});
test("a promotion source cannot enter a historical v1 v2 or v3 inbox", () => {
  const q = question(), d = source(q);
  for (const version of ["v1", "v2", "v3"]) assert.throws(() => assertDecisionInbox({ contract_version: "process-decision-inbox." + version,
    inbox_id: decisionInboxId(d), operation_id: q.operation_id, source_ref: "fixture:promotion:1", source: d,
    phase: "reserved", receipt_sha256: null, key_id: sha, authentication: sha }));
});
test("fixed registry separates human selection from deterministic baseline effects and accepts only identities", () => {
  const bindings = standardWorkflowOperationBindings(), human = bindings.find(row => row.id === "baseline_promotion_decision"), writer = bindings.find(row => row.id === "baseline_promotion_record");
  assert.equal(human.executor_kind, "human"); assert.equal(human.effect_class, "read-only"); assert.equal(writer.executor_kind, "deterministic"); assert.equal(writer.effect_class, "mutating");
  assert.equal(human.skill_id, "promote-baseline"); assert.deepEqual(human.allowed_modes, ["COMMITTING"]);
  const input = { contract_version: "standard-baseline-promotion-review-input.v1", closure_operation_id: "op_" + "c".repeat(40) };
  assertStandardOperationInput(human.id, input); assertStandardOperationInput(writer.id, { decision_operation_id: op });
  for (const extra of [{ authorized: true }, { source_module: "arbitrary.mjs" }, { version: "v9.9" }]) assert.throws(() => assertStandardOperationInput(human.id, { ...input, ...extra }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
});
console.log(JSON.stringify({ status: "PASS", checks, proof: "pure-promotion-decision-data", human_authentication: "NOT_RUN",
  actual_closure: "NOT_RUN", application_effects: "NOT_RUN", full_standard_model: "NOT_COMPLETE", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
