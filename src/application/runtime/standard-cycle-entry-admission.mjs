import { runStartSessionAdmitUseCase } from "./start-session-admit-use-case.mjs";
import { runBranchCycleAuditAdmitUseCase } from "./branch-cycle-audit-admit-use-case.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const active = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);
const fields = row => analyzeStructuredArtifact(row.content).key_values;
const pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });

// This observes canonical entry, not plan adoption, phase entry or a checkout.
// A requested ID is never treated as an authenticated human choice.
export const createStandardCycleEntryAdmission = options => createEntryOperation(options, false);
export const createStandardCycleEntryObserver = options => createEntryOperation(options, true);

function createEntryOperation({ artifacts, scope, admitCreation }, observation) {
  if (!observation && typeof admitCreation !== "function") fail("STANDARD_CYCLE_ENTRY_CREATION_PORT_REQUIRED");
  const observe = input => observeStandardCycleEntryContext({ artifacts, scope, sessionId: input.session_id });
  return async input => {
    assertStandardOperationInput(observation ? "cycle_entry_observe" : "cycle_entry_admit", input);
    const before = observe(input), state = before.state, metadata = before.metadata;
    const emit = (action, reason_code = null, selected_cycle = null, canonical = before.canonical) => assertStandardOperationOutput({
      contract_version: observation ? "standard-cycle-entry-observation-output.v1" : "standard-cycle-entry-output.v1",
      operation_ref: observation ? "cycle_entry_observe" : "cycle_entry_admit", outcome: action === "blocked" ? "blocked" : "completed", effect_status: "no_effect",
      facts: action === "blocked" ? {} : observation
        ? { cycle_entry_fresh_context: action === "prepare_creation", cycle_entry_owned_context: action === "owned_cycle", cycle_entry_choice_required: action === "choose_cycle" }
        : { cycle_entry_creation_allowed: action === "create_cycle", cycle_entry_resume_allowed: action === "resume_cycle", cycle_entry_choice_required: action === "choose_cycle" },
      observations: { action, reason_code, scope_sha256: shadowHash(before.scope), inventory_sha256: before.inventory_sha256,
        selected_cycle, canonical, implementation_authorized: false, ...(observation ? { creation_authorized: false } : {}) }, evidence_refs: canonical.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.sha256 })) });
    if (artifacts.ownerPending()) return emit("blocked", "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
    if (state.active_session !== input.session_id || fields(before.session).state !== "OPEN" || state.mode !== "COMMITTING"
      || metadata.mode !== state.mode || metadata.session_branch !== state.session_branch) return emit("blocked", "STANDARD_CYCLE_ENTRY_SESSION_CHANGED");
    const owned = before.cycles.filter(row => active.has(row.fields.state) && row.fields.session_owner === input.session_id);
    const pending = metadata.reported_from_previous_session.length > 0 || metadata.carry_over_pending === true || metadata.carry_over_pending === "yes";
    if (input.cycle_id !== null && !before.cycles.some(row => row.cycle_id === input.cycle_id)) return emit("blocked", "STANDARD_CYCLE_ENTRY_UNKNOWN_CYCLE");
    let action, reason = null, selected = null, canonical = before.canonical;
    if (pending || owned.length > 1) { action = "choose_cycle"; reason = pending ? "STANDARD_CYCLE_ENTRY_CARRYOVER_DECISION_REQUIRED" : "STANDARD_CYCLE_ENTRY_CHOICE_REQUIRED"; }
    else if (owned.length === 0) {
      if (input.cycle_id !== null || state.active_cycle !== "none") return emit("blocked", "STANDARD_CYCLE_ENTRY_OWNER_REQUIRED");
      if (observation) {
        // This only selects the checkpoint domain. The existing checkpoint and
        // full creation admission still run before any cycle initialization.
        if (before.scope.branch !== metadata.session_branch) return emit("blocked", "STANDARD_CYCLE_ENTRY_SESSION_BRANCH_REQUIRED");
        action = "prepare_creation";
      } else {
        const admitted = assertStandardOperationOutput(await admitCreation());
        if (admitted.outcome !== "completed" || admitted.facts.cycle_creation_allowed !== true
          || admitted.observations.lifecycle?.active_session !== input.session_id) return emit("blocked", "STANDARD_CYCLE_ENTRY_CREATION_NOT_ADMITTED");
        action = "create_cycle";
      }
    } else {
      const cycle = owned[0], status = cycle.fields, cyclePath = cycle.row.path.slice(0, -"/status.md".length);
      if (input.cycle_id !== null && input.cycle_id !== cycle.cycle_id) return emit("blocked", "STANDARD_CYCLE_ENTRY_OWNER_REQUIRED");
      if (state.active_cycle !== cycle.cycle_id || state.cycle_branch !== status.branch_name || status.branch_name !== before.scope.branch
        || metadata.cycle_branch !== status.branch_name || !metadata.attached_cycles.includes(cycle.cycle_id)
        || !metadata.integration_target_cycles.includes(cycle.cycle_id)) {
        action = "choose_cycle"; reason = "STANDARD_CYCLE_ENTRY_TOPOLOGY_DECISION_REQUIRED";
      } else {
        if (!["true", "false"].includes(status.scope_frozen) || !status.dor_state) return emit("blocked", "STANDARD_CYCLE_ENTRY_PHASE_REQUIRED");
        canonical = [...before.canonical, ...["status", "brief", "plan", "audit-spec", "traceability"].map(name => pin(before.required(`${cyclePath}/${name}.md`)))];
        const start = await runStartSessionAdmitUseCase({ targetRoot: artifacts.root, mode: state.mode });
        const audit = await runBranchCycleAuditAdmitUseCase({ targetRoot: artifacts.root, mode: state.mode });
        if (!start.ok || start.action !== "resume_current_cycle" || start.active_session !== input.session_id
          || !audit.ok || audit.action !== "audit_cycle_branch" || audit.mapped_cycle?.cycle_id !== cycle.cycle_id
          || audit.mapped_session?.session_id !== input.session_id) return emit("blocked", "STANDARD_CYCLE_ENTRY_RUNTIME_NOT_ADMITTED");
        action = observation ? "owned_cycle" : "resume_cycle"; selected = { cycle_id: cycle.cycle_id, cycle_path: cyclePath, branch: status.branch_name,
          state: status.state, dor_state: status.dor_state, scope_frozen: status.scope_frozen };
      }
    }
    const after = observe(input), afterPins = canonical.map(row => pin(after.required(row.path)));
    if (artifacts.ownerPending() || shadowHash(before.scope) !== shadowHash(after.scope) || before.inventory_sha256 !== after.inventory_sha256
      || shadowHash(canonical) !== shadowHash(afterPins)) return emit("blocked", "STANDARD_CYCLE_ENTRY_CONTEXT_CHANGED");
    return emit(action, reason, selected, canonical);
  };
}
