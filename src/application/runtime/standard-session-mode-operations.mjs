import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSkillHookUseCase } from "./skill-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import modePlanSchema from "../../core/contracts/workflow-definition/standard-session-mode-plan.v1.schema.json" with { type: "json" };
import startPlanSchema from "../../core/contracts/workflow-definition/standard-session-start-plan.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
const modes = ["THINKING", "EXPLORING", "COMMITTING"];
const emit = (operation, outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-operation-output.v2", operation_ref: operation, outcome, effect_status, observations, facts, evidence_refs });
export function createStandardSessionModeOperations({ artifacts, scope, admission, replaceField, now }) {
  const root = artifacts.root;
  function session(id) {
    if (!/^S[0-9]{3,6}$/.test(id)) fail("STANDARD_SESSION_REFERENCE_INVALID");
    const current = artifacts.read("CURRENT-STATE.md", { required: true }), row = artifacts.read(`sessions/${id}.md`, { required: true });
    const state = analyzeStructuredArtifact(current.content).key_values, metadata = parseSessionMetadata(row.content);
    if (state.active_session !== id || state.session_branch !== metadata.session_branch) fail("STANDARD_ACTIVE_SESSION_CHANGED");
    return { current, row, state, metadata, declared_mode: analyzeStructuredArtifact(row.content).key_values.mode ?? null };
  }
  function assertPlan(plan) {
    if (validateJsonSchema(plan, modePlanSchema, "$", { contractKind: "workflow-definition" }).length
      || plan.changes[0].path !== `sessions/${plan.input.session_id}.md` || plan.changes[1].path !== "CURRENT-STATE.md"
      || plan.changes.some(change => artifactContentHash(change.after) !== change.after_sha256)) fail("STANDARD_MODE_PLAN_INVALID");
  }
  async function prepareMode(input, preparedAt, acquired = false) {
    if (!input || Object.keys(input).sort().join(",") !== "mode,session_id" || !modes.includes(input.mode)) fail("STANDARD_MODE_INPUT_INVALID");
    const context = scope(), observed = session(input.session_id), admitted = await admission(input.mode);
    if ((!acquired && artifacts.ownerPending()) || !admitted.allowed || !["resume_current_session", "resume_current_cycle"].includes(admitted.lifecycle.action))
      return { can_apply: false, admission: admitted };
    if (observed.declared_mode !== "UNKNOWN" || observed.state.mode !== "UNKNOWN") return { can_apply: false, reason_code: "STANDARD_MODE_ALREADY_SELECTED" };
    const at = new Date(preparedAt).toISOString();
    let text = replaceField(replaceField(observed.row.content, "mode", input.mode), "updated_at", at);
    text = text.replace(/\[[ xX]\] (THINKING|EXPLORING|COMMITTING)/g, (_all, value) => `[${input.mode === value ? "x" : " "}] ${value}`);
    if (buildCanonicalFromMarkdown(text, { relativePath: observed.row.path, classification: { kind: "session", family: "normative" } }).contract_status !== "conformant") fail("STANDARD_MODE_SESSION_NOT_CONFORMANT");
    const current = replaceField(replaceField(observed.current.content, "mode", input.mode), "updated_at", at);
    const changes = [{ path: observed.row.path, before_sha256: observed.row.sha256, after: text }, { path: observed.current.path, before_sha256: observed.current.sha256, after: current }]
      .map(change => ({ ...change, after_sha256: artifactContentHash(change.after) }));
    const plan = { contract_version: "standard-session-mode-plan.v1", operation_ref: "session_mode_apply", input, prepared_at_ms: preparedAt, scope: context, changes };
    assertPlan(plan); return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function explicit(prepared, write, expected) {
    if (write !== true || !prepared?.can_apply || prepared.plan_sha256 !== expected || shadowHash(prepared.plan) !== expected) fail("STANDARD_EXPLICIT_EFFECT_REQUIRED");
    if (!Number.isSafeInteger(prepared.plan?.prepared_at_ms) || prepared.plan.prepared_at_ms < 0) fail("STANDARD_EXPLICIT_EFFECT_REQUIRED");
  }
  async function postMode(plan) {
    const observed = session(plan.input.session_id), admitted = await admission(plan.input.mode), context = scope();
    return { satisfied: observed.metadata.mode === plan.input.mode && observed.state.mode === plan.input.mode && admitted.allowed
      && ["resume_current_session", "resume_current_cycle"].includes(admitted.lifecycle.action)
      && context.branch === plan.scope.branch && context.head === plan.scope.head
      && plan.changes.every(change => artifacts.read(change.path).sha256 === change.after_sha256), admission: admitted };
  }
  async function prepareStart(input, preparedAt, acquired = false) {
    assertStandardOperationInput("session_start_finalize", input);
    const context = scope(), observed = session(input.session_id), mode = observed.metadata.mode, admitted = await admission(mode);
    if ((!acquired && artifacts.ownerPending()) || !modes.includes(mode) || observed.state.mode !== mode || !admitted.allowed
      || !["resume_current_session", "resume_current_cycle"].includes(admitted.lifecycle.action)) return { can_apply: false, admission: admitted };
    const plan = { contract_version: "standard-session-start-plan.v1", operation_ref: "session_start_finalize", input, prepared_at_ms: preparedAt,
      scope: context, mode, session_sha256: observed.row.sha256, current_sha256: observed.current.sha256,
      effects: ["checkpoint", "runtime_index", "constraint_loop_if_required", "context_telemetry"] };
    if (validateJsonSchema(plan, startPlanSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_START_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function hookEvidence(payload, id) {
    const hook = payload?.workflow_hook, checkpoint = hook?.checkpoint;
    if (payload?.ok !== true || payload.result !== "ok" || !["resume_current_session", "resume_current_cycle"].includes(payload.action)
      || payload.admission?.active_session !== id || hook?.ok !== true || hook.result !== "ok" || hook.checkpoint_error || !checkpoint
      || checkpoint.ok !== true || checkpoint.summary?.result !== "ok" || checkpoint.gate?.result !== "ok" || checkpoint.reload?.decision === "stop"
      || checkpoint.index_sync_check?.enabled && checkpoint.index_sync_check.in_sync !== true
      || hook.summary?.repair_layer_blocking === true || hook.constraint_loop_error
      || hook.constraint_loop_required && !hook.constraint_loop) fail("STANDARD_START_HOOK_POSTCONDITION_FAILED");
    const files = [hook.event_file, hook.run_id_file];
    if (hook.constraint_loop_required) {
      const names = ["report_file", "thresholds_file", "actions_file", "history_file", "trend_file", "trend_thresholds_file", "trend_summary_file", "lot_plan_file", "lot_advance_file", "lot_summary_file", "summary_file"];
      for (const name of names) { if (typeof hook.constraint_loop.artifacts?.[name] !== "string") fail("STANDARD_START_CONSTRAINT_PROOF_MISSING"); files.push(hook.constraint_loop.artifacts[name]); }
    }
    return [...new Set(files)].map(file => {
      const physical = agentRunPhysicalPath(file), relative = path.relative(root, physical).replaceAll("\\", "/");
      if (!relative.startsWith(".aidn/runtime/") && !relative.startsWith("docs/audit/")) fail("STANDARD_START_EVIDENCE_SCOPE_INVALID");
      return { ref: relative, sha256: readAgentRunFile(physical, { json: false, maxBytes: 4194304 }).sha256 };
    });
  }
  return Object.freeze({
    prepareMode: input => prepareMode(input, now()),
    async applyMode(prepared, { write = false, expectPlan } = {}) {
      explicit(prepared, write, expectPlan); assertPlan(prepared.plan);
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try { const fresh = await prepareMode(prepared.plan.input, prepared.plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [];
        try {
          for (const change of prepared.plan.changes) { artifacts.compareAndSwap(change); committed.push(change.path); }
          const after = await postMode(prepared.plan); if (!after.satisfied) fail("STANDARD_MODE_POSTCONDITION_FAILED");
          const projection = artifacts.project(committed);
          return emit("session_mode_apply", "completed", "confirmed", { after, projection, committed }, { session_mode_applied: true, session_mode_pending: false },
            prepared.plan.changes.map(change => ({ ref: "docs/audit/" + change.path, sha256: change.after_sha256 })));
        } catch (cause) { return emit("session_mode_apply", "reconciliation_required", "unknown", { committed, reason_code: cause.code ?? "STANDARD_MODE_EFFECT_UNCONFIRMED" }); }
      });
    },
    prepareStart: input => prepareStart(input, now()),
    async finalizeStart(prepared, { write = false, expectPlan } = {}) {
      explicit(prepared, write, expectPlan);
      if (validateJsonSchema(prepared.plan, startPlanSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_START_PLAN_INVALID");
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try { const fresh = await prepareStart(prepared.plan.input, prepared.plan.prepared_at_ms, true);
          // The owner just acquired by this call is not an unresolved owner.
          if (fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let result = null;
        try {
          result = runSkillHookUseCase({ args: { skill: "start-session", mode: prepared.plan.mode, strict: prepared.plan.scope.persistence.state_mode !== "files", noAutoSkipGate: false },
            perfDir: fileURLToPath(new URL("../../../tools/perf/", import.meta.url)), targetRoot: root, processAdapter: createLocalProcessAdapter() });
          const evidence = hookEvidence(result.payload, prepared.plan.input.session_id), observed = session(prepared.plan.input.session_id);
          if (observed.metadata.mode !== prepared.plan.mode || observed.state.mode !== prepared.plan.mode) fail("STANDARD_START_MODE_CHANGED");
          return emit("session_start_finalize", "completed", "confirmed", { hook: result, observed_artifacts: evidence }, { session_started: true }, evidence);
        } catch (cause) { return emit("session_start_finalize", "reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_START_EFFECT_UNCONFIRMED", hook: result,
          diagnostic_sha256: artifactContentHash(String(cause.message)) }); }
      });
    },
  });
}
