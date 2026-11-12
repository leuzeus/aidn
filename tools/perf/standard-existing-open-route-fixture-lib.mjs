import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { taskProgressProposal } from "./cycle-task-progress-fixture-lib.mjs";
import { evaluateCurrentStateConsistency } from "./verify-current-state-consistency.mjs";

// The preimage is fixture data through real ports/CAS, not historical Native
// planning or completed work. The process executes the delivered root itself.
export async function verifyPublishedExistingOpen(check, { mixedFixture, selectedMode }) {
  for (const mode of selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) await check(`standard existing open ${mode}: published entry preserves the current plan and reaches actual implementation phase`, async () => {
    const f = mixedFixture(mode, { standardModel: true, planning: true, hostTrace: true, async answer({ params }) {
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
    for (const [name, content] of Object.entries(rendered)) {
      const before = artifacts.read(name, { required: true }), change = { path: name, before_sha256: before.sha256, before_metadata_sha256: artifacts.metadataHash(name), after: content, after_sha256: artifactContentHash(content) };
      await artifacts.withLocalEffectOwner(shadowHash(change), () => { artifacts.compareAndSwapPreservingMetadata(change); artifacts.project([name]); return { effect_status: "confirmed" }; });
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
        if (state.cursor.occurrences.some(row => row.status === "READY" && row.node_id === "task_select")) { reached = true; break; }
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
    const adopted = accepted("cycle_plan_adopt").at(-1), selected = accepted("cycle_plan_select").at(-1).results.at(-1).output;
    assert.equal(selected.observations.record_operation_id, adopted.operation_id);
    const ready = accepted("cycle_readiness_evaluate").at(-1).results.at(-1).output;
    assert.equal(ready.observations.planning_source.operation_id, adopted.operation_id);
    assert.equal(accepted("cycle_implementation_enter").at(-1).results.at(-1).output.facts.cycle_implementation_started, true);
    assert.deepEqual(artifacts.readMany(planNames, { required: planNames, includeMetadata: true }), beforePlan);
    assert.deepEqual(fs.readFileSync(path.join(f.configuration.product_root, "app.mjs")), beforeProduct);
    assert.deepEqual(artifacts.cycles().map(row => row.cycle_id), ["C001"]); assert.equal(git("branch", "--show-current"), beforeBranch); assert.equal(git("rev-parse", "HEAD"), beforeHead);
    assert.match(artifacts.read(cyclePath + "/status.md").content, /^state:\s*IMPLEMENTING\s*$/m);
    assert.equal(evaluateCurrentStateConsistency({ targetRoot: root }).pass, true); assert.equal(artifacts.ownerPending(), false);
    const assets = loadStandardWorkflowAssets(); assert.equal(final.record.model_sha256, assets.source.model_sha256);
    assert.equal(assets.catalog.contract_version, "standard-workflow-catalog.v5");
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
    console.log(JSON.stringify({ published_existing_open_proof: true, mode, catalog_version: assets.catalog.contract_version, model_sha256: final.record.model_sha256,
      native_startup_diagnostics: 1, native_planner_responses: 0, native_work_responses: 0, imported_completed_tasks: 0, canonical_plan_and_metadata_preserved: true,
      actual_entry_selector_dor_and_phase: true, actual_entry_observation: true, observation_authorizes_creation: false, actual_common_prefix: true, initial_cycle_checkpoint_not_used: true, same_cycle_and_branch: true, unused_constructor_not_applied: true,
      product_unchanged: true, workflow_checkpoint_head_changed: git("rev-parse", "HEAD") !== beforeHead, exact_sim: true,
      native_transport: "IDENTIFIED_DOUBLE", genuine_native: "NOT_RUN", task_execution: "NOT_RUN", human_choice_and_carryover: "NOT_CONNECTED", installed_archive: "NOT_RUN" }));
  });
}
