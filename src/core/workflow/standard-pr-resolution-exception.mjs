import questionSchema from '../contracts/workflow-definition/standard-pr-review-resolution-exception-question.v1.schema.json' with { type: 'json' };
import sourceSchema from '../contracts/workflow-definition/human-pr-review-resolution-exception.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-review-resolution-exception-output.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';

export const resolutionExceptionOperation = 'session_pr_review_resolution_exception';
const approval = 'accept_resolution_exception';
const choices = [approval, 'refused', 'deferred', 'cancelled'];
const subjectSchema = { $schema: questionSchema.$schema, $id: questionSchema.$id + '/subject', ...questionSchema.properties.subject };
export const resolutionExceptionMaxAgeMs = 300000;
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;

export function assertResolutionExceptionSubject(subject) {
  if (!valid(subject, subjectSchema)
    || subject.unresolved_thread_ids.some((id, index, ids) => index > 0 && ids[index - 1] >= id))
    fail('STANDARD_PR_RESOLUTION_EXCEPTION_SUBJECT_INVALID');
  return subject;
}

export function resolutionExceptionQuestion(record) {
  const { intent, preview: { input, prepared } } = record;
  const question = { contract_version: 'standard-pr-review-resolution-exception-question.v1', operation_id: record.operation_id,
    instance_id: intent.instance_id, scope_id: intent.scope_id, occurrence_id: intent.occurrence_id, intent_sha256: shadowHash(intent),
    choices: [...choices], selection_operation_id: input.selection_operation_id,
    expires_at_ms: prepared.prepared_at_ms + resolutionExceptionMaxAgeMs, subject: structuredClone(prepared.subject) };
  if (prepared.subject.triage_operation_id !== input.triage_operation_id) fail('STANDARD_PR_RESOLUTION_EXCEPTION_SUBJECT_INVALID');
  return assertResolutionExceptionQuestion(question);
}

export function assertResolutionExceptionQuestion(question) {
  if (!valid(question, questionSchema) || shadowHash(question.choices) !== shadowHash(choices))
    fail('STANDARD_PR_RESOLUTION_EXCEPTION_QUESTION_INVALID');
  assertResolutionExceptionSubject(question.subject);
  return question;
}

export function assertHumanResolutionException(source, question) {
  if (!valid(source, sourceSchema) || !source.rationale.trim()
    || new Set(source.evidence_refs.map(row => row.ref)).size !== source.evidence_refs.length)
    fail('STANDARD_PR_RESOLUTION_EXCEPTION_DECISION_INVALID');
  if (question && (source.question_sha256 !== shadowHash(question) || source.subject_sha256 !== shadowHash(question.subject)))
    fail('PROCESS_HUMAN_QUESTION_CHANGED');
  return source;
}

function outcomeFor(choice) {
  return choice === approval ? 'completed' : choice === 'refused' ? 'rejected' : choice;
}

function factsFor(choice) {
  return choice === approval ? { session_pr_resolution_exception_accepted: true, session_pr_resolution_gate_met: true } : {};
}

export function resolutionExceptionOutput(question, capture) {
  const source = assertHumanResolutionException(capture.source, question);
  const sourceHash = shadowHash(source);
  return assertResolutionExceptionOutput({ contract_version: 'standard-pr-review-resolution-exception-output.v1',
    operation_ref: resolutionExceptionOperation, outcome: outcomeFor(source.choice), effect_status: 'no_effect', facts: factsFor(source.choice),
    observations: { question_sha256: source.question_sha256, subject_sha256: source.subject_sha256, source_sha256: sourceHash,
      choice: source.choice, inbox_id: capture.inbox_id, source_ref: capture.source_ref },
    evidence_refs: [{ ref: 'aidn:decision-source/' + capture.inbox_id, sha256: sourceHash }, ...source.evidence_refs] });
}

export function assertResolutionExceptionOutput(output) {
  if (!valid(output, outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { choice, inbox_id, source_sha256 } = output.observations;
  const [capture] = output.evidence_refs;
  if (output.outcome !== outcomeFor(choice) || shadowHash(output.facts) !== shadowHash(factsFor(choice))
    || capture.ref !== 'aidn:decision-source/' + inbox_id || capture.sha256 !== source_sha256)
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return output;
}
