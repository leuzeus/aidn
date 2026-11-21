#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import schema from "../../src/core/contracts/workflow-definition/standard-session-close-admission-output.v1.schema.json" with { type: "json" };
const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_MODE_INVALID");
const owned = [], temp = fs.realpathSync(os.tmpdir()); let checks = 0, completed = false;
const pass = name => { checks++; console.log("PASS " + name); };
function snapshot(root) {
  const files = []; const visit = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile()) files.push([path.relative(root, file).replaceAll("\\", "/"), createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
  } }; visit(root); return JSON.stringify(files.sort((a, b) => a[0].localeCompare(b[0])));
}
async function verifyHost(root, instanceId, outcome, status) {
  const binding = standardWorkflowOperationBindings().find(row => row.id === "session_close_admit");
  const model = { contract_version: "agentic-process-model.v2", model_id: "session-close-admission-port-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], entry: "admit",
    nodes: [{ id: "admit", kind: "operation", participant_ref: "project", binding_ref: binding.id }],
    operation_pins: { [binding.id]: shadowHash(binding) } };
  const makeHost = () => createStandardWorkflowOperationHost({ targetRoot: root, model, readSigningKey: () => Buffer.alloc(32, 91),
    authorize: async () => { throw Error("READ_ONLY_ADMISSION_MUST_NOT_REQUEST_EFFECT_GRANT"); } });
  let host = makeHost(), initial = host.initialize({ instanceId });
  host.initialize({ instanceId, write: true, expectedResultSha256: initial.record.instance_sha256 });
  const current = host.inspect(instanceId), occurrence = current.cursor.occurrences.find(row => row.status === "READY");
  const preview = await host.preview({ instanceId, expectedSha256: current.record.instance_sha256, occurrenceId: occurrence.occurrence_id, input: { session_id: "S001" } });
  const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
  const result = await host.dispatch(staged.operation_id, { write: true });
  assert.equal(result.receipt.outcome, outcome); assert.equal(result.receipt.effect_status, "no_effect");
  const journal = shadowHash(host.readJournal(staged.operation_id)); host = makeHost();
  const accepted = await host.accept(staged.operation_id, { write: true }), final = host.inspect(instanceId);
  assert.equal(final.cursor.status, status); assert.equal(shadowHash(host.readJournal(staged.operation_id)), journal);
  assert.equal((await host.dispatch(staged.operation_id, { write: true })).status, "retained_result");
  assert.equal((await host.accept(staged.operation_id, { write: true })).record.instance_sha256, accepted.record.instance_sha256);
  const simulation = simulateAgenticProcess({ instanceId, model: final.record.model, scopeId: final.record.scope_id, policyPins: final.record.policy_pins,
    events: final.record.events });
  assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
  assert.deepEqual(result.receipt.facts, outcome === "completed" ? { session_close_admission_satisfied: true } : {});
  pass("focused common IR host: authentic " + outcome + ", retained receipt and exact reducer replay/simulation; no session closure");
}
try {
  assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  assert.equal(schema["x-aidn-contract-version"], "standard-session-close-admission-output.v1"); pass("closed session admission schema identity");
  const root = createFreshStandardWorkflowFixture(mode, owned), operations = createStandardWorkflowOperations({ targetRoot: root });
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
  let plan = await operations.prepareSession({ session_id: "S001", session_branch: "S001-close-admission", objective: "Qualify actual session close admission" });
  assert.equal((await operations.initializeSession(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  plan = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await operations.applyMode(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  const before = snapshot(root), allowed = await operations.admitSessionClose({ session_id: "S001" });
  assert.equal(allowed.outcome, "completed", JSON.stringify(allowed)); assert.deepEqual(allowed.facts, { session_close_admission_satisfied: true });
  assert.equal(allowed.effect_status, "no_effect"); assert.equal(allowed.observations.admission.action, "close_session_allowed");
  assert.equal(allowed.observations.skill_completion, "pending"); assert.equal(snapshot(root), before); pass("actual canonical admission preserves every project file and does not close session");
  const foreign = await operations.admitSessionClose({ session_id: "S999" });
  assert.equal(foreign.outcome, "blocked"); assert.deepEqual(foreign.facts, {}); assert.equal(snapshot(root), before); pass("foreign session refused without mutation");
  if (mode !== "files") {
    const DatabaseSync = getDatabaseSync(), file = resolveRuntimeSqliteFile({ targetRoot: root });
    let db = new DatabaseSync(file), row;
    try { row = db.prepare("SELECT * FROM sessions WHERE session_id=?").get("S001"); assert.ok(row); db.prepare("DELETE FROM sessions WHERE session_id=?").run("S001"); }
    finally { db.close(); }
    const incompleteBefore = snapshot(root), incomplete = await operations.admitSessionClose({ session_id: "S001" });
    assert.equal(incomplete.outcome, "blocked"); assert.deepEqual(incomplete.facts, {});
    assert.equal(incomplete.observations.admission.action, "blocked_canonical_runtime"); assert.equal(snapshot(root), incompleteBefore);
    db = new DatabaseSync(file);
    try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE session_id=?").get("S001").n, 0);
      const keys = Object.keys(row); db.prepare(`INSERT INTO sessions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map(key => row[key])); }
    finally { db.close(); }
    pass("incomplete historical canonical session refuses without Markdown fallback or reader-side repair");
  }
  for (const forged of [ { ...allowed, facts: {} }, { ...allowed, facts: { session_close_completed: true } },
    { ...allowed, outcome: "blocked" }, { ...allowed, effect_status: "confirmed" } ])
    assert.throws(() => assertStandardOperationOutput(forged), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
  pass("admission cannot claim closure or facts on refusal");
  await verifyHost(root, "close_admission_allowed", "completed", "COMPLETED");
  // These are component fixture preconditions, not execution of the standard IR.
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture selected session mode");
  plan = await operations.prepareCycleContext({ session_id: "S001" });
  assert.equal((await operations.refreshCycleContext(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture cycle context");
  assert.equal((await operations.admitCycle()).outcome, "completed");
  plan = await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "open-admission", objective: "Require an explicit unresolved cycle decision", continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-close-admission" });
  assert.equal(plan.can_apply, true, JSON.stringify(plan)); assert.equal((await operations.initializeCycle(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  const openBefore = snapshot(root), blocked = await operations.admitSessionClose({ session_id: "S001" });
  assert.equal(blocked.outcome, "blocked", JSON.stringify(blocked)); assert.deepEqual(blocked.facts, {});
  assert.ok(blocked.observations.admission.open_cycles.length > 0); assert.notEqual(blocked.observations.admission.action, "close_session_allowed");
  assert.equal(snapshot(root), openBefore); pass("actual open cycle admission requires explicit resolution and preserves every project file");
  await verifyHost(root, "close_admission_blocked", "blocked", "WAITING");
  completed = true;
  console.log(JSON.stringify({ status: "PASS", checks_passed: checks, mode, application_ports: "actual", human_authority: "not_requested", model_calls: 0, session_closed: false, composed_workflow: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  for (const root of owned.reverse()) {
    const resolved = fs.realpathSync(root); if (!resolved.startsWith(temp + path.sep)) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    if (!completed && process.argv.includes("--retain-on-failure")) console.error(JSON.stringify({ retained_fixture: resolved, reason: "failed-session-close-admission-component" }));
    else fs.rmSync(resolved, { recursive: true, force: true });
  }
}
