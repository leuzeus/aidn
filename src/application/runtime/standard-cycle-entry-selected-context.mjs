import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { runStartSessionAdmitUseCase } from "./start-session-admit-use-case.mjs";
import { runBranchCycleAuditAdmitUseCase } from "./branch-cycle-audit-admit-use-case.mjs";
import { cycleEntrySelectedSource, assertCycleEntrySelectedInput } from "../../core/workflow/standard-cycle-entry-selected-source.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const stableScope = ({ branch, head, ...scope }) => scope;
const fields = row => analyzeStructuredArtifact(row.content).key_values;

// This protected read observes the selected candidate while canonical focus is
// suspended. It grants no phase admission, readiness, history adoption or write.
// The owning host must authenticate the accepted activation and original H source.
export function createStandardCycleEntrySelectedContext({ artifacts, scope, readActivation, readCurrent }) {
  if (![scope, readActivation, readCurrent].every(fn => typeof fn === "function"))
    fail("STANDARD_CYCLE_SELECTED_CONTEXT_AUTHORITY_REQUIRED");
  const current = (instance, signal, owner) => {
    if (signal?.aborted) fail("STANDARD_CYCLE_SELECTED_CONTEXT_ABORTED");
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
      fail("STANDARD_CYCLE_SELECTED_CONTEXT_PROCESS_CHANGED");
    // Only the owning application supplies this option; request JSON cannot.
    if (owner !== null) artifacts.assertLocalEffectOwner(owner);
    else if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
  };
  function capture(instance, source, descriptor, signal, owner) {
    current(instance, signal, owner);
    const before = observeStandardCycleEntryContext({ artifacts, scope, sessionId: descriptor.session_id }),
      state = before.state, metadata = before.metadata, plan = source.plan,
      selected = before.cycles.find(row => row.cycle_id === descriptor.selected_cycle_id);
    if (shadowHash(stableScope(before.scope)) !== plan.scope_without_git_sha256
      || shadowHash(artifacts.describe()) !== plan.backend_binding_sha256
      || before.scope.branch !== descriptor.branch || before.scope.head !== descriptor.head
      || state.active_session !== descriptor.session_id || state.active_cycle !== "none" || state.mode !== "COMMITTING"
      || fields(before.session).state !== "OPEN" || metadata.mode !== "COMMITTING"
      || !metadata.attached_cycles.includes(descriptor.selected_cycle_id)
      || !metadata.integration_target_cycles.includes(descriptor.selected_cycle_id)
      || descriptor.deferred_cycles.includes(descriptor.selected_cycle_id)
      || !selected || selected.row.path !== descriptor.selected_cycle_path + "/status.md"
      || selected.fields.branch_name !== descriptor.branch || selected.fields.session_owner !== descriptor.session_id
      || selected.fields.state !== descriptor.selected_state)
      fail("STANDARD_CYCLE_SELECTED_CONTEXT_CHANGED");
    const documents = artifacts.readMany(descriptor.documents.map(row => row.path),
      { required: descriptor.documents.map(row => row.path), includeMetadata: true })
      .map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
    if (shadowHash(documents) !== shadowHash(descriptor.documents)) fail("STANDARD_CYCLE_SELECTED_DOCUMENTS_CHANGED");
    const changed = new Set(source.checkpoint.record.plan.changes.map(row => row.path)
      .filter(name => /^cycles\/C\d+[^/]*\/status[.]md$/.test(name)));
    const untouched = before.cycles.filter(({ row }) => !changed.has(row.path)).map(({ row, cycle_id }) =>
      ({ cycle_id, path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 }));
    if (shadowHash(untouched) !== plan.unchanged_cycle_inventory_sha256)
      fail("STANDARD_CYCLE_SELECTED_INVENTORY_CHANGED");
    current(instance, signal, owner);
    return { source_sha256: descriptor.source_sha256, activation_operation_id: descriptor.activation_operation_id,
      session_id: descriptor.session_id, selected_cycle: { cycle_id: descriptor.selected_cycle_id,
        cycle_path: descriptor.selected_cycle_path, branch: descriptor.branch, head: descriptor.head,
        state: selected.fields.state, dor_state: selected.fields.dor_state, scope_frozen: selected.fields.scope_frozen },
      canonical: documents, inventory_sha256: before.inventory_sha256,
      scope_sha256: shadowHash(before.scope), backend_binding_sha256: shadowHash(artifacts.describe()),
      deferred_cycles: descriptor.deferred_cycles, carry_over_pending: descriptor.carry_over_pending,
      phase_admission: "not_evaluated", implementation_authorized: false };
  }
  return async (instance, input, { signal, owner = null } = {}) => {
    assertCycleEntrySelectedInput(input); current(instance, signal, owner);
    const source = await readActivation(instance, input), descriptor = cycleEntrySelectedSource(source, input),
      before = capture(instance, source, descriptor, signal, owner);
    const start = await runStartSessionAdmitUseCase({ targetRoot: artifacts.root, mode: "COMMITTING" });
    const audit = await runBranchCycleAuditAdmitUseCase({ targetRoot: artifacts.root, mode: "COMMITTING" });
    if (!start.ok || start.action !== "resume_current_cycle" || start.active_session !== descriptor.session_id
      || start.mapped_cycle?.cycle_id !== descriptor.selected_cycle_id || start.branch !== descriptor.branch
      || !audit.ok || audit.action !== "audit_cycle_branch" || audit.mapped_cycle?.cycle_id !== descriptor.selected_cycle_id
      || audit.mapped_session?.session_id !== descriptor.session_id || audit.branch !== descriptor.branch)
      fail("STANDARD_CYCLE_SELECTED_RUNTIME_NOT_ADMITTED");
    const freshSource = await readActivation(instance, input), freshDescriptor = cycleEntrySelectedSource(freshSource, input),
      after = capture(instance, freshSource, freshDescriptor, signal, owner);
    if (shadowHash(source) !== shadowHash(freshSource) || shadowHash(before) !== shadowHash(after))
      fail("STANDARD_CYCLE_SELECTED_CONTEXT_CHANGED");
    return { context: after, context_sha256: shadowHash(after) };
  };
}
