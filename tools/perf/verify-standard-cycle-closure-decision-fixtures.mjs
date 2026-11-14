import assert from "node:assert/strict";
import fs from "node:fs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertCycleClosureQuestion, assertHumanCycleClosureDecision, observeHumanCycleClosureDecision } from "../../src/core/workflow/standard-cycle-closure-decision.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
const h = "a".repeat(64), op = "op_" + "b".repeat(40);
const question = { contract_version: "standard-cycle-closure-question.v1", operation_id: op, instance_id: "closure_fixture", scope_id: "fixture", occurrence_id: "root/closure", intent_sha256: h,
  session_id: "S001", review: { session_id: "S001", cycle_id: "C001", audit_operation_id: op, audit_output_sha256: h, report_sha256: h,
    context_sha256: h, product_sha256: h, scope_sha256: h, work_complete: true, findings: [],
    pending: { requirements: [], usages: [], documents: [], tests: [], blocking_findings: [], risk_findings_requiring_human_decision: [] } },
  choices: ["retain", "no_go", "drop", "refused", "deferred", "cancelled"] };
function claim(q = question, choice = "retain") {
  return { contract_version: "human-cycle-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "event:001",
    subject_sha256: shadowHash(q.review), question_sha256: shadowHash(q), choice, rationale: "Explicit choice bound to the complete prepared review",
    risk_acceptances: [], evidence_refs: [{ ref: "fixture:human-choice", sha256: h }] };
}
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
for (const name of ["standard-cycle-closure-question.v1", "human-cycle-closure-decision.v1", "standard-cycle-closure-review.v1", "standard-cycle-closure-review-plan.v1", "standard-cycle-closure-review-input.v1", "standard-cycle-closure-decision-output.v1", "process-decision-inbox.v3"]) {
  const definition = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(definition, "#", { contractKind: "workflow-definition" }), []);
}
assertCycleClosureQuestion(question); const output = observeHumanCycleClosureDecision({ question, decision: claim() });
assert.equal(output.outcome, "completed"); assert.equal(output.effect_status, "no_effect"); assert.equal(output.facts.cycle_retention_requested, true);
assert.equal(output.facts.cycle_closed, undefined); assert.equal(output.observations.lifecycle_transition, "none"); assert.equal(output.observations.skill_completion, "pending");
pass("retention is an observed human request, never a completed cycle-close");
for (const [choice, outcome] of [["refused", "rejected"], ["deferred", "deferred"], ["cancelled", "cancelled"]]) {
  const observed = observeHumanCycleClosureDecision({ question, decision: claim(question, choice) });
  assert.equal(observed.outcome, outcome); assert.deepEqual(observed.facts, {}); assert.equal(observed.observations.lifecycle_transition, "none");
}
pass("refusal, deferral and cancellation preserve distinct outcomes with no success facts");
for (const choice of ["no_go", "drop"]) {
  const observed = observeHumanCycleClosureDecision({ question, decision: claim(question, choice) });
  assert.equal(observed.outcome, "completed"); assert.equal(observed.facts.cycle_retention_requested, false);
  assert.equal(observed.observations.skill_completion, "pending");
}
pass("non-retained choices do not imply promotion, terminal state or completed hook");
for (const key of ["requirements", "usages", "documents", "tests", "blocking_findings"]) {
  const q = structuredClone(question); q.review.pending[key].push(key === "usages" ? 1 : key === "blocking_findings" ? "FINDING-002" : "pending");
  if (key === "blocking_findings") q.review.findings.push({ id: "FINDING-002", category: "gap", severity: "blocking", rationale: "Blocking unresolved finding", evidence_refs: [{ ref: "fixture:blocker", sha256: h }] });
  assert.throws(() => assertCycleClosureQuestion(q)); q.choices.shift(); assertCycleClosureQuestion(q);
  assert.throws(() => assertHumanCycleClosureDecision(claim(q), q), { code: "PROCESS_HUMAN_CHOICE_NOT_OFFERED" });
  assertHumanCycleClosureDecision(claim(q, "no_go"), q);
}
const incomplete = structuredClone(question); incomplete.review.work_complete = false; assert.throws(() => assertCycleClosureQuestion(incomplete));
pass("unfinished work and every blocking coverage class prohibit offering retention");
const risky = structuredClone(question); risky.review.pending.risk_findings_requiring_human_decision.push("FINDING-001");
risky.review.findings.push({ id: "FINDING-001", category: "gap", severity: "risk", rationale: "The explicit residual risk that the operator must review", evidence_refs: [{ ref: "fixture:risk-detail", sha256: h }] });
const decision = claim(risky); assert.throws(() => assertHumanCycleClosureDecision(decision, risky), { code: "PROCESS_CLOSURE_RISK_DECISION_REQUIRED" });
decision.risk_acceptances.push({ finding_id: "FINDING-001", rationale: "Accept the bounded documented residual risk for this exact product" });
assertHumanCycleClosureDecision(decision, risky);
for (const mutation of [value => value.risk_acceptances.push(value.risk_acceptances[0]), value => value.risk_acceptances[0].finding_id = "FINDING-002", value => value.risk_acceptances[0].rationale = " "]) {
  const changed = structuredClone(decision); mutation(changed); assert.throws(() => assertHumanCycleClosureDecision(changed, risky));
}
const rejected = claim(risky, "refused"); rejected.risk_acceptances = decision.risk_acceptances;
assert.throws(() => assertHumanCycleClosureDecision(rejected, risky));
pass("risk acceptance is explicit, unique, justified and exact; declined decisions accept no risks");
for (const mutation of [q => q.review.product_sha256 = "b".repeat(64), q => q.review.report_sha256 = "b".repeat(64), q => q.operation_id = "op_" + "c".repeat(40), q => q.scope_id = "other", q => q.occurrence_id = "other"]) {
  const changed = structuredClone(question); mutation(changed); assert.throws(() => assertHumanCycleClosureDecision(claim(), changed), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
}
pass("product, report, operation, scope and occurrence changes invalidate the old decision");
for (const field of ["permissions", "terminal_state", "cycle_closed", "written"]) {
  const changed = claim(); changed[field] = true; assert.throws(() => assertHumanCycleClosureDecision(changed, question));
}
const native = claim(); native.source_kind = "agent"; assert.throws(() => assertHumanCycleClosureDecision(native, question));
const blank = claim(); blank.rationale = " "; assert.throws(() => assertHumanCycleClosureDecision(blank, question));
const duplicate = structuredClone(question); duplicate.review.pending.tests = ["TEST-001", "TEST-001"]; duplicate.choices.shift(); assert.throws(() => assertCycleClosureQuestion(duplicate));
pass("closed contracts reject permissions, synthetic native consent, blank rationale and duplicate coverage");
console.log(JSON.stringify({ status: "PASS", checks, proof: "pure-cycle-closure-decision", authentication: "NOT_RUN", application_ports: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
