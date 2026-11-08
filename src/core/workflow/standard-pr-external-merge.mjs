import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import questionSchema from '../contracts/workflow-definition/standard-pr-external-merge-disposition-question.v1.schema.json' with { type: 'json' };
import sourceSchema from '../contracts/workflow-definition/human-pr-external-merge-disposition.v1.schema.json' with { type: 'json' };
import outputSchema from '../contracts/workflow-definition/standard-pr-external-merge-disposition-output.v1.schema.json' with { type: 'json' };
import observationSchema from '../contracts/workflow-definition/standard-pr-external-merge-observation-output.v1.schema.json' with { type: 'json' };
import providerSchema from '../contracts/workflow-definition/github-pr-merge-observation.v1.schema.json' with { type: 'json' };

export const externalMergeDisposition = 'session_pr_external_merge_disposition';
export const externalMergeQuestionVersion = 'standard-pr-external-merge-disposition-question.v1';
export const externalMergeObservationVersion = 'standard-pr-external-merge-observation-output.v1';
export const externalMergeMaxAgeMs = 300000;
const acknowledgment = 'acknowledge_external_merge_for_r09';
const choices = [acknowledgment, 'refused', 'deferred', 'cancelled'];
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;

function assertExternalProof(proof) {
  if (!valid(proof.provider, providerSchema)) fail('STANDARD_PR_EXTERNAL_MERGE_PROOF_INVALID');
  const p = proof.provider.pull_request;
  if (p.state !== 'MERGED' || !p.merged || p.is_draft || p.head_repository_id !== proof.provider.repository.node_id
    || !p.merge_oid || p.observed_base_tip_oid !== p.merge_oid
    || p.merge_parent_oids.length !== 2 || p.merge_parent_oids[0] !== proof.pre_merge_base_oid
    || p.merge_parent_oids[1] !== p.head_oid || new Set([p.merge_oid, ...p.merge_parent_oids]).size !== 3
    || !(Date.parse(p.merged_at) <= Date.parse(proof.provider.observed_until))
    || !(Date.parse(proof.provider.observed_from) <= Date.parse(proof.provider.observed_until)))
    fail('STANDARD_PR_EXTERNAL_MERGE_PROOF_INVALID');
}

export function assertExternalMergeObservation(value) {
  if (!valid(value, observationSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const proof = value.observations.merge_observation, [ref] = value.evidence_refs;
  assertExternalProof(proof);
  if (ref.ref !== 'github:pr-merge/' + proof.provider.pull_request.node_id || ref.sha256 !== shadowHash(proof))
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return value;
}

export function externalMergeQuestion(record) {
  const { intent, preview: { input, prepared } } = record;
  const value = { contract_version: externalMergeQuestionVersion, operation_id: record.operation_id,
    instance_id: intent.instance_id, scope_id: intent.scope_id, occurrence_id: intent.occurrence_id, intent_sha256: shadowHash(intent),
    choices: [...choices], issued_at_ms: prepared.prepared_at_ms, expires_at_ms: prepared.expires_at_ms,
    subject: structuredClone(prepared.subject) };
  if (!valid(value, questionSchema) || value.subject.triage_operation_id !== input.triage_operation_id
    || value.subject.merge_observation.triage_operation_id !== input.triage_operation_id
    || value.expires_at_ms - value.issued_at_ms !== externalMergeMaxAgeMs)
    fail('STANDARD_PR_EXTERNAL_MERGE_QUESTION_INVALID');
  assertExternalProof(value.subject.merge_observation);
  return value;
}

export function assertHumanExternalMergeDisposition(source, question) {
  if (!valid(source, sourceSchema) || !source.rationale.trim() || !permitsR09(source)
    || new Set(source.evidence_refs.map(row => row.ref)).size !== source.evidence_refs.length)
    fail('STANDARD_PR_EXTERNAL_MERGE_DECISION_INVALID');
  if (question && (source.question_sha256 !== shadowHash(question) || source.subject_sha256 !== shadowHash(question.subject)))
    fail('PROCESS_HUMAN_QUESTION_CHANGED');
  return source;
}

const permitsR09 = ({ choice, severity }) => choice !== acknowledgment || ['L1_LOW', 'L2_MEDIUM'].includes(severity);
const outcomeFor = choice => choice === acknowledgment ? 'completed' : choice === 'refused' ? 'rejected' : choice;

export function externalMergeDispositionOutput(question, capture) {
  const source = assertHumanExternalMergeDisposition(capture.source, question), digest = shadowHash(source);
  return assertExternalMergeDisposition({ contract_version: 'standard-pr-external-merge-disposition-output.v1',
    operation_ref: externalMergeDisposition, outcome: outcomeFor(source.choice), effect_status: 'no_effect', facts: {},
    observations: { question_sha256: source.question_sha256, subject_sha256: source.subject_sha256, source_sha256: digest,
      choice: source.choice, severity: source.severity, inbox_id: capture.inbox_id, source_ref: capture.source_ref, expires_at_ms: question.expires_at_ms },
    evidence_refs: [{ ref: 'aidn:decision-source/' + capture.inbox_id, sha256: digest }, ...source.evidence_refs] });
}

export function assertExternalMergeDisposition(output) {
  if (!valid(output, outputSchema)) fail('STANDARD_OPERATION_OUTPUT_INVALID');
  const { choice, inbox_id, source_sha256 } = output.observations, [proof] = output.evidence_refs;
  if (!permitsR09(output.observations) || output.outcome !== outcomeFor(choice) || proof.ref !== 'aidn:decision-source/' + inbox_id || proof.sha256 !== source_sha256)
    fail('STANDARD_OPERATION_OUTPUT_INVALID');
  return output;
}
