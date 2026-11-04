#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowCycleHost, loadStandardWorkflowCycleAssets } from "../../src/application/runtime/standard-workflow-cycle-composition.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { assertStandardWorkflowComponentCatalog } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";
import { inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { runSkillHookUseCase } from "../../src/application/runtime/skill-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";
import { verifyStandardCycleCheckpointExpiryGuards } from "./verify-standard-cycle-checkpoint-expiry-guards-fixtures.mjs";

const H = "a".repeat(64), grant = { authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H };
const here = fileURLToPath(import.meta.url), owned = [], temporary = fs.realpathSync(os.tmpdir());
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
const open = (root, keyFile, authorize = async () => grant) => createStandardWorkflowCycleHost({ targetRoot: root, readSigningKey: () => fs.readFileSync(keyFile), authorize });
const cycle = { session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "local-change",
  objective: "Verify an actual cycle scaffold through the common process IR", continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-cycle" };
const checkpoint = root => { git(root, "add", "."); git(root, "-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture business checkpoint"); };
let checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };

if (process.argv[2] === "--accept") {
  const [, , , root, keyFile, id] = process.argv;
  const result = await open(root, keyFile).accept(id, { write: true });
  console.log(JSON.stringify({ instance_sha256: result.record.instance_sha256 }));
} else if (process.argv[2] === "--dispatch-checkpoint") {
  const [, , , root, keyFile, id] = process.argv;
  const host = open(root, keyFile);
  assert.equal(host.readJournal(id).intent.binding_ref, "cycle_checkpoint_finalize");
  console.log(JSON.stringify(await host.dispatch(id, { write: true })));
} else try {
  checks += await verifyStandardCycleCheckpointExpiryGuards();
  const assets = loadStandardWorkflowCycleAssets();
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
  assert.equal(assets.catalog.scope.kind, "new_cycle_scaffold_component");
  assert.equal(assets.model.nodes.filter(n => n.kind === "operation").length, 6);
  assert.deepEqual(assets.model.roles, []);
  const changed = structuredClone(assets.catalog); changed.scope.complete_standard_workflow = true;
  assert.throws(() => assertStandardWorkflowComponentCatalog(changed, assets.model), { code: "STANDARD_STARTUP_CATALOG_INVALID" });
  pass("distributed cycle component is pinned, deterministic and explicitly incomplete as a standard workflow");
  const cases = { files: ["files", "COMMITTING"], dual: ["dual", "COMMITTING"], "db-only": ["db-only", "COMMITTING"],
    exploring: ["db-only", "EXPLORING"], partial: ["db-only", "COMMITTING", true], "checkpoint-partial": ["files", "COMMITTING", false, true] };
  const selectedCase = process.argv[2] === "--db-only" ? "db-only" : process.argv[2]?.startsWith("--case=") ? process.argv[2].slice(7) : null;
  if (process.argv.length > 3 || process.argv[2] && selectedCase === null || selectedCase !== null && !Object.hasOwn(cases, selectedCase)) throw Error("STANDARD_CYCLE_FIXTURE_ARGUMENT_INVALID");
  const modes = selectedCase === null ? Object.values(cases) : [cases[selectedCase]];
  for (const [mode, selectedMode, partial = false, checkpointPartial = false] of modes) {
    const root = createFreshStandardWorkflowFixture(mode, owned), operations = createStandardWorkflowOperations({ targetRoot: root });
    // Precondition setup uses actual deterministic domain ports. This is not a
    // native human-channel qualification; authenticated mode capture has its own gate.
    let prepared = await operations.prepareSession({ session_id: "S001", session_branch: cycle.base_branch, objective: cycle.objective });
    assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    prepared = await operations.prepareMode({ session_id: "S001", mode: selectedMode });
    assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    checkpoint(root);
    const privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-key-")); owned.push(privateRoot);
    const keyFile = path.join(privateRoot, "host.key"); fs.writeFileSync(keyFile, randomBytes(32));
    const { base_branch, continuity_rule, ...requestedCycle } = cycle;
    const parameters = { cycle: requestedCycle };
    let host = open(root, keyFile), initial = host.initialize({ instanceId: "cycle", parameters });
    host.initialize({ instanceId: "cycle", parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const label = `${mode}/${selectedMode}${partial ? "/partial" : checkpointPartial ? "/checkpoint-partial" : ""}`;
    async function execute(nodeId, expectedOutcome = "completed") {
      const state = host.inspect("cycle"), frame = state.cursor.occurrences.find(row => state.cursor.ready.includes(row.occurrence_id))
        ?? state.cursor.occurrences.find(row => row.operation?.receipt?.outcome === "blocked");
      assert.ok(frame, JSON.stringify(state.cursor));
      assert.equal(frame.node_id, nodeId);
      const preview = await host.preview({ instanceId: "cycle", expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id });
      assert.ok(preview.input_resolution);
      if (nodeId === "initialize") {
        assert.deepEqual(preview.input, cycle);
        await assert.rejects(operations.prepareCycle({ ...preview.input, session_id: "S999" }), { code: "STANDARD_CYCLE_SESSION_CHANGED" });
        await assert.rejects(host.preview({ instanceId: "cycle", expectedSha256: state.record.instance_sha256,
          occurrenceId: frame.occurrence_id, input: cycle }), { code: "PROCESS_INPUT_OVERRIDE_FORBIDDEN" });
        await assert.rejects(open(root, keyFile, async () => ({ ...grant, authorized: false })).stage(preview,
          { write: true, expectedPreviewSha256: shadowHash(preview) }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
        assert.equal(git(root, "branch", "--show-current"), cycle.base_branch);
      }
      const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      const coldCheckpoint = nodeId === "checkpoint" && expectedOutcome === "completed" && mode === "files" && !checkpointPartial;
      const dispatched = coldCheckpoint ? JSON.parse(execFileSync(process.execPath, [here, "--dispatch-checkpoint", root, keyFile, staged.operation_id],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 90000, windowsHide: true })) : await host.dispatch(staged.operation_id, { write: true });
      const diagnostic = dispatched.receipt.outcome === expectedOutcome ? null
        : host.readOutput(host.readJournal(staged.operation_id).results.at(-1).receipt.evidence_refs[0].ref);
      assert.equal(dispatched.receipt.outcome, expectedOutcome, JSON.stringify({ dispatched, reason_code: diagnostic?.observations?.reason_code,
        hook_result: diagnostic?.observations?.hook?.payload?.result, hook_action: diagnostic?.observations?.hook?.payload?.action,
        hook_reason: diagnostic?.observations?.hook?.payload?.reason_code }));
      if (nodeId === "initialize") {
        const business = createStandardWorkflowArtifacts({ targetRoot: root }), before = business.read("CURRENT-STATE.md").sha256;
        const child = JSON.parse(execFileSync(process.execPath, [here, "--accept", root, keyFile, staged.operation_id],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, windowsHide: true }));
        host = open(root, keyFile);
        assert.equal(host.inspect("cycle").record.instance_sha256, child.instance_sha256);
        assert.equal(business.read("CURRENT-STATE.md").sha256, before);
      } else { host = open(root, keyFile); await host.accept(staged.operation_id, { write: true }); }
      const journal = shadowHash(host.readJournal(staged.operation_id));
      assert.equal((await host.dispatch(staged.operation_id, { write: true })).status, "retained_result");
      assert.equal(shadowHash(host.readJournal(staged.operation_id)), journal);
      pass(`${label}: ${nodeId}${coldCheckpoint ? " (cold Node dispatch)" : ""}, authenticated receipt survives reopening without redispatch`);
      return staged.operation_id;
    }
    await execute("refresh_before");
    const pending = path.join(root, "pending-business-change.txt"); fs.writeFileSync(pending, "review before cycle creation\n");
    const blockedId = await execute("admit", "blocked");
    assert.equal(host.inspect("cycle").cursor.status, "WAITING");
    assert.ok(host.readOutput(host.readJournal(blockedId).results.at(-1).receipt.evidence_refs[0].ref)
      .observations.prewrite.blocking_reasons.some(reason => reason.includes("pending-business-change.txt")));
    // An external, explicit Git checkpoint resolves real business dirt. Neither
    // the adapter nor the model commits or ignores business edits for the user.
    checkpoint(root);
    await execute("admit");
    assert.equal((await operations.prepareCycle({ ...cycle, continuity_rule: "R1_STRICT_CHAIN" })).can_apply, false);
    await assert.rejects(operations.prepareCycle({ ...cycle, module: "untrusted.mjs" }), { code: "STANDARD_OPERATION_INPUT_INVALID" });
    if (partial) {
      const DatabaseSync = getDatabaseSync(), database = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: root }));
      try { database.exec("CREATE TRIGGER fixture_abort_cycle_state BEFORE INSERT ON artifacts WHEN NEW.path = 'CURRENT-STATE.md' BEGIN SELECT RAISE(ABORT, 'fixture cycle state failure'); END"); }
      finally { database.close(); }
      const id = await execute("initialize", "reconciliation_required");
      const business = createStandardWorkflowArtifacts({ targetRoot: root }), state = host.inspect("cycle"), result = host.readJournal(id).results.at(-1);
      const output = host.readOutput(result.receipt.evidence_refs[0].ref);
      assert.equal(output.effect_status, "unknown"); assert.deepEqual(output.facts, {});
      assert.equal(output.observations.committed.length, 10);
      assert.equal(business.ownerPending(), true); assert.equal(state.cursor.status, "WAITING");
      assert.equal(git(root, "branch", "--show-current"), "feature/C001-local-change");
      const frame = state.cursor.occurrences.find(row => row.node_id === "initialize");
      await assert.rejects(host.preview({ instanceId: "cycle", expectedSha256: state.record.instance_sha256,
        occurrenceId: frame.occurrence_id }), { code: "PROCESS_OPERATION_ORDER_INVALID" });
      const simulation = simulateAgenticProcess({ instanceId: state.record.instance_id, model: state.record.model,
        parameters: state.record.initial_parameters, policyPins: state.record.policy_pins, scopeId: state.record.scope_id, events: state.record.events });
      assert.equal(simulation.trace.at(-1).instance_sha256, state.record.instance_sha256);
      pass(`${label}: real partial cycle CAS retains ownership/uncertainty and forbids effect replay after reopening`);
      continue;
    }
    await execute("initialize");
    const business = createStandardWorkflowArtifacts({ targetRoot: root }), row = business.cycles().find(row => row.cycle_id === cycle.cycle_id);
    assert.ok(row); assert.match(row.content, /^state: OPEN$/m); assert.match(row.content, /^dor_state: NOT_READY$/m);
    assert.match(row.content, /^scope_frozen: false$/m);
    assert.equal(git(root, "branch", "--show-current"), "feature/C001-local-change");
    const native = await preWriteAdmit({ targetRoot: root, nativeRequest: { cwd: root, tool_name: "apply_patch", tool_input: {
      command: "*** Begin Patch\n*** Add File: src/example.mjs\n+marker\n*** End Patch" } } });
    assert.equal(native.ok, false); assert.equal(native.write_decision.outcome, "deny");
    assert.ok(native.write_decision.reasons.some(row => row.code === "PHASE_EXCLUDES_IMPLEMENTATION"));
    assert.equal(fs.existsSync(path.join(root, "src/example.mjs")), false);
    pass(`${label}: real branch and canonical cycle stay OPEN/NOT_READY; native product patch denied`);
    await execute("audit");
    const checkpointInput = { session_id: cycle.session_id, cycle_id: cycle.cycle_id };
    const eventPath = path.join(root, ".aidn/runtime/perf/workflow-events.ndjson");
    const eventBytes = () => fs.existsSync(eventPath) ? fs.readFileSync(eventPath) : Buffer.alloc(0);
    const initialEvents = eventBytes();
    let checkpointPlan = await operations.prepareCycleCheckpoint(checkpointInput);
    {
      assert.equal(checkpointPlan.can_apply, false); assert.equal(checkpointPlan.reason_code, "STANDARD_CYCLE_CHECKPOINT_GATE_REQUIRED");
      const blocked = await execute("checkpoint", "blocked");
      assert.equal(host.inspect("cycle").cursor.status, "WAITING");
      assert.deepEqual(host.readJournal(blocked).results.at(-1).receipt.facts, {});
      assert.deepEqual(eventBytes(), initialEvents); assert.equal(business.ownerPending(), false);
      pass(`${label}: R05 preflight waits durably without running the hook or claiming checkpoint completion`);
      // External precondition: invoke the actual legacy drift hook. No event,
      // positive admission or successful checkpoint is fabricated here. This
      // does not qualify the still-missing full standard/native analysis graph.
      const drift = runSkillHookUseCase({ args: { skill: "drift-check", mode: "COMMITTING", strict: true, noAutoSkipGate: true },
        perfDir: fileURLToPath(new URL("./", import.meta.url)), targetRoot: root, processAdapter: createLocalProcessAdapter() });
      assert.equal(drift.ok, true, JSON.stringify(drift)); assert.equal(drift.payload.result, "ok");
      checkpointPlan = await operations.prepareCycleCheckpoint(checkpointInput);
    }
    assert.equal(checkpointPlan.can_apply, true, JSON.stringify(checkpointPlan));
    const beforeHook = eventBytes();
    await assert.rejects(operations.finalizeCycleCheckpoint(checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256,
      assertAuthorized() { throw Object.assign(new Error("fixture grant refused"), { code: "FIXTURE_GRANT_REFUSED" }); }, assertCurrent() {} }),
      error => error.code === "FIXTURE_GRANT_REFUSED" && error.effect_status === "no_effect");
    assert.deepEqual(eventBytes(), beforeHook); assert.equal(business.ownerPending(), false);
    if (mode === "files" && !checkpointPartial) {
      const branch = git(root, "branch", "--show-current");
      try {
        await assert.rejects(operations.finalizeCycleCheckpoint(checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256,
          assertAuthorized() { git(root, "switch", "--detach", "HEAD"); }, assertCurrent() {} }),
          error => ["STANDARD_CYCLE_CHECKPOINT_SOURCE_CHANGED", "STANDARD_CYCLE_CHECKPOINT_GATE_REQUIRED"].includes(error.code) && error.effect_status === "no_effect");
      } finally { git(root, "switch", branch); }
      assert.deepEqual(eventBytes(), beforeHook); assert.equal(business.ownerPending(), false);
      pass(`${label}: an external branch change during authorization refuses before checkpoint effects`);
    }
    if (checkpointPartial) {
      const openFile = fs.openSync; let checkpointId;
      try {
        fs.openSync = (file, ...args) => {
          if (typeof file === "string" && path.resolve(file) === path.resolve(eventPath) && fs.statSync(eventPath).size > beforeHook.length)
            throw Object.assign(new Error("fixture post-hook event read lost"), { code: "FIXTURE_EVENT_OBSERVATION_LOST" });
          return openFile(file, ...args);
        };
        checkpointId = await execute("checkpoint", "reconciliation_required");
      } finally { fs.openSync = openFile; }
      const result = host.readOutput(host.readJournal(checkpointId).results.at(-1).receipt.evidence_refs[0].ref);
      assert.equal(result.outcome, "reconciliation_required", JSON.stringify(result)); assert.equal(result.effect_status, "unknown");
      assert.equal(result.observations.reason_code, "FIXTURE_EVENT_OBSERVATION_LOST", JSON.stringify(result));
      assert.deepEqual(result.facts, {}); assert.equal(business.ownerPending(), true); assert.notDeepEqual(eventBytes(), beforeHook);
      assert.ok(result.observations.hook?.payload?.checkpoint);
      const pending = host.inspect("cycle"), frame = pending.cursor.occurrences.find(row => row.node_id === "checkpoint");
      assert.equal(pending.cursor.status, "WAITING");
      await assert.rejects(host.preview({ instanceId: "cycle", expectedSha256: pending.record.instance_sha256, occurrenceId: frame.occurrence_id }),
        { code: "PROCESS_OPERATION_ORDER_INVALID" });
      const simulation = simulateAgenticProcess({ instanceId: pending.record.instance_id, model: pending.record.model,
        parameters: pending.record.initial_parameters, policyPins: pending.record.policy_pins, scopeId: pending.record.scope_id, events: pending.record.events });
      assert.equal(simulation.trace.at(-1).instance_sha256, pending.record.instance_sha256);
      await assert.rejects(operations.finalizeCycleCheckpoint(checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256, assertAuthorized() {}, assertCurrent() {} }),
        { code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" });
      pass(`${label}: lost post-hook confirmation retains unknown effects and ownership without a second checkpoint`);
      continue;
    }
    const checkpointId = await execute("checkpoint");
    const checkpointResult = host.readOutput(host.readJournal(checkpointId).results.at(-1).receipt.evidence_refs[0].ref);
    assert.equal(checkpointResult.facts.cycle_checkpoint_completed, true); assert.equal(Object.hasOwn(checkpointResult.facts, "cycle_dor_ready"), false);
    assert.equal(checkpointResult.observations.hook.payload.checkpoint.gate.result, "ok");
    assert.equal(checkpointResult.observations.hook.payload.checkpoint.gate.skipped, false);
    assert.equal(checkpointResult.observations.event.run_id, checkpointResult.observations.hook.payload.checkpoint.run_id);
    assert.equal(checkpointResult.observations.hook.mode, "COMMITTING");
    assert.match(business.read("sessions/S001.md").content, new RegExp("^mode: " + selectedMode + "$", "m"));
    assert.match(business.read(row.path).content, /^continuity_rule: R2_SESSION_BASE_WITH_IMPORT$/m);
    assert.notDeepEqual(eventBytes(), beforeHook);
    const retainedEvents = eventBytes();
    await assert.rejects(operations.finalizeCycleCheckpoint(checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256, assertAuthorized() {}, assertCurrent() {} }),
      error => error.code === "STANDARD_PREVIEW_CHANGED" && error.effect_status === "no_effect");
    assert.deepEqual(eventBytes(), retainedEvents); assert.equal(business.ownerPending(), false);
    pass(`${label}: real cycle hook and fresh correlated checkpoint confirm without promoting DoR`);
    await execute("refresh_after");
    assert.equal(business.ownerPending(), false);
    assert.equal(git(root, "ls-files", ".aidn/runtime/index", ".aidn/runtime/standard-workflow", "docs/audit/workflows/process-instances", "docs/audit/workflows/operation-records"), "");
    const final = host.inspect("cycle"); assert.equal(final.cursor.status, "COMPLETED");
    assert.equal(Object.assign({}, ...final.record.events.filter(event => event.kind === "operation_result").map(event => event.receipt.facts)).cycle_dor_ready, false);
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model,
      parameters: final.record.initial_parameters, policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
    assert.deepEqual(simulation.trace.at(-1).cursor, inspectAgenticProcess(final.record));
    pass(`${label}: waiting admission and completed scaffold replay/simulate exactly with the execution reducer`);
  }
  console.log(JSON.stringify({ status: "PASS", checks, proof: "offline-real-ports-distributed-cycle-scaffold",
    authorization: "fixture-capability", native: "NOT_RUN", installed_archive: "NOT_RUN", complete_cycle_create_skill: "NOT_QUALIFIED", full_standard_workflow: "NOT_YET_DELIVERED" }));
} finally {
  for (const root of owned) {
    const physical = fs.realpathSync(root);
    if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(physical, { recursive: true, force: true });
  }
}
