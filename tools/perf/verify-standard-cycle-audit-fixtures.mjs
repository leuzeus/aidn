import assert from "node:assert/strict";
import fs from "node:fs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { observeStandardCycleAudit, assertStandardCycleAuditReport } from "../../src/core/workflow/standard-cycle-audit.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { assertNativeActivityAnswer, nativeActivityOutputInstructions } from "../../src/core/workflow/native-activity-output.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
const H = character => character.repeat(64), op = "op_" + "a".repeat(40);
const proposal = cyclePlanProposal({ context_sha256: H("a"), context: { session_id: "S001", cycle_id: "C001", cycle_type: "feature", mode: "COMMITTING",
  original_objective: "Audit the admitted final product", allowed_product_files: ["product/app.mjs"] }, evidence_refs: [{ ref: "audit:SPEC.md", sha256: H("b") }] });
const documents = ["brief", "plan", "audit-spec", "traceability", "decisions", "change-requests", "status"].map(name => ({ ref: `audit:cycles/C001-feature-fixture/${name}.md`, sha256: H("c") }));
const evidence = { ref: "validation/current/result.json", sha256: H("d") };
const context = { contract_version: "standard-cycle-audit-context.v1", cycle_id: "C001", mode: "COMMITTING", implementation_operation_id: op, cycle_state: "VERIFYING", proposal, canonical_inventory_complete: true,
  canonical_inventory_sha256: H("e"), verification_operation_id: op, product_sha256: H("f"), scope_sha256: H("a"), audit_documents: documents,
  evidence_refs: [...documents, evidence], validation: { work_complete: true, product_sha256: H("f"), checks: [{ test_ref: "TEST-001", status: "passed" }] } };
const assessment = { status: "supported", rationale: "Scoped read-only audit proposal requiring human review", evidence_refs: [evidence] };
const report = { contract_version: "standard-cycle-audit-report.v1", context_sha256: shadowHash(context), cycle_id: "C001",
  requirements: [{ requirement_ref: "REQ-001", ...assessment }], usages: [{ usage_index: 1, ...assessment }],
  document_reviews: documents.map(row => ({ ...row, ...assessment, status: "reviewed", evidence_refs: [row] })),
  findings: [], recommendation: "request_closure_review", evidence_refs: [evidence] };
const base = { report, context, contextSha256: shadowHash(context), producer: {}, evidenceRefs: [evidence] };
const run = args => observeStandardCycleAudit(args), changed = () => structuredClone(base);
let checks = 0; const pass = label => { checks++; console.log("PASS " + label); };
for (const name of ["standard-cycle-audit-report.v1", "standard-cycle-audit-output.v1"]) {
  const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
}
const observed = run(base); assert.equal(observed.facts.cycle_closure_decision_required, true); assert.equal(observed.facts.cycle_audit_blockers_present, false);
assert.equal(observed.observations.skill_completion, "pending"); assert.equal(observed.observations.lifecycle_transition, "none");
assert.equal(observed.facts.cycle_closed, undefined); assert.equal(observed.effect_status, "no_effect"); pass("complete checklist is an observation with human decision pending, never closure");
for (const field of ["state", "permissions", "accepted_risks", "effects"]) { const value = structuredClone(report); value[field] = "DONE"; assert.throws(() => assertStandardCycleAuditReport(value)); }
pass("native report cannot select terminal state, grant effects or accept risks");
for (const field of ["requirements", "usages", "document_reviews"]) { const value = changed(); value.report[field].pop(); assert.throws(() => run(value)); }
const duplicate = changed(); duplicate.report.document_reviews.push(duplicate.report.document_reviews[0]); assert.throws(() => run(duplicate));
pass("every frozen requirement, usage and supplied audit document must be covered exactly once");
const foreign = changed(); foreign.report.requirements[0].evidence_refs = [{ ref: "audit:foreign", sha256: H("a") }]; assert.throws(() => run(foreign));
const tampered = changed(); tampered.report.document_reviews[0].sha256 = H("a"); assert.throws(() => run(tampered));
pass("foreign references and changed document fingerprints refuse");
for (const patch of [value => { value.context.canonical_inventory_complete = false; }, value => { value.context.cycle_state = "DONE"; }, value => { value.context.cycle_id = "C002"; }, value => { value.context.mode = "THINKING"; }, value => { value.context.validation.product_sha256 = H("a"); }]) {
  const value = changed(); patch(value); value.contextSha256 = shadowHash(value.context); value.report.context_sha256 = value.contextSha256; assert.throws(() => run(value));
}
const stale = changed(); stale.report.context_sha256 = H("a"); assert.throws(() => run(stale)); pass("incomplete inventory, wrong phase, foreign code and stale context never establish audit authority");
for (const status of ["failed", "unavailable"]) {
  const value = changed(); value.context.validation.checks[0].status = status; value.contextSha256 = shadowHash(value.context); value.report.context_sha256 = value.contextSha256;
  assert.throws(() => run(value), { code: "STANDARD_CYCLE_AUDIT_CHECK_CONTRADICTION" });
  value.report.requirements[0].status = "inconclusive"; value.report.usages[0].status = "inconclusive";
  assert.equal(run(value).facts.cycle_audit_blockers_present, true);
}
pass("failed or unavailable checks cannot be relabelled supported; inconclusive audit stays pending");
const unresolved = changed(); unresolved.report.requirements[0].status = "unsatisfied";
assert.equal(run(unresolved).facts.cycle_audit_blockers_present, true); unresolved.report.requirements[0].status = "supported";
unresolved.context.validation.work_complete = false; unresolved.contextSha256 = shadowHash(unresolved.context); unresolved.report.context_sha256 = unresolved.contextSha256;
assert.equal(run(unresolved).facts.cycle_audit_blockers_present, true); pass("passing checks do not erase unsatisfied requirements or unfinished work");
const risk = changed(); risk.report.findings = [{ id: "FINDING-001", category: "gap", severity: "risk", rationale: "Requires explicit scoped human risk decision", evidence_refs: [documents[2]] }];
assert.deepEqual(run(risk).observations.pending.risk_findings_requiring_human_decision, ["FINDING-001"]);
assert.equal(run(risk).facts.cycle_closure_decision_required, true); pass("risk proposal preserves its identity for a later human decision");
assertNativeActivityAnswer({ outcome: "completed", summary: "Read-only audit proposal", report }, report.contract_version, report.context_sha256);
assert.match(nativeActivityOutputInstructions(report.contract_version), /separate authorized host effects/);
assertStandardOperationInput("cycle_audit_select", { implementation_operation_id: op });
assert.throws(() => assertStandardOperationInput("cycle_audit_select", { implementation_operation_id: op, terminal_state: "DONE" }));
assertStandardOperationOutput(observed);
const forged = structuredClone(observed); forged.facts.cycle_closed = true; assert.throws(() => assertStandardOperationOutput(forged));
pass("native answer and operation contracts preserve the audit boundary without lifecycle facts");
console.log(JSON.stringify({ status: "PASS", checks, proof: "pure-audit-proposal", application_ports: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
