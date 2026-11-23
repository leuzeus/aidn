import schemaV3 from "../contracts/workflow-definition/standard-workflow-entry-selection-output.v3.schema.json" with { type: "json" };
import { assertRetainedVerificationEntry } from "./standard-retained-verification.mjs";
import schema from "../contracts/workflow-definition/standard-workflow-entry-selection-output.v1.schema.json" with { type: "json" };
import schemaV2 from "../contracts/workflow-definition/standard-workflow-entry-selection-output.v2.schema.json" with { type: "json" };
import { assertRetainedValidationEntry } from "./standard-retained-validation.mjs";
import admissionSchema from "../contracts/workflow-definition/standard-cycle-entry-output.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
export const workflowEntrySelectOperation = "workflow_entry_select";
export function standardEntryPoint(parameters = {}) {
  const value = Object.hasOwn(parameters, "entry_point") ? parameters.entry_point : "session";
  if (value === "session") return value;
  if (["retained_validation", "retained_verification"].includes(value?.kind)) {
    (value.kind === "retained_verification" ? assertRetainedVerificationEntry : assertRetainedValidationEntry)(value);
    if (!/^S[0-9]{3,6}$/.test(parameters.session?.session_id ?? "")) fail("STANDARD_ENTRY_SESSION_REQUIRED");
    return value.kind;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "checkpoint_operation_id,kind"
    || value.kind !== "owned_cycle" || !/^op_[a-f0-9]{40}$/.test(value.checkpoint_operation_id ?? "")) fail("STANDARD_ENTRY_POINT_INVALID");
  if (!/^S[0-9]{3,6}$/.test(parameters.session?.session_id ?? "")) fail("STANDARD_ENTRY_SESSION_REQUIRED");
  return value.kind;
}
export function assertStandardEntrySelection(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, value?.contract_version === "standard-workflow-entry-selection-output.v3" ? schemaV3 : value?.contract_version === "standard-workflow-entry-selection-output.v2" ? schemaV2 : schema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_ENTRY_SELECTION_INVALID");
  if (value.outcome !== "completed") return value;
  const owned = ["owned_cycle", "retained_validation", "retained_verification"].includes(value.observations.entry_point), entry = value.observations.admission;
  if (owned !== value.facts.owned_cycle_continuation_requested || owned !== (entry !== null)
    || owned && (entry.outcome !== "completed" || entry.effect_status !== "no_effect"
      || entry.facts.cycle_entry_resume_allowed !== true || entry.facts.cycle_entry_creation_allowed !== false
      || entry.facts.cycle_entry_choice_required !== false || entry.observations.action !== "resume_cycle"
      || entry.observations.reason_code !== null || entry.observations.implementation_authorized !== false
      || !entry.observations.selected_cycle)
    || owned && !value.observations.continuation
    || shadowHash(value.evidence_refs) !== shadowHash(entry?.evidence_refs ?? [])) fail("STANDARD_ENTRY_SELECTION_INVALID");
  return value;
}
export function selectStandardEntry(parameters, admission = null, continuation = null) {
  const point = standardEntryPoint(parameters), owned = point !== "session";
  if (owned) {
    if (checkShadowJson(admission) || validateJsonSchema(admission, admissionSchema, "$", { contractKind: "workflow-definition" }).length)
      fail("STANDARD_ENTRY_SELECTION_INVALID");
    if (admission.outcome !== "completed" || admission.facts.cycle_entry_resume_allowed !== true) {
      const reason = admission.observations.reason_code;
      return assertStandardEntrySelection({ contract_version: "standard-workflow-entry-selection-output.v3", operation_ref: workflowEntrySelectOperation,
        outcome: "blocked", effect_status: "no_effect", facts: {}, observations: { reason_code: /^[A-Z][A-Z0-9_]{0,127}$/.test(reason ?? "") ? reason : "STANDARD_OWNED_CYCLE_REQUIRED" }, evidence_refs: [] });
    }
    if (!admission.observations.canonical.some(row => row.path === `sessions/${parameters.session.session_id}.md`)) fail("STANDARD_ENTRY_SESSION_CHANGED");
    if (!continuation || (point === "owned_cycle" ? continuation.checkpoint_operation_id !== parameters.entry_point.checkpoint_operation_id
      : point === "retained_verification" ? continuation.audit_operation_id !== parameters.entry_point.audit_operation_id : continuation.recovery_operation_id !== parameters.entry_point.recovery_operation_id)) fail("STANDARD_ENTRY_CONTINUATION_REQUIRED");
  }
  return assertStandardEntrySelection({ contract_version: "standard-workflow-entry-selection-output.v3",
    operation_ref: workflowEntrySelectOperation, outcome: "completed", effect_status: "no_effect",
    facts: owned ? { owned_cycle_continuation_requested: true, mode_committing: true, mode_thinking: false,
      mode_exploring: false, cycle_work_requested: true, retained_validation_requested: point === "retained_validation", retained_verification_requested: point === "retained_verification" } : { owned_cycle_continuation_requested: false, retained_validation_requested: false, retained_verification_requested: false },
    observations: { entry_point: point, admission, ...(owned ? { continuation } : {}) }, evidence_refs: admission?.evidence_refs ?? [] });
}
