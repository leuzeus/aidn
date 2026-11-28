import { inspectAgenticProcess } from './agentic-process.mjs';
import { shadowHash as H } from './shadow-json.mjs';
import { assertRetainedSessionClosureEntry } from './standard-retained-session-closure.mjs';

const fail = () => { throw Object.assign(Error('STANDARD_RETAINED_SESSION_CLOSURE_BOUNDARY_CHANGED'),
  { code: 'STANDARD_RETAINED_SESSION_CLOSURE_BOUNDARY_CHANGED' }); };
const sequence = ['workflow_entry_select', 'cycle_close_completed_select', 'drift_report_evaluate', 'drift_followup_select',
  'drift_check_finalize', 'baseline_promotion_finalize', 'session_preclose_checkpoint', 'session_close_admit',
  'drift_report_evaluate', 'drift_check_finalize', 'session_closure_decision'];

// Relationship checks only. The host must authenticate every journal, Human
// source, Native closure and current subject before using this retained entry.
export function assertAcceptedSessionClosureBoundary(entry, instance, records) {
  assertRetainedSessionClosureEntry(entry);
  if (entry.version !== 2 || instance.instance_sha256 !== entry.original_instance_sha256
    || instance.initial_parameters?.entry_point?.kind !== 'retained_promotion'
    || instance.initial_parameters.entry_point.version !== 2
    || H(records.map(row => row.intent.binding_ref)) !== H(sequence)
    || records.at(-1).operation_id !== entry.decision_operation_id) fail();
  for (const row of records) {
    const result = row.results[0];
    if (row.phase !== 'receipted' || row.results.length !== 1 || result.receipt.outcome !== 'completed'
      || result.output.outcome !== 'completed' || result.receipt.output_sha256 !== H(result.output)
      || result.receipt.effect_status !== result.output.effect_status
      || !(row === records.at(-1) ? result.output.effect_status === 'no_effect' : ['no_effect', 'confirmed'].includes(result.output.effect_status))
      || instance.events.filter(event => event.kind === 'operation_result' && H(event.receipt) === H(result.receipt)).length !== 1) fail();
  }
  const cursor = inspectAgenticProcess(instance), waits = cursor.occurrences.filter(row => row.status === 'WAITING');
  if (cursor.status !== 'WAITING' || cursor.ready.length || waits.length !== 1
    || waits[0].node_id !== 'session_close_preparation_route' || waits[0].wait_reason !== 'routing_fact') fail();
  const parent = cursor.occurrences.find(row => row.occurrence_id === waits[0].call_scope_id);
  if (parent?.node_id !== 'session_integration_prepare') fail();
  const lastReceipt = records.at(-1).results[0].receipt;
  const index = instance.events.findIndex(event => event.kind === 'operation_result' && H(event.receipt) === H(lastReceipt));
  const suffix = instance.events.slice(index + 1);
  if (suffix.length !== 1 || suffix[0].kind !== 'call_enter' || suffix[0].occurrence_id !== parent.occurrence_id) fail();
  return { version: 2, boundary: entry.boundary, post_decision_events_sha256: H(suffix) };
}
