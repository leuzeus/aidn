import { artifactContentHash } from './artifact-compare-swap.mjs';
import { shadowHash } from './shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
function field(text, key, value) {
  const re = new RegExp('^([ \\t]*-?[ \\t]*)' + key + ':[^\\r\\n]*$', 'gm');
  if ([...text.matchAll(re)].length !== 1) fail('STANDARD_PR_CORRECTION_FIELD_INVALID');
  return text.replace(re, (_all, prefix) => prefix + key + ': ' + value);
}
function section(text, title, body) {
  const re = new RegExp('(^#{2,3} ' + title + '[^\\r\\n]*\\r?\\n)[\\s\\S]*?(?=^#{1,3} |$(?![\\s\\S]))', 'gm');
  if ([...text.matchAll(re)].length !== 1) fail('STANDARD_PR_CORRECTION_SECTION_INVALID');
  return text.replace(re, (_all, heading) => heading + '\n' + body + '\n\n');
}
export function prCorrectionReopenPaths(sessionId) {
  if (!/^S[0-9]{3,6}$/.test(sessionId ?? '')) fail('STANDARD_PR_CORRECTION_SESSION_INVALID');
  return ['sessions/' + sessionId + '.md', 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'];
}

// Preserve the closed report under a historical heading before making the
// existing owner active again. Product admission still needs a new real cycle.
export function renderPrCorrectionReopen({ source, documents, preparedAt }) {
  const names = prCorrectionReopenPaths(source.session_id), id = source.triage_operation_id;
  if (!/^op_[a-f0-9]{40}$/.test(id ?? '') || !Number.isSafeInteger(preparedAt) || preparedAt < 0
    || !Array.isArray(source.corrections) || !source.corrections.length || documents.length !== 3
    || names.some((name, i) => documents[i]?.path !== name)
    || documents.some(row => typeof row.content !== 'string' || artifactContentHash(row.content) !== row.sha256)) fail('STANDARD_PR_CORRECTION_SOURCE_INVALID');
  let session = documents[0].content, current = documents[1].content, snapshot = documents[2].content;
  if (!/^state: CLOSED$/m.test(session) || !/^session_closure_status: completed$/m.test(session) || !/^[ \t]*-?[ \t]*pr_status: open$/m.test(session)
    || !new RegExp('^active_session: ' + source.session_id + '\\s*$', 'm').test(current) || !/^active_cycle: none\s*$/m.test(current)
    || !/^mode: COMMITTING$/m.test(current) || !/^session_pr_status: open$/m.test(current)
    || session.includes('## Process PR correction continuation ' + id)) fail('STANDARD_PR_CORRECTION_OWNER_INVALID');
  for (const title of ['Process session closure', 'Process session closure completion']) {
    const re = new RegExp('^## ' + title + '[ \\t]*$', 'gm');
    if ([...session.matchAll(re)].length !== 1) fail('STANDARD_PR_CORRECTION_CLOSURE_HISTORY_REQUIRED');
    session = session.replace(re, '## Historical ' + title + ' before ' + id);
  }
  const at = new Date(preparedAt).toISOString();
  for (const [key, value] of Object.entries({ state: 'OPEN', lifecycle_status: 'active', session_closure_status: 'correction_pending',
    pr_review_status: 'pending', updated_at: at })) session = field(session, key, value);
  session = section(session, 'Session close gate satisfied', '- [ ] Yes\n- Reopened for admitted PR corrections; fresh closure remains required.');
  session = section(session, 'Snapshot updated', '- [ ] Yes\n- Correction continuation retained; a fresh final closure remains required.');
  session += '\n## Process PR correction continuation ' + id + '\n\n```json\n' + JSON.stringify({
    triage_operation_id: id, source_sha256: shadowHash(source), head_oid: source.pull_request.head_oid, base_oid: source.pull_request.base_oid,
    corrections: source.corrections, cycle: 'not-created', implementation_admission: 'not-established', validation: 'pending',
    response: 'pending', resolution: 'pending', merge_authorization: 'not-established' }, null, 2) + '\n```\n';
  const next = 'Create an admitted correction cycle from this session, freeze its plan and enter IMPLEMENTING before product edits.';
  for (const [key, value] of Object.entries({ updated_at: at, session_closure_status: 'correction_pending', session_pr_review_status: 'pending', first_plan_step: next }))
    current = field(current, key, value);
  snapshot = field(snapshot, 'updated_at', at);
  snapshot = section(snapshot, 'Next entry point', '- Session reopened: ' + source.session_id + '\n- Active cycle: none\n- Next action: ' + next);
  if (!/^state: OPEN$/m.test(session) || !/^session_closure_status: correction_pending$/m.test(session)
    || !/^session_closure_status: correction_pending$/m.test(current) || !/^active_cycle: none\s*$/m.test(current))
    fail('STANDARD_PR_CORRECTION_RENDER_POSTCONDITION_INVALID');
  return documents.map((row, i) => {
    const after = [session, current, snapshot][i], text_chunks = [];
    for (let offset = 0; offset < after.length; offset += 8192) text_chunks.push(after.slice(offset, offset + 8192));
    return { path: row.path, before_sha256: row.sha256, after_sha256: artifactContentHash(after), text_chunks };
  });
}
