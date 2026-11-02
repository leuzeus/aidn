import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { cyclePlanningBoundary } from "./standard-drift-recovery.mjs";
import { renderStandardCyclePlan } from "../../core/workflow/standard-cycle-planning.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { assertStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import schema from "../../core/contracts/workflow-definition/standard-cycle-plan-record-plan.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
const names = ["brief", "plan", "audit-spec", "traceability", "status"];
export function createStandardCyclePlanRecord({ targetRoot, readEvaluation, observeContext, readCurrent, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const boundary = (context, cyclePath) => cyclePlanningBoundary({ root, context }, cyclePath);
  const paths = cyclePath => [...names.map(name => `${cyclePath}/${name}.md`), "CURRENT-STATE.md"];
  function field(text, key, value) {
    const regex = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
    if ([...text.matchAll(regex)].length !== 1) fail("STANDARD_CYCLE_PLAN_FIELD_INVALID");
    return text.replace(regex, (_match, prefix) => `${prefix}${key}: ${value}`);
  }
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" }).length
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(paths(plan.cycle_path))
      || plan.changes.some(row => artifactContentHash(row.after) !== row.after_sha256)) fail("STANDARD_CYCLE_PLAN_RECORD_INVALID");
    assertStandardOperationInput("cycle_plan_record", plan.input); return plan;
  }
  function projections(changes) {
    if (artifacts.describe().database && artifacts.describe().state_mode === "db-only") return [];
    return changes.map(row => agentRunPhysicalPath(path.join(root, "docs/audit", row.path)));
  }
  async function prepare(instance, input, preparedAt, acquired = false) {
    assertStandardOperationInput("cycle_plan_record", input);
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const verified = await readEvaluation(instance, input), context = verified.context, cyclePath = context.cycle_path;
    if (verified.output.facts.cycle_plan_available !== true) fail("STANDARD_CYCLE_PLAN_EVALUATION_REQUIRED");
    const rows = paths(cyclePath).map(name => artifacts.read(name, { required: true }));
    const proposal = verified.output.observations.proposal;
    const generated = renderStandardCyclePlan(proposal, cyclePath, Object.fromEntries(rows.slice(0, 4).map(row => [path.posix.basename(row.path), row.content])));
    const at = new Date(preparedAt).toISOString();
    let status = rows[4].content;
    for (const [key, value] of Object.entries({ usage_matrix_scope: proposal.surface, usage_matrix_state: "DECLARED",
      usage_matrix_summary: proposal.usage_matrix.map(row => row.kind).join(", "), usage_matrix_rationale: "Planning declared; execution evidence pending.",
      "next step": "\n  - Evaluate core and adaptive DoR before implementation.", "last updated": at, updated_at: at })) status = field(status, key, value);
    let current = rows[5].content;
    for (const [key, value] of Object.entries({ first_plan_step: proposal.tasks[0].task, updated_at: at })) current = field(current, key, value);
    const contents = { ...generated, [rows[4].path]: status, [rows[5].path]: current };
    const changes = rows.map(row => ({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(row.path), after: contents[row.path], after_sha256: artifactContentHash(contents[row.path]) }));
    projections(changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== changes[index].before_sha256) fail("STANDARD_CYCLE_PLAN_PROJECTION_STALE"); });
    const plan = assertPlan({ contract_version: "standard-cycle-plan-record-plan.v1", operation_ref: "cycle_plan_record", input, prepared_at_ms: preparedAt,
      evaluation_sha256: verified.evaluation_sha256, context_sha256: verified.context_sha256, boundary_sha256: boundary(context, cyclePath), cycle_path: cyclePath, changes });
    if ((await observeContext()).context_sha256 !== verified.context_sha256) fail("STANDARD_CYCLE_PLAN_SOURCE_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan); const age = now() - plan.prepared_at_ms;
        if (write !== true || !prepared.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || typeof assertAuthorized !== "function"
          || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_CYCLE_PLAN_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          await assertAuthorized();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000
            || (await observeContext()).context_sha256 !== plan.context_sha256) fail("STANDARD_CYCLE_PLAN_SOURCE_STALE");
          for (const row of plan.changes) if (artifacts.read(row.path).sha256 !== row.before_sha256 || artifacts.metadataHash(row.path) !== row.before_metadata_sha256) fail("STANDARD_PREVIEW_CHANGED");
          projections(plan.changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].before_sha256) fail("STANDARD_CYCLE_PLAN_PROJECTION_STALE"); });
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_PLAN_SOURCE_STALE");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], metadata = [];
        try {
          for (const change of plan.changes) { metadata.push(artifacts.compareAndSwapPreservingMetadata(change).metadata_sha256); committed.push(change.path); }
          const projection = artifacts.project(committed);
          for (const [index, change] of plan.changes.entries()) if (artifacts.read(change.path).sha256 !== change.after_sha256 || artifacts.metadataHash(change.path) !== metadata[index]) fail("STANDARD_CYCLE_PLAN_POSTCONDITION_FAILED");
          for (const [index, file] of projections(plan.changes).entries()) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].after_sha256) fail("STANDARD_CYCLE_PLAN_PROJECTION_UNCONFIRMED");
          const after = await observeContext();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || boundary(after.context, plan.cycle_path) !== plan.boundary_sha256) fail("STANDARD_CYCLE_PLAN_POSTCONDITION_FAILED");
          return { contract_version: "standard-cycle-planning-output.v1", operation_ref: "cycle_plan_record", outcome: "completed", effect_status: "confirmed",
            facts: { cycle_plan_recorded: true }, observations: { evaluation_operation_id: plan.input.evaluation_operation_id, projection, readiness: "pending", implementation: "not_authorized",
              causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256, evaluation_sha256: plan.evaluation_sha256 }, committed },
            evidence_refs: plan.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })) };
        } catch (cause) {
          return { contract_version: "standard-cycle-planning-output.v1", operation_ref: "cycle_plan_record", outcome: "reconciliation_required", effect_status: "unknown", facts: {},
            observations: { committed, reason_code: cause.code ?? "STANDARD_CYCLE_PLAN_UNCONFIRMED" }, evidence_refs: [] };
        }
      });
    },
  });
}
