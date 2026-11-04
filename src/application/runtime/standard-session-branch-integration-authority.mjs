import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { analyzeStructuredArtifact, extractStructuredField } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import path from 'node:path';
const fail = code => { throw Object.assign(Error(code), { code }); };
const fields = row => analyzeStructuredArtifact(row.content).key_values;
// These capabilities authenticate the retained host journals and final R07
// physical event; no caller-supplied CLOSED/DONE/synced marker is accepted.
export function createStandardSessionBranchIntegrationAuthority({ targetRoot, readAcceptedOperation, readDeliverySource }) {
  if (![readAcceptedOperation, readDeliverySource].every(fn => typeof fn === 'function')) fail('STANDARD_SESSION_INTEGRATION_AUTHORITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  return Object.freeze({ async readSource(instance, input) {
    const delivery = readAcceptedOperation(instance, input.delivery_operation_id, 'session_delivery_checkpoint');
    const deliveryPlan = delivery.record.preview.prepared.plan, deliveryOutput = delivery.output;
    if (deliveryOutput.outcome !== 'completed' || !['confirmed', 'no_effect'].includes(deliveryOutput.effect_status)
      || deliveryOutput.facts.session_delivery_checkpoint_completed !== true
      || deliveryOutput.observations.finalization_operation_id !== deliveryPlan.input.finalization_operation_id)
      fail('STANDARD_SESSION_INTEGRATION_DELIVERY_REQUIRED');
    const final = await readDeliverySource(instance, deliveryPlan.input);
    if (deliveryPlan.source_sha256 !== shadowHash(final)) fail('STANDARD_SESSION_INTEGRATION_DELIVERY_CHANGED');
    const closed = readAcceptedOperation(instance, input.closure_operation_id, 'cycle_close_finalize');
    const closePlan = closed.record.preview.prepared.plan, closeOutput = closed.output;
    if (closeOutput.effect_status !== 'confirmed' || closeOutput.facts.cycle_close_completed !== true
      || closeOutput.observations.target_state !== 'DONE' || closePlan.scope.session_id !== final.session_id || closePlan.scope.branch !== final.branch)
      fail('STANDARD_SESSION_INTEGRATION_RETAINED_CLOSURE_REQUIRED');
    const terminal = readAcceptedOperation(instance, closePlan.input.closure_operation_id, 'cycle_close_record');
    const terminalPlan = terminal.record.preview.prepared.plan;
    const decision = readAcceptedOperation(instance, terminalPlan.input.decision_operation_id, 'cycle_closure_decision');
    if (terminal.output.effect_status !== 'confirmed' || terminal.output.facts.cycle_terminal_recorded !== true
      || terminalPlan.target_state !== 'DONE' || decision.output.observations.choice !== 'retain')
      fail('STANDARD_SESSION_INTEGRATION_RETAINED_CLOSURE_REQUIRED');
    const observed = closeOutput.observations;
    if (observed.event_file !== '.aidn/runtime/perf/workflow-events.ndjson') fail('STANDARD_SESSION_INTEGRATION_CLOSURE_EVENT_CHANGED');
    const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, observed.event_file)), { json: false, maxBytes: 4194304 }).value;
    const offset = observed.event_offset, end = Number.isSafeInteger(offset) ? bytes.indexOf(10, offset) : -1;
    if (!Number.isSafeInteger(offset) || offset < 0 || end < offset || offset && bytes[offset - 1] !== 10) fail('STANDARD_SESSION_INTEGRATION_CLOSURE_EVENT_CHANGED');
    const event = JSON.parse(bytes.subarray(offset, end).toString('utf8'));
    if (shadowHash(event) !== shadowHash(observed.event) || event.event !== 'checkpoint_summary' || event.result !== 'ok' || event.skill !== 'perf-checkpoint'
      || event.mode !== 'COMMITTING' || event.branch !== final.branch || event.run_id !== 'process_close_' + closed.record.operation_id.slice(3))
      fail('STANDARD_SESSION_INTEGRATION_CLOSURE_EVENT_CHANGED');
    const sessionRow = artifacts.read(final.session_path, { required: true }), session = fields(sessionRow);
    // The distributed session template declares continuity in a Markdown list.
    // key_values deliberately covers only top-level fields; use the owning
    // structured scalar reader for the canonical branch in either syntax.
    const sessionBranch = extractStructuredField(sessionRow.content, 'session_branch');
    const owned = artifacts.cycles().filter(row => fields(row).session_owner === final.session_id);
    const cycleRow = owned.find(row => row.cycle_id === closePlan.scope.cycle_id), cycle = cycleRow && fields(cycleRow);
    if (owned.length !== 1 || !cycleRow || cycle.state !== 'DONE'
      || cycle.branch_name !== final.branch || session.state !== 'CLOSED' || session.session_closure_status !== 'completed'
      || session.mode !== 'COMMITTING' || !sessionBranch || sessionBranch === final.branch)
      fail('STANDARD_SESSION_INTEGRATION_CANONICAL_OWNER_CHANGED');
    let expectedStatus = null;
    for (const entry of instance.events.filter(row => row.kind === 'operation_result' && row.receipt.outcome === 'completed')) {
      const intent = instance.events.find(row => row.kind === 'operation_intent' && row.intent.operation_id === entry.receipt.operation_id)?.intent;
      if (!['cycle_close_finalize', 'baseline_promotion_record', 'baseline_promotion_finalize'].includes(intent?.binding_ref)) continue;
      const accepted = readAcceptedOperation(instance, intent.operation_id, intent.binding_ref);
      for (const ref of accepted.output.evidence_refs) if (ref.ref === 'docs/audit/' + cycleRow.path) {
        if (accepted.output.effect_status !== 'confirmed') fail('STANDARD_SESSION_INTEGRATION_POSTIMAGE_CHANGED');
        expectedStatus = ref.sha256;
      }
    }
    if (!expectedStatus || cycleRow.sha256 !== expectedStatus) fail('STANDARD_SESSION_INTEGRATION_POSTIMAGE_CHANGED');
    const deliveryHead = deliveryOutput.observations.git?.commit_sha ?? deliveryOutput.observations.git?.head;
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(deliveryHead ?? '')) fail('STANDARD_SESSION_INTEGRATION_DELIVERY_REQUIRED');
    const names = [final.session_path, cycleRow.path, 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'];
    return { session_id: final.session_id, session_path: final.session_path, cycle_id: cycleRow.cycle_id, cycle_path: cycleRow.path,
      source_branch: final.branch, target_branch: sessionBranch, delivery_head: deliveryHead,
      delivery_operation_id: input.delivery_operation_id, delivery_output_sha256: shadowHash(deliveryOutput),
      closure_operation_id: input.closure_operation_id, closure_output_sha256: shadowHash(closeOutput),
      material_sha256: shadowHash({ delivery: final, closure: closeOutput, terminal: terminal.output, decision: decision.output }),
      documents: names.map(name => ({ ref: 'audit:' + name, sha256: artifacts.read(name, { required: true }).sha256, metadata_sha256: artifacts.metadataHash(name) })) };
  } });
}
