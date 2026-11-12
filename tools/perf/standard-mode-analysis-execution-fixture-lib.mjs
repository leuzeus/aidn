import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { closureHumanSource } from "./cycle-closure-fixture-lib.mjs";
import { createStandardProcessAuthority } from "../../src/application/runtime/standard-process-authority.mjs";
import { MODE_WORK_CONTRACT } from "../../src/core/workflow/standard-mode-work.mjs";
import { assertSpikeReview, spikeConversionChoices } from "../../src/core/workflow/standard-spike-decision.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";

// The production mixed host, shipped model, ports and journals are used here.
// Native transport and human authentication are explicit fixture capabilities.
export function modeAnalysisWitness(host, configuration) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root });
  const git = args => execFileSync("git", ["-C", configuration.target_root, ...args], { encoding: "utf8", windowsHide: true });
  return shadowHash({
    product: fs.readFileSync(path.join(configuration.product_root, "app.mjs"), "utf8"),
    git: { head: git(["rev-parse", "HEAD"]), branch: git(["symbolic-ref", "HEAD"]), status: git(["status", "--porcelain=v1", "--untracked-files=all"]) },
    canonical: ["CURRENT-STATE.md", "snapshots/context-snapshot.md", "sessions/S001.md", ...artifacts.cycles().map(row => row.path)]
      .map(name => ({ name, sha256: artifacts.read(name, { required: true }).sha256, metadata_sha256: artifacts.metadataHash(name) })),
    instance: host.inspect().record.instance_sha256, allocations: host.inspectAllocations(),
    operations: host.inspect().record.events.filter(row => row.kind === "operation_intent")
      .map(row => shadowHash(host.readOperation(row.intent.operation_id))),
  });
}

export async function verifyModeAnalysisExecution({ storageMode, sessionMode, disposition, mixedFixture, closeSession = false, closureChoice = "close" }) {
  let sourceFile;
  const humanSource = { read: input => closureHumanSource(sourceFile).read(input), verify: input => closureHumanSource(sourceFile).verify(input) };
  const f = mixedFixture(storageMode, { standardModel: true, humanSource, hostTrace: true, async answer({ params }) {
    const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
    if (closeSession && observed.context.contract_version === "standard-drift-context.v2") {
      assert.equal(observed.context.mode, sessionMode);
      return { outcome: "completed", summary: "Fixture diagnostic bound to actual session scope", report: {
        contract_version: "standard-drift-report.v1", context_sha256: observed.context_sha256,
        original_objective: observed.context.original_objective, current_objective: observed.context.original_objective,
        drift_level: "none", objective_changed: false, changes: [], keep: ["Read-only analysis"], discard: [],
        split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" },
        recommendation: "continue", rationale: "Diagnostic only; the host must perform R05 and session closure separately", evidence_refs: observed.evidence_refs } };
    }
    assert.equal(observed.context.contract_version, "standard-mode-work-context.v1");
    assert.equal(observed.context.mode, sessionMode);
    assert.ok(observed.context.preflight_operation_id);
    return { outcome: "completed", summary: "Read-only fixture analysis, no lifecycle or effect authorization", report: {
      contract_version: "standard-mode-work-report.v1", context_sha256: observed.context_sha256,
      mode: sessionMode, objective: observed.context.objective, disposition,
      findings: ["The observed product exports value 1; no edit is requested by this analysis."],
      rationale: "Fixture report bound to the current authenticated context", evidence_refs: observed.evidence_refs,
    } };
  } });
  // Missing or changed product context must fail with a bounded host code
  // before authenticating an occurrence or allocating Native resources.
  const authority = createStandardProcessAuthority({ configuration: f.configuration, model: f.model,
    readSigningKey: () => f.key, readProductSha256: () => "a".repeat(64) });
  for (const productSnapshot of [undefined, null, {}]) await assert.rejects(
    authority.prepareActivityOutput({ contractRef: MODE_WORK_CONTRACT, productSha256: "a".repeat(64), productSnapshot }),
    error => error.code === "STANDARD_MODE_WORK_PRODUCT_CHANGED");
  assert.equal(f.t.sessions.length, 0);
  sourceFile = path.join(f.configuration.control_root, "mode-analysis-human-sources.json");
  fs.writeFileSync(sourceFile, "{}");
  const parameters = { session: { session_id: "S001", session_branch: "S001-analysis", objective: "Understand the current product without editing it" },
    cycle: { cycle_id: "C001", cycle_type: "spike", title: "analysis-unused", objective: "No cycle is admitted by mode analysis" } };
  const initial = f.open().initialize({ parameters });
  f.open().initialize({ parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
  // A separate, new fixture authority, never an extension of a retained case.
  const auth = { ...f.authorize(), max_responses: closeSession ? 2 : 1, max_turn_ms: 300000 };
  auth.global_deadline_ms = auth.workflow_deadline_ms = auth.authorized_at_ms + (closeSession ? 3600000 : 1800000);
  fs.writeFileSync(path.join(f.base, "mode-analysis-original-authority.json"), JSON.stringify({
    proof_class: "fixture-only-not-retry-authority", configuration: f.configuration, parameters,
    storage_mode: storageMode, session_mode: sessionMode, disposition, close_session: closeSession, closure_choice: closureChoice, authorization: auth,
  }));
  const originalAuthority = shadowHash(auth), originalProduct = fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"), "utf8");
  const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", f.configuration.target_root, ...args],
    { encoding: "utf8", windowsHide: true }).trim();
  const originalHead = git("rev-parse", "HEAD");
  let expectedHead = originalHead, evaluation, closure;
  for (let step = 0; step < (closeSession ? 40 : 20); step++) {
    const state = f.open().inspect();
    if (state.cursor.status === "COMPLETED") break;
    const before = f.t.sessions.length;
    const result = await f.open().step({ write: true, authorization: auth });
    if (result.kind === "call") {
      assert.equal(result.written, true); assert.equal(f.t.sessions.length, before, "a call allocates no Native");
      assert.equal(result.record.events.length, state.record.events.length + 1);
      assert.deepEqual(result.record.events.slice(0, -1), state.record.events);
      assert.equal(result.record.events.at(-1).kind, result.transition.transition === "call_entry" ? "call_enter" : "call_return");
      f.reopen(); continue;
    }
    if (result.operation_id) {
      assert.equal(f.t.sessions.length, before, "D/H must not allocate Native");
      if (result.status === "waiting_for_human") {
        const record = f.open().readOperation(result.operation_id);
        if (closeSession && record.intent.binding_ref === "session_closure_decision") {
          const claim = { contract_version: "human-session-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator",
            source_event_id: "mode-closure-" + sessionMode, subject_sha256: shadowHash(result.question.review), question_sha256: shadowHash(result.question),
            choice: closureChoice, rationale: "New fixture decision bound to this session, R05 and current HEAD",
            session_report: closureChoice === "close" ? { summary: "Read-only analysis completed", open_loops: [], blockers: [], next_entry_point: "Start a new explicitly authorized session" } : null,
            evidence_refs: [{ ref: "fixture:mode-closure-choice", sha256: "b".repeat(64) }] };
          const entries = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
          fs.writeFileSync(sourceFile, JSON.stringify({ ...entries, closure: claim }));
          await f.open().receiveDecision(result.operation_id, { sourceRef: "closure", write: true });
          await f.open().acceptOperation(result.operation_id, { write: true });
          if (closureChoice !== "close") break;
          continue;
        }
        if (record.intent.binding_ref === "spike_conversion_decision") {
          assert.equal(sessionMode, "EXPLORING");
          assert.equal(disposition, "retain_requested");
          assert.equal(record.phase, "staged");
          assert.deepEqual(record.results, []);
          const { review, choices } = record.preview.prepared;
          assertSpikeReview(review);
          assert.deepEqual(choices, spikeConversionChoices);
          const reviewId = record.preview.input.review_operation_id;
          const observed = f.open().readOperation(reviewId);
          assert.equal(observed.intent.binding_ref, "mode_work_observe");
          const observation = observed.results.at(-1).output;
          assert.equal(observation.effect_status, "no_effect");
          assert.deepEqual(review.analysis, observation.observations.review);
          const admitted = state.record.events.findLast(row => row.intent?.binding_ref === "spike_conversion_admit");
          assert.ok(admitted);
          const admission = f.open().readOperation(admitted.intent.operation_id);
          assert.equal(admission.preview.input.review_operation_id, reviewId);
          assert.equal(admission.results.at(-1).output.facts.mode_work_spike_requested, true);
          evaluation = observation.observations.evaluation;
          assert.equal(evaluation.outcome, "blocked");
          assert.deepEqual(evaluation.facts, {});
          break;
        }
        if (record.intent.binding_ref === "mode_work_continue_decision") {
          evaluation = record.preview.prepared.review;
          const observation = f.open().readOperation(record.preview.input.review_operation_id).results.at(-1).output;
          evaluation = observation.observations.evaluation;
          assert.equal(evaluation.outcome, "blocked"); assert.deepEqual(evaluation.facts, {});
          break;
        }
        assert.equal(record.intent.binding_ref, "mode_decision");
        const waitingSha = f.open().inspect().record.instance_sha256;
        for (let poll = 0; poll < 2; poll++) {
          assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: "missing", write: true })).status, "waiting_for_human");
          assert.equal(f.open().inspect().record.instance_sha256, waitingSha);
          assert.equal(f.t.sessions.length, before);
        }
        const claim = { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id: "fixture_operator",
          source_event_id: "mode-analysis-" + sessionMode, subject_sha256: "a".repeat(64), question_sha256: shadowHash(result.question), choice: sessionMode,
          evidence_refs: [{ ref: "fixture:mode-analysis-choice", sha256: "a".repeat(64) }] };
        fs.writeFileSync(sourceFile, JSON.stringify({ selected: claim }));
        await f.open().receiveDecision(result.operation_id, { sourceRef: "selected", write: true });
        await f.open().acceptOperation(result.operation_id, { write: true });
      }
      const record = f.open().readOperation(result.operation_id), output = record.results.at(-1)?.output;
      console.log(JSON.stringify({ mode_analysis_step: record.intent.binding_ref, outcome: output?.outcome, native_sessions: f.t.sessions.length }));
      if (record.intent.binding_ref === "session_git_checkpoint" && output.facts.session_git_checkpoint_created) {
        assert.equal(sessionMode, "EXPLORING");
        assert.equal(expectedHead, originalHead, "Only one session metadata checkpoint is expected");
        assert.equal(output.effect_status, "confirmed");
        assert.equal(output.facts.session_git_ready_for_cycle, true);
        const { git: checkpoint, committed_paths: paths } = output.observations;
        const allowed = ["docs/audit/CURRENT-STATE.md", "docs/audit/RUNTIME-STATE.md", "docs/audit/sessions/S001.md"];
        assert.ok(paths.length > 0 && paths.every(file => allowed.includes(file)));
        assert.equal(checkpoint.parent_sha, originalHead);
        assert.equal(git("rev-parse", "HEAD"), checkpoint.commit_sha);
        assert.equal(git("show", "-s", "--format=%P", checkpoint.commit_sha), originalHead);
        const changed = git("diff-tree", "--no-commit-id", "--name-only", "-r", checkpoint.commit_sha).split(/\r?\n/);
        assert.deepEqual(changed.sort(), [...paths].sort());
        expectedHead = checkpoint.commit_sha;
      }
      if (record.intent.binding_ref === "mode_work_evaluate") { evaluation = output; if (!closeSession) break; }
      if (record.intent.binding_ref === "session_close_finalize") { closure = output; break; }
      assert.equal(output?.outcome, "completed");
    } else {
      assert.equal(result.kind, "native"); assert.equal(result.journal_phase, "closed", JSON.stringify({ phase: result.journal_phase, status: result.status, failure: result.first_failure }));
      assert.equal(f.t.sessions.length, before + 1); f.reopen();
    }
  }
  assert.ok(evaluation, "published mode evaluation must be reached");
  assert.equal(shadowHash(auth), originalAuthority);
  assert.equal(f.t.sessions.length, closeSession ? 2 : 1); assert.ok(f.t.sessions.every(row => row.closed));
  assert.equal(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"), "utf8"), originalProduct);
  if (!closeSession || closureChoice !== "close") assert.equal(git("rev-parse", "HEAD"), expectedHead);
  if (closeSession && closureChoice === "close") {
    assert.equal(closure?.effect_status, "confirmed"); assert.equal(closure.facts.session_close_completed, true);
    assert.equal(closure.observations.event.mode, sessionMode);
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
    assert.match(artifacts.read("sessions/S001.md", { required: true }).content, /^state:\s*CLOSED\s*$/m);
    assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/perf/current-run-id.txt")), false);
  }
  const complete = ["thinking_complete", "nonretained"].includes(disposition);
  const final = f.open().inspect();
  const nativeResults = final.record.events.filter(row => row.kind === "result");
  assert.equal(nativeResults.length, closeSession ? 2 : 1);
  for (const kind of ["activity-context", "artifact-output", "native-result"])
    assert.equal(nativeResults[0].result.evidence_refs.filter(row => row.ref.endsWith("-" + kind + ".json")).length, 1,
      "Authenticated mode result must carry " + kind);
  assert.equal(final.cursor.status, closeSession ? ({ close: "COMPLETED", refused: "FAILED", deferred: "WAITING", cancelled: "CANCELLED" }[closureChoice]) : complete ? "RUNNING" : "WAITING");
  assert.equal(final.record.model_sha256, loadStandardWorkflowAssets().source.model_sha256);
  assert.equal(evaluation.effect_status, "no_effect");
  assert.equal(evaluation.observations.product_effects_authorized, false);
  assert.equal(evaluation.observations.retention_authorized, false);
  assert.equal(evaluation.observations.session_closure_completed, false);
  if (!complete) assert.deepEqual(evaluation.facts, {});
  if (sessionMode === "THINKING" && !closeSession) {
    const admitted = await preWriteAdmit({ targetRoot: f.configuration.target_root, skill: "start-session", nativeRequest: {
      tool_name: "apply_patch", cwd: f.configuration.target_root,
      tool_input: { command: "*** Begin Patch\n*** Update File: product/app.mjs\n@@\n-export const value = 1;\n+export const value = 99;\n*** End Patch" },
    } });
    assert.equal(admitted.context.mode, "THINKING");
    assert.deepEqual(admitted.write_decision.operations, [{ operation: "update", path: "product/app.mjs", classification: "product" }]);
    assert.equal(admitted.write_decision.outcome, "deny");
    const reasons = admitted.write_decision.reasons.map(row => row.code);
    assert.ok(reasons.includes("ACTIVE_CYCLE_REQUIRED"));
    assert.ok(reasons.includes("PHASE_EXCLUDES_IMPLEMENTATION"));
    console.log(JSON.stringify({ mode_analysis_product_admission: "denied-with-multiple-missing-prerequisites",
      observed_mode: admitted.context.mode, operations: admitted.write_decision.operations, reasons,
      isolated_mode_invariant: "NOT_ESTABLISHED_BY_THIS_CASE" }));
  }
  const requestFile = path.join(f.base, "mode-analysis-cold-request.json");
  fs.writeFileSync(requestFile, JSON.stringify({ configuration: f.configuration, key_hex: f.key.toString("hex"), human_source_file: sourceFile,
    expected_instance_sha256: final.record.instance_sha256, expected_status: final.cursor.status, authority: auth }));
  const before = modeAnalysisWitness(f.open(), f.configuration);
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./standard-mode-analysis-cold-fixture.mjs", import.meta.url)), requestFile],
    { encoding: "utf8", windowsHide: true, timeout: 600000, maxBuffer: 1048576 });
  fs.writeFileSync(path.join(f.base, "mode-analysis-cold.stdout.log"), child.stdout ?? "");
  fs.writeFileSync(path.join(f.base, "mode-analysis-cold.stderr.log"), child.stderr ?? "");
  fs.writeFileSync(path.join(f.base, "mode-analysis-cold.exit.json"), JSON.stringify({ pid: child.pid, status: child.status, signal: child.signal, error_code: child.error?.code ?? null }));
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(JSON.parse(child.stdout).new_native_allocations, 0);
  f.reopen(); assert.equal(modeAnalysisWitness(f.open(), f.configuration), before);
  let last, count = 0;
  for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, scopeId: final.record.scope_id, model: final.record.model,
    parameters: final.record.initial_parameters, policyPins: final.record.policy_pins, facts: final.record.initial_facts, events: final.record.events })) { last = row; count++; }
  assert.equal(count, final.record.events.length + 1); assert.equal(last.instance_sha256, final.record.instance_sha256);
  assert.equal(modeAnalysisWitness(f.open(), f.configuration), before);
  console.log(JSON.stringify({ mode_analysis_proof: true, storage_mode: storageMode, session_mode: sessionMode, disposition,
    project: f.configuration.target_root, control: f.configuration.control_root, model_sha256: final.record.model_sha256,
    instance_sha256: final.record.instance_sha256, workflow_status: final.cursor.status, native_responses: f.t.sessions.length,
    session_closure: closeSession ? closure?.facts.session_close_completed === true : "NOT_RUN", closure_choice: closeSession ? closureChoice : null,
    D_H_wait_extra_model_calls: 0, cold_read_only_poll: true, new_decision_resume: "NOT_RUN", replay_simulation_exact: true,
    effects_unchanged: true, native_human: "fixture-capabilities", postgres: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: false }));
}
