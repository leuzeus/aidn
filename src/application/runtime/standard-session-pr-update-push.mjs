import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { shadowHash, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-session-pr-update-push-input.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/standard-session-pr-update-push-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-session-pr-update-push-output.v1.schema.json' with { type: 'json' };
import redeliveryInput from '../../core/contracts/workflow-definition/standard-session-pr-redelivery-push-input.v1.schema.json' with { type: 'json' };
import redeliveryPlan from '../../core/contracts/workflow-definition/standard-session-pr-redelivery-push-plan.v1.schema.json' with { type: 'json' };
import redeliveryOutput from '../../core/contracts/workflow-definition/standard-session-pr-redelivery-push-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (x, schema) => !checkShadowJson(x) && !validateJsonSchema(x, schema, '$', { contractKind: 'workflow-definition' }).length;
// Only the accepted successor checkpoint can select this update. The initial
// admission/push receipts remain historical; no stale delivery source is reused.
export function createStandardSessionPrUpdatePush({ targetRoot, readCheckpoint, readCurrent, pushPort, pullRequestPort, now = Date.now, redelivery = false }) {
  const inputContract = redelivery ? redeliveryInput : inputSchema, planContract = redelivery ? redeliveryPlan : planSchema, outputContract = redelivery ? redeliveryOutput : outputSchema;
  const operationRef = redelivery ? "session_pr_redelivery_push" : "session_pr_update_push";
  const predecessorKey = redelivery ? "integration_operation_id" : "checkpoint_operation_id";
  if (![readCheckpoint, readCurrent, pushPort?.inspect, pushPort?.push, pullRequestPort?.prepare].every(fn => typeof fn === 'function')) fail('STANDARD_PR_UPDATE_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  async function observe(source, head, operationId) {
    const prepared = await pullRequestPort.prepare({ ...source.request, head_oid: head }, operationId);
    const expected = { ...source.pull_request, head_oid: head };
    if (!prepared?.can_apply || shadowHash(prepared.plan) !== prepared.plan_sha256 || shadowHash(prepared.plan.observed.existing) !== shadowHash(expected))
      fail('STANDARD_PR_UPDATE_REMOTE_CHANGED');
    return prepared.plan.observed.existing;
  }
  async function prepare(instance, input, id, at, acquired = false) {
    if (!valid(input, inputContract) || !/^op_[a-f0-9]{40}$/.test(id ?? '')) fail('STANDARD_PR_UPDATE_INPUT_INVALID');
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' };
    const source = await readCheckpoint(instance, input);
    if (source[predecessorKey] !== input[predecessorKey] || source.branch !== source.pull_request.head_branch
      || source.parent_head !== source.pull_request.head_oid || source.pull_request.state !== 'OPEN' || source.pull_request.draft) fail('STANDARD_PR_UPDATE_CHECKPOINT_REQUIRED');
    const git = await pushPort.inspect(source.branch);
    if (git.head !== source.delivery_head || git.branch !== source.branch || git.remote_head !== source.parent_head) fail('STANDARD_PR_UPDATE_GIT_CHANGED');
    const pull_request = await observe(source, source.parent_head, id);
    const plan = { contract_version: planContract.properties.contract_version.const, operation_ref: operationRef, operation_id: id, input,
      prepared_at_ms: at, source_sha256: shadowHash(source), session_id: source.session_id, git, pull_request };
    if (!valid(plan, planContract)) fail('STANDARD_PR_UPDATE_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: outputContract.properties.contract_version.const, operation_ref: operationRef, outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(value, outputContract)) fail('STANDARD_PR_UPDATE_OUTPUT_INVALID'); return value;
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan, age = now() - plan?.prepared_at_ms;
      if (!prepared?.can_apply || !valid(plan, planContract) || write !== true || typeof assertAuthorized !== 'function'
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || !Number.isSafeInteger(age) || age < 0 || age > 300000)
        fail('STANDARD_PR_UPDATE_EXPLICIT_EFFECT_REQUIRED');
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail('STANDARD_PR_UPDATE_PREVIEW_CHANGED');
        } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
        let attempted = false, result = null;
        try {
          const source = await readCheckpoint(instance, plan.input);
          attempted = true; result = await pushPort.push(plan.git, { write: true, assertAuthorized });
          if (!['confirmed', 'no_effect'].includes(result.effect_status) || result.head !== plan.git.head || result.remote_head !== plan.git.head
            || result.branch !== plan.git.branch || result.ref !== plan.git.ref || result.remote_identity_sha256 !== plan.git.remote_identity_sha256
            || result.local_sha256 !== plan.git.local_sha256 || result.profile !== plan.git.profile) throw Error('STANDARD_PR_UPDATE_UNCONFIRMED');
          const pull_request = await observe(source, result.head, plan.operation_id);
          if (shadowHash(await readCheckpoint(instance, plan.input)) !== plan.source_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000)
            throw Error('STANDARD_PR_UPDATE_CONTEXT_CHANGED');
          await assertAuthorized();
          // Authorization can await a remote authority. Authenticate the source
          // and current instance again after that boundary before completion.
          if (shadowHash(await readCheckpoint(instance, plan.input)) !== plan.source_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000)
            throw Error('STANDARD_PR_UPDATE_CONTEXT_CHANGED');
          // Consumers must bind review/checks to this head. No approval/check
          // from the previous SHA is carried as acceptance for this revision.
          return emit('completed', result.effect_status, { [predecessorKey]: plan.input[predecessorKey],
            ...(redelivery ? { cycle_operation_id: plan.input.cycle_operation_id, previous_update_operation_id: source.previous_update_operation_id } : {}),
            session_id: plan.session_id, git: result, pull_request, previous_head: plan.pull_request.head_oid,
            review_head: result.head, review: 'pending', checks: 'pending', inherited_review_evidence: 'none' },
          { session_pr_head_confirmed: true, session_pr_review_required: true }, [{ ref: 'github:pull-request-head/' + pull_request.node_id, sha256: shadowHash({ git: result, pull_request }) }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== 'confirmed' && (!attempted || cause.effect_status === 'no_effect');
          return emit(noEffect ? 'blocked' : 'reconciliation_required', noEffect ? 'no_effect' : 'unknown', { reason_code: cause.code ?? 'STANDARD_PR_UPDATE_UNCONFIRMED' });
        }
      });
    },
  });
}
