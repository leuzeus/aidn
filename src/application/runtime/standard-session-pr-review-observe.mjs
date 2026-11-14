import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { assertGithubReviewEvidence, assertGithubReviewContent } from '../../adapters/git-provider/github-review-evidence.mjs';
import { assertGithubPrObservation, assertGithubPrContent } from '../../adapters/git-provider/github-workflow-adapter.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-session-pr-review-observe-input.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-session-pr-review-observe-output.v1.schema.json' with { type: 'json' };
import contentOutputSchema from '../../core/contracts/workflow-definition/standard-session-pr-review-content-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
// A deterministic read on the accepted successor push. It retains provider
// evidence, not triage/approval, a completed skill or permission to merge.
function createObservation({ readConfirmedHead, readCurrent, reviewPort, now = Date.now }, includeContent = false) {
  const observeEvidence = includeContent ? reviewPort?.observeReviewContent : reviewPort?.observeReviewEvidence;
  const observeThreads = includeContent ? reviewPort?.observePrContent : reviewPort?.observePullRequest;
  if (![readConfirmedHead, readCurrent, observeEvidence, observeThreads].every(fn => typeof fn === 'function'))
    fail('STANDARD_PR_REVIEW_AUTHORITY_REQUIRED');
  const active = signal => { if (signal?.aborted) fail('STANDARD_PR_REVIEW_ABORTED'); };
  async function source(instance, input, signal) {
    active(signal);
    if (!valid(input, inputSchema)) fail('STANDARD_PR_REVIEW_INPUT_INVALID');
    const value = await readConfirmedHead(instance, input, { signal }), p = value?.pull_request;
    active(signal);
    if (value?.update_operation_id !== input.update_operation_id || p?.state !== 'OPEN' || p.draft
      || value.head !== p.head_oid || !/^[a-f0-9]{64}$/.test(value.material_sha256 ?? '')) fail('STANDARD_PR_REVIEW_CONFIRMED_HEAD_REQUIRED');
    return value;
  }
  const requestFor = value => ({ contract_version: 'github-review-evidence-request.v1', pull_request_number: value.pull_request.number,
    expected_pull_request_id: value.pull_request.node_id, expected_head_oid: value.head, expected_base_oid: value.pull_request.base_oid,
    expected_head_ref: value.pull_request.head_branch, expected_base_ref: value.pull_request.base_branch });
  function emit(outcome, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: includeContent ? 'standard-session-pr-review-content-output.v1' : 'standard-session-pr-review-observe-output.v1', operation_ref: includeContent ? 'session_pr_review_content_observe' : 'session_pr_review_observe', outcome,
      effect_status: 'no_effect', facts, observations, evidence_refs };
    if (!valid(value, includeContent ? contentOutputSchema : outputSchema)) fail('STANDARD_PR_REVIEW_OUTPUT_INVALID'); return value;
  }
  return Object.freeze({
    async prepare(instance, input) {
      const confirmed = await source(instance, input);
      return { can_apply: true, input, source_sha256: shadowHash(confirmed), request: requestFor(confirmed) };
    },
    async observe(instance, input, { signal } = {}) {
      try {
        if (signal !== undefined && !(signal instanceof AbortSignal)) fail('STANDARD_PR_REVIEW_SIGNAL_INVALID');
        const before = await source(instance, input, signal), request = requestFor(before), start = now();
        const threadsRequest = { contract_version: includeContent ? 'github-pr-observation-request.v2' : 'github-pr-observation-request.v1',
          ...(includeContent ? { expected_base_oid: request.expected_base_oid, expected_head_ref: request.expected_head_ref, expected_base_ref: request.expected_base_ref } : {}), pull_request_number: request.pull_request_number,
          expected_pull_request_id: request.expected_pull_request_id, expected_head_oid: request.expected_head_oid };
        const collect = async (method, request, assert) => {
          active(signal);
          const value = await method.call(reviewPort, request, { signal });
          active(signal);
          return assert(value);
        };
        const evidence = await collect(observeEvidence, request, includeContent ? assertGithubReviewContent : assertGithubReviewEvidence);
        const threads = await collect(observeThreads, threadsRequest, includeContent ? assertGithubPrContent : assertGithubPrObservation);
        const repeatedThreads = await collect(observeThreads, threadsRequest, includeContent ? assertGithubPrContent : assertGithubPrObservation);
        const repeatedEvidence = await collect(observeEvidence, request, includeContent ? assertGithubReviewContent : assertGithubReviewEvidence);
        const p = before.pull_request;
        for (const observed of [evidence, repeatedEvidence, threads, repeatedThreads]) {
          const from = Date.parse(observed.observed_from), until = Date.parse(observed.observed_until), currentTime = now();
          if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || from < start || until < from || until > currentTime
            || currentTime - from > 300000) fail('STANDARD_PR_REVIEW_STALE_OBSERVATION');
          if (observed.repository.node_id !== p.repository_id || observed.pull_request.node_id !== p.node_id
            || observed.pull_request.number !== p.number || observed.pull_request.head_oid !== p.head_oid
            || observed.pull_request.head_ref !== p.head_branch || observed.pull_request.base_ref !== p.base_branch
            || includeContent && observed.pull_request.base_oid !== p.base_oid
            || observed.pull_request.state !== 'OPEN' || observed.pull_request.is_draft) fail('STANDARD_PR_REVIEW_SOURCE_CHANGED');
        }
        if (evidence.pull_request.base_oid !== p.base_oid || repeatedEvidence.pull_request.base_oid !== p.base_oid
          || evidence.evidence_sha256 !== repeatedEvidence.evidence_sha256 || threads.observation_sha256 !== repeatedThreads.observation_sha256)
          fail('STANDARD_PR_REVIEW_COLLECTION_CHANGED');
        if (shadowHash(await source(instance, input, signal)) !== shadowHash(before) || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
          || !Number.isSafeInteger(start) || now() < start || now() - start > 300000) fail('STANDARD_PR_REVIEW_CONTEXT_CHANGED');
        return emit('completed', { update_operation_id: input.update_operation_id, session_id: before.session_id, head_oid: before.head,
          base_oid: p.base_oid, source_sha256: shadowHash(before), evidence: repeatedEvidence, threads: repeatedThreads,
          acceptance: 'pending-triage-and-policy-evaluation', merge_authorization: 'not-established' },
        { session_pr_review_evidence_available: true, session_pr_triage_required: true }, [
          { ref: 'github:review-evidence/' + p.node_id + '/' + before.head, sha256: repeatedEvidence.evidence_sha256 },
          { ref: 'github:review-threads/' + p.node_id + '/' + before.head, sha256: repeatedThreads.observation_sha256 },
        ]);
      } catch (cause) {
        return emit('blocked', { reason_code: /^[A-Z][A-Z0-9_]{0,127}$/.test(cause.code ?? '') ? cause.code : 'STANDARD_PR_REVIEW_UNAVAILABLE' });
      }
    },
  });
}

export const createStandardSessionPrReviewObservation = options => createObservation(options);
export const createStandardSessionPrReviewContentObservation = options => createObservation(options, true);
