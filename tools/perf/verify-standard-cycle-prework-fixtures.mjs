import assert from "node:assert/strict";
import fs from "node:fs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { assertStandardCyclePreworkSubject, assertStandardCyclePreworkReport, observeStandardCyclePrework } from "../../src/core/workflow/standard-cycle-prework.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";

if (process.argv.length !== 2) throw Error("STANDARD_PREWORK_FIXTURE_ARGUMENTS_INVALID");
const H = "a".repeat(64), refs = [{ ref: "audit:SPEC.md", sha256: H }], names = [];
const test = (name, fn) => { fn(); names.push(name); console.log("PASS " + name); };
const proposal = cyclePlanProposal({ context_sha256: H, context: { session_id: "S001", cycle_id: "C001", cycle_type: "feature", mode: "COMMITTING",
  original_objective: "Retain intent and architecture judgements before work", allowed_product_files: ["product/app.mjs"] }, evidence_refs: refs });
const subject = (canonical = false, plan = proposal) => ({ contract_version: "standard-cycle-prework-subject.v1", kind: canonical ? "canonical_plan" : "fresh_cycle",
  origin_operation_id: "op_" + (canonical ? "2" : "1").repeat(40), origin_sha256: "b".repeat(64), scope_sha256: "c".repeat(64),
  canonical_sha256: "d".repeat(64), product_sha256: "e".repeat(64), head: "f".repeat(40), session_id: "S001", cycle_id: "C001",
  cycle_path: "cycles/C001-feature-prework", rule_refs: ["SPEC-R03", "SPEC-R04"], proposal_sha256: canonical ? shadowHash(plan) : null });
const judgement = rule => ({ verdict: "passed", rationale: "Current judgement uses the declared source and rule", rule_refs: [rule],
  evidence_refs: structuredClone(refs), findings: [], questions: [] });
const report = (s = subject(), plan = proposal) => ({ contract_version: "standard-cycle-prework-report.v1", kind: s.kind === "fresh_cycle" ? "propose_plan" : "audit_canonical_plan",
  context_sha256: H, subject_sha256: shadowHash(s), origin_operation_id: s.origin_operation_id, proposal: s.kind === "fresh_cycle" ? structuredClone(plan) : null,
  audits: { intent: judgement("SPEC-R03"), architecture: judgement("SPEC-R04") } });
const observe = (r, s = subject(), canonicalProposal = null) => observeStandardCyclePrework({ subject: s, report: r, contextSha256: H, evidenceRefs: refs, canonicalProposal });
const invalid = fn => assert.throws(fn, error => /^STANDARD_(?:PREWORK|CYCLE_PLAN)_/.test(error.code ?? ""));
const finding = severity => ({ id: "FIND-001", severity, summary: "Observed current source issue", rule_refs: ["SPEC-R04"], evidence_refs: structuredClone(refs) });

test("initial subject and report schemas stay closed and use supported JSON", () => {
  for (const name of ["subject", "report"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-cycle-prework-" + name + ".v1.schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  assertStandardCyclePreworkSubject(subject()); assertStandardCyclePreworkReport(report());
});
test("fresh planning carries two current typed judgements without granting work or validation", () => {
  const s = subject(), r = report(s), before = structuredClone({ s, r }), out = observe(r, s);
  assert.equal(out.outcome, "passed"); assert.deepEqual(out.verdicts, { intent: "passed", architecture: "passed" });
  assert.equal(out.proposal_sha256, shadowHash(proposal));
  for (const field of ["implementation_authorized", "current_native_work_evidence", "current_validation_evidence"]) assert.equal(out[field], false);
  assert.deepEqual({ s, r }, before);
});
test("a canonical plan retains its historical context while the new judgement binds the present subject", () => {
  const oldPlan = { ...structuredClone(proposal), context_sha256: "9".repeat(64) }, s = subject(true, oldPlan), r = report(s, oldPlan), oldBytes = JSON.stringify(oldPlan);
  const out = observe(r, s, oldPlan); assert.equal(out.outcome, "passed"); assert.equal(out.source_kind, "audit_canonical_plan");
  assert.equal(out.proposal_sha256, s.proposal_sha256); assert.equal(JSON.stringify(oldPlan), oldBytes); assert.equal(r.proposal, null);
});
test("historical v1 planning remains readable and is never converted into a current audit report", () => {
  const bytes = JSON.stringify(proposal); assertStandardCyclePlan(proposal); invalid(() => assertStandardCyclePreworkReport(proposal));
  assert.equal(JSON.stringify(proposal), bytes);
});
test("failed and information-needed judgements remain distinct from passing", () => {
  const failed = report(); failed.audits.architecture.verdict = "failed"; failed.audits.architecture.findings = [finding("blocking")];
  const original = structuredClone(failed); assert.equal(observe(failed).outcome, "failed"); assert.deepEqual(failed, original);
  const waiting = report(); waiting.audits.intent.verdict = "needs_information"; waiting.audits.intent.questions = ["Which scope constraint applies?"];
  assert.equal(observe(waiting).outcome, "needs_information"); assert.equal(observe(waiting).verdicts.architecture, "passed");
});
test("a passed label cannot hide a blocking finding or an unanswered question", () => {
  for (const mutate of [r => { r.audits.architecture.findings = [finding("blocking")]; }, r => { r.audits.intent.questions = ["Missing intent?"]; },
    r => { r.audits.intent.verdict = "failed"; }, r => { r.audits.intent.verdict = "needs_information"; }]) {
    const r = report(); mutate(r); invalid(() => assertStandardCyclePreworkReport(r));
  }
});
test("both dimensions and their declared rules are mandatory", () => {
  for (const mutate of [r => { delete r.audits.intent; }, r => { delete r.audits.architecture; },
    r => { r.audits.intent.rule_refs = ["SPEC-R04"]; }, r => { r.audits.architecture.rule_refs = ["SPEC-R03"]; }]) {
    const r = report(); mutate(r); invalid(() => assertStandardCyclePreworkReport(r));
  }
});
test("changed context, origin, HEAD, product, canonical metadata or scope refuses the earlier report", () => {
  for (const mutate of [s => { s.origin_sha256 = "1".repeat(64); }, s => { s.scope_sha256 = "1".repeat(64); },
    s => { s.canonical_sha256 = "1".repeat(64); }, s => { s.product_sha256 = "1".repeat(64); }, s => { s.head = "1".repeat(40); }]) {
    const s = subject(), r = report(s); mutate(s); invalid(() => observe(r, s));
  }
  for (const mutate of [r => { r.context_sha256 = "1".repeat(64); }, r => { r.origin_operation_id = "op_" + "3".repeat(40); },
    r => { r.proposal.cycle_id = "C002"; }, r => { r.proposal.context_sha256 = "1".repeat(64); }]) {
    const r = report(); mutate(r); invalid(() => observe(r));
  }
});
test("canonical analysis cannot replace or reinterpret the admitted plan", () => {
  const s = subject(true), r = report(s); invalid(() => assertStandardCyclePreworkReport({ ...r, proposal }));
  const changed = structuredClone(proposal); changed.objective += " changed"; invalid(() => observe(r, s, changed));
  invalid(() => observe(r, s, null)); invalid(() => assertStandardCyclePreworkSubject({ ...s, proposal_sha256: null }));
  invalid(() => assertStandardCyclePreworkSubject({ ...subject(), proposal_sha256: H }));
  invalid(() => assertStandardCyclePreworkSubject({ ...s, cycle_id: "C002" }));
});
test("caller approvals, principals, permissions and unknown subject fields are refused", () => {
  for (const extra of [{ approved: true }, { implementation_authorized: true }, { authority_id: "caller" }, { permissions: ["write:product"] }]) {
    invalid(() => assertStandardCyclePreworkReport({ ...report(), ...extra }));
    invalid(() => assertStandardCyclePreworkSubject({ ...subject(), ...extra }));
  }
  const r = report(); r.audits.intent.approved = true; invalid(() => assertStandardCyclePreworkReport(r));
});
test("foreign or changed evidence and duplicate source references are refused", () => {
  for (const ref of [{ ref: "product:foreign.mjs", sha256: H }, { ref: refs[0].ref, sha256: "1".repeat(64) }]) {
    const r = report(); r.audits.intent.evidence_refs = [ref]; invalid(() => observe(r));
  }
  const duplicate = report(); duplicate.audits.architecture.evidence_refs.push({ ...refs[0] }); invalid(() => assertStandardCyclePreworkReport(duplicate));
  const r = report(); r.audits.architecture.findings = [{ ...finding("risk"), evidence_refs: [{ ref: "audit:foreign", sha256: H }] }]; invalid(() => observe(r));
});
test("unbounded text, malformed findings and contradictory kinds cannot be accepted", () => {
  for (const mutate of [r => { r.audits.intent.rationale = "x".repeat(2049); }, r => { r.audits.intent.rationale = "Two\nheadings"; },
    r => { r.audits.architecture.findings = [finding("risk"), finding("risk")]; },
    r => { r.kind = "audit_canonical_plan"; }, r => { r.audits.architecture.verdict = "approved"; }]) {
    const r = report(); mutate(r); invalid(() => assertStandardCyclePreworkReport(r));
  }
});
test("malformed current evidence and rules outside the declared subject refuse with typed errors", () => {
  for (const evidenceRefs of [[null], [{}], [{ ref: "audit:SPEC.md" }], [...refs, ...refs]])
    invalid(() => observeStandardCyclePrework({ subject: subject(), report: report(), contextSha256: H, evidenceRefs }));
  const r = report(); r.audits.architecture.rule_refs.push("SPEC-R11"); invalid(() => observe(r));
  const s = subject(); s.rule_refs = ["SPEC-R03"]; invalid(() => assertStandardCyclePreworkSubject(s));
});
console.log(JSON.stringify({ status: "PASS", checks: names.length, scope: "PURE_TYPED_INITIAL_AUDIT_DATA_AND_CURRENT_SUBJECT_CONSISTENCY",
  Native_calls: 0, authority_authentication: "NOT_CONNECTED", host_effects: "NOT_CONNECTED", published_STANDARD: "NOT_CONNECTED", installed: "NOT_RUN", complete_standard: false }));
