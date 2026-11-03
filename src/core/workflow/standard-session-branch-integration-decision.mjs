import reviewSchema from '../contracts/workflow-definition/standard-session-branch-integration-review.v1.schema.json' with { type: 'json' };
import questionSchema from '../contracts/workflow-definition/standard-session-branch-integration-question.v1.schema.json' with { type: 'json' };
import sourceSchema from '../contracts/workflow-definition/human-session-branch-integration-decision.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-session-branch-integration-decision-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
export const sessionBranchIntegrationChoices = Object.freeze(['integrate-to-session', 'refused', 'deferred', 'cancelled']);
export function assertSessionBranchIntegrationReview(value) {
  if (!valid(value, reviewSchema) || Buffer.byteLength(JSON.stringify(value)) > 65536
    || value.session_path !== `sessions/${value.session_id}.md` || !value.cycle_path.startsWith(`cycles/${value.cycle_id}-`)
    || value.source_branch === value.target_branch || value.git.source_branch !== value.source_branch || value.git.target_branch !== value.target_branch
    || value.git.source_ref !== 'refs/heads/' + value.source_branch || value.git.target_ref !== 'refs/heads/' + value.target_branch
    || value.git.current_ref !== value.git.source_ref || value.git.head !== value.git.source_head || value.git.head !== value.delivery_head || !value.git.clean || value.git.lock_present
    || value.git.source_lock_present || value.git.source_symbolic || value.git.target_symbolic || !value.git.fast_forward || value.git.target_checked_out_elsewhere
    || new Set(value.documents.map(row => row.ref)).size !== value.documents.length
    || ![value.session_path, value.cycle_path, 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'].every(name => value.documents.some(row => row.ref === 'audit:' + name)))
    fail('STANDARD_SESSION_INTEGRATION_REVIEW_INVALID');
  return value;
}
export function assertSessionBranchIntegrationQuestion(value) {
  if (!valid(value, questionSchema) || Buffer.byteLength(JSON.stringify(value)) > 98304) fail('STANDARD_SESSION_INTEGRATION_QUESTION_INVALID');
  assertSessionBranchIntegrationReview(value.review);
  if (value.session_id !== value.review.session_id || shadowHash(value.choices) !== shadowHash(sessionBranchIntegrationChoices)) fail('STANDARD_SESSION_INTEGRATION_QUESTION_INVALID');
  return value;
}
export function assertHumanSessionBranchIntegrationDecision(value, question) {
  if (!valid(value, sourceSchema) || !value.rationale.trim() || new Set(value.evidence_refs.map(row => row.ref)).size !== value.evidence_refs.length)
    fail('STANDARD_SESSION_INTEGRATION_SOURCE_INVALID');
  if (question) {
    assertSessionBranchIntegrationQuestion(question);
    if (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.review)) fail('PROCESS_HUMAN_QUESTION_CHANGED');
    if (!question.choices.includes(value.choice)) fail('PROCESS_HUMAN_CHOICE_NOT_OFFERED');
  }
  return value;
}
export function observeHumanSessionBranchIntegrationDecision({ question, decision }) {
  assertHumanSessionBranchIntegrationDecision(decision, question);
  const accepted = decision.choice === 'integrate-to-session';
  return { outcome: accepted ? 'completed' : decision.choice === 'refused' ? 'rejected' : decision.choice, effect_status: 'no_effect',
    facts: accepted ? { session_branch_integration_requested: true } : {},
    observations: { question_sha256: shadowHash(question), choice: decision.choice, review_sha256: shadowHash(question.review), source_sha256: shadowHash(decision) } };
}
export function assertSessionBranchIntegrationDecisionOutput(value) {
  if (!valid(value, outputSchema)) fail('STANDARD_SESSION_INTEGRATION_OUTPUT_INVALID');
  const accepted = value.observations.choice === 'integrate-to-session';
  if (value.outcome !== (accepted ? 'completed' : value.observations.choice === 'refused' ? 'rejected' : value.observations.choice)
    || shadowHash(value.facts) !== shadowHash(accepted ? { session_branch_integration_requested: true } : {})) fail('STANDARD_SESSION_INTEGRATION_OUTPUT_INVALID');
  return value;
}
