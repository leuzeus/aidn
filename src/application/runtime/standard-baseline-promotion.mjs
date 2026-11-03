import path from "node:path";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { baselinePromotionPaths, assertBaselinePromotionSource, renderStandardBaselinePromotion } from "../../core/workflow/standard-baseline-promotion.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-input.v1.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-baseline-promotion-output.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
export const baselinePromotionSourceMaterialSha256 = source => shadowHash({ request: source.request, closure: { ...source.closure, output: shadowHash(source.closure.output) } });
// readRequest must authenticate the accepted human request and exact completed
// closure; observeProduct must read the current admitted product. They are
// trusted host capabilities, never selectors or permissions in process JSON.
export function createStandardBaselinePromotion({ targetRoot, readRequest, observeProduct, readCurrent, now = Date.now }) {
  if ([readRequest, observeProduct, readCurrent].some(value => typeof value !== "function")) fail("STANDARD_PROMOTION_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  function projections(changes, after = false) {
    if (artifacts.describe().state_mode === "db-only") return;
    for (const change of changes) if (readAgentRunFile(agentRunPhysicalPath(path.join(root, "docs/audit", change.path)), { json: false, maxBytes: 1048576 }).sha256 !== (after ? change.after_sha256 : change.before_sha256)) fail("STANDARD_PROMOTION_PROJECTION_STALE");
  }
  async function observe(request) {
    const inventory = artifacts.inventory(); if (!inventory.complete) fail("STANDARD_PROMOTION_INVENTORY_REQUIRED");
    const prewrite = await preWriteAdmit({ targetRoot: root, skill: "promote-baseline", promotionCycleId: request.cycle_id });
    if (!prewrite.ok || !["admitted", "admitted_with_warnings"].includes(prewrite.admission_status)
      || prewrite.checks.baseline_promotion_target?.pass !== true || prewrite.checks.baseline_promotion_target.cycle_id !== request.cycle_id)
      return { blocked: prewrite.checks.baseline_promotion_target?.reason_code ?? "STANDARD_PROMOTION_PREWRITE_BLOCKED" };
    const owners = artifacts.cycles().filter(row => row.cycle_id === request.cycle_id);
    if (owners.length !== 1 || owners[0].path !== request.cycle_path + "/status.md") fail("STANDARD_PROMOTION_CYCLE_IDENTITY_CHANGED");
    const scopeNames = inventory.paths.filter(name => name.startsWith(request.cycle_path + "/") || ["SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "RUNTIME-STATE.md"].includes(name));
    const documents = baselinePromotionPaths.map(name => artifacts.read(name, { required: true }));
    const cycleFields = analyzeStructuredArtifact(owners[0].content).key_values, fields = analyzeStructuredArtifact(documents[4].content).key_values;
    const product = await observeProduct(); if (!/^[a-f0-9]{64}$/.test(product) || product !== request.product_sha256) fail("STANDARD_PROMOTION_PRODUCT_CHANGED");
    const context = { mode: fields.mode, active_cycle: fields.active_cycle, active_session: fields.active_session,
      cycle_id: request.cycle_id, cycle_path: request.cycle_path, cycle_state: cycleFields.state, branch: createLocalGitAdapter().getCurrentBranch(root),
      state_mode: artifacts.describe().state_mode, product_sha256: product };
    const outside = scopeNames.map(name => ({ path: name, sha256: artifacts.read(name, { required: true }).sha256, metadata_sha256: artifacts.metadataHash(name) }));
    const boundary = shadowHash({ root, context, scopeNames, outside });
    const contextSha = shadowHash({ boundary, documents: documents.map(row => ({ path: row.path, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(row.path) })) });
    const completionBoundary = shadowHash({ root, context, outside: outside.filter(row => row.path !== "RUNTIME-STATE.md") });
    return { documents, context, boundary, completion_boundary_sha256: completionBoundary, outside, context_sha256: contextSha };
  }
  function assertPlan(plan) {
    if (!valid(plan, planSchema) || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(baselinePromotionPaths)
      || plan.changes.some(row => artifactContentHash(row.text_chunks.join("")) !== row.after_sha256)) fail("STANDARD_PROMOTION_PLAN_INVALID"); return plan;
  }
  async function prepare(instance, input, at, acquired = false, expected = null) {
    if (!valid(input, inputSchema)) fail("STANDARD_PROMOTION_INPUT_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const source = assertBaselinePromotionSource(await readRequest(instance, input), instance, input), observed = await observe(source.request);
    if (observed.blocked) return { can_apply: false, reason_code: observed.blocked };
    if (expected && (expected.source_material_sha256 !== baselinePromotionSourceMaterialSha256(source) || expected.context_sha256 !== observed.context_sha256)) fail("STANDARD_PROMOTION_SOURCE_STALE");
    const rendered = renderStandardBaselinePromotion({ request: source.request, context: observed.context, documents: observed.documents, preparedAt: at });
    const changes = rendered.changes.map(row => ({ ...row, before_metadata_sha256: artifacts.metadataHash(row.path) })); projections(changes);
    const plan = assertPlan({ contract_version: "standard-baseline-promotion-plan.v1", operation_ref: "baseline_promotion_record", input, prepared_at_ms: at,
      request: source.request, source_material_sha256: baselinePromotionSourceMaterialSha256(source), context_sha256: observed.context_sha256, boundary_sha256: observed.boundary, changes });
    const confirmed = await observe(source.request);
    if (confirmed.blocked || confirmed.context_sha256 !== observed.context_sha256) fail("STANDARD_PROMOTION_SOURCE_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const result = { contract_version: "standard-baseline-promotion-output.v1", operation_ref: "baseline_promotion_record", outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(result, outputSchema)) fail("STANDARD_PROMOTION_OUTPUT_INVALID"); return result;
  }
  return Object.freeze({ inspectContext: observe, observeContext: request => artifacts.ownerPending() ? Promise.resolve({ blocked: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" }) : observe(request), prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try { plan = assertPlan(prepared?.plan); const age = now() - plan.prepared_at_ms;
        if (write !== true || !prepared.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || typeof assertAuthorized !== "function"
          || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_PROMOTION_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized();
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true, plan);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_PROMOTION_SOURCE_STALE");
          for (const row of plan.changes) if (artifacts.read(row.path).sha256 !== row.before_sha256 || artifacts.metadataHash(row.path) !== row.before_metadata_sha256) fail("STANDARD_PROMOTION_SOURCE_STALE");
          await assertAuthorized();
          projections(plan.changes); const age = now() - plan.prepared_at_ms;
          if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_PLAN_EXPIRED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], metadata = [];
        try {
          for (const row of plan.changes) { metadata.push(artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.before_sha256,
            before_metadata_sha256: row.before_metadata_sha256, after: row.text_chunks.join("") }).metadata_sha256); committed.push(row.path); }
          artifacts.project(committed);
          for (const [i, row] of plan.changes.entries()) if (artifacts.read(row.path).sha256 !== row.after_sha256 || artifacts.metadataHash(row.path) !== metadata[i]) fail("STANDARD_PROMOTION_POSTIMAGE_UNCONFIRMED");
          projections(plan.changes, true); const after = await observe(plan.request);
          if (after.blocked || after.boundary !== plan.boundary_sha256 || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_PROMOTION_POSTCONDITION_FAILED");
          await assertAuthorized();
          return emit("completed", "confirmed", { decision_operation_id: plan.input.decision_operation_id, cycle_id: plan.request.cycle_id, version: plan.request.version,
            promotion_hook: "pending", committed, causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256, completion_boundary_sha256: after.completion_boundary_sha256 } },
            { baseline_recorded: true, baseline_promotion_completed: false }, plan.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })));
        } catch (cause) { return emit("reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_PROMOTION_UNCONFIRMED", committed }); }
      });
    },
  });
}
