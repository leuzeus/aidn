import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const isUuid = value => typeof value === "string" && value.length === 36 && uuid.test(value);

// Both projections come from Codex-owned request metadata on the installed
// MCP connection. Tool arguments never select the conversation.
export function codexFormThreadId(meta) {
  const direct = meta?.threadId;
  let turn = meta?.["x-codex-turn-metadata"];
  if (typeof turn === "string") {
    try { turn = JSON.parse(turn); } catch { return null; }
  }
  const embedded = turn?.thread_id;
  if (direct !== undefined && !isUuid(direct) || embedded !== undefined && !isUuid(embedded)
    || direct && embedded && direct !== embedded) return null;
  return direct ?? embedded ?? null;
}

export function codexFormEvidence(threadId, requestId, question, claim) {
  if (!isUuid(threadId) || !isUuid(requestId)) throw Error("CODEX_FORM_CONTEXT_INVALID");
  const { evidence_refs, ...answer } = claim;
  return { ref: "codex:form/" + threadId + "/request/" + requestId,
    sha256: shadowHash({ thread_id: threadId, request_id: requestId,
      operation_id: question.operation_id, question_sha256: shadowHash(question), answer }) };
}

export function hasCodexFormEvidence(threadId, question, claim) {
  const refs = claim.evidence_refs;
  if (!Array.isArray(refs) || refs.length !== 1 || typeof refs[0]?.ref !== "string") return false;
  const [record] = refs;
  const prefix = "codex:form/" + threadId + "/request/";
  const requestId = record.ref.slice(prefix.length);
  return record.ref.startsWith(prefix) && isUuid(requestId) && claim.question_sha256 === shadowHash(question)
    && record.sha256 === codexFormEvidence(threadId, requestId, question, claim).sha256;
}
