import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertStandardCycleEntryChoiceRecordPlan, assertStandardCycleEntryChoiceRecordOutput } from "./standard-cycle-entry-choice-record.mjs";
import planSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-checkpoint-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-checkpoint-output.v1.schema.json" with { type: "json" };

import planSchemaV2 from "../contracts/workflow-definition/standard-cycle-entry-choice-checkpoint-plan.v2.schema.json" with { type: "json" };
import outputSchemaV2 from "../contracts/workflow-definition/standard-cycle-entry-choice-checkpoint-output.v2.schema.json" with { type: "json" };

export const cycleEntryChoiceCheckpointOperation = "cycle_entry_choice_checkpoint";
const fail = code => { throw Object.assign(Error(code), { code }); };
const unique = rows => new Set(rows).size === rows.length;

// The caller authenticates the accepted writer. This helper only derives its
// exact canonical postimages; it supplies no permission or Git authority.
export function cycleChoiceCheckpointDocuments(plan, output, runtimeDocument = null) {
  assertStandardCycleEntryChoiceRecordPlan(plan); assertStandardCycleEntryChoiceRecordOutput(output);
  if (output.outcome !== "completed" || output.effect_status !== "confirmed"
    || output.observations.decision_operation_id !== plan.input.decision_operation_id
    || output.observations.decision_source_sha256 !== plan.decision_source_sha256
    || output.observations.selected_cycle_id !== plan.selected_cycle_id
    || output.observations.selected_cycle_path !== plan.selected_cycle_path
    || output.observations.selected_state !== plan.selected_state
    || output.observations.selected_branch !== plan.selected_branch
    || output.observations.selected_branch_head !== plan.selected_branch_head
    || output.observations.selected_status_sha256 !== plan.selected_status_sha256
    || output.observations.committed.length !== plan.changes.length
    || output.observations.committed.some(row => !plan.changes.some(change => change.path === row.path && change.after_sha256 === row.sha256)))
    fail("STANDARD_CHOICE_CHECKPOINT_RECORDED_SOURCE_REQUIRED");
  const documents = plan.documents.map(row => ({ ...(output.observations.committed.find(after => after.path === row.path) ?? row) }));
  if (runtimeDocument !== null) {
    if (checkShadowJson(runtimeDocument) || Object.keys(runtimeDocument).sort().join(",") !== "metadata_sha256,path,sha256"
      || runtimeDocument.path !== "RUNTIME-STATE.md" || !/^[a-f0-9]{64}$/.test(runtimeDocument.sha256 ?? "")
      || runtimeDocument.metadata_sha256 !== null && !/^[a-f0-9]{64}$/.test(runtimeDocument.metadata_sha256 ?? "")
      || documents.some(row => row.path === runtimeDocument.path)) fail("STANDARD_CHOICE_CHECKPOINT_CONTEXT_REQUIRED");
    documents.push({ ...runtimeDocument });
  }
  return documents;
}

export function assertCycleChoiceCheckpointPlan(plan) {
  if (checkShadowJson(plan) || validateJsonSchema(plan, plan?.contract_version === "standard-cycle-entry-choice-checkpoint-plan.v2" ? planSchemaV2 : planSchema, "$", { contractKind: "workflow-definition" }).length
    || plan.contract_version === "standard-cycle-entry-choice-checkpoint-plan.v2"
      && (plan.context.operation_id === plan.operation_id || plan.context.operation_id === plan.input.record_operation_id
        || !plan.documents.some(row => shadowHash(row) === shadowHash(plan.context.runtime_document)))
    || !Number.isSafeInteger(plan.prepared_at_ms) || Buffer.byteLength(JSON.stringify(plan)) > 1048576
    || !unique(plan.documents.map(row => row.path)) || !unique(plan.git.files.map(row => row.path))
    || plan.git.files.some(row => !plan.documents.some(doc => "docs/audit/" + doc.path === row.path && doc.sha256 === row.sha256))
    || shadowHash(plan.git.files.map(row => row.path).sort()) !== shadowHash(plan.git.observed.changes.map(row => row.path).sort())
    || !plan.git.observed.index_clean || plan.git.observed.lock_present)
    fail("STANDARD_CHOICE_CHECKPOINT_PLAN_INVALID");
  return plan;
}

export function assertCycleChoiceCheckpointOutput(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, value?.contract_version === "standard-cycle-entry-choice-checkpoint-output.v2" ? outputSchemaV2 : outputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_CHOICE_CHECKPOINT_OUTPUT_INVALID");
  if (value.outcome === "completed") {
    const created = value.observations.git.status === "confirmed";
    if (value.effect_status !== (created ? "confirmed" : "no_effect")
      || value.facts.cycle_entry_choice_checkpoint_created !== created
      || !unique(value.observations.committed_paths)
      || created !== (value.observations.committed_paths.length > 0)) fail("STANDARD_CHOICE_CHECKPOINT_OUTPUT_INVALID");
  }
  return value;
}
