import assert from "node:assert/strict";
import fs from "node:fs";
import { projectStandardCanonicalCyclePlan } from "../../src/core/workflow/standard-canonical-plan-projection.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { renderStandardTaskProgress } from "../../src/core/workflow/standard-cycle-task-progress.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

export async function verifyStandardCanonicalPlanProjection(check, proposal) {
  const cyclePath = "cycles/C001-feature-projection";
  const create = (input = proposal, completed = []) => {
    const brief = fs.readFileSync(new URL("../../scaffold/docs_audit/cycles/TEMPLATE_brief.md", import.meta.url), "utf8").replace(/(## Objective\r?\n)- /, "$1- " + input.objective);
    const documents = renderStandardCyclePlan(input, cyclePath, { "brief.md": brief });
    const original = documents[cyclePath + "/plan.md"];
    documents[cyclePath + "/plan.md"] = renderStandardTaskProgress({ originalPlan: original, proposal: input, completedTaskIds: completed });
    const context = { session_id: input.session_id, cycle_id: input.cycle_id, cycle_path: cyclePath, cycle_type: input.cycle_type, original_objective: input.objective,
      documents: Object.entries(documents).map(([path, content]) => ({ ref: "audit:" + path, content, sha256: artifactContentHash(content) })) };
    return { observed: { context, context_sha256: shadowHash(context) }, original };
  };
  const change = (observed, name, transform) => {
    const row = observed.context.documents.find(row => row.ref.endsWith("/" + name + ".md"));
    row.content = transform(row.content); row.sha256 = artifactContentHash(row.content); observed.context_sha256 = shadowHash(observed.context);
  };
  const test = (name, callback) => check("cycle plan contract: canonical projection " + name, callback);
  await test("roundtrips the actual renderer without changing any input or granting permission", () => {
    const { observed, original } = create(), before = shadowHash(observed), result = projectStandardCanonicalCyclePlan(observed);
    assert.deepEqual(result.proposal, { ...proposal, context_sha256: observed.context_sha256, evidence_refs: result.source_refs });
    assert.deepEqual(result.completed_task_ids, []); assert.equal(result.original_plan, original); assert.equal(shadowHash(observed), before);
    assert.deepEqual(Object.keys(result).sort(), ["completed_task_ids", "original_plan", "proposal", "source_refs"]);
  });
  await test("preserves the existing ordered progress projection as data", () => {
    const input = structuredClone(proposal); input.tasks.push({ ...structuredClone(input.tasks[0]), id: "TASK-002", task: "Inspect the retained product interface" });
    const { observed, original } = create(input, ["TASK-001"]), result = projectStandardCanonicalCyclePlan(observed);
    assert.deepEqual(result.completed_task_ids, ["TASK-001"]); assert.equal(result.original_plan, original); assert.deepEqual(result.proposal.tasks, input.tasks);
  });
  await test("retains adaptive impact and colon text through exact source roundtrip", () => {
    const input = structuredClone(proposal); input.cycle_type = "migration"; input.surface = "high-risk"; input.impact_notes = ["Storage: preserve the admitted interface"];
    input.rollback_strategy = "Restore: use the recorded preimage"; input.compatibility_strategy = "Keep: the historical reader";
    input.usage_matrix.push({ ...input.usage_matrix[0], kind: "alternate" }, { ...input.usage_matrix[0], kind: "context" });
    const { observed } = create(input), result = projectStandardCanonicalCyclePlan(observed);
    assert.deepEqual(result.proposal, { ...input, context_sha256: observed.context_sha256, evidence_refs: result.source_refs });
  });
  await test("retains an explicit SPIKE with no invented requirement", () => {
    const input = structuredClone(proposal); input.cycle_type = "spike"; input.requirements = []; input.tasks[0].requirement_refs = []; input.tests[0].requirement_refs = [];
    input.spike = { learning_goal: "Observe a bounded behavior", timebox: "One hour", decision_target: "Retain or discard the result" };
    const { observed } = create(input), result = projectStandardCanonicalCyclePlan(observed);
    assert.deepEqual(result.proposal.spike, input.spike); assert.deepEqual(result.proposal.requirements, []);
  });
  await test("refuses stale context and content hashes", () => {
    const { observed } = create(); observed.context_sha256 = "f".repeat(64); assert.throws(() => projectStandardCanonicalCyclePlan(observed));
    const second = create().observed; second.context.documents[0].sha256 = "f".repeat(64); second.context_sha256 = shadowHash(second.context);
    assert.throws(() => projectStandardCanonicalCyclePlan(second));
  });
  await test("refuses omitted or competing canonical documents", () => {
    for (const mutate of [rows => rows.pop(), rows => rows.push(rows[0])]) {
      const { observed } = create(); mutate(observed.context.documents); observed.context_sha256 = shadowHash(observed.context);
      assert.throws(() => projectStandardCanonicalCyclePlan(observed));
    }
  });
  await test("refuses unknown permission fields and a malformed permission row", () => {
    for (const transform of [text => text.replace('"version":1,', '"version":1,"authorized":true,'), text => text.replace(/"tasks":\[.*\]\}/, '"tasks":[null]}')]) {
      const { observed } = create(); change(observed, "plan", transform); assert.throws(() => projectStandardCanonicalCyclePlan(observed));
    }
  });
  await test("refuses missing sections, duplicate sections and unrepresented planning text", () => {
    for (const [name, transform] of [["brief", text => text.replace("## Constraints", "## Unmapped constraints")], ["brief", text => text + "\n## Scope\n- Conflicting scope\n"], ["plan", text => text + "\n## Extra executable instruction\n- Change another file\n"]]) {
      const { observed } = create(); change(observed, name, transform); assert.throws(() => projectStandardCanonicalCyclePlan(observed));
    }
  });
  await test("refuses changed objective and broken task traceability", () => {
    const { observed } = create(); observed.context.original_objective += " with a different scope"; observed.context_sha256 = shadowHash(observed.context);
    assert.throws(() => projectStandardCanonicalCyclePlan(observed));
    const second = create().observed; change(second, "traceability", text => text.replace("- TASK-001: REQ-001", "- TASK-001: REQ-999"));
    assert.throws(() => projectStandardCanonicalCyclePlan(second));
  });
  await test("refuses a contradictory completed-work marker or footer", () => {
    const { observed } = create(proposal, ["TASK-001"]); change(observed, "plan", text => text.replace("1. [x]", "1. [ ]"));
    assert.throws(() => projectStandardCanonicalCyclePlan(observed));
    const second = create(proposal, ["TASK-001"]).observed; change(second, "plan", text => text.replace('["TASK-001"]', '[]'));
    assert.throws(() => projectStandardCanonicalCyclePlan(second));
  });
}
