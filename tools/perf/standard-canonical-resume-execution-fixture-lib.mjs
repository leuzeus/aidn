import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { verifyCanonicalCycleChoiceRecord, openCycleChoiceFixtureHost } from "./standard-cycle-choice-record-fixture-lib.mjs";
import { arrangeCanonicalResumeData } from "./standard-canonical-resume-fixture-lib.mjs";
import { taskProgressValidationProfile } from "./cycle-task-progress-fixture-lib.mjs";
import { cycleAuditProposal } from "./cycle-audit-fixture-lib.mjs";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { CYCLE_TASK_WORK_CONTRACT } from "../../src/core/workflow/standard-cycle-work.mjs";
import { createStandardProcessAuthority } from "../../src/application/runtime/standard-process-authority.mjs";
import { readAgenticProductSnapshot } from "../../src/application/runtime/agentic-process-execution-composition.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const coldScript = fileURLToPath(new URL("./verify-standard-canonical-resume-fixtures.mjs", import.meta.url)), H = "a".repeat(64);

async function verifyIntegrationOnlyRefusal({ phase, host, f, data, execute, verifier }) {
  assert.ok(["OPEN", "IMPLEMENTING"].includes(phase));
  const readiness = await execute("readiness_evaluate"); assert.equal(readiness.facts.cycle_readiness_satisfied, true);
  const sha = bytes => createHash("sha256").update(bytes).digest("hex"), index = path.resolve(data.root, data.git("rev-parse", "--git-path", "index")),
    witness = () => ({ canonical: data.canonical(), head: data.git("rev-parse", "HEAD"), refs: data.heads(),
      branch: data.git("branch", "--show-current"), index: sha(fs.readFileSync(index)), product: sha(fs.readFileSync(path.join(data.root, "product/app.mjs"))) }),
    before = witness(), state = host.inspect(), ready = state.cursor.ready[0];
  assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === ready).node_id, "implementation_enter");
  let result = null, rejection = null;
  try { result = await host.prepareOperation({ expectedSha256: state.record.instance_sha256, occurrenceId: ready }); }
  catch (error) { rejection = { code: error.code ?? null, message: error.message }; }
  const evidence = { result, rejection };
  fs.writeFileSync(path.join(f.base, "canonical-resume-integration-refusal-detail.json"), JSON.stringify(evidence, null, 2) + String.fromCharCode(10), { flag: "wx" });
  assert.equal(JSON.stringify(evidence).includes("STANDARD_CANONICAL_RESUME_INTEGRATION_ONLY"), true);
  assert.equal(host.inspect().record.instance_sha256, state.record.instance_sha256); assert.deepEqual(witness(), before);
  assert.equal(data.artifacts.ownerPending(), false); assert.equal(verifier.calls(), 0);
  assert.equal(fs.readFileSync(path.join(data.root, "product/app.mjs"), "utf8"), "export const value = 2;" + String.fromCharCode(10));
  assert.equal(host.inspectAllocations(), null); assert.equal(f.launches ?? 0, 0); assert.equal(f.t.sessions.length, 0);
  assert.equal(f.t.calls.filter(row => row.method === "turn/start").length, 0);
  const proof = { status: "PASS_INTEGRATION_ONLY_EXISTING_DOR_EFFECT_REFUSAL_NO_NATIVE", phase, intent: "integrate_now",
    root: data.root, private_root: data.privateRoot, native_base: f.base, business_unchanged: true, actual_Node_checks: 0,
    model_turns: 0, fixture_controllers: 0, fixture_sessions: 0, allocations: [], owner_pending: false,
    reason_code: "STANDARD_CANONICAL_RESUME_INTEGRATION_ONLY", genuine_native: "NOT_RUN", full_standard: false };
  fs.writeFileSync(path.join(f.base, "canonical-resume-result.json"), JSON.stringify(proof, null, 2) + String.fromCharCode(10), { flag: "wx" }); console.log(JSON.stringify(proof));
}

// Real parent/worker authorities and machine checks; controller and model are
// controlled fixture actors. Imported task completion is canonical DATA only.
export async function verifyCanonicalResumeExecution(check, { mixedFixture, selectedMode, phase = "IMPLEMENTING", intent = "import_now" }) {
  if (!selectedMode) return;
  if (!["files", "dual", "db-only"].includes(selectedMode) || !["OPEN", "IMPLEMENTING", "VERIFYING"].includes(phase)
    || !["import_now", "integrate_now"].includes(intent)) throw Error("CANONICAL_RESUME_EXECUTION_FIXTURE_SCOPE_INVALID");
  await check(`canonical resume native ${selectedMode}: ${phase} ${intent}`, async () => {
    let f, verifier, humanSourceAuthority, now = Date.now(), writes = 0, workContext = null, auditContext = null;
    const journals = [], objective = "Complete the exported value 3 requirement while preserving the value interface",
      completedResume = phase === "VERIFYING", importedTaskIds = completedResume ? ["TASK-001", "TASK-002"] : ["TASK-001"],
      currentObservedTaskIds = completedResume ? [] : ["TASK-002"], expectedNativeResponses = completedResume ? 1 : 2;
    await verifyCanonicalCycleChoiceRecord(selectedMode, { childScript: coldScript, pass: text => console.log("PASS " + text),
      checkpoint: true, activation: true, selectedCheckpoint: true, selectedFocus: true, focusCheckpoint: true,
      selectedPhase: phase, selectedCarryoverAction: intent, cycleObjective: objective,
      async arrangeBeforeBranches(data) {
        const humanSource = { read: ({ sourceRef }) => JSON.parse(fs.readFileSync(data.sourcesFile))[sourceRef] ?? null,
          verify({ source, sourceRef, question }) {
            const retained = JSON.parse(fs.readFileSync(data.sourcesFile))[sourceRef];
            return retained && shadowHash(retained) === shadowHash(source) && source.question_sha256 === shadowHash(question)
              ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" };
          } };
        humanSourceAuthority = humanSource;
        f = mixedFixture(selectedMode, { projectRoot: data.root, signingKey: fs.readFileSync(data.keyFile), now: () => now,
          planning: true, readiness: true, work: true, validation: true, taskProgress: true, taskFinalValue: 3, audit: true,
          humanSource, authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H }),
          async answer({ params }) {
            try {
            const observed = JSON.parse(params.input[0].text.split("\n").at(-1)), context = observed.context;
            if (context.contract_version === "standard-cycle-audit-context.v1") {
              assert.ok(completedResume || intent === "import_now");
              assert.deepEqual(context.imported_task_ids, importedTaskIds);
              assert.deepEqual(context.current_observed_task_ids, currentObservedTaskIds);
              assert.equal(context.validation.checks_passed, true);
              auditContext = observed; fs.writeFileSync(path.join(f.base, "canonical-resume-audit-context.json"), JSON.stringify(observed, null, 2) + "\n", { flag: "wx" });
              return { outcome: "completed", summary: "Offline fixture audit; human closure remains separate", report: cycleAuditProposal(observed) };
            }
            assert.equal(completedResume, false); assert.equal(intent, "import_now");
            assert.equal(context.contract_version, "standard-cycle-task-work-context.v1");
            assert.equal(context.task_ordinal, 2); assert.equal(context.task.id, "TASK-002");
            assert.equal(writes, 0); workContext = observed;
            fs.writeFileSync(path.join(f.base, "canonical-resume-work-context.json"), JSON.stringify(observed, null, 2) + "\n", { flag: "wx" });
            const file = path.join(data.root, "product/app.mjs");
            assert.equal(fs.readFileSync(file, "utf8"), "export const value = 2;\n");
            const admission = await preWriteAdmit({ targetRoot: data.root, skill: "start-session", nativeRequest: {
              tool_name: "apply_patch", cwd: data.root, tool_input: { command: "*** Begin Patch\n*** Update File: product/app.mjs\n@@\n-export const value = 2;\n+export const value = 3;\n*** End Patch" } } });
            fs.writeFileSync(path.join(f.base, "canonical-resume-product-write-admission.json"), JSON.stringify({ request_kind: "apply_patch", before: "export const value = 2;", after: "export const value = 3;", decision: admission.write_decision, context: admission.context, checks: admission.checks }, null, 2) + "\n", { flag: "wx" });
            assert.equal(admission.write_decision.outcome, "allow", JSON.stringify(admission.write_decision));
            fs.writeFileSync(file, "export const value = 3;\n"); writes++;
            return { outcome: "completed", summary: "Fixture work on only the pending second task", report: {
              contract_version: CYCLE_TASK_WORK_CONTRACT, context_sha256: observed.context_sha256, task_id: context.task.id, task: context.task.task,
              work_outcome: "changed", changes: [{ path: "product/app.mjs", operation: "update" }], notes: ["Host checks and task advancement remain separate"] } };
            } catch (error) {
              fs.writeFileSync(path.join(f.base, "canonical-resume-fixture-answer-failure.json"), JSON.stringify({
                code: error.code ?? null, message: String(error.message).slice(0, 4096), stack: String(error.stack).slice(0, 4096)
              }, null, 2) + "\n", { flag: "wx" }); throw error;
            }
          } });
        await arrangeCanonicalResumeData(data, { completedTaskIds: importedTaskIds });
        fs.writeFileSync(path.join(data.root, "product/app.mjs"), "export const value = " + (completedResume ? 3 : 2) + ";\n");
        data.checkpoint(completedResume ? "fixture imported completed task data and current final product" : "fixture imported first task as canonical data and intermediate product");
        const model = JSON.parse(fs.readFileSync(path.join(data.privateRoot, "fixture-model.json"))), nativeModel = f.model;
        model.model_id = "canonical-resume-native-port-fixture";
        model.participants = nativeModel.participants;
        for (const node of model.nodes) node.participant_ref = "delivery";
        const add = (id, binding_ref, fields) => {
          model.nodes[0].children.push(id); model.nodes.push({ id, kind: "operation", participant_ref: "delivery", binding_ref });
          model.data_bindings.inputs.push({ node_id: id, fields });
        }, op = node_id => ({ source: "operation_id", node_id }), occurrence = node_id => ({ source: "occurrence_id", node_id });
        add("resume", "cycle_canonical_resume_admit", { focus_checkpoint_operation_id: op("focus_checkpoint") });
        if (!completedResume) {
          add("readiness_evaluate", "cycle_readiness_evaluate", { record_operation_id: op("resume") });
          add("implementation_enter", "cycle_implementation_enter", { evaluation_operation_id: op("readiness_evaluate") });
        }
        const origin = completedResume ? "resume" : "implementation_enter";
        if (completedResume) {
          add("observe_product", "cycle_canonical_resume_observe", { implementation_operation_id: op(origin) });
          add("validate", "cycle_validation_execute", { work_operation_id: op("observe_product") });
          add("final_validation", "cycle_validation_evaluate", { validation_operation_id: op("validate") });
        } else {
          add("task_select", "cycle_task_select", { implementation_operation_id: op(origin) });
          model.nodes[0].children.push("implement"); model.nodes.push(structuredClone(nativeModel.nodes.find(row => row.id === "implement")));
          model.data_bindings.inputs.push({ node_id: "implement", fields: { task_operation_id: op("task_select") } });
          add("work_evaluate", "cycle_task_work_evaluate", { report_occurrence_id: occurrence("implement") });
          add("validate", "cycle_validation_execute", { work_operation_id: op("work_evaluate") });
          add("task_validation", "cycle_validation_evaluate", { validation_operation_id: op("validate") });
          add("task_advance", "cycle_task_advance", { evaluation_operation_id: op("task_validation") });
          add("final_validation", "cycle_validation_evaluate", { validation_operation_id: op("validate"), progress_operation_id: op("task_advance") });
        }
        add("verification_enter", "cycle_verification_enter", { evaluation_operation_id: op("final_validation") });
        add("audit_select", "cycle_audit_select", { implementation_operation_id: op(origin) });
        model.nodes[0].children.push("audit_review"); model.nodes.push(structuredClone(nativeModel.nodes.find(row => row.id === "audit_review")));
        model.data_bindings.inputs.push({ node_id: "audit_review", fields: { audit_operation_id: op("audit_select") } });
        add("audit_evaluate", "cycle_audit_evaluate", { report_occurrence_id: occurrence("audit_review") });
        model.roles = nativeModel.roles.filter(row => model.nodes.some(node => node.role_ref === row.id));
        model.policies = nativeModel.policies.filter(row => model.nodes.some(node => node.policy_ref === row.id));
        for (const policy of model.policies) policy.mode = "COMMITTING";
        model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(row => model.nodes.some(node => node.binding_ref === row.id)).map(row => [row.id, shadowHash(row)]));
        const bytes = JSON.stringify(model); fs.writeFileSync(path.join(data.privateRoot, "fixture-model.json"), bytes);
        fs.writeFileSync(f.configuration.model.path, bytes); f.configuration.model.sha256 = createHash("sha256").update(bytes).digest("hex");
        f.configuration.instance_id = "choice-record";
        f.configuration.activity_outputs = { ...(!completedResume ? { implement: f.configuration.activity_outputs.implement } : {}), audit_review: f.configuration.activity_outputs.audit_review };
        f.configuration.instructions = { ...(!completedResume ? { implement: f.configuration.instructions.implement } : {}), audit_review: f.configuration.instructions.audit_review };
        verifier = taskProgressValidationProfile(f.base, false); f.validationProfile = verifier.profileRef;
        fs.writeFileSync(path.join(data.privateRoot, "fixture-process.json"), JSON.stringify({ configuration: f.configuration, validation_profile: verifier.profileRef }));
        fs.writeFileSync(path.join(f.base, "canonical-resume-source.json"), JSON.stringify({ root: data.root, private_root: data.privateRoot,
          key_file: data.keyFile, sources_file: data.sourcesFile, phase, intent, imported_completed_task_ids: importedTaskIds }));
      },
      async afterRecordedChoice(data) {
        now = data.clock;
        const { root, artifacts, keyFile, sourcesFile } = data, cyclePath = "cycles/C001-feature-choice",
          traceBefore = artifacts.read(cyclePath + "/traceability.md", { required: true }).content,
          originalScope = artifacts.read(cyclePath + "/plan.md").content.split("## Native write scope")[1].split("```")[1],
          signer = createOperationJournalSigner(() => fs.readFileSync(keyFile));
        let host = f.open();
        const execute = async expectedNode => {
          const state = host.inspect(), occurrenceId = state.cursor.ready[0];
          assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId).node_id, expectedNode);
          const preview = await host.prepareOperation({ expectedSha256: state.record.instance_sha256, occurrenceId }),
            staged = await host.stageOperation(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }),
            result = await host.dispatchOperation(staged.operation_id, { write: true });
          const journal = host.readOperation(staged.operation_id); signer.verify(journal);
          assert.equal(result.receipt?.outcome, "completed", JSON.stringify({ node: expectedNode, result, output: journal.results.at(-1)?.output }));
          const cold = JSON.parse(execFileSync(process.execPath, [coldScript, "--accept-record", root, keyFile, sourcesFile, staged.operation_id, String(now)],
            { encoding: "utf8", stdio: "pipe", windowsHide: true }));
          host = f.reopen(); assert.equal(host.inspect().record.instance_sha256, cold.instance_sha256);
          const digest = shadowHash(journal), instanceSha256 = cold.instance_sha256;
          assert.equal((await host.dispatchOperation(staged.operation_id, { write: true })).status, "retained_result");
          await host.acceptOperation(staged.operation_id, { write: true });
          assert.equal(shadowHash(host.readOperation(staged.operation_id)), digest); assert.equal(host.inspect().record.instance_sha256, instanceSha256);
          journals.push(journal); console.log("STEP canonical resume native: " + expectedNode); return journal.results.at(-1).output;
        };
        for (const id of ["checkpoint", "activate", "selected_checkpoint", "selected_focus", "focus_checkpoint"]) await execute(id);
        const resumed = await execute("resume");
        assert.equal(resumed.observations.canonical_phase, phase); assert.deepEqual(resumed.observations.imported_completed_task_ids, importedTaskIds);
        assert.equal(resumed.observations.work_intent, intent === "import_now" ? "continue_implementation" : "integration_only");
        assert.equal(resumed.observations.current_native_work_evidence, false);
        if (!completedResume) {
          const productSnapshot = () => readAgenticProductSnapshot(f.configuration.product_root, f.configuration.product_files),
            sourceAuthority = createStandardProcessAuthority({ configuration: f.configuration,
              model: JSON.parse(fs.readFileSync(f.configuration.model.path)), readSigningKey: () => fs.readFileSync(keyFile),
              humanSource: humanSourceAuthority, readProductSnapshot: productSnapshot, readProductSha256: () => shadowHash(productSnapshot()) }),
            index = path.resolve(root, data.git("rev-parse", "--git-path", "index")),
            witness = () => shadowHash({ instance: host.inspect().record.instance_sha256, canonical: data.canonical(), product: productSnapshot(),
              index: createHash("sha256").update(fs.readFileSync(index)).digest("hex") }), beforeGuard = witness();
          await assert.rejects(sourceAuthority.evaluateCycleTaskSelection(host.inspect().record, { implementation_operation_id: resumed.observations.admission_operation_id }),
            { code: phase === "OPEN" ? "STANDARD_CANONICAL_RESUME_OPEN_TRANSITION_REQUIRED" : "STANDARD_CANONICAL_RESUME_IMPLEMENTATION_CHECKPOINT_REQUIRED" });
          assert.equal(witness(), beforeGuard); assert.equal(host.inspectAllocations(), null); assert.equal(f.t.sessions.length, 0);
          console.log("PASS partial canonical DATA requires the accepted DoR effect before Native task eligibility");
        }
        if (!completedResume && intent !== "import_now") {
          await verifyIntegrationOnlyRefusal({ phase, host, f, data, execute, verifier }); return;
        }
        if (!completedResume) {
          const planBeforeEntry = artifacts.read(cyclePath + "/plan.md").sha256;
          await execute("readiness_evaluate");
          const entryState = host.inspect(), entryOccurrence = entryState.cursor.ready[0],
            denied = openCycleChoiceFixtureHost(root, keyFile, sourcesFile, data.clock, { allowed: false }),
            entryIndex = path.resolve(root, data.git("rev-parse", "--git-path", "index")),
            entryWitness = () => shadowHash({ instance: host.inspect().record.instance_sha256, canonical: data.canonical(), refs: data.heads(),
              head: data.git("rev-parse", "HEAD"), index: createHash("sha256").update(fs.readFileSync(entryIndex)).digest("hex"),
              product: fs.readFileSync(path.join(root, "product/app.mjs"), "utf8"),
              journals: artifacts.observeInventory().rows.filter(row => row.path.startsWith("workflows/operation-records/"))
                .map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 })),
              journal_projection: fs.existsSync(path.join(root, "docs/audit/workflows/operation-records"))
                ? fs.readdirSync(path.join(root, "docs/audit/workflows/operation-records")).sort().map(name => ({ name,
                  sha256: createHash("sha256").update(fs.readFileSync(path.join(root, "docs/audit/workflows/operation-records", name))).digest("hex") })) : null }),
            entryBefore = entryWitness(),
            deniedPreview = await denied.preview({ instanceId: entryState.record.instance_id, expectedSha256: entryState.record.instance_sha256, occurrenceId: entryOccurrence });
          await assert.rejects(denied.stage(deniedPreview, { write: true, expectedPreviewSha256: shadowHash(deniedPreview) }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
          assert.equal(entryWitness(), entryBefore); assert.equal(artifacts.ownerPending(), false);
          assert.equal(host.inspectAllocations(), null); assert.equal(f.t.sessions.length, 0);
          console.log("PASS resumed implementation entry refuses a denied current effect grant before staging, writes or Native");
          const entered = await execute("implementation_enter");
          assert.equal(entered.effect_status, "confirmed"); assert.equal(entered.observations.committed.length, 2);
          assert.equal(artifacts.read(cyclePath + "/plan.md").sha256, planBeforeEntry);
          assert.equal(artifacts.read(cyclePath + "/traceability.md").content, traceBefore);
          assert.match(artifacts.read(cyclePath + "/status.md").content, /^state: IMPLEMENTING$/m);
          assert.equal(artifacts.read("CURRENT-STATE.md").content.split(String.fromCharCode(10)).find(line => line.startsWith("first_plan_step:")),
            "first_plan_step: " + resumed.observations.proposal.tasks[importedTaskIds.length].task);
        }
        if (completedResume) {
          const observed = await execute("observe_product");
          assert.deepEqual(observed.observations.imported_completed_task_ids, importedTaskIds);
          assert.deepEqual(observed.observations.current_observed_task_ids, []);
          assert.equal(observed.observations.current_native_work_evidence, false); assert.equal(observed.observations.work_complete, true);
        } else {
          const selected = await execute("task_select");
          assert.equal(selected.observations.task.id, "TASK-002"); assert.equal(selected.observations.ordinal, 2);
          assert.deepEqual(selected.observations.completed_task_ids, ["TASK-001"]);
          assert.deepEqual(selected.observations.imported_completed_task_ids, ["TASK-001"]);
          assert.equal(selected.observations.previous_progress_operation_id, null);
        }
        // One finite fixture grant is fixed before the first allocation, including
        // both the pending work and the later auditor. No budget renewal follows.
        const authorization = f.authorize(); authorization.global_deadline_ms += 1800000; authorization.workflow_deadline_ms += 1800000;
        authorization.max_turn_ms = 60000; authorization.max_responses = expectedNativeResponses;
        const authorizationHash = shadowHash(authorization);
        fs.writeFileSync(path.join(f.base, "canonical-resume-original-authorization.json"), JSON.stringify(authorization));
        const native = async expectedNode => {
          const state = host.inspect(); assert.equal(state.cursor.occurrences.find(row => row.occurrence_id === state.cursor.ready[0]).node_id, expectedNode);
          const result = await host.step({ write: true, authorization });
          assert.equal(result.kind, "native"); assert.equal(result.journal_phase, "closed", JSON.stringify(result));
          assert.equal(shadowHash(authorization), authorizationHash); host = f.reopen();
          console.log("STEP canonical resume native: " + expectedNode + " closed");
        };
        if (!completedResume) {
          await native("implement"); assert.equal(writes, 1); assert.ok(workContext); await execute("work_evaluate");
        }
        const checked = await execute("validate");
        assert.equal(checked.observations.proof_class, "fixture"); assert.equal(checked.facts.cycle_validation_passed, true);
        assert.deepEqual(checked.observations.checks.map(row => [row.test_ref, row.status]), [["TEST-001", "passed"], ["TEST-002", "passed"]]);
        assert.equal(verifier.calls(), 2);
        if (!completedResume) {
          await execute("task_validation"); const progress = await execute("task_advance");
          assert.equal(progress.facts.cycle_tasks_finished, true); assert.equal(progress.observations.task_id, "TASK-002");
          assert.equal(progress.observations.previous_progress_operation_id, null);
          assert.equal(artifacts.read(cyclePath + "/plan.md").content.split("## Native write scope")[1].split("```")[1], originalScope);
        }
        const finalEvaluation = await execute("final_validation");
        assert.deepEqual(finalEvaluation.observations.imported_task_ids, importedTaskIds);
        assert.deepEqual(finalEvaluation.observations.observed_task_ids, currentObservedTaskIds);
        assert.equal(finalEvaluation.facts.cycle_work_complete, true); assert.equal(finalEvaluation.facts.cycle_checks_passed, true);
        await execute("verification_enter"); assert.equal(artifacts.read(cyclePath + "/traceability.md").content.startsWith(traceBefore), true);
        await execute("audit_select"); await native("audit_review"); assert.ok(auditContext); await execute("audit_evaluate");
        const state = host.inspect(), allocations = host.inspectAllocations();
        assert.equal(state.cursor.status, "COMPLETED"); assert.equal(writes, completedResume ? 0 : 1); assert.equal(verifier.calls(), 2);
        assert.equal(f.t.sessions.length, expectedNativeResponses); assert.ok(f.t.sessions.every(row => row.closed));
        assert.equal(allocations.allocations.length, expectedNativeResponses); assert.ok(allocations.allocations.every(row => row.phase === "closed"));
        assert.equal(artifacts.ownerPending(), false); assert.match(artifacts.read(cyclePath + "/status.md").content, /^state: VERIFYING$/m);
        let last; for (const row of iterateAgenticProcessSimulation({ instanceId: state.record.instance_id, scopeId: state.record.scope_id,
          model: state.record.model, policyPins: state.record.policy_pins, events: state.record.events })) last = row;
        assert.equal(last.instance_sha256, state.record.instance_sha256);
        const proof = { status: completedResume ? "PASS_COMPLETED_CANONICAL_RESUME_REAL_AUTHORITIES_FIXTURE_NATIVE_AUDITOR" : "PASS_PARTIAL_CANONICAL_RESUME_REAL_AUTHORITIES_FIXTURE_NATIVE_ACTORS", mode: selectedMode, phase, intent,
          root, private_root: data.privateRoot, native_base: f.base, imported_task_ids: importedTaskIds, current_observed_task_ids: currentObservedTaskIds,
          product_writes: writes, actual_Node_checks: verifier.calls(), allocations: allocations.allocations.map(row => ({ generation: row.generation, owner_id: row.owner_id, phase: row.phase, consumption: row.consumption, tree_closed: row.tree_closed })),
          original_authorization_sha256: authorizationHash, instance_sha256: state.record.instance_sha256,
          model_actor: "CONTROLLED_FIXTURE", controller: "CONTROLLED_FIXTURE_INLINE_WORKER", genuine_native: "NOT_RUN", isolated_worker_process: "NOT_RUN", full_standard: false };
        fs.writeFileSync(path.join(f.base, "canonical-resume-result.json"), JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify(proof));
      } });
  });
}
