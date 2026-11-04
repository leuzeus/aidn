import path from 'node:path';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createLocalWorkflowGitCheckpoint } from '../../adapters/runtime/local-workflow-git-checkpoint.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { preWriteAdmit } from '../../../tools/runtime/pre-write-admit.mjs';
import { prCorrectionReopenPaths, renderPrCorrectionReopen } from '../../core/workflow/standard-pr-correction-reopen.mjs';
import { artifactContentHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-pr-correction-reopen-input.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/standard-pr-correction-reopen-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-pr-correction-reopen-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (x, schema) => !checkShadowJson(x) && !validateJsonSchema(x, schema, '$', { contractKind: 'workflow-definition' }).length;
const text = row => row.text_chunks.join('');

// The candidate standard graph selects this internal component. Only the
// authenticated source factory may bridge an unchanged provider/product source
// over these exact canonical writes; ordinary native admission is unchanged.
export function createStandardPrCorrectionReopen({ targetRoot, authority, readCurrent, now = Date.now }) {
  if (![authority?.readSource, authority?.verifySource, readCurrent].every(fn => typeof fn === 'function')) fail('STANDARD_PR_CORRECTION_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const git = source => createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root }, { profile: 'cycle-terminal',
    approvedPaths: prCorrectionReopenPaths(source.session_id).map(name => 'docs/audit/' + name) });
  const identity = view => shadowHash({ ...view, changes: [] });
  const active = signal => { if (signal?.aborted) fail('STANDARD_PR_CORRECTION_ABORTED'); };
  async function admission() {
    const result = await preWriteAdmit({ targetRoot: artifacts.root, skill: 'pr-orchestrate' });
    if (!result.ok || !['admitted', 'admitted_with_warnings'].includes(result.admission_status)) fail('STANDARD_PR_CORRECTION_ADMISSION_BLOCKED');
  }
  function assertDocuments(changes, committed = []) {
    for (const [index, row] of changes.entries()) {
      const expected = committed[index] ?? { sha256: row.before_sha256, metadata_sha256: row.before_metadata_sha256 };
      if (artifacts.read(row.path, { required: true }).sha256 !== expected.sha256 || artifacts.metadataHash(row.path) !== expected.metadata_sha256)
        fail('STANDARD_PR_CORRECTION_DOCUMENT_CHANGED');
      // Projection may lag only inside the owned transaction, before project().
    }
  }
  function projections(changes, after = false) {
    if (artifacts.describe().state_mode === 'db-only') return;
    for (const row of changes) if (readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', row.path)), { json: false, maxBytes: 1048576 }).sha256
      !== (after ? row.after_sha256 : row.before_sha256)) fail('STANDARD_PR_CORRECTION_PROJECTION_CHANGED');
  }
  async function prepare(instance, input, at, acquired = false, signal) {
    if (!valid(input, inputSchema)) fail('STANDARD_PR_CORRECTION_INPUT_INVALID'); active(signal);
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' };
    await admission(); active(signal);
    const source = await authority.readSource(instance, input, { signal }); active(signal);
    if (source.triage_operation_id !== input.triage_operation_id || !source.corrections?.length) fail('STANDARD_PR_CORRECTION_SOURCE_INVALID');
    const rows = prCorrectionReopenPaths(source.session_id).map(name => artifacts.read(name, { required: true }));
    const changes = renderPrCorrectionReopen({ source, documents: rows, preparedAt: at }).map(row => ({ ...row, before_metadata_sha256: artifacts.metadataHash(row.path) }));
    assertDocuments(changes); projections(changes);
    const view = git(source).inspect();
    if (view.changes.length || !view.index_clean || view.lock_present || view.head !== source.pull_request.head_oid || view.branch !== source.pull_request.head_branch)
      fail('STANDARD_PR_CORRECTION_GIT_CHANGED');
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail('STANDARD_PR_CORRECTION_INSTANCE_CHANGED');
    const plan = { contract_version: 'standard-pr-correction-reopen-plan.v1', operation_ref: 'session_pr_correction_reopen', input,
      source, source_sha256: shadowHash(source), prepared_at_ms: at, git_identity_sha256: identity(view), state_mode: artifacts.describe().state_mode, changes };
    if (!valid(plan, planSchema)) fail('STANDARD_PR_CORRECTION_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: 'standard-pr-correction-reopen-output.v1', operation_ref: 'session_pr_correction_reopen', outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail('STANDARD_PR_CORRECTION_OUTPUT_INVALID'); return value;
  }
  return Object.freeze({ prepare: (instance, input, { signal } = {}) => prepare(instance, input, now(), false, signal),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized, signal } = {}) {
      active(signal); const plan = prepared?.plan, age = now() - plan?.prepared_at_ms;
      if (!prepared?.can_apply || !valid(plan, planSchema) || write !== true || typeof assertAuthorized !== 'function'
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || shadowHash(plan.source) !== plan.source_sha256
        || !Number.isSafeInteger(age) || age < 0 || age > 300000 || plan.changes.some(row => artifactContentHash(text(row)) !== row.after_sha256))
        fail('STANDARD_PR_CORRECTION_EXPLICIT_WRITE_REQUIRED');
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          active(signal); await assertAuthorized();
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true, signal);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail('STANDARD_PR_CORRECTION_PREVIEW_CHANGED');
        } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
        const committed = []; let attempted = false;
        async function unchanged() {
          active(signal); await assertAuthorized(); active(signal);
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000)
            fail('STANDARD_PR_CORRECTION_INSTANCE_CHANGED');
          assertDocuments(plan.changes, committed);
          const proof = await authority.verifySource(instance, plan.source, { signal }); active(signal);
          if (proof?.origin_source_sha256 !== plan.source_sha256) fail('STANDARD_PR_CORRECTION_CAUSAL_SOURCE_CHANGED');
          assertDocuments(plan.changes, committed);
          const view = git(plan.source).inspect();
          const expected = plan.state_mode === 'db-only' ? [] : committed.map(row => 'docs/audit/' + row.path).sort();
          if (identity(view) !== plan.git_identity_sha256 || shadowHash(view.changes.map(row => row.path).sort()) !== shadowHash(expected)
            || view.changes.some(row => row.status !== ' M')) fail('STANDARD_PR_CORRECTION_GIT_CHANGED');
          return proof;
        }
        try {
          for (const row of plan.changes) {
            await unchanged(); attempted = true;
            const result = artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.before_sha256,
              before_metadata_sha256: row.before_metadata_sha256, after: text(row) });
            committed.push({ path: row.path, sha256: row.after_sha256, metadata_sha256: result.metadata_sha256 });
            // Keep dual/files projection aligned with each admitted postimage.
            artifacts.project([row.path]);
          }
          const causal = await unchanged(); projections(plan.changes, true);
          active(signal); assertDocuments(plan.changes, committed);
          return emit('completed', 'confirmed', { triage_operation_id: plan.input.triage_operation_id, session_id: plan.source.session_id,
            source_sha256: plan.source_sha256, postimages: committed, causal, cycle: 'not-created', implementation_admission: 'not-established',
            validation: 'pending', responses: 'pending', resolutions: 'pending', merge_authorization: 'not-established' },
          { session_pr_correction_context_open: true, session_pr_correction_cycle_required: true }, committed.map(row => ({ ref: 'docs/audit/' + row.path, sha256: row.sha256 })));
        } catch (cause) {
          return emit(attempted ? 'reconciliation_required' : 'blocked', attempted ? 'unknown' : 'no_effect',
            { reason_code: /^[A-Z][A-Z0-9_]+$/.test(cause.code ?? '') ? cause.code : 'STANDARD_PR_CORRECTION_UNCONFIRMED', committed });
        }
      });
    } });
}
