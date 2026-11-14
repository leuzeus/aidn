import { assertStandardCyclePlan } from "./standard-cycle-planning.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";
export function evaluateStandardCycleValidation({ source, evidence, validationOperationId }) {
  const proposal = assertStandardCyclePlan(source.proposal), observed = new Set(source.observed_task_ids);
  const imported = source.canonical_resume_source ? source.imported_task_ids : [];
  if (!Array.isArray(imported) || shadowHash(imported) !== shadowHash(proposal.tasks.slice(0, imported.length).map(row => row.id))
    || imported.some(id => observed.has(id)) || source.canonical_resume_source && (checkShadowJson(source.canonical_resume_source)
      || !/^op_[a-f0-9]{40}$/.test(source.canonical_resume_source.operation_id ?? "")
      || !/^[a-f0-9]{64}$/.test(source.canonical_resume_source.output_sha256 ?? "")))
    throw Object.assign(Error("STANDARD_CANONICAL_RESUME_VALIDATION_SOURCE_INVALID"), { code: "STANDARD_CANONICAL_RESUME_VALIDATION_SOURCE_INVALID" });
  const completed = new Set([...observed, ...imported]), remaining = proposal.tasks.filter(task => !completed.has(task.id)).map(task => task.id);
  const passed = new Set(evidence.checks.filter(row => row.status === "passed").map(row => row.test_ref));
  const pending = proposal.tests.filter(test => !passed.has(test.id)).map(test => test.id);
  return { contract_version: "standard-cycle-verification-output.v1", operation_ref: "cycle_validation_evaluate", outcome: "completed", effect_status: "no_effect",
    facts: { cycle_validation_evidence_fresh: true, cycle_work_complete: remaining.length === 0, cycle_checks_passed: pending.length === 0 },
    observations: { validation_operation_id: validationOperationId, ...(source.progress_operation_id ? { progress_operation_id: source.progress_operation_id } : {}), validation_sha256: shadowHash(source.output), profile_sha256: evidence.plan.profile_sha256,
      product_sha256: evidence.plan.product_sha256, scope_sha256: source.work.output.observations.scope_sha256, cycle_path: source.context.cycle_path,
      context_sha256: source.context_sha256, status: evidence.manifest.status, proof_class: evidence.plan.proof_class, checks: evidence.checks,
      observed_task_ids: proposal.tasks.filter(task => observed.has(task.id)).map(task => task.id),
      ...(source.canonical_resume_source ? { imported_task_ids: imported, canonical_resume_source: source.canonical_resume_source } : {}),
      remaining_work_task_ids: remaining, pending_test_refs: pending,
      audit_status: "pending", skill_completion: "pending" }, evidence_refs: evidence.evidence_refs };
}
