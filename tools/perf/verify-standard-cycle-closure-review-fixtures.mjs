import assert from "node:assert/strict";
import { createStandardCycleClosureReview } from "../../src/application/runtime/standard-cycle-closure-review.mjs";
import { observeStandardCycleAudit } from "../../src/core/workflow/standard-cycle-audit.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
const H = "a".repeat(64), op = char => "op_" + char.repeat(40), instance = { instance_id: "fixture", scope_id: "fixture" };
const proposal = cyclePlanProposal({ context_sha256: H, context: { session_id: "S001", cycle_id: "C001", cycle_type: "feature", mode: "COMMITTING",
  original_objective: "Review a completed fixture task", allowed_product_files: ["product/app.mjs"] }, evidence_refs: [{ ref: "audit:SPEC.md", sha256: H }] });
const evidence = [{ ref: "audit:SPEC.md", sha256: H }], context = { contract_version: "standard-cycle-audit-context.v1", session_id: "S001", cycle_id: "C001", mode: "COMMITTING",
  cycle_state: "VERIFYING", implementation_operation_id: op("a"), verification_operation_id: op("b"), product_sha256: H, scope_sha256: H, proposal,
  canonical_inventory_complete: true, canonical_inventory_sha256: H, audit_documents: evidence, evidence_refs: evidence,
  validation: { work_complete: true, product_sha256: H, checks: [{ test_ref: "TEST-001", status: "passed" }] } };
const assessment = { status: "supported", rationale: "Scoped offline audit proposal", evidence_refs: evidence };
const report = { contract_version: "standard-cycle-audit-report.v1", context_sha256: shadowHash(context), cycle_id: "C001",
  requirements: [{ requirement_ref: "REQ-001", ...assessment }], usages: [{ usage_index: 1, ...assessment }],
  document_reviews: [{ ...evidence[0], ...assessment, status: "reviewed" }], findings: [], recommendation: "request_closure_review", evidence_refs: evidence };
const source = { native: { authenticated: { report, producer: {} }, context }, current: { material: { context_sha256: H } },
  record: { operation_id: op("c"), intent: { binding_ref: "cycle_audit_evaluate", ...instance } } };
function refresh(value) {
  value.native.authenticated.report.context_sha256 = shadowHash(value.native.context);
  value.output = observeStandardCycleAudit({ report: value.native.authenticated.report, context: value.native.context, contextSha256: shadowHash(value.native.context), producer: {}, evidenceRefs: evidence });
  return value;
}
let current = refresh(structuredClone(source)), calls = 0, checks = 0;
const port = createStandardCycleClosureReview({ readAudit: async () => { calls++; return structuredClone(current); } }), input = { audit_operation_id: op("c") };
const pass = name => { checks++; console.log("PASS " + name); };
const prepared = await port.prepare(instance, input, op("d")); await port.assertFresh(instance, prepared.plan);
assert.equal(prepared.plan.review.audit_output_sha256, shadowHash(current.output)); assert.equal(prepared.plan.review.report_sha256, shadowHash(report));
assert.ok(prepared.plan.choices.includes("retain")); assert.equal(prepared.plan.writes, undefined); assert.equal(prepared.plan.permissions, undefined);
pass("fresh verified audit becomes a stable review, without writes, permission or a model call");
const prior = calls; await assert.rejects(port.prepare(instance, { ...input, terminal_state: "DONE" }, op("d")), { code: "STANDARD_CLOSURE_INPUT_INVALID" });
assert.equal(calls, prior); assert.throws(() => createStandardCycleClosureReview({}), { code: "STANDARD_CLOSURE_AUDIT_AUTHORITY_REQUIRED" });
pass("only an audit identity is accepted; authored fields cannot replace the host source capability");
for (const mutate of [value => value.record.intent.scope_id = "other", value => value.record.intent.instance_id = "other", value => value.record.operation_id = op("e"), value => value.record.intent.binding_ref = "cycle_audit_select"]) {
  current = refresh(structuredClone(source)); mutate(current); await assert.rejects(port.prepare(instance, input, op("d")), { code: "STANDARD_CLOSURE_ACCEPTED_AUDIT_REQUIRED" });
}
pass("foreign instance, scope, identity and selection records cannot stand in for an accepted audit");
current = refresh(structuredClone(source)); current.output.observations.pending.tests.push("TEST-001");
await assert.rejects(port.prepare(instance, input, op("d")), { code: "STANDARD_CLOSURE_AUDIT_CHANGED" });
pass("the host audit observation must recompute exactly from its typed native report and evidence");
current = refresh(structuredClone(source)); current.native.context.product_sha256 = "b".repeat(64); current.native.context.validation.product_sha256 = "b".repeat(64); refresh(current);
await assert.rejects(port.assertFresh(instance, prepared.plan), { code: "STANDARD_CLOSURE_REVIEW_STALE" });
current = refresh(structuredClone(source)); current.current.material.context_sha256 = "b".repeat(64);
await assert.rejects(port.assertFresh(instance, prepared.plan), { code: "STANDARD_CLOSURE_REVIEW_STALE" });
pass("changed product or canonical source context invalidates a retained human review");
current = refresh(structuredClone(source)); current.native.authenticated.report.requirements[0].status = "unsatisfied"; refresh(current);
const blocked = await port.prepare(instance, input, op("d")); assert.equal(blocked.plan.choices.includes("retain"), false); assert.ok(blocked.plan.choices.includes("no_go"));
pass("unmet requirements cannot offer retention, while non-retained human choices remain explicit");
current = refresh(structuredClone(source)); current.native.authenticated.report.findings.push({ id: "FINDING-001", category: "gap", severity: "risk",
  rationale: "Concrete residual risk requiring explicit human acceptance", evidence_refs: evidence }); refresh(current);
const risky = await port.prepare(instance, input, op("d")); assert.equal(risky.plan.review.findings[0].rationale, current.native.authenticated.report.findings[0].rationale);
assert.deepEqual(risky.plan.review.pending.risk_findings_requiring_human_decision, ["FINDING-001"]); assert.equal(risky.plan.review.accepted_risks, undefined);
pass("the human review includes the actual risk rationale and evidence; an identifier alone is insufficient");
console.log(JSON.stringify({ status: "PASS", checks, proof: "closure-review-component", audit_authority: "fixture", application_host: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
