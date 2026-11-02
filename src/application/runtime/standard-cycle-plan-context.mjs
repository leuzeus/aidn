import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { readStandardDriftContext } from "./standard-drift-report.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { assertStandardCyclePlan } from "../../core/workflow/standard-cycle-planning.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import path from "node:path";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export async function readStandardCyclePlanContext(options) {
  const observed = await readStandardDriftContext(options), source = observed.context;
  if (source.context_use !== "active_cycle" || source.cycle_state !== "OPEN" || source.git.other_changes.count !== 0) fail("STANDARD_CYCLE_PLAN_CONTEXT_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: options.targetRoot, env: options.environment });
  const current = artifacts.read("CURRENT-STATE.md", { required: true }), fields = analyzeStructuredArtifact(current.content).key_values;
  const cycle = artifacts.cycles().find(row => row.cycle_id === source.cycle_id), status = analyzeStructuredArtifact(cycle.content).key_values;
  const session = artifacts.sessions().find(row => row.session_id === source.session_id);
  const match = /^cycles\/(C[0-9]{3,6})-([a-z]+)-[A-Za-z0-9._-]+\/status\.md$/.exec(cycle.path);
  if (!match || match[1] !== source.cycle_id || !["COMMITTING", "EXPLORING"].includes(fields.mode) || parseSessionMetadata(session.content).mode !== fields.mode
    || status.scope_frozen !== "false" || status.dor_state !== "NOT_READY" || status.dor_override_reason !== "none"
    || status.session_owner !== source.session_id || status.branch_name !== source.branch) fail("STANDARD_CYCLE_PLAN_CONTEXT_REQUIRED");
  const kernel = artifacts.read("WORKFLOW-KERNEL.md", { required: true }), kernelRef = { ref: "audit:" + kernel.path, sha256: kernel.sha256 };
  const productPaths = options.productFiles.map(name => path.relative(artifacts.root, path.resolve(options.productRoot, name)).replaceAll("\\", "/"));
  if (productPaths.some(name => !name || name.startsWith("../") || path.isAbsolute(name))) fail("STANDARD_CYCLE_PLAN_SCOPE_NOT_ADMITTED");
  const context = { ...source, contract_version: "standard-cycle-plan-context.v1", mode: fields.mode, cycle_type: match[2], cycle_path: cycle.path.replace(/\/status\.md$/, ""),
    allowed_product_files: productPaths, documents: [...source.documents, { ...kernelRef, content: kernel.content }] };
  if (Buffer.byteLength(JSON.stringify(context)) > 196608) fail("STANDARD_CYCLE_PLAN_CONTEXT_TOO_LARGE");
  return { context, context_sha256: shadowHash(context), evidence_refs: [...observed.evidence_refs, kernelRef] };
}
export function evaluateStandardCyclePlan(authenticated, observed) {
  const proposal = assertStandardCyclePlan(authenticated.report), context = observed.context;
  if (proposal.context_sha256 !== observed.context_sha256 || proposal.session_id !== context.session_id || proposal.cycle_id !== context.cycle_id
    || proposal.cycle_type !== context.cycle_type || proposal.objective !== context.original_objective) fail("STANDARD_CYCLE_PLAN_SOURCE_STALE");
  if (!proposal.evidence_refs.some(row => row.ref === "audit:SPEC.md")
    || proposal.evidence_refs.some(ref => !observed.evidence_refs.some(row => row.ref === ref.ref && row.sha256 === ref.sha256))) fail("STANDARD_CYCLE_PLAN_EVIDENCE_INVALID");
  for (const task of proposal.tasks) if (task.intent !== (context.mode === "COMMITTING" ? "implementation" : "exploration")
    || task.paths.some(row => !context.allowed_product_files.includes(row.path))) fail("STANDARD_CYCLE_PLAN_SCOPE_NOT_ADMITTED");
  return { contract_version: "standard-cycle-planning-output.v1", operation_ref: "cycle_plan_evaluate", outcome: "completed", effect_status: "no_effect",
    facts: { cycle_plan_available: true }, observations: { proposal, producer: authenticated.producer, context_sha256: observed.context_sha256,
      cycle_path: context.cycle_path, readiness: "pending", implementation: "not_authorized" }, evidence_refs: [authenticated.reference] };
}
