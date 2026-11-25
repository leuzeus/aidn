import { createHash } from 'node:crypto';
import { shadowHash } from './shadow-json.mjs';
const fail = () => { throw Object.assign(Error('GITHUB_CODEX_REVIEW_SUMMARY_INVALID'), { code: 'GITHUB_CODEX_REVIEW_SUMMARY_INVALID' }); };

// This parses content, not identity. The provider must independently authenticate
// the configured Bot, owning repository/PR and exact current head/base.
// Only the explicit completed/no-findings form is supported. A pending summary,
// findings, prose receipt or abbreviated commit cannot stand in for that result.
export function readCodexReviewSummary(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 65536
    || !body.startsWith('<!-- codex-pull-request-review-summary -->')) fail();
  const markers = [...body.matchAll(/<!-- codex-review-state:v1 (\{[^\r\n]*\}) -->/g)];
  if (markers.length !== 1) fail();
  let value;
  try { value = JSON.parse(markers[0][1]); } catch { fail(); }
  const code = value?.code_review;
  const security = value?.security_review;
  const keys = 'commit_sha,has_any_findings,has_unresolved_findings,status';
  if (!code || Object.keys(value).sort().join(',') !== 'code_review,security_review' || Object.keys(code).sort().join(',') !== keys
    || !/^[a-f0-9]{40}$/.test(code.commit_sha ?? '') || code.status !== 'completed'
    || code.has_any_findings !== false || code.has_unresolved_findings !== false) fail();
  if (!security || Object.keys(security).sort().join(',') !== keys
    || !(Object.values(security).every(v => v === null)
      || security.status === 'completed' && security.commit_sha === code.commit_sha
        && security.has_any_findings === false && security.has_unresolved_findings === false)) fail();
  return code.commit_sha;
}

export function assertCodexReviewSummaryEvent(event) {
  const source = event.summary;
  const body = source.body_chunks.join('');
  if (event.actor.type !== 'Bot' || source.node_id.length === 0
    || source.updated_at !== event.occurred_at || !Number.isSafeInteger(Date.parse(source.created_at))
    || Date.parse(source.created_at) > Date.parse(source.updated_at)
    || createHash('sha256').update(body).digest('hex') !== source.body_sha256
    || readCodexReviewSummary(body) !== event.head_oid
    || event.source_event_id !== 'codex-summary-' + shadowHash(source.node_id)
    || (source.last_edited_at === null ? source.editor !== null : !source.editor
      || shadowHash(source.editor) !== shadowHash(event.actor) || !Number.isSafeInteger(Date.parse(source.last_edited_at))
      || Date.parse(source.last_edited_at) < Date.parse(source.created_at) || Date.parse(source.last_edited_at) > Date.parse(source.updated_at))
    || event.revision !== shadowHash({ state: 'COMPLETED_NO_FINDINGS', updated_at: source.updated_at, body_sha256: source.body_sha256,
      editor: source.editor, last_edited_at: source.last_edited_at })) fail();
  return event;
}
