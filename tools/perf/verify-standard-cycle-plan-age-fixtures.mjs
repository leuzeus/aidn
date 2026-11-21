import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowCycleHost, loadStandardWorkflowCycleAssets } from "../../src/application/runtime/standard-workflow-cycle-composition.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { runSkillHookUseCase } from "../../src/application/runtime/skill-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";

// Current source-installed component. Historical expiry attempts remain in
// their original qualification records; legacy reader tests use a separate,
// explicitly synthetic receipt corpus.
const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
const agedCheckpoint = process.argv.includes("--aged-checkpoint") || process.argv.includes("--expire-checkpoint");
if (!["files", "dual", "db-only"].includes(mode)) throw Error("CYCLE_PLAN_AGE_MODE_INVALID");
const temporary = fs.realpathSync(os.tmpdir()), owned = [], assets = loadStandardWorkflowCycleAssets();
const H = "a".repeat(64), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args],
  { encoding: "utf8", stdio: "pipe", windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
function snapshot(root) {
  const rows = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), relative = path.relative(root, file).replaceAll("\\", "/"), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) rows.push([relative, "link", fs.readlinkSync(file)]);
      else if (stat.isDirectory()) { rows.push([relative, "directory"]); walk(file); }
      else rows.push([relative, "file", hash(fs.readFileSync(file))]);
    }
  }
  walk(root); return rows;
}
let checks = 0, success = false, clock = null, allowed = true, grants = 0;
const pass = name => { checks++; console.log(`PASS cycle plan age ${mode}: ${name}`); };
try {
  const target = createFreshStandardWorkflowFixture(mode, owned);
  const operations = createStandardWorkflowOperations({ targetRoot: target });
  const objective = "Verify currently valid prepared cycle operations";
  const session = { session_id: "S001", session_branch: "S001-cycle", objective };
  let prepared = await operations.prepareSession(session);
  assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  prepared = await operations.prepareMode({ session_id: session.session_id, mode: "COMMITTING" });
  assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  git(target, "add", "."); git(target, "-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture external session checkpoint");
  const key = randomBytes(32);
  const open = () => createStandardWorkflowCycleHost({ targetRoot: target, readSigningKey: () => key, now: () => clock ?? Date.now(),
    authorize: async request => { grants++; return { authorized: allowed, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: request.preview_sha256 }; } });
  let host = open();
  const parameters = { cycle: { session_id: session.session_id, cycle_id: "C001", cycle_type: "feature", title: "plan-validity", objective } };
  const initial = host.initialize({ instanceId: "cycle-validity", parameters });
  host.initialize({ instanceId: "cycle-validity", parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: target }), journals = [], agedNodes = [];
  const business = () => artifacts.inventory().paths.filter(name => !name.startsWith("workflows/"))
    .map(name => ({ artifact: artifacts.read(name), metadata_sha256: artifacts.metadataHash(name) }));
  for (let index = 0; index < assets.model.nodes.length; index++) {
    clock = null; host = open();
    const state = host.inspect("cycle-validity"); if (state.cursor.status === "COMPLETED") break;
    const frame = state.cursor.occurrences.find(row => state.cursor.ready.includes(row.occurrence_id));
    assert.ok(frame, "published cycle component must expose its next operation");
    const node = frame.node_id;
    if (node === "admit") {
      git(target, "add", "--", "docs/audit/RUNTIME-STATE.md");
      git(target, "-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture external context checkpoint");
    }
    if (node === "checkpoint") {
      const drift = runSkillHookUseCase({ args: { skill: "drift-check", mode: "COMMITTING", strict: true, noAutoSkipGate: true },
        perfDir: fileURLToPath(new URL("./", import.meta.url)), targetRoot: target, processAdapter: createLocalProcessAdapter() });
      assert.equal(drift.ok, true, JSON.stringify({ reason_code: drift.reason_code, result: drift.result,
        active_signals: drift.payload?.levels?.level2?.active_signals })); assert.equal(drift.payload.result, "ok");
      pass("actual external R05 hook supplies the checkpoint precondition on the same objective");
    }
    const aged = ["refresh_before", "initialize", "refresh_after", ...(agedCheckpoint ? ["checkpoint"] : [])].includes(node);
    if (aged) clock = Date.now() - 86400000;
    const bytes = snapshot(target), beforeGrants = grants;
    const preview = await host.preview({ instanceId: "cycle-validity", expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id });
    assert.deepEqual(snapshot(target), bytes); assert.equal(grants, beforeGrants); assert.equal(preview.prepared?.can_apply ?? true, true);
    const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
    clock = null;
    if (aged) {
      assert.ok(Date.now() - preview.prepared.plan.prepared_at_ms >= 86400000);
      const before = business(), journal = host.readJournal(staged.operation_id), head = git(target, "rev-parse", "HEAD");
      allowed = false;
      await assert.rejects(host.dispatch(staged.operation_id, { write: true }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
      assert.deepEqual(host.readJournal(staged.operation_id), journal); assert.deepEqual(business(), before);
      assert.equal(git(target, "rev-parse", "HEAD"), head); assert.equal(artifacts.ownerPending(), false);
      allowed = true; agedNodes.push(node); pass(`${node}: revoked current grant refuses the old plan before dispatch claim or business effects`);
    }
    const result = await host.dispatch(staged.operation_id, { write: true });
    assert.equal(result.receipt.outcome, "completed", JSON.stringify(host.readJournal(staged.operation_id).results.at(-1).output));
    const accepted = await host.accept(staged.operation_id, { write: true }), stable = snapshot(target), journal = host.readJournal(staged.operation_id);
    assert.equal((await host.dispatch(staged.operation_id, { write: true })).status, "retained_result");
    assert.equal(host.inspect("cycle-validity").record.instance_sha256, accepted.record.instance_sha256); assert.deepEqual(snapshot(target), stable);
    journals.push({ id: staged.operation_id, record: journal });
    pass(`${node}: original ${aged ? "day-old" : "current"} plan succeeds once and retained dispatch preserves every checkout byte`);
    if (aged && ["refresh_before", "initialize", "refresh_after"].includes(node)) {
      const before = business(), head = git(target, "rev-parse", "HEAD");
      const method = node === "initialize" ? "initializeCycle" : "refreshCycleContext";
      await assert.rejects(operations[method](preview.prepared, { write: true, expectPlan: preview.prepared.plan_sha256 }),
        { code: "STANDARD_PREVIEW_CHANGED", effect_status: "no_effect" });
      assert.deepEqual(business(), before); assert.equal(git(target, "rev-parse", "HEAD"), head); assert.equal(artifacts.ownerPending(), false);
      pass(`${node}: changed current source refuses the original plan after its actual effect`);
    }
  }
  const final = host.inspect("cycle-validity"), bytes = snapshot(target);
  assert.equal(final.cursor.status, "COMPLETED");
  assert.deepEqual(agedNodes, ["refresh_before", "initialize", ...(agedCheckpoint ? ["checkpoint"] : []), "refresh_after"]);
  assert.equal(final.record.events.filter(row => row.kind === "operation_intent").length, journals.length);
  for (const row of journals) assert.deepEqual(host.readJournal(row.id), row.record);
  const checkpoints = journals.filter(row => row.record.intent.binding_ref === "cycle_checkpoint_finalize");
  assert.equal(checkpoints.length, 1); assert.equal(checkpoints[0].record.results.at(-1).output.facts.cycle_checkpoint_completed, true);
  assert.equal(final.record.model_sha256, assets.source.model_sha256);
  const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
    policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
  assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256); assert.deepEqual(simulation.trace.at(-1).cursor, final.cursor);
  assert.deepEqual(snapshot(target), bytes); pass("published IR replay and simulation retain each original intention and one confirmed checkpoint");
  success = true;
  console.log(JSON.stringify({ status: "PASS", checks, state_mode: mode, model_revision: assets.model.revision, model_sha256: assets.source.model_sha256,
    scope: "source-installed-published-cycle-component", aged_nodes: agedNodes, legacy_expiry: "separate synthetic reader corpus and immutable historical qualifications",
    clock: "prepared in past; progressing real hook clock", authorization: "controlled current capability", checkpoint: "actual fixed hook, one original intent",
    native_allocations: 0, model_calls: 0, native: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: "NOT_COMPLETE" }));
} finally {
  if (success && !process.argv.includes("--retain-always")) for (const directory of owned) {
    const real = fs.realpathSync(directory);
    if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(real, { recursive: true, force: true });
  } else console.error(JSON.stringify({ retained_fixture_roots: owned, status: success ? "RETAINED_SUCCESS" : "RETAINED_FAILURE" }));
}
