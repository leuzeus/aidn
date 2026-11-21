import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertProcessDataBindings } from "../../src/core/workflow/process-data-contracts.mjs";
import { CYCLE_WORK_CONTRACT, observeStandardCycleWork } from "../../src/core/workflow/standard-cycle-work.mjs";
import { assertNativeActivityAnswer } from "../../src/core/workflow/native-activity-output.mjs";
export async function verifyCycleWorkContracts(check, { mixedFixture }) {
  const before = [{ path: "app.mjs", present: true, bytes: 10, sha256: "a".repeat(64) }], after = [{ ...before[0], sha256: "b".repeat(64) }];
  const context = { source_context: { cycle_state: "IMPLEMENTING", mode: "COMMITTING" }, product_prefix: "product", product_snapshot: before,
    task: { task: "Update the local value", paths: [{ path: "product/app.mjs", operations: ["update"] }] }, boundary_sha256: "c".repeat(64) };
  const report = { contract_version: CYCLE_WORK_CONTRACT, context_sha256: shadowHash(context), task: context.task.task,
    changes: [{ path: "product/app.mjs", operation: "update" }], notes: ["Separate deterministic validation required"] };
  const observe = (r = report, options = {}) => observeStandardCycleWork({ report: r, context, contextSha256: shadowHash(context), after,
    boundarySha256: context.boundary_sha256, producer: {}, evidenceRefs: [], ...options });
  await check("cycle work contract: authenticated observation never claims validation or authorship", async () => {
    assertNativeActivityAnswer({ outcome: "completed", summary: "Observed change", report }, CYCLE_WORK_CONTRACT, shadowHash(context));
    const output = observe(); assert.deepEqual(output.facts, { cycle_work_observed: true, cycle_validation_required: true });
    assert.equal(output.observations.validation, "not_executed"); assert.equal(output.effect_status, "no_effect");
    for (const mutate of [r => { r.tests_passed = true; }, r => { r.context_sha256 = "d".repeat(64); }, r => { r.changes[0].operation = "delete"; },
      r => { r.changes[0].path = "outside.mjs"; }, r => { r.changes.push(r.changes[0]); }]) {
      const bad = structuredClone(report); mutate(bad); assert.throws(() => observe(bad));
    }
    assert.throws(() => observe(report, { after: before }), /SCOPE_UNCONFIRMED/);
    assert.throws(() => observe(report, { boundarySha256: "f".repeat(64) }), /SOURCE_STALE/);
  });
  await check("cycle work contract: activity input mapping is explicit v2 and preserves v1 refusals", () => {
    const nodes = [{ id: "root", kind: "sequence", children: ["enter", "work"] }, { id: "enter", kind: "operation" }, { id: "work", kind: "activity" }];
    const binding = { contract_version: "process-data-bindings.v2", parameter_keys: [], inputs: [{ node_id: "enter", fields: {} },
      { node_id: "work", fields: { implementation_operation_id: { source: "operation_id", node_id: "enter" } } }] };
    assertProcessDataBindings(binding, nodes);
    assert.throws(() => assertProcessDataBindings({ ...binding, contract_version: "process-data-bindings.v1" }, nodes), /TARGET_INVALID/);
    assert.throws(() => assertProcessDataBindings(binding, [{ ...nodes[0], children: ["work", "enter"] }, ...nodes.slice(1)]), /NOT_ORDERED/);
  });
  await check("cycle work contract: wrong role, read-only policy or omitted IR source refuses before native sessions", () => {
    const f = mixedFixture("files", { planning: true, readiness: true, work: true });
    for (const mutate of [model => { model.roles.find(row => row.id === "implementation").role = "auditor"; model.roles.find(row => row.id === "implementation").action = "analyze"; },
      model => { model.policies.find(row => row.id === "work_policy").allowed_permissions = ["read:product"]; },
      model => { model.data_bindings.inputs = model.data_bindings.inputs.filter(row => row.node_id !== "implement"); }]) {
      const model = structuredClone(f.model); mutate(model); const text = JSON.stringify(model);
      fs.writeFileSync(f.configuration.model.path, text);
      // Model pins are raw file hashes, not the reducer's canonical JSON hash.
      f.configuration.model.sha256 = createHash("sha256").update(text).digest("hex");
      assert.throws(() => f.open(), { code: "PROCESS_ACTIVITY_OUTPUT_BINDING_INVALID" }); assert.equal(f.t.sessions.length, 0);
    }
  });
}
