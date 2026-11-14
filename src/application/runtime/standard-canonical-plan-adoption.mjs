import { projectStandardCanonicalCyclePlan } from "../../core/workflow/standard-canonical-plan-projection.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });

// The host supplies these capabilities; authored JSON supplies no observer,
// admission result or permission. This first path admits only an owned OPEN
// cycle without imported progress. Other phases retain their current bytes.
export function createStandardCanonicalPlanAdoption({ artifacts, scope, observeContext, admitEntry, readCurrent }) {
  if ([observeContext, admitEntry, readCurrent].some(port => typeof port !== "function")) fail("STANDARD_CANONICAL_PLAN_PORTS_REQUIRED");
  const assertCurrent = instance => {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CANONICAL_PLAN_PROCESS_CHANGED");
  };
  async function observe(instance) {
    assertCurrent(instance);
    const selected = artifacts.describe(), currentScope = scope(), observed = await observeContext();
    assertCurrent(instance);
    const projection = projectStandardCanonicalCyclePlan(observed), names = observed.context.documents.map(row => {
      if (!row.ref.startsWith("audit:")) fail("STANDARD_CANONICAL_PLAN_SOURCE_REQUIRED");
      return row.ref.slice("audit:".length);
    });
    const rows = artifacts.readMany(names, { required: names, includeMetadata: true });
    if (rows.some((row, index) => row.sha256 !== observed.context.documents[index].sha256)
      || shadowHash(selected) !== shadowHash(artifacts.describe()) || shadowHash(currentScope) !== shadowHash(scope()))
      fail("STANDARD_CANONICAL_PLAN_SOURCE_CHANGED");
    return { observed, projection, canonical: rows.map(pin), scope_sha256: shadowHash(currentScope), backend_sha256: shadowHash(selected) };
  }
  return async (instance, input) => {
    assertStandardOperationInput("cycle_plan_adopt", input);
    const before = await observe(instance), context = before.observed.context;
    const emit = (accepted, reason) => assertStandardOperationOutput({ contract_version: "standard-cycle-plan-adoption-output.v1", operation_ref: "cycle_plan_adopt",
      outcome: accepted ? "completed" : "blocked", effect_status: "no_effect", facts: accepted ? { canonical_cycle_plan_available: true } : {},
      observations: { source_kind: "canonical_plan", reason_code: reason, context_sha256: before.observed.context_sha256, scope_sha256: before.scope_sha256, canonical_binding_sha256: before.backend_sha256,
        cycle_path: context.cycle_path, canonical: before.canonical, proposal: accepted ? before.projection.proposal : null,
        original_plan_sha256: accepted ? artifactContentHash(before.projection.original_plan) : null,
        imported_completed_task_ids: [], readiness: "not_evaluated", implementation_authorized: false },
      evidence_refs: before.canonical.map(row => ({ ref: "audit:" + row.path, sha256: row.sha256 })) });
    if (artifacts.ownerPending()) return emit(false, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    if (context.context_use !== "active_cycle" || context.mode !== "COMMITTING" || context.cycle_state !== "OPEN"
      || before.projection.completed_task_ids.length || before.projection.proposal.tasks.some(row => row.intent !== "implementation"))
      return emit(false, "STANDARD_CANONICAL_PLAN_OPEN_PENDING_WORK_REQUIRED");
    if (!Array.isArray(context.allowed_product_files) || before.projection.proposal.tasks.some(task => task.paths.some(row => !context.allowed_product_files.includes(row.path))))
      return emit(false, "STANDARD_CANONICAL_PLAN_PRODUCT_SCOPE_REQUIRED");
    const entry = await admitEntry({ contract_version: "standard-cycle-entry-input.v1", session_id: context.session_id, cycle_id: context.cycle_id });
    if (entry.outcome !== "completed" || entry.facts.cycle_entry_resume_allowed !== true
      || entry.observations.selected_cycle?.cycle_id !== context.cycle_id || entry.observations.selected_cycle?.state !== "OPEN"
      || entry.observations.selected_cycle?.cycle_path !== context.cycle_path || entry.observations.selected_cycle?.branch !== context.branch)
      return emit(false, "STANDARD_CANONICAL_PLAN_CURRENT_ENTRY_REQUIRED");
    const after = await observe(instance);
    if (artifacts.ownerPending() || before.observed.context_sha256 !== after.observed.context_sha256
      || before.scope_sha256 !== after.scope_sha256 || before.backend_sha256 !== after.backend_sha256
      || shadowHash(before.canonical) !== shadowHash(after.canonical) || shadowHash(before.projection) !== shadowHash(after.projection))
      return emit(false, "STANDARD_CANONICAL_PLAN_SOURCE_CHANGED");
    return emit(true, null);
  };
}
