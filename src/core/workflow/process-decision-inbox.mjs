import inboxV11 from "../contracts/workflow-definition/process-decision-inbox.v11.schema.json" with { type: "json" };
import { assertHumanSpikeDecision } from "./standard-spike-decision.mjs";
import inboxV8 from "../contracts/workflow-definition/process-decision-inbox.v8.schema.json" with { type: "json" };
import inboxV9 from "../contracts/workflow-definition/process-decision-inbox.v9.schema.json" with { type: "json" };
import inboxV10 from "../contracts/workflow-definition/process-decision-inbox.v10.schema.json" with { type: "json" };
import { assertHumanModeWorkDecision } from "./standard-mode-work-continuation.mjs";
import inboxV7 from "../contracts/workflow-definition/process-decision-inbox.v7.schema.json" with { type: "json" };
import { assertHumanPrCorrectionDecision } from "./standard-pr-correction-decision.mjs";
import inboxV5 from "../contracts/workflow-definition/process-decision-inbox.v5.schema.json" with { type: "json" };
import { assertHumanSessionClosureDecision } from "./standard-session-closure-decision.mjs";
import schema from "../contracts/workflow-definition/process-decision-inbox.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-mode-decision.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-mode-question.v1.schema.json" with { type: "json" };
import recoverySource from "../contracts/workflow-definition/human-drift-recovery-decision.v1.schema.json" with { type: "json" };
import recoveryQuestion from "../contracts/workflow-definition/standard-drift-recovery-question.v1.schema.json" with { type: "json" };
import recoveryPlan from "../contracts/workflow-definition/standard-drift-recovery-plan.v1.schema.json" with { type: "json" };
import recoveryQuestionV2 from "../contracts/workflow-definition/standard-drift-recovery-question.v2.schema.json" with { type: "json" };
import recoverySourceV2 from "../contracts/workflow-definition/human-drift-recovery-decision.v2.schema.json" with { type: "json" };
import inboxV12 from "../contracts/workflow-definition/process-decision-inbox.v12.schema.json" with { type: "json" };
import { assertHumanExternalMergeDisposition } from "./standard-pr-external-merge.mjs";
import inboxV16 from "../contracts/workflow-definition/process-decision-inbox.v16.schema.json" with { type: "json" };
import inboxV17 from "../contracts/workflow-definition/process-decision-inbox.v17.schema.json" with { type: "json" };
import { assertHumanRecoveryCycleSelection } from "./standard-drift-recovery-cycle-selection.mjs";
import inboxV15 from "../contracts/workflow-definition/process-decision-inbox.v15.schema.json" with { type: "json" };
import { assertHumanPostMergeDecision } from "./standard-pr-post-merge-decision.mjs";
import inboxV18 from "../contracts/workflow-definition/process-decision-inbox.v18.schema.json" with { type: "json" };
import inboxV14 from "../contracts/workflow-definition/process-decision-inbox.v14.schema.json" with { type: "json" };
import { assertHumanMergeConsent } from "./standard-pr-merge-consent.mjs";
import inboxV13 from "../contracts/workflow-definition/process-decision-inbox.v13.schema.json" with { type: "json" };
import { assertHumanResolutionException } from "./standard-pr-resolution-exception.mjs";
import { assertObjectiveReview } from "./standard-drift-objective-review.mjs";
import inboxV3 from "../contracts/workflow-definition/process-decision-inbox.v3.schema.json" with { type: "json" };
import { assertHumanCycleClosureDecision } from "./standard-cycle-closure-decision.mjs";
import inboxV2 from "../contracts/workflow-definition/process-decision-inbox.v2.schema.json" with { type: "json" };
import inboxV4 from "../contracts/workflow-definition/process-decision-inbox.v4.schema.json" with { type: "json" };
import { assertHumanBaselinePromotionDecision } from "./standard-baseline-promotion-decision.mjs";
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
  if (["standard-drift-recovery-plan.v2", "standard-drift-recovery-plan.v3"].includes(value?.contract_version)) return assertObjectiveReview(value);
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
  const objective = value?.contract_version === "standard-drift-recovery-question.v2";
  if (checkShadowJson(value) || validateJsonSchema(value, objective ? recoveryQuestionV2 : recoveryQuestion, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_HUMAN_QUESTION_INVALID");
  assertRecoveryPlan(value.review);
  if (objective !== (["standard-drift-recovery-plan.v2", "standard-drift-recovery-plan.v3"].includes(value.review.contract_version))
    || value.review.review_operation_id !== value.operation_id || value.review.session_id !== value.session_id
    || shadowHash(value.choices) !== shadowHash([...(objective ? value.review.choices : value.review.options.map(row => row.choice)), "refused", "deferred", "cancelled"])) fail("PROCESS_HUMAN_QUESTION_INVALID");
  return value;
}
export function assertHumanRecoveryDecision(value, question) {
  const objective = value?.contract_version === "human-drift-recovery-decision.v2";
  if (checkShadowJson(value) || validateJsonSchema(value, objective ? recoverySourceV2 : recoverySource, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_HUMAN_SOURCE_INVALID");
  if (objective && (!value.rationale.trim() || new Set(value.evidence_refs.map(row => row.ref)).size !== value.evidence_refs.length)) fail("PROCESS_HUMAN_SOURCE_INVALID");
  if (question && (objective !== (question.contract_version === "standard-drift-recovery-question.v2")
    || objective && (value.subject_sha256 !== shadowHash(question.review) || value.question_sha256 !== shadowHash(question)))) fail("PROCESS_HUMAN_QUESTION_CHANGED");
  if (objective && question && !question.choices.includes(value.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
  return value;
}
export const decisionInboxId = source => "decision_" + shadowHash({ authority_id: source.authority_id, source_kind: source.source_kind, source_event_id: source.source_event_id }).slice(0, 40);
export function decisionInboxPath(id) {
  if (!/^decision_[a-f0-9]{40}$/.test(id)) fail("PROCESS_DECISION_INBOX_ID_INVALID");
  return `workflows/decision-inbox/${id}.json`;
}
export function assertDecisionInbox(value) {
  if (value?.contract_version === "process-decision-inbox.v17") {
    if (checkShadowJson(value) || validateJsonSchema(value, inboxV17, "$", { contractKind: "workflow-definition" }).length)
      fail("PROCESS_DECISION_INBOX_INVALID");
    assertHumanRecoveryCycleSelection(value.source);
    if (value.inbox_id !== decisionInboxId(value.source) || (value.phase === "receipted") !== (value.receipt_sha256 !== null))
      fail("PROCESS_DECISION_INBOX_BINDING_CHANGED");
    return value;
  }
  if (["process-decision-inbox.v15", "process-decision-inbox.v16"].includes(value?.contract_version)) {
    const external = value.contract_version === "process-decision-inbox.v16";
    if (checkShadowJson(value) || validateJsonSchema(value, external ? inboxV16 : inboxV15, "$", { contractKind: "workflow-definition" }).length)
      fail("PROCESS_DECISION_INBOX_INVALID");
    if (external) assertHumanExternalMergeDisposition(value.source); else assertHumanPostMergeDecision(value.source);
    if (value.inbox_id !== decisionInboxId(value.source) || (value.phase === "receipted") !== (value.receipt_sha256 !== null))
      fail("PROCESS_DECISION_INBOX_BINDING_CHANGED");
    return value;
  }
  if (["process-decision-inbox.v13", "process-decision-inbox.v14", "process-decision-inbox.v18"].includes(value?.contract_version)) {
    const consent = value.contract_version !== "process-decision-inbox.v13";
    const definition = value.contract_version === "process-decision-inbox.v18" ? inboxV18 : consent ? inboxV14 : inboxV13;
    if (checkShadowJson(value) || validateJsonSchema(value, definition, "$", { contractKind: "workflow-definition" }).length)
      fail("PROCESS_DECISION_INBOX_INVALID");
    if (consent) assertHumanMergeConsent(value.source); else assertHumanResolutionException(value.source);
    if (value.inbox_id !== decisionInboxId(value.source) || (value.phase === "receipted") !== (value.receipt_sha256 !== null)) fail("PROCESS_DECISION_INBOX_BINDING_CHANGED");
    return value;
  }
  const definition = value?.contract_version === "process-decision-inbox.v12" ? inboxV12 : value?.contract_version === "process-decision-inbox.v11" ? inboxV11 : value?.contract_version === "process-decision-inbox.v10" ? inboxV10 : value?.contract_version === "process-decision-inbox.v9" ? inboxV9 : value?.contract_version === "process-decision-inbox.v8" ? inboxV8 : value?.contract_version === "process-decision-inbox.v7" ? inboxV7 : value?.contract_version === "process-decision-inbox.v6" ? inboxV6 : value?.contract_version === "process-decision-inbox.v5" ? inboxV5 : value?.contract_version === "process-decision-inbox.v4" ? inboxV4 : value?.contract_version === "process-decision-inbox.v3" ? inboxV3 : value?.contract_version === "process-decision-inbox.v2" ? inboxV2 : schema;
  if (checkShadowJson(value) || validateJsonSchema(value, definition, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_DECISION_INBOX_INVALID");
  if (value.contract_version === "process-decision-inbox.v12") {
    if (value.source.contract_version !== "human-drift-recovery-decision.v2") fail("PROCESS_DECISION_INBOX_INVALID");
    assertHumanRecoveryDecision(value.source);
  }
  else if (value.contract_version === "process-decision-inbox.v11") assertHumanSpikeDecision(value.source);
  else if (value.contract_version === "process-decision-inbox.v10") assertHumanModeWorkDecision(value.source);
  else if (["process-decision-inbox.v7", "process-decision-inbox.v8", "process-decision-inbox.v9"].includes(value.contract_version)) assertHumanPrCorrectionDecision(value.source);
  else if (value.contract_version === "process-decision-inbox.v6") assertHumanSessionBranchIntegrationDecision(value.source);
  else if (value.contract_version === "process-decision-inbox.v5") assertHumanSessionClosureDecision(value.source);
  else if (value.contract_version === "process-decision-inbox.v4") assertHumanBaselinePromotionDecision(value.source);
  else if (value.contract_version === "process-decision-inbox.v3") assertHumanCycleClosureDecision(value.source);
  else if (value.contract_version === "process-decision-inbox.v2") assertHumanRecoveryDecision(value.source); else assertHumanModeDecision(value.source);
  if (value.inbox_id !== decisionInboxId(value.source) || (value.phase === "receipted") !== (value.receipt_sha256 !== null)) fail("PROCESS_DECISION_INBOX_BINDING_CHANGED");
  return value;
}
import inboxV6 from "../contracts/workflow-definition/process-decision-inbox.v6.schema.json" with { type: "json" };
import { assertHumanSessionBranchIntegrationDecision } from "./standard-session-branch-integration-decision.mjs";
