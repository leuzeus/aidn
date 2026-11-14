import reportSchema from "../contracts/workflow-definition/standard-cycle-audit-report.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-cycle-audit-output.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { assertStandardCyclePlan } from "./standard-cycle-planning.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";

export const CYCLE_AUDIT_CONTRACT = "standard-cycle-audit-report.v1";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const unique = values => new Set(values).size === values.length;
const sameSet = (left, right) => unique(left) && unique(right) && left.length === right.length && left.every(value => right.includes(value));
export function assertStandardCycleAuditReport(report) {
  if (checkShadowJson(report) || validateJsonSchema(report, reportSchema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(report)) > 65536) fail("STANDARD_CYCLE_AUDIT_REPORT_INVALID");
  const normalized = value => typeof value !== "string" || value === value.replace(/\s+/gu, " ").trim();
  if (![...report.requirements, ...report.usages, ...report.document_reviews, ...report.findings].every(row => normalized(row.rationale))
    || !unique(report.findings.map(row => row.id)) || !unique(report.evidence_refs.map(row => row.ref))) fail("STANDARD_CYCLE_AUDIT_REPORT_INVALID");
  for (const row of [...report.requirements, ...report.usages, ...report.document_reviews, ...report.findings])
    if (!unique(row.evidence_refs.map(ref => ref.ref))) fail("STANDARD_CYCLE_AUDIT_REPORT_INVALID");
  return report;
}
// The application host must authenticate the native result, current source,
// complete canonical inventory and verification evidence before calling this
// observer. A recorded checklist is a proposal, never consent or closure.
export function observeStandardCycleAudit({ report, context, contextSha256, producer, evidenceRefs }) {
  assertStandardCycleAuditReport(report); assertStandardCyclePlan(context.proposal);
  if (checkShadowJson(context) || context.contract_version !== "standard-cycle-audit-context.v1" || context.cycle_state !== "VERIFYING" || context.mode !== "COMMITTING"
    || context.cycle_id !== context.proposal.cycle_id || !/^op_[a-f0-9]{40}$/.test(context.implementation_operation_id ?? "")
    || context.canonical_inventory_complete !== true || !/^[a-f0-9]{64}$/.test(context.canonical_inventory_sha256 ?? "")
    || !/^op_[a-f0-9]{40}$/.test(context.verification_operation_id ?? "") || !/^[a-f0-9]{64}$/.test(context.product_sha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(context.scope_sha256 ?? "") || typeof context.validation?.work_complete !== "boolean"
    || context.validation.product_sha256 !== context.product_sha256 || shadowHash(context) !== contextSha256
    || report.context_sha256 !== contextSha256 || report.cycle_id !== context.proposal.cycle_id) fail("STANDARD_CYCLE_AUDIT_SOURCE_REQUIRED");
  const proposal = context.proposal, documents = context.audit_documents;
  if (!Array.isArray(documents) || !documents.length || !sameSet(report.document_reviews.map(row => row.ref), documents.map(row => row.ref))
    || report.document_reviews.some(row => !documents.some(source => row.ref === source.ref && row.sha256 === source.sha256))
    || !sameSet(report.requirements.map(row => row.requirement_ref), proposal.requirements.map(row => row.id))
    || !sameSet(report.usages.map(row => row.usage_index), proposal.usage_matrix.map((_row, index) => index + 1))) fail("STANDARD_CYCLE_AUDIT_COVERAGE_INCOMPLETE");
  const allowed = context.evidence_refs;
  const references = [...report.evidence_refs, ...report.requirements.flatMap(row => row.evidence_refs), ...report.usages.flatMap(row => row.evidence_refs),
    ...report.document_reviews.flatMap(row => row.evidence_refs), ...report.findings.flatMap(row => row.evidence_refs)];
  if (!Array.isArray(allowed) || references.some(row => !allowed.some(source => row.ref === source.ref && row.sha256 === source.sha256))) fail("STANDARD_CYCLE_AUDIT_EVIDENCE_FOREIGN");
  const checks = context.validation.checks;
  if (!Array.isArray(checks) || !sameSet(checks.map(row => row.test_ref), proposal.tests.map(row => row.id))
    || checks.some(row => !["passed", "failed", "unavailable"].includes(row.status))) fail("STANDARD_CYCLE_AUDIT_VALIDATION_REQUIRED");
  const passed = new Set(checks.filter(row => row.status === "passed").map(row => row.test_ref));
  for (const row of report.requirements) if (row.status === "supported"
    && proposal.tests.some(test => test.requirement_refs.includes(row.requirement_ref) && !passed.has(test.id))) fail("STANDARD_CYCLE_AUDIT_CHECK_CONTRADICTION");
  for (const row of report.usages) if (row.status === "supported"
    && proposal.usage_matrix[row.usage_index - 1].test_refs.some(ref => !passed.has(ref))) fail("STANDARD_CYCLE_AUDIT_CHECK_CONTRADICTION");
  const pending = { requirements: report.requirements.filter(row => row.status !== "supported").map(row => row.requirement_ref),
    usages: report.usages.filter(row => row.status !== "supported").map(row => row.usage_index),
    documents: report.document_reviews.filter(row => row.status !== "reviewed").map(row => row.ref),
    tests: checks.filter(row => row.status !== "passed").map(row => row.test_ref),
    blocking_findings: report.findings.filter(row => row.severity === "blocking").map(row => row.id),
    risk_findings_requiring_human_decision: report.findings.filter(row => row.severity === "risk").map(row => row.id) };
  const blockers = context.validation.work_complete !== true || [pending.requirements, pending.usages, pending.documents, pending.tests, pending.blocking_findings].some(rows => rows.length);
  const output = { contract_version: "standard-cycle-audit-output.v1", operation_ref: "cycle_audit_evaluate", outcome: "completed", effect_status: "no_effect",
    facts: { cycle_audit_observed: true, cycle_audit_blockers_present: blockers, cycle_closure_decision_required: true },
    observations: { report_sha256: shadowHash(report), context_sha256: contextSha256, verification_operation_id: context.verification_operation_id,
      product_sha256: context.product_sha256, scope_sha256: context.scope_sha256, canonical_inventory_sha256: context.canonical_inventory_sha256, producer,
      requirement_statuses: report.requirements.map(({ requirement_ref, status }) => ({ requirement_ref, status })),
      usage_statuses: report.usages.map(({ usage_index, status }) => ({ usage_index, status })),
      document_reviews: report.document_reviews.map(({ ref, sha256, status }) => ({ ref, sha256, status })),
      finding_summary: report.findings.map(({ id, category, severity }) => ({ id, category, severity })), pending,
      recommendation: report.recommendation, skill_completion: "pending", lifecycle_transition: "none", human_decision: "required" }, evidence_refs: evidenceRefs };
  if (checkShadowJson(output) || validateJsonSchema(output, outputSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_CYCLE_AUDIT_OUTPUT_INVALID");
  return output;
}
