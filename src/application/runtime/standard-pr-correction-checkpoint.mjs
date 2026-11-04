import path from 'node:path';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createLocalWorkflowGitCheckpoint } from '../../adapters/runtime/local-workflow-git-checkpoint.mjs';
import { prCorrectionReopenPaths } from '../../core/workflow/standard-pr-correction-reopen.mjs';
import { assertStandardPrCorrectionPlan, assertStandardPrCorrectionCheckpointPlan, assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { artifactContentHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-pr-correction-checkpoint-input.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/standard-pr-correction-checkpoint-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-pr-correction-checkpoint-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;

// Internal component: accepted operation identities are resolved by a trusted
// signed-journal reader, never by a process-authored list of paths or hashes.
// This commits metadata only. It does not push, create a cycle or admit product.
export function createStandardPrCorrectionCheckpoint({ targetRoot, readAcceptedOperation, readDispatchedOperation, authority, readCurrent, now = Date.now }) {
  if (![readAcceptedOperation, authority?.verifySource, authority?.verifyProviderSource, readCurrent].every(fn => typeof fn === 'function'))
    fail('STANDARD_PR_CORRECTION_CHECKPOINT_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const active = signal => { if (signal?.aborted) fail('STANDARD_PR_CORRECTION_CHECKPOINT_ABORTED'); };
  const port = source => createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root }, { profile: 'cycle-terminal',
    approvedPaths: source.postimages.map(row => 'docs/audit/' + row.path) });
  function source(instance, input) {
    const accepted = readAcceptedOperation(instance, input.reopen_operation_id, 'session_pr_correction_reopen');
    const preview = accepted.record.preview, plan = assertStandardPrCorrectionPlan(preview.prepared.plan), output = assertStandardOperationOutput(accepted.output);
    const o = output.observations, paths = prCorrectionReopenPaths(plan.source.session_id), postimages = o.postimages;
    if (accepted.record.operation_id !== input.reopen_operation_id || accepted.record.intent.binding_ref !== 'session_pr_correction_reopen'
      || preview.prepared.can_apply !== true || preview.prepared.plan_sha256 !== shadowHash(plan) || shadowHash(preview.input) !== shadowHash(plan.input)
      || output.outcome !== 'completed' || output.effect_status !== 'confirmed' || output.facts.session_pr_correction_context_open !== true
      || output.facts.session_pr_correction_cycle_required !== true || o.source_sha256 !== plan.source_sha256 || o.session_id !== plan.source.session_id
      || o.triage_operation_id !== plan.input.triage_operation_id || o.causal?.origin_source_sha256 !== plan.source_sha256
      || o.cycle !== 'not-created' || o.implementation_admission !== 'not-established'
      || plan.state_mode !== artifacts.describe().state_mode || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(paths)
      || !Array.isArray(postimages) || shadowHash(postimages.map(row => row.path)) !== shadowHash(paths))
      fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_INVALID');
    for (const [index, row] of postimages.entries()) {
      const change = plan.changes[index];
      if (row.sha256 !== change.after_sha256 || artifactContentHash(change.text_chunks.join('')) !== row.sha256
        || !Object.hasOwn(row, 'metadata_sha256') || artifacts.read(row.path, { required: true }).sha256 !== row.sha256
        || artifacts.metadataHash(row.path) !== row.metadata_sha256) fail('STANDARD_PR_CORRECTION_CHECKPOINT_POSTIMAGE_CHANGED');
      if (plan.state_mode !== 'db-only' && readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', row.path)),
        { json: false, maxBytes: 1048576 }).sha256 !== row.sha256) fail('STANDARD_PR_CORRECTION_CHECKPOINT_PROJECTION_CHANGED');
    }
    return { reopen_operation_id: input.reopen_operation_id, reopen_plan_sha256: shadowHash(plan), reopen_output_sha256: shadowHash(output),
      correction_source: plan.source, state_mode: plan.state_mode, postimages };
  }
  function current(instance, signal) {
    active(signal);
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail('STANDARD_PR_CORRECTION_CHECKPOINT_INSTANCE_CHANGED');
  }
  async function prepare(instance, input, operationId, at, acquired = false, signal) {
    active(signal);
    if (!valid(input, inputSchema) || !/^op_[a-f0-9]{40}$/.test(operationId ?? '')) fail('STANDARD_PR_CORRECTION_CHECKPOINT_INPUT_INVALID');
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' };
    const value = source(instance, input), observed = port(value).inspect(), p = value.correction_source.pull_request;
    if (!observed.index_clean || observed.lock_present || observed.head !== p.head_oid || observed.branch !== p.head_branch)
      fail('STANDARD_PR_CORRECTION_CHECKPOINT_GIT_CHANGED');
    const files = observed.changes.map(row => {
      const approved = value.postimages.find(file => 'docs/audit/' + file.path === row.path);
      if (!approved || row.status !== ' M' || value.state_mode === 'db-only') fail('STANDARD_PR_CORRECTION_CHECKPOINT_FOREIGN_CHANGE');
      return { path: row.path, sha256: approved.sha256 };
    });
    const plan = { contract_version: 'standard-pr-correction-checkpoint-plan.v1', operation_ref: 'session_pr_correction_checkpoint',
      input, operation_id: operationId, prepared_at_ms: at, session_id: value.correction_source.session_id,
      state_mode: value.state_mode, source_sha256: shadowHash(value), git: { operation_kind: 'terminal-objects-ref-index.v1', observed, files } };
    // The accepted reopen receipt determines the finite postimages. This is
    // read-only preparation, including on cold entry; it grants no push intent.
    let pushIdentity = null;
    const assertLocal = localView => {
      current(instance, signal);
      if (acquired) artifacts.assertLocalEffectOwner(shadowHash(plan));
      else if (artifacts.ownerPending()) fail('STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED');
      if (shadowHash(source(instance, input)) !== shadowHash(value) || shadowHash(port(value).inspect()) !== shadowHash(observed))
        fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_CHANGED');
      const identity = shadowHash(localView);
      if (pushIdentity !== null && pushIdentity !== identity) fail('STANDARD_PR_CORRECTION_CHECKPOINT_GIT_CHANGED');
      pushIdentity = identity;
    };
    const external = await authority.verifySource(instance, value.correction_source, { signal, assertLocal });
    if (external?.origin_source_sha256 !== shadowHash(value.correction_source)) fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_CHANGED');
    current(instance, signal);
    if (shadowHash(source(instance, input)) !== shadowHash(value) || shadowHash(port(value).inspect()) !== shadowHash(observed))
      fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_CHANGED');
    if (!valid(plan, planSchema)) fail('STANDARD_PR_CORRECTION_CHECKPOINT_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: 'standard-pr-correction-checkpoint-output.v1', operation_ref: 'session_pr_correction_checkpoint',
      outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail('STANDARD_PR_CORRECTION_CHECKPOINT_OUTPUT_INVALID'); return value;
  }
  // Retrospective observation only: no commit, index repair, owner takeover or
  // TTL extension. The host must authenticate the unreplied dispatch and keep
  // its original intent/grant. A retained uncertain owner is never removed.
  // A prior unknown receipt is historical evidence, not a completed effect.
  async function reconcile(instance, operationId, { assertAuthorized, signal } = {}) {
    active(signal);
    if (typeof readDispatchedOperation !== 'function' || typeof assertAuthorized !== 'function')
      fail('STANDARD_PR_CORRECTION_CHECKPOINT_RECOVERY_AUTHORITY_REQUIRED');
    const selected = readDispatchedOperation(instance, operationId), prepared = selected.preview.prepared;
    const plan = assertStandardPrCorrectionCheckpointPlan(prepared?.plan);
    const last = selected.results.at(-1)?.receipt;
    const unknown = selected.phase === 'receipted' && last?.outcome === 'reconciliation_required' && last.effect_status === 'unknown';
    if (!(selected.phase === 'dispatching' && !selected.results.length || unknown) || selected.operation_id !== operationId
      || selected.intent.binding_ref !== 'session_pr_correction_checkpoint' || plan.operation_id !== operationId
      || prepared.can_apply !== true || shadowHash(plan) !== prepared.plan_sha256
      || shadowHash(selected.preview.input) !== shadowHash(plan.input)) fail('STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_REQUIRED');
    const selectedHash = shadowHash(selected);
    const unchanged = () => {
      current(instance, signal);
      if (artifacts.ownerPending()) fail('STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED');
      if (shadowHash(readDispatchedOperation(instance, operationId)) !== selectedHash)
        fail('STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_CHANGED');
      const value = source(instance, plan.input);
      if (shadowHash(value) !== plan.source_sha256 || plan.session_id !== value.correction_source.session_id
        || plan.state_mode !== value.state_mode || plan.git.observed.head !== value.correction_source.pull_request.head_oid
        || plan.git.observed.branch !== value.correction_source.pull_request.head_branch
        || !plan.git.observed.index_clean || plan.git.observed.lock_present) fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_CHANGED');
      // Zero-effect plans have no operation-specific Git witness. Never infer
      // that their historical dispatch finished just because HEAD is unchanged.
      if (!plan.git.files.length) fail('STANDARD_PR_CORRECTION_CHECKPOINT_COMMIT_WITNESS_REQUIRED');
      const files = plan.git.observed.changes.map(row => {
        const postimage = value.postimages.find(file => 'docs/audit/' + file.path === row.path);
        if (!postimage || row.status !== ' M') fail('STANDARD_PR_CORRECTION_CHECKPOINT_FOREIGN_CHANGE');
        return { path: row.path, sha256: postimage.sha256 };
      });
      if (shadowHash(files) !== shadowHash(plan.git.files)) fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_CHANGED');
      const git = port(value), gitPlan = { ...plan.git, operation_id: operationId,
        prepared_at_ms: plan.prepared_at_ms, plan_sha256: prepared.plan_sha256 }, view = git.inspect(), proof = git.inspectCommit(gitPlan);
      if (view.branch !== plan.git.observed.branch || view.ref !== plan.git.observed.ref || !view.index_clean || view.lock_present || view.changes.length
        || proof.status !== 'confirmed' || proof.commit_sha !== view.head || proof.parent_sha !== plan.git.observed.head
        || shadowHash(view.identity) !== shadowHash(plan.git.observed.identity) || view.signing !== plan.git.observed.signing)
        fail('STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED');
      return { value, proof };
    };
    const before = unchanged(); await assertAuthorized(); unchanged();
    const external = await authority.verifyProviderSource(instance, before.value.correction_source, { signal });
    if (external?.origin_source_sha256 !== shadowHash(before.value.correction_source)) fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_CHANGED');
    const after = unchanged(); await assertAuthorized(); const final = unchanged();
    if (shadowHash(before) !== shadowHash(after) || shadowHash(before) !== shadowHash(final)) fail('STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED');
    const result = { ...final.proof, effect_status: 'confirmed' };
    return emit('completed', 'confirmed', { reopen_operation_id: plan.input.reopen_operation_id, source_sha256: plan.source_sha256,
      git: result, external, reconciliation: 'observed-existing-commit', dispatch_sha256: selectedHash,
      product_admission: 'not-established', cycle: 'not-created', remote_head: final.value.correction_source.pull_request.head_oid },
    { session_pr_correction_checkpoint_completed: true },
    [{ ref: 'git:pr-correction-checkpoint/' + operationId, sha256: shadowHash(result) },
      { ref: 'aidn:pr-correction-reopen/' + plan.input.reopen_operation_id, sha256: plan.source_sha256 }]);
  }
  return Object.freeze({ reconcile, prepare: (instance, input, id, { signal } = {}) => prepare(instance, input, id, now(), false, signal),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized, signal } = {}) {
      const plan = prepared?.plan, age = now() - plan?.prepared_at_ms;
      active(signal);
      if (!prepared?.can_apply || !valid(plan, planSchema) || write !== true || typeof assertAuthorized !== 'function'
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || !Number.isSafeInteger(age) || age < 0)
        fail('STANDARD_PR_CORRECTION_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED');
      if (age > 300000) fail('STANDARD_PLAN_EXPIRED');
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        let result = null, attempted = false;
        try {
          await assertAuthorized();
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true, signal);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail('STANDARD_PR_CORRECTION_CHECKPOINT_PREVIEW_CHANGED');
          const value = source(instance, plan.input), git = port(value);
          const gitPlan = { ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan };
          const unchanged = () => {
            current(instance, signal);
            const age = now() - plan.prepared_at_ms;
            if (!Number.isSafeInteger(age) || age < 0 || shadowHash(source(instance, plan.input)) !== plan.source_sha256)
              fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_CHANGED');
            if (age > 300000) fail('STANDARD_PLAN_EXPIRED');
          };
          unchanged(); attempted = true;
          result = await git.commit(gitPlan, { async assertAuthorized() { unchanged(); await assertAuthorized(); unchanged(); } });
          const local = () => {
            unchanged(); const view = git.inspect(), proof = plan.git.files.length ? git.inspectCommit(gitPlan) : null;
            if (view.branch !== plan.git.observed.branch || !view.index_clean || view.lock_present || view.changes.length
              || plan.git.files.length && (proof.status !== 'confirmed' || proof.commit_sha !== result.commit_sha || proof.parent_sha !== plan.git.observed.head)
              || !plan.git.files.length && (view.head !== plan.git.observed.head || result.effect_status !== 'no_effect'))
              fail('STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED');
          };
          local();
          // The provider still refers to the original remote HEAD. Only this
          // exact local metadata commit bridges it; it confers no new triage.
          const external = await authority.verifyProviderSource(instance, value.correction_source, { signal });
          if (external?.origin_source_sha256 !== shadowHash(value.correction_source)) fail('STANDARD_PR_CORRECTION_CHECKPOINT_SOURCE_CHANGED');
          local(); await assertAuthorized(); local();
          return emit('completed', result.effect_status, { reopen_operation_id: plan.input.reopen_operation_id,
            source_sha256: plan.source_sha256, git: result, external, product_admission: 'not-established', cycle: 'not-created',
            remote_head: value.correction_source.pull_request.head_oid }, { session_pr_correction_checkpoint_completed: true },
          [{ ref: 'git:pr-correction-checkpoint/' + plan.operation_id, sha256: shadowHash(result) },
            { ref: 'aidn:pr-correction-reopen/' + plan.input.reopen_operation_id, sha256: plan.source_sha256 }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== 'confirmed' && (!attempted || cause.effect_status === 'no_effect');
          return emit(noEffect ? 'blocked' : 'reconciliation_required', noEffect ? 'no_effect' : 'unknown',
            { reason_code: /^[A-Z][A-Z0-9_]+$/.test(cause.code ?? '') ? cause.code : 'STANDARD_PR_CORRECTION_CHECKPOINT_UNCONFIRMED' });
        }
      });
    } });
}
