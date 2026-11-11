import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import schema from "../../core/contracts/workflow-definition/standard-cycle-terminal-checkpoint-plan.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { captureCycleCloseCheckpoint, verifyCycleCloseCheckpoint } from "./standard-cycle-close-checkpoint.mjs";
import { runReloadCheckUseCase } from "./reload-check-use-case.mjs";
import { runCycleCloseAdmitUseCase } from "./cycle-close-admit-use-case.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const valid = plan => Number.isSafeInteger(plan?.prepared_at_ms) && !validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" }).length;
const cacheRelative = ".aidn/runtime/cache/reload-state.json";
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-cycle-terminal-checkpoint-output.v1", operation_ref: "cycle_terminal_checkpoint", outcome, effect_status, observations, facts, evidence_refs });

// The authenticated terminal writer supplies the reviewed Git postimages. This
// operation realizes that checkpoint; it neither closes a cycle nor grants a PR.
export function createStandardCycleTerminalCheckpoint({ targetRoot, readRecorded, observeContext, readCurrent, now = Date.now }) {
  if (![readRecorded, observeContext, readCurrent].every(f => typeof f === "function")) fail("STANDARD_TERMINAL_CHECKPOINT_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const cacheFile = () => agentRunPhysicalPath(path.join(root, cacheRelative), { missing: true });
  const cacheHash = () => fs.existsSync(cacheFile()) ? readAgentRunFile(cacheFile(), { json: false, maxBytes: 1048576 }).sha256 : null;
  const port = state => createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-terminal", approvedPaths: state.files.map(row => row.path) });
  async function prepare(instance, input, operationId, at, acquired = false) {
    assertStandardOperationInput("cycle_terminal_checkpoint", input);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_TERMINAL_CHECKPOINT_OPERATION_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const selected = await readRecorded(instance, input), observed = await observeContext(), context = observed.context;
    const state = selected.output?.observations?.causal_transition?.state;
    if (selected.record_operation_id !== input.closure_operation_id || selected.output?.outcome !== "completed"
      || selected.output.effect_status !== "confirmed" || selected.output.facts.cycle_terminal_recorded !== true
      || selected.output.facts.cycle_close_completed !== false || context.context_use !== "cycle_completion" || context.mode !== "COMMITTING"
      || context.cycle_state !== selected.plan.target_state || context.cycle_path !== selected.plan.cycle_path
      || !["DONE", "NO_GO", "DROPPED"].includes(context.cycle_state) || !state?.files || state.files.length > 128)
      fail("STANDARD_TERMINAL_CHECKPOINT_RECORDED_SOURCE_REQUIRED");
    const git = port(state), view = git.inspect();
    if (!view.index_clean || view.lock_present || context.branch !== view.branch || context.head !== view.head)
      return { can_apply: false, reason_code: "STANDARD_TERMINAL_CHECKPOINT_GIT_REQUIRED" };
    const current = captureCycleCloseCheckpoint({ root, context });
    // A previously performed explicit checkpoint is observed, never repeated.
    if (shadowHash(current) !== shadowHash(state) && !verifyCycleCloseCheckpoint({ root, context, state }))
      return { can_apply: false, reason_code: "STANDARD_TERMINAL_CHECKPOINT_POSTIMAGES_CHANGED" };
    const admission = await runCycleCloseAdmitUseCase({ targetRoot: root, mode: "COMMITTING" });
    // The accepted writer already passed the skill's first-write admission.
    // This terminal continuation uses the same fresh completion admission as
    // the final hook, with the authenticated writer/audit/decision source.
    if (admission.ok !== true || admission.action !== "cycle_close_allowed" || admission.target_cycle?.cycle_id !== context.cycle_id
      || admission.target_cycle?.state !== context.cycle_state || admission.active_session !== context.session_id || admission.branch !== context.branch)
      return { can_apply: false, reason_code: "STANDARD_TERMINAL_CHECKPOINT_ADMISSION_BLOCKED" };
    const files = view.changes.map(row => {
      const captured = state.files.find(file => file.path === row.path);
      if (!captured) fail("STANDARD_TERMINAL_CHECKPOINT_PATH_NOT_REVIEWED");
      return { ...captured };
    });
    const plan = { contract_version: "standard-cycle-terminal-checkpoint-plan.v1", operation_ref: "cycle_terminal_checkpoint", input,
      operation_id: operationId, prepared_at_ms: at, session_id: context.session_id, cycle_id: context.cycle_id, cycle_path: context.cycle_path,
      target_state: context.cycle_state, state_mode: artifacts.describe().state_mode, context_sha256: observed.context_sha256,
      source_sha256: shadowHash(selected), reviewed_state: state, cache_sha256: cacheHash(),
      git: { operation_kind: "terminal-objects-ref-index.v1", observed: view, files } };
    if (!valid(plan)) fail("STANDARD_TERMINAL_CHECKPOINT_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      if (write !== true || !prepared?.can_apply || !valid(plan) || typeof assertAuthorized !== "function"
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        throw Object.assign(new Error("STANDARD_TERMINAL_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_TERMINAL_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized();
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_TERMINAL_CHECKPOINT_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let gitAttempted = false, cacheAttempted = false, result = null;
        try {
          gitAttempted = true;
          result = await port(plan.reviewed_state).commit({ ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan }, { assertAuthorized });
          let observed = await observeContext();
          if (!verifyCycleCloseCheckpoint({ root, context: observed.context, state: plan.reviewed_state })) fail("STANDARD_TERMINAL_CHECKPOINT_GIT_UNCONFIRMED");
          await assertAuthorized(); cacheAttempted = true;
          const reload = await runReloadCheckUseCase({ targetRoot: root, completionCycleId: plan.cycle_id, args: {
            cache: cacheRelative, stateMode: plan.state_mode, stateModeExplicit: true,
            indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: true,
          } });
          const cache = readAgentRunFile(cacheFile(), { maxBytes: 1048576 });
          const head = result.commit_sha ?? result.head;
          if (reload.decision === "stop" || reload.cache_written !== true || reload.branch !== plan.git.observed.branch
            || reload.head_commit !== head || cache.value.branch !== reload.branch || cache.value.head_commit !== head)
            fail("STANDARD_TERMINAL_CHECKPOINT_RELOAD_UNCONFIRMED");
          observed = await observeContext();
          if (!verifyCycleCloseCheckpoint({ root, context: observed.context, state: plan.reviewed_state })
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_TERMINAL_CHECKPOINT_CONTEXT_CHANGED");
          await assertAuthorized();
          return emit("completed", "confirmed", { closure_operation_id: plan.input.closure_operation_id, cycle_id: plan.cycle_id, git: result,
            reload: { decision: reload.decision, cache_written: true, branch: reload.branch, head_commit: reload.head_commit, cache_sha256: cache.sha256 } },
            { cycle_terminal_checkpoint_completed: true, cycle_terminal_commit_created: result.status === "confirmed", cycle_close_completed: false },
            [{ ref: "git:terminal-cycle/" + plan.operation_id, sha256: shadowHash(result) }, { ref: cacheRelative, sha256: cache.sha256 }]);
        } catch (cause) {
          const gitConfirmed = result?.effect_status === "confirmed";
          const noEffect = !gitConfirmed && !cacheAttempted && (!gitAttempted || result?.effect_status === "no_effect" || cause.effect_status === "no_effect");
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown", { reason_code: cause.code ?? "STANDARD_TERMINAL_CHECKPOINT_UNCONFIRMED" });
        }
      });
    },
  });
}
