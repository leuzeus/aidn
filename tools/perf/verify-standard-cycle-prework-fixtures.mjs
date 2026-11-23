import assert from "node:assert/strict";
import fs from "node:fs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { evaluateStandardCyclePlan } from "../../src/application/runtime/standard-cycle-plan-context.mjs";
import { CYCLE_PREWORK_CONTEXT_MAX_BYTES, assertStandardCyclePreworkSelection, assertStandardCyclePreworkEvaluation, assertStandardCyclePreworkSubject, assertStandardCyclePreworkReport, observeStandardCyclePrework } from "../../src/core/workflow/standard-cycle-prework.mjs";
import { checkShadowJson, shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { nativeActivityOutputSupported, nativeActivityOutputSkill, nativeActivityOutputInstructions, nativeActivityOutputBindings,
  nativeActivityAnswerSchema, nativeActivityTransportSchema, nativeActivityAnswerInstructions, assertNativeActivityAnswer } from "../../src/core/workflow/native-activity-output.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { verifyStandardCyclePreworkAuthorityFixtures } from "./standard-cycle-prework-authority-fixture-lib.mjs";

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
  for (const name of ["subject", "report", "selection-output", "evaluation-output", "witness"]) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-cycle-prework-" + name + ".v1.schema.json", import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  }
  assertStandardCyclePreworkSubject(subject()); assertStandardCyclePreworkReport(report());
});
test("typed read-only refusals retain no success facts, evidence or unregistered observations", () => {
  for (const [operation, validate] of [["selection", assertStandardCyclePreworkSelection], ["evaluation", assertStandardCyclePreworkEvaluation]]) {
    const output = { contract_version: "standard-cycle-prework-" + operation + "-output.v1",
      operation_ref: operation === "selection" ? "cycle_prework_select" : "cycle_prework_evaluate",
      outcome: "blocked", effect_status: "no_effect", facts: {},
      observations: { reason_code: "STANDARD_CANONICAL_RESUME_INTEGRATION_ONLY" }, evidence_refs: [] };
    assert.equal(validate(output), output); assert.equal(assertStandardOperationOutput(output), output);
    for (const mutate of [value => { value.facts.cycle_prework_passed = true; },
      value => { value.evidence_refs = structuredClone(refs); }, value => { value.observations.approved = true; },
      value => { value.observations.subject = subject(); }, value => { delete value.observations.reason_code; },
      value => { value.observations.reason_code = ""; }, value => { value.observations.reason_code = "private message"; },
      value => { value.observations.reason_code = "A".repeat(129); }, value => { value.effect_status = "unknown"; },
      value => { value.outcome = "completed"; }, value => { value.operation_ref = "context_reload"; },
      value => { value.approved = true; }]) {
      const malformed = structuredClone(output); mutate(malformed);
      assert.throws(() => validate(malformed), { code: "STANDARD_PREWORK_" + operation.toUpperCase() + "_INVALID" });
      assert.throws(() => assertStandardOperationOutput(malformed), { code: "STANDARD_PREWORK_" + operation.toUpperCase() + "_INVALID" });
    }
  }
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

const PREWORK = "standard-cycle-prework-report.v1";
function nativeCase(canonical = false, planSource = proposal) {
  const s = subject(canonical), planning = { contract_version: "standard-cycle-plan-context.v1", session_id: s.session_id,
    cycle_id: s.cycle_id, cycle_path: s.cycle_path, cycle_type: "feature", original_objective: proposal.objective };
  const plan = { ...structuredClone(planSource), context_sha256: canonical ? planSource.context_sha256 : shadowHash(planning) };
  if (canonical) s.proposal_sha256 = shadowHash(plan);
  const context = { subject: s, planning_context: planning, planning_context_sha256: shadowHash(planning) };
  const contextSha256 = shadowHash(context), r = { ...report(s, plan), context_sha256: contextSha256 };
  const bindings = nativeActivityOutputBindings(PREWORK, context);
  return { s, plan, context, contextSha256, r, bindings, answer: { outcome: "completed", summary: "Initial judgement proposal", report: r } };
}
test("Native prework uses the registered read-only output contract and distinct current context bindings", () => {
  const n = nativeCase(), schema = nativeActivityAnswerSchema(PREWORK, n.contextSha256, n.bindings), output = schema.properties.report.anyOf[1];
  assert.equal(nativeActivityOutputSupported(PREWORK), true); assert.equal(nativeActivityOutputSkill(PREWORK), "cycle-create");
  assert.match(nativeActivityOutputInstructions(PREWORK), /independent final audit/);
  assert.equal(output.type, "object"); assert.equal(output.additionalProperties, false);
  assert.equal(output.oneOf, undefined);
  assert.equal(output.properties.context_sha256.const, n.contextSha256);
  assert.equal(output.properties.subject_sha256.const, shadowHash(n.s));
  assert.equal(output.properties.origin_operation_id.const, n.s.origin_operation_id);
  for (const [field, value] of Object.entries(n.bindings.proposal)) assert.equal(output.properties.proposal.properties[field].const, value);
  assert.equal(assertNativeActivityAnswer(n.answer, PREWORK, n.contextSha256, n.bindings), n.answer);
});
test("the wrapped Native context never rewrites the business planning context or its proposal", () => {
  const n = nativeCase(), before = JSON.stringify(n.plan);
  assert.notEqual(n.contextSha256, n.context.planning_context_sha256);
  assert.equal(observeStandardCyclePrework({ subject: n.s, report: n.r, contextSha256: n.contextSha256,
    proposalContextSha256: n.context.planning_context_sha256, evidenceRefs: refs }).outcome, "passed");
  invalid(() => observeStandardCyclePrework({ subject: n.s, report: n.r, contextSha256: n.contextSha256, evidenceRefs: refs }));
  for (const proposalContextSha256 of ["wrong", "0".repeat(64)])
    invalid(() => observeStandardCyclePrework({ subject: n.s, report: n.r, contextSha256: n.contextSha256, proposalContextSha256, evidenceRefs: refs }));
  assert.equal(JSON.stringify(n.plan), before);
});
test("producer receives full bound constraints and schema refusals identify safe-prose fields", () => {
  const n = nativeCase(), answer = structuredClone(n.answer);
  const full = nativeActivityAnswerSchema(PREWORK, n.contextSha256, n.bindings);
  const wire = nativeActivityTransportSchema(PREWORK, n.contextSha256, n.bindings);
  const instructions = nativeActivityAnswerInstructions(PREWORK, n.contextSha256, n.bindings);
  assert.deepEqual(JSON.parse(instructions.split("\n").at(-1)), full);
  assert(Buffer.byteLength(instructions) < 32768);
  for (const value of ["Implement value >= lower && value <= upper", "x".repeat(2001)]) {
    answer.report.proposal.scope[0] = value;
    const root = schema => ({ $schema: "http://json-schema.org/draft-07/schema#", $id: "aidn://contracts/workflow-definition/native-answer-fixture.v1", ...schema });
    assert.deepEqual(validateJsonSchema(answer, root(wire), "$", { contractKind: "workflow-definition" }), []);
    assert.throws(() => assertNativeActivityAnswer(answer, PREWORK, n.contextSha256, n.bindings), error => {
      assert.equal(error.code, "PROCESS_SESSION_ANSWER_INVALID");
      assert.equal(error.native_answer_validation.stage, "schema");
      assert(error.native_answer_validation.issues.some(issue => issue.startsWith("$.report.proposal.scope[0]:")));
      assert(!JSON.stringify(error.native_answer_validation).includes(value));
      return true;
    });
  }
  answer.report.proposal.scope[0] = n.answer.report.proposal.scope[0];
  answer.report.proposal["PRIVATE_UNDECLARED_KEY"] = "private value";
  assert.throws(() => assertNativeActivityAnswer(answer, PREWORK, n.contextSha256, n.bindings), error => {
    assert(!JSON.stringify(error.native_answer_validation).includes("PRIVATE_UNDECLARED_KEY")); return true;
  });
});

test("prework producer receives mandatory audit rules and missing references remain explicit refusals", () => {
  const instructions = nativeActivityOutputInstructions(PREWORK);
  for (const canonical of [false, true]) {
    const n = nativeCase(canonical);
    const schema = { $schema: "http://json-schema.org/draft-07/schema#",
      $id: "aidn://contracts/workflow-definition/prework-rule-fixture.v1",
      ...nativeActivityAnswerSchema(PREWORK, n.contextSha256, n.bindings) };
    for (const [kind, required, other] of [["intent", "SPEC-R03", "SPEC-R04"], ["architecture", "SPEC-R04", "SPEC-R03"]]) {
      const answer = structuredClone(n.answer);
      answer.report.audits[kind].rule_refs = [other];
      const original = JSON.stringify(answer);
      assert.deepEqual(validateJsonSchema(answer, schema, "$", { contractKind: "workflow-definition" }), []);
      assert.throws(() => assertNativeActivityAnswer(answer, PREWORK, n.contextSha256, n.bindings), error => {
        assert.equal(error.code, "STANDARD_PREWORK_REPORT_INVALID");
        assert.deepEqual(error.native_answer_validation, { stage: "report_semantics",
          issues: [`$.report.audits.${kind}.rule_refs: must include ${required}`] });
        return true;
      });
      assert.equal(JSON.stringify(answer), original, "Refusal must not insert a reference into the producer answer");
      assert(instructions.includes(`audits.${kind}.rule_refs must include ${required}`));
    }
    assertNativeActivityAnswer(n.answer, PREWORK, n.contextSha256, n.bindings);
    assert.throws(() => assertNativeActivityAnswer({ ...n.answer, report: null }, PREWORK, n.contextSha256, n.bindings), error => {
      assert.equal(error.code, "STANDARD_PREWORK_REPORT_INVALID");
      assert.deepEqual(error.native_answer_validation, { stage: "report_semantics", issues: [] }); return true;
    });
  }
  const s = subject(); s.rule_refs.push("SPEC-R05", "SPEC-R11");
  const r = report(s); r.audits.intent.rule_refs.push("SPEC-R04", "SPEC-R05"); r.audits.architecture.rule_refs.push("SPEC-R11");
  assert.equal(observe(r, s).outcome, "passed", "Additional declared rules remain valid alongside the mandatory references");
});

test("fresh Native plans require their own SPEC evidence even when both audits cite it", () => {
  const PLAN = "standard-cycle-plan-proposal.v1";
  for (const contract of [PREWORK, PLAN]) {
    const n = nativeCase(), plan = structuredClone(n.plan);
    plan.evidence_refs = [{ ref: "audit:brief.md", sha256: H }];
    const answer = contract === PREWORK ? { ...n.answer, report: { ...n.r, proposal: plan } }
      : { outcome: "completed", summary: "Scoped plan proposal", report: plan };
    const contextSha256 = contract === PREWORK ? n.contextSha256 : plan.context_sha256;
    const bindings = contract === PREWORK ? n.bindings : nativeActivityOutputBindings(PLAN,
      { ...n.context.planning_context, original_objective: plan.objective });
    const original = JSON.stringify(answer), field = contract === PREWORK ? "$.report.proposal.evidence_refs" : "$.report.evidence_refs";
    assertStandardCyclePlan(plan); // Historical structural readers retain their existing acceptance.
    assert.throws(() => assertNativeActivityAnswer(answer, contract, contextSha256, bindings), error => {
      assert.equal(error.code, "STANDARD_CYCLE_PLAN_EVIDENCE_INVALID");
      assert.deepEqual(error.native_answer_validation, { stage: "report_semantics", issues: [`${field}: must include audit:SPEC.md`] });
      return true;
    });
    assert.equal(JSON.stringify(answer), original);
    assert(nativeActivityOutputInstructions(contract).includes(`${field.slice(2)} must include audit:SPEC.md`));
  }
});

test("required plan evidence does not replace exact source membership or its digest", () => {
  const p = structuredClone(proposal), authenticated = { report: p, reference: { ref: "fixture:native", sha256: H } };
  const observed = { context_sha256: H, evidence_refs: refs, context: { session_id: p.session_id, cycle_id: p.cycle_id,
    cycle_type: p.cycle_type, original_objective: p.objective, mode: "COMMITTING", allowed_product_files: ["product/app.mjs"] } };
  assert.equal(evaluateStandardCyclePlan(authenticated, observed).outcome, "completed");
  for (const evidence of [[{ ref: "audit:brief.md", sha256: H }], [{ ref: "audit:SPEC.md", sha256: "b".repeat(64) }],
    [...refs, { ref: "audit:foreign.md", sha256: H }]]) {
    p.evidence_refs = evidence;
    assert.throws(() => evaluateStandardCyclePlan(authenticated, observed), { code: "STANDARD_CYCLE_PLAN_EVIDENCE_INVALID" });
  }
});

test("canonical audit and historical plan readers do not add fresh proposal evidence", () => {
  const historical = structuredClone(proposal); historical.evidence_refs = [{ ref: "audit:brief.md", sha256: H }];
  const n = nativeCase(true, historical), original = JSON.stringify(n.plan);
  assertStandardCyclePlan(n.plan);
  assertNativeActivityAnswer(n.answer, PREWORK, n.contextSha256, n.bindings);
  assert.equal(observeStandardCyclePrework({ subject: n.s, report: n.r, contextSha256: n.contextSha256,
    canonicalProposal: n.plan, evidenceRefs: refs }).outcome, "passed");
  assert.equal(n.answer.report.proposal, null);
  assert.equal(JSON.stringify(n.plan), original);
});

test("current Native bindings reject a different origin, subject, report context or proposal identity", () => {
  const n = nativeCase();
  for (const mutate of [r => { r.context_sha256 = H; }, r => { r.subject_sha256 = H; },
    r => { r.origin_operation_id = "op_" + "9".repeat(40); }, r => { r.proposal.context_sha256 = H; },
    r => { r.proposal.session_id = "S002"; }, r => { r.proposal.cycle_id = "C002"; },
    r => { r.proposal.cycle_type = "refactor"; }, r => { r.proposal.objective += " silently changed"; },
    r => { r.implementation_authorized = true; }]) {
    const answer = structuredClone(n.answer); mutate(answer.report);
    assert.throws(() => assertNativeActivityAnswer(answer, PREWORK, n.contextSha256, n.bindings), /ANSWER_INVALID/);
  }
});
test("canonical Native assessment has no replacement proposal and retains the approved plan bytes", () => {
  const n = nativeCase(true), before = JSON.stringify(n.plan);
  assert.equal(n.bindings.kind, "audit_canonical_plan"); assert.equal(n.bindings.proposal, null);
  assertNativeActivityAnswer(n.answer, PREWORK, n.contextSha256, n.bindings);
  assert.equal(observeStandardCyclePrework({ subject: n.s, report: n.r, contextSha256: n.contextSha256,
    canonicalProposal: n.plan, evidenceRefs: refs }).outcome, "passed");
  assert.throws(() => assertNativeActivityAnswer({ ...n.answer, report: { ...n.r, proposal: n.plan } }, PREWORK, n.contextSha256, n.bindings), /ANSWER_INVALID/);
  assert.equal(JSON.stringify(n.plan), before);
});
test("Native completion preserves failed and information-needed judgements without manufacturing a pass", () => {
  for (const verdict of ["failed", "needs_information"]) {
    const n = nativeCase(); n.r.audits.intent.verdict = verdict;
    if (verdict === "failed") n.r.audits.intent.findings = [{ ...finding("blocking"), rule_refs: ["SPEC-R03"] }];
    else n.r.audits.intent.questions = ["Which approved intent applies?"];
    assertNativeActivityAnswer(n.answer, PREWORK, n.contextSha256, n.bindings);
    assert.equal(observeStandardCyclePrework({ subject: n.s, report: n.r, contextSha256: n.contextSha256,
      proposalContextSha256: n.context.planning_context_sha256, evidenceRefs: refs }).outcome, verdict);
  }
  const n = nativeCase();
  for (const outcome of ["failed", "rejected"]) {
    assertNativeActivityAnswer({ outcome, summary: "Report not produced", report: null }, PREWORK, n.contextSha256, n.bindings);
    assert.throws(() => assertNativeActivityAnswer({ ...n.answer, outcome }, PREWORK, n.contextSha256, n.bindings), /NONCOMPLETION/);
  }
});
test("malformed Native bindings and mismatched planning subjects refuse before schema transport", () => {
  const n = nativeCase();
  for (const bindings of [{ ...n.bindings, extra: true }, { ...n.bindings, kind: "approve" },
    { ...n.bindings, subject_sha256: "wrong" }, { ...n.bindings, proposal: null },
    { ...n.bindings, proposal: { ...n.bindings.proposal, approved: true } },
    { ...n.bindings, proposal: { ...n.bindings.proposal, context_sha256: "wrong" } }])
    assert.throws(() => nativeActivityAnswerSchema(PREWORK, n.contextSha256, bindings), /BINDINGS_INVALID/);
  for (const field of ["session_id", "cycle_id", "cycle_path"]) {
    const context = structuredClone(n.context); context.planning_context[field] += "changed"; context.planning_context_sha256 = shadowHash(context.planning_context);
    assert.throws(() => nativeActivityOutputBindings(PREWORK, context), /BINDINGS_INVALID/);
  }
  const changed = structuredClone(n.context); changed.planning_context.original_objective += "changed";
  assert.throws(() => nativeActivityOutputBindings(PREWORK, changed), /BINDINGS_INVALID/);
  assert.throws(() => nativeActivityAnswerSchema("standard-drift-report.v1", H, n.bindings), /BINDINGS_INVALID/);
});
test("complete Native source text uses its existing context bound while default DTO and aggregate limits stay enforced", () => {
  const text = "Canonical audit source evidence.\n".repeat(600);
  assert.ok(text.length > 16384); assert.equal(checkShadowJson({ text }), "JSON_LIMIT");
  assert.equal(checkShadowJson({ maxStringLength: CYCLE_PREWORK_CONTEXT_MAX_BYTES, text }), "JSON_LIMIT");
  for (const canonical of [false, true]) {
    const context = nativeCase(canonical).context;
    context.planning_context.documents = [{ ref: "audit:SPEC.md", content: text, sha256: shadowHash(text) }];
    context.planning_context_sha256 = shadowHash(context.planning_context);
    assert.equal(checkShadowJson(context), "JSON_LIMIT");
    const bound = nativeActivityOutputBindings(PREWORK, context);
    if (canonical) assert.equal(bound.proposal, null);
    else assert.equal(bound.proposal.context_sha256, context.planning_context_sha256);
    assert.equal(context.planning_context.documents[0].content, text);
    const over = structuredClone(context);
    over.planning_context.documents = [1, 2].map(id => ({ ref: "audit:source-" + id,
      content: "x".repeat(CYCLE_PREWORK_CONTEXT_MAX_BYTES / 2) }));
    over.planning_context_sha256 = shadowHash(over.planning_context);
    assert.equal(checkShadowJson(over, { maxStringLength: CYCLE_PREWORK_CONTEXT_MAX_BYTES }), null);
    assert.throws(() => nativeActivityOutputBindings(PREWORK, over), /BINDINGS_INVALID/);
    let reads = 0;
    Object.defineProperty(context.planning_context.documents[0], "content", { enumerable: true, get() { reads++; return text; } });
    assert.throws(() => nativeActivityOutputBindings(PREWORK, context), /BINDINGS_INVALID/); assert.equal(reads, 0);
  }
});

test("historical Native plan answers keep their original closed identity schema", () => {
  const context = { session_id: proposal.session_id, cycle_id: proposal.cycle_id, cycle_type: proposal.cycle_type, original_objective: proposal.objective };
  const bindings = nativeActivityOutputBindings("standard-cycle-plan-proposal.v1", context);
  assert.deepEqual(Object.keys(bindings), ["session_id", "cycle_id", "cycle_type", "objective"]);
  assertNativeActivityAnswer({ outcome: "completed", summary: "Historical typed proposal", report: proposal }, "standard-cycle-plan-proposal.v1", H, bindings);
  const n = nativeCase();
  assertNativeActivityAnswer(n.answer, PREWORK, n.contextSha256);
});

names.push(...await verifyStandardCyclePreworkAuthorityFixtures(cyclePlanProposal));
console.log(JSON.stringify({ status: "PASS", checks: names.length, scope: "TYPED_INITIAL_AUDIT_DATA_AND_CONTROLLED_AUTHORITY_PORT_FIXTURES",
  Native_calls: 0, authority_authentication: "CONTROLLED_PORT_FIXTURES_ONLY", host_effects: "NOT_RUN", published_STANDARD: "NOT_RUN", installed: "NOT_RUN", complete_standard: false }));
