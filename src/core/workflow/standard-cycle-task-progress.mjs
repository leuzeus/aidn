import { assertStandardCyclePlan } from "./standard-cycle-planning.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const operationId = value => /^op_[a-f0-9]{40}$/.test(value ?? "");
const digest = value => /^[a-f0-9]{64}$/.test(value ?? "");
// The host authenticates every origin and accepted advance. The historical API
// starts at zero; an explicit resume API retains a canonical prefix as data.
export function deriveStandardCycleTaskCursor(options) { return deriveTaskCursor(options); }
export function deriveStandardCanonicalResumeTaskCursor({ canonicalResume, ...options }) {
  if (!canonicalResume || checkShadowJson(canonicalResume)
    || Object.keys(canonicalResume).sort().join(",") !== "completed_task_ids,source_operation_id,source_sha256"
    || !operationId(canonicalResume.source_operation_id) || !digest(canonicalResume.source_sha256)
    || !Array.isArray(canonicalResume.completed_task_ids)) fail("STANDARD_CANONICAL_RESUME_PROGRESS_INVALID");
  return deriveTaskCursor(options, canonicalResume);
}
function deriveTaskCursor({ proposal, implementationOperationId, phaseContextSha256, advances, contextSha256 }, canonicalResume = null) {
  assertStandardCyclePlan(proposal);
  const imported = canonicalResume?.completed_task_ids ?? [], count = imported.length + (Array.isArray(advances) ? advances.length : 0);
  if (shadowHash(imported) !== shadowHash(proposal.tasks.slice(0, imported.length).map(row => row.id))) fail("STANDARD_CANONICAL_RESUME_PROGRESS_INVALID");
  if (!operationId(implementationOperationId) || !digest(phaseContextSha256) || !digest(contextSha256) || checkShadowJson(advances)
    || !Array.isArray(advances) || count > proposal.tasks.length) fail("STANDARD_TASK_PROGRESS_INVALID");
  const scope = shadowHash(proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })));
  const operations = new Set(canonicalResume ? [canonicalResume.source_operation_id, implementationOperationId] : []), selections = new Set();
  let previous = null, expected = phaseContextSha256;
  for (const [index, row] of advances.entries()) {
    const ordinal = imported.length + index, output = row.output, observed = output?.observations;
    if (!operationId(row.operation_id) || operations.has(row.operation_id) || selections.has(observed?.task_operation_id)
      || output?.contract_version !== "standard-cycle-task-output.v1" || output.operation_ref !== "cycle_task_advance"
      || output.outcome !== "completed" || output.effect_status !== "confirmed" || output.facts?.cycle_task_advanced !== true
      || observed?.implementation_operation_id !== implementationOperationId || observed.scope_sha256 !== scope || observed.ordinal !== ordinal + 1
      || observed.selection_context_sha256 !== expected || observed.task_id !== proposal.tasks[ordinal].id || observed.previous_progress_operation_id !== previous
      || output.facts.cycle_tasks_finished !== (ordinal + 1 === proposal.tasks.length)
      || observed.next_task_id !== (proposal.tasks[ordinal + 1]?.id ?? null)
      || !operationId(observed.task_operation_id) || !operationId(observed.evaluation_operation_id)
      || shadowHash(observed.completed_task_ids) !== shadowHash(proposal.tasks.slice(0, ordinal + 1).map(task => task.id))
      || !digest(observed.causal_transition?.before_context_sha256) || !digest(observed.causal_transition?.after_context_sha256)) fail("STANDARD_TASK_PROGRESS_CHAIN_CHANGED");
    operations.add(row.operation_id); selections.add(observed.task_operation_id); previous = row.operation_id; expected = observed.causal_transition.after_context_sha256;
  }
  if (expected !== contextSha256) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
  return { implementation_operation_id: implementationOperationId, scope_sha256: scope, previous_progress_operation_id: previous,
    ordinal: count + 1, task: proposal.tasks[count] ?? null, completed_task_ids: proposal.tasks.slice(0, count).map(task => task.id),
    complete: count === proposal.tasks.length, context_sha256: contextSha256,
    ...(canonicalResume ? { canonical_resume_source: { operation_id: canonicalResume.source_operation_id, sha256: canonicalResume.source_sha256 }, imported_completed_task_ids: [...imported] } : {}) };
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
