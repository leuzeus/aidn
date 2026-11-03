import reviewSchema from "../contracts/workflow-definition/standard-cycle-closure-review.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-cycle-closure-question.v1.schema.json" with { type: "json" };
import decisionSchema from "../contracts/workflow-definition/human-cycle-closure-decision.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const unique = rows => new Set(rows).size === rows.length;
const terminalChoices = ["retain", "no_go", "drop"];
const otherChoices = ["refused", "deferred", "cancelled"];
const pendingKeys = ["requirements", "usages", "documents", "tests", "blocking_findings", "risk_findings_requiring_human_decision"];

// A prepared review describes observed evidence, not a permission or a
// statement that a cycle has closed. Its caller must authenticate the source.
export function assertCycleClosureReview(review) {
  if (checkShadowJson(review) || validateJsonSchema(review, reviewSchema, "$", { contractKind: "workflow-definition" }).length
    || !pendingKeys.every(key => unique(review.pending[key])) || !unique(review.findings.map(row => row.id))
    || review.findings.some(row => !row.rationale.trim())) fail("PROCESS_CLOSURE_QUESTION_INVALID");
  for (const [severity, key] of [["blocking", "blocking_findings"], ["risk", "risk_findings_requiring_human_decision"]]) {
    const ids = review.findings.filter(row => row.severity === severity).map(row => row.id);
    if (ids.length !== review.pending[key].length || ids.some(id => !review.pending[key].includes(id))) fail("PROCESS_CLOSURE_QUESTION_INVALID");
  }
  return review;
}
export function cycleClosureChoices(review) {
  assertCycleClosureReview(review);
  const eligible = review.work_complete && pendingKeys.filter(key => key !== "risk_findings_requiring_human_decision").every(key => review.pending[key].length === 0);
  return [...(eligible ? terminalChoices : terminalChoices.slice(1)), ...otherChoices];
}
// This guard validates the host's prepared question. It does not authenticate
// an audit, decide that exit criteria are true, or authorize a lifecycle write.
export function assertCycleClosureQuestion(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, questionSchema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(value)) > 65536) fail("PROCESS_CLOSURE_QUESTION_INVALID");
  assertCycleClosureReview(value.review);
  if (value.review.session_id !== value.session_id || shadowHash(value.choices) !== shadowHash(cycleClosureChoices(value.review))) fail("PROCESS_CLOSURE_QUESTION_INVALID");
  return value;
}

export function assertHumanCycleClosureDecision(value, question) {
  if (checkShadowJson(value) || validateJsonSchema(value, decisionSchema, "$", { contractKind: "workflow-definition" }).length
    || !value.rationale.trim() || value.risk_acceptances.some(row => !row.rationale.trim())
    || !unique(value.evidence_refs.map(row => row.ref)) || !unique(value.risk_acceptances.map(row => row.finding_id))) fail("PROCESS_CLOSURE_SOURCE_INVALID");
  if (!question) return value;
  assertCycleClosureQuestion(question);
  if (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.review)) fail("PROCESS_HUMAN_QUESTION_CHANGED");
  if (!question.choices.includes(value.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
  const expected = value.choice === "retain" ? question.review.pending.risk_findings_requiring_human_decision : [];
  if (expected.length !== value.risk_acceptances.length || value.risk_acceptances.some(row => !expected.includes(row.finding_id))) fail("PROCESS_CLOSURE_RISK_DECISION_REQUIRED");
  return value;
}

// The application must verify the human source and its current prepared
// question before recording this observation. It must freshly admit any later
// effect. A human choice completes only the decision, never cycle-close.
export function observeHumanCycleClosureDecision({ question, decision }) {
  assertHumanCycleClosureDecision(decision, question);
  const accepted = terminalChoices.includes(decision.choice);
  return {
    choice: decision.choice,
    outcome: accepted ? "completed" : decision.choice === "refused" ? "rejected" : decision.choice,
    effect_status: "no_effect",
    facts: accepted ? { cycle_closure_choice_recorded: true, cycle_retention_requested: decision.choice === "retain",
      cycle_no_go_requested: decision.choice === "no_go", cycle_drop_requested: decision.choice === "drop" } : {},
    observations: { question_sha256: shadowHash(question), review_sha256: shadowHash(question.review), source_sha256: shadowHash(decision),
      lifecycle_transition: "none", skill_completion: "pending", risk_acceptances: structuredClone(decision.risk_acceptances) },
  };
}
