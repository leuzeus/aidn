import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { CYCLE_TASK_WORK_CONTRACT } from "../../src/core/workflow/standard-cycle-work.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { taskProgressProposal, taskProgressValidationProfile, verifyTaskProgressExecution } from "./cycle-task-progress-fixture-lib.mjs";
import { evaluateCurrentStateConsistency } from "./verify-current-state-consistency.mjs";

// The original plan is fixture arrangement through actual canonical ports.
// It is not a historical Native result or imported completed-work proof.
export async function verifyCanonicalPlanWork(check, { mixedFixture, script }) {
  await check("canonical plan work files: accepted canonical origin executes and validates two current-instance tasks", async () => {
    let allowed = true, root;
    const grant = { authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) };
    const f = mixedFixture("files", { planning: true, readiness: true, work: true, validation: true, taskProgress: true, taskFinalValue: 3,
      authorize: async () => ({ ...grant, authorized: allowed }), async answer({ params }) {
        let stage = "context";
        try {
        const observed = JSON.parse(params.input[0].text.split("\n").at(-1)), context = observed.context;
        assert.equal(context.contract_version, "standard-cycle-task-work-context.v1", "canonical source must not launch a planner");
        const before = context.task_ordinal === 1 ? 1 : 2, value = context.task_ordinal === 1 ? 2 : 3;
        const request = { tool_name: "apply_patch", cwd: root, tool_input: { command: `*** Begin Patch\n*** Update File: product/app.mjs\n@@\n-export const value = ${before};\n+export const value = ${value};\n*** End Patch` } };
        stage = "native_write_admission";
        const admission = await preWriteAdmit({ targetRoot: root, skill: "start-session", nativeRequest: request });
        if (admission.write_decision.outcome !== "allow") fs.writeFileSync(path.join(f.base, "canonical-work-admission-failure.json"), JSON.stringify({
          ok: admission.ok, admission_status: admission.admission_status, blockers: admission.blockers ?? null, write_decision: admission.write_decision }, null, 2) + "\n");
        assert.equal(admission.write_decision.outcome, "allow", JSON.stringify(admission.write_decision));
        stage = "product_write";
        fs.writeFileSync(path.join(root, "product/app.mjs"), `export const value = ${value};\n`);
        return { outcome: "completed", summary: "Observed current-instance task from a canonical plan", report: { contract_version: CYCLE_TASK_WORK_CONTRACT,
          context_sha256: observed.context_sha256, task_id: context.task.id, task: context.task.task, work_outcome: "changed",
          changes: [{ path: "product/app.mjs", operation: "update" }], notes: ["Actual host validation and advancement remain separate"] } };
        } catch (error) {
          fs.writeFileSync(path.join(f.base, "canonical-work-rpc-failure.json"), JSON.stringify({ stage, name: error.name, code: error.code ?? null,
            message: String(error.message).slice(0, 4096), stack: String(error.stack).slice(0, 4096) }, null, 2) + "\n"); throw error;
        }
      } });
    root = f.configuration.target_root;
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), operations = createStandardWorkflowOperations({ targetRoot: root });
    const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args], { encoding: "utf8", windowsHide: true }).trim();
    const checkpoint = message => { git("add", "."); git("commit", "--allow-empty", "-m", message); };
    const apply = async (prepared, method) => { assert.equal(prepared.can_apply, true); assert.equal((await operations[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed"); };
    const objective = "Execute the existing canonical plan without replacing it";
    await apply(await operations.prepareSession({ session_id: "S001", session_branch: "S001-canonical-work", objective }), "initializeSession");
    await apply(await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode"); checkpoint("fixture committing canonical work session");
    await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture canonical work context");
    await apply(await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "canonical-work", objective,
      continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-canonical-work" }), "initializeCycle");
    const cyclePath = "cycles/C001-feature-canonical-work", proposal = taskProgressProposal(cyclePlanProposal({ context_sha256: "a".repeat(64), context: {
      session_id: "S001", cycle_id: "C001", cycle_type: "feature", original_objective: objective, mode: "COMMITTING", allowed_product_files: ["product/app.mjs"] },
      evidence_refs: [{ ref: "audit:SPEC.md", sha256: artifacts.read("SPEC.md", { required: true }).sha256 }] }));
    const rendered = renderStandardCyclePlan(proposal, cyclePath, { "brief.md": artifacts.read(cyclePath + "/brief.md", { required: true }).content });
    for (const [name, content] of Object.entries(rendered)) {
      const before = artifacts.read(name, { required: true }), change = { path: name, before_sha256: before.sha256, before_metadata_sha256: artifacts.metadataHash(name), after: content, after_sha256: artifactContentHash(content) };
      await artifacts.withLocalEffectOwner(shadowHash(change), () => { artifacts.compareAndSwapPreservingMetadata(change); artifacts.project([name]); return { effect_status: "confirmed" }; });
    }
    await operations.reload(); checkpoint("fixture existing canonical two-task plan");
    const originalPlan = artifacts.read(cyclePath + "/plan.md", { required: true }).content, originalHead = git("rev-parse", "HEAD");
    const removed = new Set(["reload", "admit", "initialize", "analyze", "plan_evaluate", "plan_record"]), model = f.model;
    model.model_id = "canonical-plan-current-instance-work-fixture";
    model.nodes[0].children = ["adopt", ...model.nodes[0].children.filter(id => !removed.has(id))];
    model.nodes = model.nodes.filter(node => !removed.has(node.id));
    model.nodes.push({ id: "adopt", kind: "operation", participant_ref: "delivery", binding_ref: "cycle_plan_adopt" });
    model.roles = model.roles.filter(role => model.nodes.some(node => node.role_ref === role.id));
    model.policies = model.policies.filter(policy => model.nodes.some(node => node.policy_ref === policy.id));
    model.data_bindings.contract_version = "process-data-bindings.v4";
    model.data_bindings.parameter_keys = [];
    model.data_bindings.inputs = model.data_bindings.inputs.filter(row => !removed.has(row.node_id));
    model.data_bindings.inputs.push({ node_id: "adopt", fields: {} });
    model.data_bindings.inputs.find(row => row.node_id === "readiness_evaluate").fields.record_operation_id = { source: "operation_id", node_id: "adopt" };
    model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(binding => model.nodes.some(node => node.binding_ref === binding.id)).map(binding => [binding.id, shadowHash(binding)]));
    const bytes = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, bytes); f.configuration.model.sha256 = artifactContentHash(bytes);
    f.configuration.activity_outputs = { implement: CYCLE_TASK_WORK_CONTRACT }; f.configuration.instructions = { implement: f.configuration.instructions.implement };
    const verifier = taskProgressValidationProfile(f.base, false); f.validationProfile = verifier.profileRef;
    const initial = f.open().initialize(); f.open().initialize({ write: true, expectedResultSha256: initial.record.instance_sha256 });
    const adopted = await f.open().step({ write: true }), ready = await f.open().step({ write: true }), phase = await f.open().step({ write: true });
    assert.equal(f.open().readOperation(adopted.operation_id).results.at(-1).output.facts.canonical_cycle_plan_available, true);
    assert.equal(f.open().readOperation(ready.operation_id).results.at(-1).output.observations.planning_source.operation_id, adopted.operation_id);
    assert.equal(f.open().readOperation(phase.operation_id).results.at(-1).output.facts.cycle_implementation_started, true);
    assert.match(artifacts.read("CURRENT-STATE.md").content, new RegExp("^first_plan_step: " + proposal.tasks[0].task + "$", "m"));
    assert.equal(evaluateCurrentStateConsistency({ targetRoot: root }).pass, true);
    assert.equal(f.t.sessions.length, 0); assert.equal(artifacts.read(cyclePath + "/plan.md").content, originalPlan);
    const auth = f.authorize(); auth.global_deadline_ms += 1800000; auth.workflow_deadline_ms += 1800000; auth.max_turn_ms = 60000;
    try {
      await verifyTaskProgressExecution({ f, artifacts, cyclePath, selected: "files", auth, verifier, script, planningNativeResponses: 0, setAllowed: value => { allowed = value; } });
    } catch (error) {
      const file = path.join(f.base, "canonical-work-rpc-failure.json");
      if (fs.existsSync(file)) { const diagnostic = JSON.parse(fs.readFileSync(file)); throw Object.assign(new Error(`Canonical work fixture callback failed at ${diagnostic.stage}: ${diagnostic.message}`, { cause: error }), { code: "CANONICAL_WORK_FIXTURE_RPC_CALLBACK_FAILED" }); }
      throw error;
    }
    const final = f.reopen().inspect(), intents = final.record.events.filter(row => row.kind === "operation_intent");
    assert.equal(intents.filter(row => ["cycle_plan_evaluate", "cycle_plan_record"].includes(row.intent.binding_ref)).length, 0);
    assert.equal(final.record.events.filter(row => row.kind === "result").length, 2); assert.equal(git("rev-parse", "HEAD"), originalHead);
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
    console.log(JSON.stringify({ canonical_plan_work_proof: true, mode: "files", native_planner_responses: 0, native_work_responses: 2, imported_completed_tasks: 0,
      actual_validation_checks: verifier.calls(), actual_task_advances: 2, real_verification_phase: true, actual_cold_task_advance: true, original_scope_preserved: true, exact_sim: true,
      native_transport: "IDENTIFIED_DOUBLE", genuine_native: "NOT_RUN", published_existing_cycle_route: "NOT_CONNECTED", installed_archive: "NOT_RUN" }));
  });
}
