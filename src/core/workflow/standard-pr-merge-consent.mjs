import questionSchema from '../contracts/workflow-definition/standard-pr-merge-consent-question.v1.schema.json' with { type: 'json' };
import currentQuestionSchema from '../contracts/workflow-definition/standard-pr-merge-consent-question.v2.schema.json' with { type: 'json' };
import currentConsentSchema from '../contracts/workflow-definition/standard-pr-merge-consent-output.v2.schema.json' with { type: 'json' };
import sourceSchema from '../contracts/workflow-definition/human-pr-merge-consent.v1.schema.json' with { type: 'json' };
import consentSchema from '../contracts/workflow-definition/standard-pr-merge-consent-output.v1.schema.json' with { type: 'json' };
import checksSchema from '../contracts/workflow-definition/standard-pr-checks-accept-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';

export const checksOperation = 'session_pr_checks_accept';
export const mergeConsentOperation = 'session_pr_merge_consent';
export const mergeConsentMaxAgeMs = 300000; // Historical question v1 only.
export const mergeConsentQuestionVersion = 'standard-pr-merge-consent-question.v2';
export const mergeConsentOutputVersion = 'standard-pr-merge-consent-output.v2';
const approval = 'approve_merge';
const choices = [approval, 'refused', 'deferred', 'cancelled'];
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
const subjectSchema = { $schema: questionSchema.$schema, $id: questionSchema.$id + '/subject', ...questionSchema.properties.subject };

export function assertMergeQualification(subject) {
  if (!valid(subject, subjectSchema) || subject.checks.some((check, i, rows) => i > 0 && rows[i - 1].name >= check.name)
    || new Set(subject.checks.map(row => row.result_id)).size !== subject.checks.length)
    fail('STANDARD_PR_CHECK_SUBJECT_INVALID');
}

export function mergeApprovalSubject({ repository_id, pull_request_id, pull_request_number, head_oid, base_ref }) {
  return { repository_id, pull_request_id, pull_request_number, head_oid, base_ref };
}

export function mergeConsentQuestion(record) {
  const { intent, preview: { input, prepared } } = record;
  const current = record.preview.binding?.output_contract === mergeConsentOutputVersion;
  const question = { contract_version: current ? mergeConsentQuestionVersion : 'standard-pr-merge-consent-question.v1', operation_id: record.operation_id,
    instance_id: intent.instance_id, scope_id: intent.scope_id, occurrence_id: intent.occurrence_id, intent_sha256: shadowHash(intent),
    choices: [...choices], checks_operation_id: input.checks_operation_id, issued_at_ms: prepared.prepared_at_ms,
    ...(current ? { subject: mergeApprovalSubject(prepared.subject), qualification: structuredClone(prepared.subject) }
      : { expires_at_ms: prepared.expires_at_ms, subject: structuredClone(prepared.subject) }) };
  const qualification = current ? question.qualification : question.subject;
  if (!valid(question, current ? currentQuestionSchema : questionSchema) || qualification.triage_operation_id !== input.triage_operation_id
    || !current && (question.issued_at_ms >= question.expires_at_ms
      || question.expires_at_ms > Math.min(question.issued_at_ms + mergeConsentMaxAgeMs, qualification.resolution_expires_at_ms ?? Infinity)))
    fail('STANDARD_PR_MERGE_CONSENT_QUESTION_INVALID');
  assertMergeQualification(qualification);
  return question;
}

export function assertHumanMergeConsent(source, question) {
  if (!valid(source, sourceSchema) || !source.rationale.trim()
    || new Set(source.evidence_refs.map(row => row.ref)).size !== source.evidence_refs.length)
    fail('STANDARD_PR_MERGE_CONSENT_DECISION_INVALID');
  if (question && (source.question_sha256 !== shadowHash(question) || source.subject_sha256 !== shadowHash(question.subject)))
    fail('PROCESS_HUMAN_QUESTION_CHANGED');
  return source;
}

const outcomeFor = choice => choice === approval ? 'completed' : choice === 'refused' ? 'rejected' : choice;
const factsFor = choice => choice === approval ? { session_pr_merge_consent_accepted: true } : {};

export function mergeConsentOutput(question, capture) {
  const source = assertHumanMergeConsent(capture.source, question);
  const sourceHash = shadowHash(source);
  const current = question.contract_version === mergeConsentQuestionVersion;
  return assertMergeConsentOutput({ contract_version: current ? mergeConsentOutputVersion : 'standard-pr-merge-consent-output.v1',
    operation_ref: mergeConsentOperation, outcome: outcomeFor(source.choice), effect_status: 'no_effect', facts: factsFor(source.choice),
    observations: { question_sha256: source.question_sha256, subject_sha256: source.subject_sha256, source_sha256: sourceHash,
      choice: source.choice, inbox_id: capture.inbox_id, source_ref: capture.source_ref,
      ...(current ? {} : { expires_at_ms: question.expires_at_ms }) },
    evidence_refs: [{ ref: 'aidn:decision-source/' + capture.inbox_id, sha256: sourceHash }, ...source.evidence_refs] });
}

export function assertMergeConsentOutput(output) {
  if (!valid(output, output?.contract_version === mergeConsentOutputVersion ? currentConsentSchema : consentSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { choice, inbox_id, source_sha256 } = output.observations;
  const [capture] = output.evidence_refs;
  if (output.outcome !== outcomeFor(choice) || shadowHash(output.facts) !== shadowHash(factsFor(choice))
    || capture.ref !== 'aidn:decision-source/' + inbox_id || capture.sha256 !== source_sha256)
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return output;
}

export function assertRequiredChecksOutput(output) {
  if (!valid(output, checksSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { subject, observed_at_ms } = output.observations;
  if (output.outcome === 'completed') {
    assertMergeQualification(subject);
    const [proof] = output.evidence_refs;
    if (output.facts.session_pr_required_checks_accepted !== true || output.evidence_refs.length !== 1
      || proof.ref !== 'github:pr-required-checks/' + subject.pull_request_id || proof.sha256 !== shadowHash(output.observations)
      || subject.resolution_expires_at_ms !== null && observed_at_ms >= subject.resolution_expires_at_ms)
      fail('STANDARD_OPERATION_OUTPUT_INVALID');
  } else if (!output.observations.reason_code || Object.keys(output.facts).length || output.evidence_refs.length)
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return output;
}
