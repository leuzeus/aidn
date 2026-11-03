import { assertHumanSessionClosureDecision } from "./standard-session-closure-decision.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import { shadowHash } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(Error(code), { code }); };
export function sessionClosePaths(sessionPath) {
  if (!/^sessions\/S[0-9]+(?:[-_.][^/]*)?\.md$/.test(sessionPath ?? "")) fail("STANDARD_SESSION_CLOSE_PATH_INVALID");
  return [sessionPath, "snapshots/context-snapshot.md", "CURRENT-STATE.md"];
}
function field(text, key, value, optional = false) {
  const regex = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*$", "gm"), matches = [...text.matchAll(regex)];
  if (!matches.length && optional) return text.replace(/^(# [^\n]*\n)/, "$1\n" + key + ": " + value + "\n");
  if (matches.length !== 1) fail("STANDARD_SESSION_CLOSE_FIELD_INVALID");
  return text.replace(regex, (_match, prefix) => prefix + key + ": " + value);
}
function section(text, level, title, body) {
  const heading = "#".repeat(level), regex = new RegExp("(^" + heading + " " + title + "[^\\r\\n]*\\r?\\n)[\\s\\S]*?(?=^#{1," + level + "} |$(?![\\s\\S]))", "gm");
  if ([...text.matchAll(regex)].length !== 1) fail("STANDARD_SESSION_CLOSE_SECTION_INVALID");
  return text.replace(regex, (_match, prefix) => prefix + "\n" + body + "\n\n");
}
const list = values => values.length ? values.map(value => "- " + JSON.stringify(value)).join("\n") : "- none";
// The pending report preserves OPEN and active_session. Only an authenticated
// final hook may later produce CLOSED and the checked completion fields.
export function renderStandardSessionClose({ question, decision, documents, preparedAt }) {
  assertHumanSessionClosureDecision(decision, question);
  const review = question.review, names = sessionClosePaths(review.session_path), report = decision.session_report;
  if (decision.choice !== "close" || review.open_cycles.length || review.session_close_gate_satisfied || !Number.isSafeInteger(preparedAt) || preparedAt < 0
    || documents.length !== 3 || names.some((name, i) => documents[i]?.path !== name)
    || documents.some(row => typeof row.content !== "string" || artifactContentHash(row.content) !== row.sha256 || Buffer.byteLength(row.content) > 1048576)) fail("STANDARD_SESSION_CLOSE_SOURCE_INVALID");
  let session = documents[0].content, snapshot = documents[1].content, current = documents[2].content;
  if (!/^state: OPEN$/m.test(session) || !new RegExp("^active_session: " + review.session_id + "\\s*$", "m").test(current)
    || !/^active_cycle: none\s*$/m.test(current) || /^## Process session closure\s*$/m.test(session)) fail("STANDARD_SESSION_CLOSE_SOURCE_INVALID");
  session = section(session, 3, "Outputs", list([report.summary]));
  session = section(session, 3, "Open loops", list(report.open_loops));
  session = section(session, 3, "Blockers", list(report.blockers));
  session = section(session, 3, "Cycle Resolution At Session Close", "- No attached open cycle remains in the admitted canonical context; no branch integration is inferred.");
  session = section(session, 3, "Next Entry Point", list([report.next_entry_point]));
  session = section(session, 3, "Session close gate satisfied", "- [ ] Yes\n- Pending governed checkpoint and authenticated final hook.");
  session = section(session, 3, "Snapshot updated", "- [ ] Yes\n- Snapshot prepared; final closure confirmation remains pending.");
  const material = { decision_operation_id: question.operation_id, question_sha256: shadowHash(question), source_sha256: shadowHash(decision),
    admission_operation_id: review.admission_operation_id, drift_evaluation_operation_id: review.drift_evaluation_operation_id,
    drift_finalization_operation_id: review.drift_finalization_operation_id, session_close_completed: false, final_hook: "pending", report };
  session = session.trimEnd() + "\n\n## Process session closure\n\n```json\n" + JSON.stringify(material, null, 2) + "\n```\n";
  const at = new Date(preparedAt).toISOString();
  session = field(field(session, "updated_at", at), "session_closure_status", "checkpoint_pending", true);
  snapshot = section(snapshot, 2, "Next entry point", "- Session active: " + review.session_id + "\n- Active cycle: none\n- Next action: Complete the governed session checkpoint and final hook; report retained in " + review.session_path + ".");
  snapshot = field(snapshot, "updated_at", at, true);
  for (const [key, value] of Object.entries({ updated_at: at, session_closure_status: "checkpoint_pending", first_plan_step: "Complete the governed session checkpoint and final hook." }))
    current = field(current, key, value, key === "session_closure_status");
  return documents.map((row, i) => { const after = [session, snapshot, current][i], text_chunks = [];
    for (let offset = 0; offset < after.length; offset += 8192) text_chunks.push(after.slice(offset, offset + 8192));
    return { path: row.path, before_sha256: row.sha256, text_chunks, after_sha256: artifactContentHash(after) };
  });
}

export function renderStandardSessionCloseCompletion({ sessionPath, documents, runId, eventSha256, completedAt }) {
  const names = sessionClosePaths(sessionPath);
  if (typeof runId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(runId) || !/^[a-f0-9]{64}$/.test(eventSha256 ?? "")
    || !Number.isSafeInteger(completedAt) || completedAt < 0 || documents.length !== 3 || names.some((name, i) => documents[i]?.path !== name)
    || documents.some(row => typeof row.content !== "string" || artifactContentHash(row.content) !== row.sha256)
    || !/^state: OPEN$/m.test(documents[0].content) || !/^session_closure_status: checkpoint_pending$/m.test(documents[0].content)) fail("STANDARD_SESSION_CLOSE_COMPLETION_INVALID");
  const at = new Date(completedAt).toISOString(), sessionId = /^sessions\/(S[0-9]+)/.exec(sessionPath)[1];
  let session = field(field(field(documents[0].content, "state", "CLOSED"), "session_closure_status", "completed"), "updated_at", at);
  session = field(session, "lifecycle_status", "closed");
  session = section(session, 3, "Session close gate satisfied", "- [x] Yes\n- Authenticated final hook: aidn:session-close/" + runId);
  session = section(session, 3, "Snapshot updated", "- [x] Yes");
  session += "\n## Process session closure completion\n\n```json\n" + JSON.stringify({ run_id: runId, event_sha256: eventSha256, session_close_completed: true, completed_at: at }, null, 2) + "\n```\n";
  const snapshot = field(section(documents[1].content, 2, "Next entry point", "- Session selected: " + sessionId + " (CLOSED)\n- Active cycle: none\n- Next action: Review session branch integration and PR orchestration with explicit authorization."), "updated_at", at, true);
  let current = documents[2].content;
  for (const [key, value] of Object.entries({ updated_at: at, session_closure_status: "completed", first_plan_step: "Review session branch integration and PR orchestration with explicit authorization." })) current = field(current, key, value);
  // Keep the closed owner selected for explicit PR orchestration. Product writes
  // still require a new admitted active session; this is not an active cycle.
  return documents.map((row, i) => { const after = [session, snapshot, current][i], text_chunks = [];
    for (let offset = 0; offset < after.length; offset += 8192) text_chunks.push(after.slice(offset, offset + 8192));
    return { path: row.path, before_sha256: row.sha256, text_chunks, after_sha256: artifactContentHash(after) };
  });
}
