import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { assertGithubReviewEvidence } from '../../adapters/git-provider/github-review-evidence.mjs';
import { assertGithubPrObservation } from '../../adapters/git-provider/github-workflow-adapter.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-session-pr-review-observe-input.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-session-pr-review-observe-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
// A deterministic read on the accepted successor push. It retains provider
// evidence, not triage/approval, a completed skill or permission to merge.
export function createStandardSessionPrReviewObservation({ readConfirmedHead, readCurrent, reviewPort, now = Date.now }) {
  if (![readConfirmedHead, readCurrent, reviewPort?.observeReviewEvidence, reviewPort?.observePullRequest].every(fn => typeof fn === 'function'))
    fail('STANDARD_PR_REVIEW_AUTHORITY_REQUIRED');
  async function source(instance, input) {
    if (!valid(input, inputSchema)) fail('STANDARD_PR_REVIEW_INPUT_INVALID');
    const value = await readConfirmedHead(instance, input), p = value?.pull_request;
    if (value?.update_operation_id !== input.update_operation_id || p?.state !== 'OPEN' || p.draft
      || value.head !== p.head_oid || !/^[a-f0-9]{64}$/.test(value.material_sha256 ?? '')) fail('STANDARD_PR_REVIEW_CONFIRMED_HEAD_REQUIRED');
    return value;
  }
  const requestFor = value => ({ contract_version: 'github-review-evidence-request.v1', pull_request_number: value.pull_request.number,
    expected_pull_request_id: value.pull_request.node_id, expected_head_oid: value.head, expected_base_oid: value.pull_request.base_oid,
    expected_head_ref: value.pull_request.head_branch, expected_base_ref: value.pull_request.base_branch });
  function emit(outcome, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: 'standard-session-pr-review-observe-output.v1', operation_ref: 'session_pr_review_observe', outcome,
      effect_status: 'no_effect', facts, observations, evidence_refs };
    if (!valid(value, outputSchema)) fail('STANDARD_PR_REVIEW_OUTPUT_INVALID'); return value;
  }
  return Object.freeze({
    async prepare(instance, input) {
      const confirmed = await source(instance, input);
      return { can_apply: true, input, source_sha256: shadowHash(confirmed), request: requestFor(confirmed) };
    },
    async observe(instance, input) {
      try {
        const before = await source(instance, input), request = requestFor(before), start = now();
        const threadsRequest = { contract_version: 'github-pr-observation-request.v1', pull_request_number: request.pull_request_number,
          expected_pull_request_id: request.expected_pull_request_id, expected_head_oid: request.expected_head_oid };
        const evidence = assertGithubReviewEvidence(await reviewPort.observeReviewEvidence(request));
        const threads = assertGithubPrObservation(await reviewPort.observePullRequest(threadsRequest));
        const repeatedThreads = assertGithubPrObservation(await reviewPort.observePullRequest(threadsRequest));
        const repeatedEvidence = assertGithubReviewEvidence(await reviewPort.observeReviewEvidence(request));
        const p = before.pull_request;
        for (const observed of [evidence, repeatedEvidence, threads, repeatedThreads]) {
          const from = Date.parse(observed.observed_from), until = Date.parse(observed.observed_until), currentTime = now();
          if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || from < start || until < from || until > currentTime
            || currentTime - from > 300000) fail('STANDARD_PR_REVIEW_STALE_OBSERVATION');
          if (observed.repository.node_id !== p.repository_id || observed.pull_request.node_id !== p.node_id
            || observed.pull_request.number !== p.number || observed.pull_request.head_oid !== p.head_oid
            || observed.pull_request.head_ref !== p.head_branch || observed.pull_request.base_ref !== p.base_branch
            || observed.pull_request.state !== 'OPEN' || observed.pull_request.is_draft) fail('STANDARD_PR_REVIEW_SOURCE_CHANGED');
        }
        if (evidence.pull_request.base_oid !== p.base_oid || repeatedEvidence.pull_request.base_oid !== p.base_oid
          || evidence.evidence_sha256 !== repeatedEvidence.evidence_sha256 || threads.observation_sha256 !== repeatedThreads.observation_sha256)
          fail('STANDARD_PR_REVIEW_COLLECTION_CHANGED');
        if (shadowHash(await source(instance, input)) !== shadowHash(before) || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
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
