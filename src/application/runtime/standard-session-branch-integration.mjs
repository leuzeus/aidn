import { createLocalWorkflowBranchIntegration } from '../../adapters/runtime/local-workflow-branch-integration.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { assertSessionBranchIntegrationReview, sessionBranchIntegrationChoices } from '../../core/workflow/standard-session-branch-integration-decision.mjs';
import { shadowHash, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import reviewInput from '../../core/contracts/workflow-definition/standard-session-branch-integration-review-input.v1.schema.json' with { type: 'json' };
import reviewPlan from '../../core/contracts/workflow-definition/standard-session-branch-integration-review-plan.v1.schema.json' with { type: 'json' };
import effectInput from '../../core/contracts/workflow-definition/standard-session-branch-integrate-input.v1.schema.json' with { type: 'json' };
import effectPlan from '../../core/contracts/workflow-definition/standard-session-branch-integrate-plan.v1.schema.json' with { type: 'json' };
import effectOutput from '../../core/contracts/workflow-definition/standard-session-branch-integrate-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
// readSource authenticates the actual closure and delivery chain, then reads
// canonical CLOSED session / retained DONE cycle bytes. readDecision supplies
// only an accepted same-instance human capture. Neither is selected by IR data.
export function createStandardSessionBranchIntegration({ targetRoot, readSource, readDecision, readCurrent, now = Date.now }) {
  if (![readSource, readDecision, readCurrent].every(fn => typeof fn === 'function')) fail('STANDARD_SESSION_INTEGRATION_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const port = () => createLocalWorkflowBranchIntegration({ targetRoot: artifacts.root });
  async function observe(instance, input) {
    if (!valid(input, reviewInput)) fail('STANDARD_SESSION_INTEGRATION_INPUT_INVALID');
    const source = await readSource(instance, input), git = port().inspect(source);
    const review = assertSessionBranchIntegrationReview({ ...source, git });
    if (review.delivery_operation_id !== input.delivery_operation_id || review.closure_operation_id !== input.closure_operation_id)
      fail('STANDARD_SESSION_INTEGRATION_SOURCE_CHANGED');
    return review;
  }
  async function assertFresh(instance, plan) {
    if (!valid(plan, reviewPlan)) fail('STANDARD_SESSION_INTEGRATION_PLAN_INVALID');
    const review = await observe(instance, plan.input);
    if (shadowHash(review) !== shadowHash(plan.review) || shadowHash(plan.choices) !== shadowHash(sessionBranchIntegrationChoices))
      fail('STANDARD_SESSION_INTEGRATION_REVIEW_CHANGED');
    return review;
  }
  async function prepare(instance, input, operationId, at, acquired = false) {
    if (!valid(input, effectInput) || !/^op_[a-f0-9]{40}$/.test(operationId ?? '')) fail('STANDARD_SESSION_INTEGRATION_INPUT_INVALID');
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' };
    const decision = await readDecision(instance, input);
    if (decision.decision_operation_id !== input.decision_operation_id || decision.choice !== 'integrate-to-session'
      || !/^[a-f0-9]{64}$/.test(decision.source_sha256 ?? '')) fail('STANDARD_SESSION_INTEGRATION_DECISION_REQUIRED');
    const review = await assertFresh(instance, decision.plan);
    const plan = { contract_version: 'standard-session-branch-integrate-plan.v1', operation_ref: 'session_branch_integrate', input,
      operation_id: operationId, prepared_at_ms: at, decision_source_sha256: decision.source_sha256, review };
    if (!valid(plan, effectPlan)) fail('STANDARD_SESSION_INTEGRATION_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const output = { contract_version: 'standard-session-branch-integrate-output.v1', operation_ref: 'session_branch_integrate', outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(output, effectOutput)) fail('STANDARD_SESSION_INTEGRATION_OUTPUT_INVALID'); return output;
  }
  return Object.freeze({ assertFresh,
    async prepareDecision(instance, input) {
      const review = await observe(instance, input), plan = { contract_version: 'standard-session-branch-integration-review-plan.v1',
        operation_ref: 'session_branch_integration_decision', input, review, choices: [...sessionBranchIntegrationChoices] };
      if (!valid(plan, reviewPlan)) fail('STANDARD_SESSION_INTEGRATION_PLAN_INVALID');
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan, age = now() - plan?.prepared_at_ms;
      if (!valid(plan, effectPlan) || !prepared?.can_apply || write !== true || typeof assertAuthorized !== 'function'
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || !Number.isSafeInteger(age) || age < 0 || age > 300000)
        throw Object.assign(Error('STANDARD_SESSION_INTEGRATION_EXPLICIT_EFFECT_REQUIRED'), { code: 'STANDARD_SESSION_INTEGRATION_EXPLICIT_EFFECT_REQUIRED', effect_status: 'no_effect' });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail('STANDARD_SESSION_INTEGRATION_PREVIEW_CHANGED');
        } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
        let attempted = false, result = null;
        try {
          const git = port(), gitPlan = { operation_id: plan.operation_id, plan_sha256: expectPlan, observed: plan.review.git };
          attempted = true; result = await git.integrate(gitPlan, { write: true, assertAuthorized });
          const source = await readSource(instance, { contract_version: 'standard-session-branch-integration-review-input.v1',
            delivery_operation_id: plan.review.delivery_operation_id, closure_operation_id: plan.review.closure_operation_id });
          const { git: observed, ...reviewSource } = plan.review;
          if (git.inspectIntegration(gitPlan).status !== 'confirmed' || shadowHash(source) !== shadowHash(reviewSource)
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000)
            fail('STANDARD_SESSION_INTEGRATION_UNCONFIRMED');
          await assertAuthorized();
          return emit('completed', 'confirmed', { decision_operation_id: plan.input.decision_operation_id, git: result },
            { session_branch_integrated: true }, [{ ref: 'git:session-integration/' + plan.operation_id, sha256: shadowHash(result) }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== 'confirmed' && (!attempted || cause.effect_status === 'no_effect');
          return emit(noEffect ? 'blocked' : 'reconciliation_required', noEffect ? 'no_effect' : 'unknown', { reason_code: cause.code ?? 'STANDARD_SESSION_INTEGRATION_UNCONFIRMED' });
        }
      });
    },
  });
}
