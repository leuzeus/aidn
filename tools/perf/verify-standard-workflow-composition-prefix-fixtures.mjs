import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowHost, loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const H = "a".repeat(64), temp = fs.realpathSync(os.tmpdir());
function host(targetRoot, privateRoot) {
  const readClaim = () => JSON.parse(fs.readFileSync(path.join(privateRoot, "claim.json"), "utf8"));
  return createStandardWorkflowHost({ targetRoot, readSigningKey: () => fs.readFileSync(path.join(privateRoot, "host.key")),
    authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H }),
    humanSource: { read: () => readClaim(), verify: ({ source, question }) => {
      const actual = readClaim();
      return actual && shadowHash(actual) === shadowHash(source) && source.question_sha256 === shadowHash(question)
        ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" };
    } } });
}
if (process.argv[2] === "--accept") {
  const [, , , target, privateRoot, operationId] = process.argv;
  const result = await host(target, privateRoot).accept(operationId, { write: true });
  console.log(JSON.stringify({ instance_sha256: result.record.instance_sha256 }));
} else {
  const stateMode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
  if (!["files", "dual", "db-only"].includes(stateMode)) throw Error("STANDARD_PREFIX_MODE_INVALID");
  const owned = [], assets = loadStandardWorkflowAssets(); let success = false;
  try {
    const target = createFreshStandardWorkflowFixture(stateMode, owned), privateRoot = fs.mkdtempSync(path.join(temp, "aidn-standard-composition-")); owned.push(privateRoot);
    fs.writeFileSync(path.join(privateRoot, "host.key"), randomBytes(32)); fs.writeFileSync(path.join(privateRoot, "claim.json"), "null");
    const parameters = { session: { session_id: "S001", session_branch: "S001-start", objective: "Qualify the published standard composition prefix" },
      cycle: { cycle_id: "C001", cycle_type: "FEATURE", title: "Deferred cycle", objective: "Not entered in THINKING" } };
    let runtime = host(target, privateRoot), initial = runtime.initialize({ instanceId: "standard-prefix", parameters });
    runtime.initialize({ instanceId: "standard-prefix", parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
    let deferred = false, acceptedCount = 0;
    for (let index = 0; index < 7; index++) {
      runtime = host(target, privateRoot);
      const state = runtime.inspect("standard-prefix"), frame = state.cursor.occurrences.find(row => row.status === "READY")
        ?? state.cursor.occurrences.find(row => row.operation?.receipt?.outcome === "deferred");
      assert.ok(frame, JSON.stringify(state.cursor));
      const preview = await runtime.preview({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id });
      assert.equal(preview.prepared?.can_apply ?? true, true, JSON.stringify(preview.prepared));
      const staged = await runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      let result = await runtime.dispatch(staged.operation_id, { write: true });
      if (preview.binding.executor_kind === "human") {
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
      acceptedCount++; console.log(`PASS prefix ${stateMode}: ${preview.binding.id} ${result.receipt.outcome}, child-process acceptance and retained dispatch`);
    }
    const final = runtime.inspect("standard-prefix");
    assert.equal(final.cursor.status, "COMPLETED"); assert.equal(final.record.model_sha256, assets.source.model_sha256);
    assert.ok(final.cursor.occurrences.some(row => row.node_id === "thinking_handoff"));
    assert.equal(final.cursor.occurrences.some(row => row.node_id === "cycle_create"), false);
    assert.equal(parseSessionMetadata(createStandardWorkflowArtifacts({ targetRoot: target }).read("sessions/S001.md").content).mode, "THINKING");
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256); success = true;
    console.log(JSON.stringify({ status: "PASS", checks: acceptedCount + 2, scope: "source-installed-standard-composition-startup-prefix", state_mode: stateMode,
      accepted_business_bindings: 6, deferred_decisions: 1, model_calls: 0, replay_simulation: "same-model-same-reducer", native: "NOT_RUN", installed_archive: "NOT_RUN",
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
