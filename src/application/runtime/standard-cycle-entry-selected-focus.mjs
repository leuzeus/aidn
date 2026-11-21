import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { selectedFocusSource, renderSelectedFocus, assertSelectedFocusInput, assertSelectedFocusPlan,
  assertSelectedFocusOutput, cycleEntrySelectedFocusOperation } from "../../core/workflow/standard-cycle-entry-selected-focus.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });
const withoutHead = ({ head, ...scope }) => scope;
const withoutChanges = ({ changes, ...view }) => view;

// This write consumes a protected accepted checkpoint and restores only focus.
// The selected canonical phase and all task/validation/audit history stay data;
// a later phase route still needs its own current admission and permissions.
export function createStandardCycleEntrySelectedFocus({ targetRoot, scope, readCheckpoint, readCurrent, now = Date.now }) {
  if (![scope, readCheckpoint, readCurrent].every(fn => typeof fn === "function")) fail("STANDARD_SELECTED_FOCUS_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const current = instance => {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_SELECTED_FOCUS_PROCESS_CHANGED");
  };
  const port = source => createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root },
    { profile: "cycle-context", approvedPaths: source.plan.overlay_paths });
  async function sourceFor(instance, input) {
    const source = await readCheckpoint(instance, input), descriptor = selectedFocusSource(source, input);
    current(instance); return { source, descriptor };
  }
  function sourceContext(source, descriptor) {
    const actual = scope();
    if (actual.branch !== descriptor.selected_branch || actual.head !== descriptor.selected_branch_head
      || shadowHash(withoutHead(actual)) !== source.plan.scope_without_head_sha256
      || shadowHash(artifacts.describe()) !== descriptor.backend_binding_sha256)
      fail("STANDARD_SELECTED_FOCUS_SCOPE_CHANGED");
    const view = port(source).inspect();
    if (!view.index_clean || view.lock_present || view.changes.length) fail("STANDARD_SELECTED_FOCUS_CLEAN_CONTEXT_REQUIRED");
    if (source.plan.git.files.length) {
      const physical = port(source).inspectCommit({ ...source.plan.git, operation_id: source.plan.operation_id,
        prepared_at_ms: source.plan.prepared_at_ms, plan_sha256: shadowHash(source.plan) });
      if (physical.status !== "confirmed" || physical.commit_sha !== descriptor.selected_branch_head)
        fail("STANDARD_SELECTED_FOCUS_CHECKPOINT_UNCONFIRMED");
    // A no-change source has no index-write postimage. Its old byte hash is
    // provenance; current clean semantics and the new plan fence apply.
    } else if (view.head !== source.plan.git.observed.head
      || view.filter_context_sha256 !== source.plan.git.observed.filter_context_sha256)
      fail("STANDARD_SELECTED_FOCUS_CHECKPOINT_UNCONFIRMED");
    return view;
  }
  function material(instance, plan, written, owner = null) {
    current(instance); if (owner !== null) artifacts.assertLocalEffectOwner(owner);
    if (shadowHash(scope()) !== plan.scope_sha256 || shadowHash(artifacts.describe()) !== plan.backend_binding_sha256)
      fail("STANDARD_SELECTED_FOCUS_SCOPE_CHANGED");
    const names = plan.documents.map(row => row.path), rows = artifacts.readMany(names, { required: names, includeMetadata: true });
    for (const expected of plan.documents) {
      const row = rows.find(row => row.path === expected.path), after = plan.changes.find(row => row.path === expected.path), own = written.get(expected.path);
      if (row.sha256 !== (own ? after.after_sha256 : expected.sha256)
        || row.metadata_sha256 !== (own ? own.metadata_sha256 : expected.metadata_sha256))
        fail("STANDARD_SELECTED_FOCUS_DOCUMENT_CHANGED");
    }
    const observed = observeStandardCycleEntryContext({ artifacts, scope, sessionId: plan.session_id });
    if (observed.inventory_sha256 !== plan.inventory_sha256) fail("STANDARD_SELECTED_FOCUS_INVENTORY_CHANGED");
    const view = createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root },
      { profile: "cycle-context", approvedPaths: plan.changes.map(row => "docs/audit/" + row.path) }).inspect();
    if (shadowHash(withoutChanges(view)) !== shadowHash(withoutChanges(plan.git_observed))
      || view.changes.some(row => ![...written.keys()].map(name => "docs/audit/" + name).includes(row.path)))
      fail("STANDARD_SELECTED_FOCUS_GIT_CHANGED");
    current(instance);
  }
  function projectionFiles(changes) {
    if (artifacts.describe().database && artifacts.describe().state_mode === "db-only") return [];
    return changes.map(row => agentRunPhysicalPath(path.join(artifacts.root, "docs/audit", row.path)));
  }
  async function prepare(instance, input, operationId, at, owner = null) {
    assertSelectedFocusInput(input); current(instance);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_SELECTED_FOCUS_OPERATION_ID_INVALID");
    if (owner === null && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    if (owner !== null) artifacts.assertLocalEffectOwner(owner);
    const admission = await preWriteAdmit({ targetRoot: artifacts.root, skill: "start-session" });
    if (!admission.ok) return { can_apply: false, reason_code: "STANDARD_SELECTED_FOCUS_ADMISSION_BLOCKED" };
    const { source, descriptor } = await sourceFor(instance, input), git = sourceContext(source, descriptor);
    const names = descriptor.canonical.map(row => row.path), documents = artifacts.readMany(names, { required: names, includeMetadata: true });
    if (shadowHash(documents.map(pin)) !== shadowHash(descriptor.canonical)) fail("STANDARD_SELECTED_FOCUS_CANONICAL_CHANGED");
    const rendered = renderSelectedFocus({ descriptor, documents, operationId, preparedAt: at });
    const plan = assertSelectedFocusPlan({ contract_version: "standard-cycle-entry-selected-focus-plan.v1",
      operation_ref: cycleEntrySelectedFocusOperation, operation_id: operationId, input, prepared_at_ms: at,
      source_sha256: descriptor.source_sha256, scope_sha256: shadowHash(scope()), backend_binding_sha256: descriptor.backend_binding_sha256,
      inventory_sha256: descriptor.inventory_sha256, session_id: descriptor.session_id,
      selected_cycle_id: descriptor.selected_cycle_id, selected_cycle_path: descriptor.selected_cycle_path,
      selected_state: descriptor.selected_state, selected_branch: descriptor.selected_branch, selected_branch_head: descriptor.selected_branch_head,
      deferred_cycles: descriptor.deferred_cycles, carry_over_pending: descriptor.carry_over_pending, git_observed: git, ...rendered });
    material(instance, plan, new Map(), owner);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  const output = (outcome, effect_status, observations, facts = {}) => assertSelectedFocusOutput({
    contract_version: "standard-cycle-entry-selected-focus-output.v1", operation_ref: cycleEntrySelectedFocusOperation,
    outcome, effect_status, observations, facts, evidence_refs: [] });
  return Object.freeze({
    prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = assertSelectedFocusPlan(prepared?.plan);
      if (write !== true || !prepared?.can_apply || typeof assertAuthorized !== "function" || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        throw Object.assign(Error("STANDARD_SELECTED_FOCUS_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_SELECTED_FOCUS_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const written = new Map(); let attempted = false;
        const permission = async () => {
          await assertAuthorized(); const { descriptor } = await sourceFor(instance, plan.input);
          if (descriptor.source_sha256 !== plan.source_sha256) fail("STANDARD_SELECTED_FOCUS_SOURCE_CHANGED");
          await assertAuthorized(); material(instance, plan, written, expectPlan);
        };
        try {
          await permission();
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, expectPlan);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_SELECTED_FOCUS_PREVIEW_CHANGED");
          projectionFiles(plan.changes);
          for (const change of plan.changes) {
            await permission(); attempted = true;
            const committed = artifacts.compareAndSwapPreservingMetadata({ ...change, after: change.text_chunks.join("") });
            written.set(change.path, { metadata_sha256: committed.metadata_sha256 }); material(instance, plan, written, expectPlan);
          }
          artifacts.project(plan.changes.map(row => row.path));
          for (const file of projectionFiles(plan.changes)) {
            const change = plan.changes.find(row => path.resolve(artifacts.root, "docs/audit", row.path) === file);
            if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== change.after_sha256)
              fail("STANDARD_SELECTED_FOCUS_PROJECTION_UNCONFIRMED");
          }
          await permission();
          return output("completed", "confirmed", { checkpoint_operation_id: plan.input.checkpoint_operation_id, source_sha256: plan.source_sha256,
            session_id: plan.session_id, selected_cycle_id: plan.selected_cycle_id, selected_cycle_path: plan.selected_cycle_path,
            selected_state: plan.selected_state, selected_branch: plan.selected_branch, selected_branch_head: plan.selected_branch_head,
            phase_route: plan.phase_route, deferred_cycles: plan.deferred_cycles, carry_over_pending: plan.carry_over_pending,
            phase_admission: false, progress_adoption: false, implementation_authorized: false,
            committed: plan.changes.map(row => ({ path: row.path, sha256: row.after_sha256, metadata_sha256: written.get(row.path).metadata_sha256 })) },
          { cycle_entry_focus_recorded: true, cycle_entry_resume_allowed: false });
        } catch (cause) {
          if (!attempted) { cause.effect_status = "no_effect"; throw cause; }
          return output("reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_SELECTED_FOCUS_UNCONFIRMED" });
        }
      });
    },
  });
}
