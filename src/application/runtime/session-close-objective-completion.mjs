import path from 'node:path';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { readAgentRunFile, agentRunPhysicalPath } from './agent-run-configuration-service.mjs';
import v3 from '../../core/contracts/workflow-definition/standard-drift-finalize-plan.v3.schema.json' with { type: 'json' };
import v4 from '../../core/contracts/workflow-definition/standard-drift-finalize-plan.v4.schema.json' with { type: 'json' };

const require = condition => { if (!condition) throw Object.assign(Error('STANDARD_SESSION_CLOSE_OBJECTIVE_PROOF_CHANGED'), { code: 'STANDARD_SESSION_CLOSE_OBJECTIVE_PROOF_CHANGED' }); };
// All three inputs come from the host's accepted operation readers. The signed
// close question pins the R05 output; its writer and checkpoint account for the
// only allowed changes since that review. JSON cannot supply this capability.
export function readSessionCloseObjectiveCompletion({ artifacts, recorded, finalization }) {
  const review = recorded.question.review, { record, output } = finalization, plan = record.preview.prepared.plan;
  require(record.operation_id === review.drift_finalization_operation_id && record.intent.binding_ref === 'drift_check_finalize'
    && H(output) === review.drift_finalization_output_sha256 && output.outcome === 'completed'
    && output.effect_status === 'confirmed' && output.facts.drift_check_completed === true);
  if (['standard-drift-finalize-plan.v1', 'standard-drift-finalize-plan.v2'].includes(plan.contract_version)) return null;
  require(['standard-drift-finalize-plan.v3', 'standard-drift-finalize-plan.v4'].includes(plan.contract_version)
    && !validateJsonSchema(plan, plan.contract_version.endsWith('.v4') ? v4 : v3, '$', { contractKind: 'workflow-definition' }).length);
  const a = plan.objective_alignment, o = output.observations;
  require((plan.contract_version !== 'standard-drift-finalize-plan.v4' || a.session_id === review.session_id) && a.evaluation_operation_id === review.drift_evaluation_operation_id
    && a.evaluation_sha256 === review.drift_evaluation_output_sha256 && a.context_sha256 === plan.context_sha256
    && plan.branch === review.branch && plan.head === review.head && H(o.hook?.payload?.objective_alignment) === H(a)
    && o.report_path === plan.report.path && o.report_sha256 === plan.report.after_sha256
    && artifacts.read(plan.report.path, { required: true }).sha256 === plan.report.after_sha256);
  for (const document of review.documents) {
    require(document.ref.startsWith('audit:'));
    const name = document.ref.slice(6), change = recorded.plan.changes.find(row => row.path === name);
    const postimage = recorded.recorded.output.observations.postimages.find(row => row.path === name);
    if (change) require(change.before_sha256 === document.sha256 && change.before_metadata_sha256 === document.metadata_sha256
      && postimage?.sha256 === change.after_sha256);
    require(artifacts.read(name, { required: true }).sha256 === (change?.after_sha256 ?? document.sha256)
      && artifacts.metadataHash(name) === (change ? postimage.metadata_sha256 : document.metadata_sha256));
  }
  require(o.event_file === '.aidn/runtime/perf/workflow-events.ndjson' && Number.isSafeInteger(o.event_offset) && o.event_offset >= 0);
  const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, o.event_file)), { json: false, maxBytes: 4194304 }).value;
  const end = bytes.indexOf(10, o.event_offset);
  require(end >= o.event_offset && end - o.event_offset < 65536 && (o.event_offset === 0 || bytes[o.event_offset - 1] === 10));
  const event = JSON.parse(bytes.subarray(o.event_offset, end).toString('utf8'));
  require(H(event) === H(o.observed_event) && event.event === 'drift_check_completed' && event.result === 'ok'
    && event.mode === 'COMMITTING' && event.branch === review.branch && event.run_id === 'process_drift_' + record.operation_id
    && event.objective_alignment_sha256 === H(a));
  return structuredClone(a);
}
