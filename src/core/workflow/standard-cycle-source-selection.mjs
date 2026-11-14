import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";
import { assertStandardCyclePlan } from "./standard-cycle-planning.mjs";
import planSchema from "../contracts/workflow-definition/standard-cycle-plan-selection-output.v2.schema.json" with { type: "json" };
import executionSchema from "../contracts/workflow-definition/standard-cycle-execution-source-output.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_CYCLE_SOURCE_SELECTION_INVALID");
};
const unique = rows => new Set(rows).size === rows.length;
export const cycleExecutionSourceSelectOperation = "cycle_execution_source_select";

export function assertCyclePlanSourceSelection(value) {
  valid(value, planSchema);
  const source = value.observations, imported = source.imported_completed_task_ids, remaining = source.remaining_task_ids;
  if (imported.length + remaining.length !== source.task_count || !unique([...imported, ...remaining])
    || source.source_kind !== "canonical_progress" && (source.canonical_phase !== "OPEN" || imported.length)
    || value.facts.cycle_implementation_entry_required !== (source.canonical_phase === "OPEN" || remaining.length > 0))
    fail("STANDARD_CYCLE_SOURCE_SELECTION_INVALID");
  return value;
}

// Input is assembled only by the protected host from an accepted planning
// origin and fresh context. Selection grants no DoR, phase effect or work.
export function cyclePlanSourceSelection({ recordOperationId, recordSha256, proposal, sourceKind, phase,
  completedTaskIds, context, evidenceRefs }) {
  assertStandardCyclePlan(proposal);
  if (proposal.session_id !== context.session_id || proposal.cycle_id !== context.cycle_id || context.cycle_state !== phase
    || shadowHash(completedTaskIds) !== shadowHash(proposal.tasks.slice(0, completedTaskIds.length).map(row => row.id)))
    fail("STANDARD_CYCLE_SOURCE_SELECTION_INVALID");
  const remaining = proposal.tasks.slice(completedTaskIds.length).map(row => row.id);
  return assertCyclePlanSourceSelection({ contract_version: "standard-cycle-plan-selection-output.v2", operation_ref: "cycle_plan_select",
    outcome: "completed", effect_status: "no_effect", facts: { cycle_implementation_entry_required: phase === "OPEN" || remaining.length > 0 },
    observations: { record_operation_id: recordOperationId, record_sha256: recordSha256, session_id: context.session_id,
      cycle_id: context.cycle_id, cycle_path: context.cycle_path, source_kind: sourceKind, canonical_phase: phase,
      task_count: proposal.tasks.length, imported_completed_task_ids: [...completedTaskIds], remaining_task_ids: remaining,
      implementation_authorized: false }, evidence_refs: evidenceRefs });
}

export function assertCycleExecutionSourceSelection(value) {
  valid(value, executionSchema);
  const source = value.observations, complete = source.completed_task_ids, remaining = source.remaining_task_ids,
    imported = source.imported_completed_task_ids;
  if (complete.length + remaining.length !== source.task_count || !unique([...complete, ...remaining])
    || shadowHash(imported) !== shadowHash(complete.slice(0, imported.length))
    || value.facts.cycle_work_tasks_pending !== (remaining.length > 0)
    || value.facts.cycle_work_product_ready !== (remaining.length === 0)
    || source.implementation_source_kind === "canonical_progress"
      && (source.record_operation_id !== source.implementation_operation_id || remaining.length || imported.length !== source.task_count)
    || source.implementation_source_kind === "implementation_entry" && source.record_operation_id === source.implementation_operation_id)
    fail("STANDARD_CYCLE_SOURCE_SELECTION_INVALID");
  return value;
}
