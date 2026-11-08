import questionSchema from '../contracts/workflow-definition/standard-pr-post-merge-decision-question.v1.schema.json' with { type: 'json' };
import sourceSchema from '../contracts/workflow-definition/human-pr-post-merge-decision.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-post-merge-decision-output.v1.schema.json' with { type: 'json' };
import recoveryPlanSchema from '../contracts/workflow-definition/standard-pr-post-merge-question-recovery-plan.v1.schema.json' with { type: 'json' };
import recoveryOutputSchema from '../contracts/workflow-definition/standard-pr-post-merge-question-recovery-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';

export const postMergeDecisionOperation = 'session_pr_post_merge_decision';
export const postMergeQuestionVersion = 'standard-pr-post-merge-decision-question.v1';
export const postMergeDecisionMaxAgeMs = 300000;
export const postMergeRecoveryPlanVersion = 'standard-pr-post-merge-question-recovery-plan.v1';
export const postMergeRecoveryOutputVersion = 'standard-pr-post-merge-question-recovery-output.v1';
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
    subject: structuredClone(prepared.subject), ...(prepared.replaces ? { replaces: structuredClone(prepared.replaces) } : {}) };
  if (!valid(question, questionSchema) || question.subject.measurement_operation_id !== input.measurement_operation_id
    || question.issued_at_ms >= question.expires_at_ms || question.expires_at_ms - question.issued_at_ms > postMergeDecisionMaxAgeMs)
    fail('STANDARD_PR_POST_MERGE_QUESTION_INVALID');
  const { ahead, behind, local_head, remote_head } = question.subject.alignment;
  if ((!ahead && !behind) || local_head === remote_head) fail('STANDARD_PR_POST_MERGE_QUESTION_INVALID');
  return question;
}

export const alignedPostMergeSubject = ({ alignment }) =>
  alignment.ahead === 0 && alignment.behind === 0 && alignment.local_head === alignment.remote_head;

export function assertPostMergeRecoveryPlan(plan) {
  if (!valid(plan, recoveryPlanSchema)) fail('STANDARD_PR_POST_MERGE_RECOVERY_PLAN_INVALID');
  const { ahead, behind, local_head, remote_head } = plan.next_subject.alignment;
  if ((ahead === 0 && behind === 0) !== (local_head === remote_head))
    fail('STANDARD_PR_POST_MERGE_RECOVERY_PLAN_INVALID');
  return plan;
}

export function postMergeRecoveryOutput(plan, grant) {
  return assertPostMergeRecoveryOutput({ contract_version: postMergeRecoveryOutputVersion, operation_ref: postMergeDecisionOperation,
    outcome: alignedPostMergeSubject(plan.next_subject) ? 'completed' : 'deferred', effect_status: 'no_effect', facts: {},
    observations: { plan, grant },
    evidence_refs: [{ ref: 'git:' + plan.next_subject.alignment.proof_ref, sha256: shadowHash(plan.next_subject.alignment) }] });
}

export function assertPostMergeRecoveryOutput(output) {
  if (!valid(output, recoveryOutputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { next_subject: subject } = assertPostMergeRecoveryPlan(output.observations.plan);
  const aligned = alignedPostMergeSubject(subject), [evidence] = output.evidence_refs;
  if (output.outcome !== (aligned ? 'completed' : 'deferred') || evidence.ref !== 'git:' + subject.alignment.proof_ref
    || evidence.sha256 !== shadowHash(subject.alignment)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return output;
}

export function postMergeRecoveryResult(record) {
  const result = record.results.at(-1);
  if (result?.output.contract_version !== postMergeRecoveryOutputVersion) return null;
  const { plan } = assertPostMergeRecoveryOutput(result.output).observations;
  if (record.intent.binding_ref !== postMergeDecisionOperation || record.decision_claim_sha256 !== undefined
    || record.results.length !== 1 || plan.operation_id !== record.operation_id || plan.intent_sha256 !== shadowHash(record.intent))
    fail('STANDARD_PR_POST_MERGE_RECOVERY_RESULT_CHANGED');
  return result;
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
