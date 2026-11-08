import questionSchema from '../contracts/workflow-definition/standard-pr-post-merge-decision-question.v1.schema.json' with { type: 'json' };
import sourceSchema from '../contracts/workflow-definition/human-pr-post-merge-decision.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-post-merge-decision-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';

export const postMergeDecisionOperation = 'session_pr_post_merge_decision';
export const postMergeQuestionVersion = 'standard-pr-post-merge-decision-question.v1';
export const postMergeDecisionMaxAgeMs = 300000;
const manual = 'reconcile_manually';
const choices = [manual, 'refused', 'deferred', 'cancelled'];
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;

export function postMergeDecisionQuestion(record) {
  const { intent, preview: { input, prepared } } = record;
  const question = { contract_version: postMergeQuestionVersion, operation_id: record.operation_id,
    instance_id: intent.instance_id, scope_id: intent.scope_id, occurrence_id: intent.occurrence_id, intent_sha256: shadowHash(intent),
    choices: [...choices], issued_at_ms: prepared.prepared_at_ms, expires_at_ms: prepared.expires_at_ms,
    subject: structuredClone(prepared.subject) };
  if (!valid(question, questionSchema) || question.subject.measurement_operation_id !== input.measurement_operation_id
    || question.issued_at_ms >= question.expires_at_ms || question.expires_at_ms - question.issued_at_ms > postMergeDecisionMaxAgeMs)
    fail('STANDARD_PR_POST_MERGE_QUESTION_INVALID');
  const { ahead, behind, local_head, remote_head } = question.subject.alignment;
  if ((!ahead && !behind) || local_head === remote_head) fail('STANDARD_PR_POST_MERGE_QUESTION_INVALID');
  return question;
}

export function assertHumanPostMergeDecision(source, question) {
  if (!valid(source, sourceSchema) || !source.rationale.trim()
    || new Set(source.evidence_refs.map(row => row.ref)).size !== source.evidence_refs.length)
    fail('STANDARD_PR_POST_MERGE_DECISION_INVALID');
  if (question && (source.question_sha256 !== shadowHash(question) || source.subject_sha256 !== shadowHash(question.subject)))
    fail('PROCESS_HUMAN_QUESTION_CHANGED');
  return source;
}

const outcomeFor = choice => choice === manual ? 'completed' : choice === 'refused' ? 'rejected' : choice;

export function postMergeDecisionOutput(question, capture) {
  const source = assertHumanPostMergeDecision(capture.source, question), sourceHash = shadowHash(source);
  return assertPostMergeDecisionOutput({ contract_version: 'standard-pr-post-merge-decision-output.v1',
    operation_ref: postMergeDecisionOperation, outcome: outcomeFor(source.choice), effect_status: 'no_effect', facts: {},
    observations: { question_sha256: source.question_sha256, subject_sha256: source.subject_sha256, source_sha256: sourceHash,
      choice: source.choice, inbox_id: capture.inbox_id, source_ref: capture.source_ref, expires_at_ms: question.expires_at_ms },
    evidence_refs: [{ ref: 'aidn:decision-source/' + capture.inbox_id, sha256: sourceHash }, ...source.evidence_refs] });
}

export function assertPostMergeDecisionOutput(output) {
  if (!valid(output, outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { choice, inbox_id, source_sha256 } = output.observations, [capture] = output.evidence_refs;
  if (output.outcome !== outcomeFor(choice) || capture.ref !== 'aidn:decision-source/' + inbox_id || capture.sha256 !== source_sha256)
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return output;
}
