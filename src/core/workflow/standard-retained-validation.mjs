import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { shadowHash as H, checkShadowJson } from "./shadow-json.mjs";
import { assertStandardCyclePlan } from "./standard-cycle-planning.mjs";
import { assertWorkProductSnapshot } from "./standard-cycle-work.mjs";
import entry from "../contracts/workflow-definition/standard-retained-validation-entry.v1.schema.json" with { type: "json" };
import proofSchema from "../contracts/workflow-definition/standard-retained-validation-proof.v1.schema.json" with { type: "json" };
import phase from "../contracts/workflow-definition/standard-retained-validation-admission-output.v1.schema.json" with { type: "json" };
import selectionV2 from "../contracts/workflow-definition/standard-work-phase-selection-output.v2.schema.json" with { type: "json" };
import selection from "../contracts/workflow-definition/standard-work-phase-selection-output.v1.schema.json" with { type: "json" };
import work from "../contracts/workflow-definition/standard-retained-task-work-output.v1.schema.json" with { type: "json" };
import input from "../contracts/workflow-definition/standard-retained-task-work-input.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_RETAINED_VALIDATION_CONTRACT_INVALID");
  return value;
};
export const retainedValidationAdmit = "cycle_retained_validation_admit", retainedTaskWork = "cycle_retained_task_work_observe", workPhaseSelect = "cycle_work_phase_select";
export const assertRetainedValidationEntry = value => valid(value, entry);
export function retainedValidationPins(proof) {
  const keys = ["original_instance_id", "original_instance_sha256", "recovery_operation_id", "recovery_sha256", "original_configuration_sha256",
    "work_operation_id", "work_journal_sha256", "work_output_sha256", "native_journal_sha256", "dispatch_sha256", "validation_journal_sha256"];
  return Object.fromEntries(keys.map(key => [key, proof[key]]));
}
export function assertRetainedValidationProof(value) {
  valid(value, proofSchema); assertStandardCyclePlan(value.proposal); assertWorkProductSnapshot(value.product_snapshot);
  const { output, context, proposal } = value;
  if (H(output) !== value.work_output_sha256 || H(value.product_snapshot) !== value.product_sha256
    || context.cycle_state !== "IMPLEMENTING" || context.mode !== "COMMITTING" || context.product_sha256 !== value.product_sha256
    || proposal.tasks.length !== 1 || proposal.session_id !== context.session_id || proposal.cycle_id !== context.cycle_id
    || output.outcome !== "completed" || output.effect_status !== "no_effect"
    || H(output.observations.task) !== H(proposal.tasks[0]) || output.facts.cycle_work_observed !== true
    || output.observations.after_product_sha256 !== value.product_sha256 || output.observations.producer.instance_id !== value.original_instance_id
    || H(value.validation_test_refs) !== H(proposal.tests.map(row => row.id)) || value.contributors.length === 0
    || output.observations.scope_sha256 !== H(proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths }))))
    fail("STANDARD_RETAINED_VALIDATION_PROOF_INVALID");
  return value;
}
export function assertRetainedValidationInput(operation, value) {
  if (operation === retainedTaskWork) return valid(value, input);
  if (checkShadowJson(value) || !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length)
    fail("STANDARD_RETAINED_VALIDATION_CONTRACT_INVALID");
  return value;
}
export function assertRetainedValidationOutput(value) {
  if (value?.operation_ref === retainedValidationAdmit) {
    valid(value, phase); assertRetainedValidationProof(value.observations.proof);
    if (value.observations.proof_sha256 !== H(value.observations.proof)) fail("STANDARD_RETAINED_VALIDATION_PROOF_INVALID");
  } else if (value?.operation_ref === workPhaseSelect) {
    valid(value, value.contract_version === "standard-work-phase-selection-output.v2" ? selectionV2 : selection);
    if (Object.values(value.facts).filter(Boolean).length !== 1) fail("STANDARD_RETAINED_VALIDATION_CONTRACT_INVALID");
  } else if (value?.operation_ref === retainedTaskWork) {
    valid(value, work); assertWorkProductSnapshot(value.observations.product_snapshot);
    if (H(value.observations.product_snapshot) !== value.observations.after_product_sha256
      || value.observations.producer.instance_id !== value.observations.source.original_instance_id)
      fail("STANDARD_RETAINED_VALIDATION_PROOF_INVALID");
  } else fail("STANDARD_RETAINED_VALIDATION_CONTRACT_INVALID");
  return value;
}
