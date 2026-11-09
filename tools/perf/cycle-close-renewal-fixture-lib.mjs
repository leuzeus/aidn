import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStandardCycleCloseHook } from "../../src/application/runtime/standard-cycle-close-hook.mjs";
import { LOCAL_ARTIFACT_FENCE_PATH } from "../../src/application/runtime/local-artifact-resource-fence.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Actual canonical artifacts and close-hook port; completion/H capabilities are
// explicitly synthetic. This is not published-process or genuine-actor proof.
export async function verifyCycleCloseRenewalBoundary({ targetRoot, instance, input, operationId, prepared, readRecorded, observeContext }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const hash = "a".repeat(64), anchor = { operation_id: "op_" + "c".repeat(40), receipt_sha256: hash, plan_sha256: hash,
    output_sha256: hash, alignment_sha256: hash, report_sha256: hash, event_sha256: hash, event_offset: 0 };
  const eventFile = path.join(targetRoot, ".aidn/runtime/perf/workflow-events.ndjson");
  const businessInventory = () => artifacts.inventory().paths.filter(name => name !== LOCAL_ARTIFACT_FENCE_PATH)
    .map(name => [name, artifacts.read(name).sha256]);
  const beforeEvents = fs.readFileSync(eventFile), inventory = businessInventory();
  const fence = artifacts.resourceFence();
  let expectedFence = fence.read();
  const unchanged = () => {
    assert.deepEqual(fs.readFileSync(eventFile), beforeEvents);
    assert.deepEqual(businessInventory(), inventory);
    assert.equal(fence.read().content_sha256, expectedFence.content_sha256);
    assert.equal(artifacts.ownerPending(), false);
  };
  let checks = 0;
  const pass = name => { unchanged(); checks++; console.log("PASS renewal boundary " + name); };
  let clock = prepared.plan.prepared_at_ms, code = "STANDARD_OBJECTIVE_DISPOSITION_EXPIRED", historicalFailure = false, processChanged = false;
  const open = () => createStandardCycleCloseHook({ targetRoot, readRecorded, observeContext, now: () => clock,
    readCurrent: () => processChanged ? { ...instance, instance_sha256: "b".repeat(64) } : instance,
    readObjectiveCompletion: async () => { await new Promise(resolve => setImmediate(resolve)); if (code) throw Object.assign(Error(code), { code }); return null; },
    readHistoricalCompletion: async () => { if (historicalFailure) throw Object.assign(Error("changed report"), { code: "STANDARD_OBJECTIVE_COMPLETION_REPORT_CHANGED" }); return structuredClone(anchor); } });
  const renewal = await open().prepare(instance, input, operationId);
  assert.equal(renewal.plan.contract_version, "standard-cycle-close-renewal-plan.v1");
  pass("expired preparation is a nonmutating typed review request");
  const result = await open().apply(instance, renewal, { write: true, expectPlan: renewal.plan_sha256, assertAuthorized() {} });
  assertStandardOperationOutput(result); assert.equal(result.effect_status, "no_effect");
  assert.deepEqual(result.facts, { cycle_close_completed: false, drift_completion_reviewed: false });
  assert.deepEqual(result.observations.previous_completion, anchor);
  pass("independently reconstructed port returns no closure success");
  const late = await open().apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
  assert.deepEqual(late, result);
  const released = fence.read();
  assert.equal(released.record.state, "released");
  assert.equal(released.record.revision, (expectedFence.record?.revision ?? 0) + 2);
  assert.equal(released.record.process_identity.pid, process.pid);
  assert.notEqual(released.record.token, expectedFence.record?.token);
  const projection = fs.readFileSync(path.join(targetRoot, "docs/audit", LOCAL_ARTIFACT_FENCE_PATH), "utf8");
  assert.deepEqual(JSON.parse(projection), released.record);
  expectedFence = released;
  pass("expiry after successful preview releases its pre-effect owner and requests review");
  code = "STANDARD_OBJECTIVE_COMPLETION_EXPIRED";
  const completion = await open().prepare(instance, input, operationId);
  assert.equal((await open().apply(instance, completion, { write: true, expectPlan: completion.plan_sha256, assertAuthorized() {} })).facts.cycle_close_completed, false);
  pass("both exact recognized expiry codes retain no-effect routing");
  code = "PROCESS_HUMAN_NOT_AUTHENTICATED";
  await assert.rejects(open().prepare(instance, input, operationId), { code });
  await assert.rejects(open().apply(instance, renewal, { write: true, expectPlan: renewal.plan_sha256, assertAuthorized() {} }), { code, effect_status: "no_effect" });
  pass("current H revocation cannot use expiry recovery");
  code = "STANDARD_OBJECTIVE_DISPOSITION_EXPIRED"; historicalFailure = true;
  await assert.rejects(open().prepare(instance, input, operationId), { code: "STANDARD_OBJECTIVE_COMPLETION_REPORT_CHANGED" });
  pass("changed historical witnesses refuse review routing"); historicalFailure = false;
  await assert.rejects(open().apply(instance, renewal, { write: true, expectPlan: renewal.plan_sha256,
    assertAuthorized() { throw Object.assign(Error("revoked"), { code: "FIXTURE_OPERATION_REVOKED" }); } }), { code: "FIXTURE_OPERATION_REVOKED", effect_status: "no_effect" });
  pass("a fresh separate operation authorization is mandatory");
  processChanged = true;
  await assert.rejects(open().apply(instance, renewal, { write: true, expectPlan: renewal.plan_sha256, assertAuthorized() {} }), { code: "STANDARD_CYCLE_CLOSE_HOOK_SOURCE_CHANGED", effect_status: "no_effect" });
  processChanged = false; pass("process CAS remains mandatory");
  code = null;
  await assert.rejects(open().apply(instance, renewal, { write: true, expectPlan: renewal.plan_sha256, assertAuthorized() {} }), { code: "STANDARD_PREVIEW_CHANGED", effect_status: "no_effect" });
  pass("a renewed current opinion requires a newly prepared close attempt");
  for (const facts of [{ cycle_close_completed: true, drift_completion_reviewed: false }, { ...result.facts, cycle_retained: true }])
    assert.throws(() => assertStandardOperationOutput({ ...result, facts }), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
  assert.equal(shadowHash(renewal.plan), renewal.plan_sha256); pass("the closed output contract rejects success hybrids");
  return { checks, status: "PASS", proof: "canonical-hook-with-synthetic-completion-authority", published_process: "NOT_RUN" };
}
