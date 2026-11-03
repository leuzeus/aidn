import path from "node:path";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { cycleCloseBoundary } from "./standard-drift-recovery.mjs";
import { cycleClosePaths, renderStandardCycleClose } from "../../core/workflow/standard-cycle-close-render.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-cycle-close-plan.v1.schema.json" with { type: "json" };
import inputSchema from "../../core/contracts/workflow-definition/standard-cycle-close-input.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(new Error(code), { code }); };
const afterText = row => row.text_chunks.join("");

// The decision reader is a trusted host capability, not a claim in process JSON.
// It must authenticate the accepted human proof and current audit.
export function createStandardCycleCloseRecord({ targetRoot, readDecision, observeContext, readCurrent, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  function assertInput(input) {
    if (checkShadowJson(input) || validateJsonSchema(input, inputSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_CYCLE_CLOSE_INPUT_INVALID");
  }
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(cycleClosePaths(plan.cycle_path))
      || plan.changes.some(row => artifactContentHash(afterText(row)) !== row.after_sha256)
      || Buffer.byteLength(JSON.stringify(plan)) > 393216) fail("STANDARD_CYCLE_CLOSE_PLAN_INVALID");
    return plan;
  }
  function projections(changes) {
    if (artifacts.describe().database && artifacts.describe().state_mode === "db-only") return [];
    return changes.map(row => agentRunPhysicalPath(path.join(root, "docs/audit", row.path)));
  }
  const boundary = context => cycleCloseBoundary({ root, context }, context.cycle_path);
  const materialHash = verified => shadowHash({ question: verified.question, decision: verified.decision, report: verified.report });
  async function prepare(instance, input, at, acquired = false, expected = null) {
    assertInput(input);
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const verified = await readDecision(instance, input), observed = await observeContext(), context = observed.context;
    if (expected && (materialHash(verified) !== expected.decision_material_sha256 || observed.context_sha256 !== expected.context_sha256)) fail("STANDARD_CYCLE_CLOSE_SOURCE_STALE");
    if (context.cycle_state !== "VERIFYING") return { can_apply: false, reason_code: "STANDARD_CYCLE_CLOSE_VERIFYING_REQUIRED" };
    if (verified.question.operation_id !== input.decision_operation_id) fail("STANDARD_CYCLE_CLOSE_DECISION_CHANGED");
    const admission = await preWriteAdmit({ targetRoot: root, skill: "cycle-close" });
    if (admission.ok !== true || !["admitted", "admitted_with_warnings"].includes(admission.admission_status))
      return { can_apply: false, reason_code: "STANDARD_CYCLE_CLOSE_ADMISSION_BLOCKED" };
    const documents = cycleClosePaths(context.cycle_path).map(name => artifacts.read(name, { required: true }));
    const rendered = renderStandardCycleClose({ cyclePath: context.cycle_path, context, question: verified.question, decision: verified.decision, report: verified.report,
      decisionOperationId: input.decision_operation_id, documents, preparedAt: at });
    const changes = rendered.changes.map(row => ({ ...row, before_metadata_sha256: artifacts.metadataHash(row.path) }));
    projections(changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== changes[index].before_sha256) fail("STANDARD_CYCLE_CLOSE_PROJECTION_STALE"); });
    const projected = structuredClone(context);
    projected.documents = projected.documents.map(row => {
      const change = changes.find(change => row.ref === "audit:" + change.path);
      return change ? { ...row, content: afterText(change), sha256: change.after_sha256 } : row;
    });
    // Reserve the bounded terminal-ownership descriptor without truncating text.
    if (Buffer.byteLength(JSON.stringify(projected)) + 1024 > 196608) fail("STANDARD_CYCLE_CLOSE_POSTCONTEXT_LIMIT");
    const plan = assertPlan({ contract_version: "standard-cycle-close-plan.v1", operation_ref: "cycle_close_record", input, prepared_at_ms: at,
      decision_material_sha256: materialHash(verified), context_sha256: observed.context_sha256, scope_sha256: verified.question.review.scope_sha256,
      boundary_sha256: boundary(context), cycle_path: context.cycle_path, target_state: rendered.target_state, changes });
    if ((await observeContext()).context_sha256 !== observed.context_sha256) fail("STANDARD_CYCLE_CLOSE_SOURCE_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan); const age = now() - plan.prepared_at_ms;
        if (write !== true || !prepared.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || typeof assertAuthorized !== "function"
          || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_CYCLE_CLOSE_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized();
          // Rebuild once after the external grant. This fresh observation
          // authenticates human/audit material, admission, context and all
          // postimages; nothing is cached across calls or authorizations.
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true, plan);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
            || (await observeContext()).context_sha256 !== plan.context_sha256) fail("STANDARD_CYCLE_CLOSE_SOURCE_STALE");
          for (const row of plan.changes) if (artifacts.read(row.path).sha256 !== row.before_sha256 || artifacts.metadataHash(row.path) !== row.before_metadata_sha256) fail("STANDARD_PREVIEW_CHANGED");
          projections(plan.changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].before_sha256) fail("STANDARD_CYCLE_CLOSE_PROJECTION_STALE"); });
          const effectAge = now() - plan.prepared_at_ms;
          if (!Number.isSafeInteger(effectAge) || effectAge < 0 || effectAge > 300000) fail("STANDARD_PLAN_EXPIRED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], metadata = [];
        try {
          for (const change of plan.changes) {
            metadata.push(artifacts.compareAndSwapPreservingMetadata({ ...change, after: afterText(change) }).metadata_sha256); committed.push(change.path);
          }
          const projection = artifacts.project(committed);
          for (const [index, change] of plan.changes.entries()) if (artifacts.read(change.path).sha256 !== change.after_sha256 || artifacts.metadataHash(change.path) !== metadata[index]) fail("STANDARD_CYCLE_CLOSE_POSTCONDITION_FAILED");
          for (const [index, file] of projections(plan.changes).entries()) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].after_sha256) fail("STANDARD_CYCLE_CLOSE_PROJECTION_UNCONFIRMED");
          const after = await observeContext();
          if (after.context.cycle_state !== plan.target_state || after.context.context_use !== "cycle_completion"
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || boundary(after.context) !== plan.boundary_sha256) fail("STANDARD_CYCLE_CLOSE_POSTCONDITION_FAILED");
          return { contract_version: "standard-cycle-close-output.v1", operation_ref: "cycle_close_record", outcome: "completed", effect_status: "confirmed",
            facts: { cycle_terminal_recorded: true, cycle_retained: plan.target_state === "DONE", cycle_close_completed: false },
            observations: { decision_operation_id: plan.input.decision_operation_id, target_state: plan.target_state, closure_hook: "pending", skill_completion: "pending", projection,
              scope_sha256: plan.scope_sha256, committed, causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256, decision_material_sha256: plan.decision_material_sha256 } },
            evidence_refs: plan.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })) };
        } catch (cause) {
          return { contract_version: "standard-cycle-close-output.v1", operation_ref: "cycle_close_record", outcome: "reconciliation_required", effect_status: "unknown", facts: {},
            observations: { committed, reason_code: cause.code ?? "STANDARD_CYCLE_CLOSE_UNCONFIRMED" }, evidence_refs: [] };
        }
      });
    },
  });
}
