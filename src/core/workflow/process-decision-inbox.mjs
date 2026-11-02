import schema from "../contracts/workflow-definition/process-decision-inbox.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-mode-decision.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-mode-question.v1.schema.json" with { type: "json" };
import recoverySource from "../contracts/workflow-definition/human-drift-recovery-decision.v1.schema.json" with { type: "json" };
import recoveryQuestion from "../contracts/workflow-definition/standard-drift-recovery-question.v1.schema.json" with { type: "json" };
import recoveryPlan from "../contracts/workflow-definition/standard-drift-recovery-plan.v1.schema.json" with { type: "json" };
import inboxV2 from "../contracts/workflow-definition/process-decision-inbox.v2.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
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
export function assertRecoveryPlan(value) {
  const jsonIssue = checkShadowJson(value);
  if (jsonIssue) throw Object.assign(new Error("PROCESS_RECOVERY_PLAN_INVALID"), { code: "PROCESS_RECOVERY_PLAN_INVALID", reason: "json", issue: jsonIssue });
  const issues = validateJsonSchema(value, recoveryPlan, "$", { contractKind: "workflow-definition" });
  if (issues.length) throw Object.assign(new Error("PROCESS_RECOVERY_PLAN_INVALID"), { code: "PROCESS_RECOVERY_PLAN_INVALID", reason: "schema", issues: issues.slice(0, 4) });
  if (Buffer.byteLength(JSON.stringify(value)) > 393216
    || new Set(value.options.map(row => row.choice)).size !== value.options.length
    || value.changes[0].path !== "parking-lot.md" || value.changes[1].path !== "CURRENT-STATE.md"
    || value.changes[0].edit_kind !== "append" || value.changes[1].edit_kind !== "replace"
    || value.changes.some(row => Buffer.byteLength(row.text_chunks.join("")) > 98304
      || row.edit_kind === "replace" && artifactContentHash(row.text_chunks.join("")) !== row.after_sha256)) fail("PROCESS_RECOVERY_PLAN_INVALID");
  return value;
}
export function assertRecoveryQuestion(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, recoveryQuestion, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_HUMAN_QUESTION_INVALID");
  assertRecoveryPlan(value.review);
  if (value.review.review_operation_id !== value.operation_id || value.review.session_id !== value.session_id
    || shadowHash(value.choices) !== shadowHash([...value.review.options.map(row => row.choice), "refused", "deferred", "cancelled"])) fail("PROCESS_HUMAN_QUESTION_INVALID");
  return value;
}
export function assertHumanRecoveryDecision(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, recoverySource, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_HUMAN_SOURCE_INVALID");
  return value;
}
export const decisionInboxId = source => "decision_" + shadowHash({ authority_id: source.authority_id, source_kind: source.source_kind, source_event_id: source.source_event_id }).slice(0, 40);
export function decisionInboxPath(id) {
  if (!/^decision_[a-f0-9]{40}$/.test(id)) fail("PROCESS_DECISION_INBOX_ID_INVALID");
  return `workflows/decision-inbox/${id}.json`;
}
export function assertDecisionInbox(value) {
  const definition = value?.contract_version === "process-decision-inbox.v2" ? inboxV2 : schema;
  if (checkShadowJson(value) || validateJsonSchema(value, definition, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_DECISION_INBOX_INVALID");
  if (value.contract_version === "process-decision-inbox.v2") assertHumanRecoveryDecision(value.source); else assertHumanModeDecision(value.source);
  if (value.inbox_id !== decisionInboxId(value.source) || (value.phase === "receipted") !== (value.receipt_sha256 !== null)) fail("PROCESS_DECISION_INBOX_BINDING_CHANGED");
  return value;
}
