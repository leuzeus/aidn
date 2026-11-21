import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { runGatingEvaluateUseCase } from "./gating-evaluate-use-case.mjs";
import { createPromoteBaselineCheckpointDefaults, runPromoteBaselineCheckpointUseCase } from "./promote-baseline-checkpoint-use-case.mjs";
import { classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { baselinePromotionPaths, renderStandardBaselinePromotionCompletion } from "../../core/workflow/standard-baseline-promotion.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-hook-input.v1.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-hook-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-hook-output.v1.schema.json" with { type: "json" };
import recordSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-plan.v1.schema.json" with { type: "json" };
import { assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
const fail = code => { throw Object.assign(Error(code), { code }); };
const eventRelative = ".aidn/runtime/perf/workflow-events.ndjson", runtimeDir = fileURLToPath(new URL("../../../tools/perf/", import.meta.url));
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const openGate = gate => gate?.result === "ok" && gate.levels?.level1?.decision !== "stop" && gate.levels?.level2?.required === false && gate.levels?.level3?.required === false;
// Fixed host readers authenticate accepted request/record/close provenance.
// Optional dependencies are trusted test ports; process data selects none.
export function createStandardBaselinePromotionHook({ targetRoot, readRecorded, promotion, readCurrent, readObjectiveCompletion = null, now = Date.now },
  { gating = runGatingEvaluateUseCase, checkpoint = runPromoteBaselineCheckpointUseCase } = {}) {
  if ([readRecorded, promotion?.inspectContext, readCurrent].some(value => typeof value !== "function")) fail("STANDARD_PROMOTION_HOOK_AUTHORITY_REQUIRED");
  if (readObjectiveCompletion !== null && typeof readObjectiveCompletion !== "function") fail("STANDARD_PROMOTION_HOOK_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const events = () => {
    const file = agentRunPhysicalPath(path.join(root, eventRelative), { missing: true });
    const bytes = fs.existsSync(file) ? readAgentRunFile(file, { json: false, maxBytes: 4194304 }).value : Buffer.alloc(0);
    if (bytes.length && bytes.at(-1) !== 10) fail("STANDARD_PROMOTION_HOOK_EVENT_LOG_INVALID"); return bytes;
  };
  const gate = (instance, completionCycleId) => gating({ targetRoot: root, runtimeDir, completionCycleId,
    readObjectiveCompletion: readObjectiveCompletion === null ? null : () => readObjectiveCompletion(instance), args: {
    cache: ".aidn/runtime/cache/reload-state.json", eventFile: eventRelative, indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
    stateMode: artifacts.describe().state_mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto",
    thresholdFiles: 3, thresholdMinutes: null, mode: "COMMITTING", runId: "", reloadDecision: "", reloadFallback: "", reloadReasonCodes: "", emitEvent: false, completeDriftCheck: false,
  } });
  async function source(instance, input) {
    const selected = await readRecorded(instance, input), plan = selected.plan, output = assertStandardOperationOutput(selected.output);
    if (selected.record_operation_id !== input.record_operation_id || !valid(plan, recordSchema) || plan.request.instance_id !== instance.instance_id || plan.request.scope_id !== instance.scope_id
      || output.operation_ref !== "baseline_promotion_record" || output.outcome !== "completed" || output.effect_status !== "confirmed"
      || output.observations.decision_operation_id !== plan.input.decision_operation_id || output.observations.cycle_id !== plan.request.cycle_id || output.observations.version !== plan.request.version
      || output.facts.baseline_recorded !== true || output.facts.baseline_promotion_completed !== false
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(baselinePromotionPaths)) fail("STANDARD_PROMOTION_HOOK_RECORD_REQUIRED");
    const observed = await promotion.inspectContext(plan.request);
    if (observed.blocked) fail("STANDARD_PROMOTION_HOOK_ADMISSION_BLOCKED");
    if (observed.context.mode !== "COMMITTING" || observed.context.cycle_state !== "DONE"
      || observed.completion_boundary_sha256 !== output.observations.causal_transition?.completion_boundary_sha256) fail("STANDARD_PROMOTION_HOOK_SOURCE_CHANGED");
    for (const row of plan.changes) {
      if (artifactContentHash(row.text_chunks.join("")) !== row.after_sha256 || artifacts.read(row.path, { required: true }).sha256 !== row.after_sha256) fail("STANDARD_PROMOTION_HOOK_POSTIMAGE_CHANGED");
      if (artifacts.describe().state_mode !== "db-only" && readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", row.path)), { json: false, maxBytes: 1048576 }).sha256 !== row.after_sha256) fail("STANDARD_PROMOTION_HOOK_PROJECTION_STALE");
    }
    return { selected, observed };
  }
  function assertPlan(plan) {
    if (!valid(plan, planSchema) || shadowHash(plan.completion_preimages.map(row => row.path)) !== shadowHash(baselinePromotionPaths)) fail("STANDARD_PROMOTION_HOOK_PLAN_INVALID"); return plan;
  }
  async function prepare(instance, input, operationId, at, acquired = false) {
    if (!valid(input, inputSchema) || !/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_PROMOTION_HOOK_INPUT_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const { selected, observed } = await source(instance, input), context = observed.context;
    const completionCycleId = ["cycle", "intermediate"].includes(classifyAidnBranch(context.branch)) ? selected.plan.request.cycle_id : null;
    const gatingResult = await gate(instance, completionCycleId);
    if (!openGate(gatingResult)) return { can_apply: false, reason_code: "STANDARD_PROMOTION_HOOK_GATE_REQUIRED", gate: gatingResult };
    // Reject oversized or incoherent completion material before the real hook.
    // This is a planned postimage estimate, never a successful receipt.
    renderStandardBaselinePromotionCompletion({ request: selected.plan.request, context, documents: observed.documents,
      runId: "process_promote_" + operationId.slice(3), eventSha256: "0".repeat(64), completedAt: at });
    const before = events(), plan = { contract_version: "standard-baseline-promotion-hook-plan.v1", input, operation_id: operationId, prepared_at_ms: at,
      request: selected.plan.request, record_plan_sha256: shadowHash(selected.plan), record_output_sha256: shadowHash(selected.output), context_sha256: observed.context_sha256,
      boundary_sha256: observed.completion_boundary_sha256, completion_cycle_id: completionCycleId, scope: { branch: context.branch, state_mode: artifacts.describe().state_mode },
      completion_preimages: baselinePromotionPaths.map(name => { const row = artifacts.read(name, { required: true }); return { path: name, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(name) }; }),
      event_log: { bytes: before.length, sha256: artifactContentHash(before) } };
    assertPlan(plan); return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const output = { contract_version: "standard-baseline-promotion-hook-output.v1", operation_ref: "baseline_promotion_finalize", outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(output, outputSchema)) fail("STANDARD_PROMOTION_HOOK_OUTPUT_INVALID"); return output;
  }
  return Object.freeze({ prepare: (instance, input, operationId) => prepare(instance, input, operationId, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      try { assertPlan(plan); if (write !== true || !prepared.can_apply || shadowHash(plan) !== expectPlan || prepared.plan_sha256 !== expectPlan
        || typeof assertAuthorized !== "function") fail("STANDARD_PROMOTION_HOOK_EXPLICIT_EFFECT_REQUIRED"); }
      catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const assertEffectAuthorized = async () => {
          if (readObjectiveCompletion !== null) await readObjectiveCompletion(instance);
          await assertAuthorized();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_PROMOTION_HOOK_SOURCE_CHANGED");
        };
        let before;
        try {
          await assertAuthorized();
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_PREVIEW_CHANGED");
          before = events();
          if (before.length !== plan.event_log.bytes || artifactContentHash(before) !== plan.event_log.sha256) fail("STANDARD_PROMOTION_HOOK_SOURCE_CHANGED");
          if (readObjectiveCompletion !== null) await assertEffectAuthorized();
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let result = null; const committed = [];
        try {
          const runId = "process_promote_" + plan.operation_id.slice(3), started = now();
          const args = { ...createPromoteBaselineCheckpointDefaults({ runtimeDir, env: { AIDN_STATE_MODE: plan.scope.state_mode } }), runId,
            indexSyncCheck: true, indexSyncCheckStrict: true, skipGateEvaluate: false, autoSkipGateOnNoSignal: false, skipIndexOnIncremental: false };
          result = await checkpoint({ targetRoot: root, args, runtimeDir, cycleId: plan.request.cycle_id, completionCycleId: plan.completion_cycle_id,
            ...(readObjectiveCompletion === null ? {} : { assertEffectAuthorized, readObjectiveCompletion: async () => {
              const completed = await readObjectiveCompletion(instance);
              await assertAuthorized();
              if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_PROMOTION_HOOK_SOURCE_CHANGED");
              return completed;
            } }) });
          if (result.checkpoint === null) return emit("blocked", "no_effect", { reason_code: "STANDARD_PROMOTION_HOOK_ADMISSION_BLOCKED", admission: result.admission });
          const observed = result.checkpoint, admission = result.admission;
          if (admission?.ok !== true || admission.action !== "promote_baseline_allowed" || admission.target_cycle?.cycle_id !== plan.request.cycle_id
            || observed?.ok !== true || observed.state_mode !== plan.scope.state_mode || observed.run_id !== runId || observed.summary_run_id !== runId
            || observed.summary?.result !== "ok" || observed.summary?.repair_layer_blocking === true || observed.gate?.skipped !== false || !openGate(observed.gate)
            || observed.reload?.decision === "stop" || observed.index_sync_check?.enabled && observed.index_sync_check.in_sync !== true) fail("STANDARD_PROMOTION_HOOK_UNCONFIRMED");
          const after = events(), delta = after.subarray(before.length);
          if (delta.length <= 0 || delta.length > 65536 || artifactContentHash(after.subarray(0, before.length)) !== artifactContentHash(before)) fail("STANDARD_PROMOTION_HOOK_EVENT_UNCONFIRMED");
          let offset = before.length;
          const rows = delta.toString("utf8").trimEnd().split("\n").map(line => { const row = { event: JSON.parse(line), offset }; offset += Buffer.byteLength(line) + 1; return row; });
          const matches = rows.filter(row => row.event.run_id === runId && row.event.event === "checkpoint_summary"), event = matches[0]?.event;
          if (matches.length !== 1 || event.skill !== "perf-checkpoint" || event.result !== "ok" || event.branch !== plan.scope.branch || event.mode !== "COMMITTING"
            || event.ts !== observed.ts || !Number.isFinite(Date.parse(event.ts)) || Date.parse(event.ts) < started || Date.parse(event.ts) > now()) fail("STANDARD_PROMOTION_HOOK_EVENT_UNCONFIRMED");
          await assertAuthorized();
          const current = await source(instance, plan.input);
          if (shadowHash(current.selected.plan) !== plan.record_plan_sha256 || shadowHash(current.selected.output) !== plan.record_output_sha256
            || current.observed.completion_boundary_sha256 !== plan.boundary_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || !openGate(await gate(instance, plan.completion_cycle_id))) fail("STANDARD_PROMOTION_HOOK_POSTCONDITION_FAILED");
          if (readObjectiveCompletion !== null) await assertEffectAuthorized();
          const documents = plan.completion_preimages.map(row => {
            const document = artifacts.read(row.path, { required: true });
            if (document.sha256 !== row.sha256 || artifacts.metadataHash(row.path) !== row.metadata_sha256) fail("STANDARD_PROMOTION_HOOK_POSTIMAGE_CHANGED"); return document;
          });
          const rendered = renderStandardBaselinePromotionCompletion({ request: plan.request, context: current.observed.context, documents,
            runId, eventSha256: shadowHash(event), completedAt: Date.parse(event.ts) }), metadata = [];
          for (const [i, row] of rendered.changes.entries()) { metadata.push(artifacts.compareAndSwapPreservingMetadata({ ...row,
            before_metadata_sha256: plan.completion_preimages[i].metadata_sha256, after: row.text_chunks.join("") }).metadata_sha256); committed.push(row.path); }
          artifacts.project(committed);
          for (const [i, row] of rendered.changes.entries()) {
            if (artifacts.read(row.path).sha256 !== row.after_sha256 || artifacts.metadataHash(row.path) !== metadata[i]) fail("STANDARD_PROMOTION_HOOK_METADATA_UNCONFIRMED");
            if (plan.scope.state_mode !== "db-only" && readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", row.path)), { json: false, maxBytes: 1048576 }).sha256 !== row.after_sha256) fail("STANDARD_PROMOTION_HOOK_PROJECTION_UNCONFIRMED");
          }
          const completed = await promotion.inspectContext(plan.request);
          if (completed.blocked || completed.completion_boundary_sha256 !== plan.boundary_sha256 || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_PROMOTION_HOOK_POSTCONDITION_FAILED");
          await assertAuthorized();
          return emit("completed", "confirmed", { checkpoint: result, cycle_id: plan.request.cycle_id, version: plan.request.version, event,
            event_offset: matches[0].offset, event_file: eventRelative, committed, causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: completed.context_sha256 } },
            { baseline_recorded: true, baseline_promotion_completed: true }, [{ ref: "aidn:baseline-promotion/" + runId, sha256: shadowHash(event) }, ...rendered.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 }))]);
        } catch (cause) { return emit("reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_PROMOTION_HOOK_UNCONFIRMED", checkpoint: result, committed }); }
      });
    },
  });
}
