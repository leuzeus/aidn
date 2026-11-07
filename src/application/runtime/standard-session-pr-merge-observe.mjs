
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { createStandardPrAcceptedReviewSource } from './standard-session-pr-review-source.mjs';
import { assertGithubPrMergeObservation } from '../../adapters/git-provider/github-workflow-adapter.mjs';

const operation = 'session_pr_merge_observe';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const reviewPending = 'STANDARD_PR_MERGE_REVIEW_EFFECTS_REQUIRED';

export function createStandardSessionPrMergeObservation({ readAccepted, readAcceptedUpdate, readDelivered, verifyEvent, readCurrent, reviewPort, now = Date.now }) {
  const readSource = createStandardPrAcceptedReviewSource({ readAccepted, readAcceptedUpdate, readDelivered,
    sourceChanged: 'STANDARD_PR_MERGE_SOURCE_CHANGED' });
  function source(instance, input) {
    assertStandardOperationInput(operation, input);
    return readSource(instance, input);
  }
  function emit(outcome, reasonCode, proof) {
    return assertStandardOperationOutput({ contract_version: 'standard-session-pr-merge-observe-output.v1',
      operation_ref: operation, outcome, effect_status: 'no_effect', facts: {},
      observations: { reason_code: reasonCode, ...(proof ? { merge_observation: proof } : {}) },
      evidence_refs: proof ? [{ ref: 'github:pr-merge/' + proof.provider.pull_request.node_id, sha256: shadowHash(proof) }] : [] });
  }
  const active = signal => { if (signal?.aborted) fail('STANDARD_PR_MERGE_ABORTED'); };
  return Object.freeze({
    prepare(instance, input) {
      return { can_apply: true, input, source_sha256: source(instance, input).sha256 };
    },
    async observe(instance, input, { signal, sourceSha256 } = {}) {
      try {
        if (signal !== undefined && !(signal instanceof AbortSignal)) fail('STANDARD_PR_MERGE_SIGNAL_INVALID');
        active(signal);
        const before = source(instance, input), p = before.pullRequest, start = now();
        if (!Number.isSafeInteger(start) || start < before.preMergeObservedUntil) fail('STANDARD_PR_MERGE_STALE_OBSERVATION');
        if (sourceSha256 !== before.sha256) fail('STANDARD_PR_MERGE_SOURCE_CHANGED');
        if (before.correctionsRequired) return emit('deferred', reviewPending);
        if (typeof reviewPort?.observePrMerge !== 'function') return emit('deferred', 'STANDARD_PR_MERGE_PROVIDER_REQUIRED');
        await verifyEvent(before.capture, { signal });
        const request = { contract_version: 'github-pr-observation-request.v2', pull_request_number: p.number,
          expected_pull_request_id: p.node_id, expected_head_oid: p.head_oid, expected_base_oid: p.base_oid,
          expected_head_ref: p.head_branch, expected_base_ref: p.base_branch };
        const url = new URL(p.url);
        const collect = async () => {
          active(signal);
          const callStart = now();
          const observed = assertGithubPrMergeObservation(await reviewPort.observePrMerge(request, { signal }));
          active(signal);
          const pr = observed.pull_request, time = now();
          if (observed.repository.node_id !== p.repository_id || pr.head_repository_id !== p.repository_id
            || url.origin !== 'https://github.com' || url.pathname.toLowerCase() !== ('/' + observed.repository.owner + '/' + observed.repository.name + '/pull/' + p.number).toLowerCase()
            || pr.node_id !== p.node_id || pr.number !== p.number || pr.head_ref !== p.head_branch || pr.head_oid !== p.head_oid
            || pr.base_ref !== p.base_branch || pr.is_draft
            || pr.merged && (pr.merge_parent_oids[0] !== p.base_oid || Date.parse(pr.merged_at) < before.preMergeObservedUntil)
            || pr.state === 'OPEN' && pr.observed_base_tip_oid !== p.base_oid) fail('STANDARD_PR_MERGE_SUBJECT_CHANGED');
          if (!Number.isSafeInteger(callStart) || callStart < start || !Number.isSafeInteger(time)
            || Date.parse(observed.observed_from) < callStart || Date.parse(observed.observed_until) > time || time - start > 300000) fail('STANDARD_PR_MERGE_STALE_OBSERVATION');
          return structuredClone(observed);
        };
        const first = await collect(), provider = await collect();
        if (shadowHash([first.repository, first.pull_request]) !== shadowHash([provider.repository, provider.pull_request]))
          fail('STANDARD_PR_MERGE_OBSERVATION_CHANGED');
        await verifyEvent(before.capture, { signal });
        active(signal);
        const unchanged = readCurrent(instance.instance_id).instance_sha256 === instance.instance_sha256
          && source(instance, input).sha256 === before.sha256;
        const end = now();
        if (!unchanged || !Number.isSafeInteger(end) || end < Date.parse(provider.observed_until) || end - start > 300000) fail('STANDARD_PR_MERGE_CONTEXT_CHANGED');
        if (provider.pull_request.state === 'CLOSED') fail('STANDARD_PR_MERGE_CLOSED_UNMERGED');
        if (provider.pull_request.state === 'OPEN') return emit('deferred', 'STANDARD_PR_MERGE_AWAITING_PROVIDER');

        // The authentic fact is retained on a deferred receipt, with no
        // routing facts. R08 effects and their verification still gate progress.
        return emit('deferred', reviewPending, { triage_operation_id: input.triage_operation_id, update_operation_id: before.updateId,
          pre_merge_base_oid: p.base_oid, source_sha256: before.sha256, provider });
      } catch (cause) {
        return emit('blocked', typeof cause?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(cause.code)
          ? cause.code : 'STANDARD_PR_MERGE_UNAVAILABLE');
      }
    },
  });
}
