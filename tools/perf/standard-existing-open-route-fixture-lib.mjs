import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { renderStandardTaskProgress } from "../../src/core/workflow/standard-cycle-task-progress.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { taskProgressProposal, taskProgressValidationProfile } from "./cycle-task-progress-fixture-lib.mjs";
import { evaluateCurrentStateConsistency } from "./verify-current-state-consistency.mjs";

// The preimage is fixture data through real ports/CAS, not historical Native
// planning or completed work. The process executes the delivered root itself.
export async function verifyPublishedExistingOpen(check, { mixedFixture, selectedMode, complete = false }) {
  for (const mode of selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) await check(`standard existing ${complete ? "complete" : "open"} ${mode}: published entry preserves canonical planning and reaches its actual current phase`, async () => {
    const f = mixedFixture(mode, { standardModel: true, planning: true, hostTrace: true, ...(complete ? { validation: true } : {}), async answer({ params }) {
      try {
        const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
        assert.equal(observed.context.contract_version, "standard-drift-context.v2", "existing OPEN entry must not launch a planner or task worker before phase entry");
        return { outcome: "completed", summary: "Exact startup diagnostic through an identified transport double", report: {
          contract_version: "standard-drift-report.v1", context_sha256: observed.context_sha256,
          original_objective: observed.context.original_objective, current_objective: observed.context.original_objective,
          drift_level: "none", objective_changed: false, changes: [], keep: ["Exact current scope"], discard: [],
          split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" },
          recommendation: "continue", rationale: "Fixture wire only; actual checkpoint admission and effects remain host-owned", evidence_refs: observed.evidence_refs
        } };
      } catch (error) {
        fs.writeFileSync(path.join(f.base, "published-existing-open-rpc-failure.json"), JSON.stringify({ name: error.name, code: error.code ?? null,
          message: String(error.message).slice(0, 2048), stack: String(error.stack).slice(0, 2048) }, null, 2) + "\n");
        throw error;
      }
    } });
    const verifier = complete ? taskProgressValidationProfile(f.base, false) : null;
    if (verifier) f.validationProfile = verifier.profileRef;
    const root = f.configuration.target_root, artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), operations = createStandardWorkflowOperations({ targetRoot: root });
    const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args], { encoding: "utf8", windowsHide: true }).trim();
    const checkpoint = message => { git("add", "."); git("commit", "--allow-empty", "-m", message); };
    const apply = async (prepared, method) => { assert.equal(prepared.can_apply, true); assert.equal((await operations[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed"); };
    const objective = "Continue the current canonical plan through the delivered STANDARD entry", sessionBranch = "S001-existing-root";
    await apply(await operations.prepareSession({ session_id: "S001", session_branch: sessionBranch, objective }), "initializeSession");
    await apply(await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode"); checkpoint("fixture existing root session");
    await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture existing root context");
    await apply(await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "existing-root", objective,
      continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: sessionBranch }), "initializeCycle");
    const cyclePath = "cycles/C001-feature-existing-root", proposal = taskProgressProposal(cyclePlanProposal({ context_sha256: "a".repeat(64), context: {
      session_id: "S001", cycle_id: "C001", cycle_type: "feature", original_objective: objective, mode: "COMMITTING", allowed_product_files: ["product/app.mjs"] },
      evidence_refs: [{ ref: "audit:SPEC.md", sha256: artifacts.read("SPEC.md", { required: true }).sha256 }] }));
    const rendered = renderStandardCyclePlan(proposal, cyclePath, { "brief.md": artifacts.read(cyclePath + "/brief.md", { required: true }).content });
    if (complete) {
      rendered[cyclePath + "/plan.md"] = renderStandardTaskProgress({ originalPlan: rendered[cyclePath + "/plan.md"], proposal,
        completedTaskIds: proposal.tasks.map(row => row.id) });
      rendered[cyclePath + "/traceability.md"] = rendered[cyclePath + "/traceability.md"].trimEnd()
        + "\n\n## Process verification evidence\n\nNo lifecycle completion is inferred from these checks.\n\n"
        + String.fromCharCode(96).repeat(3) + "json\n" + JSON.stringify({ evaluation_operation_id: "op_" + "d".repeat(40),
          fixture_history: "STAGED_CANONICAL_DATA_NOT_CURRENT_VALIDATION" }) + "\n" + String.fromCharCode(96).repeat(3) + "\n";
    }
    for (const [name, content] of Object.entries(rendered)) {
      const before = artifacts.read(name, { required: true }), change = { path: name, before_sha256: before.sha256, before_metadata_sha256: artifacts.metadataHash(name), after: content, after_sha256: artifactContentHash(content) };
      await artifacts.withLocalEffectOwner(shadowHash(change), () => { artifacts.compareAndSwapPreservingMetadata(change); artifacts.project([name]); return { effect_status: "confirmed" }; });
    }
    if (complete) {
      const field = (text, key, value) => {
        const pattern = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*$", "gm");
        assert.equal([...text.matchAll(pattern)].length, 1, key);
        return text.replace(pattern, (_line, prefix) => prefix + key + ": " + value);
      };
      let status = artifacts.read(cyclePath + "/status.md", { required: true }).content;
      for (const [key, value] of Object.entries({ state: "VERIFYING", dor_state: "READY", scope_frozen: "true" })) status = field(status, key, value);
      const current = field(field(artifacts.read("CURRENT-STATE.md", { required: true }).content, "dor_state", "READY"),
        "first_plan_step", "All planned tasks completed; verify current product");
      for (const [name, content] of [[cyclePath + "/status.md", status], ["CURRENT-STATE.md", current]]) {
        const before = artifacts.read(name, { required: true }), change = { path: name, before_sha256: before.sha256,
          before_metadata_sha256: artifacts.metadataHash(name), after: content, after_sha256: artifactContentHash(content) };
        await artifacts.withLocalEffectOwner(shadowHash(change), () => { artifacts.compareAndSwapPreservingMetadata(change); artifacts.project([name]); return { effect_status: "confirmed" }; });
      }
      fs.writeFileSync(path.join(f.configuration.product_root, "app.mjs"), "export const value = 3;\n");
      await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext");
    }
    await operations.reload(); checkpoint("fixture current canonical plan preimage");
    const planNames = ["brief", "plan", "audit-spec", "traceability"].map(name => `${cyclePath}/${name}.md`);
    const beforePlan = artifacts.readMany(planNames, { required: planNames, includeMetadata: true }), beforeProduct = fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"));
    const beforeBranch = git("branch", "--show-current"), beforeHead = git("rev-parse", "HEAD");
    const parameters = { session: { session_id: "S001", session_branch: sessionBranch, objective },
      // Constructor proposal only: canonical entry must retain actual C001.
      cycle: { cycle_id: "C002", cycle_type: "feature", title: "unused-constructor", objective } };
    const initial = f.open().initialize({ parameters }); f.open().initialize({ parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const auth = f.authorize(); auth.global_deadline_ms += 1800000; auth.workflow_deadline_ms += 1800000; auth.max_turn_ms = 60000;
    let native = 0, reached = false;
    try {
      for (let step = 0; step < 60; step++) {
        const state = f.open().inspect();
        if (state.cursor.occurrences.some(row => row.status === "READY" && row.node_id === (complete ? "audit_select" : "task_select"))) { reached = true; break; }
        assert.ok(["RUNNING", "WAITING"].includes(state.cursor.status), "published existing entry stopped before task selection");
        const result = await f.open().step({ write: true, authorization: auth });
        assert.ok(["operation", "call", "native"].includes(result.kind), "unexpected wait before an already decided current cycle");
        if (result.kind === "native") { native++; assert.equal(result.journal_phase, "closed"); console.log(`STEP standard existing open ${mode}: Native startup allocation closed`); }
        if (result.kind === "operation") {
          const journal = f.open().readOperation(result.operation_id), last = journal.results.at(-1);
          assert.equal(last.receipt.outcome, "completed", `${journal.intent.binding_ref}: ${last.output?.observations?.reason_code ?? last.receipt.outcome}`);
          console.log(`STEP standard existing open ${mode}: ${journal.intent.binding_ref} completed`);
        }
        f.reopen();
      }
    } catch (error) {
      const diagnostic = path.join(f.base, "published-existing-open-rpc-failure.json");
      if (fs.existsSync(diagnostic)) throw Object.assign(new Error("Published existing OPEN fixture callback failed: " + JSON.parse(fs.readFileSync(diagnostic)).message, { cause: error }), { code: "PUBLISHED_EXISTING_OPEN_RPC_CALLBACK_FAILED" });
      throw error;
    }
    assert.equal(reached, true); assert.equal(native, 1); assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
    const final = f.open().inspect(), accepted = binding => final.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === binding).map(row => f.open().readOperation(row.intent.operation_id));
    for (const binding of ["session_initialize", "mode_decision", "session_git_checkpoint", "cycle_initialize", "cycle_plan_evaluate", "cycle_plan_record"]) assert.equal(accepted(binding).length, 0, binding);
    const observedEntry = accepted("cycle_entry_observe").at(-1).results.at(-1).output;
    assert.equal(observedEntry.observations.action, "owned_cycle");
    assert.equal(observedEntry.observations.creation_authorized, false); assert.equal(observedEntry.observations.implementation_authorized, false);
    const entry = accepted("cycle_entry_admit").at(-1).results.at(-1).output;
    assert.equal(entry.observations.action, "resume_cycle"); assert.equal(entry.observations.selected_cycle.cycle_id, "C001");
    assert.equal(accepted("cycle_plan_adopt").length, 0);
    const adopted = accepted("cycle_owned_resume_admit").at(-1), selected = accepted("cycle_plan_select").at(-1).results.at(-1).output;
    assert.equal(adopted.results.at(-1).output.observations.source_kind, "canonical_progress");
    assert.deepEqual(adopted.results.at(-1).output.observations.imported_completed_task_ids, complete ? ["TASK-001", "TASK-002"] : []);
    assert.equal(selected.observations.record_operation_id, adopted.operation_id);
    const phaseSource = accepted("cycle_execution_source_select").at(-1).results.at(-1).output;
    assert.equal(phaseSource.observations.implementation_authorized, false);
    assert.equal(phaseSource.observations.current_native_work_evidence, false);
    assert.equal(phaseSource.observations.current_validation_evidence, false);
    if (complete) {
      assert.equal(selected.facts.cycle_implementation_entry_required, false);
      for (const binding of ["cycle_readiness_evaluate", "cycle_implementation_enter", "cycle_task_select", "cycle_task_advance"]) assert.equal(accepted(binding).length, 0, binding);
      assert.equal(phaseSource.observations.implementation_operation_id, adopted.operation_id);
      assert.equal(phaseSource.observations.implementation_source_kind, "canonical_progress");
      assert.equal(phaseSource.facts.cycle_work_tasks_pending, false); assert.equal(phaseSource.facts.cycle_work_product_ready, true);
      const observed = accepted("cycle_canonical_resume_observe"), checks = accepted("cycle_validation_execute"), evaluated = accepted("cycle_validation_evaluate"), verified = accepted("cycle_verification_enter");
      for (const rows of [observed, checks, evaluated, verified]) assert.equal(rows.length, 1);
      assert.equal(observed[0].preview.input.implementation_operation_id, adopted.operation_id);
      assert.equal(checks[0].preview.input.work_operation_id, observed[0].operation_id);
      assert.deepEqual(checks[0].results.at(-1).output.observations.checks.map(row => [row.test_ref, row.status]), [["TEST-001", "passed"], ["TEST-002", "passed"]]);
      assert.equal(verifier.calls(), 2);
      const evaluation = evaluated[0].results.at(-1).output.observations;
      assert.deepEqual(evaluation.observed_task_ids, []); assert.deepEqual(evaluation.imported_task_ids, ["TASK-001", "TASK-002"]);
      assert.equal(evaluation.canonical_resume_source.entry_operation_id, accepted("cycle_entry_admit")[0].operation_id);
      assert.equal(verified[0].preview.input.evaluation_operation_id, evaluated[0].operation_id);
      assert.equal(verified[0].results.at(-1).output.effect_status, "confirmed"); assert.equal(verified[0].results.at(-1).output.observations.committed.length, 4);
      for (const change of verified[0].preview.prepared.plan.changes) assert.equal(artifacts.read(change.path, { required: true }).sha256, change.after_sha256);
      const afterPlan = artifacts.readMany(planNames, { required: planNames, includeMetadata: true });
      assert.deepEqual(afterPlan.slice(0, 3), beforePlan.slice(0, 3));
      assert.equal(afterPlan[3].content.startsWith(beforePlan[3].content.trimEnd()), true);
      const evidence = afterPlan[3].content.split("\n\n## Process verification evidence\n\n"); assert.equal(evidence.length, 3);
      const block = /^No lifecycle completion is inferred from these checks\.\n\n\x60{3}json\n([\s\S]+)\n\x60{3}\n$/.exec(evidence.at(-1)); assert.ok(block);
      assert.deepEqual(JSON.parse(block[1]), { evaluation_operation_id: evaluated[0].operation_id, ...evaluation });
      const call = final.cursor.occurrences.filter(row => row.node_id === "canonical_verification" && row.model_sha256 === final.record.model_sha256);
      assert.equal(call.length, 1); assert.equal(call[0].status, "COMPLETED"); assert.ok(call[0].call_entry); assert.ok(call[0].call_return);
      assert.equal(call[0].call_entry.input.implementation_operation_id, adopted.operation_id);
      assert.deepEqual(final.record.events.filter(row => ["call_enter", "call_return"].includes(row.kind) && row.occurrence_id === call[0].occurrence_id).map(row => row.kind), ["call_enter", "call_return"]);
    } else {
      const ready = accepted("cycle_readiness_evaluate").at(-1).results.at(-1).output;
      assert.equal(ready.observations.planning_source.operation_id, adopted.operation_id);
      assert.equal(accepted("cycle_implementation_enter").at(-1).results.at(-1).output.facts.cycle_implementation_started, true);
      assert.equal(phaseSource.observations.implementation_operation_id, accepted("cycle_implementation_enter").at(-1).operation_id);
      assert.deepEqual(artifacts.readMany(planNames, { required: planNames, includeMetadata: true }), beforePlan);
    }
    assert.deepEqual(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs")), beforeProduct);
    assert.deepEqual(artifacts.cycles().map(row => row.cycle_id), ["C001"]); assert.equal(git("branch", "--show-current"), beforeBranch); assert.equal(git("rev-parse", "HEAD"), beforeHead);
    assert.match(artifacts.read(cyclePath + "/status.md").content, new RegExp("^state:\\s*" + (complete ? "VERIFYING" : "IMPLEMENTING") + "\\s*$", "m"));
    assert.equal(evaluateCurrentStateConsistency({ targetRoot: root }).pass, true); assert.equal(artifacts.ownerPending(), false);
    const assets = loadStandardWorkflowAssets(); assert.equal(final.record.model_sha256, assets.source.model_sha256);
    assert.equal(assets.catalog.contract_version, "standard-workflow-catalog.v6");
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
    console.log(JSON.stringify({ published_existing_open_proof: !complete, published_existing_complete_proof: complete, mode, catalog_version: assets.catalog.contract_version, model_sha256: final.record.model_sha256,
      native_startup_diagnostics: 1, native_planner_responses: 0, native_work_responses: 0, imported_completed_tasks: complete ? 2 : 0, original_plan_and_metadata_preserved: true, actual_Node_checks: verifier?.calls() ?? 0,
      actual_entry_and_selectors: true, actual_current_dor_and_phase_entry: !complete, actual_current_complete_verification: complete, actual_entry_observation: true, observation_authorizes_creation: false, actual_common_prefix: true, initial_cycle_checkpoint_not_used: true, same_cycle_and_branch: true, unused_constructor_not_applied: true,
      product_unchanged: true, workflow_checkpoint_head_changed: git("rev-parse", "HEAD") !== beforeHead, exact_sim: true,
      native_transport: "IDENTIFIED_DOUBLE", genuine_native: "NOT_RUN", task_execution: "NOT_RUN", human_choice_and_carryover: "NOT_RUN_IN_THIS_CASE", installed_archive: "NOT_RUN" }));
  });
}
