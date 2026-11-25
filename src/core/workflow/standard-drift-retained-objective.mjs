import { shadowHash } from './shadow-json.mjs';
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import schema from '../contracts/workflow-definition/standard-drift-objective-disposition.v2.schema.json' with { type: 'json' };

const require = (condition, code = 'STANDARD_RETAINED_OBJECTIVE_SUBJECT_CHANGED') => {
  if (!condition) throw Object.assign(Error(code), { code });
};
export function assertRetainedObjectiveAlignment(value) {
  require(validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length === 0,
    'STANDARD_RETAINED_OBJECTIVE_INVALID');
  return value;
}

// The owning reader authenticates the source decision, receipt and physical
// completion. This projection preserves those bytes and explicitly names the
// different current evaluation; it is never another Human receipt or grant.
export function retainObjectiveAlignment(source, input, verified) {
  const { disposition, completion, scope } = source, context = verified.context;
  const output = verified.output, report = output.observations.report;
  require(context.mode === 'COMMITTING' && context.cycle_state === 'DONE'
    && context.session_id === scope.session_id && context.cycle_id === scope.cycle_id
    && context.branch === scope.branch && context.head === scope.head
    && context.product_sha256 === scope.product_sha256);
  const session = context.documents.find(row => row.ref === 'audit:sessions/' + scope.session_id + '.md');
  const parsed = session && analyzeStructuredArtifact(session.content, { classification: { kind: 'session' } });
  const cycles = context.documents.filter(row => row.ref.startsWith('audit:cycles/' + scope.cycle_id + '-') && row.ref.endsWith('/status.md'));
  const cycle = cycles.length === 1 && analyzeStructuredArtifact(cycles[0].content).key_values;
  require(cycle && cycle.session_owner === scope.session_id && cycle.state === 'DONE'
    && parsed?.key_values.state === 'OPEN' && parsed.derived_session_context.attached_cycles.includes(scope.cycle_id));
  require(parsed.key_values.session_objective === disposition.session_objective
    && context.original_objective === disposition.cycle_objective
    && report.original_objective === disposition.cycle_objective && report.current_objective === disposition.cycle_objective);
  require(output.facts.drift_present === false && output.facts.drift_recovery_required === false
    && output.facts.drift_context_complete === true && report.objective_changed === false && report.drift_level === 'none',
  'STANDARD_RETAINED_OBJECTIVE_FRESH_DIAGNOSIS_REQUIRED');
  require(verified.context_sha256 === shadowHash(context) && verified.evaluation_sha256 === shadowHash(output)
    && report.context_sha256 === verified.context_sha256, 'STANDARD_RETAINED_OBJECTIVE_EVALUATION_CHANGED');
  require(completion.alignment_sha256 === shadowHash(disposition), 'STANDARD_RETAINED_OBJECTIVE_COMPLETION_CHANGED');
  return assertRetainedObjectiveAlignment({ contract_version: 'standard-drift-objective-disposition.v2',
    decision_operation_id: disposition.decision_operation_id, evaluation_operation_id: input.evaluation_operation_id,
    evaluation_sha256: verified.evaluation_sha256, context_sha256: verified.context_sha256,
    session_id: scope.session_id, cycle_id: scope.cycle_id,
    session_objective: disposition.session_objective, cycle_objective: disposition.cycle_objective,
    prepared_at_ms: disposition.prepared_at_ms,
    source: structuredClone({ disposition, completion, scope }) });
}
