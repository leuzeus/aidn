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

const here = fileURLToPath(import.meta.url), temporary = fs.realpathSync(os.tmpdir()), actualNow = Date.now;
const H = "a".repeat(64), hash = value => createHash("sha256").update(value).digest("hex");
let clockFile = null;
// Only the selected host operation's TTL clock is injected. A normal hook uses
// real wall time, including its independently emitted checkpoint event time.
const clockNow = () => {
  const value = clockFile === null ? null : JSON.parse(fs.readFileSync(clockFile, "utf8"));
  return value === null ? actualNow() : value;
};
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], {
  encoding: "utf8", stdio: "pipe", windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
}).trim();
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
function open(target, privateRoot, counters) {
  clockFile = path.join(privateRoot, "clock.json");
  return createStandardWorkflowCycleHost({ targetRoot: target, readSigningKey: () => fs.readFileSync(path.join(privateRoot, "host.key")),
    now: clockNow,
    authorize: async request => { counters.grants++; return { authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: request.preview_sha256 }; } });
}
if (process.argv[2] === "--prepare") {
  const [, , , target, privateRoot, id, expectedSha256] = process.argv, counters = { grants: 0 };
  const host = open(target, privateRoot, counters), preview = await host.reprepareExpiredOperation(id, { expectedSha256 });
  assert.equal(counters.grants, 0);
  console.log(JSON.stringify({ preview, counters }));
} else {
  const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
  if (!["files", "dual", "db-only"].includes(mode)) throw Error("CYCLE_EXPIRED_PREFIX_MODE_INVALID");
  const owned = [], counters = { grants: 0 }, assets = loadStandardWorkflowCycleAssets();
  let checks = 0, success = false;
  const pass = message => { checks++; console.log(`PASS cycle expired ${mode}: ${message}`); };
  try {
    const target = createFreshStandardWorkflowFixture(mode, owned), operations = createStandardWorkflowOperations({ targetRoot: target });
    // This expiry case retains the reference corpus's no-objective-drift
    // precondition. A changed objective is a real L2 signal, not a hook success.
    const objective = "Preserve expired cycle operation history before a fresh explicit grant";
    const session = { session_id: "S001", session_branch: "S001-cycle", objective };
    let prepared = await operations.prepareSession(session);
    assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    prepared = await operations.prepareMode({ session_id: session.session_id, mode: "COMMITTING" });
    assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    // DB-only can already have a clean checkout: still observe the external
    // checkpoint with a real commit, without manufacturing visible exports.
    git(target, "add", "."); git(target, "-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture session checkpoint");
    const privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-cycle-expired-")); owned.push(privateRoot);
    fs.writeFileSync(path.join(privateRoot, "host.key"), randomBytes(32));
    fs.writeFileSync(path.join(privateRoot, "clock.json"), "null");
    const parameters = { cycle: { session_id: session.session_id, cycle_id: "C001", cycle_type: "feature", title: "expiry-continuation",
      objective } };
    let host = open(target, privateRoot, counters), initial = host.initialize({ instanceId: "cycle-expiry", parameters });
    host.initialize({ instanceId: "cycle-expiry", parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const business = createStandardWorkflowArtifacts({ targetRoot: target }), originals = [], expiredNodes = [];
    const businessState = () => business.inventory().paths.filter(name => !name.startsWith("workflows/"))
      .map(name => ({ artifact: business.read(name), metadata_sha256: business.metadataHash(name) }));
    for (let index = 0; index < assets.model.nodes.length; index++) {
      // An isolated expiry probe ends at accepted/retained success. The next
      // operation starts with its own real-time preparation. This is no native
      // budget renewal: the component has no native activity or authorization.
      fs.writeFileSync(path.join(privateRoot, "clock.json"), "null");
      host = open(target, privateRoot, counters);
      const state = host.inspect("cycle-expiry");
      if (state.cursor.status === "COMPLETED") break;
      const frame = state.cursor.occurrences.find(row => state.cursor.ready.includes(row.occurrence_id));
      assert.ok(frame, "cycle prefix must expose a ready operation before its checkpoint");
      const nodeId = frame.node_id;
      if (nodeId === "admit") {
        // This component does not contain the full standard model's session Git
        // checkpoint. Supply that external precondition with real Git, as the
        // existing cycle-component corpus does; do not bypass its clean gate.
        git(target, "add", "--", "docs/audit/RUNTIME-STATE.md");
        git(target, "-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture external context checkpoint");
      }
      if (nodeId === "checkpoint") {
        // Supply the same external R05 precondition as the existing component
        // corpus, through the actual fixed hook. No gate/result is authored.
        const drift = runSkillHookUseCase({ args: { skill: "drift-check", mode: "COMMITTING", strict: true, noAutoSkipGate: true },
          perfDir: fileURLToPath(new URL("./", import.meta.url)), targetRoot: target, processAdapter: createLocalProcessAdapter() });
        assert.equal(drift.ok, true, JSON.stringify({ reason_code: drift.reason_code, result: drift.result,
          active_signals: drift.payload?.levels?.level2?.active_signals })); assert.equal(drift.payload.result, "ok");
        pass("external real R05 hook supplies the component checkpoint precondition without a native/model call");
      }
      const bytes = snapshot(target), grants = counters.grants;
      let preview = await host.preview({ instanceId: "cycle-expiry", expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id });
      assert.deepEqual(snapshot(target), bytes); assert.equal(counters.grants, grants); assert.ok(preview.input_resolution);
      assert.equal(preview.prepared?.can_apply ?? true, true, JSON.stringify(preview.prepared));
      let staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      const id = staged.operation_id;
      if (["cycle_context_refresh", "cycle_initialize"].includes(preview.binding.id)) {
        const before = businessState(), head = git(target, "rev-parse", "HEAD"), branch = git(target, "branch", "--show-current");
        const runtimeBefore = mode === "files" ? snapshot(path.join(target, ".aidn/runtime")) : null;
        fs.writeFileSync(clockFile, JSON.stringify(preview.prepared.plan.prepared_at_ms + 300001));
        const refused = await host.dispatch(id, { write: true }), original = host.readJournal(id);
        assert.equal(refused.receipt.outcome, "blocked"); assert.equal(refused.receipt.effect_status, "no_effect");
        assert.equal(original.results.at(-1).output.observations.reason_code, "STANDARD_PLAN_EXPIRED");
        assert.deepEqual(businessState(), before); assert.equal(git(target, "rev-parse", "HEAD"), head);
        assert.equal(git(target, "branch", "--show-current"), branch); assert.equal(business.ownerPending(), false);
        if (mode === "files") assert.deepEqual(snapshot(path.join(target, ".aidn/runtime")), runtimeBefore);
        pass(`${nodeId}: expired real dispatch preserves canonical business state, Git and FILES runtime bytes/directories`);
        const accepted = await host.accept(id, { write: true }); assert.equal(accepted.cursor.status, "WAITING");
        const waitingBytes = snapshot(target), waitingGrants = counters.grants;
        await assert.rejects(host.reprepareExpiredOperation(id, { expectedSha256: initial.record.instance_sha256 }), { code: "PROCESS_REVISION_CONFLICT" });
        await assert.rejects(host.reprepareExpiredOperation(id, { expectedSha256: accepted.record.instance_sha256, input: { session_id: "S999" } }),
          { code: "STANDARD_HOST_REPREPARE_INPUT_INVALID" });
        assert.deepEqual(snapshot(target), waitingBytes); assert.equal(counters.grants, waitingGrants);
        pass(`${nodeId}: stale predecessor and substituted subject refuse without effects`);
        const child = JSON.parse(execFileSync(process.execPath, [here, "--prepare", target, privateRoot, id, accepted.record.instance_sha256],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000, maxBuffer: 4194304, windowsHide: true }));
        preview = child.preview;
        assert.equal(child.counters.grants, 0); assert.deepEqual(snapshot(target), waitingBytes);
        assert.deepEqual(preview.input, original.preview.input); assert.equal(preview.occurrence_id, original.intent.occurrence_id);
        assert.equal(preview.instance_sha256, accepted.record.instance_sha256); assert.equal(preview.prepared.plan.prepared_at_ms, clockNow());
        assert.notEqual(preview.prepared.plan_sha256, original.preview.prepared.plan_sha256); assert.deepEqual(host.readJournal(id), original);
        pass(`${nodeId}: fresh Node rereads admissions and prepares the exact same subject without writes or authorization`);
        staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
        assert.notEqual(staged.operation_id, id); assert.ok(counters.grants > waitingGrants);
        const replacement = host.readJournal(staged.operation_id);
        assert.notDeepEqual(replacement.grant, original.grant); assert.equal(replacement.intent.instance_sha256, accepted.record.instance_sha256);
        originals.push({ id, record: original }); expiredNodes.push(nodeId);
        pass(`${nodeId}: explicit stage obtains a distinct fresh grant and intent; old history remains immutable`);
      }
      const dispatched = await host.dispatch(staged.operation_id, { write: true });
      const observations = host.readJournal(staged.operation_id).results.at(-1).output.observations;
      assert.equal(dispatched.receipt.outcome, "completed", JSON.stringify({ nodeId, reason_code: observations.reason_code,
        blocking_reasons: observations.prewrite?.blocking_reasons, lifecycle_reasons: observations.lifecycle?.blocking_reasons }));
      const accepted = await host.accept(staged.operation_id, { write: true }), stable = snapshot(target);
      assert.equal((await host.dispatch(staged.operation_id, { write: true })).status, "retained_result");
      assert.equal(host.inspect("cycle-expiry").record.instance_sha256, accepted.record.instance_sha256); assert.deepEqual(snapshot(target), stable);
      pass(`${nodeId}: actual successor succeeds once; retained redispatch preserves every checkout byte`);
    }
    const final = host.inspect("cycle-expiry"), bytes = snapshot(target);
    assert.equal(final.cursor.status, "COMPLETED");
    assert.deepEqual(expiredNodes, ["refresh_before", "initialize", "refresh_after"]);
    const checkpointIntent = final.record.events.find(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_checkpoint_finalize");
    assert.ok(checkpointIntent);
    assert.equal(host.readJournal(checkpointIntent.intent.operation_id).results.at(-1).output.facts.cycle_checkpoint_completed, true);
    for (const row of originals) assert.deepEqual(host.readJournal(row.id), row.record);
    assert.equal(final.record.model_sha256, assets.source.model_sha256);
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256); assert.deepEqual(simulation.trace.at(-1).cursor, final.cursor);
    assert.deepEqual(snapshot(target), bytes);
    pass("same shipped cycle IR/reducer replay and simulation preserve all three refusals, real checkpoint and final refresh");
    success = true;
    console.log(JSON.stringify({ status: "PASS", checks, state_mode: mode, model_revision: assets.model.revision, model_sha256: assets.source.model_sha256,
      scope: "source-installed-published-cycle-component", expired_nodes: expiredNodes, expired_bindings: ["cycle_context_refresh", "cycle_initialize"],
      physical_runtime_bytes: mode === "files" ? "all-bytes-and-directories-unchanged-on-expiry" : "NOT_QUALIFIED",
      clock: "isolated-host-operation-TTL-probes; real-wall-time-for-hook", authorization: "fixture-capability", native_allocations: 0, model_calls: 0,
      checkpoint: "actual-fixed-hook-completed-not-expired", external_r05_precondition: "actual-fixed-drift-hook", external_session_git_checkpoint: "actual-Git-before-cycle-admission",
      mixed_facade: "NOT_USED", native: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: "NOT_COMPLETE" }));
  } finally {
    clockFile = null;
    if (success && !process.argv.includes("--retain-always")) for (const directory of owned) {
      const real = fs.realpathSync(directory);
      if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-standard-")) throw Error("CYCLE_EXPIRED_PREFIX_CLEANUP_SCOPE_INVALID");
      fs.rmSync(real, { recursive: true, force: true });
    }
    else console.error(JSON.stringify({ retained_fixture_roots: owned, status: success ? "RETAINED_SUCCESS" : "RETAINED_FAILURE" }));
  }
}
