import path from 'node:path';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { sessionPrRecordPaths } from '../../core/workflow/standard-session-pr-record.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
// The capability verifies actual accepted host receipts. Historical postimage
// hashes remain immutable; the writer compares them before advancing its own
// canonical postimages. Physical closure/provider evidence stays live.
export function createStandardSessionPrRecordAuthority({ targetRoot, readAcceptedOperation, pullRequestPort }) {
  if (typeof readAcceptedOperation !== 'function' || typeof pullRequestPort?.prepare !== 'function') fail('STANDARD_PR_RECORD_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  function physical(observed, expectedEvent, expectedRun, branch) {
    if (observed.event_file !== '.aidn/runtime/perf/workflow-events.ndjson') fail('STANDARD_PR_RECORD_PHYSICAL_EVIDENCE_CHANGED');
    const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, observed.event_file)), { json: false, maxBytes: 4194304 }).value;
    const offset = observed.event_offset, end = Number.isSafeInteger(offset) ? bytes.indexOf(10, offset) : -1;
    if (!Number.isSafeInteger(offset) || offset < 0 || end < offset || offset && bytes[offset - 1] !== 10) fail('STANDARD_PR_RECORD_PHYSICAL_EVIDENCE_CHANGED');
    const event = JSON.parse(bytes.subarray(offset, end).toString('utf8'));
    if (shadowHash(event) !== shadowHash(observed.event) || event.event !== expectedEvent || event.result !== 'ok' || event.run_id !== expectedRun
      || event.branch !== branch || event.mode !== 'COMMITTING') fail('STANDARD_PR_RECORD_PHYSICAL_EVIDENCE_CHANGED');
    return { offset, sha256: shadowHash(event) };
  }
  function readHistory(instance, input) {
    const open = readAcceptedOperation(instance, input.open_operation_id, 'session_pr_open', 'STANDARD_PR_RECORD_OPEN_REQUIRED');
    const push = readAcceptedOperation(instance, open.record.preview.input.push_operation_id, 'session_push');
    const admit = readAcceptedOperation(instance, push.record.preview.input.admission_operation_id, 'session_pr_admit');
    const integration = readAcceptedOperation(instance, admit.record.preview.input.integration_operation_id, 'session_branch_integrate');
    const review = integration.record.preview.prepared.plan.review;
    const delivery = readAcceptedOperation(instance, review.delivery_operation_id, 'session_delivery_checkpoint');
    const final = readAcceptedOperation(instance, delivery.record.preview.input.finalization_operation_id, 'session_close_finalize');
    const closed = readAcceptedOperation(instance, review.closure_operation_id, 'cycle_close_finalize');
    const sources = [open, push, admit, integration, delivery, final, closed];
    if (sources.some(row => row.output.outcome !== 'completed' || !['confirmed', 'no_effect'].includes(row.output.effect_status))
      || open.output.facts.session_pr_open_confirmed !== true || push.output.facts.session_remote_head_confirmed !== true
      || final.output.facts.session_close_completed !== true || closed.output.facts.cycle_close_completed !== true || closed.output.observations.target_state !== 'DONE') fail('STANDARD_PR_RECORD_OPEN_REQUIRED');
    const link = open.output.observations.pull_request, finalPlan = final.record.preview.prepared.plan;
    if (open.output.observations.session_id !== review.session_id || finalPlan.session_id !== review.session_id
      || link.head_branch !== review.target_branch || link.head_oid !== push.output.observations.git.remote_head) fail('STANDARD_PR_RECORD_OWNER_CHANGED');
    const events = [physical(final.output.observations, 'hook_session_close', finalPlan.run_id, review.source_branch),
      physical(closed.output.observations, 'checkpoint_summary', 'process_close_' + closed.record.operation_id.slice(3), review.source_branch)];
    const names = sessionPrRecordPaths(review.session_path), documents = names.map(name => {
      const matches = review.documents.filter(row => row.ref === 'audit:' + name);
      if (matches.length !== 1) fail('STANDARD_PR_RECORD_DELIVERY_REQUIRED');
      return { path: name, sha256: matches[0].sha256, metadata_sha256: matches[0].metadata_sha256 };
    });
    return { open, sources, events, review, link, documents };
  }
  return Object.freeze({ readHistory, async readSource(instance, input) {
    const { open, sources, events, review, link, documents } = readHistory(instance, input);
    const provider = await pullRequestPort.prepare(open.record.preview.prepared.plan.provider.plan.request, open.record.operation_id);
    if (!provider.can_apply || shadowHash(provider.plan) !== provider.plan_sha256 || shadowHash(provider.plan.observed.existing) !== shadowHash(link)) fail('STANDARD_PR_RECORD_REMOTE_CHANGED');
    return { open_operation_id: input.open_operation_id, session_id: review.session_id, session_path: review.session_path, pull_request: link, documents,
      material_sha256: shadowHash({ sources: sources.map(row => ({ operation_id: row.record.operation_id, output_sha256: shadowHash(row.output) })), events, provider_sha256: provider.plan_sha256 }) };
  } });
}
