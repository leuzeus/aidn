import path from "node:path";
import { renderStandardCyclePlan } from "../../core/workflow/standard-cycle-planning.mjs";
import { renderStandardTaskProgress } from "../../core/workflow/standard-cycle-task-progress.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { cycleTaskProgressBoundary } from "./standard-drift-recovery.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { assertStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import schema from "../../core/contracts/workflow-definition/standard-cycle-task-advance-plan.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function createStandardCycleTaskAdvance({ targetRoot, readEvaluation, observeContext, readCurrent, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const boundary = (context, cyclePath) => cycleTaskProgressBoundary({ root, context }, cyclePath);
  const paths = cyclePath => [`${cyclePath}/plan.md`, `${cyclePath}/status.md`, "CURRENT-STATE.md"];
  function field(text, key, value) {
    const regex = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
    if ([...text.matchAll(regex)].length !== 1) fail("STANDARD_TASK_PROGRESS_FIELD_INVALID");
    return text.replace(regex, (_match, prefix) => `${prefix}${key}: ${value}`);
  }
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" }).length
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(paths(plan.cycle_path))
      || plan.changes.some(row => artifactContentHash(row.after) !== row.after_sha256)) fail("STANDARD_TASK_PROGRESS_RECORD_INVALID");
    assertStandardOperationInput("cycle_task_advance", plan.input); return plan;
  }
  function projections(changes) {
    if (artifacts.describe().database && artifacts.describe().state_mode === "db-only") return [];
    return changes.map(row => agentRunPhysicalPath(path.join(root, "docs/audit", row.path)));
  }
  function postgresMaterial(names, { required = false } = {}) {
    const selected = artifacts.describe();
    if (selected.backend !== "postgres") return null;
    const rows = artifacts.readMany(names, { required: required ? names : [], includeMetadata: true });
    if (rows.some(row => row.source !== "postgres") || shadowHash(artifacts.describe()) !== shadowHash(selected))
      fail("STANDARD_CANONICAL_BACKEND_CONFLICT");
    return rows;
  }
  async function prepare(instance, input, preparedAt, acquired = false) {
    assertStandardOperationInput("cycle_task_advance", input);
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const verified = await readEvaluation(instance, input), context = verified.context, cyclePath = context.cycle_path;
    const source = verified.source, selected = source.task_selection, task = source.work.output.observations.task;
    if (!selected || source.progress_operation_id || selected.complete || selected.task?.id !== task.id || selected.ordinal !== selected.completed_task_ids.length + 1
      || selected.implementation_operation_id !== source.work.output.observations.implementation_operation_id || selected.scope_sha256 !== source.work.output.observations.scope_sha256
      || context.cycle_state !== "IMPLEMENTING" || context.mode !== "COMMITTING") fail("STANDARD_TASK_PROGRESS_SELECTION_REQUIRED");
    const passed = new Set(verified.output.observations.checks.filter(row => row.status === "passed").map(row => row.test_ref));
    if (!task.test_refs.length || task.test_refs.some(id => !passed.has(id))) return { can_apply: false, reason_code: "STANDARD_TASK_VALIDATION_REQUIRED" };
    const admission = await preWriteAdmit({ targetRoot: root, skill: "start-session" });
    if (admission.ok !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status)) return { can_apply: false, reason_code: "STANDARD_TASK_PROGRESS_ADMISSION_BLOCKED" };
    const names = paths(cyclePath), batch = postgresMaterial(names, { required: true });
    const rows = batch ?? names.map(name => artifacts.read(name, { required: true }));
    const completed = [...selected.completed_task_ids, task.id];
    const ordinal = selected.ordinal, nextTask = source.proposal.tasks[ordinal] ?? null, finished = nextTask === null;
    const at = new Date(preparedAt).toISOString(), next = nextTask?.task ?? "Run final verification and audit before explicit closure";
    const brief = context.documents.find(row => row.ref === "audit:" + cyclePath + "/brief.md");
    const originalPlan = renderStandardCyclePlan(source.proposal, cyclePath, { "brief.md": brief.content })[cyclePath + "/plan.md"];
    if (rows[0].content !== renderStandardTaskProgress({ originalPlan, proposal: source.proposal, completedTaskIds: selected.completed_task_ids })) fail("STANDARD_TASK_PROGRESS_PLAN_CHANGED");
    const advancedPlan = renderStandardTaskProgress({ originalPlan, proposal: source.proposal, completedTaskIds: completed });
    let status = field(rows[1].content, "next step", "\n  - " + next); status = field(field(status, "last updated", at), "updated_at", at);
    const current = field(field(rows[2].content, "first_plan_step", next), "updated_at", at);
    const contents = { [rows[0].path]: advancedPlan, [rows[1].path]: status, [rows[2].path]: current };
    const changes = rows.map(row => ({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: batch ? row.metadata_sha256 : artifacts.metadataHash(row.path), after: contents[row.path], after_sha256: artifactContentHash(contents[row.path]) }));
    projections(changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== changes[index].before_sha256) fail("STANDARD_TASK_PROGRESS_PROJECTION_STALE"); });
    const plan = assertPlan({ contract_version: "standard-cycle-task-advance-plan.v1", operation_ref: "cycle_task_advance", input, prepared_at_ms: preparedAt,
      evaluation_sha256: verified.evaluation_sha256, context_sha256: verified.context_sha256, scope_sha256: verified.output.observations.scope_sha256,
      boundary_sha256: boundary(context, cyclePath), cycle_path: cyclePath, changes,
      implementation_operation_id: selected.implementation_operation_id, task_operation_id: source.work.output.observations.task_operation_id,
      validation_operation_id: source.record.operation_id, work_operation_id: source.record.preview.input.work_operation_id, task_id: task.id,
      next_task_id: nextTask?.id ?? null, selection_context_sha256: selected.context_sha256, ordinal, previous_progress_operation_id: selected.previous_progress_operation_id, completed_task_ids: completed, finished });
    if ((await observeContext()).context_sha256 !== verified.context_sha256) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan); const age = now() - plan.prepared_at_ms;
        if (write !== true || !prepared.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || typeof assertAuthorized !== "function"
          || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_TASK_PROGRESS_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          await assertAuthorized();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000
            || (await observeContext()).context_sha256 !== plan.context_sha256) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
          const preimages = postgresMaterial(plan.changes.map(row => row.path));
          for (const [index, row] of plan.changes.entries()) {
            const current = preimages?.[index] ?? artifacts.read(row.path);
            if (current.sha256 !== row.before_sha256 || (preimages ? current.metadata_sha256 : artifacts.metadataHash(row.path)) !== row.before_metadata_sha256)
              fail("STANDARD_PREVIEW_CHANGED");
          }
          projections(plan.changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].before_sha256) fail("STANDARD_TASK_PROGRESS_PROJECTION_STALE"); });
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_TASK_PROGRESS_SOURCE_STALE");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], metadata = [];
        try {
          for (const change of plan.changes) { metadata.push(artifacts.compareAndSwapPreservingMetadata(change).metadata_sha256); committed.push(change.path); }
          const projection = artifacts.project(committed);
          const postimages = postgresMaterial(committed);
          for (const [index, change] of plan.changes.entries()) {
            const current = postimages?.[index] ?? artifacts.read(change.path);
            if (current.sha256 !== change.after_sha256 || (postimages ? current.metadata_sha256 : artifacts.metadataHash(change.path)) !== metadata[index])
              fail("STANDARD_TASK_PROGRESS_POSTCONDITION_FAILED");
          }
          for (const [index, file] of projections(plan.changes).entries()) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].after_sha256) fail("STANDARD_TASK_PROGRESS_PROJECTION_UNCONFIRMED");
          const after = await observeContext();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || boundary(after.context, plan.cycle_path) !== plan.boundary_sha256) fail("STANDARD_TASK_PROGRESS_POSTCONDITION_FAILED");
          return { contract_version: "standard-cycle-task-output.v1", operation_ref: "cycle_task_advance", outcome: "completed", effect_status: "confirmed",
            facts: { cycle_task_advanced: true, cycle_tasks_finished: plan.finished }, observations: { evaluation_operation_id: plan.input.evaluation_operation_id,
              implementation_operation_id: plan.implementation_operation_id, task_operation_id: plan.task_operation_id, validation_operation_id: plan.validation_operation_id,
              work_operation_id: plan.work_operation_id, task_id: plan.task_id, next_task_id: plan.next_task_id, ordinal: plan.ordinal,
              selection_context_sha256: plan.selection_context_sha256, previous_progress_operation_id: plan.previous_progress_operation_id, completed_task_ids: plan.completed_task_ids, scope_sha256: plan.scope_sha256,
              projection, committed, causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256, evaluation_sha256: plan.evaluation_sha256 } },
            evidence_refs: plan.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })) };
        } catch (cause) {
          return { contract_version: "standard-cycle-task-output.v1", operation_ref: "cycle_task_advance", outcome: "reconciliation_required", effect_status: "unknown", facts: {},
            observations: { committed, reason_code: cause.code ?? "STANDARD_TASK_PROGRESS_UNCONFIRMED" }, evidence_refs: [] };
        }
      });
    },
  });
}
