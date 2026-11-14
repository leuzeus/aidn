import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { assertDiagnosticPathScope } from "./standard-drift-git.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const textChunks = text => {
  const chunks = []; let current = "";
  for (const character of text) {
    if (current.length + character.length > 8192) { chunks.push(current); current = ""; }
    current += character;
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks;
};

// The caller supplies an authenticated VERIFYING bridge and machine evidence.
// This reader establishes canonical document presence without projecting a DB
// or turning a partial/visible inventory into proof of absence.
export function buildStandardCycleAuditContext({ targetRoot, environment = process.env, deniedRoots = [], bridge, validation }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment }), source = bridge.context, cyclePath = source.cycle_path;
  if (source.cycle_state !== "VERIFYING" || source.mode !== "COMMITTING" || shadowHash(source) !== bridge.context_sha256
    || !/^cycles\/C[0-9]{3,6}-[a-z]+-[A-Za-z0-9._-]+$/.test(cyclePath ?? "") || checkShadowJson(validation)
    || validation.product_sha256 !== source.product_sha256 || shadowHash(bridge.source.work.files) !== source.product_sha256) fail("STANDARD_AUDIT_CONTEXT_SOURCE_INVALID");
  const observe = () => {
    const inventory = artifacts.inventory();
    if (inventory.complete !== true) fail("STANDARD_AUDIT_INVENTORY_REQUIRED");
    const required = ["SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", ...["brief", "plan", "audit-spec", "traceability", "decisions", "change-requests", "status"].map(name => `${cyclePath}/${name}.md`)];
    if (required.some(name => !inventory.paths.includes(name))) fail("STANDARD_AUDIT_DOCUMENT_REQUIRED");
    const conditional = ["gap-report.md", "hypotheses.md"].map(name => cyclePath + "/" + name).filter(name => inventory.paths.includes(name));
    const documents = [...required, ...conditional].map(name => {
      assertDiagnosticPathScope(path.join(artifacts.root, "docs/audit", name), deniedRoots);
      const row = artifacts.read(name, { required: true });
      return { ref: "audit:" + row.path, sha256: row.sha256, content_chunks: textChunks(row.content) };
    });
    const metadata = documents.map(row => ({ ref: row.ref, sha256: artifacts.metadataHash(row.ref.slice(6)) }));
    // Establish completeness using the full canonical inventory first. Pin the
    // audit's document namespace, so unrelated dispatch/inbox records can be
    // durably added without making the audit invalidate itself. New cycle
    // documents and required-document changes still invalidate this material.
    const scope = { contract_version: "standard-cycle-audit-inventory-scope.v1", cycle_path: cyclePath, required_paths: required };
    const paths = inventory.paths.filter(name => required.includes(name) || name.startsWith(cyclePath + "/"));
    return { inventory: { complete: true, source: inventory.source, paths, scope, sha256: shadowHash({ scope, paths }) }, documents, metadata };
  };
  const material = observe(), confirmed = observe();
  if (shadowHash(material) !== shadowHash(confirmed)) fail("STANDARD_AUDIT_DOCUMENTS_CHANGED");
  const evidence = [...material.documents.map(({ ref, sha256 }) => ({ ref, sha256 })), ...validation.evidence_refs,
    { ref: "product:snapshot", sha256: source.product_sha256 }, ...bridge.source.work.files.filter(row => row.present).map(row => ({ ref: "product:" + row.path, sha256: row.sha256 }))];
  const references = [...new Map(evidence.map(row => [row.ref, row])).values()];
  if (evidence.some(row => references.find(source => source.ref === row.ref).sha256 !== row.sha256)) fail("STANDARD_AUDIT_EVIDENCE_AMBIGUOUS");
  const context = { contract_version: "standard-cycle-audit-context.v1", source_context_sha256: bridge.context_sha256,
    project_scope_sha256: source.project_scope_sha256, branch: source.branch, head: source.head, mode: source.mode, session_id: source.session_id,
    cycle_id: source.cycle_id, cycle_path: cyclePath, cycle_state: source.cycle_state, product_sha256: source.product_sha256,
    scope_sha256: bridge.source.work.output.observations.scope_sha256, implementation_operation_id: bridge.source.work.output.observations.implementation_operation_id,
    verification_operation_id: bridge.verification.record.operation_id, proposal: bridge.source.proposal, validation,
    ...(bridge.source.canonical_resume_source ? { canonical_resume_source: bridge.source.canonical_resume_source,
      imported_task_ids: bridge.source.imported_task_ids, current_observed_task_ids: bridge.source.observed_task_ids } : {}),
    canonical_inventory_complete: true, canonical_inventory_sha256: material.inventory.sha256, canonical_inventory_source: material.inventory.source,
    canonical_inventory_scope: material.inventory.scope,
    canonical_state_mode: artifacts.describe().state_mode, audit_metadata_pins: material.metadata, audit_documents: material.documents, evidence_refs: references };
  if (checkShadowJson(context) || Buffer.byteLength(JSON.stringify(context)) > 196608) fail("STANDARD_AUDIT_CONTEXT_LIMIT");
  return { context, context_sha256: shadowHash(context) };
}
