import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { externalMergeDisposition, externalMergeMaxAgeMs, externalMergeObservationVersion, externalMergeQuestion, externalMergeMaterial,
  assertExternalMergeDisposition, assertExternalMergeObservation } from '../../core/workflow/standard-pr-external-merge.mjs';
import { assertMergeExecuteOutput, mergeCompletedFact, mergeExecuteOperation } from '../../core/workflow/standard-pr-merge-execute.mjs';
import { inspectAgenticProcess } from '../../core/workflow/agentic-process.mjs';

const required = 'STANDARD_PR_EXTERNAL_MERGE_OBSERVATION_REQUIRED';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const same = (a, b) => shadowHash(a) === shadowHash(b);

function observationSubject(instance, input, id, binding, readAccepted) {
  if (!['session_pr_premerge_observe', 'session_pr_checks_accept'].includes(binding)) fail(required);
  const { record, output } = readAccepted(instance, id, binding, required);
  const proof = assertExternalMergeObservation(output).observations.merge_observation;
  if (output.operation_ref !== binding || record.preview.input.triage_operation_id !== input.triage_operation_id
    || proof.triage_operation_id !== input.triage_operation_id) fail(required);
  return { triage_operation_id: input.triage_operation_id, observation_operation_id: id,
    observation_receipt_sha256: shadowHash(record.results.at(-1).receipt), merge_observation: proof,
    incident: 'R08_PREMERGE_CONTROLS_UNESTABLISHED' };
}

export function readExternalMergeForFetch(instance, id, readAccepted, readPretriage) {
  const { record, output } = readAccepted(instance, id, externalMergeDisposition, required);
  const question = externalMergeQuestion(record), subject = question.subject;
  const pretriage = Object.hasOwn(record.preview.input, 'update_operation_id');
  const original = pretriage
    ? readPretriage(instance, record.preview.input, record.intent.occurrence_id).subject
    : observationSubject(instance, record.preview.input, subject.observation_operation_id,
      instance.events.find(event => event.kind === 'operation_intent'
        && event.intent.operation_id === subject.observation_operation_id)?.intent.binding_ref, readAccepted);
  if (assertExternalMergeDisposition(output).outcome !== 'completed'
    || output.observations.question_sha256 !== shadowHash(question) || output.observations.subject_sha256 !== shadowHash(subject)
    || !same(subject, original)) fail(required);
  return { merge: subject.merge_observation, receiptSha: shadowHash(record.results.at(-1).receipt) };
}

export function createStandardExternalMergeDisposition({ readAccepted, now, observeMerge, readPretriage, pretriageMerge }) {
  function source(instance, input, occurrenceId) {
    if (Object.hasOwn(input, 'update_operation_id')) return readPretriage(instance, input, occurrenceId).subject;
    const frames = inspectAgenticProcess(instance).occurrences;
    const frame = frames.find(row => row.occurrence_id === occurrenceId);
    if (!frame?.call_scope_id) fail(required);
    const eligible = frames.filter(row => row.call_scope_id === frame.call_scope_id
      && ['pr_premerge_observe', 'pr_checks_accept'].includes(row.node_id) && row.status === 'COMPLETED'
      && row.operation?.receipt?.facts.session_pr_external_merge_observed === true);
    if (eligible.length !== 1) fail(required);
    const { operation_id, binding_ref } = eligible[0].operation.intent;
    return observationSubject(instance, input, operation_id, binding_ref, readAccepted);
  }
  return Object.freeze({
    prepareBasis({ record: instance, cursor }, input, occurrenceId) {
      const scope = cursor.occurrences.find(row => row.occurrence_id === occurrenceId)?.call_scope_id;
      if (!scope) fail(required);
      const sources = cursor.occurrences.filter(row => row.call_scope_id === scope && row.status === 'COMPLETED'
        && [mergeExecuteOperation, externalMergeDisposition].includes(row.operation?.intent.binding_ref)
        && row.operation.receipt?.facts[mergeCompletedFact] !== false);
      if (sources.length !== 1) fail(required);
      const { operation_id, binding_ref } = sources[0].operation.intent;
      const { record, output } = readAccepted(instance, operation_id, binding_ref, required);
      const key = Object.hasOwn(input, 'update_operation_id') ? 'update_operation_id' : 'triage_operation_id';
      if (record.preview.input[key] !== input[key]) fail(required);
      if (binding_ref === externalMergeDisposition) readExternalMergeForFetch(instance, operation_id, readAccepted, readPretriage);
      else if (key !== 'triage_operation_id' || assertMergeExecuteOutput(output).observations.merge?.operation_id !== operation_id) fail(required);
      return { can_apply: true, merge_operation_id: operation_id, receipt_sha256: shadowHash(record.results.at(-1).receipt) };
    },
    prepare(instance, input, occurrenceId) {
      const subject = source(instance, input, occurrenceId), time = now();
      if (!Number.isSafeInteger(time) || time < Date.parse(subject.merge_observation.provider.observed_until)) fail(required);
      return { can_apply: true, subject, prepared_at_ms: time, expires_at_ms: time + externalMergeMaxAgeMs };
    },
    assertAge(prepared) {
      const time = now();
      if (!Number.isSafeInteger(time) || time < prepared.prepared_at_ms || time >= prepared.expires_at_ms)
        fail('STANDARD_PR_EXTERNAL_MERGE_QUESTION_EXPIRED');
    },
    async assertFresh(instance, record, signal) {
      const { input, prepared } = record.preview;
      this.assertAge(prepared);
      const subject = source(instance, input, record.intent.occurrence_id);
      if (!same(subject, prepared.subject)) fail(required);
      if (Object.hasOwn(input, 'update_operation_id')) {
        const { delivery } = readPretriage(instance, input, record.intent.occurrence_id);
        if (!pretriageMerge) fail('STANDARD_PR_MERGE_PROVIDER_REQUIRED');
        await pretriageMerge.assertPostimage(delivery, subject.merge_observation, signal);
        this.assertAge(prepared);
        return;
      }
      const sourceInput = { contract_version: 'standard-session-pr-merge-observe-input.v2', triage_operation_id: input.triage_operation_id };
      const observed = await observeMerge.observe(instance, sourceInput, { signal,
        sourceSha256: subject.merge_observation.source_sha256, externalOperation: 'session_pr_premerge_observe' });
      if (observed.contract_version !== externalMergeObservationVersion
        || !same(externalMergeMaterial(observed.observations.merge_observation), externalMergeMaterial(subject.merge_observation)))
        fail('STANDARD_PR_EXTERNAL_MERGE_POSTIMAGE_CHANGED');
      this.assertAge(prepared);
    },
  });
}
