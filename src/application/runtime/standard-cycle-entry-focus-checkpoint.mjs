import fs from "node:fs";
import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { focusCheckpointSource, assertFocusCheckpointInput, assertFocusCheckpointPlan, assertFocusCheckpointOutput,
  cycleEntryFocusCheckpointOperation } from "../../core/workflow/standard-cycle-entry-focus-checkpoint.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });
const withoutHead = ({ head, ...scope }) => scope;
const fields = row => analyzeStructuredArtifact(row.content).key_values;
const pathsFor = session => ["docs/audit/CURRENT-STATE.md", "docs/audit/sessions/" + session + ".md", "docs/audit/snapshots/context-snapshot.md"].sort();
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertFocusCheckpointOutput({
  contract_version: "standard-cycle-entry-focus-checkpoint-output.v1", operation_ref: cycleEntryFocusCheckpointOperation,
  outcome, effect_status, observations, facts, evidence_refs });

// Preserve accepted canonical focus while checkpointing only its visible three
// postimages. This grants no current phase, work or imported-progress admission.
export function createStandardCycleEntryFocusCheckpoint({ targetRoot, scope, readFocus, readCurrent, now = Date.now }) {
  if (![scope, readFocus, readCurrent].every(fn => typeof fn === "function")) fail("STANDARD_FOCUS_CHECKPOINT_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }),
    port = session => createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root }, { profile: "cycle-context", approvedPaths: pathsFor(session) });
  const current = instance => {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_FOCUS_CHECKPOINT_PROCESS_CHANGED");
  };
  function physical(sessionId) {
    return pathsFor(sessionId).map(name => {
      const absolute = agentRunPhysicalPath(path.join(artifacts.root, name), { missing: true });
      if (!fs.existsSync(absolute)) return { path: name, sha256: null };
      const info = fs.lstatSync(absolute);
      if (!info.isFile() || info.nlink !== 1) fail("STANDARD_FOCUS_CHECKPOINT_REGULAR_FILE_REQUIRED");
      return { path: name, sha256: readAgentRunFile(absolute, { json: false, maxBytes: 1048576 }).sha256 };
    });
  }
  async function accepted(instance, input) {
    const source = await readFocus(instance, input), context = focusCheckpointSource(source, input);
    current(instance); return { source, context };
  }
  function material(instance, plan, source, expectedHead, owner = null) {
    current(instance); if (owner !== null) artifacts.assertLocalEffectOwner(owner);
    const actual = scope(), context = focusCheckpointSource(source, plan.input);
    if (shadowHash(source) !== plan.source_sha256 || shadowHash(context) !== plan.context_sha256
      || actual.branch !== context.selected_branch || actual.head !== expectedHead
      || shadowHash(withoutHead(actual)) !== plan.scope_without_head_sha256
      || shadowHash(artifacts.describe()) !== context.backend_binding_sha256 || artifacts.describe().state_mode !== plan.state_mode)
      fail("STANDARD_FOCUS_CHECKPOINT_SOURCE_CHANGED");
    const names = context.canonical.map(row => row.path), canonical = artifacts.readMany(names, { required: names, includeMetadata: true }).map(pin);
    if (shadowHash(canonical) !== shadowHash(context.canonical)) fail("STANDARD_FOCUS_CHECKPOINT_CANONICAL_CHANGED");
    const observed = observeStandardCycleEntryContext({ artifacts, scope, sessionId: context.session_id }),
      cycle = observed.cycles.find(row => row.cycle_id === context.selected_cycle_id);
    if (observed.inventory_sha256 !== context.inventory_sha256 || observed.state.active_session !== context.session_id
      || observed.state.active_cycle !== context.selected_cycle_id || observed.state.mode !== "COMMITTING"
      || observed.state.cycle_branch !== context.selected_branch || fields(observed.session).state !== "OPEN"
      || observed.metadata.primary_focus_cycle !== context.selected_cycle_id || observed.metadata.cycle_branch !== context.selected_branch
      || !observed.metadata.attached_cycles.includes(context.selected_cycle_id) || !observed.metadata.integration_target_cycles.includes(context.selected_cycle_id)
      || !cycle || cycle.fields.state !== context.selected_state || cycle.fields.branch_name !== context.selected_branch
      || cycle.fields.session_owner !== context.session_id || cycle.row.path !== context.selected_cycle_path + "/status.md")
      fail("STANDARD_FOCUS_CHECKPOINT_CONTEXT_CHANGED");
    if (shadowHash(physical(context.session_id)) !== shadowHash(plan.physical_focus)) fail("STANDARD_FOCUS_CHECKPOINT_PROJECTION_CHANGED");
    current(instance);
  }
  async function prepare(instance, input, operationId, at, owner = null) {
    assertFocusCheckpointInput(input); current(instance);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_FOCUS_CHECKPOINT_OPERATION_ID_INVALID");
    if (owner === null && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    if (owner !== null) artifacts.assertLocalEffectOwner(owner);
    const admission = await preWriteAdmit({ targetRoot: artifacts.root, skill: "start-session" });
    if (!admission.ok) return { can_apply: false, reason_code: "STANDARD_FOCUS_CHECKPOINT_ADMISSION_BLOCKED" };
    const { source, context } = await accepted(instance, input), actual = scope(), view = port(context.session_id).inspect(), physicalFocus = physical(context.session_id),
      stateMode = artifacts.describe().state_mode, allowed = pathsFor(context.session_id), expected = new Map(context.canonical.map(row => ["docs/audit/" + row.path, row.sha256]));
    if (shadowHash(actual) !== source.plan.scope_sha256 || view.branch !== context.selected_branch || view.head !== context.selected_branch_head
      || view.filter_context_sha256 !== source.plan.git_observed.filter_context_sha256 || !view.index_clean || view.lock_present)
      return { can_apply: false, reason_code: "STANDARD_FOCUS_CHECKPOINT_GIT_CHANGED" };
    if (view.changes.some(row => !allowed.includes(row.path)) || stateMode === "db-only" && view.changes.length)
      return { can_apply: false, reason_code: "STANDARD_FOCUS_CHECKPOINT_FOREIGN_CHANGES" };
    if (stateMode !== "db-only" && physicalFocus.some(row => row.sha256 !== expected.get(row.path)))
      fail("STANDARD_FOCUS_CHECKPOINT_PROJECTION_CHANGED");
    const observedPhysical = new Map(physicalFocus.map(row => [row.path, row.sha256])), files = view.changes.map(row => {
      const sha256 = observedPhysical.get(row.path);
      if (!sha256 || sha256 !== expected.get(row.path)) fail("STANDARD_FOCUS_CHECKPOINT_POSTIMAGE_REQUIRED");
      return { path: row.path, sha256 };
    });
    const plan = assertFocusCheckpointPlan({ contract_version: "standard-cycle-entry-focus-checkpoint-plan.v1", operation_ref: cycleEntryFocusCheckpointOperation,
      operation_id: operationId, input, prepared_at_ms: at, source_sha256: shadowHash(source), context, context_sha256: shadowHash(context),
      scope_without_head_sha256: shadowHash(withoutHead(actual)), state_mode: stateMode, physical_focus: physicalFocus,
      git: { operation_kind: "metadata-objects-ref-index.v1", observed: view, files } });
    material(instance, plan, source, view.head, owner);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = assertFocusCheckpointPlan(prepared?.plan);
      if (write !== true || !prepared?.can_apply || typeof assertAuthorized !== "function" || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        throw Object.assign(Error("STANDARD_FOCUS_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_FOCUS_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const git = port(plan.context.session_id), raw = { ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan };
        let gitStarted = false, result = null;
        const permission = async () => {
          await assertAuthorized(); const { source } = await accepted(instance, plan.input);
          await assertAuthorized(); let expectedHead = plan.git.observed.head;
          if (scope().head !== expectedHead) {
            if (!gitStarted) fail("STANDARD_FOCUS_CHECKPOINT_OWN_COMMIT_REQUIRED");
            const own = git.inspectCommit(raw);
            if (!["confirmed", "commit_observed"].includes(own.status)) fail("STANDARD_FOCUS_CHECKPOINT_OWN_COMMIT_REQUIRED");
            expectedHead = own.commit_sha;
          }
          material(instance, plan, source, expectedHead, expectPlan);
        };
        try {
          await permission(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, expectPlan);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_FOCUS_CHECKPOINT_PREVIEW_CHANGED");
          await permission();
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        try {
          gitStarted = true; result = await git.commit(raw, { assertAuthorized: permission }); await permission();
          const physicalResult = plan.git.files.length ? git.inspectCommit(raw) : git.inspect();
          if (plan.git.files.length ? physicalResult.status !== "confirmed"
            : physicalResult.branch !== plan.context.selected_branch || physicalResult.head !== plan.git.observed.head
              || !physicalResult.index_clean || physicalResult.lock_present || physicalResult.changes.length)
            fail("STANDARD_FOCUS_CHECKPOINT_POSTCONDITION_UNCONFIRMED");
          return emit("completed", result.effect_status, { focus_operation_id: plan.input.focus_operation_id, source_sha256: plan.source_sha256,
            context_sha256: plan.context_sha256, session_id: plan.context.session_id, selected_cycle_id: plan.context.selected_cycle_id,
            selected_cycle_path: plan.context.selected_cycle_path, selected_state: plan.context.selected_state, phase_route: plan.context.phase_route,
            selected_branch: plan.context.selected_branch, selected_branch_head: result.commit_sha ?? result.head,
            committed_paths: plan.git.files.map(row => row.path), git: result, canonical_preserved: true,
            phase_admission: false, progress_adoption: false, implementation_authorized: false },
          { cycle_entry_focus_checkpoint_ready: true, cycle_entry_focus_checkpoint_created: result.status === "confirmed", cycle_entry_resume_allowed: false },
          [{ ref: "git:cycle-focus-checkpoint/" + plan.operation_id, sha256: shadowHash(result) }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== "confirmed" && (result?.effect_status === "no_effect" || cause.effect_status === "no_effect");
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown",
            { reason_code: cause.code ?? "STANDARD_FOCUS_CHECKPOINT_UNCONFIRMED" });
        }
      });
    },
  });
}
