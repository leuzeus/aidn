import path from 'node:path';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { parseSessionMetadata } from '../../lib/workflow/session-context-lib.mjs';
import { sessionPrRecordPaths } from '../../core/workflow/standard-session-pr-record.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
// This is a successor to accepted PR recording, not a relaxation of delivery
// preimages or a fresh admission based on CLOSED/open markers. The host owns
// accepted receipt lookup and immutable closure history authentication.
export function createStandardSessionPrSuccessorAuthority({ targetRoot, readAcceptedOperation, historyAuthority }) {
  if (typeof readAcceptedOperation !== 'function' || typeof historyAuthority?.readHistory !== 'function') fail('STANDARD_PR_SUCCESSOR_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  function readSource(instance, input) {
    const recorded = readAcceptedOperation(instance, input.record_operation_id, 'session_pr_record', 'STANDARD_PR_SUCCESSOR_RECORD_REQUIRED');
    const output = recorded.output, plan = recorded.record.preview.prepared.plan;
    if (output.outcome !== 'completed' || output.effect_status !== 'confirmed' || output.facts.session_pr_lifecycle_recorded !== true
      || output.facts.session_pr_checkpoint_required !== true || output.observations.open_operation_id !== plan.input.open_operation_id
      || shadowHash(plan.source) !== plan.source_sha256) fail('STANDARD_PR_SUCCESSOR_RECORD_REQUIRED');
    const history = historyAuthority.readHistory(instance, plan.input), names = sessionPrRecordPaths(history.review.session_path);
    if (shadowHash(plan.source.documents) !== shadowHash(history.documents) || shadowHash(plan.source.pull_request) !== shadowHash(history.link)
      || output.observations.session_id !== history.review.session_id || plan.source.session_id !== history.review.session_id
      || plan.source.session_path !== names[0] || plan.source.open_operation_id !== history.open.record.operation_id
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(names)
      || shadowHash(output.observations.postimages?.map(row => row.path)) !== shadowHash(names)) fail('STANDARD_PR_SUCCESSOR_HISTORY_CHANGED');
    const postimages = output.observations.postimages;
    for (const [index, row] of postimages.entries()) {
      const change = plan.changes[index], before = history.documents[index];
      if (change.before_sha256 !== before.sha256 || change.before_metadata_sha256 !== before.metadata_sha256 || change.after_sha256 !== row.sha256
        || artifacts.read(row.path, { required: true }).sha256 !== row.sha256
        || artifacts.metadataHash(row.path) !== row.metadata_sha256) fail('STANDARD_PR_SUCCESSOR_POSTIMAGE_CHANGED');
      const refs = output.evidence_refs.filter(ref => ref.ref === 'docs/audit/' + row.path);
      if (refs.length !== 1 || refs[0].sha256 !== row.sha256) fail('STANDARD_PR_SUCCESSOR_POSTIMAGE_CHANGED');
      if (artifacts.describe().state_mode !== 'db-only' && readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', row.path)), { json: false, maxBytes: 1048576 }).sha256 !== row.sha256)
        fail('STANDARD_PR_SUCCESSOR_PROJECTION_CHANGED');
    }
    const session = analyzeStructuredArtifact(artifacts.read(names[0], { required: true }).content).key_values;
    const metadata = parseSessionMetadata(artifacts.read(names[0], { required: true }).content);
    const state = analyzeStructuredArtifact(artifacts.read('CURRENT-STATE.md', { required: true }).content).key_values;
    if (session.state !== 'CLOSED' || session.session_closure_status !== 'completed' || state.active_session !== history.review.session_id
      || state.active_cycle !== 'none' || metadata.pr_review_status !== 'pending' || metadata.pr_status !== 'open'
      || state.session_pr_status !== 'open' || state.session_pr_review_status !== 'pending') fail('STANDARD_PR_SUCCESSOR_OWNER_CHANGED');
    return { record_operation_id: input.record_operation_id, session_id: history.review.session_id, session_path: names[0],
      branch: history.link.head_branch, parent_head: history.link.head_oid, pull_request: history.link,
      request: history.open.record.preview.prepared.plan.provider.plan.request, postimages,
      material_sha256: shadowHash({ record: { operation_id: recorded.record.operation_id, output_sha256: shadowHash(output), plan_sha256: shadowHash(plan) },
        sources: history.sources.map(row => ({ operation_id: row.record.operation_id, output_sha256: shadowHash(row.output) })), events: history.events }) };
  }
  return Object.freeze({ readSource,
    readCheckpoint(instance, input) {
      const selected = readAcceptedOperation(instance, input.checkpoint_operation_id, 'session_pr_checkpoint', 'STANDARD_PR_SUCCESSOR_CHECKPOINT_REQUIRED');
      const plan = selected.record.preview.prepared.plan, source = readSource(instance, plan.input), output = selected.output;
      const head = output.observations.git?.commit_sha ?? output.observations.git?.head;
      if (output.outcome !== 'completed' || !['confirmed', 'no_effect'].includes(output.effect_status) || output.facts.session_pr_checkpoint_completed !== true
        || plan.operation_id !== input.checkpoint_operation_id || output.observations.record_operation_id !== source.record_operation_id
        || plan.source_sha256 !== shadowHash(source) || plan.git.observed.head !== source.parent_head || plan.git.observed.branch !== source.branch
        || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head ?? '')) fail('STANDARD_PR_SUCCESSOR_CHECKPOINT_REQUIRED');
      return { ...source, checkpoint_operation_id: input.checkpoint_operation_id, delivery_head: head, checkpoint_sha256: shadowHash(output) };
    },
  });
}
