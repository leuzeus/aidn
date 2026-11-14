import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import schema from "../contracts/workflow-definition/process-operation-journal.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { shadowHash } from "./shadow-json.mjs";
import { assertProcessOperationReceipt } from "./process-operation-contracts.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const operationJournalId = (instance, occurrenceId) => "op_" + shadowHash({ instance_sha256: instance.instance_sha256, occurrence_id: occurrenceId }).slice(0, 40);
export function operationJournalPath(id) {
  if (!/^op_[a-f0-9]{40}$/.test(id)) fail("PROCESS_JOURNAL_ID_INVALID");
  return `workflows/operation-records/${id}.json`;
}
export function operationOutputRef(id, index = 0) {
  operationJournalPath(id);
  if (!Number.isSafeInteger(index) || index < 0 || index >= 32) fail("PROCESS_JOURNAL_OUTPUT_REF_INVALID");
  return `aidn:operation-output/${id}/${index}`;
}
export function assertOperationJournal(value) {
  if (validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_JOURNAL_INVALID");
  if (value.operation_id !== value.intent.operation_id || value.phase === "staged" && (value.owner !== null || value.results.length)
    || value.phase !== "staged" && value.owner === null || (value.phase === "receipted") !== (value.results.length > 0)) fail("PROCESS_JOURNAL_PHASE_INVALID");
  if (value.decision_claim_sha256 !== undefined && (!["session_pr_post_merge_decision",
    "session_pr_external_merge_disposition"].includes(value.intent.binding_ref) || value.phase === "staged")) fail("PROCESS_JOURNAL_PHASE_INVALID");
  const receiptIds = new Set();
  for (const result of value.results) {
    assertProcessOperationReceipt(result.receipt, value.intent);
    if (receiptIds.has(result.receipt.receipt_id)) fail("PROCESS_JOURNAL_RECEIPT_REUSED");
    receiptIds.add(result.receipt.receipt_id);
    if (!result.output.facts || typeof result.output.facts !== "object") fail("PROCESS_JOURNAL_RESULT_INVALID");
    if (result.receipt.output_sha256 !== shadowHash(result.output) || result.receipt.outcome !== result.output.outcome
      || result.receipt.effect_status !== result.output.effect_status || shadowHash(result.receipt.facts) !== shadowHash(result.output.facts)) fail("PROCESS_JOURNAL_RESULT_INVALID");
  }
  return value;
}
// The key comes from a host capability, never process JSON or a product file.
// This authenticates the trusted host; it does not authenticate a human/provider.
export function createOperationJournalSigner(readKey) {
  if (typeof readKey !== "function") fail("PROCESS_JOURNAL_KEY_REQUIRED");
  const read = () => { const key = readKey(); if (!Buffer.isBuffer(key) || key.length !== 32) fail("PROCESS_JOURNAL_KEY_INVALID"); return key; };
  const keyId = createHash("sha256").update(read()).digest("hex");
  const key = () => { const value = read(); if (createHash("sha256").update(value).digest("hex") !== keyId) fail("PROCESS_JOURNAL_KEY_CHANGED"); return value; };
  const mac = body => createHmac("sha256", key()).update(shadowHash(body)).digest("hex");
  return Object.freeze({ keyId,
    seal(body) {
      const { authentication, key_id, ...payload } = structuredClone(body), owned = { ...payload, key_id: keyId };
      return { ...owned, authentication: mac(owned) };
    },
    verify(value) {
      if (!value || value.key_id !== keyId || !/^[a-f0-9]{64}$/.test(value.authentication ?? "")) fail("PROCESS_JOURNAL_NOT_AUTHENTICATED");
      const { authentication, ...body } = value;
      if (!timingSafeEqual(Buffer.from(authentication, "hex"), Buffer.from(mac(body), "hex"))) fail("PROCESS_JOURNAL_NOT_AUTHENTICATED");
      return value;
    },
  });
}
