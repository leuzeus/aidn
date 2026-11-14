import path from "node:path";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { cycleVerificationBoundary } from "./standard-drift-recovery.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { assertStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import schema from "../../core/contracts/workflow-definition/standard-cycle-verification-plan.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function createStandardCycleVerification({ targetRoot, readEvaluation, observeContext, readCurrent, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const boundary = (context, cyclePath) => cycleVerificationBoundary({ root, context }, cyclePath);
  const paths = cyclePath => [`${cyclePath}/status.md`, `${cyclePath}/traceability.md`, "snapshots/context-snapshot.md", "CURRENT-STATE.md"];
  function field(text, key, value) {
    const regex = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
    if ([...text.matchAll(regex)].length !== 1) fail("STANDARD_CYCLE_VERIFICATION_FIELD_INVALID");
    return text.replace(regex, (_match, prefix) => `${prefix}${key}: ${value}`);
  }
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" }).length
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(paths(plan.cycle_path))
      || plan.changes.some(row => artifactContentHash(row.after) !== row.after_sha256)) fail("STANDARD_CYCLE_VERIFICATION_RECORD_INVALID");
    assertStandardOperationInput("cycle_verification_enter", plan.input); return plan;
  }
  function projections(changes) {
    if (artifacts.describe().database && artifacts.describe().state_mode === "db-only") return [];
    return changes.map(row => agentRunPhysicalPath(path.join(root, "docs/audit", row.path)));
  }
  async function prepare(instance, input, preparedAt, acquired = false, assertOwner = null) {
    assertStandardOperationInput("cycle_verification_enter", input);
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    assertOwner?.();
    const verified = await readEvaluation(instance, input, assertOwner === null ? {} : { assertOwner }), context = verified.context, cyclePath = context.cycle_path;
    assertOwner?.();
    if (verified.output.facts.cycle_validation_evidence_fresh !== true || verified.output.facts.cycle_work_complete !== true)
      return { can_apply: false, reason_code: "STANDARD_CYCLE_WORK_INCOMPLETE" };
    const admitted = await preWriteAdmit({ targetRoot: root, skill: "cycle-close" });
    if (admitted.ok !== true || !["admitted", "admitted_with_warnings"].includes(admitted.admission_status))
      return { can_apply: false, reason_code: "STANDARD_CYCLE_VERIFICATION_ADMISSION_BLOCKED" };
    const rows = paths(cyclePath).map(name => artifacts.read(name, { required: true }));
    const at = new Date(preparedAt).toISOString(), proof = verified.output.observations;
    const next = "Audit requirements, usage convergence, gaps, change requests and decisions; resolve remaining checks before any explicit closure.";
    let status = rows[0].content;
    for (const [key, value] of Object.entries({ state: "VERIFYING", "next step": "\n  - " + next, "last updated": at, updated_at: at })) status = field(status, key, value);
    const section = (text, title, body) => {
      const marker = "## " + title, count = text.split(marker).length - 1;
      if (count > 1) fail("STANDARD_CYCLE_VERIFICATION_SECTION_INVALID");
      const block = marker + "\n\n" + body + "\n";
      if (!count) return text.trimEnd() + "\n\n" + block;
      const start = text.indexOf(marker), end = text.indexOf("\n## ", start + marker.length);
      return text.slice(0, start) + block + (end < 0 ? "" : text.slice(end));
    };
    const verificationBody = "No lifecycle completion is inferred from these checks.\n\n" + String.fromCharCode(96).repeat(3) + "json\n"
      + JSON.stringify({ evaluation_operation_id: input.evaluation_operation_id, ...proof }, null, 2) + "\n" + String.fromCharCode(96).repeat(3);
    // A resumed cycle keeps its full prior verification document bytes. This is
    // a new current effect backed by fresh checks, not an imported old receipt.
    const trace = proof.canonical_resume_source && rows[1].content.includes("\n\n## Process verification evidence\n\n")
      ? rows[1].content + "\n\n## Process verification evidence\n\n" + verificationBody + "\n"
      : section(rows[1].content, "Process verification evidence", verificationBody);
    const snapshot = section(rows[2].content, "Process verification entry", "- Cycle: " + context.cycle_id + " (VERIFYING)\n- Checks: " + proof.status + " (" + proof.proof_class + ")\n- Evidence: " + input.evaluation_operation_id + "\n- Next action: " + next);
    let current = field(rows[3].content, "first_plan_step", next); current = field(current, "updated_at", at);
    const contents = { [rows[0].path]: status, [rows[1].path]: trace, [rows[2].path]: snapshot, [rows[3].path]: current };
    const changes = rows.map(row => ({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(row.path), after: contents[row.path], after_sha256: artifactContentHash(contents[row.path]) }));
    projections(changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== changes[index].before_sha256) fail("STANDARD_CYCLE_VERIFICATION_PROJECTION_STALE"); });
    const plan = assertPlan({ contract_version: "standard-cycle-verification-plan.v1", operation_ref: "cycle_verification_enter", input, prepared_at_ms: preparedAt,
      evaluation_sha256: verified.evaluation_sha256, context_sha256: verified.context_sha256, scope_sha256: verified.output.observations.scope_sha256,
      boundary_sha256: boundary(context, cyclePath), cycle_path: cyclePath, changes });
    if ((await observeContext()).context_sha256 !== verified.context_sha256) fail("STANDARD_CYCLE_VERIFICATION_SOURCE_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan);
        if (write !== true || !prepared.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || typeof assertAuthorized !== "function")
          fail("STANDARD_CYCLE_VERIFICATION_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        // This assertion belongs to the artifacts instance that owns the live
        // descriptor and lease. It is never authored or retained in JSON.
        const assertOwner = () => artifacts.assertLocalEffectOwner(expectPlan);
        try {
          assertOwner();
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true, assertOwner);
          assertOwner();
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          await assertAuthorized(); assertOwner();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
            || (await observeContext()).context_sha256 !== plan.context_sha256) fail("STANDARD_CYCLE_VERIFICATION_SOURCE_STALE");
          assertOwner();
          for (const row of plan.changes) if (artifacts.read(row.path).sha256 !== row.before_sha256 || artifacts.metadataHash(row.path) !== row.before_metadata_sha256) fail("STANDARD_PREVIEW_CHANGED");
          projections(plan.changes).forEach((file, index) => { if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].before_sha256) fail("STANDARD_CYCLE_VERIFICATION_PROJECTION_STALE"); });
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_VERIFICATION_SOURCE_STALE");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], metadata = [];
        try {
          for (const change of plan.changes) { assertOwner(); metadata.push(artifacts.compareAndSwapPreservingMetadata(change).metadata_sha256); committed.push(change.path); }
          const projection = artifacts.project(committed); assertOwner();
          for (const [index, change] of plan.changes.entries()) if (artifacts.read(change.path).sha256 !== change.after_sha256 || artifacts.metadataHash(change.path) !== metadata[index]) fail("STANDARD_CYCLE_VERIFICATION_POSTCONDITION_FAILED");
          for (const [index, file] of projections(plan.changes).entries()) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[index].after_sha256) fail("STANDARD_CYCLE_VERIFICATION_PROJECTION_UNCONFIRMED");
          const after = await observeContext(); assertOwner();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || boundary(after.context, plan.cycle_path) !== plan.boundary_sha256) fail("STANDARD_CYCLE_VERIFICATION_POSTCONDITION_FAILED");
          return { contract_version: "standard-cycle-verification-output.v1", operation_ref: "cycle_verification_enter", outcome: "completed", effect_status: "confirmed",
            facts: { cycle_verification_started: true }, observations: { evaluation_operation_id: plan.input.evaluation_operation_id, projection,
              verification: "pending_audit_and_explicit_closure", scope_sha256: plan.scope_sha256,
              causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256, evaluation_sha256: plan.evaluation_sha256 }, committed },
            evidence_refs: plan.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })) };
        } catch (cause) {
          return { contract_version: "standard-cycle-verification-output.v1", operation_ref: "cycle_verification_enter", outcome: "reconciliation_required", effect_status: "unknown", facts: {},
            observations: { committed, reason_code: cause.code ?? "STANDARD_CYCLE_VERIFICATION_UNCONFIRMED" }, evidence_refs: [] };
        }
      });
    },
  });
}
