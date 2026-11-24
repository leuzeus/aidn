import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createRetainedPromotionSource } from './standard-retained-promotion-source.mjs';
import { retainedPromotionContinuation } from '../../core/workflow/standard-retained-promotion.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';

const require = ok => { if (!ok) throw Object.assign(Error('STANDARD_SESSION_INTEGRATION_HISTORY_CHANGED'), { code: 'STANDARD_SESSION_INTEGRATION_HISTORY_CHANGED' }); };
// Fixed host capability. The delivery source has authenticated the accepted
// session-close chain; this reader additionally authenticates its cycle audit,
// retained Human choice, terminal record and subsequent baseline promotion.
export async function readRetainedSessionCycleHistory({ configuration, environment, createAuthority, source, readValidation }) {
  const historical = source.checkpoint.historical;
  const ref = source.checkpoint.instance.initial_parameters.entry_point.original_configuration;
  const execution = readAgentRunFile(ref.path, { sha256: ref.sha256 }).value;
  require(execution.instance_id === historical.instance.instance_id && H(execution) === historical.proof.original_configuration_sha256
    && historical.instance.initial_parameters.entry_point.kind === 'retained_promotion');
  const promotion = await createRetainedPromotionSource({ configuration, environment, createAuthority })
    .readRecorded(historical.instance.initial_parameters.entry_point, { readValidation });
  const entry = historical.records[0].results[0].output, selected = historical.records[1].results[0].output;
  require(H(entry.observations.continuation) === H(retainedPromotionContinuation(promotion.proof)));
  const { completed } = promotion, closed = completed.closed;
  require(selected.observations.closure_operation_id === closed.record.operation_id
    && selected.observations.receipt_sha256 === H(closed.record.results[0].receipt)
    && selected.observations.output_sha256 === H(closed.output)
    && completed.proof.session_id === source.proof.session_id);
  const finish = historical.records.filter(row => row.intent.binding_ref === 'baseline_promotion_finalize');
  require(finish.length === 1);
  const plan = finish[0].preview.prepared.plan, output = finish[0].results[0].output;
  require(plan.input.record_operation_id === promotion.promotion.record_operation_id
    && plan.record_plan_sha256 === H(promotion.promotion.plan) && plan.record_output_sha256 === H(promotion.promotion.output)
    && H(plan.request) === H(promotion.promotion.plan.request)
    && output.effect_status === 'confirmed' && output.facts.baseline_promotion_completed === true);
  const records = [...completed.records, ...promotion.records, ...historical.records]
    .filter(row => ['cycle_close_finalize', 'baseline_promotion_record', 'baseline_promotion_finalize'].includes(row.intent.binding_ref));
  require(new Set(records.map(row => row.operation_id)).size === records.length
    && H(readAgentRunFile(ref.path, { sha256: ref.sha256 }).value) === H(execution));
  return { closed, terminal: completed.terminal,
    material_sha256: H({ delivery: source.proof, promotion: promotion.proof, completion: completed.proof, records }),
    records: records.map(record => ({ record, output: record.results[0].output })) };
}
