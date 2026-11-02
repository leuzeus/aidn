import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGatingEvaluateUseCase } from "./gating-evaluate-use-case.mjs";
import { runSkillHookUseCase } from "./skill-hook-use-case.mjs";
import { runCycleCreateAdmitUseCase } from "./cycle-create-admit-use-case.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import schema from "../../core/contracts/workflow-definition/standard-cycle-checkpoint-plan.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
const eventRelative = ".aidn/runtime/perf/workflow-events.ndjson";
const runtimeDir = fileURLToPath(new URL("../../../tools/perf/", import.meta.url));
const names = ["brief", "plan", "hypotheses", "audit-spec", "traceability", "decisions", "change-requests", "status"];
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-cycle-checkpoint-output.v1", operation_ref: "cycle_checkpoint_finalize", outcome, effect_status, observations, facts, evidence_refs });

// This adapter runs the real fixed hook. Authored JSON cannot select a script,
// suppress the conditional drift gate, or supply a successful hook result.
export function createStandardCycleCheckpoint({ artifacts, scope, session, audit, now }) {
  const root = artifacts.root;
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_CYCLE_CHECKPOINT_PLAN_INVALID");
    assertStandardOperationInput("cycle_checkpoint_finalize", plan.input);
    return plan;
  }
  async function gate(mode) {
    return runGatingEvaluateUseCase({ targetRoot: root, runtimeDir, args: {
      cache: ".aidn/runtime/cache/reload-state.json", eventFile: eventRelative, indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
      stateMode: artifacts.describe().state_mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto",
      thresholdFiles: 3, thresholdMinutes: 45, mode, runId: "", reloadDecision: "", reloadFallback: "", reloadReasonCodes: "", emitEvent: false, completeDriftCheck: false,
    } });
  }
  const openGate = value => value?.result === "ok" && value.levels?.level1?.decision !== "stop"
    && value.levels?.level2?.required === false && value.levels?.level3?.required === false;
  function documents(observed, checked) {
    const cycle = checked.cycle.path.replace(/\/status\.md$/, "");
    return [...names.map(name => `${cycle}/${name}.md`), observed.row.path, "CURRENT-STATE.md", "snapshots/context-snapshot.md", "baseline/current.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md"]
      .map(name => {
        const row = artifacts.read(name, { required: true });
        if (artifacts.describe().state_mode === "dual") {
          const file = agentRunPhysicalPath(path.join(root, "docs/audit", name));
          if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== row.sha256) fail("STANDARD_CYCLE_CHECKPOINT_PROJECTION_STALE");
        }
        return { path: name, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(name) };
      });
  }
  function events() {
    const file = agentRunPhysicalPath(path.join(root, eventRelative), { missing: true });
    const bytes = fs.existsSync(file) ? readAgentRunFile(file, { json: false, maxBytes: 4194304 }).value : Buffer.alloc(0);
    if (bytes.length && bytes.at(-1) !== 10) fail("STANDARD_CYCLE_CHECKPOINT_EVENT_LOG_INVALID");
    return bytes;
  }
  async function prepare(input, preparedAt, acquired = false) {
    assertStandardOperationInput("cycle_checkpoint_finalize", input);
    const context = scope(), observed = session(input.session_id), checked = await audit(input);
    if ((!acquired && artifacts.ownerPending()) || !checked.allowed) return { can_apply: false, reason_code: "STANDARD_CYCLE_CHECKPOINT_ADMISSION_BLOCKED", admission: checked };
    // Step 9 of the skill and its route specify COMMITTING for the performance
    // checkpoint. This does not alter session mode or the admitted cycle rule.
    const hookMode = "COMMITTING", hookAdmission = await runCycleCreateAdmitUseCase({ targetRoot: root, mode: hookMode });
    if (hookAdmission.ok !== true || hookAdmission.active_session !== input.session_id || hookAdmission.active_cycle !== input.cycle_id
      || !["proceed_r1_strict_chain", "proceed_r2_session_base_with_import"].includes(hookAdmission.action))
      return { can_apply: false, reason_code: "STANDARD_CYCLE_CHECKPOINT_ADMISSION_BLOCKED", admission: hookAdmission };
    const gating = await gate(hookMode);
    if (!openGate(gating)) return { can_apply: false, reason_code: "STANDARD_CYCLE_CHECKPOINT_GATE_REQUIRED", gate: gating };
    const before = events();
    const plan = assertPlan({ contract_version: "standard-cycle-checkpoint-plan.v1", operation_ref: "cycle_checkpoint_finalize", input,
      prepared_at_ms: preparedAt, scope: context, mode: observed.metadata.mode, hook_mode: hookMode, dor_ready: checked.dor_ready, documents: documents(observed, checked),
      event_log: { bytes: before.length, sha256: artifactContentHash(before) },
      effects: ["checkpoint", "runtime_index", "checkpoint_events"] });
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepareCycleCheckpoint: input => prepare(input, now()),
    async finalizeCycleCheckpoint(prepared, { write = false, expectPlan, assertAuthorized, assertCurrent } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan); const age = now() - plan.prepared_at_ms;
        if (write !== true || !prepared.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
          || typeof assertAuthorized !== "function" || typeof assertCurrent !== "function"
          || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_CYCLE_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        let before;
        try {
          const fresh = await prepare(plan.input, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          await assertAuthorized(); await assertCurrent();
          if (now() - plan.prepared_at_ms > 300000) fail("STANDARD_PLAN_EXPIRED");
          if (shadowHash(documents(session(plan.input.session_id), await audit(plan.input))) !== shadowHash(plan.documents)) fail("STANDARD_PREVIEW_CHANGED");
          if (!openGate(await gate(plan.hook_mode))) fail("STANDARD_CYCLE_CHECKPOINT_GATE_REQUIRED");
          before = events();
          if (before.length !== plan.event_log.bytes || artifactContentHash(before) !== plan.event_log.sha256) fail("STANDARD_PREVIEW_CHANGED");
          await assertCurrent();
          if (shadowHash(scope()) !== shadowHash(plan.scope)) fail("STANDARD_CYCLE_CHECKPOINT_SOURCE_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let hook = null;
        try {
          const runId = "process_cycle_" + expectPlan.slice(0, 40), started = now();
          hook = runSkillHookUseCase({ args: { skill: "cycle-create", mode: plan.hook_mode, strict: true, noAutoSkipGate: true, runId },
            perfDir: runtimeDir, targetRoot: root, processAdapter: createLocalProcessAdapter() });
          const payload = hook.payload, checkpoint = payload?.checkpoint;
          if (hook.ok !== true || hook.strict !== true || hook.state_mode !== plan.scope.persistence.state_mode
            || payload?.ok !== true || payload.result !== "ok" || payload.skill !== "cycle-create"
            || payload.target_root !== root || payload.branch !== plan.scope.branch || payload.mode !== plan.hook_mode
            || payload.admission?.active_session !== plan.input.session_id || payload.admission?.active_cycle !== plan.input.cycle_id
            || !["proceed_r1_strict_chain", "proceed_r2_session_base_with_import"].includes(payload.action)
            || checkpoint?.ok !== true || checkpoint.state_mode !== plan.scope.persistence.state_mode
            || checkpoint.run_id !== runId || checkpoint.summary_run_id !== runId || checkpoint.summary?.result !== "ok"
            || checkpoint.gate?.skipped !== false || !openGate(checkpoint.gate) || checkpoint.reload?.decision === "stop"
            || checkpoint.index_sync_check?.enabled && checkpoint.index_sync_check.in_sync !== true
            || checkpoint.summary?.repair_layer_blocking === true) fail("STANDARD_CYCLE_CHECKPOINT_HOOK_UNCONFIRMED");
          const after = events(), delta = after.subarray(before.length);
          if (after.length <= before.length || delta.length > 65536 || artifactContentHash(after.subarray(0, before.length)) !== artifactContentHash(before)) fail("STANDARD_CYCLE_CHECKPOINT_EVENT_UNCONFIRMED");
          let offset = before.length;
          const rows = delta.toString("utf8").trimEnd().split("\n").map(line => {
            const row = { event: JSON.parse(line), offset }; offset += Buffer.byteLength(line) + 1; return row;
          });
          const matches = rows.filter(row => row.event.run_id === runId && row.event.event === "checkpoint_summary"), event = matches[0]?.event;
          if (matches.length !== 1 || event.skill !== "perf-checkpoint" || event.result !== "ok" || event.branch !== plan.scope.branch || event.mode !== plan.hook_mode
            || event.ts !== checkpoint.ts || !Number.isFinite(Date.parse(event.ts)) || Date.parse(event.ts) < started || Date.parse(event.ts) > now()) fail("STANDARD_CYCLE_CHECKPOINT_EVENT_UNCONFIRMED");
          await assertCurrent();
          if (shadowHash(scope()) !== shadowHash(plan.scope) || shadowHash(documents(session(plan.input.session_id), await audit(plan.input))) !== shadowHash(plan.documents)
            || !openGate(await gate(plan.hook_mode))) fail("STANDARD_CYCLE_CHECKPOINT_POSTCONDITION_FAILED");
          return emit("completed", "confirmed", { hook, event, event_offset: matches[0].offset, event_file: eventRelative },
            { cycle_checkpoint_completed: true }, [{ ref: "aidn:cycle-checkpoint/" + runId, sha256: shadowHash(event) }]);
        } catch (cause) {
          return emit("reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_CYCLE_CHECKPOINT_UNCONFIRMED", hook,
            diagnostic_sha256: artifactContentHash(String(cause.message)) });
        }
      });
    },
  });
}
