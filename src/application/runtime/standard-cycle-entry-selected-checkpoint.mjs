import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { createStandardCycleEntrySelectedContext } from "./standard-cycle-entry-selected-context.mjs";
import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { assertCycleEntrySelectedInput, cycleEntrySelectedSource } from "../../core/workflow/standard-cycle-entry-selected-source.mjs";
import { assertSelectedContextCheckpointPlan, assertSelectedContextCheckpointOutput,
  cycleEntrySelectedCheckpointOperation } from "../../core/workflow/standard-cycle-entry-selected-checkpoint.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const stableScope = ({ head, ...scope }) => scope;
const fields = row => analyzeStructuredArtifact(row.content).key_values;
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertSelectedContextCheckpointOutput({
  contract_version: "standard-cycle-entry-selected-checkpoint-output.v1", operation_ref: cycleEntrySelectedCheckpointOperation,
  outcome, effect_status, observations, facts, evidence_refs });

// Checkpoint exactly the canonical overlay preserved by an accepted activation.
// This records physical context without adopting focus, work, DoR or a phase.
export function createStandardCycleEntrySelectedCheckpoint({ targetRoot, scope, readActivation, readCurrent, now = Date.now }) {
  if (![scope, readActivation, readCurrent].every(fn => typeof fn === "function")) fail("STANDARD_SELECTED_CHECKPOINT_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }),
    observeSelected = createStandardCycleEntrySelectedContext({ artifacts, scope, readActivation, readCurrent }),
    port = paths => createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root }, { profile: "cycle-context", approvedPaths: paths });
  const current = instance => {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_SELECTED_CHECKPOINT_PROCESS_CHANGED");
  };
  function fingerprint(name) {
    const absolute = agentRunPhysicalPath(path.join(artifacts.root, name), { missing: true });
    if (!fs.existsSync(absolute)) return null;
    const before = fs.lstatSync(absolute); if (!before.isFile() || before.nlink !== 1) fail("STANDARD_SELECTED_CHECKPOINT_REGULAR_FILE_REQUIRED");
    const descriptor = fs.openSync(absolute, "r"), digest = createHash("sha256"), buffer = Buffer.alloc(65536);
    try { for (let count; (count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0;) digest.update(buffer.subarray(0, count)); }
    finally { fs.closeSync(descriptor); }
    const after = fs.lstatSync(absolute);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      fail("STANDARD_SELECTED_CHECKPOINT_FILE_CHANGED");
    return { sha256: digest.digest("hex"), bytes: after.size, mode: after.mode & 0o777 };
  }
  async function accepted(instance, input) {
    const source = await readActivation(instance, input), descriptor = cycleEntrySelectedSource(source, input);
    current(instance); return { source, descriptor };
  }
  function material(instance, plan, source, expectedHead, owner = null) {
    current(instance); if (owner !== null) artifacts.assertLocalEffectOwner(owner);
    const actual = scope(), descriptor = cycleEntrySelectedSource(source, plan.input), context = plan.context, selected = context.selected_cycle;
    if (shadowHash(source) !== plan.source_sha256 || descriptor.source_sha256 !== context.source_sha256
      || shadowHash(descriptor.documents) !== shadowHash(context.canonical)
      || shadowHash(source.plan.git.observed.canonical) !== shadowHash(plan.physical_canonical)
      || shadowHash(source.plan.git.observed.canonical_overlay_paths) !== shadowHash(plan.overlay_paths)
      || actual.branch !== selected.branch || actual.head !== expectedHead
      || shadowHash(stableScope(actual)) !== plan.scope_without_head_sha256
      || shadowHash(artifacts.describe()) !== context.backend_binding_sha256)
      fail("STANDARD_SELECTED_CHECKPOINT_SOURCE_CHANGED");
    const names = context.canonical.map(row => row.path), rows = artifacts.readMany(names, { required: names, includeMetadata: true })
      .map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
    if (shadowHash(rows) !== shadowHash(context.canonical)) fail("STANDARD_SELECTED_CHECKPOINT_CANONICAL_CHANGED");
    const observed = observeStandardCycleEntryContext({ artifacts, scope, sessionId: context.session_id }),
      cycle = observed.cycles.find(row => row.cycle_id === selected.cycle_id);
    if (observed.inventory_sha256 !== context.inventory_sha256 || observed.state.active_session !== context.session_id
      || observed.state.active_cycle !== "none" || observed.state.mode !== "COMMITTING" || fields(observed.session).state !== "OPEN"
      || !cycle || cycle.fields.state !== selected.state || cycle.fields.branch_name !== selected.branch
      || cycle.fields.session_owner !== context.session_id || cycle.row.path !== selected.cycle_path + "/status.md")
      fail("STANDARD_SELECTED_CHECKPOINT_CONTEXT_CHANGED");
    for (const row of plan.physical_canonical) if (shadowHash(fingerprint(row.path)) !== shadowHash(row.content))
      fail("STANDARD_SELECTED_CHECKPOINT_PHYSICAL_CANONICAL_CHANGED");
    current(instance);
  }
  async function prepare(instance, input, operationId, at, owner = null) {
    assertCycleEntrySelectedInput(input); current(instance);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_SELECTED_CHECKPOINT_INPUT_INVALID");
    if (owner === null && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const observed = await observeSelected(instance, input, { owner }), admission = await preWriteAdmit({ targetRoot: artifacts.root, skill: "start-session" });
    if (!admission.ok) return { can_apply: false, reason_code: "STANDARD_SELECTED_CHECKPOINT_ADMISSION_BLOCKED" };
    const { source, descriptor } = await accepted(instance, input), context = observed.context;
    if (descriptor.source_sha256 !== context.source_sha256) fail("STANDARD_SELECTED_CHECKPOINT_SOURCE_CHANGED");
    const physical = source.plan.git.observed.canonical, overlay = source.plan.git.observed.canonical_overlay_paths,
      git = port(overlay), view = git.inspect(), actual = scope(), expected = new Map(physical.map(row => [row.path, row.content]));
    if (actual.branch !== descriptor.branch || actual.head !== descriptor.head || view.branch !== descriptor.branch
      || view.head !== descriptor.head || !view.index_clean || view.lock_present
      || shadowHash(actual) !== context.scope_sha256) return { can_apply: false, reason_code: "STANDARD_SELECTED_CHECKPOINT_GIT_CHANGED" };
    if (view.changes.some(row => !overlay.includes(row.path)))
      return { can_apply: false, reason_code: "STANDARD_SELECTED_CHECKPOINT_FOREIGN_CHANGES" };
    const files = view.changes.map(row => {
      if (!expected.has(row.path)) fail("STANDARD_SELECTED_CHECKPOINT_PHYSICAL_SOURCE_REQUIRED");
      const content = expected.get(row.path);
      if (content && content.bytes > 1048576) fail("STANDARD_SELECTED_CHECKPOINT_FILE_LIMIT");
      return { path: row.path, sha256: content?.sha256 ?? null };
    });
    const plan = assertSelectedContextCheckpointPlan({ contract_version: "standard-cycle-entry-selected-checkpoint-plan.v1",
      operation_ref: cycleEntrySelectedCheckpointOperation, operation_id: operationId, input, prepared_at_ms: at,
      source_sha256: shadowHash(source), context, context_sha256: observed.context_sha256,
      scope_without_head_sha256: shadowHash(stableScope(actual)), physical_canonical: physical, overlay_paths: overlay,
      git: { operation_kind: "metadata-objects-ref-index.v1", observed: view, files } });
    material(instance, plan, source, view.head, owner);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = assertSelectedContextCheckpointPlan(prepared?.plan);
      if (write !== true || !prepared?.can_apply || typeof assertAuthorized !== "function"
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        throw Object.assign(Error("STANDARD_SELECTED_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_SELECTED_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const git = port(plan.overlay_paths), raw = { ...plan.git, operation_id: plan.operation_id,
          prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan };
        let gitStarted = false, result = null;
        const permission = async () => {
          await assertAuthorized(); const { source } = await accepted(instance, plan.input);
          await assertAuthorized(); let expectedHead = plan.git.observed.head;
          if (scope().head !== expectedHead) {
            if (!gitStarted) fail("STANDARD_SELECTED_CHECKPOINT_OWN_COMMIT_REQUIRED");
            const own = git.inspectCommit(raw);
            // During this live attempt the ref may be installed before its
            // index. Authenticate our exact causal postimage, not a foreign HEAD.
            if (!["confirmed", "commit_observed"].includes(own.status)) fail("STANDARD_SELECTED_CHECKPOINT_OWN_COMMIT_REQUIRED");
            expectedHead = own.commit_sha;
          }
          material(instance, plan, source, expectedHead, expectPlan);
        };
        try {
          await permission(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, expectPlan);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_SELECTED_CHECKPOINT_PREVIEW_CHANGED");
          await permission();
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        try {
          gitStarted = true; result = await git.commit(raw, { assertAuthorized: permission }); await permission();
          const physical = plan.git.files.length ? git.inspectCommit(raw) : git.inspect();
          if (plan.git.files.length ? physical.status !== "confirmed"
            : physical.branch !== plan.context.selected_cycle.branch || physical.head !== plan.git.observed.head
              || !physical.index_clean || physical.lock_present || physical.changes.length)
            fail("STANDARD_SELECTED_CHECKPOINT_POSTCONDITION_UNCONFIRMED");
          return emit("completed", result.effect_status, { activation_operation_id: plan.input.activation_operation_id,
            source_sha256: plan.source_sha256, context_sha256: plan.context_sha256, session_id: plan.context.session_id,
            selected_cycle_id: plan.context.selected_cycle.cycle_id, selected_cycle_path: plan.context.selected_cycle.cycle_path,
            selected_state: plan.context.selected_cycle.state, selected_branch: plan.context.selected_cycle.branch,
            selected_branch_head: result.commit_sha ?? result.head, committed_paths: plan.git.files.map(row => row.path), git: result,
            canonical_preserved: true, canonical_adoption: false, phase_admission: false, implementation_authorized: false },
          { cycle_entry_selected_checkpoint_ready: true, cycle_entry_selected_checkpoint_created: result.status === "confirmed", cycle_entry_resume_allowed: false },
          [{ ref: "git:cycle-selected-context-checkpoint/" + plan.operation_id, sha256: shadowHash(result) }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== "confirmed" && (result?.effect_status === "no_effect" || cause.effect_status === "no_effect");
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown",
            { reason_code: cause.code ?? "STANDARD_SELECTED_CHECKPOINT_UNCONFIRMED" });
        }
      });
    },
  });
}
