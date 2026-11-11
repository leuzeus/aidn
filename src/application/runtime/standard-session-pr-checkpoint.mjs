import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { sessionPrRecordPaths } from "../../core/workflow/standard-session-pr-record.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-session-pr-checkpoint-plan.v1.schema.json" with { type: "json" };
import inputSchema from "../../core/contracts/workflow-definition/standard-session-pr-checkpoint-input.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-session-pr-checkpoint-output.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
// Checkpoint only the three accepted canonical PR successor postimages.
// Historical delivery preimages remain immutable; DB-only creates no export.
export function createStandardSessionPrCheckpoint({ targetRoot, readSource, readCurrent, now = Date.now }) {
  if (typeof readSource !== "function" || typeof readCurrent !== "function") fail("STANDARD_PR_CHECKPOINT_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const port = source => createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-terminal", approvedPaths: source.postimages.map(row => "docs/audit/" + row.path) });
  function validateSource(value, input) {
    const rows = value?.postimages;
    if (checkShadowJson(value) || value?.record_operation_id !== input.record_operation_id || !/^S[0-9]{3,6}$/.test(value.session_id ?? "")
      || !/^[a-f0-9]{64}$/.test(value.material_sha256 ?? "") || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.parent_head ?? "")
      || typeof value.branch !== "string" || !Array.isArray(rows) || shadowHash(rows.map(row => row.path)) !== shadowHash(sessionPrRecordPaths(value.session_path)))
      fail("STANDARD_PR_CHECKPOINT_SOURCE_INVALID");
    for (const row of rows) {
      if (!/^[a-f0-9]{64}$/.test(row.sha256 ?? "") || artifacts.read(row.path, { required: true }).sha256 !== row.sha256
        || artifacts.metadataHash(row.path) !== row.metadata_sha256) fail("STANDARD_PR_CHECKPOINT_POSTIMAGE_CHANGED");
      if (artifacts.describe().state_mode !== "db-only" && readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", row.path)), { json: false, maxBytes: 1048576 }).sha256 !== row.sha256)
        fail("STANDARD_PR_CHECKPOINT_PROJECTION_CHANGED");
    }
    return value;
  }
  async function source(instance, input) {
    return validateSource(await readSource(instance, input), input);
  }
  async function prepare(instance, input, operationId, at, acquired = false) {
    if (!valid(input, inputSchema) || !/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_PR_CHECKPOINT_INPUT_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const value = await source(instance, input), git = port(value), observed = git.inspect();
    if (!observed.index_clean || observed.lock_present || observed.head !== value.parent_head || observed.branch !== value.branch)
      return { can_apply: false, reason_code: "STANDARD_PR_CHECKPOINT_GIT_REQUIRED" };
    const files = observed.changes.map(row => {
      const approved = value.postimages.find(file => "docs/audit/" + file.path === row.path);
      if (!approved || readAgentRunFile(agentRunPhysicalPath(path.join(root, row.path)), { json: false, maxBytes: 1048576 }).sha256 !== approved.sha256)
        fail("STANDARD_PR_CHECKPOINT_FOREIGN_CHANGE");
      return { path: row.path, sha256: approved.sha256 };
    });
    const plan = { contract_version: "standard-session-pr-checkpoint-plan.v1", operation_ref: "session_pr_checkpoint", input,
      operation_id: operationId, prepared_at_ms: at, session_id: value.session_id, state_mode: artifacts.describe().state_mode,
      source_sha256: shadowHash(value), git: { operation_kind: "terminal-objects-ref-index.v1", observed, files } };
    if (!valid(plan, planSchema)) fail("STANDARD_PR_CHECKPOINT_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const output = { contract_version: "standard-session-pr-checkpoint-output.v1", operation_ref: "session_pr_checkpoint", outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(output, outputSchema)) fail("STANDARD_PR_CHECKPOINT_OUTPUT_INVALID"); return output;
  }
  function completed(plan, result) {
    return emit("completed", result.effect_status, { record_operation_id: plan.input.record_operation_id, git: result },
      { session_pr_checkpoint_completed: true }, [{ ref: "git:session-pr-checkpoint/" + plan.operation_id, sha256: shadowHash(result) },
        { ref: "aidn:session-pr-record/" + plan.input.record_operation_id, sha256: plan.source_sha256 }]);
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    confirmsOriginal(instance, record, output) {
      // Only adopt the original, signed return. A Git postimage alone cannot
      // prove that the original application completed its final checks.
      const { can_apply, plan, plan_sha256 } = record.preview.prepared;
      if (!can_apply || !valid(plan, planSchema) || shadowHash(plan) !== plan_sha256
        || plan.operation_id !== record.operation_id || shadowHash(plan.input) !== shadowHash(record.preview.input)
        || !valid(output, outputSchema) || output.outcome !== "completed" || output.effect_status !== "confirmed"
        || !plan.git.files.length) return false;
      const value = validateSource(readSource(instance, plan.input), plan.input);
      if (shadowHash(value) !== plan.source_sha256 || value.session_id !== plan.session_id
        || value.branch !== plan.git.observed.branch || value.parent_head !== plan.git.observed.head
        || artifacts.describe().state_mode !== plan.state_mode
        || plan.git.files.some(file => !value.postimages.some(row => "docs/audit/" + row.path === file.path && row.sha256 === file.sha256))) return false;
      const proof = port(value).inspectCommit({ ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256 });
      if (proof.status !== "confirmed" || proof.lock_present) return false;
      return shadowHash(output) === shadowHash(completed(plan, { ...proof, effect_status: "confirmed" }));
    },
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      if (!valid(plan, planSchema) || !prepared?.can_apply || write !== true || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
        || typeof assertAuthorized !== "function")
        throw Object.assign(Error("STANDARD_PR_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_PR_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_PR_CHECKPOINT_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let attempted = false, result = null;
        try {
          const value = await source(instance, plan.input), git = port(value), gitPlan = { ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan };
          attempted = true; result = await git.commit(gitPlan, { assertAuthorized });
          const view = git.inspect(), head = result.commit_sha ?? result.head;
          if (!view.index_clean || view.lock_present || view.changes.length || view.head !== head || view.branch !== value.branch
            || plan.git.files.length && git.inspectCommit(gitPlan).status !== "confirmed" || !plan.git.files.length && head !== plan.git.observed.head
            || shadowHash(await source(instance, plan.input)) !== plan.source_sha256 || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_PR_CHECKPOINT_UNCONFIRMED");
          await assertAuthorized();
          return completed(plan, result);
        } catch (cause) {
          const noEffect = result?.effect_status !== "confirmed" && (!attempted || cause.effect_status === "no_effect");
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown", { reason_code: cause.code ?? "STANDARD_PR_CHECKPOINT_UNCONFIRMED" });
        }
      });
    },
  });
}
