import { CYCLE_AUDIT_CONTRACT } from "../../src/core/workflow/standard-cycle-audit.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
export function attachCycleAuditModel(model, original) {
  const originalReview = original.nodes.find(row => row.id === "review"), role = original.roles.find(row => row.id === originalReview.role_ref);
  model.roles.push({ ...structuredClone(role), skills: ["cycle-close"] });
  model.policies.find(row => row.id === originalReview.policy_ref).mode = "COMMITTING";
  const op = (id, binding_ref) => ({ id, kind: "operation", participant_ref: "delivery", binding_ref });
  model.nodes[0].children.splice(-1, 0, "audit_select", "audit_review", "audit_evaluate");
  model.nodes.push(op("audit_select", "cycle_audit_select"), { ...structuredClone(originalReview), id: "audit_review" }, op("audit_evaluate", "cycle_audit_evaluate"));
  model.data_bindings.inputs.push({ node_id: "audit_select", fields: { implementation_operation_id: { source: "operation_id", node_id: "implementation_enter" } } },
    { node_id: "audit_review", fields: { audit_operation_id: { source: "operation_id", node_id: "audit_select" } } },
    { node_id: "audit_evaluate", fields: { report_occurrence_id: { source: "occurrence_id", node_id: "audit_review" } } });
  model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(row => model.nodes.some(node => node.binding_ref === row.id)).map(row => [row.id, shadowHash(row)]));
}
export function cycleAuditProposal(observed) {
  const context = observed.context, assessment = { status: "supported", rationale: "Offline fixture audit proposal; explicit human closure remains required", evidence_refs: context.validation.evidence_refs };
  return { contract_version: CYCLE_AUDIT_CONTRACT, context_sha256: observed.context_sha256, cycle_id: context.cycle_id,
    requirements: context.proposal.requirements.map(row => ({ requirement_ref: row.id, ...assessment })),
    usages: context.proposal.usage_matrix.map((_row, index) => ({ usage_index: index + 1, ...assessment })),
    document_reviews: context.audit_documents.map(({ ref, sha256 }) => ({ ref, sha256, ...assessment, status: "reviewed", evidence_refs: [{ ref, sha256 }] })),
    findings: [], recommendation: "request_closure_review", evidence_refs: context.validation.evidence_refs };
}
