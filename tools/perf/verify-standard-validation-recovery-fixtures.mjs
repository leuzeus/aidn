import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWorkflowRunCli } from "../runtime/workflow-run.mjs";
import { shadowHash as H } from "../../src/core/workflow/shadow-json.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { createValidationRecoveryWriter } from "../../src/application/runtime/standard-validation-recovery-writer.mjs";
import { assertValidationLaunchRecoveryRequest, assertValidationLaunchRecoveryRecord, validationRecoveryOwnsFence } from "../../src/core/workflow/standard-validation-launch-recovery.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";

// Controlled persistence/process ports: this test measures durable ordering and
// refusals. It is not evidence of Windows startup or real product validation.
const checks = [], hash = "a".repeat(64), id = "op_" + "b".repeat(40);
const request = { contract_version: "standard-validation-launch-recovery.v1", target_root: "/fixture", instance_id: "fixture",
  operation_id: id, original_configuration: { path: "/configuration", sha256: hash }, validation_profile: { path: "/profile", sha256: hash } };
const schema = name => JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.v1.schema.json`, import.meta.url)));
const validate = (value, name) => assert.deepEqual(validateJsonSchema(value, schema(name), "$", { contractKind: "workflow-definition" }), []);
async function check(name, callback) { await callback(); checks.push(name); console.log("PASS " + name); }
function arena() {
  let stored = null, writes = 0, retired = false, renames = 0, revision = 0, drift = false, worker = 1;
  const owners = new Set();
  const identity = n => ({ platform: "linux", host: "fixture", pid: n, creation: "fixture-" + n });
  const originalFence = { contract_version: "local-artifact-resource-fence.v1", physical_root_sha256: hash, revision: 1,
    state: "held", token: "00000000-0000-0000-0000-000000000000", process_identity: identity(99) };
  let current = originalFence;
  const readFence = () => ({ record: structuredClone(current), content_sha256: H(current) });
  const signer = createOperationJournalSigner(() => Buffer.alloc(32, 7));
  const read = () => ({ record: structuredClone(stored), content_sha256: stored ? H(stored) : null });
  const store = { read, compareAndSwap(value, expected) {
    assert.equal(expected, read().content_sha256, "CAS"); assertValidationLaunchRecoveryRecord(value); signer.verify(value);
    stored = structuredClone(value); writes++; return { projection: "not_requested" };
  } };
  const fence = { read: readFence, prepareAcquire({ expectedSha256 }) {
    assert.equal(expectedSha256, H(current));
    return { previous_sha256: H(current), record: { ...current, revision: current.revision + 1, state: "held",
      token: String(++revision).padStart(36, "0"), process_identity: identity(worker) } };
  }, acquire({ expectedSha256, prepared, dispositionLease }) {
    assert.equal(expectedSha256, H(current)); assert.equal(prepared.previous_sha256, H(current));
    if (current.state === "held") { assert.equal(H(dispositionLease), H(current)); assert(!owners.has(current.process_identity.pid)); }
    current = structuredClone(prepared.record); writes++; return { ...readFence(), previous_sha256: expectedSha256 };
  }, assert(lease) { assert.equal(H(current), lease.content_sha256); assert.equal(current.state, "held"); },
  release(lease) { this.assert(lease); current = { ...current, state: "released", revision: current.revision + 1 }; writes++; return readFence(); } };
  const observed = () => ({ instance: { instance_id: "fixture", instance_sha256: hash, scope_id: hash, model_sha256: hash }, record: { operation_id: id },
    capsule: {}, native: {}, work: {}, profile: {}, snapshot: [], startup: {}, context: { authority_sha256: hash, context_sha256: hash },
    owner: { lease: { resource_fence: originalFence }, lock: { sha256: hash, retired }, fence: readFence() },
    assertStable() { if (drift) throw Object.assign(Error("DRIFT"), { code: "DRIFT" }); } });
  function writer(boundary = async () => {}, changes = {}) {
    worker++; owners.add(worker); const self = worker;
    return createValidationRecoveryWriter({ request, signer, store, fence, implementationSha256: hash, assertImplementation() {},
      observeOwner: value => owners.has(value.pid) ? "active" : "terminated",
      observe: async recovery => {
        if (recovery) { assertValidationLaunchRecoveryRecord(recovery); signer.verify(recovery); }
        assert(H(current) === H(originalFence) || recovery && validationRecoveryOwnsFence(recovery, current));
        const result = observed(); result.assertStable(); return result;
      }, retire({ dispositionLease, assertPermit }) {
        assertPermit(); fence.assert(dispositionLease);
        if (!retired) { renames++; writes++; retired = true; }
        return { lock_sha256: hash, retired_identity_sha256: hash, retired: true };
      }, boundary: async name => { worker = self; await boundary(name); }, ...changes });
  }
  return { writer, read, signer, stop: () => owners.clear(), stats: () => ({ writes, renames, retired, fence: current.state }),
    drift: () => { drift = true; }, tamper: () => { stored.evidence.context_sha256 = "d".repeat(64); } };
}
await check("closed request and schema definitions", () => {
  for (const name of ["standard-validation-launch-recovery", "standard-validation-launch-recovery-record", "standard-validation-launch-recovery-plan", "standard-validation-launch-recovery-result"])
    assert.deepEqual(validateJsonSchemaDefinition(schema(name), "#", { contractKind: "workflow-definition" }), []);
  assertValidationLaunchRecoveryRequest(request);
  for (const change of [{ force: true }, { operation_id: "../wrong" }, { validation_profile: { path: "/profile" } }])
    assert.throws(() => assertValidationLaunchRecoveryRequest({ ...request, ...change }));
});
await check("preview is inert, exact plan required, completed replay writes nothing", async () => {
  const a = arena(), w = a.writer(), preview = await w.preview(); validate(preview.plan, "standard-validation-launch-recovery-plan");
  assert.equal(a.stats().writes, 0); await assert.rejects(w.execute({ expectPlan: hash }), { code: "STANDARD_VALIDATION_RECOVERY_PLAN_CHANGED" });
  const result = await w.execute({ expectPlan: preview.action_sha256 }); validate(result, "standard-validation-launch-recovery-result");
  assert.equal(result.workflow_resumed, false); assert.equal(result.validation_passed, false);
  const before = a.stats(); assert.equal(before.renames, 1); assert.equal(before.fence, "released");
  const again = a.writer(), p = await again.preview(); assert(p.plan.already_completed);
  assert.equal((await again.execute({ expectPlan: p.action_sha256 })).written, false); assert.deepEqual(a.stats(), before);
});
for (const point of ["before_intent", "intent", "fence_acquired", "lease_retained", "lock_retired", "retirement_retained", "fence_released", "release_retained", "completed"])
  await check("restart after " + point + " preserves one physical retirement", async () => {
    const a = arena(), w = a.writer(name => { if (name === point) throw Error("CRASH"); }), p = await w.preview();
    await assert.rejects(w.execute({ expectPlan: p.action_sha256 }), /CRASH/);
    if (point !== "before_intent" && point !== "completed") await assert.rejects(a.writer().preview(), { code: "STANDARD_VALIDATION_RECOVERY_OWNER_ACTIVE" });
    const before = a.read().record; a.stop(); const next = a.writer(), q = await next.preview();
    await next.execute({ expectPlan: q.action_sha256 });
    const after = a.read().record; assertValidationLaunchRecoveryRecord(after);
    assert.equal(after.phase, "completed"); assert.equal(a.stats().renames, 1); assert.equal(a.stats().fence, "released");
    if (before && point !== "completed") assert.deepEqual(after.attempts.slice(0, before.attempts.length), before.attempts);
  });
await check("changed subject after preview is refused before intent", async () => {
  const a = arena(), w = a.writer(), p = await w.preview(); a.drift(); await assert.rejects(w.execute({ expectPlan: p.action_sha256 }), /DRIFT/);
  assert.equal(a.stats().writes, 0);
});
await check("changed subject after durable intent keeps the old lock and refuses retirement", async () => {
  const a = arena(), w = a.writer(name => { if (name === "intent") a.drift(); }), p = await w.preview();
  await assert.rejects(w.execute({ expectPlan: p.action_sha256 }), /DRIFT/); assert.equal(a.stats().renames, 0);
  assert.equal(a.read().record.phase, "pending");
});
await check("forged recovery record cannot own a retained fence", async () => {
  const a = arena(), w = a.writer(name => { if (name === "fence_acquired") throw Error("CRASH"); }), p = await w.preview();
  await assert.rejects(w.execute({ expectPlan: p.action_sha256 }), /CRASH/); a.stop(); a.tamper();
  await assert.rejects(a.writer().preview(), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" }); assert.equal(a.stats().renames, 0);
});
await check("public runner rejects forged fields and incompatible inputs without writes", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-recovery-cli-")), file = path.join(root, "request.json");
  try {
    const argv = ["--target", root, "--engine", "agentic", "--configuration", file, "--json"];
    fs.writeFileSync(file, JSON.stringify({ ...request, target_root: root, force: true }));
    let output = await runWorkflowRunCli(argv); assert.deepEqual(output.errors, ["STANDARD_VALIDATION_RECOVERY_REQUEST_INVALID"]);
    fs.writeFileSync(file, JSON.stringify({ ...request, target_root: root }));
    for (const args of [["--authorization", "absent"], ["--action-file", "absent"], ["--decision-source", "authored"], ["--control-source", "authored"], ["--replay"], ["--simulate"]]) {
      output = await runWorkflowRunCli([...argv, ...args]);
      assert.deepEqual(output.errors, ["WORKFLOW_RUN_VALIDATION_RECOVERY_ARGUMENT_CONFLICT"]); assert.equal(output.written, false);
    }
    assert.deepEqual(fs.readdirSync(root), ["request.json"]);
  } finally { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert(path.basename(root).startsWith("aidn-recovery-cli-")); fs.rmSync(root, { recursive: true, force: true }); }
});
console.log(JSON.stringify({ status: "PASS", checks: checks.length, proof_class: "controlled-recovery-ports", native: "SKIP", physical_windows_retirement: "SKIP" }));
