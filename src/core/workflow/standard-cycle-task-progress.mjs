import { assertStandardCyclePlan } from "./standard-cycle-planning.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const operationId = value => /^op_[a-f0-9]{40}$/.test(value ?? "");
const digest = value => /^[a-f0-9]{64}$/.test(value ?? "");
// The host authenticates each accepted advance, its selected task, observed
// work and validation. This reducer only checks their ordered frozen-plan chain.
export function deriveStandardCycleTaskCursor({ proposal, implementationOperationId, phaseContextSha256, advances, contextSha256 }) {
  assertStandardCyclePlan(proposal);
  if (!operationId(implementationOperationId) || !digest(phaseContextSha256) || !digest(contextSha256) || checkShadowJson(advances)
    || !Array.isArray(advances) || advances.length > proposal.tasks.length) fail("STANDARD_TASK_PROGRESS_INVALID");
  const scope = shadowHash(proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })));
  const operations = new Set(), selections = new Set();
  let previous = null, expected = phaseContextSha256;
  for (const [index, row] of advances.entries()) {
    const output = row.output, observed = output?.observations;
    if (!operationId(row.operation_id) || operations.has(row.operation_id) || selections.has(observed?.task_operation_id)
      || output?.contract_version !== "standard-cycle-task-output.v1" || output.operation_ref !== "cycle_task_advance"
      || output.outcome !== "completed" || output.effect_status !== "confirmed" || output.facts?.cycle_task_advanced !== true
      || observed?.implementation_operation_id !== implementationOperationId || observed.scope_sha256 !== scope || observed.ordinal !== index + 1
      || observed.selection_context_sha256 !== expected || observed.task_id !== proposal.tasks[index].id || observed.previous_progress_operation_id !== previous
      || output.facts.cycle_tasks_finished !== (index + 1 === proposal.tasks.length)
      || observed.next_task_id !== (proposal.tasks[index + 1]?.id ?? null)
      || !operationId(observed.task_operation_id) || !operationId(observed.evaluation_operation_id)
      || shadowHash(observed.completed_task_ids) !== shadowHash(proposal.tasks.slice(0, index + 1).map(task => task.id))
      || !digest(observed.causal_transition?.before_context_sha256) || !digest(observed.causal_transition?.after_context_sha256)) fail("STANDARD_TASK_PROGRESS_CHAIN_CHANGED");
    operations.add(row.operation_id); selections.add(observed.task_operation_id); previous = row.operation_id; expected = observed.causal_transition.after_context_sha256;
  }
  if (expected !== contextSha256) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
  return { implementation_operation_id: implementationOperationId, scope_sha256: scope, previous_progress_operation_id: previous,
    ordinal: advances.length + 1, task: proposal.tasks[advances.length] ?? null, completed_task_ids: proposal.tasks.slice(0, advances.length).map(task => task.id),
    complete: advances.length === proposal.tasks.length, context_sha256: contextSha256 };
}
// A progress write changes only checked markers in the original ordered task
// list. The scope JSON and every other byte remain part of the frozen plan.
export function renderStandardTaskProgress({ originalPlan, proposal, completedTaskIds }) {
  assertStandardCyclePlan(proposal);
  if (!Array.isArray(completedTaskIds) || shadowHash(completedTaskIds) !== shadowHash(proposal.tasks.slice(0, completedTaskIds.length).map(task => task.id))) fail("STANDARD_TASK_PROGRESS_ORDER_INVALID");
  const marker = "## Tasks\n", start = originalPlan.indexOf(marker), end = originalPlan.indexOf("\n## ", start + marker.length);
  if (start < 0 || originalPlan.indexOf(marker, start + marker.length) !== -1 || end < 0) fail("STANDARD_TASK_PROGRESS_PLAN_INVALID");
  const initial = proposal.tasks.map((task, index) => `${index + 1}. ${task.task}`).join("\n");
  if (originalPlan.slice(start + marker.length, end).trim() !== initial) fail("STANDARD_TASK_PROGRESS_PLAN_INVALID");
  if (!completedTaskIds.length) return originalPlan;
  const tasks = proposal.tasks.map((task, index) => `${index + 1}. [${index < completedTaskIds.length ? "x" : " "}] ${task.task}`).join("\n");
  if (/^## Process task progress\r?$/m.test(originalPlan)) fail("STANDARD_TASK_PROGRESS_PLAN_INVALID");
  return (originalPlan.slice(0, start + marker.length) + tasks + "\n" + originalPlan.slice(end)).trimEnd()
    + "\n\n## Process task progress\ncontract_version: standard-cycle-task-progress.v1\ncompleted_task_ids: " + JSON.stringify(completedTaskIds) + "\n";
}
