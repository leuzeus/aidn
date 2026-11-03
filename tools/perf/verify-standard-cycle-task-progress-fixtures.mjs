#!/usr/bin/env node
import assert from "node:assert/strict";
import { deriveStandardCycleTaskCursor, renderStandardTaskProgress } from "../../src/core/workflow/standard-cycle-task-progress.mjs";
import { deriveFirstPlanStep } from "../../src/application/runtime/pre-write-admit-use-case.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { observeStandardCycleTaskWork, observeStandardCycleWork, assertStandardCycleTaskWorkReport } from "../../src/core/workflow/standard-cycle-work.mjs";
import { assertNativeActivityAnswer, nativeActivityOutputInstructions } from "../../src/core/workflow/native-activity-output.mjs";
const H = char => char.repeat(64), op = char => "op_" + char.repeat(40);
const proposal = cyclePlanProposal({ context_sha256: H("a"), context: { session_id: "S001", cycle_id: "C001", cycle_type: "feature", mode: "COMMITTING", original_objective: "Complete two bounded tasks", allowed_product_files: ["product/app.mjs"] }, evidence_refs: [{ ref: "audit:SPEC.md", sha256: H("b") }] });
proposal.tasks.push({ ...structuredClone(proposal.tasks[0]), id: "TASK-002", task: "Complete the second bounded task" });
const scope = shadowHash(proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })));
const base = { proposal, implementationOperationId: op("a"), phaseContextSha256: H("c"), advances: [], contextSha256: H("c") };
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
const initial = deriveStandardCycleTaskCursor(base); assert.equal(initial.task.id, "TASK-001"); assert.equal(initial.complete, false); pass("empty signed progress selects the actual first frozen task");
const row = index => ({ operation_id: op(index ? "e" : "d"), output: { contract_version: "standard-cycle-task-output.v1", operation_ref: "cycle_task_advance", outcome: "completed", effect_status: "confirmed",
  facts: { cycle_task_advanced: true, cycle_tasks_finished: index === 1 }, observations: { implementation_operation_id: op("a"), scope_sha256: scope, ordinal: index + 1, task_id: proposal.tasks[index].id,
    next_task_id: proposal.tasks[index + 1]?.id ?? null, previous_progress_operation_id: index ? op("d") : null, task_operation_id: op(index ? "c" : "f"), evaluation_operation_id: op("b"), completed_task_ids: proposal.tasks.slice(0, index + 1).map(task => task.id),
    selection_context_sha256: H(index ? "e" : "c"), causal_transition: { before_context_sha256: H("d"), after_context_sha256: H(index ? "f" : "e") } } } });
const next = { ...base, advances: [row(0)], contextSha256: H("e") }; assert.equal(deriveStandardCycleTaskCursor(next).task.id, "TASK-002"); pass("ordered progress selects the second task without changing the frozen scope");
const complete = deriveStandardCycleTaskCursor({ ...base, advances: [row(0), row(1)], contextSha256: H("f") }); assert.equal(complete.complete, true); assert.equal(complete.task, null); pass("only the complete ordered chain ends the task cursor");
for (const mutate of [x => x.advances[0].output.observations.task_id = "TASK-002", x => x.advances[0].output.observations.previous_progress_operation_id = op("b"), x => x.advances[0].output.observations.scope_sha256 = H("f"), x => x.advances[0].output.facts.cycle_tasks_finished = true,
  x => x.advances[0].output.effect_status = "unknown", x => x.advances[0].output.observations.selection_context_sha256 = H("b"), x => x.contextSha256 = H("a")]) { const invalid = structuredClone(next); mutate(invalid); assert.throws(() => deriveStandardCycleTaskCursor(invalid)); } pass("foreign scope, skipped task, wrong predecessor, premature finish and stale context refuse");
const originalPlan = "# Plan\n\n## Tasks\n" + proposal.tasks.map((task, index) => `${index + 1}. ${task.task}`).join("\n") + "\n\n## Native write scope\n```json\n" + JSON.stringify({ version: 1, tasks: proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })) }) + "\n```\n";
assert.equal(renderStandardTaskProgress({ originalPlan, proposal, completedTaskIds: [] }), originalPlan);
const projected = renderStandardTaskProgress({ originalPlan, proposal, completedTaskIds: ["TASK-001"] }); assert.equal(deriveFirstPlanStep(projected), proposal.tasks[1].task);
assert.equal(projected.match(/## Native write scope\n```json\n([^\n]+)/)[1], originalPlan.match(/## Native write scope\n```json\n([^\n]+)/)[1]); pass("versioned progress projects the admitted next task while preserving scope bytes");
assert.equal(deriveFirstPlanStep("## Tasks\n1. [x] literal historical task\n"), "[x] literal historical task"); assert.equal(deriveFirstPlanStep(originalPlan), proposal.tasks[0].task);
assert.equal(deriveFirstPlanStep(renderStandardTaskProgress({ originalPlan, proposal, completedTaskIds: ["TASK-001", "TASK-002"] })), "unknown");
assert.throws(() => renderStandardTaskProgress({ originalPlan, proposal, completedTaskIds: ["TASK-002"] })); pass("historical task parsing is preserved; missing or unordered progress never authorizes a task");
const context = { contract_version: "standard-cycle-task-work-context.v1", task_operation_id: op("c"), implementation_operation_id: op("a"), scope_sha256: scope, task: { ...proposal.tasks[0], paths: [{ path: "app.mjs", operations: ["update"] }] },
  source_context: { cycle_state: "IMPLEMENTING", mode: "COMMITTING" }, product_prefix: "", product_snapshot: [{ path: "app.mjs", present: true, bytes: 1, sha256: H("a") }], boundary_sha256: H("b") };
const report = { contract_version: "standard-cycle-task-work-report.v1", context_sha256: shadowHash(context), task_id: "TASK-001", task: context.task.task, work_outcome: "changed", changes: [{ path: "app.mjs", operation: "update" }], notes: [] };
const args = { report, context, contextSha256: shadowHash(context), after: [{ path: "app.mjs", present: true, bytes: 1, sha256: H("c") }], boundarySha256: H("b"), producer: {}, evidenceRefs: [] };
assert.equal(observeStandardCycleTaskWork(args).observations.task_operation_id, op("c")); assert.throws(() => observeStandardCycleWork(args)); pass("task work binds its selected operation and preserves the historical report reader");
assertNativeActivityAnswer({ outcome: "completed", summary: "Observed selected task", report }, report.contract_version, report.context_sha256);
const missingTask = structuredClone(report); delete missingTask.task_id;
assert.throws(() => assertNativeActivityAnswer({ outcome: "completed", summary: "Missing task", report: missingTask }, report.contract_version, report.context_sha256));
assert.match(nativeActivityOutputInstructions(report.contract_version), /host-selected frozen task/); pass("native task answer requires its typed task identity before any activity can be accepted");
const unchanged = structuredClone(args); unchanged.after = unchanged.context.product_snapshot; unchanged.report.work_outcome = "unchanged"; unchanged.report.changes = []; unchanged.report.notes = ["The selected requirement is already implemented; validation remains separate"];
const observed = observeStandardCycleTaskWork(unchanged); assert.equal(observed.observations.work_outcome, "unchanged"); assert.equal(observed.facts.cycle_validation_required, true);
const wrongTask = structuredClone(args); wrongTask.report.task_id = "TASK-002"; assert.throws(() => observeStandardCycleTaskWork(wrongTask));
const implicit = structuredClone(unchanged.report); implicit.notes = []; assert.throws(() => assertStandardCycleTaskWorkReport(implicit)); pass("an explicit observed no-change remains subject to validation; foreign tasks and implicit success refuse");
console.log(JSON.stringify({ status: "PASS", checks, proof: "pure-progress-and-parser", application_ports: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
