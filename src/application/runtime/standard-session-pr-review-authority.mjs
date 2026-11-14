import { shadowHash } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
// Accepted receipt lookup is a host capability. This reader additionally checks
// its causal checkpoint, canonical postimages and live local/remote Git state.
export function createStandardSessionPrReviewAuthority({ readAcceptedOperation, readCheckpoint, inspectPush, readAcceptedUpdate = (instance, id) => readAcceptedOperation(instance, id, "session_pr_update_push", "STANDARD_PR_REVIEW_UPDATE_REQUIRED"), readRedelivery }) {
  if (![readAcceptedOperation, readCheckpoint, inspectPush].every(fn => typeof fn === 'function')) fail('STANDARD_PR_REVIEW_AUTHORITY_REQUIRED');
  return Object.freeze({ async readConfirmedHead(instance, input, { signal } = {}) {
    const active = () => { if (signal?.aborted) fail('STANDARD_PR_REVIEW_ABORTED'); };
    active();
    const selected = readAcceptedUpdate(instance, input.update_operation_id);
    const plan = selected.record.preview.prepared.plan, output = selected.output;
    const redelivery = selected.record.intent.binding_ref === "session_pr_redelivery_push";
    const key = redelivery ? "integration_operation_id" : "checkpoint_operation_id";
    const source = await (redelivery ? readRedelivery : readCheckpoint)(instance, plan.input, { signal }), p = output.observations.pull_request, result = output.observations.git;
    active();
    if (source[key] !== plan.input[key] || shadowHash(source) !== plan.source_sha256
      || output.outcome !== 'completed' || output.facts.session_pr_head_confirmed !== true || output.facts.session_pr_review_required !== true
      || !['confirmed', 'no_effect'].includes(output.effect_status) || output.observations[key] !== source[key]
      || redelivery && (output.observations.cycle_operation_id !== source.cycle_operation_id || output.observations.previous_update_operation_id !== source.previous_update_operation_id)
      || output.observations.review_head !== source.delivery_head || output.observations.inherited_review_evidence !== 'none'
      || shadowHash(p) !== shadowHash({ ...source.pull_request, head_oid: source.delivery_head })) fail('STANDARD_PR_REVIEW_UPDATE_CHANGED');
    const git = await inspectPush(source.branch, { signal });
    active();
    if (git.head !== source.delivery_head || git.remote_head !== source.delivery_head
      || shadowHash({ ...git, changed: result.changed, effect_status: result.effect_status }) !== shadowHash(result)) fail('STANDARD_PR_REVIEW_REMOTE_CHANGED');
    return { update_operation_id: input.update_operation_id, session_id: source.session_id, head: source.delivery_head, pull_request: p,
      material_sha256: shadowHash({ source, output, git }) };
  } });
}
