import subjectSchema from "../contracts/workflow-definition/standard-cycle-prework-subject.v1.schema.json" with { type: "json" };
import reportSchema from "../contracts/workflow-definition/standard-cycle-prework-report.v1.schema.json" with { type: "json" };
import selectionSchema from "../contracts/workflow-definition/standard-cycle-prework-selection-output.v1.schema.json" with { type: "json" };
import evaluationSchema from "../contracts/workflow-definition/standard-cycle-prework-evaluation-output.v1.schema.json" with { type: "json" };
import witnessSchema from "../contracts/workflow-definition/standard-cycle-prework-witness.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertStandardCyclePlan } from "./standard-cycle-planning.mjs";

export const CYCLE_PREWORK_CONTRACT = "standard-cycle-prework-report.v1";
// Existing total byte bound for the source-owned Native prework context.
export const CYCLE_PREWORK_CONTEXT_MAX_BYTES = 262144;
const fail = code => { throw Object.assign(Error(code), { code }); };
const hash = value => /^[a-f0-9]{64}$/.test(value ?? "");
const unique = values => new Set(values).size === values.length;
const valid = (value, schema, maxBytes, code) => {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(value)) > maxBytes) fail(code);
};
const scalar = value => value === value.replace(/\s+/gu, " ").trim();
export function assertStandardCyclePreworkSubject(subject) {
  valid(subject, subjectSchema, 4096, "STANDARD_PREWORK_SUBJECT_INVALID");
  if (!subject.cycle_path.startsWith("cycles/" + subject.cycle_id + "-")
    || !unique(subject.rule_refs) || !["SPEC-R03", "SPEC-R04"].every(rule => subject.rule_refs.includes(rule))
    || (subject.kind === "fresh_cycle" ? subject.proposal_sha256 !== null : !hash(subject.proposal_sha256)))
    fail("STANDARD_PREWORK_SUBJECT_INVALID");
  return subject;
}
export function assertStandardCyclePreworkReport(report) {
  valid(report, reportSchema, 131072, "STANDARD_PREWORK_REPORT_INVALID");
  if (report.proposal !== null) assertStandardCyclePlan(report.proposal);
  for (const [kind, requiredRule] of [["intent", "SPEC-R03"], ["architecture", "SPEC-R04"]]) {
    const audit = report.audits[kind], blocking = audit.findings.some(row => row.severity === "blocking");
    if (!scalar(audit.rationale) || !unique(audit.rule_refs) || !audit.rule_refs.includes(requiredRule)
      || !unique(audit.evidence_refs.map(row => row.ref)) || !unique(audit.questions) || !audit.questions.every(scalar)
      || !unique(audit.findings.map(row => row.id))
      || audit.findings.some(row => !scalar(row.summary) || !unique(row.rule_refs) || !unique(row.evidence_refs.map(ref => ref.ref)))
      || audit.verdict === "passed" && (blocking || audit.questions.length)
      || audit.verdict === "failed" && !blocking
      || audit.verdict === "needs_information" && !audit.questions.length)
      fail("STANDARD_PREWORK_REPORT_INVALID");
  }
  return report;
}
// Pure judgement data only. The fixed application host must authenticate the
// Native producer and accepted lineage, observe this subject from current
// authorities and fence permissions/owner/instance before any later effect.
// Compatible initial judgements do not replace the independent final review.
export function observeStandardCyclePrework({ subject, report, contextSha256, evidenceRefs, canonicalProposal = null, proposalContextSha256 = contextSha256 }) {
  assertStandardCyclePreworkSubject(subject); assertStandardCyclePreworkReport(report);
  const kind = subject.kind === "fresh_cycle" ? "propose_plan" : "audit_canonical_plan";
  if (!hash(contextSha256) || !hash(proposalContextSha256) || report.context_sha256 !== contextSha256 || report.subject_sha256 !== shadowHash(subject)
    || report.origin_operation_id !== subject.origin_operation_id || report.kind !== kind)
    fail("STANDARD_PREWORK_SOURCE_CHANGED");
  const proposal = kind === "propose_plan" ? report.proposal : canonicalProposal;
  assertStandardCyclePlan(proposal);
  if (proposal.session_id !== subject.session_id || proposal.cycle_id !== subject.cycle_id
    || kind === "propose_plan" && (canonicalProposal !== null || proposal.context_sha256 !== proposalContextSha256)
    || kind === "audit_canonical_plan" && shadowHash(proposal) !== subject.proposal_sha256)
    fail("STANDARD_PREWORK_SOURCE_CHANGED");
  const references = Object.values(report.audits).flatMap(audit => [...audit.evidence_refs, ...audit.findings.flatMap(row => row.evidence_refs)]);
  if (checkShadowJson(evidenceRefs) || !Array.isArray(evidenceRefs)
    || evidenceRefs.some(row => !row || typeof row !== "object" || Array.isArray(row)
      || Object.keys(row).sort().join(",") !== "ref,sha256" || typeof row.ref !== "string" || !row.ref.length || !hash(row.sha256))
    || !unique(evidenceRefs.map(row => row.ref))
    || references.some(ref => !evidenceRefs.some(allowed => allowed.ref === ref.ref && allowed.sha256 === ref.sha256)))
    fail("STANDARD_PREWORK_EVIDENCE_FOREIGN");
  if (Object.values(report.audits).some(audit => [...audit.rule_refs, ...audit.findings.flatMap(row => row.rule_refs)]
    .some(rule => !subject.rule_refs.includes(rule)))) fail("STANDARD_PREWORK_RULES_FOREIGN");
  const verdicts = Object.fromEntries(Object.entries(report.audits).map(([kind, audit]) => [kind, audit.verdict]));
  const outcome = Object.values(verdicts).includes("failed") ? "failed"
    : Object.values(verdicts).includes("needs_information") ? "needs_information" : "passed";
  return { outcome, verdicts, source_kind: report.kind, origin_operation_id: subject.origin_operation_id,
    subject_sha256: shadowHash(subject), report_sha256: shadowHash(report), context_sha256: contextSha256,
    proposal_sha256: shadowHash(proposal), implementation_authorized: false, current_native_work_evidence: false,
    current_validation_evidence: false };
}

export function assertStandardCyclePreworkSelection(output) {
  valid(output, selectionSchema, 131072, "STANDARD_PREWORK_SELECTION_INVALID");
  if (output.outcome === "blocked") return output;
  const source = output.observations, subject = assertStandardCyclePreworkSubject(source.subject);
  const canonicalOrigin = ["cycle_plan_adopt", "cycle_owned_resume_admit", "cycle_canonical_resume_admit"].includes(source.origin_binding_ref);
  if (canonicalOrigin !== (subject.kind === "canonical_plan")) fail("STANDARD_PREWORK_SELECTION_INVALID");
  if (subject.kind === "fresh_cycle") {
    if (source.canonical_proposal !== null || source.canonical_complete) fail("STANDARD_PREWORK_SELECTION_INVALID");
  } else {
    const proposal = assertStandardCyclePlan(source.canonical_proposal);
    if (shadowHash(proposal) !== subject.proposal_sha256 || proposal.session_id !== subject.session_id || proposal.cycle_id !== subject.cycle_id)
      fail("STANDARD_PREWORK_SELECTION_INVALID");
  }
  if (shadowHash(output.facts) !== shadowHash({ cycle_prework_required: !source.canonical_complete })) fail("STANDARD_PREWORK_SELECTION_INVALID");
  return output;
}
export function assertStandardCyclePreworkEvaluation(output) {
  valid(output, evaluationSchema, 262144, "STANDARD_PREWORK_EVALUATION_INVALID");
  if (output.outcome === "blocked") return output;
  const source = output.observations;
  if (source.cycle_path !== source.subject.cycle_path || (source.selection_operation_id === null) !== (source.selection_sha256 === null))
    fail("STANDARD_PREWORK_EVALUATION_INVALID");
  const checked = observeStandardCyclePrework({ subject: source.subject, report: source.report, contextSha256: source.context_sha256,
    proposalContextSha256: source.planning_context_sha256, evidenceRefs: source.context_evidence_refs,
    canonicalProposal: source.subject.kind === "canonical_plan" ? source.proposal : null });
  if (checked.proposal_sha256 !== shadowHash(source.proposal)) fail("STANDARD_PREWORK_EVALUATION_INVALID");
  const expectedOutcome = checked.outcome === "passed" ? "completed" : checked.outcome === "needs_information" ? "deferred" : "failed";
  const facts = expectedOutcome === "completed" ? { cycle_plan_available: true, cycle_plan_record_required: source.subject.kind === "fresh_cycle", cycle_prework_passed: true } : {};
  if (output.outcome !== expectedOutcome || shadowHash(output.facts) !== shadowHash(facts)) fail("STANDARD_PREWORK_EVALUATION_INVALID");
  return output;
}

export function assertStandardCyclePreworkWitness(witness) {
  valid(witness, witnessSchema, 2048, "STANDARD_PREWORK_WITNESS_REQUIRED");
  return witness;
}
