import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { artifactContentHash, artifactMetadataHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { CYCLE_TASK_WORK_CONTRACT } from "../../src/core/workflow/standard-cycle-work.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { taskProgressProposal, taskProgressValidationProfile } from "./cycle-task-progress-fixture-lib.mjs";
import { evaluateCurrentStateConsistency } from "./verify-current-state-consistency.mjs";

// The canonical plan is fixture arrangement, never historical Native work.
// The host loads the delivered model; this case does not alter its graph.
export async function verifyPublishedExistingOpenWork(check, { mixedFixture, selectedMode }) {
  for (const mode of selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) await check(`standard existing open work ${mode}: delivered root executes two owned current-instance tasks through verification`, async () => {
    let root, diagnostics = 0, work = 0;
    const f = mixedFixture(mode, { standardModel: true, planning: true, readiness: true, work: true, validation: true,
      taskProgress: true, taskFinalValue: 3, hostTrace: true, async answer({ params }) {
        let stage = "context";
        try {
          const observed = JSON.parse(params.input[0].text.split("\n").at(-1)), context = observed.context;
          if (context.contract_version === "standard-drift-context.v2") {
            assert.equal(diagnostics, 0); assert.equal(work, 0); diagnostics++;
            return { outcome: "completed", summary: "Exact startup diagnostic through an identified transport double", report: {
              contract_version: "standard-drift-report.v1", context_sha256: observed.context_sha256,
              original_objective: context.original_objective, current_objective: context.original_objective,
              drift_level: "none", objective_changed: false, changes: [], keep: ["Current canonical scope"], discard: [],
              split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" },
              recommendation: "continue", rationale: "Fixture wire; completion remains an actual host operation", evidence_refs: observed.evidence_refs } };
          }
          assert.equal(context.contract_version, "standard-cycle-task-work-context.v1", "owned work must not launch a planner or auditor");
          assert.equal(context.task_ordinal, work + 1); assert.ok([1, 2].includes(context.task_ordinal));
          const before = context.task_ordinal, value = before + 1;
          assert.equal(fs.readFileSync(path.join(root, "product/app.mjs"), "utf8"), `export const value = ${before};\n`);
          stage = "native_write_admission";
          const request = { tool_name: "apply_patch", cwd: root, tool_input: { command: `*** Begin Patch\n*** Update File: product/app.mjs\n@@\n-export const value = ${before};\n+export const value = ${value};\n*** End Patch` } };
          const admission = await preWriteAdmit({ targetRoot: root, skill: "start-session", nativeRequest: request });
          assert.equal(admission.write_decision.outcome, "allow", JSON.stringify(admission.write_decision));
          stage = "product_write";
          fs.writeFileSync(path.join(root, "product/app.mjs"), `export const value = ${value};\n`); work++;
          return { outcome: "completed", summary: "Observed task work from the owned canonical source", report: {
            contract_version: CYCLE_TASK_WORK_CONTRACT, context_sha256: observed.context_sha256,
            task_id: context.task.id, task: context.task.task, work_outcome: "changed",
            changes: [{ path: "product/app.mjs", operation: "update" }], notes: ["Validation and advancement remain separate host operations"] } };
        } catch (error) {
          fs.writeFileSync(path.join(f.base, "published-existing-work-rpc-failure.json"), JSON.stringify({ stage, name: error.name,
            code: error.code ?? null, message: String(error.message).slice(0, 4096), stack: String(error.stack).slice(0, 4096) }, null, 2) + "\n");
          throw error;
        }
      } });
    root = f.configuration.target_root;
    const assets = loadStandardWorkflowAssets(); assert.equal(shadowHash(f.model), assets.source.model_sha256);
    const verifier = taskProgressValidationProfile(f.base, false); f.validationProfile = verifier.profileRef;
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), operations = createStandardWorkflowOperations({ targetRoot: root });
    const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args], { encoding: "utf8", windowsHide: true }).trim();
    const checkpoint = message => { git("add", "."); git("commit", "--allow-empty", "-m", message); };
    const apply = async (prepared, method) => { assert.equal(prepared.can_apply, true); assert.equal((await operations[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed"); };
    const objective = "Execute current canonical tasks through the delivered STANDARD entry", sessionBranch = "S001-existing-work";
    await apply(await operations.prepareSession({ session_id: "S001", session_branch: sessionBranch, objective }), "initializeSession");
    await apply(await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode"); checkpoint("fixture existing work session");
    await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture existing work context");
    await apply(await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "existing-work", objective,
      continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: sessionBranch }), "initializeCycle");
    const cyclePath = "cycles/C001-feature-existing-work", proposal = taskProgressProposal(cyclePlanProposal({ context_sha256: "a".repeat(64), context: {
      session_id: "S001", cycle_id: "C001", cycle_type: "feature", original_objective: objective, mode: "COMMITTING", allowed_product_files: ["product/app.mjs"] },
      evidence_refs: [{ ref: "audit:SPEC.md", sha256: artifacts.read("SPEC.md", { required: true }).sha256 }] }));
    const rendered = renderStandardCyclePlan(proposal, cyclePath, { "brief.md": artifacts.read(cyclePath + "/brief.md", { required: true }).content });
    for (const [name, content] of Object.entries(rendered)) {
      const before = artifacts.read(name, { required: true }), change = { path: name, before_sha256: before.sha256, before_metadata_sha256: artifacts.metadataHash(name), after: content, after_sha256: artifactContentHash(content) };
      await artifacts.withLocalEffectOwner(shadowHash(change), () => { artifacts.compareAndSwapPreservingMetadata(change); artifacts.project([name]); return { effect_status: "confirmed" }; });
    }
    await operations.reload(); checkpoint("fixture current canonical two-task plan");
    const originalPlan = artifacts.read(cyclePath + "/plan.md").content, originalScope = originalPlan.split("## Native write scope")[1].split("```")[1];
    const stableNames = ["brief", "audit-spec", "traceability"].map(name => `${cyclePath}/${name}.md`), beforeStable = artifacts.readMany(stableNames, { required: stableNames, includeMetadata: true });
    const readTraceMetadata = () => {
      if (!artifacts.describe().database) return null;
      const store = createProjectArtifactStore({ targetRoot: root, readOnly: true, existingOnly: true });
      try {
        const row = store.getArtifact(stableNames[2]); assert.ok(row);
        return Object.fromEntries(["kind", "family", "subtype", "gate_relevance", "classification_reason", "session_id", "cycle_id",
          "source_mode", "entity_confidence", "legacy_origin", "updated_at"].map(key => [key, row[key] ?? null]));
      } finally { store.close(); }
    };
    const beforeTraceMetadata = readTraceMetadata();
    assert.equal(beforeTraceMetadata === null ? null : artifactMetadataHash(beforeTraceMetadata), beforeStable[2].metadata_sha256);
    if (beforeTraceMetadata !== null) fs.writeFileSync(path.join(f.base, "published-existing-work-metadata-preimage.json"),
      JSON.stringify({ mode, path: stableNames[2], metadata_sha256: beforeStable[2].metadata_sha256, metadata: beforeTraceMetadata }, null, 2) + "\n", { flag: "wx" });
    const beforeBranch = git("branch", "--show-current"), beforeHead = git("rev-parse", "HEAD");
    const parameters = { session: { session_id: "S001", session_branch: sessionBranch, objective },
      cycle: { cycle_id: "C002", cycle_type: "feature", title: "unused-constructor", objective } };
    const initial = f.open().initialize({ parameters });
    assert.equal(initial.record.model_sha256, assets.source.model_sha256);
    f.open().initialize({ parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const auth = f.authorize(); assert.equal(auth.max_responses, 6); assert.equal(auth.max_bytes, 10 * 1024 * 1024); auth.global_deadline_ms += 1800000; auth.workflow_deadline_ms += 1800000; auth.max_turn_ms = 60000;
    let native = 0, reached = false;
    try {
      for (let step = 0; step < 120; step++) {
        const state = f.open().inspect();
        if (state.cursor.occurrences.some(row => row.status === "READY" && row.node_id === "audit_select")) { reached = true; break; }
        assert.ok(["RUNNING", "WAITING"].includes(state.cursor.status), "delivered existing work stopped before verification return");
        const result = await f.open().step({ write: true, authorization: auth });
        assert.ok(["operation", "call", "native"].includes(result.kind), "unexpected human wait for an already decided cycle");
        if (result.kind === "native") { native++; assert.equal(result.journal_phase, "closed"); console.log(`STEP standard existing open work ${mode}: Native allocation ${native} closed`); }
        if (result.kind === "operation") {
          const journal = f.open().readOperation(result.operation_id), last = journal.results.at(-1);
          assert.equal(last.receipt.outcome, "completed", `${journal.intent.binding_ref}: ${last.output?.observations?.reason_code ?? last.receipt.outcome}`);
          console.log(`STEP standard existing open work ${mode}: ${journal.intent.binding_ref} completed`);
        }
        f.reopen();
      }
    } catch (error) {
      const diagnostic = path.join(f.base, "published-existing-work-rpc-failure.json");
      if (fs.existsSync(diagnostic)) { const detail = JSON.parse(fs.readFileSync(diagnostic)); throw Object.assign(new Error(`Published existing work failed at ${detail.stage}: ${detail.message}`, { cause: error }), { code: "PUBLISHED_EXISTING_WORK_RPC_CALLBACK_FAILED" }); }
      throw error;
    }
    assert.equal(reached, true); assert.equal(diagnostics, 1); assert.equal(work, 2); assert.equal(native, 3);
    assert.equal(f.t.sessions.length, 3); assert.ok(f.t.sessions.every(row => row.closed));
    const final = f.open().inspect(), accepted = binding => final.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === binding).map(row => f.open().readOperation(row.intent.operation_id));
    for (const binding of ["session_initialize", "mode_decision", "session_git_checkpoint", "cycle_initialize", "cycle_plan_evaluate", "cycle_plan_record", "cycle_audit_select"]) assert.equal(accepted(binding).length, 0, binding);
    assert.equal(accepted("cycle_plan_adopt").length, 0);
    const owned = accepted("cycle_owned_resume_admit"); assert.equal(owned.length, 1);
    const ownedSource = owned[0].results.at(-1).output;
    assert.equal(ownedSource.observations.source_kind, "canonical_progress");
    assert.deepEqual(ownedSource.observations.imported_completed_task_ids, []);
    const selected = accepted("cycle_plan_select")[0].results.at(-1).output;
    assert.equal(selected.contract_version, "standard-cycle-plan-selection-output.v2");
    assert.equal(selected.observations.record_operation_id, owned[0].operation_id);
    assert.equal(accepted("cycle_readiness_evaluate")[0].results.at(-1).output.observations.planning_source.operation_id, owned[0].operation_id);
    const phaseSelection = accepted("cycle_execution_source_select"); assert.equal(phaseSelection.length, 1);
    const phase = phaseSelection[0].results.at(-1).output;
    assert.equal(phase.observations.implementation_source_kind, "implementation_entry");
    assert.equal(phase.observations.implementation_operation_id, accepted("cycle_implementation_enter")[0].operation_id);
    assert.equal(phase.observations.implementation_authorized, false);
    assert.equal(phase.observations.current_native_work_evidence, false);
    assert.equal(phase.observations.current_validation_evidence, false);
    const advances = accepted("cycle_task_advance"); assert.equal(advances.length, 2);
    assert.deepEqual(advances.map(row => row.results.at(-1).output.observations.task_id), proposal.tasks.map(row => row.id));
    assert.deepEqual(advances.map(row => row.results.at(-1).output.facts.cycle_tasks_finished), [false, true]);
    assert.equal(advances[1].results.at(-1).output.observations.previous_progress_operation_id, advances[0].operation_id);
    const validations = accepted("cycle_validation_execute").map(row => row.results.at(-1).output);
    assert.deepEqual(validations.map(row => row.observations.checks.map(check => check.test_ref)), [["TEST-001"], ["TEST-001", "TEST-002"]]);
    assert.ok(validations.every(row => row.observations.checks.every(check => check.status === "passed")));
    assert.equal(verifier.calls(), 3);
    const lastEvaluation = accepted("cycle_validation_evaluate").at(-1).results.at(-1).output;
    assert.equal(lastEvaluation.facts.cycle_work_complete, true); assert.equal(lastEvaluation.facts.cycle_checks_passed, true); assert.deepEqual(lastEvaluation.observations.pending_test_refs, []);
    assert.equal(accepted("cycle_verification_enter").at(-1).results.at(-1).output.facts.cycle_verification_started, true);
    assert.equal(artifacts.read(cyclePath + "/plan.md").content.split("## Native write scope")[1].split("```")[1], originalScope);
    const afterStable = artifacts.readMany(stableNames, { required: stableNames, includeMetadata: true });
    assert.deepEqual(afterStable.slice(0, 2), beforeStable.slice(0, 2));
    const afterTraceMetadata = readTraceMetadata();
    if (beforeTraceMetadata !== null) fs.writeFileSync(path.join(f.base, "published-existing-work-metadata-postimage.json"),
      JSON.stringify({ mode, path: stableNames[2], before: beforeTraceMetadata, after: afterTraceMetadata,
        metadata_sha256: afterStable[2].metadata_sha256 }, null, 2) + "\n", { flag: "wx" });
    if (beforeTraceMetadata === null) { assert.equal(afterTraceMetadata, null); assert.equal(afterStable[2].metadata_sha256, null); }
    else {
      assert.ok(afterTraceMetadata);
      const { updated_at: beforeUpdated, ...beforeClassification } = beforeTraceMetadata;
      const { updated_at: afterUpdated, ...afterClassification } = afterTraceMetadata;
      assert.deepEqual(afterClassification, beforeClassification);
      assert.notEqual(afterUpdated, beforeUpdated); assert.ok(Number.isFinite(Date.parse(afterUpdated)));
      assert.equal(artifactMetadataHash(afterTraceMetadata), afterStable[2].metadata_sha256);
    }
    const traceParts = afterStable[2].content.split("\n\n## Process verification evidence\n\n");
    assert.equal(traceParts.length, 2); assert.equal(traceParts[0], beforeStable[2].content.trimEnd());
    const verificationEvidence = /^No lifecycle completion is inferred from these checks\.\n\n\x60{3}json\n([\s\S]+)\n\x60{3}\n$/.exec(traceParts[1]);
    assert.ok(verificationEvidence);
    assert.deepEqual(JSON.parse(verificationEvidence[1]), { evaluation_operation_id: accepted("cycle_validation_evaluate").at(-1).operation_id, ...lastEvaluation.observations });
    assert.equal(fs.readFileSync(path.join(root, "product/app.mjs"), "utf8"), "export const value = 3;\n");
    assert.match(artifacts.read(cyclePath + "/status.md").content, /^state:\s*VERIFYING\s*$/m);
    assert.deepEqual(artifacts.cycles().map(row => row.cycle_id), ["C001"]); assert.equal(git("branch", "--show-current"), beforeBranch); assert.equal(git("rev-parse", "HEAD"), beforeHead);
    assert.equal(evaluateCurrentStateConsistency({ targetRoot: root }).pass, true); assert.equal(artifacts.ownerPending(), false);
    assert.equal(final.record.model_sha256, assets.source.model_sha256);
    const verificationCalls = final.cursor.occurrences.filter(row => row.node_id === "final_verification" && row.model_sha256 === final.record.model_sha256);
    assert.equal(verificationCalls.length, 1); const verificationCall = verificationCalls[0];
    assert.equal(verificationCall.status, "COMPLETED"); assert.ok(verificationCall.call_entry); assert.ok(verificationCall.call_return);
    assert.equal(verificationCall.call_entry.input.progress_operation_id, advances[1].operation_id);
    assert.equal(verificationCall.call_entry.input.validation_operation_id, accepted("cycle_validation_execute")[1].operation_id);
    assert.deepEqual(final.record.events.filter(row => ["call_enter", "call_return"].includes(row.kind) && row.occurrence_id === verificationCall.occurrence_id).map(row => row.kind), ["call_enter", "call_return"]);
    let last, rows = 0;
    for (const row of iterateAgenticProcessSimulation({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events })) { last = row; rows++; }
    assert.equal(last.instance_sha256, final.record.instance_sha256);
    console.log(JSON.stringify({ published_existing_open_work_proof: true, mode, catalog_version: assets.catalog.contract_version, model_sha256: final.record.model_sha256,
      native_startup_diagnostics: diagnostics, native_planner_responses: 0, native_work_responses: work, imported_completed_tasks: 0,
      actual_validation_checks: verifier.calls(), actual_task_advances: advances.length, real_verification_phase: true, actual_final_verification: true,
      canonical_origin_selected: true, current_instance_progress_chain: true, original_scope_preserved: true,
      original_plan_intent_and_classification_preserved: true, trace_metadata_timestamp_refreshed: beforeTraceMetadata !== null,
      accepted_verification_evidence_appended: true,
      same_cycle_branch_and_head: true, unused_constructor_not_applied: true, owner_clear: true, exact_sim: true, simulation_rows: rows,
      native_transport: "IDENTIFIED_DOUBLE", genuine_native: "NOT_RUN", human_choice_and_carryover: "NOT_RUN_IN_THIS_CASE", installed_archive: "NOT_RUN", full_standard_workflow: false }));
  });
}
