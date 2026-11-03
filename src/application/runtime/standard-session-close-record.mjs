import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createStandardWorkflowOperations } from "./standard-workflow-operations.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { sessionClosePaths, renderStandardSessionClose } from "../../core/workflow/standard-session-close-render.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-session-close-input.v1.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-session-close-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-session-close-output.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const text = row => row.text_chunks.join("");
export function createStandardSessionCloseRecord({ targetRoot, readDecision, readCurrent, now = Date.now }) {
  if (typeof readDecision !== "function" || typeof readCurrent !== "function") fail("STANDARD_SESSION_CLOSE_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), operations = createStandardWorkflowOperations({ targetRoot });
  function assertPlan(plan) {
    if (!valid(plan, planSchema) || shadowHash(plan.changes.map(row => row.path)) !== shadowHash(sessionClosePaths(plan.session_path))
      || plan.changes.some(row => artifactContentHash(text(row)) !== row.after_sha256) || Buffer.byteLength(JSON.stringify(plan)) > 393216) fail("STANDARD_SESSION_CLOSE_PLAN_INVALID");
    return plan;
  }
  function assertDocuments(rows, after = false, metadata = null) {
    for (const [i, row] of rows.entries()) {
      const hash = after ? row.after_sha256 : row.before_sha256;
      if (artifacts.read(row.path, { required: true }).sha256 !== hash || artifacts.metadataHash(row.path) !== (metadata ? metadata[i] : row.before_metadata_sha256))
        fail("STANDARD_SESSION_CLOSE_DOCUMENT_CHANGED");
      if (artifacts.describe().state_mode !== "db-only" && readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, "docs/audit", row.path)), { json: false, maxBytes: 1048576 }).sha256 !== hash)
        fail("STANDARD_SESSION_CLOSE_PROJECTION_CHANGED");
    }
  }
  async function prepare(instance, input, at) {
    if (!valid(input, inputSchema)) fail("STANDARD_SESSION_CLOSE_INPUT_INVALID");
    if (artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const source = await readDecision(instance, input), { question, decision } = source;
    if (question.operation_id !== input.decision_operation_id) fail("STANDARD_SESSION_CLOSE_DECISION_CHANGED");
    const before = operations.observeScope();
    if (shadowHash(before) !== question.review.scope_sha256) fail("STANDARD_SESSION_CLOSE_SCOPE_CHANGED");
    const documents = sessionClosePaths(question.review.session_path).map(name => artifacts.read(name, { required: true }));
    const changes = renderStandardSessionClose({ question, decision, documents, preparedAt: at }).map(row => ({ ...row, before_metadata_sha256: artifacts.metadataHash(row.path) }));
    assertDocuments(changes);
    const plan = assertPlan({ contract_version: "standard-session-close-plan.v1", operation_ref: "session_close_record", input, prepared_at_ms: at,
      session_path: question.review.session_path, decision_material_sha256: shadowHash(source), context_sha256: question.review.context_sha256,
      scope_sha256: question.review.scope_sha256, changes });
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    const value = { contract_version: "standard-session-close-output.v1", operation_ref: "session_close_record", outcome, effect_status, observations, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail("STANDARD_SESSION_CLOSE_OUTPUT_INVALID"); return value;
  }
  return Object.freeze({ prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan); const age = now() - plan.prepared_at_ms;
        if (write !== true || !prepared.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan || typeof assertAuthorized !== "function"
          || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_SESSION_CLOSE_EXPLICIT_EFFECT_REQUIRED");
        await assertAuthorized();
        // Admission observes no pending owner. Reauthenticate after the external
        // grant, then acquire serialization and compare every canonical preimage.
        const fresh = await prepare(instance, plan.input, plan.prepared_at_ms);
        if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_SESSION_CLOSE_PREVIEW_CHANGED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || shadowHash(operations.observeScope()) !== plan.scope_sha256
            || now() - plan.prepared_at_ms > 300000) fail("STANDARD_SESSION_CLOSE_SOURCE_CHANGED");
          assertDocuments(plan.changes);
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], metadata = [];
        try {
          for (const row of plan.changes) { metadata.push(artifacts.compareAndSwapPreservingMetadata({ ...row, after: text(row) }).metadata_sha256); committed.push(row.path); }
          const projection = artifacts.project(committed); assertDocuments(plan.changes, true, metadata);
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || shadowHash(operations.observeScope()) !== plan.scope_sha256) fail("STANDARD_SESSION_CLOSE_POSTCONDITION_FAILED");
          return emit("completed", "confirmed", { decision_operation_id: plan.input.decision_operation_id, committed, projection, final_hook: "pending",
            postimages: plan.changes.map((row, i) => ({ path: row.path, sha256: row.after_sha256, metadata_sha256: metadata[i] })) },
          { session_close_report_recorded: true, session_close_completed: false }, plan.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })));
        } catch (cause) { return emit("reconciliation_required", "unknown", { committed, reason_code: cause.code ?? "STANDARD_SESSION_CLOSE_EFFECT_UNCONFIRMED" }); }
      });
    },
  });
}
