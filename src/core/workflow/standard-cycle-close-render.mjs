import { assertHumanCycleClosureDecision } from "./standard-cycle-closure-decision.mjs";
import { assertStandardCycleAuditReport } from "./standard-cycle-audit.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import { shadowHash } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const marker = "Process cycle closure";
export function cycleClosePaths(cyclePath) {
  if (!/^cycles\/C[0-9]{3,6}-[a-z]+-[A-Za-z0-9._-]+$/.test(cyclePath ?? "")) fail("STANDARD_CYCLE_CLOSE_PATH_INVALID");
  return ["status.md", "traceability.md", "audit-spec.md", "decisions.md"].map(name => cyclePath + "/" + name)
    .concat("snapshots/context-snapshot.md", "CURRENT-STATE.md");
}
function field(text, key, value) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("^([ \\t]*-?[ \\t]*)" + escaped + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
  if ([...text.matchAll(regex)].length !== 1) fail("STANDARD_CYCLE_CLOSE_FIELD_INVALID");
  return text.replace(regex, (_match, prefix) => `${prefix}${key}: ${value}`);
}
function section(text, title, body, { optional = false } = {}) {
  const regex = new RegExp("(^## " + title + "[^\\r\\n]*\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))", "gm");
  const count = [...text.matchAll(regex)].length;
  if (!count && optional) return text.trimEnd() + `\n\n## ${title}\n\n${body}\n`;
  if (count !== 1) fail("STANDARD_CYCLE_CLOSE_SECTION_INVALID");
  return text.replace(regex, (_match, heading) => heading + "\n" + body + "\n\n");
}
function appendReport(text, body) {
  if (new RegExp("^## " + marker + "\\r?$", "m").test(text)) fail("STANDARD_CYCLE_CLOSE_RECORD_EXISTS");
  return text.trimEnd() + `\n\n## ${marker}\n\n${body}\n`;
}
const jsonBlock = value => "```json\n" + JSON.stringify(value, null, 2) + "\n```";
function chunks(text) {
  const rows = []; let current = "";
  for (const character of text) { if (current.length + character.length > 8192) { rows.push(current); current = ""; } current += character; }
  if (current || !rows.length) rows.push(current);
  return rows;
}

// Rendering is pure. The application must authenticate the accepted human
// source, current audit and physical evidence, then freshly admit and authorize
// the separate write. This prepares terminal metadata, not hook completion.
export function renderStandardCycleClose({ cyclePath, context, question, decision, report, decisionOperationId, documents, preparedAt }) {
  assertHumanCycleClosureDecision(decision, question); assertStandardCycleAuditReport(report);
  const targetState = { retain: "DONE", no_go: "NO_GO", drop: "DROPPED" }[decision.choice], review = question.review;
  const names = cycleClosePaths(cyclePath), cycleId = cyclePath.split("/")[1].split("-")[0];
  if (!targetState || !/^op_[a-f0-9]{40}$/.test(decisionOperationId ?? "") || !Number.isSafeInteger(preparedAt) || preparedAt < 0
    || context.mode !== "COMMITTING" || context.cycle_state !== "VERIFYING" || context.context_use !== "active_cycle"
    || context.cycle_id !== cycleId || review.cycle_id !== cycleId || review.session_id !== context.session_id
    || context.product_sha256 !== review.product_sha256 || report.cycle_id !== cycleId || shadowHash(report) !== review.report_sha256
    || report.context_sha256 !== review.context_sha256) fail("STANDARD_CYCLE_CLOSE_SOURCE_INVALID");
  if (!Array.isArray(documents) || documents.length !== names.length || names.some((name, index) => documents[index]?.path !== name)
    || documents.some(row => typeof row.content !== "string" || Buffer.byteLength(row.content) > 1048576
      || artifactContentHash(row.content) !== row.sha256)) fail("STANDARD_CYCLE_CLOSE_DOCUMENTS_INVALID");
  const byName = Object.fromEntries(documents.map(row => [row.path, row.content])), at = new Date(preparedAt).toISOString();
  const next = targetState === "DONE" ? "Finalize the cycle-close hook before requesting any baseline promotion or session integration."
    : "Finalize the cycle-close hook, preserve non-retained evidence and record the next session/cycle decision.";
  const verified = review.work_complete && !review.pending.requirements.length && !review.pending.usages.length && !review.pending.tests.length;
  let status = byName[names[0]];
  if (!/^\s*-?\s*state:\s*VERIFYING\s*$/m.test(status)) fail("STANDARD_CYCLE_CLOSE_SOURCE_INVALID");
  const scalar = key => {
    const matches = [...status.matchAll(new RegExp("^[ \\t]*-?[ \\t]*" + key + ":[ \\t]*([^\\r\\n]*)$", "gm"))];
    if (matches.length !== 1) fail("STANDARD_CYCLE_CLOSE_FIELD_INVALID");
    return matches[0][1].trim();
  };
  if (scalar("branch_name") !== context.branch || scalar("session_owner") !== context.session_id || scalar("scope_frozen") !== "true"
    || scalar("dor_state") !== "READY") fail("STANDARD_CYCLE_CLOSE_SOURCE_INVALID");
  for (const [key, value] of Object.entries({ state: targetState, outcome: targetState, scope_frozen: "true", usage_matrix_state: verified ? "VERIFIED" : "PARTIAL",
    usage_matrix_rationale: verified ? "Final observed checks and audit reviewed in " + decisionOperationId + "; closure hook pending." : "Non-retained outcome; unresolved validation is preserved in the closure audit.",
    "next step": "\n  - " + next, "last updated": at, updated_at: at })) status = field(status, key, value);
  const binding = { decision_operation_id: decisionOperationId, audit_operation_id: review.audit_operation_id, report_sha256: review.report_sha256,
    question_sha256: shadowHash(question), human_source_sha256: shadowHash(decision), product_sha256: review.product_sha256, scope_sha256: review.scope_sha256,
    requested_state: targetState, closure_hook: "pending", skill_completion: "pending" };
  const trace = appendReport(section(byName[names[1]], "Status", `- Final observed evidence reviewed; requested outcome: ${targetState}.\n- Cycle-close hook and skill completion remain pending.`),
    jsonBlock({ ...binding, requirements: report.requirements, usages: report.usages, pending: review.pending, evidence_refs: report.evidence_refs }));
  const audit = appendReport(byName[names[2]], jsonBlock({ ...binding, document_reviews: report.document_reviews, findings: report.findings,
    recommendation: report.recommendation, human_choice: decision.choice, rationale: decision.rationale }));
  const decisions = appendReport(byName[names[3]], jsonBlock({ ...binding, authority_id: decision.authority_id, source_event_id: decision.source_event_id,
    choice: decision.choice, rationale: decision.rationale, risk_acceptances: decision.risk_acceptances, evidence_refs: decision.evidence_refs }));
  let snapshot = byName[names[4]];
  const active = /^## Active cycles[^\r\n]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(snapshot)?.[1];
  if (active === undefined) fail("STANDARD_CYCLE_CLOSE_SECTION_INVALID");
  const cycleRow = new RegExp("^\\s*-\\s*" + cycleId + "(?=[: \\t]|$)");
  const lines = active.split(/\r?\n/).filter(line => line.trim() && !/^-\s*\(?none\)?\s*$/i.test(line.trim()));
  if (lines.filter(line => cycleRow.test(line)).length !== 1) fail("STANDARD_CYCLE_CLOSE_SNAPSHOT_INVALID");
  snapshot = section(snapshot, "Active cycles", lines.filter(line => !cycleRow.test(line)).join("\n") || "- none");
  const recent = /^## Recently closed[^\r\n]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(snapshot)?.[1]?.trim();
  if (recent?.split(/\r?\n/).some(line => cycleRow.test(line))) fail("STANDARD_CYCLE_CLOSE_RECORD_EXISTS");
  snapshot = section(snapshot, "Recently closed", [recent, `- ${cycleId}: ${targetState}; closure hook pending (${decisionOperationId}).`].filter(Boolean).join("\n"), { optional: true });
  snapshot = section(snapshot, "Next entry point", `- Session active: ${context.session_id}\n- Active cycle: none\n- Next action: ${next}`);
  let current = byName[names[5]];
  if (!new RegExp("^active_cycle:\\s*" + cycleId + "\\s*$", "m").test(current)) fail("STANDARD_CYCLE_CLOSE_FOCUS_INVALID");
  for (const [key, value] of Object.entries({ active_cycle: "none", dor_state: "unknown", first_plan_step: next, updated_at: at })) current = field(current, key, value);
  const contents = [status, trace, audit, decisions, snapshot, current];
  return { target_state: targetState, changes: documents.map((row, index) => ({ path: row.path, before_sha256: row.sha256,
    text_chunks: chunks(contents[index]), after_sha256: artifactContentHash(contents[index]) })) };
}


export function cycleCloseCompletionPaths(cyclePath) {
  const own = cycleClosePaths(cyclePath); return [own[0], own[4], own[5]];
}
export function renderStandardCycleCloseCompletion({ cyclePath, context, documents, runId, eventSha256, completedAt }) {
  const names = cycleCloseCompletionPaths(cyclePath);
  if (!['DONE', 'NO_GO', 'DROPPED'].includes(context.cycle_state) || context.context_use !== 'cycle_completion'
    || !/^process_close_[a-f0-9]{40}$/.test(runId ?? '') || !/^[a-f0-9]{64}$/.test(eventSha256 ?? '')
    || !Number.isSafeInteger(completedAt) || completedAt < 0 || documents.length !== 3 || names.some((name, index) => documents[index]?.path !== name)
    || documents.some(row => artifactContentHash(row.content) !== row.sha256)) fail('STANDARD_CYCLE_CLOSE_COMPLETION_SOURCE_INVALID');
  const next = context.cycle_state === 'DONE' ? 'Review optional baseline promotion or session integration with fresh admission and explicit authorization.'
    : 'Review the next session or cycle decision while preserving the non-retained evidence.';
  const at = new Date(completedAt).toISOString(), reference = 'aidn:cycle-close/' + runId;
  let status = documents[0].content;
  if (!new RegExp('^state: ' + context.cycle_state + '$', 'm').test(status)) fail('STANDARD_CYCLE_CLOSE_COMPLETION_SOURCE_INVALID');
  for (const [key, value] of Object.entries({ 'next step': '\n  - ' + next, 'last updated': at, updated_at: at })) status = field(status, key, value);
  status = appendReport(status, jsonBlock({ checkpoint: reference, checkpoint_event_sha256: eventSha256, cycle_close_completed: true, outcome: context.cycle_state }));
  let snapshot = documents[1].content;
  const recent = /^## Recently closed[^\r\n]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(snapshot)?.[1];
  const row = new RegExp('^([ \t]*-[ \t]*' + context.cycle_id + ':[^\r\n]*?)closure hook pending([^\r\n]*)$', 'gm');
  if (recent === undefined || [...recent.matchAll(row)].length !== 1) fail('STANDARD_CYCLE_CLOSE_COMPLETION_SOURCE_INVALID');
  snapshot = section(snapshot, 'Recently closed', recent.replace(row, (_match, before, after) => before + 'cycle-close checkpoint completed' + after).trim());
  snapshot = section(snapshot, 'Next entry point', '- Session active: ' + context.session_id + '\n- Active cycle: none\n- Next action: ' + next);
  let current = documents[2].content;
  if (!/^active_cycle: none$/m.test(current)) fail('STANDARD_CYCLE_CLOSE_COMPLETION_SOURCE_INVALID');
  current = field(field(current, 'first_plan_step', next), 'updated_at', at);
  return documents.map((doc, index) => { const after = [status, snapshot, current][index]; return { path: doc.path, before_sha256: doc.sha256, text_chunks: chunks(after), after_sha256: artifactContentHash(after) }; });
}
