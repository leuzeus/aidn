import assert from "node:assert/strict";
import { registerFixtureModuleMocks } from "./fixture-module-mocks.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";

export async function verifyCyclePreparedPlanValidity(check, proposalFactory) {
  const key = "aidn-cycle-plan-validity-fixture";
  const definitions = [
    { operation: "cycle_plan_record", file: "standard-cycle-plan-record.mjs", factory: "createStandardCyclePlanRecord", reason: "STANDARD_CYCLE_PLAN_SOURCE_STALE" },
    { operation: "cycle_verification_enter", file: "standard-cycle-verification.mjs", factory: "createStandardCycleVerification", reason: "STANDARD_CYCLE_VERIFICATION_SOURCE_STALE" },
  ];
  const targets = definitions.map(row => new URL("../../src/application/runtime/" + row.file + "?plan-validity-fixture", import.meta.url).href);
  const mocked = {
    "../../../tools/runtime/pre-write-admit.mjs": "export const preWriteAdmit = async () => ({ok:true,admission_status:'admitted'});",
    "./standard-drift-recovery.mjs": "export const cyclePlanningBoundary = () => 'f'.repeat(64); export const cycleVerificationBoundary = cyclePlanningBoundary;",
    "./standard-workflow-artifacts.mjs": "export const createStandardWorkflowArtifacts = () => globalThis[Symbol.for(" + JSON.stringify(key) + ")];",
  };
  const hook = registerFixtureModuleMocks({ targets, mocked });
  let modules;
  try { modules = await Promise.all(targets.map(target => import(target))); }
  finally { await hook.deregister(); }
  const hash = char => char.repeat(64), operationId = char => "op_" + char.repeat(40);
  try {
    for (const [index, definition] of definitions.entries()) {
      for (const invalidation of ["none", "authorization", "prefix", "context", "metadata", "content", "evaluation", "partial"]) {
        await check("cycle readiness contract: prepared plan " + definition.operation + " with " + invalidation + " invalidation", async () => {
          const planning = definition.operation === "cycle_plan_record";
          const cyclePath = "cycles/C001-feature-validity";
          const context = { session_id: "S001", cycle_id: "C001", cycle_type: "feature", cycle_state: planning ? "OPEN" : "IMPLEMENTING", mode: "COMMITTING",
            cycle_path: cyclePath, original_objective: "Verify prepared cycle plan validity", allowed_product_files: ["product/app.mjs"], documents: [] };
          const contextSha = shadowHash(context);
          const proposal = proposalFactory({ context, context_sha256: contextSha, evidence_refs: [{ ref: "audit:SPEC.md", sha256: hash("a") }] });
          const generated = renderStandardCyclePlan(proposal, cyclePath, { "brief.md": "## Scope\n\n## Non-scope\n\n## Constraints\n\n## Risks\n" });
          const status = "# Status\nstate: OPEN\nusage_matrix_scope: local\nusage_matrix_state: UNDECLARED\nusage_matrix_summary: pending\nusage_matrix_rationale: pending\nnext step: plan\nlast updated: old\nupdated_at: old\n";
          const contents = planning ? { ...generated, [cyclePath + "/status.md"]: status,
            "CURRENT-STATE.md": "# Current\nfirst_plan_step: plan\nupdated_at: old\n" } : {
            [cyclePath + "/status.md"]: status, [cyclePath + "/traceability.md"]: "# Traceability\n",
            "snapshots/context-snapshot.md": "# Snapshot\n", "CURRENT-STATE.md": "# Current\nfirst_plan_step: verify\nupdated_at: old\n" };
          const rows = new Map(Object.entries(contents).map(([path, content]) => [path, { path, content, metadata_sha256: hash("b") }]));
          const before = structuredClone([...rows]);
          const first = rows.keys().next().value;
          let owner = false, ownerPlan = null, ownerAssertions = 0, granted = false, writes = 0, evaluations = 0, authorizationCalls = 0;
          const material = path => { const row = rows.get(path); assert.ok(row, path); return { ...row, sha256: artifactContentHash(row.content), source: "postgres" }; };
          globalThis[Symbol.for(key)] = { root: "C:/controlled-cycle-plan-validity",
            describe: () => ({ database: true, backend: "postgres", state_mode: "db-only" }), ownerPending: () => owner,
            read: material, metadataHash: path => material(path).metadata_sha256,
            async withLocalEffectOwner(plan, action) {
              assert.match(plan, /^[a-f0-9]{64}$/);
              assert.equal(owner, false); owner = true; ownerPlan = plan;
              try { return await action(); } finally { owner = false; ownerPlan = null; }
            },
            assertLocalEffectOwner(plan) {
              if (!owner || ownerPlan !== plan) throw Object.assign(new Error("STANDARD_EFFECT_OWNER_REQUIRED"), { code: "STANDARD_EFFECT_OWNER_REQUIRED" });
              ownerAssertions++;
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
          const preparedAt = Date.parse("2026-11-11T00:00:00Z");
          let now = preparedAt;
          const operation = modules[index][definition.factory]({ targetRoot: "C:/controlled-cycle-plan-validity", now: () => now,
            readEvaluation: async () => {
              evaluations++;
              return { context, context_sha256: contextSha, evaluation_sha256: invalidation === "evaluation" && evaluations > 1 ? hash("9") : hash("d"),
                output: planning ? { facts: { cycle_plan_available: true }, observations: { proposal } }
                  : { facts: { cycle_validation_evidence_fresh: true, cycle_work_complete: true }, observations: { scope_sha256: hash("e"), status: "passed", proof_class: "fixture", checks: [] } } };
            },
            readCurrent: () => granted && invalidation === "prefix" ? { ...instance, instance_sha256: hash("8") } : instance,
            observeContext: async () => ({ context, context_sha256: granted && invalidation === "context" ? hash("7") : contextSha }) });
          const preview = await operation.prepare(instance, { evaluation_operation_id: operationId("1") });
          assert.equal(preview.can_apply, true);
          assert.deepEqual([...rows], before);
          now = preparedAt + 375948;
          const applying = operation.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256,
            assertAuthorized: async () => {
              authorizationCalls++; granted = true; now += 86400000;
              if (invalidation === "authorization") throw Object.assign(new Error("AUTHORIZATION_REVOKED"), { code: "AUTHORIZATION_REVOKED" });
              if (invalidation === "metadata") rows.get(first).metadata_sha256 = hash("6");
              if (invalidation === "content") rows.get(first).content += "\nChanged source\n";
            } });
          if (["none", "partial"].includes(invalidation)) {
            const result = await applying;
            assert.equal(result.outcome, invalidation === "none" ? "completed" : "reconciliation_required");
            assert.equal(result.effect_status, invalidation === "none" ? "confirmed" : "unknown");
            assert.equal(writes, invalidation === "none" ? preview.plan.changes.length : 1);
            assert.equal(result.observations.committed.length, writes);
          } else {
            const reason = invalidation === "authorization" ? "AUTHORIZATION_REVOKED"
              : ["metadata", "content", "evaluation"].includes(invalidation) ? "STANDARD_PREVIEW_CHANGED" : definition.reason;
            await assert.rejects(applying, { code: reason, effect_status: "no_effect" });
            assert.equal(writes, 0);
          }
          assert.equal(authorizationCalls, invalidation === "evaluation" ? 0 : 1);
          assert.equal(owner, false);
          assert.equal(ownerPlan, null);
          assert.equal(ownerAssertions > 0, !planning);
        });
      }
    }
  } finally { delete globalThis[Symbol.for(key)]; }
}
