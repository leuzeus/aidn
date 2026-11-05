import assert from "node:assert/strict";
import fs from "node:fs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { observeModeWorkReport } from "../../src/core/workflow/standard-mode-work-continuation.mjs";
import { assertSpikeQuestion, assertHumanSpikeDecision, observeHumanSpikeDecision, assertSpikeDecisionOutput, spikeConversionChoices } from "../../src/core/workflow/standard-spike-decision.mjs";
import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { createProcessDecisionInboxStore } from "../../src/adapters/runtime/process-decision-inbox-store.mjs";
import { assertDecisionInbox, decisionInboxId } from "../../src/core/workflow/process-decision-inbox.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";
import { runConvertToSpikeCompletionAdmitUseCase } from "../../src/application/runtime/convert-to-spike-admit-use-case.mjs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";

const H = "a".repeat(64), ref = { ref: "fixture:spike-result", sha256: H }, roots = [];
const storage = process.argv.find(value => value.startsWith("--mode="))?.split("=")[1] ?? "files";
if (!["files", "dual", "db-only"].includes(storage)) throw Error("SPIKE_FIXTURE_MODE_INVALID");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
const context = { session_id: "S001", mode: "EXPLORING", objective: "Measure a bounded experimental behavior", product_sha256: H,
  git: { head: "b".repeat(40), branch: "S001-spike" }, preflight_operation_id: "op_" + "b".repeat(40) };
const report = { contract_version: "standard-mode-work-report.v1", context_sha256: shadowHash(context), mode: "EXPLORING", objective: context.objective,
  disposition: "retain_requested", findings: ["Bounded finding"], rationale: "Fixture request only", evidence_refs: [ref] };
const analysis = observeModeWorkReport({ report, reference: ref, producer: { instance_id: "fixture", model_sha256: H, occurrence_id: "analysis", result_id: "result" } },
  { context, context_sha256: shadowHash(context), evidence_refs: [ref] }).observations.review;
const review = { contract_version: "standard-spike-review.v1", analysis, inventory_sha256: H, minimum_cycle_number: 7, continuity_sha256: H, session_sha256: H, current_sha256: H };
const question = assertSpikeQuestion({ contract_version: "standard-spike-question.v1", operation_id: "op_" + "c".repeat(40), instance_id: "fixture", scope_id: "scope",
  occurrence_id: "spike_decision", intent_sha256: H, session_id: "S001", review_operation_id: "op_" + "d".repeat(40), review, choices: [...spikeConversionChoices] });
const selection = { cycle_id: "C007", title: "bounded-learning", learning_goal: context.objective, timebox: "30 minutes", decision_target: "Retain only after observed experiment review", chosen_mode: "EXPLORING", branch_action: "recommend" };
const source = choice => ({ contract_version: "human-spike-decision.v1", source_kind: "human", authority_id: "fixture_user", source_event_id: "spike-" + choice,
  question_sha256: shadowHash(question), subject_sha256: shadowHash(review), choice, selection: choice === "convert-to-spike" ? selection : null, rationale: "Explicit fixture choice", evidence_refs: [ref] });
for (const choice of spikeConversionChoices) {
  const decision = source(choice), observed = observeHumanSpikeDecision({ question, decision });
  const output = assertSpikeDecisionOutput({ contract_version: "standard-spike-decision-output.v1", operation_ref: "spike_conversion_decision", ...observed,
    observations: { ...observed.observations, inbox_id: decisionInboxId(decision), source_ref: "fixture:selected" }, evidence_refs: [ref] });
  assertStandardOperationOutput(output);
  assert.equal(output.observations.retention_authorized, false); assert.equal(output.observations.native_authority_renewed, false);
  if (choice !== "convert-to-spike") assert.deepEqual(output.facts, {});
}
assert.throws(() => assertHumanSpikeDecision({ ...source("convert-to-spike"), selection: { ...selection, cycle_id: "C006" } }, question), { code: "STANDARD_SPIKE_CYCLE_ALREADY_EXISTS" });
assert.throws(() => assertHumanSpikeDecision({ ...source("convert-to-spike"), question_sha256: "f".repeat(64) }, question), { code: "PROCESS_HUMAN_QUESTION_CHANGED" });
assert.throws(() => assertHumanSpikeDecision({ ...source("convert-to-spike"), selection: { ...selection, chosen_mode: "COMMITTING" } }, question), { code: "STANDARD_SPIKE_SELECTION_INVALID" });
// Composed schemas retain input validation without embedding root declarations.
for (const name of ["initialize", "finalize"]) {
  const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-spike-${name}-plan.v1.schema.json`, import.meta.url), "utf8"));
  assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
}
console.log(JSON.stringify({ contract_checks: "PASS", proof_scope: "typed fixture claims; no human authentication or business effect from schema" }));
try {
  for (const [chosen_mode, branch_action] of [["EXPLORING", "recommend"], ["EXPLORING", "create"], ["COMMITTING", "create"]]) {
    const root = createFreshStandardWorkflowFixture(storage, roots), operations = createStandardWorkflowOperations({ targetRoot: root });
    let prepared = await operations.prepareSession({ session_id: "S001", session_branch: "S001-spike", objective: context.objective });
    assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    prepared = await operations.prepareMode({ session_id: "S001", mode: "EXPLORING" });
    assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    git(root, "add", "."); git(root, "-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture admitted session");
    const head = git(root, "rev-parse", "HEAD"), admitted = await operations.admitCycle(); assert.equal(admitted.outcome, "completed");
    const choice = { ...selection, chosen_mode, branch_action }, lifecycle = admitted.observations.lifecycle;
    prepared = await operations.prepareSpikeCycle({ session_id: "S001", cycle_id: choice.cycle_id, cycle_type: "spike", title: choice.title, objective: choice.learning_goal,
      continuity_rule: lifecycle.continuity_rule, base_branch: lifecycle.continuity_base_branch }, choice);
    assert.equal(prepared.can_apply, true); assert.equal(prepared.plan.contract_version, "standard-cycle-initialize-plan.v3");
    await assert.rejects(operations.initializeCycle(prepared, { expectPlan: prepared.plan_sha256 }), { code: "STANDARD_EXPLICIT_EFFECT_REQUIRED" });
    const result = await operations.initializeCycle(prepared, { write: true, expectPlan: prepared.plan_sha256 });
    assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.effect_status, "confirmed");
    assert.equal((await runConvertToSpikeCompletionAdmitUseCase({ targetRoot: root, cycleId: choice.cycle_id })).ok, true);
    assert.equal((await runConvertToSpikeCompletionAdmitUseCase({ targetRoot: root, cycleId: "C999" })).ok, false);
    assert.equal(git(root, "rev-parse", "HEAD"), head);
    assert.equal(git(root, "branch", "--show-current"), branch_action === "recommend" ? "S001-spike" : "spike/C007-bounded-learning");
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
    assert.equal(parseSessionMetadata(artifacts.read("sessions/S001.md").content).mode, chosen_mode);
    assert.match(artifacts.read("cycles/C007-spike-bounded-learning/brief.md").content, /Timebox: 30 minutes/);
    assert.match(artifacts.read("cycles/C007-spike-bounded-learning/decisions.md").content, /Outcome: pending experiments/);
    if (chosen_mode === "COMMITTING") { assert.equal(result.observations.audit.result.action, "audit_cycle_branch"); assert.equal(result.observations.audit.allowed, true); }
    if (branch_action === "recommend") assert.equal(result.observations.audit.branch_kind, "session");
    const signer = createOperationJournalSigner(() => Buffer.alloc(32, 7)), store = createProcessDecisionInboxStore({ targetRoot: root, stateMode: storage });
    const decision = source("convert-to-spike"), row = signer.seal({ contract_version: "process-decision-inbox.v11", inbox_id: decisionInboxId(decision),
      operation_id: question.operation_id, source_ref: "fixture:selected", source: decision, phase: "reserved", receipt_sha256: null });
    assertDecisionInbox(row); store.compareAndSwap(row, null); const retained = store.read(row.inbox_id).record; signer.verify(retained); assert.deepEqual(retained, row);
    console.log(JSON.stringify({ cycle_creation: "PASS", storage, chosen_mode, branch_action, root, canonical_cycle: choice.cycle_id, head_unchanged: true, authenticated_inbox: "fixture-HMAC",
      native_calls: 0, mixed_conversion_wrapper: "NOT_RUN", conversion_hook: "NOT_RUN", experiments: "NOT_RUN", genuine_human: "NOT_RUN" }));
  }
  const assets = loadStandardWorkflowAssets(); assert.equal(assets.model.nodes.find(row => row.id === "spike_decide").binding_ref, "spike_conversion_decision");
  assert.equal(assets.catalog.scope.complete_standard_workflow, false);
  console.log(JSON.stringify({ ok: true, retained_projects: roots, model_sha256: assets.source.model_sha256, full_standard: false }));
} catch (error) { console.error(JSON.stringify({ retained_projects: roots, code: error.code ?? null, message: error.message })); throw error; }
