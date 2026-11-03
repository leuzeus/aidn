import { artifactContentHash } from './artifact-compare-swap.mjs';
import { checkShadowJson, shadowHash } from './shadow-json.mjs';
import { validateJsonSchema } from '../contracts/json-schema-validator.mjs';
import linkSchema from '../contracts/workflow-definition/github-pr-link.v1.schema.json' with { type: 'json' };
const fail = code => { throw Object.assign(Error(code), { code }); };
function field(text, key, value, optional = false) {
  const regex = new RegExp('^([ \\t]*-?[ \\t]*)' + key + ':[^\\r\\n]*$', 'gm'), matches = [...text.matchAll(regex)];
  if (!matches.length && optional) {
    if (!/^# [^\n]*\n/.test(text)) fail('STANDARD_PR_RECORD_FIELD_INVALID');
    return text.replace(/^(# [^\n]*\n)/, '$1\n' + key + ': ' + value + '\n');
  }
  if (matches.length !== 1) fail('STANDARD_PR_RECORD_FIELD_INVALID');
  return text.replace(regex, (_match, prefix) => prefix + key + ': ' + value);
}
export function sessionPrRecordPaths(sessionPath) {
  if (!/^sessions\/S[0-9]{3,6}\.md$/.test(sessionPath ?? '')) fail('STANDARD_PR_RECORD_PATH_INVALID');
  return [sessionPath, 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'];
}
// A session lifecycle update consumes an authenticated observed PR; it cannot
// manufacture a remote effect, review approval, merge or post-merge success.
export function renderStandardSessionPrRecord({ source, documents, preparedAt }) {
  const link = source?.pull_request, names = sessionPrRecordPaths(source?.session_path);
  if (checkShadowJson(link) || validateJsonSchema(link, linkSchema, '$', { contractKind: 'workflow-definition' }).length
    || link.state !== 'OPEN' || link.draft || !/^S[0-9]{3,6}$/.test(source.session_id ?? '')
    || !/^op_[a-f0-9]{40}$/.test(source.open_operation_id ?? '') || !Number.isSafeInteger(preparedAt) || preparedAt < 0
    || documents.length !== names.length || names.some((name, index) => documents[index].path !== name)
    || documents.some(row => typeof row.content !== 'string' || artifactContentHash(row.content) !== row.sha256 || Buffer.byteLength(row.content) > 1048576))
    fail('STANDARD_PR_RECORD_SOURCE_INVALID');
  let session = documents[0].content, current = documents[1].content, snapshot = documents[2].content;
  if (!/^state: CLOSED$/m.test(session) || !/^session_closure_status: completed$/m.test(session)
    || !new RegExp('^active_session: ' + source.session_id + '\\s*$', 'm').test(current) || !/^active_cycle: none\s*$/m.test(current)
    || /^## Process PR opening\s*$/m.test(session)) fail('STANDARD_PR_RECORD_OWNER_INVALID');
  const at = new Date(preparedAt).toISOString();
  const values = { pr_status: 'open', pr_url: link.url, pr_number: String(link.number), pr_base_branch: link.base_branch,
    pr_head_branch: link.head_branch, pr_review_status: 'pending', post_merge_sync_status: 'not_needed', post_merge_sync_basis: 'none' };
  for (const [key, value] of Object.entries(values)) session = field(session, key, value);
  session = field(session, 'updated_at', at);
  session += '\n## Process PR opening\n\n```json\n' + JSON.stringify({ open_operation_id: source.open_operation_id,
    repository_id: link.repository_id, pull_request_id: link.node_id, observation_sha256: shadowHash(link),
    observed_delivery_head: link.head_oid, canonical_lifecycle: 'open', review: 'pending', checkpoint: 'pending' }, null, 2) + '\n```\n';
  for (const [key, value] of Object.entries({ updated_at: at, session_branch: link.head_branch, session_pr_status: 'open', session_pr_review_status: 'pending',
    post_merge_sync_status: 'not_needed', first_plan_step: 'Checkpoint the canonical PR lifecycle update and push its delivery before review.' })) current = field(current, key, value, key !== 'updated_at' && key !== 'first_plan_step');
  snapshot = field(snapshot, 'updated_at', at, true);
  const heading = /(^## Next entry point[^\r\n]*\r?\n)[\s\S]*?(?=^#{1,2} |$(?![\s\S]))/gm;
  if ([...snapshot.matchAll(heading)].length !== 1) fail('STANDARD_PR_RECORD_SNAPSHOT_INVALID');
  snapshot = snapshot.replace(heading, (_match, prefix) => prefix + '\n- Closed session: ' + source.session_id + '\n- PR: ' + link.url
    + '\n- Review: pending\n- Next action: Checkpoint the canonical PR lifecycle update and push its delivery before review.\n\n');
  return documents.map((row, index) => {
    const after = [session, current, snapshot][index], text_chunks = [];
    for (let offset = 0; offset < after.length; offset += 8192) text_chunks.push(after.slice(offset, offset + 8192));
    return { path: row.path, before_sha256: row.sha256, text_chunks, after_sha256: artifactContentHash(after) };
  });
}
