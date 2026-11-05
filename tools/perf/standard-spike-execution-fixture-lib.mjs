import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { closureHumanSource } from "./cycle-closure-fixture-lib.mjs";

// Only actor transport/authentication are fixtures. The published model,
// reducer, admissions, conversion wrapper, initializer and hook remain real.
export async function verifyStandardSpikeExecution({ mixedFixture, storageMode, choice = "convert-to-spike" }) {
  let sourceFile;
  const humanSource = { read: input => closureHumanSource(sourceFile).read(input), verify: input => closureHumanSource(sourceFile).verify(input) };
  const f = mixedFixture(storageMode, { standardModel: true, humanSource, hostTrace: true, async answer({ params }) {
    const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
    assert.equal(observed.context.contract_version, "standard-mode-work-context.v1");
    assert.equal(observed.context.mode, "EXPLORING");
    return { outcome: "completed", summary: "Fixture proposes conversion, without product effects", report: {
      contract_version: "standard-mode-work-report.v1", context_sha256: observed.context_sha256, mode: "EXPLORING", objective: observed.context.objective,
      disposition: "retain_requested", findings: ["An explicitly scoped experiment is needed"], rationale: "Proposal only", evidence_refs: observed.evidence_refs } };
  } });
  sourceFile = path.join(f.configuration.control_root, "spike-human-sources.json"); fs.writeFileSync(sourceFile, "{}");
  const publish = (ref, source) => fs.writeFileSync(sourceFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(sourceFile, "utf8")), [ref]: source }));
  const parameters = { session: { session_id: "S001", session_branch: "S001-analysis", objective: "Learn through an explicitly admitted bounded SPIKE" },
    cycle: { cycle_id: "C001", cycle_type: "spike", title: "unused", objective: "The human selects the actual SPIKE" } };
  const first = f.open().initialize({ parameters }); f.open().initialize({ parameters, write: true, expectedResultSha256: first.record.instance_sha256 });
  const authorization = { ...f.authorize(), max_responses: 1, max_turn_ms: 300000 };
  authorization.global_deadline_ms = authorization.workflow_deadline_ms = authorization.authorized_at_ms + 3600000;
  fs.writeFileSync(path.join(f.base, "spike-original-authority.json"), JSON.stringify({ configuration: f.configuration, parameters, authorization,
    proof_class: "fixture-native-and-human-real-business-ports", storage_mode: storageMode, choice }));
  const originalAuthorization = shadowHash(authorization), product = fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"));
  const git = (...args) => execFileSync("git", ["-C", f.configuration.target_root, ...args], { encoding: "utf8", windowsHide: true }).trim();
  const head = git("rev-parse", "HEAD"); let final, delayed = null, conversionId;
  for (let step = 0; step < 32; step++) {
    const before = f.open().inspect(), count = f.t.sessions.length;
    if (["FAILED", "CANCELLED", "COMPLETED"].includes(before.cursor.status)) break;
    const read = await f.open().step();
    if (read.kind === "operation_preview" && read.preview.binding.id === "spike_cycle_initialize") {
      const preview = read.preview, at = preview.prepared.plan.prepared_at_ms;
      await new Promise(resolve => setTimeout(resolve, 1100));
      const staged = await f.open().stageOperation(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      delayed = { operation_id: staged.operation_id, prepared_at_ms: at, elapsed_ms: Date.now() - at, plan_sha256: preview.prepared.plan_sha256 };
    }
    const result = await f.open().step({ write: true, authorization });
    if (result.operation_id) {
      assert.equal(f.t.sessions.length, count, "D/H must not allocate Native");
      let record = f.open().readOperation(result.operation_id);
      if (result.status === "waiting_for_human") {
        const question = result.question, mode = record.intent.binding_ref === "mode_decision";
        assert.ok(mode || record.intent.binding_ref === "spike_conversion_decision");
        const source = mode ? { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "spike-mode",
          subject_sha256: "a".repeat(64), question_sha256: shadowHash(question), choice: "EXPLORING", evidence_refs: [{ ref: "fixture:mode", sha256: "a".repeat(64) }] }
          : { contract_version: "human-spike-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "spike-conversion",
            subject_sha256: shadowHash(question.review), question_sha256: shadowHash(question), choice, rationale: "Fresh fixture choice on this exact conversion",
            selection: choice === "convert-to-spike" ? { cycle_id: "C007", title: "bounded-learning", learning_goal: "Determine whether a bounded prototype is useful",
              timebox: "30 minutes", decision_target: "Retain or discard after measured validation", chosen_mode: "EXPLORING", branch_action: "create" } : null,
            evidence_refs: [{ ref: "fixture:spike-choice", sha256: "b".repeat(64) }] };
        const unchanged = f.open().inspect().record.instance_sha256;
        assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: "missing", write: true })).status, "waiting_for_human");
        assert.equal(f.open().inspect().record.instance_sha256, unchanged);
        publish("wrong", { ...source, question_sha256: "f".repeat(64) });
        await assert.rejects(f.open().receiveDecision(result.operation_id, { sourceRef: "wrong", write: true }), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
        publish("unverified", source);
        await assert.rejects(f.open().receiveDecision(result.operation_id, { sourceRef: "unverified", write: true }), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
        publish(mode ? "mode" : "spike", source);
        await f.open().receiveDecision(result.operation_id, { sourceRef: mode ? "mode" : "spike", write: true });
        await f.open().acceptOperation(result.operation_id, { write: true });
        const accepted = shadowHash(f.open().readOperation(result.operation_id));
        assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: mode ? "mode" : "spike", write: true })).status, "retained_result");
        assert.equal(shadowHash(f.open().readOperation(result.operation_id)), accepted);
        record = f.open().readOperation(result.operation_id);
      }
      final = record.results.at(-1)?.output;
      console.log(JSON.stringify({ spike_step: record.intent.binding_ref, operation_id: result.operation_id, outcome: final?.outcome, effect_status: final?.effect_status }));
      if (record.intent.binding_ref === "spike_conversion_finalize") { conversionId = result.operation_id; break; }
      if (record.intent.binding_ref === "spike_conversion_decision" && choice !== "convert-to-spike") break;
      assert.equal(final?.outcome, "completed", JSON.stringify(final));
    } else {
      assert.equal(result.kind, "native"); assert.equal(result.journal_phase, "closed", JSON.stringify(result));
      assert.equal(f.t.sessions.length, count + 1); f.reopen();
    }
  }
  assert.equal(shadowHash(authorization), originalAuthorization); assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
  assert.deepEqual(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs")), product); assert.equal(git("rev-parse", "HEAD"), head);
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
  if (choice === "convert-to-spike") {
    assert.equal(final?.facts.spike_conversion_completed, true, JSON.stringify(final)); assert.equal(final.effect_status, "confirmed");
    assert.equal(final.observations.hook.payload.mode, "EXPLORING");
    assert.equal(final.observations.sync?.ok ?? storageMode === "files", true);
    assert.equal(git("branch", "--show-current"), "spike/C007-bounded-learning");
    assert.ok(delayed.elapsed_ms >= 1100);
    assert.equal(f.open().readOperation(delayed.operation_id).preview.prepared.plan.prepared_at_ms, delayed.prepared_at_ms);
    assert.match(artifacts.read("cycles/C007-spike-bounded-learning/brief.md").content, /Timebox: 30 minutes/);
  } else {
    assert.equal(final.outcome, choice === "refused" ? "rejected" : choice); assert.deepEqual(final.facts, {}); assert.equal(artifacts.cycles().length, 0);
  }
  const terminal = f.open().inspect(); let replay;
  for (const row of iterateAgenticProcessSimulation({ instanceId: terminal.record.instance_id, scopeId: terminal.record.scope_id, model: terminal.record.model,
    parameters: terminal.record.initial_parameters, policyPins: terminal.record.policy_pins, facts: terminal.record.initial_facts, events: terminal.record.events })) replay = row;
  assert.equal(replay.instance_sha256, terminal.record.instance_sha256);
  console.log(JSON.stringify({ spike_wrapper: "PASS", storage_mode: storageMode, choice, root: f.configuration.target_root, configuration: f.configuration,
    delayed, conversion_operation_id: conversionId ?? null, model_sha256: terminal.record.model_sha256, instance_sha256: terminal.record.instance_sha256,
    replay: "PASS", native_responses: 1, genuine_human: "NOT_RUN", experiments: "NOT_RUN", full_standard: false }));
}
