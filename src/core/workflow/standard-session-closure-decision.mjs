import reviewSchema from "../contracts/workflow-definition/standard-session-closure-review.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-session-closure-question.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-session-closure-decision.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-session-closure-decision-output.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const unique = rows => new Set(rows).size === rows.length;
export function assertSessionClosureReview(value) {
  if (!valid(value, reviewSchema) || Buffer.byteLength(JSON.stringify(value)) > 65536
    || !unique(value.documents.map(row => row.ref)) || !unique(value.open_cycles)
    || value.session_path.match(/^sessions\/(S[0-9]+)(?:[-_.][^/]*)?\.md$/)?.[1] !== value.session_id
    || !["audit:" + value.session_path, "audit:CURRENT-STATE.md", "audit:snapshots/context-snapshot.md"].every(ref => value.documents.some(row => row.ref === ref)))
    fail("PROCESS_SESSION_CLOSURE_REVIEW_INVALID");
  return value;
}
export function sessionClosureChoices(review) {
  assertSessionClosureReview(review);
  return [...(!review.session_close_gate_satisfied && !review.open_cycles.length ? ["close"] : []), "refused", "deferred", "cancelled"];
}
// This validates a prepared observation. Only the application can authenticate
// admission, R05 and the provider; schemas and caller-authored facts cannot.
export function assertSessionClosureQuestion(value) {
  if (!valid(value, questionSchema) || Buffer.byteLength(JSON.stringify(value)) > 98304) fail("PROCESS_SESSION_CLOSURE_QUESTION_INVALID");
  assertSessionClosureReview(value.review);
  if (value.session_id !== value.review.session_id || shadowHash(value.choices) !== shadowHash(sessionClosureChoices(value.review)))
    fail("PROCESS_SESSION_CLOSURE_QUESTION_INVALID");
  return value;
}
export function assertHumanSessionClosureDecision(value, question) {
  if (!valid(value, sourceSchema) || !value.rationale.trim() || !unique(value.evidence_refs.map(row => row.ref))
    || (value.choice === "close") !== (value.session_report !== null)
    || value.session_report && (!value.session_report.summary.trim() || !value.session_report.next_entry_point.trim()
      || [...value.session_report.open_loops, ...value.session_report.blockers].some(text => !text.trim()))) fail("PROCESS_SESSION_CLOSURE_SOURCE_INVALID");
  if (question) {
    assertSessionClosureQuestion(question);
    if (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.review)) fail("PROCESS_HUMAN_QUESTION_CHANGED");
    if (!question.choices.includes(value.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
  }
  return value;
}
export function observeHumanSessionClosureDecision({ question, decision }) {
  assertHumanSessionClosureDecision(decision, question);
  const accepted = decision.choice === "close";
  return { choice: decision.choice, outcome: accepted ? "completed" : decision.choice === "refused" ? "rejected" : decision.choice,
    effect_status: "no_effect", facts: accepted ? { session_closure_requested: true, session_close_completed: false } : {},
    observations: { question_sha256: shadowHash(question), choice: decision.choice, session_report: structuredClone(decision.session_report),
      review_sha256: shadowHash(question.review), source_sha256: shadowHash(decision) } };
}
export function assertSessionClosureDecisionOutput(value) {
  if (!valid(value, outputSchema)) fail("STANDARD_SESSION_CLOSURE_OUTPUT_INVALID");
  const accepted = value.outcome === "completed";
  const expected = accepted ? { session_closure_requested: true, session_close_completed: false } : {};
  if (accepted !== (value.observations.choice === "close") || accepted !== (value.observations.session_report !== null)
    || shadowHash(value.facts) !== shadowHash(expected)
    || value.outcome !== (accepted ? "completed" : value.observations.choice === "refused" ? "rejected" : value.observations.choice))
    fail("STANDARD_SESSION_CLOSURE_OUTPUT_INVALID");
  return value;
}
