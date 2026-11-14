import path from 'node:path';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createLocalWorkflowGitCheckpoint } from '../../adapters/runtime/local-workflow-git-checkpoint.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { renderStandardSessionPrRecord, sessionPrRecordPaths } from '../../core/workflow/standard-session-pr-record.mjs';
import { artifactContentHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import inputSchema from '../../core/contracts/workflow-definition/standard-session-pr-record-input.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/standard-session-pr-record-plan.v1.schema.json' with { type: 'json' };
import outputSchema from '../../core/contracts/workflow-definition/standard-session-pr-record-output.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (x, schema) => !checkShadowJson(x) && !validateJsonSchema(x, schema, '$', { contractKind: 'workflow-definition' }).length;
const text = row => row.text_chunks.join('');
// readSource authenticates historical accepted receipts and current physical
// closure/provider evidence. Historical delivery hashes are not rewritten when
// this new, separately granted operation advances the canonical PR postimages.
export function createStandardSessionPrRecord({ targetRoot, readSource, readCurrent, now = Date.now }) {
  if (![readSource, readCurrent].every(fn => typeof fn === 'function')) fail('STANDARD_PR_RECORD_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const git = source => createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root }, { profile: 'cycle-terminal', approvedPaths: sessionPrRecordPaths(source.session_path).map(name => 'docs/audit/' + name) });
  const gitIdentity = view => shadowHash({ ...view, changes: [] });
  function documents(changes, after = false, metadata = null) {
    for (const [index, row] of changes.entries()) {
      const hash = after ? row.after_sha256 : row.before_sha256;
      if (artifacts.read(row.path, { required: true }).sha256 !== hash || artifacts.metadataHash(row.path) !== (metadata ? metadata[index] : row.before_metadata_sha256)) fail('STANDARD_PR_RECORD_DOCUMENT_CHANGED');
      if (artifacts.describe().state_mode !== 'db-only' && readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', row.path)), { json: false, maxBytes: 1048576 }).sha256 !== hash) fail('STANDARD_PR_RECORD_PROJECTION_CHANGED');
    }
  }
  async function prepare(instance, input, at, acquired = false) {
    if (!valid(input, inputSchema)) fail('STANDARD_PR_RECORD_INPUT_INVALID');
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' };
    const source = await readSource(instance, input), names = sessionPrRecordPaths(source.session_path);
    if (source.open_operation_id !== input.open_operation_id || source.pull_request.state !== 'OPEN' || source.pull_request.draft
      || source.documents.length !== names.length || names.some((name, index) => source.documents[index]?.path !== name)) fail('STANDARD_PR_RECORD_SOURCE_INVALID');
    const rows = names.map(name => artifacts.read(name, { required: true }));
    for (const [index, row] of rows.entries()) if (row.sha256 !== source.documents[index].sha256 || artifacts.metadataHash(row.path) !== source.documents[index].metadata_sha256) fail('STANDARD_PR_RECORD_DELIVERY_POSTIMAGE_CHANGED');
    const changes = renderStandardSessionPrRecord({ source, documents: rows, preparedAt: at }).map(row => ({ ...row, before_metadata_sha256: artifacts.metadataHash(row.path) }));
    documents(changes);
    const view = git(source).inspect();
    if (view.changes.length || !view.index_clean || view.lock_present || view.head !== source.pull_request.head_oid || view.branch !== source.pull_request.head_branch) fail('STANDARD_PR_RECORD_GIT_CONTEXT_CHANGED');
    const plan = { contract_version: 'standard-session-pr-record-plan.v1', operation_ref: 'session_pr_record', input, prepared_at_ms: at,
      source, source_sha256: shadowHash(source), git_identity_sha256: gitIdentity(view), state_mode: artifacts.describe().state_mode, changes };
    if (!valid(plan, planSchema)) fail('STANDARD_PR_RECORD_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: 'standard-session-pr-record-output.v1', operation_ref: 'session_pr_record', outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail('STANDARD_PR_RECORD_OUTPUT_INVALID'); return value;
  }
  return Object.freeze({ prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      if (!prepared?.can_apply || !valid(plan, planSchema) || write !== true || typeof assertAuthorized !== 'function'
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || shadowHash(plan.source) !== plan.source_sha256
        || plan.changes.some(row => artifactContentHash(text(row)) !== row.after_sha256)) fail('STANDARD_PR_RECORD_EXPLICIT_WRITE_REQUIRED');
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail('STANDARD_PR_RECORD_PREVIEW_CHANGED');
        } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
        let attempted = false;
        try {
          const metadata = [];
          for (const row of plan.changes) {
            await assertAuthorized();
            if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || shadowHash(await readSource(instance, plan.input)) !== plan.source_sha256) throw Error('STANDARD_PR_RECORD_SOURCE_CHANGED');
            attempted = true;
            const committed = artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.before_sha256, before_metadata_sha256: row.before_metadata_sha256, after: text(row) });
            metadata.push(committed.metadata_sha256);
          }
          artifacts.project(plan.changes.map(row => row.path)); documents(plan.changes, true, metadata);
          const view = git(plan.source).inspect(), expected = plan.state_mode === 'db-only' ? [] : plan.changes.filter(row => row.before_sha256 !== row.after_sha256).map(row => 'docs/audit/' + row.path).sort();
          if (gitIdentity(view) !== plan.git_identity_sha256 || shadowHash(view.changes.map(row => row.path).sort()) !== shadowHash(expected)
            || view.changes.some(row => row.status !== ' M') || shadowHash(await readSource(instance, plan.input)) !== plan.source_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) throw Error('STANDARD_PR_RECORD_POSTCONDITION_CHANGED');
          await assertAuthorized();
          const postimages = plan.changes.map((row, index) => ({ path: row.path, sha256: row.after_sha256, metadata_sha256: metadata[index] }));
          return emit('completed', 'confirmed', { open_operation_id: plan.input.open_operation_id, session_id: plan.source.session_id, postimages, checkpoint: 'pending', push: 'pending', review: 'pending' },
            { session_pr_lifecycle_recorded: true, session_pr_checkpoint_required: true }, postimages.map(row => ({ ref: 'docs/audit/' + row.path, sha256: row.sha256 })));
        } catch (cause) {
          return emit(attempted ? 'reconciliation_required' : 'blocked', attempted ? 'unknown' : 'no_effect', { reason_code: cause.code ?? 'STANDARD_PR_RECORD_UNCONFIRMED' });
        }
      });
    },
  });
}
