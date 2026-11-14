import assert from "node:assert/strict";
import { registerFixtureModuleMocks } from "./fixture-module-mocks.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";

export async function verifyTaskAdvancePlanValidity(pass) {
  const key = "aidn-task-advance-validity-fixture";
  const target = new URL("../../src/application/runtime/standard-cycle-task-advance.mjs?plan-validity-fixture", import.meta.url).href;
  const mocked = {
    "../../../tools/runtime/pre-write-admit.mjs": "export const preWriteAdmit = async () => ({ok:true,admission_status:'admitted'});",
    "./standard-drift-recovery.mjs": "export const cycleTaskProgressBoundary = () => 'f'.repeat(64);",
    "./standard-workflow-artifacts.mjs": "export const createStandardWorkflowArtifacts = () => globalThis[Symbol.for(" + JSON.stringify(key) + ")];",
  };
  const hook = registerFixtureModuleMocks({ targets: [target], mocked });
  let createStandardCycleTaskAdvance;
  try { ({ createStandardCycleTaskAdvance } = await import(target)); }
  finally { await hook.deregister(); }
  const hash = char => char.repeat(64), operationId = char => "op_" + char.repeat(40);
  try {
    for (const invalidation of ["none", "authorization", "prefix", "context", "metadata", "content", "partial"]) {
      const cyclePath = "cycles/C001-feature-validity";
      const brief = "## Scope\n\n## Non-scope\n\n## Constraints\n\n## Risks\n";
      const context = { session_id: "S001", cycle_id: "C001", cycle_type: "feature", cycle_state: "IMPLEMENTING", mode: "COMMITTING",
        cycle_path: cyclePath, original_objective: "Verify task advancement validity", allowed_product_files: ["product/app.mjs"],
        documents: [{ ref: "audit:" + cyclePath + "/brief.md", content: brief }] };
      const contextSha = shadowHash(context);
      const proposal = cyclePlanProposal({ context, context_sha256: contextSha, evidence_refs: [{ ref: "audit:SPEC.md", sha256: hash("a") }] });
      const names = [cyclePath + "/plan.md", cyclePath + "/status.md", "CURRENT-STATE.md"];
      const content = [renderStandardCyclePlan(proposal, cyclePath, { "brief.md": brief })[names[0]],
        "# Status\nnext step: work\nlast updated: old\nupdated_at: old\n", "# Current\nfirst_plan_step: work\nupdated_at: old\n"];
      const rows = new Map(names.map((name, index) => [name, { path: name, content: content[index], metadata_sha256: hash("b") }]));
      const before = structuredClone([...rows]);
      let owner = false, granted = false, writes = 0, authorized = 0;
      const material = name => {
        const row = rows.get(name);
        return { ...row, sha256: artifactContentHash(row.content), source: "postgres" };
      };
      const describe = () => ({ database: true, backend: "postgres", state_mode: "db-only" });
      globalThis[Symbol.for(key)] = { root: "C:/controlled-task-validity", describe,
        ownerPending: () => owner, read: material, readMany: paths => paths.map(material),
        metadataHash: name => material(name).metadata_sha256,
        async withLocalEffectOwner(_plan, action) {
          assert.equal(owner, false); owner = true;
          try { return await action(); } finally { owner = false; }
        },
        compareAndSwapPreservingMetadata(change) {
          if (invalidation === "partial" && writes === 1) throw Object.assign(new Error("CAS_INTERRUPTED"), { code: "CAS_INTERRUPTED" });
          const current = material(change.path);
          assert.equal(current.sha256, change.before_sha256);
          assert.equal(current.metadata_sha256, change.before_metadata_sha256);
          rows.get(change.path).content = change.after;
          writes++;
          return { metadata_sha256: current.metadata_sha256 };
        }, project: () => ({ requested: false, written: false }) };
      const instance = { instance_id: "fixture", instance_sha256: hash("c") };
      const selected = { complete: false, task: proposal.tasks[0], ordinal: 1, completed_task_ids: [],
        implementation_operation_id: operationId("d"), scope_sha256: hash("e"), context_sha256: contextSha, previous_progress_operation_id: null };
      const verified = { context, context_sha256: contextSha, evaluation_sha256: hash("f"),
        output: { observations: { scope_sha256: selected.scope_sha256, checks: [{ test_ref: "TEST-001", status: "passed" }] } },
        source: { proposal, progress_operation_id: null, task_selection: selected,
          work: { output: { observations: { task: selected.task, implementation_operation_id: selected.implementation_operation_id,
            scope_sha256: selected.scope_sha256, task_operation_id: operationId("1") } } },
          record: { operation_id: operationId("2"), preview: { input: { work_operation_id: operationId("3") } } } } };
      const preparedAt = Date.parse("2026-11-11T00:00:00Z");
      let now = preparedAt;
      const operation = createStandardCycleTaskAdvance({ targetRoot: "C:/controlled-task-validity", now: () => now,
        readEvaluation: async () => structuredClone(verified),
        readCurrent: () => granted && invalidation === "prefix" ? { ...instance, instance_sha256: hash("9") } : instance,
        observeContext: async () => ({ context, context_sha256: granted && invalidation === "context" ? hash("8") : contextSha }) });
      const preview = await operation.prepare(instance, { evaluation_operation_id: operationId("4") });
      assert.equal(preview.can_apply, true);
      assert.deepEqual([...rows], before);
      now = preparedAt + 375948;
      const applying = operation.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256,
        assertAuthorized: async () => {
          authorized++; granted = true; now = preparedAt + 86400000;
          if (invalidation === "authorization") throw Object.assign(new Error("AUTHORIZATION_REVOKED"), { code: "AUTHORIZATION_REVOKED" });
          if (invalidation === "metadata") rows.get(names[0]).metadata_sha256 = hash("7");
          if (invalidation === "content") rows.get(names[0]).content += "\nChanged source\n";
        } });
      if (["none", "partial"].includes(invalidation)) {
        const result = await applying;
        assert.equal(result.outcome, invalidation === "none" ? "completed" : "reconciliation_required");
        assert.equal(result.effect_status, invalidation === "none" ? "confirmed" : "unknown");
        assert.equal(writes, invalidation === "none" ? 3 : 1);
        assert.equal(result.observations.committed.length, writes);
      } else {
        const code = invalidation === "authorization" ? "AUTHORIZATION_REVOKED"
          : ["metadata", "content"].includes(invalidation) ? "STANDARD_PREVIEW_CHANGED" : "STANDARD_TASK_PROGRESS_SOURCE_STALE";
        await assert.rejects(applying, { code, effect_status: "no_effect" });
        assert.equal(writes, 0);
      }
      assert.equal(authorized, 1);
      assert.equal(owner, false);
      pass("task advance elapsed plan with " + invalidation + " invalidation");
    }
  } finally { delete globalThis[Symbol.for(key)]; }
}
