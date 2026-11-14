import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { sessionClosePaths } from "../../core/workflow/standard-session-close-render.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-session-delivery-checkpoint-plan.v1.schema.json" with { type: "json" };
import inputSchema from "../../core/contracts/workflow-definition/standard-session-delivery-checkpoint-input.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-session-delivery-checkpoint-output.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
// A confirmed final hook owns exactly three final CAS postimages. This operation
// checkpoints them for delivery, without closing again, exporting DB-only state,
// resetting unrelated files, integrating a branch or declaring a fresh cache.
export function createStandardSessionDeliveryCheckpoint({ targetRoot, readSource, readCurrent, now = Date.now }) {
  if (typeof readSource !== "function" || typeof readCurrent !== "function") fail("STANDARD_SESSION_DELIVERY_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const port = source => createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-terminal", approvedPaths: source.postimages.map(row => "docs/audit/" + row.path) });
  async function source(instance, input) {
    const value = await readSource(instance, input), rows = value?.postimages;
    if (checkShadowJson(value) || value?.finalization_operation_id !== input.finalization_operation_id || !/^S[0-9]{3,6}$/.test(value.session_id ?? "")
      || !/^[a-f0-9]{64}$/.test(value.material_sha256 ?? "") || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.parent_head ?? "")
      || typeof value.branch !== "string" || !Array.isArray(rows) || shadowHash(rows.map(row => row.path)) !== shadowHash(sessionClosePaths(value.session_path)))
      fail("STANDARD_SESSION_DELIVERY_SOURCE_INVALID");
    for (const row of rows) {
      if (!/^[a-f0-9]{64}$/.test(row.sha256 ?? "") || artifacts.read(row.path, { required: true }).sha256 !== row.sha256
        || artifacts.metadataHash(row.path) !== row.metadata_sha256) fail("STANDARD_SESSION_DELIVERY_POSTIMAGE_CHANGED");
      if (artifacts.describe().state_mode !== "db-only" && readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", row.path)), { json: false, maxBytes: 1048576 }).sha256 !== row.sha256)
        fail("STANDARD_SESSION_DELIVERY_PROJECTION_CHANGED");
    }
    return value;
  }
  async function prepare(instance, input, operationId, at, acquired = false) {
    if (!valid(input, inputSchema) || !/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_SESSION_DELIVERY_INPUT_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const value = await source(instance, input), git = port(value), observed = git.inspect();
    if (!observed.index_clean || observed.lock_present || observed.head !== value.parent_head || observed.branch !== value.branch)
      return { can_apply: false, reason_code: "STANDARD_SESSION_DELIVERY_GIT_REQUIRED" };
    const files = observed.changes.map(row => {
      const approved = value.postimages.find(file => "docs/audit/" + file.path === row.path);
      if (!approved || readAgentRunFile(agentRunPhysicalPath(path.join(root, row.path)), { json: false, maxBytes: 1048576 }).sha256 !== approved.sha256)
        fail("STANDARD_SESSION_DELIVERY_FOREIGN_CHANGE");
      return { path: row.path, sha256: approved.sha256 };
    });
    const plan = { contract_version: "standard-session-delivery-checkpoint-plan.v1", operation_ref: "session_delivery_checkpoint", input,
      operation_id: operationId, prepared_at_ms: at, session_id: value.session_id, state_mode: artifacts.describe().state_mode,
      source_sha256: shadowHash(value), git: { operation_kind: "terminal-objects-ref-index.v1", observed, files } };
    if (!valid(plan, planSchema)) fail("STANDARD_SESSION_DELIVERY_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const output = { contract_version: "standard-session-delivery-checkpoint-output.v1", operation_ref: "session_delivery_checkpoint", outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(output, outputSchema)) fail("STANDARD_SESSION_DELIVERY_OUTPUT_INVALID"); return output;
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      if (!valid(plan, planSchema) || !prepared?.can_apply || write !== true || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
        || typeof assertAuthorized !== "function")
        throw Object.assign(Error("STANDARD_SESSION_DELIVERY_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_SESSION_DELIVERY_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_SESSION_DELIVERY_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let attempted = false, result = null;
        try {
          const value = await source(instance, plan.input), git = port(value), gitPlan = { ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan };
          attempted = true; result = await git.commit(gitPlan, { assertAuthorized });
          const view = git.inspect(), head = result.commit_sha ?? result.head;
          if (!view.index_clean || view.lock_present || view.changes.length || view.head !== head || view.branch !== value.branch
            || plan.git.files.length && git.inspectCommit(gitPlan).status !== "confirmed" || !plan.git.files.length && head !== plan.git.observed.head
            || shadowHash(await source(instance, plan.input)) !== plan.source_sha256 || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_SESSION_DELIVERY_UNCONFIRMED");
          await assertAuthorized();
          return emit("completed", result.effect_status, { finalization_operation_id: plan.input.finalization_operation_id, git: result },
            { session_delivery_checkpoint_completed: true }, [{ ref: "git:session-delivery/" + plan.operation_id, sha256: shadowHash(result) },
              { ref: "aidn:session-finalization/" + plan.input.finalization_operation_id, sha256: plan.source_sha256 }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== "confirmed" && (!attempted || cause.effect_status === "no_effect");
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown", { reason_code: cause.code ?? "STANDARD_SESSION_DELIVERY_UNCONFIRMED" });
        }
      });
    },
  });
}
