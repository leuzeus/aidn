import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-session-pr-open-input.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/standard-session-pr-open-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-session-pr-open-output.v1.schema.json' with { type: 'json' };
import linkSchema from '../../core/contracts/workflow-definition/github-pr-link.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (x, schema) => !checkShadowJson(x) && !validateJsonSchema(x, schema, '$', { contractKind: 'workflow-definition' }).length;
export function createStandardSessionPrOpen({ targetRoot, readPush, readCurrent, pullRequestPort, now = Date.now }) {
  if (![readPush, readCurrent, pullRequestPort?.prepare, pullRequestPort?.apply].every(fn => typeof fn === 'function')) fail('STANDARD_SESSION_PR_OPEN_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  async function prepare(instance, input, id, at, acquired = false) {
    if (!valid(input, inputSchema) || !/^op_[a-f0-9]{40}$/.test(id ?? '')) fail('STANDARD_SESSION_PR_OPEN_INPUT_INVALID');
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' };
    const source = await readPush(instance, input), output = source?.output, admission = source?.admission;
    if (source?.push_operation_id !== input.push_operation_id || output?.outcome !== 'completed' || !['confirmed', 'no_effect'].includes(output.effect_status)
      || output.facts.session_remote_head_confirmed !== true || output.observations.git.head !== output.observations.git.remote_head
      || admission?.outcome !== 'completed' || admission.facts.session_pr_admitted !== true || admission.observations.head !== output.observations.git.head
      || admission.observations.session_branch !== output.observations.git.branch || admission.observations.session_id !== output.observations.session_id)
      fail('STANDARD_SESSION_PR_OPEN_PUSH_REQUIRED');
    const request = { contract_version: 'github-pr-open-request.v1', head_branch: output.observations.git.branch,
      base_branch: admission.observations.admission.source_branch, head_oid: output.observations.git.head,
      title: 'Session ' + output.observations.session_id, body: 'AIDN delivery for session ' + output.observations.session_id + '.' };
    const provider = await pullRequestPort.prepare(request, id);
    const plan = { contract_version: 'standard-session-pr-open-plan.v1', operation_ref: 'session_pr_open', operation_id: id, input,
      prepared_at_ms: at, push_source_sha256: shadowHash(source), session_id: output.observations.session_id, provider };
    if (!provider?.can_apply || provider.plan_sha256 !== shadowHash(provider.plan) || !valid(plan, planSchema)) fail('STANDARD_SESSION_PR_OPEN_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: 'standard-session-pr-open-output.v1', operation_ref: 'session_pr_open', outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail('STANDARD_SESSION_PR_OPEN_OUTPUT_INVALID'); return value;
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      if (!prepared?.can_apply || !valid(plan, planSchema) || write !== true || typeof assertAuthorized !== 'function'
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        fail('STANDARD_SESSION_PR_OPEN_EXPLICIT_EFFECT_REQUIRED');
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail('STANDARD_SESSION_PR_OPEN_PREVIEW_CHANGED');
        } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
        let attempted = false, result = null;
        try {
          attempted = true; result = await pullRequestPort.apply(plan.provider, { write: true, expectPlan: plan.provider.plan_sha256, assertAuthorized });
          const link = result?.pull_request, request = plan.provider.plan.request;
          if (!['confirmed', 'no_effect'].includes(result?.effect_status) || !['created', 'recovered'].includes(result.action) || !valid(link, linkSchema)
            || link.head_oid !== request.head_oid || link.head_branch !== request.head_branch || link.base_branch !== request.base_branch
            || link.base_oid !== plan.provider.plan.observed.base_oid || link.repository_id !== plan.provider.plan.observed.repository.node_id || link.state !== 'OPEN' || link.draft)
            throw Error('STANDARD_SESSION_PR_OPEN_UNCONFIRMED');
          if (shadowHash(await readPush(instance, plan.input)) !== plan.push_source_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            throw Error('STANDARD_SESSION_PR_OPEN_CONTEXT_CHANGED');
          await assertAuthorized();
          return emit('completed', result.effect_status, { push_operation_id: plan.input.push_operation_id, session_id: plan.session_id, action: result.action, pull_request: link },
            { session_pr_open_confirmed: true }, [{ ref: 'github:pull-request/' + link.node_id, sha256: shadowHash(result) }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== 'confirmed' && (!attempted || cause.effect_status === 'no_effect');
          return emit(noEffect ? 'blocked' : 'reconciliation_required', noEffect ? 'no_effect' : 'unknown', { reason_code: cause.code ?? 'STANDARD_SESSION_PR_OPEN_UNCONFIRMED' });
        }
      });
    },
  });
}
