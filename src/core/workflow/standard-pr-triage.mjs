import schema from '../contracts/workflow-definition/standard-pr-triage-report.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import { shadowHash, checkShadowJson } from './shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
export const PR_TRIAGE_CONTRACT = 'standard-pr-triage-report.v1';

export function assertStandardPrTriageReport(report) {
  if (checkShadowJson(report) || validateJsonSchema(report, schema, '$', { contractKind: 'workflow-definition' }).length
    || Buffer.byteLength(JSON.stringify(report)) > 131072 || new Set(report.items.map(row => row.kind + ':' + row.node_id)).size !== report.items.length)
    fail('STANDARD_PR_TRIAGE_REPORT_INVALID');
  for (const row of report.items) {
    if (!row.rationale.trim() || row.disposition === 'invalid' && !row.proposed_response.trim()
      || row.disposition !== 'uncertain' && !row.evidence_refs.length
      || row.disposition === 'valid' && !row.correction.trim()
      || row.disposition !== 'valid' && row.correction !== ''
      || !['valid', 'invalid'].includes(row.disposition) && row.proposed_response !== '') fail('STANDARD_PR_TRIAGE_REPORT_INCONSISTENT');
  }
  return report;
}

export function standardPrTriageItems(payload) {
  const output = payload.observation.observations;
  const items = output.evidence.reviews.map(row => ({ kind: 'review', node_id: row.node_id,
    body_sha256: row.body_sha256, body_chunks: row.body_chunks, actor: row.author, thread_id: null }));
  for (const thread of output.threads.threads) {
    // Empty or unavailable comment collections remain an explicit unresolved
    // subject. Absence of text must never become evidence of no finding.
    if (!thread.comments.length) items.push({ kind: 'thread', node_id: thread.node_id,
      body_sha256: shadowHash(thread), body_chunks: [], actor: null, thread_id: thread.node_id });
    for (const row of thread.comments) items.push({ kind: 'comment', node_id: row.node_id,
      body_sha256: row.body_sha256, body_chunks: row.body_chunks,
      actor: row.author_node_id ? { node_id: row.author_node_id, login: row.author_login, type: row.author_type } : null,
      thread_id: thread.node_id });
  }
  return items;
}

// This evaluates report coverage and provenance. It does not infer a reply,
// resolution, successful correction/check or permission to merge from prose.
export function evaluateStandardPrTriage({ report, context, producer, evidenceRefs }) {
  assertStandardPrTriageReport(report);
  if (context.contract_version !== 'standard-pr-triage-context.v1' || report.context_sha256 !== shadowHash(context)) fail('STANDARD_PR_TRIAGE_CONTEXT_CHANGED');
  const expected = standardPrTriageItems(context.payload), inventory = new Map(expected.map(row => [row.kind + ':' + row.node_id, row]));
  if (inventory.size !== expected.length || report.items.length !== expected.length) fail('STANDARD_PR_TRIAGE_COVERAGE_REQUIRED');
  const allowed = new Map(context.evidence_refs.map(row => [row.ref, row.sha256]));
  for (const row of report.items) {
    const source = inventory.get(row.kind + ':' + row.node_id);
    if (!source || source.body_sha256 !== row.body_sha256 || source.thread_id !== row.thread_id
      || (!source.actor || source.kind === 'thread' || !source.body_chunks.join('').trim()) && row.disposition !== 'uncertain'
      || row.evidence_refs.some(ref => allowed.get(ref.ref) !== ref.sha256)
      || row.disposition !== 'uncertain' && !row.evidence_refs.some(ref => ref.ref === 'github:' + row.kind + '/' + row.node_id && ref.sha256 === source.body_sha256)
      || ['valid', 'invalid'].includes(row.disposition) && !row.evidence_refs.some(ref => ref.ref.startsWith('product:')))
      fail('STANDARD_PR_TRIAGE_EVIDENCE_INVALID');
  }
  const uncertain = report.items.some(row => row.disposition === 'uncertain'), fixes = report.items.filter(row => row.disposition === 'valid');
  const replies = report.items.filter(row => ['valid', 'invalid'].includes(row.disposition));
  return { contract_version: 'standard-pr-triage-output.v1', operation_ref: 'session_pr_triage_evaluate',
    outcome: uncertain ? 'blocked' : 'completed', effect_status: 'no_effect',
    facts: uncertain ? {} : { session_pr_findings_classified: true, session_pr_corrections_required: fixes.length > 0, session_pr_responses_required: replies.length > 0 },
    observations: { received_operation_id: context.received_operation_id, selection_operation_id: context.selection_operation_id,
      payload_sha256: context.payload_sha256, product_sha256: context.product_sha256, head_oid: context.payload.event.head_oid,
      base_oid: context.payload.event.base_oid, context_sha256: shadowHash(context), producer, dispositions: report.items,
      corrections: fixes.map(row => ({ kind: row.kind, node_id: row.node_id, thread_id: row.thread_id, correction: row.correction })),
      responses: replies.map(row => ({ kind: row.kind, node_id: row.node_id, thread_id: row.thread_id, body: row.proposed_response,
        status: row.proposed_response.trim() ? 'proposed' : 'required-after-correction' })),
      unresolved_threads: context.payload.observation.observations.threads.threads.filter(row => !row.is_resolved).map(row => row.node_id),
      triage_completion: 'pending-effects-and-verification', checks_acceptance: 'not-established', merge_authorization: 'not-established' },
    evidence_refs: evidenceRefs };
}
