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

export async function verifyModeAnalysisExecution({ storageMode, sessionMode, disposition, mixedFixture }) {
  let sourceFile;
  const humanSource = { read: input => closureHumanSource(sourceFile).read(input), verify: input => closureHumanSource(sourceFile).verify(input) };
  const f = mixedFixture(storageMode, { standardModel: true, humanSource, hostTrace: true, async answer({ params }) {
    const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
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
  const auth = { ...f.authorize(), max_responses: 1, max_turn_ms: 300000 };
  auth.global_deadline_ms = auth.workflow_deadline_ms = auth.authorized_at_ms + 1800000;
  fs.writeFileSync(path.join(f.base, "mode-analysis-original-authority.json"), JSON.stringify({
    proof_class: "fixture-only-not-retry-authority", configuration: f.configuration, parameters,
    storage_mode: storageMode, session_mode: sessionMode, disposition, authorization: auth,
  }));
  const originalAuthority = shadowHash(auth), originalProduct = fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"), "utf8");
  const originalHead = execFileSync("git", ["-C", f.configuration.target_root, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
  let evaluation;
  for (let step = 0; step < 20; step++) {
    const state = f.open().inspect();
    if (state.cursor.status === "COMPLETED") break;
    const before = f.t.sessions.length;
    const result = await f.open().step({ write: true, authorization: auth });
    if (result.operation_id) {
      assert.equal(f.t.sessions.length, before, "D/H must not allocate Native");
      if (result.status === "waiting_for_human") {
        const record = f.open().readOperation(result.operation_id);
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
      if (record.intent.binding_ref === "mode_work_evaluate") { evaluation = output; break; }
      assert.equal(output?.outcome, "completed");
    } else {
      assert.equal(result.kind, "native"); assert.equal(result.journal_phase, "closed", JSON.stringify({ phase: result.journal_phase, status: result.status, failure: result.first_failure }));
      assert.equal(f.t.sessions.length, before + 1); f.reopen();
    }
  }
  assert.ok(evaluation, "published mode evaluation must be reached");
  assert.equal(shadowHash(auth), originalAuthority);
  assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
  assert.equal(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"), "utf8"), originalProduct);
  assert.equal(execFileSync("git", ["-C", f.configuration.target_root, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), originalHead);
  const complete = ["thinking_complete", "nonretained"].includes(disposition);
  const final = f.open().inspect();
  const nativeResults = final.record.events.filter(row => row.kind === "result");
  assert.equal(nativeResults.length, 1);
  for (const kind of ["activity-context", "artifact-output", "native-result"])
    assert.equal(nativeResults[0].result.evidence_refs.filter(row => row.ref.endsWith("-" + kind + ".json")).length, 1,
      "Authenticated mode result must carry " + kind);
  assert.equal(final.cursor.status, complete ? "COMPLETED" : "WAITING");
  assert.equal(final.record.model_sha256, loadStandardWorkflowAssets().source.model_sha256);
  assert.equal(evaluation.effect_status, "no_effect");
  assert.equal(evaluation.observations.product_effects_authorized, false);
  assert.equal(evaluation.observations.retention_authorized, false);
  assert.equal(evaluation.observations.session_closure_completed, false);
  if (!complete) assert.deepEqual(evaluation.facts, {});
  if (sessionMode === "THINKING") {
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
    instance_sha256: final.record.instance_sha256, workflow_status: final.cursor.status, native_responses: 1,
    D_H_wait_extra_model_calls: 0, cold_read_only_poll: true, new_decision_resume: "NOT_RUN", replay_simulation_exact: true,
    effects_unchanged: true, native_human: "fixture-capabilities", postgres: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: false }));
}
