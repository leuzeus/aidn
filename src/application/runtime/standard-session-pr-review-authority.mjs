import { shadowHash } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
// Accepted receipt lookup is a host capability. This reader additionally checks
// its causal checkpoint, canonical postimages and live local/remote Git state.
export function createStandardSessionPrReviewAuthority({ readAcceptedOperation, readCheckpoint, inspectPush }) {
  if (![readAcceptedOperation, readCheckpoint, inspectPush].every(fn => typeof fn === 'function')) fail('STANDARD_PR_REVIEW_AUTHORITY_REQUIRED');
  return Object.freeze({ async readConfirmedHead(instance, input) {
    const selected = readAcceptedOperation(instance, input.update_operation_id, 'session_pr_update_push', 'STANDARD_PR_REVIEW_UPDATE_REQUIRED');
    const plan = selected.record.preview.prepared.plan, output = selected.output;
    const source = await readCheckpoint(instance, plan.input), p = output.observations.pull_request, result = output.observations.git;
    if (source.checkpoint_operation_id !== plan.input.checkpoint_operation_id || shadowHash(source) !== plan.source_sha256
      || output.outcome !== 'completed' || output.facts.session_pr_head_confirmed !== true || output.facts.session_pr_review_required !== true
      || !['confirmed', 'no_effect'].includes(output.effect_status) || output.observations.checkpoint_operation_id !== source.checkpoint_operation_id
      || output.observations.review_head !== source.delivery_head || output.observations.inherited_review_evidence !== 'none'
      || shadowHash(p) !== shadowHash({ ...source.pull_request, head_oid: source.delivery_head })) fail('STANDARD_PR_REVIEW_UPDATE_CHANGED');
    const git = await inspectPush(source.branch);
    if (git.head !== source.delivery_head || git.remote_head !== source.delivery_head
      || shadowHash({ ...git, changed: result.changed, effect_status: result.effect_status }) !== shadowHash(result)) fail('STANDARD_PR_REVIEW_REMOTE_CHANGED');
    return { update_operation_id: input.update_operation_id, session_id: source.session_id, head: source.delivery_head, pull_request: p,
      material_sha256: shadowHash({ source, output, git }) };
  } });
}
