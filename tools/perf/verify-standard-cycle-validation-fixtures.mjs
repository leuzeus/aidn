#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createValidationProfileFixture, fixtureValidationBoundary, preflightValidationProfileFixture } from "./standard-cycle-validation-fixture-lib.mjs";
import { createStandardCycleValidation } from "../../src/application/runtime/standard-cycle-validation.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { assertStandardValidationProfile, selectStandardValidationChecks, standardValidationStatus } from "../../src/core/workflow/standard-cycle-validation.mjs";
import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { readStandardCycleValidationResult } from "../../src/application/runtime/standard-cycle-validation-result.mjs";
const owned = [], H = "a".repeat(64), hash = value => createHash("sha256").update(value).digest("hex");
let count = 0;
function pass(name) { console.log("PASS " + name); count++; }
try {
  const scenarios = [["passed", {}], ["failed", { status: "failed" }], ["negative-code", {}],
    ["unavailable", { mode: "malformed" }], ["changed", { mode: "mutate" }],
    ["timeout", { mode: "hang", duration: 100 }], ["node-timeout", { mode: "node-timeout", duration: 1000 }],
    ["refused", {}], ["stale", {}], ["writable-control", { writableControl: true }], ["grant-race", {}],
    ["elapsed", {}], ["elapsed-refused", {}], ["elapsed-prefix", {}], ["elapsed-work", {}]];
  const refusals = ["refused", "stale", "grant-race", "elapsed-refused", "elapsed-prefix", "elapsed-work"];
  for (const [selected, options] of scenarios) {
    const root = createStandardWorkflowFixture("files", owned), base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-validation-fixture-")); owned.push(base);
    const f = createValidationProfileFixture(base, options), product = path.join(root, "product"); fs.mkdirSync(product); const file = path.join(product, "app.mjs"); fs.writeFileSync(file, "export const value = " + (selected === "negative-code" ? "1" : "2") + ";\n");
    const bytes = fs.readFileSync(file), files = [{ path: "app.mjs", present: true, bytes: bytes.length, sha256: hash(bytes) }];
    const workOutput = { facts: { cycle_work_observed: true }, observations: { task: { test_refs: ["TEST:VALUE"] } } };
    const instance = { instance_id: "fixture", instance_sha256: H }, input = { work_operation_id: "op_" + "b".repeat(40) };
    // Authentication source is doubled here; the mixed-host corpus covers its
    // actual signed journal/native-evidence chain separately.
    const readWork = async () => ({ output: workOutput, evaluation_sha256: shadowHash(workOutput), product_root: product, files: structuredClone(files) });
    let clock = Date.now(), prefixChanged = false;
    const adapter = createStandardCycleValidation({ targetRoot: root, profileRef: f.profileRef, readWork,
      now: () => selected.startsWith("elapsed") ? clock : Date.now(),
      readCurrent: () => prefixChanged ? { ...instance, instance_sha256: "c".repeat(64) } : instance }, { boundaryFactory: fixtureValidationBoundary });
    if (selected === "writable-control") { await assert.rejects(adapter.prepare(instance, input), { code: "STANDARD_VALIDATION_WRITABLE_CONTROL_ROOT" });
      assert.equal(f.calls(), 0); assert.equal(createStandardWorkflowArtifacts({ targetRoot: root }).ownerPending(), false); pass(selected + ": no control data in writable sandbox scratch"); continue; }
    const plan = await adapter.prepare(instance, input); assert.equal(plan.can_apply, true);
    if (selected.startsWith("elapsed")) clock = plan.plan.prepared_at_ms + 375948;
    if (selected === "passed") {
      const preflight = await preflightValidationProfileFixture(f, { testRefs: ["TEST:VALUE"] });
      assert.equal(preflight.native, false); assert.equal(preflight.product_validation, "NOT_RUN");
      assert.deepEqual(preflight.results.map(row => row.status), ["passed", "failed"]);
      assert.equal(f.calls(), 0);
      await assert.rejects(preflightValidationProfileFixture(f, { testRefs: ["UNKNOWN"] }), { code: "STANDARD_VALIDATION_CHECK_UNKNOWN" });
      const extra = structuredClone(f.profile); extra.command = "untrusted"; assert.throws(() => assertStandardValidationProfile(extra));
      assert.throws(() => selectStandardValidationChecks(f.profile, { test_refs: ["UNKNOWN"] }));
      assert.throws(() => selectStandardValidationChecks(f.profile, { test_refs: [] }));
      assert.equal(standardValidationStatus([{ status: "failed" }, { status: "unavailable" }]), "unavailable");
      const absent = createStandardCycleValidation({ targetRoot: root, readWork, readCurrent: () => instance });
      assert.equal((await absent.prepare(instance, input)).reason_code, "STANDARD_VALIDATION_PROFILE_REQUIRED");
      const forged = structuredClone(plan); forged.plan.module = "untrusted.mjs"; forged.plan_sha256 = shadowHash(forged.plan);
      await assert.rejects(adapter.apply(instance, forged, { write: true, expectPlan: forged.plan_sha256, assertAuthorized: async () => {} }));
      await assert.rejects(adapter.apply(instance, plan, { expectPlan: plan.plan_sha256, assertAuthorized: async () => {} }));
    }
    if (selected === "stale") fs.appendFileSync(f.profileRef.path, "\n");
    let result;
    try { result = await adapter.apply(instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized: async () => {
      if (selected.startsWith("elapsed")) clock += 86400000;
      if (["refused", "elapsed-refused"].includes(selected)) throw Object.assign(new Error("refused"), { code: "FIXTURE_REFUSED" });
      if (selected === "grant-race") workOutput.observations.task.test_refs = ["UNKNOWN"];
      if (selected === "elapsed-prefix") prefixChanged = true;
      if (selected === "elapsed-work") files[0].sha256 = "d".repeat(64);
    } }); }
    catch (error) { assert.ok(refusals.includes(selected), error.stack); assert.equal(error.effect_status, "no_effect"); }
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
    if (refusals.includes(selected)) { assert.equal(result, undefined); assert.equal(f.calls(), 0); assert.equal(artifacts.ownerPending(), false); }
    else {
      assertStandardOperationOutput(result); assert.equal(result.observations.proof_class, "fixture");
      if (["changed", "timeout", "node-timeout"].includes(selected)) { assert.equal(result.outcome, "reconciliation_required", JSON.stringify(result)); assert.deepEqual(result.facts, {}); assert.equal(artifacts.ownerPending(), true);
        assert.equal(f.calls(), 1); if (selected === "timeout") assert.equal(result.observations.reason_code, "STANDARD_VALIDATION_STOP_UNCONFIRMED");
        assert.equal((await adapter.prepare(instance, input)).can_apply, false); }
      else { assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.observations.status, selected === "elapsed" ? "passed" : selected === "negative-code" ? "failed" : selected);
        assert.equal(result.facts.cycle_validation_passed, ["passed", "elapsed"].includes(selected)); assert.equal(result.facts.cycle_validation_available, selected !== "unavailable"); assert.equal(f.calls(), 1);
        assert.equal(artifacts.ownerPending(), false); const manifest = result.evidence_refs[0], record = path.join(f.profile.evidence_root, ...manifest.ref.split("/").slice(1));
        assert.equal(hash(fs.readFileSync(record)), manifest.sha256); assert.equal(JSON.parse(fs.readFileSync(record)).checks.length, 1);
        const source = { record: { intent: { binding_ref: "cycle_validation_execute" }, preview: { input, prepared: plan } }, output: result, work: await readWork() };
        const evidence = await adapter.readResult(source); assert.equal(evidence.manifest.status, result.observations.status); assert.equal(f.calls(), 1);
        assert.throws(() => readStandardCycleValidationResult({ ...source, materials: { profile: f.profile, descriptor_sha256: plan.plan.descriptor_sha256 } }));
        if (selected === "passed") {
          const saved = fs.readFileSync(record), details = JSON.parse(saved), log = path.join(f.profile.evidence_root, ...details.evidence_refs[1].ref.split("/").slice(1)), originalLog = fs.readFileSync(log);
          fs.appendFileSync(log, "tampered"); await assert.rejects(adapter.readResult(source)); fs.writeFileSync(log, originalLog);
          const snapshotProduct = path.join(result.observations.snapshot_path, "app.mjs"), originalProduct = fs.readFileSync(snapshotProduct);
          fs.appendFileSync(snapshotProduct, "tampered"); await assert.rejects(adapter.readResult(source)); fs.writeFileSync(snapshotProduct, originalProduct);
          fs.appendFileSync(record, " "); await assert.rejects(adapter.readResult(source)); fs.writeFileSync(record, saved);
          const stale = structuredClone(source); stale.work.evaluation_sha256 = H; await assert.rejects(adapter.readResult(stale));
          const relabelled = structuredClone(source); relabelled.output.observations.proof_class = "native"; await assert.rejects(adapter.readResult(relabelled));
          assert.equal((await adapter.readResult(source)).manifest.status, "passed"); assert.equal(f.calls(), 1);
        }
        const inconsistent = structuredClone(result); inconsistent.facts.cycle_validation_passed = !result.facts.cycle_validation_passed; assert.throws(() => assertStandardOperationOutput(inconsistent)); }
    }
    assert.deepEqual(fs.readFileSync(file), bytes); pass(selected + ": pinned Node fixture and bounded validation, no model call");
  }
  console.log(JSON.stringify({ status: "PASS", checks: count, proof_class: "offline_fixture", source_authentication: "doubled", native_provider: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  for (const root of owned) { const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert.ok(/^aidn-(standard-ports|validation-fixture)-/.test(path.basename(resolved))); fs.rmSync(resolved, { recursive: true, force: true }); }
}
