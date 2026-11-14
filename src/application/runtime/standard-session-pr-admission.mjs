import { createLocalWorkflowBranchIntegration } from '../../adapters/runtime/local-workflow-branch-integration.mjs';
import { createLocalGitAdapter } from '../../adapters/runtime/local-git-adapter.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { runReloadCheckUseCase } from './reload-check-use-case.mjs';
import { runPrOrchestrateAdmitUseCase } from './pr-orchestrate-admit-use-case.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-session-pr-admission-input.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-session-pr-admission-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
// A fresh read-only re-anchor on the integrated session branch. It observes the
// actual reload and PR admission; it neither refreshes a cache nor treats a PR
// metadata marker as evidence that an external effect has happened.
export function createStandardSessionPrAdmission({ targetRoot, readIntegration }) {
  if (typeof readIntegration !== 'function') fail('STANDARD_SESSION_PR_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  async function source(instance, input) {
    if (!valid(input, inputSchema)) fail('STANDARD_SESSION_PR_INPUT_INVALID');
    const accepted = await readIntegration(instance, input), plan = accepted?.plan;
    if (accepted?.integration_operation_id !== input.integration_operation_id || accepted.output?.outcome !== 'completed'
      || accepted.output.effect_status !== 'confirmed' || accepted.output.facts.session_branch_integrated !== true
      || accepted.output.observations.decision_operation_id !== plan?.input.decision_operation_id
      || plan.operation_ref !== 'session_branch_integrate' || !/^[a-f0-9]{64}$/.test(accepted.plan_sha256 ?? '')
      || shadowHash(plan) !== accepted.plan_sha256) fail('STANDARD_SESSION_PR_INTEGRATION_REQUIRED');
    const git = createLocalWorkflowBranchIntegration({ targetRoot: root });
    const gitPlan = { operation_id: plan.operation_id, plan_sha256: accepted.plan_sha256, observed: plan.review.git };
    if (git.inspectIntegration(gitPlan).status !== 'confirmed') fail('STANDARD_SESSION_PR_INTEGRATION_CHANGED');
    return { accepted, git, gitPlan, review: plan.review };
  }
  function emit(outcome, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: 'standard-session-pr-admission-output.v1', operation_ref: 'session_pr_admit', outcome,
      effect_status: 'no_effect', observations, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail('STANDARD_SESSION_PR_OUTPUT_INVALID'); return value;
  }
  return Object.freeze({
    async prepare(instance, input) {
      const observed = await source(instance, input);
      return { can_apply: true, input, integration_source_sha256: shadowHash(observed.accepted) };
    },
    async observe(instance, input) {
      try {
        const before = await source(instance, input), { git, gitPlan, review } = before, local = createLocalGitAdapter();
        const reload = await runReloadCheckUseCase({ targetRoot: root, args: { cache: '.aidn/runtime/cache/reload-state.json',
          stateMode: artifacts.describe().state_mode, stateModeExplicit: true, indexFile: '.aidn/runtime/index/workflow-index.sqlite', indexBackend: 'auto', writeCache: false } });
        if (reload.decision === 'stop' || reload.missing_required_artifacts?.length || reload.cache_written !== false
          || reload.branch !== review.target_branch || reload.head_commit !== review.git.source_head) fail('STANDARD_SESSION_PR_RELOAD_BLOCKED');
        // The legacy admission's other Git methods only read refs/ancestry. Its
        // status method is replaced with the isolated port so a configured
        // clean/process filter cannot execute during this read-only operation.
        const admission = await runPrOrchestrateAdmitUseCase({ targetRoot: root, mode: 'COMMITTING', gitAdapter: {
          getCurrentBranch: () => review.target_branch,
          hasWorkingTreeChanges: () => !git.inspect(review.git).clean,
          getUpstreamBranch: target => local.getUpstreamBranch(target),
          getAheadBehind: (target, left, right) => local.getAheadBehind(target, left, right),
        } });
        if (admission.result !== 'ok' || !['push_session_branch', 'open_pull_request'].includes(admission.action)
          || admission.branch !== review.target_branch || admission.branch_kind !== 'session' || admission.active_session !== review.session_id
          || admission.mapped_session?.session_id !== review.session_id) fail('STANDARD_SESSION_PR_ADMISSION_BLOCKED');
        const after = await source(instance, input);
        if (shadowHash(after.accepted) !== shadowHash(before.accepted) || git.inspectIntegration(gitPlan).status !== 'confirmed') fail('STANDARD_SESSION_PR_CONTEXT_CHANGED');
        return emit('completed', { integration_operation_id: input.integration_operation_id, session_id: review.session_id, session_branch: review.target_branch,
          head: review.git.source_head, reload, admission }, { session_pr_admitted: true, session_push_required: admission.action === 'push_session_branch',
          session_pr_open_required: admission.action === 'open_pull_request' }, [{ ref: 'aidn:session-integration/' + input.integration_operation_id, sha256: shadowHash(before.accepted) }]);
      } catch (cause) {
        return emit('blocked', { reason_code: /^[A-Z][A-Z0-9_]+$/.test(cause.code ?? '') ? cause.code : 'STANDARD_SESSION_PR_ADMISSION_UNAVAILABLE' });
      }
    },
  });
}
