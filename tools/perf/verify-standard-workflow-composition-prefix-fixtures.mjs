import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowHost, loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createStandardProcessAuthority } from "../../src/application/runtime/standard-process-authority.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";

const H = "a".repeat(64), temp = fs.realpathSync(os.tmpdir());
function host(targetRoot, privateRoot) {
  const readClaim = () => JSON.parse(fs.readFileSync(path.join(privateRoot, "claim.json"), "utf8"));
  const readSigningKey = () => fs.readFileSync(path.join(privateRoot, "host.key")), assets = loadStandardWorkflowAssets();
  const humanSource = { read: () => readClaim(), verify: ({ source, question }) => {
    const actual = readClaim();
    return actual && shadowHash(actual) === shadowHash(source) && source.question_sha256 === shadowHash(question)
      ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" };
  } };
  const configuration = { instance_id: "standard-prefix", target_root: targetRoot, product_root: targetRoot, product_files: ["app.mjs"],
    control_root: privateRoot, review_root: privateRoot, native: { home: path.join(privateRoot, "native-not-started"), protected_roots: [] },
    activity_outputs: Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, row.output_contract])) };
  const processAuthority = createStandardProcessAuthority({ configuration, model: assets.model, modelSource: assets.source, readSigningKey, humanSource,
    readProductSha256: () => createHash("sha256").update(fs.readFileSync(path.join(targetRoot, "app.mjs"))).digest("hex") });
  return createStandardWorkflowHost({ targetRoot, readSigningKey, processAuthority, humanSource,
    now: () => fs.existsSync(path.join(privateRoot, "clock.json")) ? JSON.parse(fs.readFileSync(path.join(privateRoot, "clock.json"), "utf8")) : Date.now(),
    authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H }),
  });
}
if (process.argv[2] === "--accept") {
  const [, , , target, privateRoot, operationId] = process.argv;
  const result = await host(target, privateRoot).accept(operationId, { write: true });
  console.log(JSON.stringify({ instance_sha256: result.record.instance_sha256 }));
} else {
  if (process.argv.slice(2).some(arg => arg !== "--existing-session" && !/^--mode=(files|dual|db-only)$/.test(arg))) throw Error("STANDARD_PREFIX_ARGUMENT_INVALID");
  const stateMode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
  const existingSession = process.argv.includes("--existing-session");
  if (!["files", "dual", "db-only"].includes(stateMode)) throw Error("STANDARD_PREFIX_MODE_INVALID");
  const owned = [], assets = loadStandardWorkflowAssets(); let success = false;
  try {
    const target = createFreshStandardWorkflowFixture(stateMode, owned), privateRoot = fs.mkdtempSync(path.join(temp, "aidn-standard-composition-")); owned.push(privateRoot);
    fs.writeFileSync(path.join(privateRoot, "host.key"), randomBytes(32)); fs.writeFileSync(path.join(privateRoot, "claim.json"), "null");
    fs.writeFileSync(path.join(target, "app.mjs"), "export const value = 1;\n");
    execFileSync("git", ["-C", target, "add", "app.mjs"], { windowsHide: true });
    execFileSync("git", ["-C", target, "-c", "core.hooksPath=NUL", "commit", "-m", "fixture product"], { windowsHide: true });
    const parameters = { session: { session_id: "S001", session_branch: "S001-start", objective: "Qualify the published standard composition prefix" },
      cycle: { cycle_id: "C001", cycle_type: "FEATURE", title: "Deferred cycle", objective: "Not entered in THINKING" } };
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: target });
    const sessionDocuments = ["CURRENT-STATE.md", "sessions/S001.md"];
    let existingBefore = null;
    if (existingSession) {
      const operations = createStandardWorkflowOperations({ targetRoot: target }), prepared = await operations.prepareSession(parameters.session);
      assert.equal(prepared.can_apply, true);
      assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
      const mode = await operations.prepareMode({ session_id: parameters.session.session_id, mode: "THINKING" });
      assert.equal(mode.can_apply, true);
      assert.equal((await operations.applyMode(mode, { write: true, expectPlan: mode.plan_sha256 })).outcome, "completed");
      existingBefore = artifacts.readMany(sessionDocuments, { required: sessionDocuments, includeMetadata: true });
    }
    let runtime = host(target, privateRoot), initial = runtime.initialize({ instanceId: "standard-prefix", parameters });
    runtime.initialize({ instanceId: "standard-prefix", parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
    let deferred = false, acceptedCount = 0, startupFinalized = false, callTransitions = 0;
    const acceptedBindings = new Set();
    for (let index = 0; !startupFinalized; index++) {
      assert.ok(index < assets.catalog.bindings.length + 2 * (assets.model.call_targets?.length ?? 0) + 1, "startup prefix must terminate before any Native activity");
      runtime = host(target, privateRoot);
      const state = runtime.inspect("standard-prefix");
      const call = state.cursor.occurrences.find(row => row.status === "WAITING" && ["call_entry", "call_return"].includes(row.wait_reason));
      if (call) {
        const method = call.wait_reason === "call_entry" ? "enterCall" : "returnCall";
        const transition = { instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: call.occurrence_id, eventId: `prefix_call_${state.record.revision}` };
        const proposed = await runtime[method](transition);
        const applied = await runtime[method]({ ...transition, write: true, expectedResultSha256: proposed.record.instance_sha256 });
        assert.equal(applied.record.instance_sha256, proposed.record.instance_sha256); callTransitions++; continue;
      }
      const frame = state.cursor.occurrences.find(row => row.status === "READY")
        ?? state.cursor.occurrences.find(row => row.operation?.receipt?.outcome === "deferred");
      assert.ok(frame, JSON.stringify(state.cursor));
      let preview = await runtime.preview({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id });
      assert.equal(preview.prepared?.can_apply ?? true, true, JSON.stringify(preview.prepared));
      let staged = await runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });

      let result = await runtime.dispatch(staged.operation_id, { write: true });
      if (preview.binding.executor_kind === "human") {
        assert.equal(existingSession, false, "a canonical selected mode requests no new human choice");
        assert.equal(result.status, "waiting_for_human");
        const choice = deferred ? "THINKING" : "deferred";
        fs.writeFileSync(path.join(privateRoot, "claim.json"), JSON.stringify({ contract_version: "human-mode-decision.v1", source_kind: "human",
          authority_id: "fixture_user_channel", source_event_id: `prefix-${stateMode}-${choice}`, subject_sha256: H, question_sha256: shadowHash(result.question),
          choice, evidence_refs: [{ ref: "fixture:operator/mode", sha256: H }] }));
        result = await runtime.receiveDecision(staged.operation_id, { sourceRef: "choice", write: true });
        if (!deferred) { assert.equal(result.receipt.outcome, "deferred"); deferred = true; }
        else assert.equal(result.receipt.outcome, "completed");
      } else assert.equal(result.receipt.outcome, "completed", JSON.stringify(result));
      const accepted = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--accept", target, privateRoot, staged.operation_id],
        { encoding: "utf8", windowsHide: true, timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }));
      runtime = host(target, privateRoot);
      const after = runtime.inspect("standard-prefix"); assert.equal(after.record.instance_sha256, accepted.instance_sha256);
      if (result.receipt.outcome === "deferred") {
        assert.equal(after.cursor.status, "WAITING"); assert.deepEqual(result.receipt.facts, {});
        assert.equal(after.cursor.occurrences.some(row => row.node_id === "session_mode_apply"), false);
      }
      const digest = after.record.instance_sha256;
      assert.equal((await runtime.dispatch(staged.operation_id, { write: true })).status, "retained_result");
      assert.equal(runtime.inspect("standard-prefix").record.instance_sha256, digest);
      acceptedCount++; acceptedBindings.add(preview.binding.id); startupFinalized = preview.binding.id === "session_start_finalize";
      console.log(`PASS prefix ${stateMode}: ${preview.binding.id} ${result.receipt.outcome}, child-process acceptance and retained dispatch`);
    }
    const final = runtime.inspect("standard-prefix");
    assert.equal(final.cursor.status, "RUNNING"); assert.equal(final.record.model_sha256, assets.source.model_sha256);
    assert.equal(startupFinalized, true); assert.equal(deferred, !existingSession);
    if (existingSession) {
      assert.equal(acceptedBindings.has("session_initialize"), false); assert.equal(acceptedBindings.has("mode_decision"), false);
      assert.equal(acceptedBindings.has("session_mode_apply"), false);
      assert.deepEqual(artifacts.readMany(sessionDocuments, { required: sessionDocuments, includeMetadata: true }), existingBefore);
    }
    assert.ok(final.cursor.occurrences.some(row => row.node_id === "thinking_analysis" && row.status === "READY"));
    assert.ok(final.cursor.occurrences.some(row => row.node_id === "thinking_handoff"));
    assert.equal(final.cursor.occurrences.some(row => row.node_id === "cycle_create"), false);
    assert.equal(parseSessionMetadata(createStandardWorkflowArtifacts({ targetRoot: target }).read("sessions/S001.md").content).mode, "THINKING");
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256); success = true;
    console.log(JSON.stringify({ status: "PASS", checks: acceptedCount + 2, scope: "source-installed-standard-composition-startup-prefix", state_mode: stateMode,
      accepted_business_bindings: acceptedBindings.size, deferred_decisions: Number(deferred), call_transitions: callTransitions,
      entry: existingSession ? "existing_canonical_session" : "fresh_session", existing_documents_unchanged: existingSession ? true : null,
      terminal_ready_node: "thinking_analysis", component_completed: false, model_calls: 0, replay_simulation: "same-model-same-reducer", native: "NOT_RUN", installed_archive: "NOT_RUN",
      committing_cycle_route: "NOT_RUN", full_standard_workflow: "NOT_COMPLETE" }));
  } finally {
    if (success) for (const directory of owned) {
      const real = fs.realpathSync(directory);
      if (path.dirname(real) !== temp || !path.basename(real).startsWith("aidn-standard-")) throw Error("STANDARD_PREFIX_CLEANUP_SCOPE_INVALID");
      fs.rmSync(real, { recursive: true, force: true });
    }
    else console.error(JSON.stringify({ retained_failure_roots: owned }));
  }
}
