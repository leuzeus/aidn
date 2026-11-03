import fs from "node:fs";
import path from "node:path";
import requestSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-request.v1.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-checkpoint-plan.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { baselinePromotionPaths } from "../../core/workflow/standard-baseline-promotion.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { runReloadCheckUseCase } from "./reload-check-use-case.mjs";
import { classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = value => !checkShadowJson(value) && !validateJsonSchema(value, planSchema, "$", { contractKind: "workflow-definition" }).length;
const cacheRelative = ".aidn/runtime/cache/reload-state.json";
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-baseline-promotion-checkpoint-output.v1", operation_ref: "baseline_promotion_checkpoint", outcome, effect_status, observations, facts, evidence_refs });

// Fixed host capability authenticates promotion, closure and prior Git receipts.
// Process data chooses none of the approved paths or executable operations.
export function createStandardBaselinePromotionCheckpoint({ targetRoot, readSource, promotion, readCurrent, now = Date.now }) {
  if (![readSource, promotion?.inspectContext, readCurrent].every(value => typeof value === "function")) fail("STANDARD_PROMOTION_CHECKPOINT_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const cacheFile = () => agentRunPhysicalPath(path.join(root, cacheRelative), { missing: true });
  const cacheHash = () => fs.existsSync(cacheFile()) ? readAgentRunFile(cacheFile(), { json: false, maxBytes: 1048576 }).sha256 : null;
  const metadataHash = files => shadowHash(files.map(row => ({ path: row.path, metadata_sha256: artifacts.metadataHash(row.path) })).sort((a, b) => a.path.localeCompare(b.path)));
  const port = files => createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-terminal", approvedPaths: files.map(row => "docs/audit/" + row.path) });
  async function source(instance, input) {
    const selected = await readSource(instance, input), request = selected?.request;
    if (checkShadowJson(selected) || Buffer.byteLength(JSON.stringify(selected)) > 196608 || !request
      || validateJsonSchema(request, requestSchema, "$", { contractKind: "workflow-definition" }).length
      || request.instance_id !== instance.instance_id || request.scope_id !== instance.scope_id || request.closure_operation_id !== input.closure_operation_id
      || !/^S[0-9]{3,6}$/.test(selected.session_id) || !/^C[0-9]{3,6}$/.test(request.cycle_id)
      || !request.cycle_path?.startsWith("cycles/" + request.cycle_id + "-")
      || !/^[a-f0-9]{64}$/.test(selected.record_context_sha256) || !/^[a-f0-9]{64}$/.test(selected.source_material_sha256) || !/^[a-f0-9]{64}$/.test(selected.completion_boundary_sha256)
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(selected.parent_head) || !Array.isArray(selected.approved_postimages)) fail("STANDARD_PROMOTION_CHECKPOINT_SOURCE_REQUIRED");
    const expected = [...baselinePromotionPaths, request.cycle_path + "/status.md"].sort(), files = selected.approved_postimages;
    if (files.length !== expected.length || new Set(files.map(row => row.path)).size !== files.length
      || shadowHash(files.map(row => row.path).sort()) !== shadowHash(expected)
      || files.some(row => !/^[a-f0-9]{64}$/.test(row.sha256))) fail("STANDARD_PROMOTION_CHECKPOINT_SCOPE_INVALID");
    const observed = await promotion.inspectContext(request);
    if (observed.blocked || observed.context.mode !== "COMMITTING" || observed.context.cycle_state !== "DONE"
      || observed.context.cycle_id !== request.cycle_id || observed.context.active_session !== selected.session_id
      || observed.completion_boundary_sha256 !== selected.completion_boundary_sha256) fail("STANDARD_PROMOTION_CHECKPOINT_SOURCE_CHANGED");
    for (const row of files) {
      if (artifacts.read(row.path, { required: true }).sha256 !== row.sha256) fail("STANDARD_PROMOTION_CHECKPOINT_CANONICAL_CHANGED");
      if (artifacts.describe().state_mode !== "db-only"
        && readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", row.path)), { json: false, maxBytes: 1048576 }).sha256 !== row.sha256)
        fail("STANDARD_PROMOTION_CHECKPOINT_PROJECTION_CHANGED");
    }
    return { selected, observed, files };
  }
  async function prepare(instance, input, operationId, at, acquired = false) {
    assertStandardOperationInput("baseline_promotion_checkpoint", input);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_PROMOTION_CHECKPOINT_OPERATION_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const { selected, observed, files } = await source(instance, input), view = port(files).inspect();
    if (observed.context_sha256 !== selected.record_context_sha256) return { can_apply: false, reason_code: "STANDARD_PROMOTION_CHECKPOINT_RECORDED_CONTEXT_CHANGED" };
    if (!view.index_clean || view.lock_present || view.head !== selected.parent_head || view.branch !== observed.context.branch)
      return { can_apply: false, reason_code: "STANDARD_PROMOTION_CHECKPOINT_GIT_REQUIRED" };
    const gitFiles = view.changes.map(row => {
      const approved = files.find(file => "docs/audit/" + file.path === row.path);
      if (!approved || readAgentRunFile(agentRunPhysicalPath(path.join(root, row.path)), { json: false, maxBytes: 1048576 }).sha256 !== approved.sha256)
        fail("STANDARD_PROMOTION_CHECKPOINT_PATH_NOT_APPROVED");
      return { path: row.path, sha256: approved.sha256 };
    });
    const plan = { contract_version: "standard-baseline-promotion-checkpoint-plan.v1", operation_ref: "baseline_promotion_checkpoint", input,
      operation_id: operationId, prepared_at_ms: at, session_id: selected.session_id, cycle_id: selected.request.cycle_id,
      cycle_path: selected.request.cycle_path, target_state: "DONE", state_mode: artifacts.describe().state_mode,
      context_sha256: observed.context_sha256, source_sha256: shadowHash(selected), postimage_metadata_sha256: metadataHash(files), cache_sha256: cacheHash(),
      git: { operation_kind: "terminal-objects-ref-index.v1", observed: view, files: gitFiles } };
    if (!valid(plan)) fail("STANDARD_PROMOTION_CHECKPOINT_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan, age = now() - plan?.prepared_at_ms;
      if (write !== true || !prepared?.can_apply || !valid(plan) || typeof assertAuthorized !== "function" || prepared.plan_sha256 !== expectPlan
        || shadowHash(plan) !== expectPlan || !Number.isSafeInteger(age) || age < 0 || age > 300000)
        throw Object.assign(Error("STANDARD_PROMOTION_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_PROMOTION_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized();
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_PROMOTION_CHECKPOINT_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let gitAttempted = false, cacheAttempted = false, result = null;
        try {
          const before = await source(instance, plan.input), git = port(before.files);
          const gitPlan = { ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan };
          gitAttempted = true; result = await git.commit(gitPlan, { assertAuthorized });
          const confirmed = () => {
            const view = git.inspect(), head = result.commit_sha ?? result.head;
            if (!view.index_clean || view.lock_present || view.changes.length || view.head !== head || view.branch !== plan.git.observed.branch
              || plan.git.files.length && (git.inspectCommit(gitPlan).status !== "confirmed" || head === plan.git.observed.head)
              || !plan.git.files.length && head !== plan.git.observed.head) fail("STANDARD_PROMOTION_CHECKPOINT_GIT_UNCONFIRMED");
          };
          confirmed(); await assertAuthorized();
          if (cacheHash() !== plan.cache_sha256) fail("STANDARD_PROMOTION_CHECKPOINT_CACHE_CHANGED");
          cacheAttempted = true;
          const completionCycleId = ["cycle", "intermediate"].includes(classifyAidnBranch(plan.git.observed.branch)) ? plan.cycle_id : null;
          const reload = await runReloadCheckUseCase({ targetRoot: root, completionCycleId, args: {
            cache: cacheRelative, stateMode: plan.state_mode, stateModeExplicit: true,
            indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: true } });
          const cache = readAgentRunFile(cacheFile(), { maxBytes: 1048576 }), head = result.commit_sha ?? result.head;
          if (reload.decision === "stop" || reload.cache_written !== true || reload.branch !== plan.git.observed.branch || reload.head_commit !== head
            || cache.value.branch !== reload.branch || cache.value.head_commit !== head) fail("STANDARD_PROMOTION_CHECKPOINT_RELOAD_UNCONFIRMED");
          const after = await source(instance, plan.input);
          if (shadowHash(after.selected) !== plan.source_sha256 || metadataHash(after.files) !== plan.postimage_metadata_sha256 || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_PROMOTION_CHECKPOINT_CONTEXT_CHANGED");
          confirmed(); await assertAuthorized();
          return emit("completed", "confirmed", { record_operation_id: plan.input.record_operation_id, cycle_id: plan.cycle_id, git: result,
            reload: { decision: reload.decision, cache_written: true, branch: reload.branch, head_commit: head, cache_sha256: cache.sha256 } },
            { baseline_checkpoint_completed: true, baseline_checkpoint_commit_created: result.status === "confirmed", baseline_promotion_completed: false },
            [{ ref: "git:baseline-promotion/" + plan.operation_id, sha256: shadowHash(result) }, { ref: cacheRelative, sha256: cache.sha256 }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== "confirmed" && !cacheAttempted && (!gitAttempted || result?.effect_status === "no_effect" || cause.effect_status === "no_effect");
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown", { reason_code: cause.code ?? "STANDARD_PROMOTION_CHECKPOINT_UNCONFIRMED" });
        }
      });
    },
  });
}
