import schema from "../contracts/workflow-definition/process-decision-inbox.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-mode-decision.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-mode-question.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function assertModeQuestion(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, questionSchema, "$", { contractKind: "workflow-definition" }).length
    || shadowHash(value.choices) !== shadowHash(["THINKING", "EXPLORING", "COMMITTING", "refused", "deferred", "cancelled"])) fail("PROCESS_HUMAN_QUESTION_INVALID");
  return value;
}
export function assertHumanModeDecision(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, sourceSchema, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_HUMAN_SOURCE_INVALID");
  return value;
}
export const decisionInboxId = source => "decision_" + shadowHash({ authority_id: source.authority_id, source_kind: source.source_kind, source_event_id: source.source_event_id }).slice(0, 40);
export function decisionInboxPath(id) {
  if (!/^decision_[a-f0-9]{40}$/.test(id)) fail("PROCESS_DECISION_INBOX_ID_INVALID");
  return `workflows/decision-inbox/${id}.json`;
}
export function assertDecisionInbox(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_DECISION_INBOX_INVALID");
  assertHumanModeDecision(value.source);
  if (value.inbox_id !== decisionInboxId(value.source) || (value.phase === "receipted") !== (value.receipt_sha256 !== null)) fail("PROCESS_DECISION_INBOX_BINDING_CHANGED");
  return value;
}
