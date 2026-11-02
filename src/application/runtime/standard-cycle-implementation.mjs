import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { cycleReadinessBoundary } from "./standard-drift-recovery.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { assertStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import schema from "../../core/contracts/workflow-definition/standard-cycle-implementation-plan.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function createStandardCycleImplementation({ targetRoot, readEvaluation, observeContext, readCurrent, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const boundary = (context, cyclePath) => cycleReadinessBoundary({ root, context }, cyclePath);
  const paths = cyclePath => [`${cyclePath}/status.md`, "CURRENT-STATE.md"];
  function field(text, key, value) {
    const regex = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
    if ([...text.matchAll(regex)].length !== 1) fail("STANDARD_CYCLE_READINESS_FIELD_INVALID");
    return text.replace(regex, (_match, prefix) => `${prefix}${key}: ${value}`);
  }
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" }).length
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(paths(plan.cycle_path))
      || plan.changes.some(row => artifactContentHash(row.after) !== row.after_sha256)) fail("STANDARD_CYCLE_READINESS_RECORD_INVALID");
    assertStandardOperationInput("cycle_implementation_enter", plan.input); return plan;
  }
  function projections(changes) {
    if (artifacts.describe().database && artifacts.describe().state_mode === "db-only") return [];
    return changes.map(row => agentRunPhysicalPath(path.join(root, "docs/audit", row.path)));
  }
  async function prepare(instance, input, preparedAt, acquired = false) {
    assertStandardOperationInput("cycle_implementation_enter", input);
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const verified = await readEvaluation(instance, input), context = verified.context, cyclePath = context.cycle_path;
    if (verified.output.facts.cycle_readiness_satisfied !== true) fail("STANDARD_CYCLE_READINESS_EVALUATION_REQUIRED");
    const rows = paths(cyclePath).map(name => artifacts.read(name, { required: true }));
    const at = new Date(preparedAt).toISOString();
    let status = rows[0].content;
    for (const [key, value] of Object.entries({ state: "IMPLEMENTING", dor_state: "READY", dor_last_check: at, dor_checked_by: "standard-cycle-readiness",
      scope_frozen: "true", scope_freeze_reason: "Authenticated DoR satisfied; exact recorded task scope frozen.",
      "next step": "\n  - Execute only the admitted first task, subject to specific native write admission.", "last updated": at, updated_at: at })) status = field(status, key, value);
    let current = rows[1].content;
    for (const [key, value] of Object.entries({ dor_state: "READY", updated_at: at })) current = field(current, key, value);
    const contents = { [rows[0].path]: status, [rows[1].path]: current };
    const changes = rows.map(row => ({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(row.path), after: contents[row.path], after_sha256: artifactContentHash(contents[row.path]) }));
    projections(changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== changes[index].before_sha256) fail("STANDARD_CYCLE_READINESS_PROJECTION_STALE"); });
    const plan = assertPlan({ contract_version: "standard-cycle-implementation-plan.v1", operation_ref: "cycle_implementation_enter", input, prepared_at_ms: preparedAt,
      evaluation_sha256: verified.evaluation_sha256, context_sha256: verified.context_sha256, scope_sha256: verified.output.observations.scope_sha256,
      boundary_sha256: boundary(context, cyclePath), cycle_path: cyclePath, changes });
    if ((await observeContext()).context_sha256 !== verified.context_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan); const age = now() - plan.prepared_at_ms;
        if (write !== true || !prepared.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || typeof assertAuthorized !== "function"
          || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_CYCLE_READINESS_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          await assertAuthorized();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000
            || (await observeContext()).context_sha256 !== plan.context_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
          for (const row of plan.changes) if (artifacts.read(row.path).sha256 !== row.before_sha256 || artifacts.metadataHash(row.path) !== row.before_metadata_sha256) fail("STANDARD_PREVIEW_CHANGED");
          projections(plan.changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].before_sha256) fail("STANDARD_CYCLE_READINESS_PROJECTION_STALE"); });
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_READINESS_SOURCE_STALE");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], metadata = [];
        try {
          for (const change of plan.changes) { metadata.push(artifacts.compareAndSwapPreservingMetadata(change).metadata_sha256); committed.push(change.path); }
          const projection = artifacts.project(committed);
          for (const [index, change] of plan.changes.entries()) if (artifacts.read(change.path).sha256 !== change.after_sha256 || artifacts.metadataHash(change.path) !== metadata[index]) fail("STANDARD_CYCLE_READINESS_POSTCONDITION_FAILED");
          for (const [index, file] of projections(plan.changes).entries()) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].after_sha256) fail("STANDARD_CYCLE_READINESS_PROJECTION_UNCONFIRMED");
          const after = await observeContext();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || boundary(after.context, plan.cycle_path) !== plan.boundary_sha256) fail("STANDARD_CYCLE_READINESS_POSTCONDITION_FAILED");
          return { contract_version: "standard-cycle-readiness-output.v1", operation_ref: "cycle_implementation_enter", outcome: "completed", effect_status: "confirmed",
            facts: { cycle_dor_ready: true, cycle_implementation_started: true }, observations: { evaluation_operation_id: plan.input.evaluation_operation_id, projection, readiness: "satisfied", implementation: "specific_admission_required", scope_sha256: plan.scope_sha256,
              causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256, evaluation_sha256: plan.evaluation_sha256 }, committed },
            evidence_refs: plan.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })) };
        } catch (cause) {
          return { contract_version: "standard-cycle-readiness-output.v1", operation_ref: "cycle_implementation_enter", outcome: "reconciliation_required", effect_status: "unknown", facts: {},
            observations: { committed, reason_code: cause.code ?? "STANDARD_CYCLE_READINESS_UNCONFIRMED" }, evidence_refs: [] };
        }
      });
    },
  });
}
