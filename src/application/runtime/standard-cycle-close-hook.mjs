import { STANDARD_DRIFT_FRESHNESS_MINUTES } from "../../core/gating/gating-signal-policy.mjs";
import { verifyCycleCloseCheckpoint } from "./standard-cycle-close-checkpoint.mjs";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { cycleCloseCompletionBoundary } from "./standard-drift-recovery.mjs";
import { runCycleCloseAdmitUseCase } from "./cycle-close-admit-use-case.mjs";
import { runGatingEvaluateUseCase } from "./gating-evaluate-use-case.mjs";
import { runSkillHookUseCase } from "./skill-hook-use-case.mjs";
import { defaultCycleCloseHookArguments, runCycleCloseHookUseCase } from "./cycle-close-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { cycleClosePaths, cycleCloseCompletionPaths, renderStandardCycleCloseCompletion } from "../../core/workflow/standard-cycle-close-render.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-cycle-close-hook-input.v1.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-cycle-close-hook-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-cycle-close-hook-output.v2.schema.json" with { type: "json" };
import renewalSchema from "../../core/contracts/workflow-definition/standard-cycle-close-renewal-plan.v1.schema.json" with { type: "json" };
import recordSchema from "../../core/contracts/workflow-definition/standard-cycle-close-plan.v1.schema.json" with { type: "json" };
import { assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const eventRelative = ".aidn/runtime/perf/workflow-events.ndjson", runtimeDir = fileURLToPath(new URL("../../../tools/perf/", import.meta.url));
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const openGate = gate => gate?.result === "ok" && gate.levels?.level1?.decision !== "stop" && gate.levels?.level2?.required === false && gate.levels?.level3?.required === false;

// readRecorded is a trusted capability authenticating the accepted terminal
// record and its human/audit provenance. JSON never supplies a successful hook.
export function createStandardCycleCloseHook({ targetRoot, readRecorded, observeContext, readCurrent, readObjectiveCompletion = null, readHistoricalCompletion = null, now = Date.now }) {
  if ([readRecorded, observeContext, readCurrent].some(value => typeof value !== "function")) fail("STANDARD_CYCLE_CLOSE_HOOK_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const events = () => {
    const file = agentRunPhysicalPath(path.join(root, eventRelative), { missing: true });
    const bytes = fs.existsSync(file) ? readAgentRunFile(file, { json: false, maxBytes: 4194304 }).value : Buffer.alloc(0);
    if (bytes.length && bytes.at(-1) !== 10) fail("STANDARD_CYCLE_CLOSE_HOOK_EVENT_LOG_INVALID");
    return bytes;
  };
  const gate = (instance, completionCycleId) => runGatingEvaluateUseCase({ targetRoot: root, runtimeDir, completionCycleId,
    readObjectiveCompletion: readObjectiveCompletion === null ? null : () => readObjectiveCompletion(instance), args: {
    cache: ".aidn/runtime/cache/reload-state.json", eventFile: eventRelative, indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
    stateMode: artifacts.describe().state_mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto",
    thresholdFiles: 3, thresholdMinutes: STANDARD_DRIFT_FRESHNESS_MINUTES, mode: "COMMITTING", runId: "", reloadDecision: "", reloadFallback: "", reloadReasonCodes: "", emitEvent: false, completeDriftCheck: false,
  } });
  async function source(instance, input) {
    const selected = await readRecorded(instance, input), plan = selected.plan, output = assertStandardOperationOutput(selected.output);
    const observed = await observeContext(), context = observed.context;
    if (selected.record_operation_id !== input.closure_operation_id || !valid(plan, recordSchema)
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(cycleClosePaths(plan.cycle_path))
      || output.operation_ref !== "cycle_close_record" || output.outcome !== "completed" || output.effect_status !== "confirmed"
      || output.facts.cycle_terminal_recorded !== true || output.facts.cycle_close_completed !== false
      || context.context_use !== "cycle_completion" || context.cycle_state !== plan.target_state || context.cycle_path !== plan.cycle_path
      ) fail("STANDARD_CYCLE_CLOSE_HOOK_RECORD_REQUIRED");
    if (output.observations.causal_transition?.after_context_sha256 !== observed.context_sha256
      && !verifyCycleCloseCheckpoint({ root, context, state: output.observations.causal_transition?.state })) fail("STANDARD_CYCLE_CLOSE_HOOK_CHECKPOINT_REQUIRED");
    for (const row of plan.changes) {
      if (artifacts.read(row.path, { required: true }).sha256 !== row.after_sha256 || artifactContentHash(row.text_chunks.join("")) !== row.after_sha256) fail("STANDARD_CYCLE_CLOSE_HOOK_POSTIMAGE_CHANGED");
      if (artifacts.describe().state_mode !== "db-only" && readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", row.path)), { json: false, maxBytes: 1048576 }).sha256 !== row.after_sha256) fail("STANDARD_CYCLE_CLOSE_HOOK_PROJECTION_STALE");
    }
    const admission = await runCycleCloseAdmitUseCase({ targetRoot: root, mode: "COMMITTING" });
    if (admission.ok !== true || admission.action !== "cycle_close_allowed" || admission.target_cycle?.cycle_id !== context.cycle_id
      || admission.target_cycle?.state !== plan.target_state || admission.active_session !== context.session_id || admission.branch !== context.branch) fail("STANDARD_CYCLE_CLOSE_HOOK_ADMISSION_BLOCKED");
    return { observed, selected };
  }
  async function prepare(instance, input, operationId, at, acquired = false) {
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_CYCLE_CLOSE_HOOK_OPERATION_INVALID");
    if (!valid(input, inputSchema)) fail("STANDARD_CYCLE_CLOSE_HOOK_INPUT_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const { observed, selected } = await source(instance, input);
    if (readObjectiveCompletion !== null) await readObjectiveCompletion(instance);
    const gating = await gate(instance, observed.context.cycle_id);
    if (!openGate(gating)) {
      // The event can expire while the gate is reading canonical state.
      if (readObjectiveCompletion !== null && gating.levels?.level2?.active_signals?.includes("time_since_last_drift_check"))
        await readObjectiveCompletion(instance);
      return { can_apply: false, reason_code: "STANDARD_CYCLE_CLOSE_HOOK_GATE_REQUIRED", gate: gating };
    }
    const before = events(), context = observed.context;
    const plan = { contract_version: "standard-cycle-close-hook-plan.v1", input, operation_id: operationId, prepared_at_ms: at, context_sha256: observed.context_sha256,
      record_plan_sha256: shadowHash(selected.plan), record_output_sha256: shadowHash(selected.output),
      scope: { branch: context.branch, head: context.head, cycle_id: context.cycle_id, session_id: context.session_id, target_state: context.cycle_state, state_mode: artifacts.describe().state_mode },
      boundary_sha256: cycleCloseCompletionBoundary({ root, context }, context.cycle_path),
      completion_preimages: cycleCloseCompletionPaths(context.cycle_path).map(name => { const row = artifacts.read(name, { required: true }); return { path: name, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(name) }; }),
      event_log: { bytes: before.length, sha256: artifactContentHash(before) } };
    if (!valid(plan, planSchema)) fail("STANDARD_CYCLE_CLOSE_HOOK_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  const expired = cause => ["STANDARD_OBJECTIVE_DISPOSITION_EXPIRED", "STANDARD_OBJECTIVE_COMPLETION_EXPIRED"].includes(cause?.code);
  async function renewal(instance, input, operationId, at, cause) {
    if (!expired(cause) || typeof readHistoricalCompletion !== "function") throw cause;
    if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    const { observed } = await source(instance, input);
    const previous = await readHistoricalCompletion(instance);
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_CLOSE_HOOK_SOURCE_CHANGED");
    const plan = { contract_version: "standard-cycle-close-renewal-plan.v1", input, operation_id: operationId, prepared_at_ms: at,
      context_sha256: observed.context_sha256, previous_completion: previous, reason_code: cause.code };
    if (!valid(plan, renewalSchema)) fail("STANDARD_CYCLE_CLOSE_RENEWAL_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  async function returnToReview(instance, prepared, assertAuthorized) {
    const plan = prepared.plan;
    let cause;
    try { await readObjectiveCompletion(instance); }
    catch (error) { if (!expired(error)) throw error; cause = error; }
    if (!cause) fail("STANDARD_PREVIEW_CHANGED");
    const fresh = await renewal(instance, plan.input, plan.operation_id, plan.prepared_at_ms, cause);
    if (fresh.plan_sha256 !== prepared.plan_sha256) fail("STANDARD_PREVIEW_CHANGED");
    await assertAuthorized();
    if (now() < plan.prepared_at_ms || now() - plan.prepared_at_ms > 300000
      || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_CLOSE_HOOK_SOURCE_CHANGED");
    return emit("completed", "no_effect", { reason_code: cause.code, previous_completion: plan.previous_completion },
      { cycle_close_completed: false, drift_completion_reviewed: false });
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const output = { contract_version: "standard-cycle-close-hook-output.v2", operation_ref: "cycle_close_finalize", outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(output, outputSchema)) fail("STANDARD_CYCLE_CLOSE_HOOK_OUTPUT_INVALID"); return output;
  }
  return Object.freeze({ async prepare(instance, input, operationId) {
      const at = now();
      try { return await prepare(instance, input, operationId, at); }
      catch (cause) { return renewal(instance, input, operationId, at, cause); }
    },
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      try { if (!valid(plan, plan.contract_version === "standard-cycle-close-renewal-plan.v1" ? renewalSchema : planSchema) || write !== true || !prepared.can_apply || shadowHash(plan) !== expectPlan || prepared.plan_sha256 !== expectPlan
        || typeof assertAuthorized !== "function" || now() < plan.prepared_at_ms || now() - plan.prepared_at_ms > 300000) fail("STANDARD_CYCLE_CLOSE_HOOK_EXPLICIT_EFFECT_REQUIRED"); }
      catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      if (plan.contract_version === "standard-cycle-close-renewal-plan.v1") {
        try { return await returnToReview(instance, prepared, assertAuthorized); }
        catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      }
      try { return await artifacts.withLocalEffectOwner(expectPlan, async () => {
        const assertEffectAuthorized = async () => {
          // Observation/authentication may yield. The operation grant is checked
          // last, then synchronous TTL/process fences precede the next effect.
          if (readObjectiveCompletion !== null) await readObjectiveCompletion(instance);
          await assertAuthorized();
          if (now() < plan.prepared_at_ms || now() - plan.prepared_at_ms > 300000
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_CYCLE_CLOSE_HOOK_SOURCE_CHANGED");
        };
        let before;
        try {
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          await assertAuthorized();
          const current = await source(instance, plan.input);
          if (current.observed.context_sha256 !== plan.context_sha256 || shadowHash(current.selected.plan) !== plan.record_plan_sha256
            || shadowHash(current.selected.output) !== plan.record_output_sha256 || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
            || !openGate(await gate(instance, plan.scope.cycle_id)) || now() - plan.prepared_at_ms > 300000) fail("STANDARD_CYCLE_CLOSE_HOOK_SOURCE_CHANGED");
          before = events(); if (before.length !== plan.event_log.bytes || artifactContentHash(before) !== plan.event_log.sha256) fail("STANDARD_PREVIEW_CHANGED");
          await assertEffectAuthorized();
          before = events(); if (before.length !== plan.event_log.bytes || artifactContentHash(before) !== plan.event_log.sha256) fail("STANDARD_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let hook = null; const completionCommitted = [];
        try {
          const runId = "process_close_" + plan.operation_id.slice(3), started = now();
          if (readObjectiveCompletion !== null) {
            const payload = await runCycleCloseHookUseCase({ targetRoot: root, runtimeDir,
              args: { ...defaultCycleCloseHookArguments(runtimeDir), mode: "COMMITTING", runId, autoSkipGateOnNoSignal: false },
              assertEffectAuthorized,
              readObjectiveCompletion: async () => {
                const completed = await readObjectiveCompletion(instance);
                await assertAuthorized();
                if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
                  || now() < plan.prepared_at_ms || now() - plan.prepared_at_ms > 300000) fail("STANDARD_CYCLE_CLOSE_HOOK_SOURCE_CHANGED");
                return completed;
              } });
            hook = { ok: payload.ok, skill: "cycle-close", tool: "cycle-close-hook.mjs", mode: "COMMITTING", target: root,
              state_mode: payload.state_mode, strict: true, invocation: "in_process_authenticated_objective_completion", result: payload.result, payload };
          } else hook = runSkillHookUseCase({ args: { skill: "cycle-close", mode: "COMMITTING", strict: true, noAutoSkipGate: true, runId }, perfDir: runtimeDir, targetRoot: root, processAdapter: createLocalProcessAdapter() });
          const payload = hook.payload, checkpoint = payload?.checkpoint;
          if (hook.ok !== true || hook.strict !== true || hook.state_mode !== plan.scope.state_mode || payload?.ok !== true || payload.result !== "ok" || payload.skill !== "cycle-close"
            || payload.target_root !== root || payload.branch !== plan.scope.branch || payload.mode !== "COMMITTING" || payload.action !== "cycle_close_allowed"
            || payload.admission?.target_cycle?.cycle_id !== plan.scope.cycle_id || payload.admission?.target_cycle?.state !== plan.scope.target_state
            || checkpoint?.ok !== true || checkpoint.state_mode !== plan.scope.state_mode || checkpoint.run_id !== runId || checkpoint.summary_run_id !== runId
            || checkpoint.summary?.result !== "ok" || checkpoint.gate?.skipped !== false || !openGate(checkpoint.gate) || checkpoint.reload?.decision === "stop"
            || checkpoint.index_sync_check?.enabled && checkpoint.index_sync_check.in_sync !== true || checkpoint.summary?.repair_layer_blocking === true) fail("STANDARD_CYCLE_CLOSE_HOOK_UNCONFIRMED");
          const after = events(), delta = after.subarray(before.length);
          if (delta.length <= 0 || delta.length > 65536 || artifactContentHash(after.subarray(0, before.length)) !== artifactContentHash(before)) fail("STANDARD_CYCLE_CLOSE_HOOK_EVENT_UNCONFIRMED");
          let offset = before.length;
          const rows = delta.toString("utf8").trimEnd().split("\n").map(line => { const row = { event: JSON.parse(line), offset }; offset += Buffer.byteLength(line) + 1; return row; });
          const matches = rows.filter(row => row.event.run_id === runId && row.event.event === "checkpoint_summary"), event = matches[0]?.event;
          if (matches.length !== 1 || event.skill !== "perf-checkpoint" || event.result !== "ok" || event.branch !== plan.scope.branch || event.mode !== "COMMITTING"
            || event.ts !== checkpoint.ts || !Number.isFinite(Date.parse(event.ts)) || Date.parse(event.ts) < started || Date.parse(event.ts) > now()) fail("STANDARD_CYCLE_CLOSE_HOOK_EVENT_UNCONFIRMED");
          await assertAuthorized();
          const current = await source(instance, plan.input);
          if (now() - plan.prepared_at_ms > 300000 || current.observed.context_sha256 !== plan.context_sha256 || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || !openGate(await gate(instance, plan.scope.cycle_id))) fail("STANDARD_CYCLE_CLOSE_HOOK_POSTCONDITION_FAILED");
          // Only after the actual checkpoint is confirmed may current metadata
          // stop asking for that hook. An interrupted suffix retains ownership;
          // the already executed checkpoint must not be run again automatically.
          const beforeDocs = plan.completion_preimages.map(row => {
            const observed = artifacts.read(row.path, { required: true });
            if (observed.sha256 !== row.sha256 || artifacts.metadataHash(row.path) !== row.metadata_sha256) fail("STANDARD_CYCLE_CLOSE_HOOK_POSTIMAGE_CHANGED");
            return observed;
          });
          const changes = renderStandardCycleCloseCompletion({ cyclePath: current.observed.context.cycle_path, context: current.observed.context,
            documents: beforeDocs, runId, eventSha256: shadowHash(event), completedAt: Date.parse(checkpoint.ts) });
          await assertEffectAuthorized();
          const metadata = [];
          for (const [index, change] of changes.entries()) { metadata.push(artifacts.compareAndSwapPreservingMetadata({ ...change,
            before_metadata_sha256: plan.completion_preimages[index].metadata_sha256, after: change.text_chunks.join("") }).metadata_sha256); completionCommitted.push(change.path); }
          artifacts.project(changes.map(row => row.path));
          for (const [index, change] of changes.entries()) {
            if (artifacts.read(change.path).sha256 !== change.after_sha256 || artifacts.metadataHash(change.path) !== metadata[index]) fail("STANDARD_CYCLE_CLOSE_HOOK_METADATA_UNCONFIRMED");
            if (plan.scope.state_mode !== "db-only" && readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", change.path)), { json: false, maxBytes: 1048576 }).sha256 !== change.after_sha256) fail("STANDARD_CYCLE_CLOSE_HOOK_PROJECTION_UNCONFIRMED");
          }
          const completed = await observeContext();
          if (cycleCloseCompletionBoundary({ root, context: completed.context }, completed.context.cycle_path) !== plan.boundary_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_CLOSE_HOOK_POSTCONDITION_FAILED");
          return emit("completed", "confirmed", { hook, event, event_offset: matches[0].offset, event_file: eventRelative, target_state: plan.scope.target_state,
            committed: changes.map(row => row.path), causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: completed.context_sha256 } },
            { cycle_close_completed: true, cycle_retained: plan.scope.target_state === "DONE" }, [{ ref: "aidn:cycle-close/" + runId, sha256: shadowHash(event) }, ...changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 }))]);
        } catch (cause) { return emit("reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_CYCLE_CLOSE_HOOK_UNCONFIRMED", hook, committed: completionCommitted }); }
      }); } catch (cause) {
        // The owner has been released only for a proved pre-effect refusal.
        // Once the hook has started, its existing UNKNOWN result stays owned.
        if (!expired(cause) || cause.effect_status !== "no_effect") throw cause;
        try {
          const next = await renewal(instance, plan.input, plan.operation_id, now(), cause);
          return await returnToReview(instance, next, assertAuthorized);
        } catch (error) { error.effect_status = "no_effect"; throw error; }
      }
    },
  });
}
