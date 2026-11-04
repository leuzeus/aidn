import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { assertPrCorrectionReview, assertPrCorrectionDecisionOutput } from '../../core/workflow/standard-pr-correction-decision.mjs';
import { assertStandardPrCorrectionPlan, assertStandardOperationInput, assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { shadowHash, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import planSchema from '../../core/contracts/workflow-definition/standard-pr-correction-cycle-plan.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };

// The trusted host resolves signed accepted operations. Authored input can only
// name its decision and the new cycle; it supplies no authority or source paths.
export function createStandardPrCorrectionCycle({ targetRoot, operations, readAcceptedOperation, readCheckpoint,
  verifyContinuationSource, observeProduct, readCurrent, now = Date.now }) {
  if (![readAcceptedOperation, readCheckpoint, verifyContinuationSource, observeProduct, readCurrent,
    operations?.admitCycle, operations?.prepareCycle, operations?.initializeCycle].every(fn => typeof fn === 'function'))
    fail('STANDARD_PR_CORRECTION_CYCLE_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const git = (...args) => {
    if (Object.keys(process.env).some(key => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(key)))
      fail('STANDARD_GIT_ENV_SCOPE_CONFLICT');
    return execFileSync('git', ['--literal-pathspecs', '-C', artifacts.root, '-c', 'core.fsmonitor=false', ...args],
      { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000, maxBuffer: 1048576, stdio: 'pipe', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trimEnd();
  };
  const active = (instance, signal) => {
    if (signal?.aborted) fail('STANDARD_PR_CORRECTION_ABORTED');
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail('STANDARD_PR_CORRECTION_CYCLE_INSTANCE_CHANGED');
  };
  function decision(instance, input) {
    const selected = readAcceptedOperation(instance, input.decision_operation_id, 'session_pr_correction_decision');
    const output = assertPrCorrectionDecisionOutput(selected.output), preview = selected.record.preview, plan = preview.prepared.plan;
    const review = assertPrCorrectionReview(plan.review);
    if (selected.record.operation_id !== input.decision_operation_id || selected.record.intent.binding_ref !== 'session_pr_correction_decision'
      || preview.prepared.can_apply !== true || preview.prepared.plan_sha256 !== shadowHash(plan)
      || plan.review_operation_id !== input.decision_operation_id || preview.input.checkpoint_operation_id !== review.checkpoint_operation_id
      || plan.checkpoint_operation_id !== review.checkpoint_operation_id || output.outcome !== 'completed'
      || output.effect_status !== 'no_effect' || output.facts.session_pr_correction_cycle_requested !== true
      || output.observations.choice !== 'create-correction-cycle' || output.observations.review_sha256 !== shadowHash(review))
      fail('STANDARD_PR_CORRECTION_CYCLE_DECISION_REQUIRED');
    if (plan.contract_version === 'standard-pr-correction-review-plan.v3') {
      const candidate = { cycle_id: input.cycle_id, title: input.title, objective: input.objective };
      if (output.contract_version !== 'standard-pr-correction-decision-output.v3'
        || shadowHash(candidate) !== shadowHash(output.observations.candidate_cycle)
        || plan.cycle_constraints?.kind !== 'new-admitted-corrective-cycle'
        || !Number.isSafeInteger(plan.cycle_constraints.minimum_cycle_number)
        || Number(input.cycle_id.slice(1)) < plan.cycle_constraints.minimum_cycle_number) fail('STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED');
    } else if (plan.contract_version === 'standard-pr-correction-review-plan.v2') {
      const candidate = { cycle_id: input.cycle_id, title: input.title, objective: input.objective };
      if (output.contract_version !== 'standard-pr-correction-decision-output.v2'
        || shadowHash(candidate) !== shadowHash(plan.candidate_cycle)
        || shadowHash(output.observations.candidate_cycle) !== shadowHash(plan.candidate_cycle)) fail('STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED');
    } else if (output.contract_version !== 'standard-pr-correction-decision-output.v1') fail('STANDARD_PR_CORRECTION_CYCLE_CHOICE_CHANGED');
    const checkpoint = readAcceptedOperation(instance, review.checkpoint_operation_id, 'session_pr_correction_checkpoint');
    if (shadowHash(checkpoint.output) !== review.checkpoint_output_sha256
      || shadowHash(checkpoint.record.preview.prepared.plan) !== review.checkpoint_plan_sha256) fail('STANDARD_PR_CORRECTION_CYCLE_SOURCE_CHANGED');
    const reopened = readAcceptedOperation(instance, review.reopen_operation_id, 'session_pr_correction_reopen');
    const origin = assertStandardPrCorrectionPlan(reopened.record.preview.prepared.plan).source;
    if (origin.session_id !== review.session_id || origin.triage_operation_id !== review.triage_operation_id
      || origin.product_sha256 !== review.product_sha256 || shadowHash(origin.pull_request) !== review.provider_subject_sha256)
      fail('STANDARD_PR_CORRECTION_CYCLE_SOURCE_CHANGED');
    return { review, origin, decision_sha256: shadowHash(selected) };
  }
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, '$', { contractKind: 'workflow-definition' }).length)
      fail('STANDARD_PR_CORRECTION_CYCLE_PLAN_INVALID');
    assertStandardOperationInput('session_pr_correction_cycle_initialize', plan.input);
    const inner = plan.inner.plan;
    if (plan.inner.plan_sha256 !== shadowHash(inner) || inner.input.session_id !== plan.review.session_id
      || inner.input.cycle_id !== plan.input.cycle_id || inner.input.cycle_type !== 'corrective'
      || inner.input.title !== plan.input.title || inner.input.objective !== plan.input.objective
      || inner.scope.head !== plan.review.head_oid || inner.scope.branch !== plan.review.head_branch
      || inner.input.base_branch !== plan.review.head_branch) fail('STANDARD_PR_CORRECTION_CYCLE_PLAN_INVALID');
    return plan;
  }
  async function prepare(instance, input, { signal } = {}) {
    assertStandardOperationInput('session_pr_correction_cycle_initialize', input); active(instance, signal);
    const selected = decision(instance, input);
    const review = await readCheckpoint(instance, { checkpoint_operation_id: selected.review.checkpoint_operation_id }, { signal });
    if (shadowHash(review) !== shadowHash(selected.review)) fail('STANDARD_PR_CORRECTION_CYCLE_SOURCE_CHANGED');
    const admitted = await operations.admitCycle(); active(instance, signal);
    if (admitted.outcome !== 'completed') return { can_apply: false, admission: admitted };
    const lifecycle = admitted.observations.lifecycle;
    const inner = await operations.prepareCycle({ session_id: review.session_id, cycle_id: input.cycle_id, cycle_type: 'corrective',
      title: input.title, objective: input.objective, base_branch: lifecycle.continuity_base_branch, continuity_rule: lifecycle.continuity_rule });
    if (!inner.can_apply) return { can_apply: false, admission: inner };
    if (shadowHash(await readCheckpoint(instance, { checkpoint_operation_id: review.checkpoint_operation_id }, { signal })) !== shadowHash(review)
      || shadowHash(decision(instance, input)) !== shadowHash(selected)) fail('STANDARD_PR_CORRECTION_CYCLE_SOURCE_CHANGED');
    active(instance, signal);
    const plan = assertPlan({ contract_version: 'standard-pr-correction-cycle-plan.v1', operation_ref: 'session_pr_correction_cycle_initialize',
      input, prepared_at_ms: now(), ...selected, inner });
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare, async apply(instance, prepared, { write = false, expectPlan, assertAuthorized, signal } = {}) {
    const plan = assertPlan(prepared?.plan), age = now() - plan.prepared_at_ms;
    if (write !== true || !prepared.can_apply || typeof assertAuthorized !== 'function'
      || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || !Number.isSafeInteger(age) || age < 0)
      fail('STANDARD_PR_CORRECTION_CYCLE_EXPLICIT_EFFECT_REQUIRED');
    if (age > 300000) fail('STANDARD_PLAN_EXPIRED');
    active(instance, signal);
    if (shadowHash(decision(instance, plan.input)) !== shadowHash({ review: plan.review, origin: plan.origin, decision_sha256: plan.decision_sha256 })
      || shadowHash(await readCheckpoint(instance, { checkpoint_operation_id: plan.review.checkpoint_operation_id }, { signal })) !== shadowHash(plan.review))
      fail('STANDARD_PR_CORRECTION_CYCLE_SOURCE_CHANGED');
    const unchanged = (assertOwner, after = false) => {
      active(instance, signal); assertOwner();
      if (shadowHash(decision(instance, plan.input)) !== shadowHash({ review: plan.review, origin: plan.origin, decision_sha256: plan.decision_sha256 })
        || observeProduct() !== plan.review.product_sha256 || git('rev-parse', 'HEAD') !== plan.review.head_oid
        || git('branch', '--show-current') !== (after ? plan.inner.plan.branch_name : plan.review.head_branch)) fail('STANDARD_PR_CORRECTION_CYCLE_SOURCE_CHANGED');
      const age = now() - plan.prepared_at_ms;
      if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail('STANDARD_PLAN_EXPIRED');
      const changes = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean);
      const allowed = after && plan.review.state_mode !== 'db-only' ? plan.inner.plan.changes.map(row => 'docs/audit/' + row.path) : [];
      if (changes.some(entry => !/^( M|\?\?)/.test(entry.slice(0, 2)) || !allowed.includes(entry.slice(3)))
        || git('diff', '--cached', '--name-only', '-z')) fail('STANDARD_PR_CORRECTION_CYCLE_FOREIGN_CHANGE');
      const rows = after ? plan.inner.plan.changes.map(row => ({ path: row.path, sha256: row.after_sha256 })) : plan.review.postimages;
      for (const row of rows) {
        if (artifacts.read(row.path, { required: true }).sha256 !== row.sha256
          || !after && artifacts.metadataHash(row.path) !== row.metadata_sha256) fail('STANDARD_PR_CORRECTION_CYCLE_POSTIMAGE_CHANGED');
        if (plan.review.state_mode !== 'db-only' && readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', row.path)),
          { json: false, maxBytes: 1048576 }).sha256 !== row.sha256) fail('STANDARD_PR_CORRECTION_CYCLE_PROJECTION_CHANGED');
      }
    };
    const result = await operations.initializeCycle(plan.inner, { write: true, expectPlan: plan.inner.plan_sha256, effectGuard: {
      async before({ assertOwner }) {
        unchanged(assertOwner); await assertAuthorized(); unchanged(assertOwner);
        const proof = await verifyContinuationSource(instance, plan.origin, { signal, assertLocal: () => unchanged(assertOwner) });
        if (proof?.origin_source_sha256 !== shadowHash(plan.origin)) fail('STANDARD_PR_CORRECTION_CYCLE_SOURCE_CHANGED');
        unchanged(assertOwner); await assertAuthorized(); unchanged(assertOwner);
      },
      async after({ assertOwner }) {
        unchanged(assertOwner, true);
        const proof = await verifyContinuationSource(instance, plan.origin, { signal, assertLocal: () => unchanged(assertOwner, true) });
        if (proof?.origin_source_sha256 !== shadowHash(plan.origin)) fail('STANDARD_PR_CORRECTION_CYCLE_SOURCE_CHANGED');
        unchanged(assertOwner, true); await assertAuthorized(); unchanged(assertOwner, true);
        return { decision_operation_id: plan.input.decision_operation_id, decision_sha256: plan.decision_sha256,
          checkpoint_operation_id: plan.review.checkpoint_operation_id, checkpoint_output_sha256: plan.review.checkpoint_output_sha256,
          branch: plan.inner.plan.branch_name, base_branch: plan.review.head_branch, head_oid: plan.review.head_oid };
      }
    } });
    return assertStandardOperationOutput({ contract_version: 'standard-pr-correction-cycle-output.v1', operation_ref: 'session_pr_correction_cycle_initialize',
      outcome: result.outcome, effect_status: result.effect_status,
      facts: result.outcome === 'completed' ? { session_pr_correction_cycle_initialized: true, cycle_dor_ready: false } : {},
      observations: { ...result.observations, decision_operation_id: plan.input.decision_operation_id, cycle_id: plan.input.cycle_id,
        plan: 'not-frozen', readiness: 'not-established', implementation: 'not-authorized' }, evidence_refs: result.evidence_refs });
  } });
}
