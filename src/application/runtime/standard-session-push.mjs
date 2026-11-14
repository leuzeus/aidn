import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { shadowHash, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-session-push-input.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/standard-session-push-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-session-push-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
// The source capability authenticates the accepted admission and canonical
// integration chain. A caller-supplied success/PR marker is not this capability.
export function createStandardSessionPush({ targetRoot, readAdmission, readCurrent, pushPort, now = Date.now }) {
  if (![readAdmission, readCurrent, pushPort?.inspect, pushPort?.push].every(fn => typeof fn === 'function')) fail('STANDARD_SESSION_PUSH_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  async function prepare(instance, input, operationId, at, acquired = false) {
    if (!valid(input, inputSchema) || !/^op_[a-f0-9]{40}$/.test(operationId ?? '')) fail('STANDARD_SESSION_PUSH_INPUT_INVALID');
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' };
    const source = await readAdmission(instance, input), output = source?.output;
    if (source?.admission_operation_id !== input.admission_operation_id || output?.outcome !== 'completed' || output.effect_status !== 'no_effect'
      || output.facts.session_pr_admitted !== true || !/^S[0-9]{3,6}$/.test(output.observations.session_id ?? '')
      || typeof output.facts.session_push_required !== 'boolean' || typeof output.facts.session_pr_open_required !== 'boolean'
      || output.facts.session_push_required === output.facts.session_pr_open_required) fail('STANDARD_SESSION_PUSH_ADMISSION_REQUIRED');
    const git = await pushPort.inspect(output.observations.session_branch);
    if (git.head !== output.observations.head || git.branch !== output.observations.session_branch) fail('STANDARD_SESSION_PUSH_ADMISSION_CHANGED');
    const plan = { contract_version: 'standard-session-push-plan.v1', operation_ref: 'session_push', operation_id: operationId, input,
      prepared_at_ms: at, admission_sha256: shadowHash(source), session_id: output.observations.session_id, git };
    if (!valid(plan, planSchema)) fail('STANDARD_SESSION_PUSH_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: 'standard-session-push-output.v1', operation_ref: 'session_push', outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail('STANDARD_SESSION_PUSH_OUTPUT_INVALID'); return value;
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      if (!prepared?.can_apply || !valid(plan, planSchema) || write !== true || typeof assertAuthorized !== 'function'
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        fail('STANDARD_SESSION_PUSH_EXPLICIT_EFFECT_REQUIRED');
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail('STANDARD_SESSION_PUSH_PREVIEW_CHANGED');
        } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
        let attempted = false, result = null;
        try {
          attempted = true; result = await pushPort.push(plan.git, { write: true, assertAuthorized });
          if (!['confirmed', 'no_effect'].includes(result.effect_status) || result.head !== plan.git.head || result.remote_head !== plan.git.head
            || result.branch !== plan.git.branch || result.ref !== plan.git.ref || result.remote_identity_sha256 !== plan.git.remote_identity_sha256
            || result.local_sha256 !== plan.git.local_sha256 || result.profile !== plan.git.profile) throw Error('STANDARD_SESSION_PUSH_UNCONFIRMED');
          // Canonical closure/admission and the instance must remain current
          // after transport. The original admission is not reissued or patched.
          if (shadowHash(await readAdmission(instance, plan.input)) !== plan.admission_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            throw Error('STANDARD_SESSION_PUSH_CONTEXT_CHANGED');
          await assertAuthorized();
          return emit('completed', result.effect_status, { admission_operation_id: plan.input.admission_operation_id, session_id: plan.session_id, git: result },
            { session_remote_head_confirmed: true }, [{ ref: 'git:session-push/' + plan.operation_id, sha256: shadowHash(result) }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== 'confirmed' && (!attempted || cause.effect_status === 'no_effect');
          return emit(noEffect ? 'blocked' : 'reconciliation_required', noEffect ? 'no_effect' : 'unknown', { reason_code: cause.code ?? 'STANDARD_SESSION_PUSH_UNCONFIRMED' });
        }
      });
    },
  });
}
