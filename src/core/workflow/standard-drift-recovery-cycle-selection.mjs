import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import subjectSchema from "../contracts/workflow-definition/standard-drift-recovery-cycle-subject.v1.schema.json" with { type: "json" };
import legacyQuestionSchema from "../contracts/workflow-definition/standard-drift-recovery-cycle-question.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-drift-recovery-cycle-question.v2.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-drift-recovery-cycle-decision.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-drift-recovery-cycle-selection-output.v1.schema.json" with { type: "json" };

export const recoveryCycleSelection = "drift_recovery_cycle_decision";
export const recoveryCycleQuestionVersion = "standard-drift-recovery-cycle-question.v2";
const legacyQuestionVersion = "standard-drift-recovery-cycle-question.v1";
const choices = ["select_cycle", "refused", "deferred", "cancelled"];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;

export function assertRecoveryCycleSubject(value) {
  if (!valid(value, subjectSchema)) fail("STANDARD_RECOVERY_CYCLE_SUBJECT_INVALID");
  return value;
}

export function recoveryCycleQuestion(record) {
  const prepared = record.preview.prepared, legacy = Object.hasOwn(prepared, "expires_at_ms");
  // Historical question bytes are reconstructed from their original retained
  // preparation. New questions impose no host-invented wall-clock expiry.
  const value = { contract_version: legacy ? legacyQuestionVersion : recoveryCycleQuestionVersion, operation_id: record.operation_id, intent_sha256: shadowHash(record.intent),
    subject: structuredClone(prepared.subject), ...(legacy ? { expires_at_ms: prepared.expires_at_ms } : {}), choices: [...choices] };
  if (!valid(value, legacy ? legacyQuestionSchema : questionSchema)) fail("STANDARD_RECOVERY_CYCLE_QUESTION_INVALID");
  return value;
}

export function assertHumanRecoveryCycleSelection(value, question) {
  if (!valid(value, sourceSchema) || (value.choice === "select_cycle") !== (value.selected_cycle !== null)
    || new Set(value.evidence_refs.map(row => row.ref)).size !== value.evidence_refs.length) fail("STANDARD_RECOVERY_CYCLE_SELECTION_INVALID");
  if (question && (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.subject)
    || value.selected_cycle && Number(value.selected_cycle.cycle_id.slice(1)) < question.subject.minimum_cycle_number))
    fail("STANDARD_RECOVERY_CYCLE_SELECTION_CHANGED");
  return value;
}

export function assertRecoveryCycleSelectionOutput(value) {
  if (!valid(value, outputSchema)) fail("STANDARD_RECOVERY_CYCLE_SELECTION_OUTPUT_INVALID");
  const { choice, selected_cycle } = value.observations;
  const outcome = choice === "select_cycle" ? "completed" : choice === "refused" ? "rejected" : choice;
  if (outcome !== value.outcome || (outcome === "completed") !== (selected_cycle !== null)) fail("STANDARD_RECOVERY_CYCLE_SELECTION_OUTPUT_INVALID");
  return value;
}

export function recoveryCycleSelectionOutput(question, capture) {
  const source = assertHumanRecoveryCycleSelection(capture.source, question);
  const outcome = source.choice === "select_cycle" ? "completed" : source.choice === "refused" ? "rejected" : source.choice;
  const sourceSha = shadowHash(source);
  return assertRecoveryCycleSelectionOutput({ contract_version: "standard-drift-recovery-cycle-selection-output.v1",
    operation_ref: recoveryCycleSelection, outcome, effect_status: "no_effect", facts: {},
    observations: { inbox_id: capture.inbox_id, source_ref: capture.source_ref, source_sha256: sourceSha,
      choice: source.choice, selected_cycle: structuredClone(source.selected_cycle) },
    evidence_refs: [{ ref: "aidn:decision-source/" + capture.inbox_id, sha256: sourceSha }, ...source.evidence_refs] });
}
