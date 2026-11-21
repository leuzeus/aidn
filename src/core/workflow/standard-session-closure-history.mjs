import recordSchema from "../contracts/workflow-definition/standard-session-closure-record.v2.schema.json" with { type: "json" };
import completionSchema from "../contracts/workflow-definition/standard-session-closure-completion.v2.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
const fail = () => { throw Object.assign(Error("STANDARD_SESSION_CLOSURE_HISTORY_INVALID"), { code: "STANDARD_SESSION_CLOSURE_HISTORY_INVALID" }); };
export function assertSessionClosureRecord(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, recordSchema, "$", { contractKind: "workflow-definition" }).length
    || new Set(value.history.map(row => row.before_triage_operation_id)).size !== value.history.length) fail();
  return value;
}
export function assertSessionClosureCompletion(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, completionSchema, "$", { contractKind: "workflow-definition" }).length) fail();
  return value;
}
function assertPair(record, done) {
  const v2 = record.value.contract_version === "standard-session-closure-record.v2";
  if (v2 !== (done.value.contract_version === "standard-session-closure-completion.v2")
    || v2 && (done.value.record_sha256 !== shadowHash(record.value) || done.value.decision_operation_id !== record.value.decision_operation_id)) fail();
}
// Read existing records without rewriting them. The heading is the only part
// renamed by the explicit reopen operation; each retained body stays verbatim.
export function readSessionClosureHistory(content) {
  const headings = [...content.matchAll(/^## (?:Historical )?Process session closure(?: completion)?(?: before op_[a-f0-9]{40})?[ \t]*\r?$/gm)];
  const records = headings.map(match => {
    const end = content.slice(match.index + match[0].length).search(/^## /m);
    const block = content.slice(match.index, end < 0 ? content.length : match.index + match[0].length + end);
    const body = /^## [^\n]*\r?\n\s*```json\r?\n([\s\S]*?)\r?\n```\s*$/.exec(block);
    let value; try { value = body && JSON.parse(body[1]); } catch { fail(); }
    if (!value || checkShadowJson(value)) fail();
    if (value.contract_version === "standard-session-closure-record.v2") assertSessionClosureRecord(value);
    else if (value.contract_version === "standard-session-closure-completion.v2") assertSessionClosureCompletion(value);
    else if (value.contract_version !== undefined) fail();
    const historical = /^## Historical /.test(match[0]), completed = / closure completion/.test(match[0]);
    const before = / before (op_[a-f0-9]{40})/.exec(match[0])?.[1] ?? null;
    if (historical !== (before !== null) || value.session_close_completed !== completed
      || (completed ? !/^[a-f0-9]{64}$/.test(value.event_sha256 ?? "") || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.run_id ?? "")
        : !/^op_[a-f0-9]{40}$/.test(value.decision_operation_id ?? "") || value.final_hook !== "pending")) fail();
    return { historical, completed, before, value, block, sha256: artifactContentHash(block) };
  });
  const history = [], pending = records.filter(row => !row.historical && !row.completed), completion = records.filter(row => !row.historical && row.completed);
  if (pending.length > 1 || completion.length > 1 || completion.length && !pending.length) fail();
  if (completion.length) {
    if (records.indexOf(pending[0]) > records.indexOf(completion[0])) fail();
    assertPair(pending[0], completion[0]);
  }
  const old = records.filter(row => row.historical);
  for (let i = 0; i < old.length; i += 2) {
    const record = old[i], done = old[i + 1];
    if (record.completed || !done?.completed || record.before !== done.before) fail();
    if (record.value.contract_version === "standard-session-closure-record.v2"
      && shadowHash(record.value.history) !== shadowHash(history)) fail();
    assertPair(record, done);
    history.push({ before_triage_operation_id: record.before, record_sha256: record.sha256, completion_sha256: done.sha256 });
  }
  if (new Set(history.map(row => row.before_triage_operation_id)).size !== history.length) fail();
  if (pending[0]?.value.contract_version === "standard-session-closure-record.v2"
    && shadowHash(pending[0].value.history) !== shadowHash(history)) fail();
  return { history, pending: pending[0] ?? null, completion: completion[0] ?? null };
}
