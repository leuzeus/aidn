import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { closureHumanSource } from "./cycle-closure-fixture-lib.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { cycleAuditProposal } from "./cycle-audit-fixture-lib.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { modeAnalysisWitness } from "./standard-mode-analysis-execution-fixture-lib.mjs";

export function standardSpikeWitness(host, configuration) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root });
  const state = host.inspect(), names = new Set();
  for (const event of state.record.events.filter(row => row.kind === "operation_result")) {
    const record = host.readOperation(event.receipt.operation_id);
    for (const result of record.results) for (const row of result.output.evidence_refs ?? [])
      if (row.ref.startsWith("docs/audit/")) names.add(row.ref.slice(11));
  }
  return shadowHash({ existing: modeAnalysisWitness(host, configuration), canonical: [...names].sort().map(name => {
    const file = path.join(configuration.target_root, "docs/audit", name);
    return { name, sha256: artifacts.read(name, { required: true }).sha256, metadata_sha256: artifacts.metadataHash(name),
      projection_sha256: fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null };
  }) });
}

// Only actor transport/authentication are fixtures. The published model,
// reducer, admissions, conversion wrapper, initializer and hook remain real.
export async function verifyStandardSpikeExecution({ mixedFixture, storageMode, choice = "convert-to-spike", experiment = null, closeSession = false }) {
  if (closeSession && !experiment) throw Error("STANDARD_SPIKE_SESSION_CLOSE_EXPERIMENT_REQUIRED");
  let sourceFile;
  const humanSource = { read: input => closureHumanSource(sourceFile).read(input), verify: input => closureHumanSource(sourceFile).verify(input) };
  const f = mixedFixture(storageMode, { standardModel: true, validation: !!experiment, humanSource, hostTrace: true, async answer({ params }) {
    const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
    if (experiment && observed.context.contract_version === "standard-cycle-plan-context.v1") {
      const report = cyclePlanProposal(observed);
      report.spike = { learning_goal: observed.context.original_objective, timebox: "30 minutes", decision_target: "Retain or discard after measured validation" };
      return { outcome: "completed", summary: "Propose this human-selected SPIKE plan", report };
    }
    if (experiment && observed.context.contract_version === "standard-cycle-audit-context.v1")
      return { outcome: "completed", summary: "Audit actual SPIKE validation evidence", report: cycleAuditProposal(observed) };
    if (experiment && observed.context.contract_version === "standard-cycle-task-work-context.v1") {
      const context = observed.context;
      assert.equal(context.source_context.cycle_id, "C007");
      const request = { tool_name: "apply_patch", cwd: f.configuration.target_root, tool_input: {
        command: "*** Begin Patch\n*** Update File: product/app.mjs\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch" } };
      const admission = await preWriteAdmit({ targetRoot: f.configuration.target_root, skill: "start-session", nativeRequest: request });
      assert.equal(admission.write_decision.outcome, "allow");
      assert.equal(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"), "utf8"), "export const value = 1;\n");
      fs.writeFileSync(path.join(f.configuration.product_root, "app.mjs"), "export const value = 2;\n");
      return { outcome: "completed", summary: "Fixture product effect; validation is still required", report: {
        contract_version: "standard-cycle-task-work-report.v1", context_sha256: observed.context_sha256, task_id: context.task.id, task: context.task.task,
        work_outcome: "changed", changes: [{ path: "product/app.mjs", operation: "update" }], notes: ["Independent validation is pending"] } };
    }
    if (experiment && observed.context.contract_version === "standard-drift-context.v2") return { outcome: "completed", summary: "Exact-scope fixture diagnostic", report: {
      contract_version: "standard-drift-report.v1", context_sha256: observed.context_sha256, original_objective: observed.context.original_objective,
      current_objective: observed.context.original_objective, drift_level: "none", objective_changed: false, changes: [], keep: ["Current scope"], discard: [],
      split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" }, recommendation: "continue",
      rationale: "Fixture diagnostic on current evidence", evidence_refs: observed.evidence_refs } };
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
  // A new experiment case starts with its own explicit grant. No conversion-only
  // case's one-response grant, dates, receipts or debits are renewed here.
  const authorization = { ...f.authorize(), max_responses: experiment ? 8 : 1, max_turn_ms: 300000 };
  // The new full-session case has a separate initial three-hour grant. The
  // one-hour historical experiment cases and their arenas remain unchanged.
  authorization.global_deadline_ms = authorization.workflow_deadline_ms = authorization.authorized_at_ms + (closeSession ? 10800000 : 3600000);
  fs.writeFileSync(path.join(f.base, "spike-original-authority.json"), JSON.stringify({ configuration: f.configuration, parameters, authorization,
    proof_class: "fixture-native-and-human-real-business-ports", storage_mode: storageMode, choice, experiment, close_session: closeSession }));
  const originalAuthorization = shadowHash(authorization), product = fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"));
  const git = (...args) => execFileSync("git", ["-C", f.configuration.target_root, ...args], { encoding: "utf8", windowsHide: true }).trim();
  const head = git("rev-parse", "HEAD"); let final, cycleClosure, delayed = null, conversionId;
  let checkpoint;
  for (let step = 0; step < 90; step++) {
    const before = f.open().inspect(), count = f.t.sessions.length;
    if (["FAILED", "CANCELLED", "COMPLETED"].includes(before.cursor.status)) break;
    const initializerReady = before.cursor.ready.some(id => {
      const occurrence = before.cursor.occurrences.find(row => row.occurrence_id === id);
      return f.model.nodes.find(row => row.id === occurrence?.node_id)?.binding_ref === "spike_cycle_initialize";
    });
    if (initializerReady) {
      const read = await f.open().step();
      assert.equal(read.kind, "operation_preview");
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
        const closure = record.intent.binding_ref === "cycle_closure_decision";
        const promotion = closeSession && record.intent.binding_ref === "baseline_promotion_decision";
        const sessionClosure = closeSession && record.intent.binding_ref === "session_closure_decision";
        assert.ok(mode || closure && experiment || promotion || sessionClosure || record.intent.binding_ref === "spike_conversion_decision");
        const source = mode ? { contract_version: "human-mode-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "spike-mode",
          subject_sha256: "a".repeat(64), question_sha256: shadowHash(question), choice: "EXPLORING", evidence_refs: [{ ref: "fixture:mode", sha256: "a".repeat(64) }] }
          : closure ? { contract_version: "human-cycle-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "spike-closure-" + result.operation_id,
            question_sha256: shadowHash(question), subject_sha256: shadowHash(question.review), choice: experiment, rationale: "Fresh fixture decision on actual current SPIKE audit and product",
            risk_acceptances: [], evidence_refs: [{ ref: "fixture:spike-closure", sha256: "c".repeat(64) }] }
          : promotion ? { contract_version: "human-baseline-promotion-decision.v1", source_kind: "human", authority_id: "fixture_operator",
            source_event_id: "spike-promotion-" + result.operation_id, question_sha256: shadowHash(question), subject_sha256: shadowHash(question.review),
            choice: "not_requested", rationale: "Fresh fixture decision: close this session without requesting promotion", promotion: null,
            evidence_refs: [{ ref: "fixture:spike-promotion", sha256: "d".repeat(64) }] }
          : sessionClosure ? { contract_version: "human-session-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator",
            source_event_id: "spike-session-closure-" + result.operation_id, question_sha256: shadowHash(question), subject_sha256: shadowHash(question.review),
            choice: "close", rationale: "Fresh fixture decision after actual cycle closure, session admission and R05",
            session_report: { summary: "SPIKE ended with disposition " + experiment, open_loops: [], blockers: [], next_entry_point: "Start a new explicitly authorized session" },
            evidence_refs: [{ ref: "fixture:spike-session-closure", sha256: "e".repeat(64) }] }
          : { contract_version: "human-spike-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "spike-conversion",
            subject_sha256: shadowHash(question.review), question_sha256: shadowHash(question), choice, rationale: "Fresh fixture choice on this exact conversion",
            selection: choice === "convert-to-spike" ? { cycle_id: "C007", title: "bounded-learning", learning_goal: "Determine whether a bounded prototype is useful",
              timebox: "30 minutes", decision_target: "Retain or discard after measured validation", chosen_mode: experiment ? "COMMITTING" : "EXPLORING", branch_action: "create" } : null,
            evidence_refs: [{ ref: "fixture:spike-choice", sha256: "b".repeat(64) }] };
        const unchanged = f.open().inspect().record.instance_sha256;
        assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef: "missing", write: true })).status, "waiting_for_human");
        assert.equal(f.open().inspect().record.instance_sha256, unchanged);
        publish("wrong", { ...source, question_sha256: "f".repeat(64) });
        await assert.rejects(f.open().receiveDecision(result.operation_id, { sourceRef: "wrong", write: true }), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
        publish("unverified", source);
        await assert.rejects(f.open().receiveDecision(result.operation_id, { sourceRef: "unverified", write: true }), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
        const sourceRef = (mode ? "mode" : closure ? "closure" : promotion ? "promotion" : sessionClosure ? "session_closure" : "spike") + "_" + result.operation_id;
        publish(sourceRef, source);
        await f.open().receiveDecision(result.operation_id, { sourceRef, write: true });
        await f.open().acceptOperation(result.operation_id, { write: true });
        const accepted = shadowHash(f.open().readOperation(result.operation_id));
        assert.equal((await f.open().receiveDecision(result.operation_id, { sourceRef, write: true })).status, "retained_result");
        assert.equal(shadowHash(f.open().readOperation(result.operation_id)), accepted);
        record = f.open().readOperation(result.operation_id);
      }
      final = record.results.at(-1)?.output;
      if (record.intent.binding_ref === "session_git_checkpoint") checkpoint = record;
      console.log(JSON.stringify({ spike_step: record.intent.binding_ref, operation_id: result.operation_id, outcome: final?.outcome, effect_status: final?.effect_status }));
      if (record.intent.binding_ref === "spike_conversion_finalize") { conversionId = result.operation_id; if (!experiment) break; }
      if (experiment && record.intent.binding_ref === "cycle_close_finalize") { cycleClosure = final; if (!closeSession) break; }
      if (closeSession && record.intent.binding_ref === "session_close_finalize") break;
      if (record.intent.binding_ref === "spike_conversion_decision" && choice !== "convert-to-spike") break;
      assert.equal(final?.outcome, "completed", JSON.stringify(final));
    } else {
      assert.equal(result.kind, "native"); assert.equal(result.journal_phase, "closed", JSON.stringify(result));
      assert.equal(f.t.sessions.length, count + 1); f.reopen();
    }
  }
  assert.equal(shadowHash(authorization), originalAuthorization); assert.equal(f.t.sessions.length, closeSession ? 6 : experiment ? 5 : 1); assert.ok(f.t.sessions.every(row => row.closed));
  if (!experiment) {
    assert.deepEqual(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs")), product);
    const output = checkpoint.results.at(-1).output, plan = checkpoint.preview.prepared.plan;
    assert.equal(output.effect_status, "confirmed"); assert.equal(output.facts.session_git_checkpoint_created, true);
    assert.equal(plan.git.observed.head, head); assert.equal(output.observations.git.commit_sha, git("rev-parse", "HEAD"));
    assert.equal(git("rev-parse", "HEAD^"), head);
    assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split(/\r?\n/).sort(), plan.git.files.map(row => row.path).sort());
    for (const row of plan.git.files) {
      const bytes = execFileSync("git", ["-C", f.configuration.target_root, "show", `HEAD:${row.path}`], { windowsHide: true });
      assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256);
    }
  }
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
  if (experiment) {
    assert.equal(cycleClosure?.facts.cycle_close_completed, true, JSON.stringify(cycleClosure));
    const fields = artifacts.read("cycles/C007-spike-bounded-learning/status.md").content;
    assert.match(fields, new RegExp("state: " + ({ retain: "DONE", no_go: "NO_GO", drop: "DROPPED" }[experiment])));
    assert.equal(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"), "utf8"), "export const value = 2;\n");
    if (closeSession) {
      assert.equal(final?.effect_status, "confirmed", JSON.stringify(final)); assert.equal(final.facts.session_close_completed, true);
      assert.match(artifacts.read("sessions/S001.md", { required: true }).content, /^state:\s*CLOSED\s*$/m);
      assert.equal(fs.existsSync(path.join(f.configuration.target_root, ".aidn/runtime/perf/current-run-id.txt")), false);
    }
  } else if (choice === "convert-to-spike") {
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
  const witness = standardSpikeWitness(f.open(), f.configuration);
  if (closeSession) {
    // Stop at actual session closure before the independently governed delivery
    // path. A separate cold process must observe the identical retained state.
    const request = path.join(f.base, "spike-cold-request.json");
    fs.writeFileSync(request, JSON.stringify({ configuration: f.configuration, key_hex: f.key.toString("hex"), human_source_file: sourceFile,
      expected_instance_sha256: terminal.record.instance_sha256, expected_status: terminal.cursor.status, authority: authorization }));
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("./standard-spike-cold-fixture.mjs", import.meta.url)), request],
      { encoding: "utf8", windowsHide: true, timeout: 600000, maxBuffer: 1048576 });
    fs.writeFileSync(path.join(f.base, "spike-cold.stdout.log"), child.stdout ?? ""); fs.writeFileSync(path.join(f.base, "spike-cold.stderr.log"), child.stderr ?? "");
    fs.writeFileSync(path.join(f.base, "spike-cold.exit.json"), JSON.stringify({ pid: child.pid, status: child.status, signal: child.signal, error_code: child.error?.code ?? null }));
    assert.equal(child.status, 0, child.stdout + child.stderr); assert.equal(JSON.parse(child.stdout).new_native_allocations, 0);
    f.reopen(); assert.equal(standardSpikeWitness(f.open(), f.configuration), witness);
  }
  for (const row of iterateAgenticProcessSimulation({ instanceId: terminal.record.instance_id, scopeId: terminal.record.scope_id, model: terminal.record.model,
    parameters: terminal.record.initial_parameters, policyPins: terminal.record.policy_pins, facts: terminal.record.initial_facts, events: terminal.record.events })) replay = row;
  assert.equal(replay.instance_sha256, terminal.record.instance_sha256);
  assert.equal(standardSpikeWitness(f.open(), f.configuration), witness);
  console.log(JSON.stringify({ spike_wrapper: "PASS", storage_mode: storageMode, choice, root: f.configuration.target_root, configuration: f.configuration,
    delayed, conversion_operation_id: conversionId ?? null, model_sha256: terminal.record.model_sha256, instance_sha256: terminal.record.instance_sha256,
    replay: "PASS", native_responses: f.t.sessions.length, genuine_human: "NOT_RUN", experiments: experiment ?? "NOT_RUN",
    session_close: closeSession ? "PASS" : "NOT_RUN", cold_read_only_poll: closeSession ? "PASS" : "NOT_RUN", full_standard: false }));
}
