import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { fileURLToPath } from "node:url";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { runConvertToSpikeAdmitUseCase } from "./convert-to-spike-admit-use-case.mjs";
import { runSkillHookUseCase } from "./skill-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { assertModeWorkObservationOutput } from "../../core/workflow/standard-mode-work-continuation.mjs";
import { assertSpikeReview, assertSpikeDecisionOutput, spikeConversionChoices } from "../../core/workflow/standard-spike-decision.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import initializeSchema from "../../core/contracts/workflow-definition/standard-spike-initialize-plan.v1.schema.json" with { type: "json" };
import finalizeSchema from "../../core/contracts/workflow-definition/standard-spike-finalize-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-spike-output.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code, effect_status: "no_effect" }); };
const emit = (operation_ref, outcome, effect_status, observations, facts = {}, evidence_refs = []) => {
  const output = { contract_version: "standard-spike-output.v1", operation_ref, outcome, effect_status, observations, facts, evidence_refs };
  try { return assertStandardOperationOutput(output); }
  catch (cause) {
    // Bounded diagnostics preserve the failing validator, without exposing logs.
    cause.shadow_json_issue = checkShadowJson(output);
    cause.schema_issues = validateJsonSchema(output, outputSchema, "$", { contractKind: "workflow-definition" }).slice(0, 8);
    cause.observation_issues = Object.fromEntries(Object.entries(observations).map(([key, value]) => [key, checkShadowJson(value)]));
    throw cause;
  }
};
const continuity = value => Object.fromEntries(["ok", "action", "mode", "active_session", "active_cycle", "branch", "continuity_rule", "continuity_base_branch",
  "latest_active_cycle_branch", "canonical_continuity_status", "canonical_continuity_ambiguities", "planning_arbitration_status", "backlog_selected_execution_scope"].map(key => [key, value[key] ?? null]));

// All sources are trusted host capabilities. The authored model supplies only
// accepted operation IDs; it cannot supply a cycle selection or grant.
export function createStandardSpikeConversion({ targetRoot, operations, readAcceptedOperation, observeModeWork, verifyDecision, readCurrent, observeProduct, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  function retainEffect(planSha, kind, raw, summary) {
    artifacts.assertLocalEffectOwner(planSha);
    const ref = `.aidn/runtime/standard-workflow/evidence/spike-${planSha}-${kind}.json`;
    const file = agentRunPhysicalPath(path.join(root, ref), { missing: true });
    const bytes = Buffer.from(raw, "utf8");
    if (bytes.length > 4194304) fail("STANDARD_SPIKE_EVIDENCE_TOO_LARGE");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Never overwrite an earlier observation or synthesize missing raw bytes.
    const descriptor = fs.openSync(file, "wx");
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    const retained = readAgentRunFile(file, { json: false, maxBytes: 4194304 });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (retained.sha256 !== sha256) fail("STANDARD_SPIKE_EVIDENCE_CHANGED");
    return { ...summary, evidence: { ref, sha256, bytes: bytes.length } };
  }
  const active = instance => { if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_SPIKE_INSTANCE_CHANGED"); };
  const planValid = (plan, schema) => {
    const issues = validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" });
    if (issues.length) throw Object.assign(Error("STANDARD_SPIKE_PLAN_INVALID"), { code: "STANDARD_SPIKE_PLAN_INVALID", effect_status: "no_effect", issues });
    return plan;
  };
  const explicit = (prepared, write, expected) => {
    if (write !== true || !prepared?.can_apply || prepared.plan_sha256 !== expected || shadowHash(prepared.plan) !== expected) fail("STANDARD_EXPLICIT_EFFECT_REQUIRED");
    if (!Number.isSafeInteger(prepared.plan?.prepared_at_ms) || prepared.plan.prepared_at_ms < 0) fail("STANDARD_EXPLICIT_EFFECT_REQUIRED");
  };
  function analysis(instance, id) {
    const accepted = readAcceptedOperation(instance, id, "mode_work_observe"), output = assertModeWorkObservationOutput(accepted.output);
    const fresh = observeModeWork(instance, accepted.record.preview.input);
    if (shadowHash(fresh) !== shadowHash(output)) fail("STANDARD_SPIKE_ANALYSIS_STALE");
    return { accepted, review: output.observations.review };
  }
  async function admission() {
    const prewrite = await preWriteAdmit({ targetRoot: root, skill: "convert-to-spike" });
    const lifecycle = await runConvertToSpikeAdmitUseCase({ targetRoot: root, mode: "EXPLORING" });
    return { prewrite, lifecycle, allowed: prewrite.ok === true && prewrite.activation?.active === true
      && ["admitted", "admitted_with_warnings"].includes(prewrite.admission_status) && lifecycle.ok === true };
  }
  async function prepareDecision(instance, input) {
    assertStandardOperationInput("spike_conversion_decision", input); active(instance);
    const before = analysis(instance, input.review_operation_id);
    if (before.review.mode !== "EXPLORING" || before.review.report.disposition !== "retain_requested") fail("STANDARD_SPIKE_RETENTION_REQUEST_REQUIRED");
    const admitted = await admission(); active(instance);
    if (!admitted.allowed) fail("STANDARD_SPIKE_ADMISSION_BLOCKED");
    const inventory = artifacts.cycles().map(row => ({ cycle_id: row.cycle_id, path: row.path, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(row.path) }));
    const minimum = Math.max(0, ...inventory.map(row => Number(row.cycle_id.slice(1)))) + 1;
    const session = artifacts.sessions().find(row => row.session_id === before.review.session_id), current = artifacts.read("CURRENT-STATE.md", { required: true });
    if (!session || parseSessionMetadata(session.content).mode !== "EXPLORING"
      || shadowHash(analysis(instance, input.review_operation_id).review) !== shadowHash(before.review)) fail("STANDARD_SPIKE_ANALYSIS_STALE");
    const review = assertSpikeReview({ contract_version: "standard-spike-review.v1", analysis: before.review,
      inventory_sha256: shadowHash(inventory), minimum_cycle_number: minimum, continuity_sha256: shadowHash(continuity(admitted.lifecycle)),
      session_sha256: session.sha256, current_sha256: current.sha256 });
    return { review, choices: [...spikeConversionChoices] };
  }
  async function assertFresh(instance, input, prepared) {
    if (shadowHash(await prepareDecision(instance, input)) !== shadowHash(prepared)) fail("STANDARD_SPIKE_REVIEW_STALE");
  }
  async function selected(instance, input) {
    const source = readAcceptedOperation(instance, input.decision_operation_id, "spike_conversion_decision");
    const output = assertSpikeDecisionOutput(source.output);
    if (output.outcome !== "completed" || output.facts.spike_conversion_requested !== true) fail("STANDARD_SPIKE_DECISION_REQUIRED");
    await verifyDecision(source.record);
    await assertFresh(instance, source.record.preview.input, source.record.preview.prepared);
    return { source, selection: output.observations.selection, review: source.record.preview.prepared.review, decision_sha256: shadowHash(source) };
  }
  async function prepareInitialize(instance, input, at = now()) {
    assertStandardOperationInput("spike_cycle_initialize", input); active(instance);
    const decision = await selected(instance, input), admitted = await operations.admitCycle(); active(instance);
    if (admitted.outcome !== "completed") return { can_apply: false, admission: admitted };
    const lifecycle = admitted.observations.lifecycle, selection = decision.selection;
    const inner = await operations.prepareSpikeCycle({ session_id: decision.review.analysis.session_id, cycle_id: selection.cycle_id, cycle_type: "spike",
      title: selection.title, objective: selection.learning_goal, continuity_rule: lifecycle.continuity_rule, base_branch: lifecycle.continuity_base_branch }, selection, at);
    if (!inner.can_apply) return { can_apply: false, admission: inner };
    if ((await selected(instance, input)).decision_sha256 !== decision.decision_sha256) fail("STANDARD_SPIKE_DECISION_CHANGED");
    const plan = planValid({ contract_version: "standard-spike-initialize-plan.v1", input, prepared_at_ms: at,
      decision_sha256: decision.decision_sha256, review: decision.review, inner }, initializeSchema);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function initialized(instance, input) {
    const source = readAcceptedOperation(instance, input.initialize_operation_id, "spike_cycle_initialize");
    if (source.output.effect_status !== "confirmed" || source.output.facts.spike_cycle_initialized !== true) fail("STANDARD_SPIKE_INITIALIZED_SOURCE_REQUIRED");
    const inner = source.record.preview.prepared.plan.inner.plan, selection = inner.spike_selection;
    const session = artifacts.read(inner.session_path, { required: true }), current = artifacts.read("CURRENT-STATE.md", { required: true });
    const fields = analyzeStructuredArtifact(current.content).key_values;
    if (parseSessionMetadata(session.content).mode !== selection.chosen_mode || fields.mode !== selection.chosen_mode || fields.active_cycle !== selection.cycle_id
      || inner.changes.some(change => artifacts.read(change.path).sha256 !== change.after_sha256)) fail("STANDARD_SPIKE_POSTIMAGE_CHANGED");
    return { source, inner, selection };
  }
  const postimages = source => shadowHash(source.inner.changes.map(row => [row.path, artifacts.read(row.path).sha256, artifacts.metadataHash(row.path)]));
  async function prepareFinalize(instance, input) {
    assertStandardOperationInput("spike_conversion_finalize", input); active(instance);
    const source = initialized(instance, input), context = operations.observeScope();
    const plan = planValid({ contract_version: "standard-spike-finalize-plan.v1", input, prepared_at_ms: now(), source_sha256: shadowHash(source.source),
      selection: source.selection, branch: context.branch, head: context.head, state_mode: context.persistence.state_mode,
      postimages_sha256: postimages(source) }, finalizeSchema);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepareDecision, assertFresh, prepareInitialize, prepareFinalize,
    async admit(instance, input) {
      assertStandardOperationInput("spike_conversion_admit", input); active(instance);
      const source = analysis(instance, input.review_operation_id), requested = source.review.mode === "EXPLORING" && source.review.report.disposition === "retain_requested";
      const admitted = requested ? await admission() : null; active(instance);
      return emit("spike_conversion_admit", requested && !admitted.allowed ? "blocked" : "completed", "no_effect", { requested, admission: admitted },
        requested && !admitted.allowed ? {} : { mode_work_spike_requested: requested });
    },
    async initialize(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      explicit(prepared, write, expectPlan); const plan = planValid(prepared.plan, initializeSchema); active(instance);
      const fresh = await prepareInitialize(instance, plan.input, plan.prepared_at_ms);
      if (!fresh.can_apply || fresh.plan.decision_sha256 !== plan.decision_sha256
        || shadowHash(fresh.plan.inner.plan.changes) !== shadowHash(plan.inner.plan.changes)) fail("STANDARD_SPIKE_PREVIEW_CHANGED");
      const product = observeProduct();
      const output = await operations.initializeCycle(plan.inner, { write: true, expectPlan: plan.inner.plan_sha256,
        effectGuard: {
          async before({ assertOwner }) { assertOwner(); active(instance); await assertAuthorized();
            if ((await selected(instance, plan.input)).decision_sha256 !== plan.decision_sha256 || observeProduct() !== product) fail("STANDARD_SPIKE_DECISION_CHANGED"); },
          async after({ assertOwner }) { assertOwner(); active(instance); await assertAuthorized();
            // The accepted choice remains authenticated after its authorized CAS;
            // the former preimage is not reclassified as a fresh canonical state.
            await verifyDecision(readAcceptedOperation(instance, plan.input.decision_operation_id, "spike_conversion_decision").record);
            if (observeProduct() !== product) fail("STANDARD_SPIKE_PRODUCT_CHANGED"); },
        } });
      return emit("spike_cycle_initialize", output.outcome, output.effect_status, { cycle: output, branch_recommendation: plan.inner.plan.branch_name,
        branch_created: plan.inner.plan.spike_selection.branch_action === "create", selection: plan.inner.plan.spike_selection },
      output.outcome === "completed" ? { spike_cycle_initialized: true, spike_conversion_completed: false, spike_experiments_pending: true } : {}, output.evidence_refs);
    },
    async finalize(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      explicit(prepared, write, expectPlan); const plan = planValid(prepared.plan, finalizeSchema); active(instance);
      const fresh = await prepareFinalize(instance, plan.input);
      if (fresh.plan.source_sha256 !== plan.source_sha256 || fresh.plan.postimages_sha256 !== plan.postimages_sha256
        || fresh.plan.branch !== plan.branch || fresh.plan.head !== plan.head) fail("STANDARD_SPIKE_PREVIEW_CHANGED");
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        let hook = null, sync = null;
        try { active(instance); await assertAuthorized();
          if (postimages(initialized(instance, plan.input)) !== plan.postimages_sha256) fail("STANDARD_SPIKE_METADATA_CHANGED"); }
        catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        try {
          const rawHook = runSkillHookUseCase({ args: { skill: "convert-to-spike", mode: "EXPLORING", completionCycleId: plan.selection.cycle_id, strict: true, noAutoSkipGate: true },
            perfDir: fileURLToPath(new URL("../../../tools/perf/", import.meta.url)), targetRoot: root, processAdapter: createLocalProcessAdapter() });
          hook = retainEffect(expectPlan, "hook", JSON.stringify(rawHook), { ok: rawHook.ok === true, strict: rawHook.strict === true,
            payload: { mode: rawHook.payload?.mode ?? null } });
          const payload = rawHook.payload, checkpoint = payload?.checkpoint;
          if (rawHook.ok !== true || rawHook.strict !== true || payload?.ok !== true || payload.result !== "ok" || payload.skill !== "convert-to-spike"
            || payload.mode !== "EXPLORING" || payload.target_root !== root || checkpoint?.ok !== true || checkpoint.summary?.result !== "ok"
            || checkpoint.gate?.skipped === true || !["ok", "warn"].includes(checkpoint.gate?.result) || checkpoint.reload?.decision === "stop"
            || checkpoint.index_sync_check?.enabled && checkpoint.index_sync_check.in_sync !== true) fail("STANDARD_SPIKE_HOOK_UNCONFIRMED");
          if (plan.state_mode !== "files") {
            // Initialization already wrote canonical rows through metadata-bound
            // CAS. Importing their projections would reclassify that authority.
            // Synchronize only these canonical postimages outward; db-only
            // deliberately requests no visible projection.
            const source = initialized(instance, plan.input);
            if (postimages(source) !== plan.postimages_sha256) fail("STANDARD_SPIKE_POSTIMAGE_CHANGED");
            const projection = artifacts.project(source.inner.changes.map(row => row.path));
            if (postimages(initialized(instance, plan.input)) !== plan.postimages_sha256) fail("STANDARD_SPIKE_POSTIMAGE_CHANGED");
            if (plan.state_mode === "dual") for (const row of source.inner.changes) {
              const file = agentRunPhysicalPath(path.join(root, "docs/audit", row.path));
              if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== row.after_sha256) fail("STANDARD_SPIKE_PROJECTION_CHANGED");
            }
            const result = { ok: true, state_mode: plan.state_mode, source: "canonical_projection", projection };
            sync = retainEffect(expectPlan, "sync", JSON.stringify(result), { ok: true, state_mode: plan.state_mode, source: "canonical_projection" });
          }
          await assertAuthorized(); active(instance);
          const context = operations.observeScope(), original = initialized(instance, plan.input);
          if (context.branch !== plan.branch || context.head !== plan.head || shadowHash(original.source) !== plan.source_sha256
            || postimages(original) !== plan.postimages_sha256) fail("STANDARD_SPIKE_POSTIMAGE_CHANGED");
          return emit("spike_conversion_finalize", "completed", "confirmed", { hook, sync, selection: plan.selection, product_effects_authorized: false,
            retention_authorized: false, native_authority_renewed: false }, { spike_conversion_completed: true, spike_experiments_pending: true, mode_analysis_completed: true }, original.source.output.evidence_refs);
        } catch (cause) { return emit("spike_conversion_finalize", "reconciliation_required", "unknown", { hook, sync, reason_code: cause.code ?? "STANDARD_SPIKE_EFFECT_UNCONFIRMED" }); }
      });
    },
    async experimentAdmission(instance, input) {
      assertStandardOperationInput("spike_experiment_admit", input); active(instance);
      const source = readAcceptedOperation(instance, input.initialize_operation_id, "spike_conversion_finalize");
      if (source.output.facts.spike_conversion_completed !== true) fail("STANDARD_SPIKE_CONVERSION_REQUIRED");
      const original = initialized(instance, source.record.preview.input), context = operations.observeScope(), product = observeProduct();
      if (shadowHash(original.selection) !== shadowHash(source.output.observations.selection)
        || postimages(original) !== source.record.preview.prepared.plan.postimages_sha256) fail("STANDARD_SPIKE_CONVERSION_CHANGED");
      const prewrite = await preWriteAdmit({ targetRoot: root, skill: "branch-cycle-audit" }); active(instance);
      const audit = original.selection.chosen_mode === "COMMITTING"
        ? await operations.auditCycle({ session_id: original.inner.input.session_id, cycle_id: original.selection.cycle_id }) : null;
      active(instance);
      if (shadowHash(operations.observeScope()) !== shadowHash(context) || observeProduct() !== product
        || postimages(initialized(instance, source.record.preview.input)) !== source.record.preview.prepared.plan.postimages_sha256
        || shadowHash(initialized(instance, source.record.preview.input)) !== shadowHash(original)) fail("STANDARD_SPIKE_EXPERIMENT_CONTEXT_CHANGED");
      const allowed = prewrite.ok === true && prewrite.activation?.active === true
        && ["admitted", "admitted_with_warnings"].includes(prewrite.admission_status) && (!audit || audit.outcome === "completed");
      return assertStandardOperationOutput({ contract_version: "standard-spike-experiment-admission-output.v2", operation_ref: "spike_experiment_admit",
        outcome: allowed ? "completed" : "blocked", effect_status: "no_effect", facts: allowed ? { spike_experiment_planning_admitted: true,
          spike_experiment_committing: original.selection.chosen_mode === "COMMITTING" } : {},
        observations: { conversion_operation_id: input.initialize_operation_id, selection: original.selection, prewrite, audit,
          planning: allowed ? "admitted" : "blocked", product_effects_authorized: false, retention_authorized: false, native_authority_renewed: false }, evidence_refs: source.output.evidence_refs });
    },
    async experimentExecutionAdmission(instance, input) {
      assertStandardOperationInput("spike_experiment_execution_admit", input); active(instance);
      const converted = readAcceptedOperation(instance, input.conversion_operation_id, "spike_conversion_finalize");
      const recorded = readAcceptedOperation(instance, input.record_operation_id, "cycle_plan_record");
      if (converted.output.facts.spike_conversion_completed !== true || recorded.output.facts.cycle_plan_recorded !== true
        || recorded.output.effect_status !== "confirmed") fail("STANDARD_SPIKE_EXPERIMENT_PLAN_REQUIRED");
      const selection = converted.output.observations.selection, plan = recorded.record.preview.prepared.plan;
      if (!plan.cycle_path.startsWith(`cycles/${selection.cycle_id}-spike-`)
        || plan.changes.some(row => artifacts.read(row.path, { required: true }).sha256 !== row.after_sha256)) fail("STANDARD_SPIKE_EXPERIMENT_PLAN_CHANGED");
      const context = operations.observeScope(), metadata = plan.changes.map(row => artifacts.metadataHash(row.path));
      const prewrite = await preWriteAdmit({ targetRoot: root, skill: "branch-cycle-audit" }); active(instance);
      const current = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
      const session = artifacts.sessions().find(row => row.session_id === current.active_session);
      const audit = selection.chosen_mode === "COMMITTING" ? await operations.auditCycle({ session_id: current.active_session, cycle_id: selection.cycle_id }) : null;
      active(instance);
      if (!session || parseSessionMetadata(session.content).mode !== selection.chosen_mode || current.mode !== selection.chosen_mode || current.active_cycle !== selection.cycle_id
        || shadowHash(operations.observeScope()) !== shadowHash(context) || shadowHash(plan.changes.map(row => artifacts.metadataHash(row.path))) !== shadowHash(metadata)
        || plan.changes.some(row => artifacts.read(row.path, { required: true }).sha256 !== row.after_sha256)) fail("STANDARD_SPIKE_EXPERIMENT_PLAN_CHANGED");
      const allowed = selection.chosen_mode === "COMMITTING" && audit?.outcome === "completed" && prewrite.ok === true
        && prewrite.activation?.active === true && ["admitted", "admitted_with_warnings"].includes(prewrite.admission_status);
      return assertStandardOperationOutput({ contract_version: "standard-spike-experiment-admission-output.v3", operation_ref: "spike_experiment_execution_admit",
        outcome: allowed ? "completed" : "blocked", effect_status: "no_effect", facts: allowed ? { spike_experiment_execution_admitted: true, cycle_work_requested: true } : {},
        observations: { reason_code: allowed ? "STANDARD_SPIKE_COMMITTING_EXECUTION_ADMITTED" : selection.chosen_mode === "EXPLORING" ? "STANDARD_SPIKE_EXPLORING_EXECUTION_PORT_REQUIRED" : "STANDARD_SPIKE_EXPERIMENT_ADMISSION_BLOCKED",
          conversion_operation_id: input.conversion_operation_id, record_operation_id: input.record_operation_id,
          selected_mode: selection.chosen_mode, prewrite, audit, readiness: "required", product_effects_authorized: false, retention_authorized: false, native_authority_renewed: false }, evidence_refs: recorded.output.evidence_refs });
    },
  });
}
