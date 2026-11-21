import assert from "node:assert/strict";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { taskProgressProposal } from "./cycle-task-progress-fixture-lib.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { projectStandardCanonicalCycleProgress } from "../../src/core/workflow/standard-canonical-plan-projection.mjs";
import { renderStandardTaskProgress } from "../../src/core/workflow/standard-cycle-task-progress.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Staged canonical DATA only; current phase, work and validation require host evidence.
export async function arrangeCanonicalResumeData(f, { completedTaskIds = null } = {}) {
  const { artifacts, replace, selectedCycleId } = f,
    cyclePath = "cycles/" + selectedCycleId + "-feature-choice",
    objective = f.cycleObjective ?? "Record explicit carryover without activating a branch or granting implementation",
    proposal = taskProgressProposal(cyclePlanProposal({ context_sha256: "a".repeat(64), context: {
      session_id: selectedCycleId === "C002" ? "S002" : "S001", cycle_id: selectedCycleId, cycle_type: "feature", mode: "COMMITTING",
      original_objective: objective, allowed_product_files: ["product/app.mjs"] },
      evidence_refs: [{ ref: "audit:SPEC.md", sha256: artifacts.read("SPEC.md", { required: true }).sha256 }] })),
    rendered = renderStandardCyclePlan(proposal, cyclePath, { "brief.md": artifacts.read(cyclePath + "/brief.md", { required: true }).content });
  // Explicit construction of canonical completion DATA, not accepted Native work.
  rendered[cyclePath + "/plan.md"] = renderStandardTaskProgress({ originalPlan: rendered[cyclePath + "/plan.md"], proposal,
    completedTaskIds: completedTaskIds ?? proposal.tasks.map(row => row.id) });
  rendered[cyclePath + "/traceability.md"] = rendered[cyclePath + "/traceability.md"].trimEnd() + "\n\n## Process verification evidence\n\nNo lifecycle completion is inferred from these checks.\n\n"
    + String.fromCharCode(96).repeat(3) + "json\n" + JSON.stringify({ evaluation_operation_id: "op_" + "d".repeat(40),
      fixture_history: "STAGED_CANONICAL_DATA_NOT_CURRENT_VALIDATION" }) + "\n" + String.fromCharCode(96).repeat(3) + "\n";
  await replace(Object.entries(rendered));
  const dataContext = { contract_version: "generated-canonical-data-preflight.v1", generated_unsigned_fixture: true,
    session_id: proposal.session_id, cycle_id: proposal.cycle_id, cycle_type: "feature", cycle_path: cyclePath, cycle_state: f.selectedPhase ?? "VERIFYING",
    mode: "COMMITTING", original_objective: objective, documents: ["brief", "plan", "audit-spec", "traceability"].map(name => {
      const row = artifacts.read(cyclePath + "/" + name + ".md", { required: true });
      return { ref: "audit:" + row.path, content: row.content, sha256: row.sha256 }; }) };
  const preflight = projectStandardCanonicalCycleProgress({ context: dataContext, context_sha256: shadowHash(dataContext) });
  assert.deepEqual(preflight.completed_task_ids, completedTaskIds ?? proposal.tasks.map(row => row.id));
  assert.equal(preflight.current_phase_admission, false); assert.equal(preflight.current_validation_evidence, false);
  return proposal;
}
