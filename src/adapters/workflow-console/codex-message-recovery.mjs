import { createHash } from "node:crypto";

const uuid = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
const digest = "^[a-f0-9]{64}$";
const patterns = {
  operation_id: "^op_[a-f0-9]{40}$", question_sha256: digest,
  turn_id: uuid, message_id: uuid, content_sha256: digest,
};
const matches = (pattern, value) => typeof value === "string" && new RegExp(pattern, "u").test(value)
  && !/[\r\n]/u.test(value);

export const codexMessageSelectorSchema = {
  type: "object", additionalProperties: false, required: Object.keys(patterns),
  properties: Object.fromEntries(Object.entries(patterns).map(([name, pattern]) => [name, { type: "string", pattern }])),
};

export function bindOperatorChat(threadId, authorityId) {
  if (!matches(uuid, threadId) || !matches("^[a-z][a-z0-9_-]{0,63}$", authorityId)) throw Error("CODEX_CHAT_BINDING_INVALID");
  return Object.freeze({ thread_id: threadId, authority_id: authorityId });
}

export function codexMessageEvidence(chat, selector) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector) || Object.keys(selector).length !== Object.keys(patterns).length
    || Object.entries(patterns).some(([key, pattern]) => !Object.hasOwn(selector, key) || !matches(pattern, selector[key])))
    throw Error("CODEX_MESSAGE_SELECTOR_INVALID");
  return { ref: `codex:thread/${chat.thread_id}/turn/${selector.turn_id}/message/${selector.message_id}`, sha256: selector.content_sha256 };
}

export function assertCodexMessageEvidence(refs, expected) {
  const messages = refs?.filter(row => row.ref.startsWith("codex:thread/"));
  if (messages?.length !== 1 || messages[0].ref !== expected.ref || messages[0].sha256 !== expected.sha256)
    throw Error("CODEX_MESSAGE_EVIDENCE_CHANGED");
}

// Codex item anchors are exclusive. Read backwards from the successor, or
// from the end of the turn when the requested item has no successor.
// Only identifiers and the exact text digest cross into the workflow host.
export async function readCodexMessageReference(listItems, { threadId, turnId, messageId }) {
  if (![threadId, turnId, messageId].every(value => matches(uuid, value))) throw Error("CODEX_MESSAGE_SELECTOR_INVALID");
  const page = async (sortDirection, itemId) => {
    const params = { threadId, turnId, limit: 1, sortDirection };
    if (itemId) params.cursor = { type: "item", itemId };
    const result = await listItems(params);
    if (!Array.isArray(result?.data) || result.data.length > 1) throw Error("CODEX_MESSAGE_UNAVAILABLE");
    const row = result.data[0];
    if (row && (row.turnId !== turnId || typeof row.item?.id !== "string" || !row.item.id)) throw Error("CODEX_MESSAGE_UNAVAILABLE");
    return row?.item;
  };
  const successor = await page("asc", messageId);
  const item = await page("desc", successor?.id);
  if (item?.id !== messageId || item.type !== "userMessage" || !Array.isArray(item.content) || item.content.length !== 1
    || item.content[0]?.type !== "text" || typeof item.content[0].text !== "string") throw Error("CODEX_USER_TEXT_MESSAGE_REQUIRED");
  return { turn_id: turnId, message_id: messageId, content_sha256: createHash("sha256").update(item.content[0].text, "utf8").digest("hex") };
}
