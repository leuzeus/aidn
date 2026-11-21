import { externalMergeDisposition } from '../../core/workflow/standard-pr-external-merge.mjs';
import { readExternalMergeForFetch } from './standard-session-pr-external-merge.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertMergeExecuteOutput, mergeExecuteOperation } from '../../core/workflow/standard-pr-merge-execute.mjs';
import { alignedReason, assertPostMergeAlignmentOutput, assertPostMergeFetchOutput, divergentReason, pendingAlignmentReasons, assertPostMergeMeasureOutput,
  postMergeAlignmentOperation, postMergeFetchOperation, postMergeMeasureOperation } from '../../core/workflow/standard-pr-post-merge-fetch.mjs';

const fail = (code, effect_status = 'no_effect') => { throw Object.assign(Error(code), { code, effect_status }); };

export function createStandardSessionPrPostMergeFetch({ readAccepted, readPretriage, readCurrent, reviewPort }) {
  const port = reviewPort?.postMergeFetch;
  function source(instance, input) {
    const intent = instance.events.find(event => event.kind === 'operation_intent'
      && event.intent.operation_id === input.merge_operation_id)?.intent;
    if (intent?.binding_ref === externalMergeDisposition)
      return readExternalMergeForFetch(instance, input.merge_operation_id, readAccepted, readPretriage);
    const { record, output } = readAccepted(instance, input.merge_operation_id, mergeExecuteOperation,
      'STANDARD_PR_POST_MERGE_FETCH_MERGE_REQUIRED');
    const merge = assertMergeExecuteOutput(output).observations.merge;
    if (merge?.operation_id !== input.merge_operation_id || record.operation_id !== input.merge_operation_id)
      fail('STANDARD_PR_POST_MERGE_FETCH_MERGE_REQUIRED');
    return { merge, receiptSha: shadowHash(record.results.at(-1).receipt) };
  }
  function assertGit(git, merge, id) {
    const plan = git?.plan, pull = merge.provider.pull_request;
    if (git?.can_apply !== true || git.plan_sha256 !== shadowHash(plan) || plan.operation_id !== id
      || plan.merge_oid !== pull.merge_oid
      || merge.pre_merge_base_oid && plan.remote_head !== pull.observed_base_tip_oid
      || plan.branch !== pull.base_ref || plan.source_ref !== 'refs/heads/' + pull.base_ref)
      fail('STANDARD_PR_POST_MERGE_FETCH_PLAN_CHANGED');
  }
  function checked(instance, input, prepared, id) {
    const { merge, receiptSha } = source(instance, input), plan = prepared?.plan;
    if (prepared?.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan) || plan.merge_operation_id !== input.merge_operation_id
      || plan.merge_receipt_sha256 !== receiptSha) fail('STANDARD_PR_POST_MERGE_FETCH_PLAN_CHANGED');
    assertGit(plan.git, merge, id);
    return { plan, merge };
  }
  function result(plan, observation, confirmation) {
    const git = plan.git.plan;
    if (observation?.plan_sha256 !== plan.git.plan_sha256 || observation.source_ref !== git.source_ref
      || observation.merge_oid !== git.merge_oid || observation.local_head !== git.local_head
      || observation.fetched_head !== git.remote_head || observation.proof_ref !== git.proof_ref)
      fail('STANDARD_PR_POST_MERGE_FETCH_POSTIMAGE_CHANGED', 'unknown');
    const fetch = { ...observation, merge_operation_id: plan.merge_operation_id,
      merge_receipt_sha256: plan.merge_receipt_sha256, confirmation };
    return assertPostMergeFetchOutput({ contract_version: 'standard-pr-post-merge-fetch-output.v1', operation_ref: postMergeFetchOperation,
      outcome: 'completed', effect_status: confirmation === 'executed' ? 'confirmed' : 'no_effect', facts: {},
      observations: { fetch }, evidence_refs: [{ ref: 'git:' + fetch.proof_ref, sha256: shadowHash(fetch) }] });
  }
  function alignmentSource(instance, input) {
    const { record, output } = readAccepted(instance, input.fetch_operation_id, postMergeFetchOperation,
      'STANDARD_PR_POST_MERGE_ALIGNMENT_FETCH_REQUIRED');
    const { observations: { fetch } } = assertPostMergeFetchOutput(output);
    const { plan, merge } = checked(instance, record.preview.input, record.preview.prepared, input.fetch_operation_id);
    if (!fetch || shadowHash(result(plan, fetch, fetch.confirmation)) !== shadowHash(output))
      fail('STANDARD_PR_POST_MERGE_ALIGNMENT_FETCH_CHANGED');
    return { git: plan.git, fetch, merge, receiptSha: shadowHash(record.results.at(-1).receipt) };
  }
  function alignmentOutput(operation, outcome, reason, alignment = null) {
    const measurement = operation === postMergeMeasureOperation;
    const diverged = measurement && reason === divergentReason;
    const assertOutput = measurement ? assertPostMergeMeasureOutput : assertPostMergeAlignmentOutput;
    return assertOutput({
      contract_version: measurement ? 'standard-pr-post-merge-measure-output.v1' : 'standard-pr-post-merge-alignment-output.v1',
      operation_ref: operation, outcome: diverged ? 'completed' : outcome, effect_status: 'no_effect',
      facts: measurement && (diverged || outcome === 'completed') ? { session_pr_post_merge_diverged: diverged } : {},
      observations: { reason_code: reason, ...(alignment ? { alignment } : {}) },
      evidence_refs: alignment ? [{ ref: 'git:' + alignment.proof_ref, sha256: shadowHash(alignment) }] : [] });
  }
  async function measure(instance, input, source, signal) {
    const { git, fetch, receiptSha } = source;
    if (typeof port?.observeAlignment !== 'function') fail('STANDARD_PR_POST_MERGE_ALIGNMENT_HOST_REQUIRED');
    const value = await port.observeAlignment(git, { expectPlan: git.plan_sha256, signal });
    if (signal?.aborted || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
      || alignmentSource(instance, input).receiptSha !== receiptSha) fail('STANDARD_PR_POST_MERGE_ALIGNMENT_CONTEXT_CHANGED');
    if (value?.source_ref !== fetch.source_ref || value.merge_oid !== fetch.merge_oid
      || value.fetched_head !== fetch.fetched_head || value.proof_ref !== fetch.proof_ref)
      fail('STANDARD_PR_POST_MERGE_ALIGNMENT_WITNESS_CHANGED');
    return { ...value, fetch_operation_id: input.fetch_operation_id, fetch_receipt_sha256: receiptSha };
  }
  return Object.freeze({
    alignmentSource,
    measure,
    readMergedSession({ git }, alignment, sessionId, signal) {
      if (typeof port?.readMergedSession !== 'function') fail('STANDARD_PR_POST_MERGE_SESSION_HOST_REQUIRED');
      return port.readMergedSession(git, { expectPlan: git.plan_sha256, sessionId, alignment, signal });
    },
    supportsFastForward: typeof port?.prepareFastForward === 'function',
    async prepare(instance, input, id) {
      const { merge, receiptSha } = source(instance, input);
      if (!['prepare', 'apply', 'recover'].every(method => typeof port?.[method] === 'function'))
        fail('STANDARD_PR_POST_MERGE_FETCH_HOST_REQUIRED');
      const pull = merge.provider.pull_request;
      const git = await port.prepare({ providerRepository: merge.provider.repository, sourceBranch: pull.base_ref,
        mergeOid: pull.merge_oid, operationId: id });
      assertGit(git, merge, id);
      if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail('STANDARD_PR_POST_MERGE_FETCH_CONTEXT_CHANGED');
      const plan = { merge_operation_id: input.merge_operation_id, merge_receipt_sha256: receiptSha, git };
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async apply(instance, input, prepared, { signal, assertAuthorized, operationId }) {
      const { plan } = checked(instance, input, prepared, operationId);
      const value = await port.apply(plan.git, { write: true, expectPlan: plan.git.plan_sha256, signal, assertAuthorized });
      return result(plan, value, 'executed');
    },
    async recover(instance, input, prepared, { signal, operationId }) {
      try {
        const { plan } = checked(instance, input, prepared, operationId);
        const value = await port.recover(plan.git, { expectPlan: plan.git.plan_sha256, signal });
        return result(plan, value, 'observed');
      } catch {
        return { reason_code: 'STANDARD_PR_POST_MERGE_FETCH_WITNESS_UNAVAILABLE' };
      }
    },
    prepareAlignment(instance, input) {
      const { receiptSha } = alignmentSource(instance, input);
      return { can_apply: true, fetch_receipt_sha256: receiptSha };
    },
    async observeAlignment(instance, input, prepared, { signal, operation = postMergeAlignmentOperation }) {
      const source = alignmentSource(instance, input);
      if (prepared.fetch_receipt_sha256 !== source.receiptSha) fail('STANDARD_PR_POST_MERGE_ALIGNMENT_FETCH_CHANGED');
      let alignment;
      try {
        alignment = await measure(instance, input, source, signal);
      } catch (cause) {
        if (pendingAlignmentReasons.includes(cause.code)
          || operation === postMergeMeasureOperation && cause.code === 'WORKFLOW_POST_MERGE_REMOTE_REF_REQUIRED')
          return alignmentOutput(operation, 'deferred', cause.code);
        throw cause;
      }
      return alignment.ahead === 0 && alignment.behind === 0
        ? alignmentOutput(operation, 'completed', alignedReason, alignment)
        : alignmentOutput(operation, 'deferred', divergentReason, alignment);
    },
  });
}
