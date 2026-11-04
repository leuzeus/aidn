import { shadowHash } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };

// Accepted journals, current canonical closure and physical integration are
// authenticated by host capabilities. An old checkpoint or PR marker cannot
// authorize delivery of a corrective HEAD.
export function createStandardSessionPrRedeliveryAuthority({ readAcceptedOperation, readAcceptedUpdate, readIntegration, inspectIntegration }) {
  if (![readAcceptedOperation, readAcceptedUpdate, readIntegration, inspectIntegration].every(fn => typeof fn === 'function'))
    fail('STANDARD_PR_REDELIVERY_AUTHORITY_REQUIRED');
  return Object.freeze({ async readSource(instance, input) {
    const integrated = await readIntegration(instance, input);
    const { plan, output, canonical } = integrated;
    const cycle = readAcceptedOperation(instance, input.cycle_operation_id, 'session_pr_correction_cycle_initialize');
    const cyclePlan = cycle.record.preview.prepared.plan, origin = cyclePlan.origin;
    const integration = readAcceptedOperation(instance, input.integration_operation_id, 'session_branch_integrate');
    if (integration.record.operation_id !== integrated.integration_operation_id
      || shadowHash(integration.record.preview.prepared.plan) !== shadowHash(plan) || shadowHash(integration.output) !== shadowHash(output)
      || output.outcome !== 'completed' || output.effect_status !== 'confirmed' || output.facts.session_branch_integrated !== true
      || output.observations.decision_operation_id !== plan.input.decision_operation_id
      || cycle.output.outcome !== 'completed' || cycle.output.effect_status !== 'confirmed'
      || cycle.output.facts.session_pr_correction_cycle_initialized !== true
      || cyclePlan.input.cycle_id !== canonical.cycle_id || cyclePlan.review.session_id !== canonical.session_id
      || origin.session_id !== canonical.session_id || origin.pull_request.head_branch !== canonical.target_branch)
      fail('STANDARD_PR_REDELIVERY_CORRECTION_REQUIRED');
    const previous = readAcceptedUpdate(instance, origin.update_operation_id);
    const prior = previous.output, pull_request = origin.pull_request;
    if (prior.outcome !== 'completed' || !['confirmed', 'no_effect'].includes(prior.effect_status)
      || prior.facts.session_pr_head_confirmed !== true || prior.observations.session_id !== canonical.session_id
      || shadowHash(prior.observations.pull_request) !== shadowHash(pull_request)
      || pull_request.state !== 'OPEN' || pull_request.draft)
      fail('STANDARD_PR_REDELIVERY_PREVIOUS_HEAD_REQUIRED');
    // Select the immutable original request by the authenticated PR identity.
    // Its old postimages are historical; current closure comes from integration.
    const opened = instance.events.filter(event => event.kind === 'operation_result' && event.receipt.outcome === 'completed')
      .map(event => instance.events.find(row => row.kind === 'operation_intent' && row.intent.operation_id === event.receipt.operation_id)?.intent)
      .filter(intent => intent?.binding_ref === 'session_pr_open')
      .map(intent => readAcceptedOperation(instance, intent.operation_id, 'session_pr_open'))
      .filter(row => row.output.observations.pull_request?.node_id === pull_request.node_id
        && row.output.observations.pull_request.repository_id === pull_request.repository_id);
    if (opened.length !== 1) fail('STANDARD_PR_REDELIVERY_ORIGINAL_REQUEST_REQUIRED');
    const open = opened[0], link = open.output.observations.pull_request;
    const request = open.record.preview.prepared.plan.provider.plan.request;
    if (open.output.outcome !== 'completed' || !['confirmed', 'no_effect'].includes(open.output.effect_status)
      || open.output.facts.session_pr_open_confirmed !== true || open.output.observations.session_id !== canonical.session_id
      || link.head_branch !== pull_request.head_branch || link.base_branch !== pull_request.base_branch
      || request.head_branch !== pull_request.head_branch || request.base_branch !== pull_request.base_branch)
      fail('STANDARD_PR_REDELIVERY_ORIGINAL_REQUEST_REQUIRED');
    const proof = await inspectIntegration(plan);
    if (proof.status !== 'confirmed' || shadowHash(proof) !== shadowHash(output.observations.git)
      || proof.head !== canonical.delivery_head || proof.target_branch !== canonical.target_branch
      || proof.source_branch !== canonical.source_branch)
      fail('STANDARD_PR_REDELIVERY_INTEGRATION_CHANGED');
    return { integration_operation_id: input.integration_operation_id, cycle_operation_id: input.cycle_operation_id,
      previous_update_operation_id: origin.update_operation_id, session_id: canonical.session_id,
      branch: canonical.target_branch, parent_head: pull_request.head_oid, delivery_head: proof.head, pull_request, request,
      material_sha256: shadowHash({ integrated, cycle, previous, open, proof }) };
  } });
}
