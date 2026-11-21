import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertPostMergeDecisionOutput, behindOnly, postMergeDecisionOperation, postMergeDecisionQuestion,
  postMergeFastForwardChoice } from '../../core/workflow/standard-pr-post-merge-decision.mjs';
import { assertPostMergeFastForwardOutput, assertPostMergeFastForwardPlan, postMergeFastForwardOperation } from '../../core/workflow/standard-pr-post-merge-fast-forward.mjs';

const fail = (code, effect_status = 'no_effect') => { throw Object.assign(Error(code), { code, effect_status }); };
const required = 'STANDARD_PR_POST_MERGE_FAST_FORWARD_DECISION_REQUIRED';

export function createStandardPostMergeFastForward({ postMerge, decision, reviewPort, readAccepted, readCurrent, verifyDecision }) {
  const port = reviewPort?.postMergeFetch;
  function source(instance, input) {
    const { record, output } = readAccepted(instance, input.decision_operation_id, postMergeDecisionOperation, required);
    const { observations } = assertPostMergeDecisionOutput(output), question = postMergeDecisionQuestion(record);
    const { alignment } = question.subject;
    if (observations.choice !== postMergeFastForwardChoice || !question.choices.includes(postMergeFastForwardChoice)
      || observations.question_sha256 !== shadowHash(question) || observations.subject_sha256 !== shadowHash(question.subject)
      || !behindOnly(alignment)) fail(required);
    const fetch = postMerge.alignmentSource(instance, alignment);
    if (alignment.fetch_receipt_sha256 !== fetch.receiptSha || question.subject.merge_receipt_sha256 !== fetch.fetch.merge_receipt_sha256
      || question.subject.merge_operation_id !== fetch.fetch.merge_operation_id
      || ['source_ref', 'merge_oid', 'fetched_head', 'proof_ref'].some(key => alignment[key] !== fetch.fetch[key])) fail(required);
    return { record, question, alignment, fetch, decisionSha: shadowHash(record.results.at(-1).receipt) };
  }

  function planFor(id, selected, git) {
    const { source_ref, local_head, remote_head, behind } = selected.alignment;
    if (git?.operation_id !== id || git.source_ref !== source_ref || git.local_head !== local_head || git.remote_head !== remote_head
      || git.behind !== behind || git.fetch_plan_sha256 !== selected.fetch.git.plan_sha256) fail('STANDARD_PR_POST_MERGE_FAST_FORWARD_PLAN_CHANGED');
    return assertPostMergeFastForwardPlan({ contract_version: 'standard-pr-post-merge-fast-forward-plan.v1',
      decision_operation_id: selected.record.operation_id, decision_receipt_sha256: selected.decisionSha,
      subject_sha256: shadowHash(selected.question.subject), git });
  }

  function checked(instance, input, prepared, id) {
    const selected = source(instance, input), plan = prepared?.plan;
    if (prepared?.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan)
      || prepared.plan_sha256 !== shadowHash(planFor(id, selected, plan.git))) fail('STANDARD_PR_POST_MERGE_FAST_FORWARD_PLAN_CHANGED');
    return { selected, plan };
  }

  function result(plan, value, confirmation) {
    const git = plan.git;
    if (value?.plan_sha256 !== shadowHash(git) || ['source_ref', 'local_head', 'remote_head'].some(key => value[key] !== git[key]))
      fail('STANDARD_PR_POST_MERGE_FAST_FORWARD_POSTIMAGE_CHANGED', 'unknown');
    const fast_forward = { ...value, confirmation, decision_receipt_sha256: plan.decision_receipt_sha256 };
    return assertPostMergeFastForwardOutput({ contract_version: 'standard-pr-post-merge-fast-forward-output.v1',
      operation_ref: postMergeFastForwardOperation, outcome: 'completed', effect_status: confirmation === 'executed' ? 'confirmed' : 'no_effect',
      facts: {}, observations: { fast_forward },
      evidence_refs: [{ ref: 'git:' + git.source_ref, sha256: shadowHash(fast_forward) }] });
  }

  return Object.freeze({
    async prepare(instance, input, id) {
      const selected = source(instance, input);
      if (!['prepareFastForward', 'applyFastForward', 'recoverFastForward'].every(name => typeof port?.[name] === 'function'))
        fail('STANDARD_PR_POST_MERGE_FAST_FORWARD_HOST_REQUIRED');
      decision.assertAge(selected.record.preview.prepared);
      const git = await port.prepareFastForward(selected.fetch.git, { alignment: selected.alignment, operationId: id });
      if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail('STANDARD_PR_POST_MERGE_FAST_FORWARD_CONTEXT_CHANGED');
      const plan = planFor(id, selected, git);
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    async apply(instance, input, prepared, { signal, operationId, assertAuthorized }) {
      const { selected, plan } = checked(instance, input, prepared, operationId);
      try {
        decision.assertAge(selected.record.preview.prepared);
        await verifyDecision(selected.record, signal);
      } catch (cause) { throw Object.assign(cause, { effect_status: 'no_effect' }); }
      const value = await port.applyFastForward(plan.git, selected.fetch.git, { write: true, expectPlan: shadowHash(plan.git), signal,
        async assertAuthorized() {
          await assertAuthorized();
          decision.assertAge(selected.record.preview.prepared);
        } });
      return result(plan, value, 'executed');
    },
    async recover(instance, input, prepared, { signal, operationId }) {
      try {
        const { selected, plan } = checked(instance, input, prepared, operationId);
        const value = await port.recoverFastForward(plan.git, selected.fetch.git, { expectPlan: shadowHash(plan.git), signal });
        return result(plan, value, 'observed');
      } catch (cause) {
        return { reason_code: cause.code ?? 'STANDARD_PR_POST_MERGE_FAST_FORWARD_WITNESS_UNAVAILABLE' };
      }
    },
  });
}
