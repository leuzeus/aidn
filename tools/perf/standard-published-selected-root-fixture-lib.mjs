import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { verifyCanonicalCycleChoiceRecord } from "./standard-cycle-choice-record-fixture-lib.mjs";
import { arrangeCanonicalResumeData } from "./standard-canonical-resume-fixture-lib.mjs";
import { taskProgressValidationProfile } from "./cycle-task-progress-fixture-lib.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { evaluateCurrentStateConsistency } from "./verify-current-state-consistency.mjs";

// Canonical preconditions are DATA. The delivered root captures its own fresh
// current-question choice through an identified H port; no old choice is reused.
export async function verifyPublishedSelectedRoot(check, { mixedFixture, selectedMode }) {
  for (const mode of selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) await check("standard selected root " + mode + ": fresh choice and selected calls reach actual current verification", async () => {
    const objective = "Resume selected canonical progress through the delivered STANDARD root";
    const data = await verifyCanonicalCycleChoiceRecord(mode, { arrangeOnly: true, cycleObjective: objective,
      pass() { assert.fail("Arrangement must not execute the old choice process"); },
      async arrangeBeforeBranches(setup) {
        await arrangeCanonicalResumeData(setup);
        // The old choice-only corpus needed four documents per other cycle.
        // The delivered startup also reads the active cycle R05 documents.
        await setup.replace(["change-requests", "hypotheses", "decisions"].map(name => ["cycles/C002-feature-choice/" + name + ".md",
          setup.artifacts.read("cycles/C001-feature-choice/" + name + ".md", { required: true }).content.replaceAll("C001", "C002")]));
        fs.mkdirSync(path.join(setup.root, "product"), { recursive: true });
        fs.writeFileSync(path.join(setup.root, "product/app.mjs"), "export const value = 3;\n");
        setup.checkpoint("fixture selected product and canonical DATA");
      } });
    assert.equal(data.proof_class, "GENERATED_CANONICAL_DATA_ONLY"); assert.equal(data.workflow_initialized, false); assert.equal(data.prior_H_capture, false);
    const claims = new Map(); let native = 0, human = 0;
    const humanSource = { read: ({ sourceRef }) => claims.get(sourceRef) ?? null,
      async verify({ source, sourceRef, question }) {
        await new Promise(resolve => setImmediate(resolve));
        return claims.has(sourceRef) && shadowHash(claims.get(sourceRef)) === shadowHash(source) && source.question_sha256 === shadowHash(question)
          ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" };
      } };
    const f = mixedFixture(mode, { projectRoot: data.root, standardModel: true, validation: true, hostTrace: true, humanSource,
      async answer({ params }) {
        const observed = JSON.parse(params.input[0].text.split("\n").at(-1)), context = observed.context;
        assert.equal(context.contract_version, "standard-drift-context.v2", "Selected complete DATA must not launch a planner, writer or auditor in this case");
        return { outcome: "completed", summary: "Current startup diagnostic through an identified fixture transport", report: {
          contract_version: "standard-drift-report.v1", context_sha256: observed.context_sha256,
          original_objective: context.original_objective, current_objective: context.original_objective,
          drift_level: "none", objective_changed: false, changes: [], keep: ["Current selected canonical scope"], discard: [],
          split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" },
          recommendation: "continue", rationale: "Fixture actor only; host evidence and current checks remain separate", evidence_refs: observed.evidence_refs } };
      } });
    const git = (...args) => execFileSync("git", ["--literal-pathspecs", "--no-optional-locks", "-C", data.root, "-c", "diff.autoRefreshIndex=false", "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
    const verifier = taskProgressValidationProfile(f.base, false); f.validationProfile = verifier.profileRef;
    const sourceHead = git("rev-parse", "HEAD"), targetHead = git("rev-parse", "feature/C001-choice");
    assert.equal(fs.readFileSync(path.join(data.root, "product/app.mjs"), "utf8"), "export const value = 1;\n");
    assert.equal(git("show", "feature/C001-choice:product/app.mjs"), "export const value = 3;");
    const planNames = ["brief", "plan", "audit-spec", "traceability"].map(name => "cycles/C001-feature-choice/" + name + ".md");
    const beforePlan = data.artifacts.readMany(planNames, { required: planNames, includeMetadata: true });
    const deferredNames = ["status", "brief", "plan", "audit-spec", "traceability"].map(name => "cycles/C003-feature-choice/" + name + ".md");
    const beforeDeferred = data.artifacts.readMany(deferredNames, { required: deferredNames, includeMetadata: true });
    const parameters = { session: { session_id: "S002", session_branch: "S002-choice", objective },
      cycle: { cycle_id: "C007", cycle_type: "feature", title: "unused-selected-constructor", objective } };
    const preview = f.open().initialize({ parameters }); f.open().initialize({ parameters, write: true, expectedResultSha256: preview.record.instance_sha256 });
    const auth = f.authorize(); assert.equal(auth.max_responses, 6); assert.equal(auth.max_bytes, 10 * 1024 * 1024);
    auth.global_deadline_ms += 1800000; auth.workflow_deadline_ms += 1800000; auth.max_turn_ms = 60000;
    let reached = false, capturedQuestionHash = null;
    for (let step = 0; step < 100; step++) {
      const state = f.open().inspect();
      if (state.cursor.occurrences.some(row => row.status === "READY" && row.node_id === "audit_review" && row.model_sha256 === state.record.model_sha256)) { reached = true; break; }
      assert.ok(["RUNNING", "WAITING"].includes(state.cursor.status), "Selected root stopped before current auditor selection");
      const result = await f.open().step({ write: true, authorization: auth });
      if (result.status === "waiting_for_human") {
        assert.equal(human, 0); const journal = f.open().readOperation(result.operation_id);
        assert.equal(journal.intent.binding_ref, "cycle_entry_choice_decision");
        const question = result.question, names = ["C001", "C003", "C004", "C005", "C006"];
        const claim = { contract_version: "human-cycle-entry-choice.v1", source_kind: "human", authority_id: "fixture_operator",
          source_event_id: "fixture-selected-root-current", subject_sha256: shadowHash(question.subject), question_sha256: shadowHash(question), choice: "select_cycle",
          selection: { cycle_id: "C001", carryover_decisions: names.map(id => ({ cycle_id: id,
            action: id === "C001" ? "import_now" : id === "C003" ? "defer" : id === "C006" ? "integrate_now" : "drop",
            outcome: id === "C004" ? "NO_GO" : id === "C005" ? "DROPPED" : null, rationale: "Explicit controlled per-cycle disposition" })) },
          rationale: "Select current canonical progress; current work and validation are not inferred", evidence_refs: [{ ref: "fixture:selected-root-current", sha256: shadowHash(question.subject) }] };
        claims.set("current-selected-root", claim); capturedQuestionHash = shadowHash(question);
        await f.open().receiveDecision(result.operation_id, { write: true, sourceRef: "current-selected-root" });
        await f.open().acceptOperation(result.operation_id, { write: true }); human++;
      } else if (result.kind === "native") { native++; assert.equal(result.journal_phase, "closed"); }
      else if (result.kind === "operation") {
        const journal = f.open().readOperation(result.operation_id), last = journal.results.at(-1);
        assert.equal(last.receipt.outcome, "completed", journal.intent.binding_ref + ": " + (last.output?.observations?.reason_code ?? last.receipt.outcome));
        console.log("STEP standard selected root " + mode + ": " + journal.intent.binding_ref + " completed");
      } else assert.equal(result.kind, "call");
      f.reopen();
    }
    assert.equal(reached, true); assert.equal(human, 1); assert.equal(native, 1); assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(row => row.closed));
    const final = f.open().inspect(), accepted = binding => final.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === binding).map(row => f.open().readOperation(row.intent.operation_id));
    for (const binding of ["session_initialize", "mode_decision", "cycle_initialize", "cycle_owned_resume_admit", "cycle_plan_adopt", "cycle_plan_record", "cycle_implementation_enter", "cycle_task_advance"]) assert.equal(accepted(binding).length, 0, binding);
    const chain = ["cycle_entry_choice_decision", "cycle_entry_choice_record", "cycle_entry_choice_checkpoint", "cycle_entry_choice_activate", "cycle_entry_selected_checkpoint", "cycle_entry_selected_focus", "cycle_entry_focus_checkpoint", "cycle_canonical_resume_admit"];
    for (const binding of chain) assert.equal(accepted(binding).length, 1, binding);
    const checkpoint = accepted("cycle_entry_choice_checkpoint")[0], context = accepted("cycle_context_refresh")[0];
    assert.equal(checkpoint.preview.prepared.plan.contract_version, "standard-cycle-entry-choice-checkpoint-plan.v2");
    assert.equal(checkpoint.preview.prepared.plan.context.operation_id, context.operation_id);
    assert.equal(checkpoint.results.at(-1).output.contract_version, "standard-cycle-entry-choice-checkpoint-output.v2");
    assert.equal(checkpoint.results.at(-1).output.observations.committed_paths.includes("docs/audit/RUNTIME-STATE.md"), mode !== "db-only");
    const resume = accepted("cycle_canonical_resume_admit")[0], details = resume.results.at(-1).output.observations;
    assert.equal(details.focus_checkpoint_operation_id, accepted("cycle_entry_focus_checkpoint")[0].operation_id);
    assert.deepEqual(details.imported_completed_task_ids, ["TASK-001", "TASK-002"]);
    const selected = accepted("cycle_plan_select")[0].results.at(-1).output, phase = accepted("cycle_execution_source_select")[0].results.at(-1).output;
    assert.equal(selected.observations.record_operation_id, resume.operation_id); assert.equal(selected.facts.cycle_implementation_entry_required, false);
    assert.equal(phase.observations.implementation_operation_id, resume.operation_id); assert.equal(phase.observations.implementation_source_kind, "canonical_progress");
    for (const field of ["implementation_authorized", "current_native_work_evidence", "current_validation_evidence"]) assert.equal(phase.observations[field], false);
    assert.equal(verifier.calls(), 2); const validation = accepted("cycle_validation_execute")[0].results.at(-1).output;
    assert.deepEqual(validation.observations.checks.map(row => [row.test_ref, row.status]), [["TEST-001", "passed"], ["TEST-002", "passed"]]);
    const verified = accepted("cycle_verification_enter")[0], audit = accepted("cycle_audit_select")[0].results.at(-1).output;
    assert.equal(verified.results.at(-1).output.effect_status, "confirmed"); assert.equal(verified.results.at(-1).output.observations.committed.length, 4);
    assert.equal(audit.observations.implementation_operation_id, resume.operation_id); assert.equal(audit.observations.verification_operation_id, verified.operation_id);
    assert.deepEqual(data.artifacts.readMany(planNames.slice(0, 3), { required: planNames.slice(0, 3), includeMetadata: true }), beforePlan.slice(0, 3));
    assert.equal(data.artifacts.read(planNames[3]).content.startsWith(beforePlan[3].content.trimEnd()), true);
    assert.deepEqual(data.artifacts.readMany(deferredNames, { required: deferredNames, includeMetadata: true }), beforeDeferred);
    assert.equal(git("branch", "--show-current"), "feature/C001-choice"); assert.notEqual(git("rev-parse", "HEAD"), sourceHead);
    assert.equal(fs.readFileSync(path.join(data.root, "product/app.mjs"), "utf8"), "export const value = 3;\n");
    assert.equal(data.artifacts.ownerPending(), false); assert.equal(evaluateCurrentStateConsistency({ targetRoot: data.root }).pass, true);
    const assets = loadStandardWorkflowAssets(); assert.equal(final.record.model_sha256, assets.source.model_sha256);
    const entryObservation = accepted("cycle_entry_observe"); assert.equal(entryObservation.length, 1);
    assert.equal(entryObservation[0].results.at(-1).output.facts.cycle_entry_choice_required, true);
    assert.equal(accepted("cycle_entry_choice_decision")[0].preview.input.entry_operation_id, entryObservation[0].operation_id);
    const selectedDefinition = assets.model.nodes.filter(row => row.kind === "call" && row.target?.model_id === "aidn-standard-selected-entry");
    assert.equal(selectedDefinition.length, 1);
    const selectedCall = final.cursor.occurrences.filter(row => row.node_id === selectedDefinition[0].id && row.model_sha256 === final.record.model_sha256);
    assert.equal(selectedCall.length, 1); assert.equal(selectedCall[0].status, "COMPLETED");
    assert.ok(selectedCall[0].call_entry); assert.ok(selectedCall[0].call_return);
    assert.equal(selectedCall[0].call_entry.input.entry_operation_id, entryObservation[0].operation_id);
    assert.deepEqual(final.record.events.filter(row => ["call_enter", "call_return"].includes(row.kind) && row.occurrence_id === selectedCall[0].occurrence_id).map(row => row.kind), ["call_enter", "call_return"]);
    const replay = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(replay.trace.at(-1).instance_sha256, final.record.instance_sha256);
    console.log(JSON.stringify({ published_selected_root_proof: true, mode, model_sha256: final.record.model_sha256, root: data.root,
      source_HEAD: sourceHead, target_HEAD_before: targetHead, actual_HEAD: git("rev-parse", "HEAD"), current_question_sha256: capturedQuestionHash,
      actual_current_H_capture: 1, actual_selected_calls: chain.length, native_startup_diagnostics: native, native_work_responses: 0,
      actual_Node_checks: verifier.calls(), current_auditor_selection: true, canonical_plan_and_deferred_metadata_preserved: true,
      current_question_H: "CONTROLLED_FIXTURE_PORT", native_transport: "IDENTIFIED_DOUBLE", genuine_human: "NOT_RUN", genuine_native: "NOT_RUN",
      installed_archive: "NOT_RUN", owner_clear: true, exact_sim: true, full_standard: false }));
  });
}
