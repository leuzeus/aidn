import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { evaluateStandardCycleValidation } from "../../src/core/workflow/standard-cycle-verification.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
export async function verifyCycleVerificationContracts(check, proposal) {
  await check("cycle verification contract: incomplete tasks and tests never become lifecycle completion", async () => {
    const source = { proposal, observed_task_ids: [proposal.tasks[0].id], output: {}, context: { cycle_path: "cycles/C001-feature-fixture" }, context_sha256: "a".repeat(64),
      work: { output: { observations: { scope_sha256: "b".repeat(64) } } } };
    const evidence = { plan: { profile_sha256: "c".repeat(64), product_sha256: "d".repeat(64), proof_class: "fixture" }, manifest: { status: "passed" }, checks: [{ test_ref: "TEST-001", status: "passed", request_sha256: "e".repeat(64) }], evidence_refs: [] };
    const input = { source, evidence, validationOperationId: "op_" + "f".repeat(40) }, result = evaluateStandardCycleValidation(input);
    assertStandardOperationOutput(result); assert.equal(result.facts.cycle_work_complete, true); assert.equal(result.facts.cycle_checks_passed, true);
    assert.equal(result.observations.audit_status, "pending"); assert.equal(result.facts.cycle_verification_started, undefined);
    const more = structuredClone(input); more.source.proposal.tasks.push({ ...proposal.tasks[0], id: "TASK-002", task: "Complete the second task" });
    const incomplete = evaluateStandardCycleValidation(more); assert.equal(incomplete.facts.cycle_work_complete, false); assert.deepEqual(incomplete.observations.remaining_work_task_ids, ["TASK-002"]);
    for (const status of ["failed", "unavailable"]) { const stopped = structuredClone(input); stopped.evidence.manifest.status = status; stopped.evidence.checks[0].status = status;
      const observed = evaluateStandardCycleValidation(stopped); assert.equal(observed.facts.cycle_checks_passed, false); assert.deepEqual(observed.observations.pending_test_refs, ["TEST-001"]); }
  });
}
export async function verifyCycleVerificationEntry({ f, artifacts, cyclePath, validated, verifier, selected, script, setAllowed }) {
  const evaluated = await f.open().step({ write: true }), evaluation = f.open().readOperation(evaluated.operation_id).results.at(-1).output;
  assert.deepEqual(evaluation.facts, { cycle_validation_evidence_fresh: true, cycle_work_complete: true, cycle_checks_passed: true });
  assert.equal(evaluation.observations.audit_status, "pending"); assert.equal(verifier.calls(), 1);
  const names = [`${cyclePath}/status.md`, `${cyclePath}/traceability.md`, "snapshots/context-snapshot.md", "CURRENT-STATE.md"], before = names.map(name => artifacts.read(name));
  const preview = await f.open().step({ write: false }); assert.equal(preview.preview.prepared.can_apply, true, JSON.stringify(preview));
  setAllowed(false); await assert.rejects(f.open().step({ write: true }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" }); setAllowed(true);
  assert.deepEqual(names.map(name => artifacts.read(name).sha256), before.map(row => row.sha256));
  if (selected === "partial") {
    const db = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot: f.configuration.target_root }));
    try { db.exec(`CREATE TRIGGER fixture_abort_verification BEFORE INSERT ON artifacts WHEN NEW.path='${cyclePath}/traceability.md' BEGIN SELECT RAISE(ABORT,'fixture refused verification trace'); END`); }
    finally { db.close(); }
  }
  let entered;
  if (selected === "files") {
    const file = path.join(f.base, "verification-restart.json"); fs.writeFileSync(file, JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex"), validation_profile: verifier.profileRef }));
    const child = spawnSync(process.execPath, [script, "--recovery-record", file], { encoding: "utf8", shell: false, windowsHide: true, timeout: 900000 });
    assert.equal(child.status, 0, child.stderr); entered = JSON.parse(child.stdout); assert.equal(entered.launches, 0); assert.equal(entered.sessions, 0);
  } else {
    const write = fs.writeFileSync;
    try {
      if (selected === "projection") fs.writeFileSync = (file, ...args) => {
        if (typeof file === "string" && path.resolve(file) === path.resolve(f.configuration.target_root, "docs/audit", names[1])) return;
        return write(file, ...args);
      };
      entered = await f.open().step({ write: true });
    } finally { fs.writeFileSync = write; }
  }
  const record = f.open().readOperation(entered.operation_id), result = record.results.at(-1).output;
  if (["partial", "projection"].includes(selected)) {
    assert.equal(result.outcome, "reconciliation_required", JSON.stringify(result)); assert.equal(result.effect_status, "unknown"); assert.deepEqual(result.facts, {});
    assert.equal(result.observations.committed.length, selected === "partial" ? 1 : 4); assert.equal(artifacts.ownerPending(), true);
    assert.match(artifacts.read(names[0]).content, /^state: VERIFYING$/m);
    if (selected === "partial") assert.equal(artifacts.read(names[1]).sha256, before[1].sha256);
    else assert.equal(result.observations.reason_code, "STANDARD_CYCLE_VERIFICATION_PROJECTION_UNCONFIRMED");
    assert.equal((await f.open().step({ write: true })).kind, "reconciliation");
    const retained = shadowHash(record); assert.equal((await f.open().dispatchOperation(entered.operation_id, { write: true })).status, "retained_result");
    assert.equal(shadowHash(f.open().readOperation(entered.operation_id)), retained); assert.equal(verifier.calls(), 1); return;
  }
  assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.deepEqual(result.facts, { cycle_verification_started: true });
  assert.deepEqual(result.observations.committed, names); assert.equal(result.observations.verification, "pending_audit_and_explicit_closure");
  assert.match(artifacts.read(names[0]).content, /^state: VERIFYING$/m); assert.match(artifacts.read(names[0]).content, /^scope_frozen: true$/m);
  assert.match(artifacts.read(names[1]).content, /Process verification evidence/); assert.match(artifacts.read(names[2]).content, /C001 \(VERIFYING\)/);
  assert.match(artifacts.read(names[3]).content, /^first_plan_step: Audit requirements/m);
  assert.equal(artifacts.ownerPending(), false); assert.equal(verifier.calls(), 1); assert.equal(f.t.sessions.length, 2);
  const retained = shadowHash(record); assert.equal((await f.open().dispatchOperation(entered.operation_id, { write: true })).status, "retained_result");
  assert.equal(shadowHash(f.open().readOperation(entered.operation_id)), retained);
  const denied = await preWriteAdmit({ targetRoot: f.configuration.target_root, skill: "start-session", nativeRequest: { tool_name: "apply_patch", cwd: f.configuration.target_root,
    tool_input: { command: "*** Begin Patch\n*** Update File: product/app.mjs\n@@\n-export const value = 2;\n+export const value = 3;\n*** End Patch" } } });
  assert.equal(denied.write_decision.outcome, "deny"); assert.ok(denied.write_decision.reasons.some(row => row.code === "PHASE_EXCLUDES_IMPLEMENTATION"));
  console.log(`STEP cycle verification ${selected}: canonical VERIFYING, snapshot, traceability, retained result and refused code write`);
}
