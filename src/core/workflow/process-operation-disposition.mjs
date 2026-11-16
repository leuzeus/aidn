import planSchema from '../contracts/workflow-definition/process-operation-disposition-plan.v2.schema.json' with { type: 'json' };
import recordSchema from '../contracts/workflow-definition/process-operation-disposition.v2.schema.json' with { type: 'json' };
import receiptSchema from '../contracts/workflow-definition/process-operation-receipt.v1.schema.json' with { type: 'json' };
import journalSchema from '../contracts/workflow-definition/process-operation-journal.v1.schema.json' with { type: 'json' };
import controlSchema from '../contracts/workflow-definition/process-operation-control-intent.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import { assertPrIncidentCloseOutput, prIncidentCloseOperation } from './standard-pr-incident-close.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, '$', { contractKind: 'workflow-definition' }).length;
const same = (left, right) => shadowHash(left) === shadowHash(right);
const resultFields = ['plan', 'grant', 'receipt', 'output', 'effect_knowledge', 'resource_fence'];
export const operationDispositionResultLimit = recordSchema.properties.results.maxItems;
if (operationDispositionResultLimit !== journalSchema.properties.results.maxItems - 1)
  fail('PROCESS_DISPOSITION_RESULT_LIMIT_DRIFT');

// Data continuity only: the host must authenticate both records and separately
// verify current permission, the exact held lease, source and business CAS.
export function operationControlHistoryExtends(previous, current) {
  if (!valid(previous, controlSchema) || !valid(current, controlSchema)) return false;
  const appended = current.attempts.length - previous.attempts.length;
  return appended >= 0 && current.revision === previous.revision + appended
    && current.operation_id === previous.operation_id && current.key_id === previous.key_id
    && previous.attempts.every((attempt, index) => same(attempt, current.attempts[index]));
}

// Contract checks establish shape/binding only. The owning host separately
// authenticates MACs, original intent/source, current permission and live fences.
export function assertIncidentContinuationPlan(value) {
  if (!valid(value, planSchema)) fail('PROCESS_DISPOSITION_PLAN_INVALID');
  const c = value.continuation, paths = c.owned_paths;
  if (value.output_sha256 === c.expected_output_sha256) fail('PROCESS_DISPOSITION_PLAN_INVALID');
  if (new Set(paths).size !== 3 || paths.some(name => !/^(incidents|sessions|snapshots)\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name))
    || !paths[0].startsWith('incidents/') || !paths[1].startsWith('sessions/') || !paths[2].startsWith('snapshots/'))
    fail('PROCESS_DISPOSITION_PLAN_INVALID');
  const output = assertPrIncidentCloseOutput(c.expected_output);
  if (output.operation_ref !== prIncidentCloseOperation || output.outcome !== 'completed' || output.effect_status !== 'confirmed'
    || shadowHash(output) !== c.expected_output_sha256 || output.observations.plan_sha256 !== c.closure_plan_sha256
    || output.observations.incident_id !== paths[0].slice('incidents/'.length, -3)
    || !same(output.evidence_refs.map(row => row.ref), paths.slice(1).map(name => 'docs/audit/' + name)))
    fail('PROCESS_DISPOSITION_PLAN_INVALID');
  return value;
}

function originalSubject(plan) {
  const c = plan.continuation;
  return { operation_id: plan.operation_id, instance_id: plan.instance_id, scope_id: plan.scope_id,
    model_sha256: plan.model_sha256, authority_sha256: plan.authority_sha256, runtime_sha256: plan.runtime_sha256,
    physical_root_sha256: plan.physical_root_sha256, dispatch_sha256: plan.dispatch_sha256,
    original_output_sha256: plan.output_sha256, original_receipt_sha256: c.original_receipt_sha256,
    closure_plan_sha256: c.closure_plan_sha256, source_sha256: c.source_sha256, boundary_sha256: c.boundary_sha256,
    owned_paths: c.owned_paths, expected_output_sha256: c.expected_output_sha256 };
}
function assertResult(row, operationId) {
  const plan = assertIncidentContinuationPlan(row.plan), output = assertPrIncidentCloseOutput(row.output), receipt = row.receipt;
  if (plan.operation_id !== operationId || !valid(receipt, receiptSchema) || receipt.operation_id !== operationId
    || receipt.output_sha256 !== shadowHash(output) || receipt.outcome !== output.outcome
    || receipt.effect_status !== output.effect_status || !same(receipt.facts, output.facts)
    || output.observations.incident_id !== plan.continuation.expected_output.observations.incident_id
    || output.observations.plan_sha256 !== plan.continuation.closure_plan_sha256
    || shadowHash(receipt) === plan.continuation.original_receipt_sha256)
    fail('PROCESS_DISPOSITION_RECORD_INVALID');
  if (output.outcome === 'completed') {
    if (row.effect_knowledge !== 'known_prefix' || receipt.output_sha256 !== plan.continuation.expected_output_sha256)
      fail('PROCESS_DISPOSITION_RECORD_INVALID');
  } else if (output.outcome !== 'reconciliation_required' || output.effect_status !== 'unknown') {
    // A refusal of this continuation cannot relabel the original partial as no-effect.
    fail('PROCESS_DISPOSITION_RECORD_INVALID');
  }
  return originalSubject(plan);
}
export function assertIncidentContinuationDisposition(value) {
  if (!valid(value, recordSchema)) fail('PROCESS_DISPOSITION_RECORD_INVALID');
  const subject = assertResult(value, value.operation_id), receiptIds = new Set();
  for (const [index, row] of value.results.entries()) {
    if (!same(assertResult(row, value.operation_id), subject)
      || row.receipt.receipt_id !== 'receipt_' + value.operation_id.slice(3) + '_' + (index + 1)
      || receiptIds.has(row.receipt.receipt_id)) fail('PROCESS_DISPOSITION_RECORD_INVALID');
    receiptIds.add(row.receipt.receipt_id);
  }
  if (!same(Object.fromEntries(resultFields.map(key => [key, value[key]])), value.results.at(-1)))
    fail('PROCESS_DISPOSITION_RECORD_INVALID');
  for (const attempt of value.attempts) {
    if (!same(originalSubject(assertIncidentContinuationPlan(attempt.plan)), subject))
      fail('PROCESS_DISPOSITION_RECORD_INVALID');
  }
  return value;
}
