import fs from "node:fs";
import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { runReloadCheckUseCase } from "./reload-check-use-case.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-session-preclose-checkpoint-plan.v1.schema.json" with { type: "json" };
import inputSchema from "../../core/contracts/workflow-definition/standard-session-preclose-checkpoint-input.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-session-preclose-checkpoint-output.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const cacheRelative = ".aidn/runtime/cache/reload-state.json";
// The trusted reader derives the finite latest postimages from accepted business
// writers. No model-selected Git path, shell command or session-profile expansion.
export function createStandardSessionPrecloseCheckpoint({ targetRoot, readSource, readCurrent, now = Date.now }) {
  if (typeof readSource !== "function" || typeof readCurrent !== "function") fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const cacheFile = () => agentRunPhysicalPath(path.join(root, cacheRelative), { missing: true });
  const cacheHash = () => fs.existsSync(cacheFile()) ? readAgentRunFile(cacheFile(), { json: false, maxBytes: 1048576 }).sha256 : null;
  const port = rows => createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-terminal", approvedPaths: rows.map(row => "docs/audit/" + row.path) });
  async function source(instance, input) {
    const value = await readSource(instance, input), rows = value?.postimages;
    if (checkShadowJson(value) || value?.closure_operation_id !== input.closure_operation_id || !/^S[0-9]+$/.test(value.session_id ?? "")
      || !/^[a-f0-9]{64}$/.test(value.material_sha256 ?? "") || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.parent_head ?? "")
      || typeof value.branch !== "string" || !Array.isArray(rows) || rows.length < 3 || rows.length > 128
      || new Set(rows.map(row => row.path)).size !== rows.length || rows.some(row => !/^[a-f0-9]{64}$/.test(row.sha256 ?? ""))) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_SOURCE_INVALID");
    for (const row of rows) {
      if (artifacts.read(row.path, { required: true }).sha256 !== row.sha256 || artifacts.metadataHash(row.path) !== row.metadata_sha256) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_POSTIMAGE_CHANGED");
      if (artifacts.describe().state_mode !== "db-only" && readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", row.path)), { json: false, maxBytes: 1048576 }).sha256 !== row.sha256)
        fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_PROJECTION_CHANGED");
    }
    return value;
  }
  async function prepare(instance, input, operationId, at, acquired = false) {
    if (!valid(input, inputSchema) || !/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_INPUT_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const value = await source(instance, input), git = port(value.postimages), observed = git.inspect();
    if (!observed.index_clean || observed.lock_present || observed.head !== value.parent_head || observed.branch !== value.branch)
      return { can_apply: false, reason_code: "STANDARD_SESSION_PRECLOSE_CHECKPOINT_GIT_REQUIRED" };
    const files = observed.changes.map(row => {
      const approved = value.postimages.find(file => "docs/audit/" + file.path === row.path);
      if (!approved || readAgentRunFile(agentRunPhysicalPath(path.join(root, row.path)), { json: false, maxBytes: 1048576 }).sha256 !== approved.sha256)
        fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_FOREIGN_CHANGE");
      return { path: row.path, sha256: approved.sha256 };
    });
    const plan = { contract_version: "standard-session-preclose-checkpoint-plan.v1", operation_ref: "session_preclose_checkpoint", input, operation_id: operationId,
      prepared_at_ms: at, session_id: value.session_id, state_mode: artifacts.describe().state_mode, source_sha256: shadowHash(value), cache_sha256: cacheHash(),
      git: { operation_kind: "terminal-objects-ref-index.v1", observed, files } };
    if (!valid(plan, planSchema)) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: "standard-session-preclose-checkpoint-output.v1", operation_ref: "session_preclose_checkpoint", outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_OUTPUT_INVALID"); return value;
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan, age = now() - plan?.prepared_at_ms;
      if (!valid(plan, planSchema) || !prepared?.can_apply || write !== true || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
        || typeof assertAuthorized !== "function" || !Number.isSafeInteger(age) || age < 0 || age > 300000)
        throw Object.assign(Error("STANDARD_SESSION_PRECLOSE_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_SESSION_PRECLOSE_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let attempted = false, cacheAttempted = false, result = null;
        try {
          const value = await source(instance, plan.input), git = port(value.postimages), gitPlan = { ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan };
          attempted = true; result = await git.commit(gitPlan, { assertAuthorized });
          const confirmed = () => {
            const observed = git.inspect(), head = result.commit_sha ?? result.head;
            if (!observed.index_clean || observed.lock_present || observed.changes.length || observed.head !== head || observed.branch !== value.branch
              || plan.git.files.length && git.inspectCommit(gitPlan).status !== "confirmed" || !plan.git.files.length && head !== plan.git.observed.head)
              fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_GIT_UNCONFIRMED");
          };
          confirmed(); await assertAuthorized();
          if (cacheHash() !== plan.cache_sha256) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_CACHE_CHANGED");
          cacheAttempted = true;
          const reload = await runReloadCheckUseCase({ targetRoot: root, completionCycleId: value.completion_cycle_id, args: { cache: cacheRelative,
            stateMode: plan.state_mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: true } });
          const cache = readAgentRunFile(cacheFile(), { maxBytes: 1048576 }), head = result.commit_sha ?? result.head;
          if (reload.decision === "stop" || reload.cache_written !== true || reload.branch !== value.branch || reload.head_commit !== head
            || cache.value.branch !== value.branch || cache.value.head_commit !== head || shadowHash(await source(instance, plan.input)) !== plan.source_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_SESSION_PRECLOSE_CHECKPOINT_RELOAD_UNCONFIRMED");
          confirmed(); await assertAuthorized();
          return emit("completed", "confirmed", { closure_operation_id: plan.input.closure_operation_id, git: result,
            reload: { decision: reload.decision, cache_written: true, branch: value.branch, head_commit: head, cache_sha256: cache.sha256 } },
          { session_preclose_checkpoint_completed: true, session_close_completed: false }, [{ ref: "git:session-preclose/" + plan.operation_id, sha256: shadowHash(result) }, { ref: cacheRelative, sha256: cache.sha256 }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== "confirmed" && !cacheAttempted && (!attempted || cause.effect_status === "no_effect");
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown", { reason_code: cause.code ?? "STANDARD_SESSION_PRECLOSE_CHECKPOINT_UNCONFIRMED" });
        }
      });
    },
  });
}
