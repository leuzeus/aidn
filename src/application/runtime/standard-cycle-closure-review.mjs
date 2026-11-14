import { observeStandardCycleAudit } from "../../core/workflow/standard-cycle-audit.mjs";
import { assertCycleClosureReview, cycleClosureChoices } from "../../core/workflow/standard-cycle-closure-decision.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-cycle-closure-review-plan.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };

// readAudit is a host capability: it must authenticate the accepted audit and
// native result, then reread current canonical material and physical checks.
// No caller-authored JSON can substitute for that capability.
export function createStandardCycleClosureReview({ readAudit }) {
  if (typeof readAudit !== "function") fail("STANDARD_CLOSURE_AUDIT_AUTHORITY_REQUIRED");
  async function inspect(instance, input, operationId) {
    if (!input || checkShadowJson(input) || Object.keys(input).join(",") !== "audit_operation_id" || !/^op_[a-f0-9]{40}$/.test(input.audit_operation_id ?? "")
      || !/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_CLOSURE_INPUT_INVALID");
    const verified = await readAudit(instance, input), { native, current, record, output } = verified;
    const report = native.authenticated.report, context = native.context;
    if (record.operation_id !== input.audit_operation_id || record.intent.binding_ref !== "cycle_audit_evaluate"
      || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
      || output.facts.cycle_audit_observed !== true || output.facts.cycle_closure_decision_required !== true
      || !/^[a-f0-9]{64}$/.test(current.material.context_sha256 ?? "")) fail("STANDARD_CLOSURE_ACCEPTED_AUDIT_REQUIRED");
    const observed = observeStandardCycleAudit({ report, context, contextSha256: shadowHash(context), producer: native.authenticated.producer, evidenceRefs: output.evidence_refs });
    if (shadowHash(observed) !== shadowHash(output)) fail("STANDARD_CLOSURE_AUDIT_CHANGED");
    const review = assertCycleClosureReview({ session_id: context.session_id, cycle_id: context.cycle_id, audit_operation_id: input.audit_operation_id,
      audit_output_sha256: shadowHash(output), report_sha256: shadowHash(report), context_sha256: shadowHash(context),
      product_sha256: context.product_sha256, scope_sha256: context.scope_sha256, work_complete: context.validation.work_complete,
      pending: structuredClone(output.observations.pending), findings: structuredClone(report.findings) });
    const plan = { contract_version: "standard-cycle-closure-review-plan.v1", review_operation_id: operationId, audit_operation_id: input.audit_operation_id,
      source_context_sha256: current.material.context_sha256, review, choices: cycleClosureChoices(review), evidence_refs: structuredClone(output.evidence_refs) };
    if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length
      || Buffer.byteLength(JSON.stringify(plan)) > 65536) fail("STANDARD_CLOSURE_REVIEW_LIMIT");
    return { prepared: { can_apply: true, plan, plan_sha256: shadowHash(plan) }, verified };
  }
  async function readFresh(instance, plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_CLOSURE_REVIEW_INVALID");
    const fresh = await inspect(instance, { audit_operation_id: plan.audit_operation_id }, plan.review_operation_id);
    if (fresh.prepared.plan_sha256 !== shadowHash(plan)) fail("STANDARD_CLOSURE_REVIEW_STALE");
    return fresh.verified;
  }
  return Object.freeze({ prepare: async (...args) => (await inspect(...args)).prepared, readFresh,
    async assertFresh(instance, plan) { await readFresh(instance, plan); },
  });
}
