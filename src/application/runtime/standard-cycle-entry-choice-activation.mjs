import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowCycleActivation } from "../../adapters/runtime/local-workflow-cycle-activation.mjs";
import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { readStandardCycleEntryChoiceBranchHeads } from "./standard-cycle-entry-choice-context.mjs";
import { assertCycleChoiceActivationInput, assertCycleChoiceActivationPlan, assertCycleChoiceActivationOutput,
  cycleChoiceActivationSource, cycleEntryChoiceActivationOperation } from "../../core/workflow/standard-cycle-entry-choice-activation.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const stableScope = ({ branch, head, ...scope }) => scope;
const fields = row => analyzeStructuredArtifact(row.content).key_values;
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertCycleChoiceActivationOutput({
  contract_version: "standard-cycle-entry-choice-activation-output.v1", operation_ref: cycleEntryChoiceActivationOperation,
  outcome, effect_status, observations, facts, evidence_refs });

// The protected host supplies accepted CP/record/H material. Activation changes
// physical Git/product state only. Canonical focus, history adoption and phase
// admission still require their own accepted operations.
export function createStandardCycleEntryChoiceActivation({ targetRoot, scope, readCheckpoint, readCurrent, now = Date.now }) {
  if (![scope, readCheckpoint, readCurrent].every(fn => typeof fn === "function")) fail("STANDARD_CHOICE_ACTIVATION_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const current = instance => {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CHOICE_ACTIVATION_PROCESS_CHANGED");
  };
  const port = () => createLocalWorkflowCycleActivation({ targetRoot: artifacts.root });
  async function accepted(instance, input) {
    const source = await readCheckpoint(instance, input), descriptor = cycleChoiceActivationSource(source, input);
    current(instance); return { source, descriptor };
  }
  function inventory(observed, source) {
    const changed = new Set(source.record.plan.changes.map(row => row.path).filter(name => /^cycles\/C\d+[^/]*\/status[.]md$/.test(name)));
    return observed.cycles.filter(({ row }) => !changed.has(row.path)).map(({ row, cycle_id }) =>
      ({ cycle_id, path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 }));
  }
  function material(instance, plan, source, owner = null) {
    current(instance); if (owner) artifacts.assertLocalEffectOwner(owner);
    const actual = scope(), descriptor = cycleChoiceActivationSource(source, plan.input);
    if (descriptor.source_sha256 !== plan.source_sha256 || source.record.record_operation_id !== plan.record_operation_id
      || shadowHash(descriptor.documents) !== shadowHash(plan.documents)
      || shadowHash(stableScope(actual)) !== plan.scope_without_git_sha256
      || shadowHash(artifacts.describe()) !== plan.backend_binding_sha256
      || !(actual.branch === plan.source_branch && actual.head === plan.source_head
        || actual.branch === plan.selected_branch && actual.head === plan.selected_branch_head))
      fail("STANDARD_CHOICE_ACTIVATION_SCOPE_CHANGED");
    const rows = artifacts.readMany(plan.documents.map(row => row.path), { required: plan.documents.map(row => row.path), includeMetadata: true });
    if (rows.some(row => !plan.documents.some(doc => doc.path === row.path && doc.sha256 === row.sha256 && doc.metadata_sha256 === row.metadata_sha256)))
      fail("STANDARD_CHOICE_ACTIVATION_CANONICAL_CHANGED");
    const observed = observeStandardCycleEntryContext({ artifacts, scope, sessionId: plan.session_id }),
      selected = observed.cycles.find(row => row.cycle_id === plan.selected_cycle_id), state = observed.state,
      metadata = observed.metadata;
    if (state.active_session !== plan.session_id || state.active_cycle !== "none" || state.mode !== "COMMITTING"
      || fields(observed.session).state !== "OPEN" || metadata.mode !== "COMMITTING"
      || !metadata.attached_cycles.includes(plan.selected_cycle_id) || !metadata.integration_target_cycles.includes(plan.selected_cycle_id)
      || !selected || selected.row.path !== plan.selected_cycle_path + "/status.md" || selected.fields.state !== plan.selected_state
      || selected.fields.branch_name !== plan.selected_branch || selected.fields.session_owner !== plan.session_id
      || shadowHash(inventory(observed, source)) !== plan.unchanged_cycle_inventory_sha256)
      fail("STANDARD_CHOICE_ACTIVATION_CONTEXT_CHANGED");
    const subject = source.record.plan.question.subject,
      heads = readStandardCycleEntryChoiceBranchHeads(artifacts.root, subject.candidate_cycles.map(row => ({ fields: { branch_name: row.branch_name } })));
    if (subject.candidate_cycles.some(row => (heads.get(row.branch_name) ?? null)
      !== (row.branch_name === plan.source_branch ? plan.source_head : row.branch_head)))
      fail("STANDARD_CHOICE_ACTIVATION_BRANCH_CHANGED");
    current(instance);
  }
  async function prepare(instance, input, operationId, at, owner = null) {
    assertCycleChoiceActivationInput(input);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_CHOICE_ACTIVATION_INPUT_INVALID");
    current(instance);
    if (!owner && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const before = await accepted(instance, input), admission = await preWriteAdmit({ targetRoot: artifacts.root, skill: "start-session" });
    if (!admission.ok) return { can_apply: false, reason_code: "STANDARD_CHOICE_ACTIVATION_ADMISSION_BLOCKED" };
    const after = await accepted(instance, input);
    if (shadowHash(after.source) !== shadowHash(before.source)) fail("STANDARD_CHOICE_ACTIVATION_SOURCE_CHANGED");
    const { source, descriptor } = after, actual = scope(), git = port(),
      observed = git.inspect({ source_branch: descriptor.source_branch, target_branch: descriptor.selected_branch }), view = observed.base;
    if (actual.branch !== descriptor.source_branch || actual.head !== descriptor.source_head
      || view.current_ref !== view.source_ref || view.head !== descriptor.source_head || view.source_head !== descriptor.source_head
      || view.target_head !== descriptor.selected_branch_head || !view.clean || view.lock_present || view.source_lock_present
      || view.source_symbolic || view.target_symbolic || view.target_checked_out_elsewhere)
      return { can_apply: false, reason_code: "STANDARD_CHOICE_ACTIVATION_GIT_CHANGED" };
    const plan = assertCycleChoiceActivationPlan({ contract_version: "standard-cycle-entry-choice-activation-plan.v1",
      operation_ref: cycleEntryChoiceActivationOperation, operation_id: operationId, input, prepared_at_ms: at,
      source_sha256: descriptor.source_sha256, record_operation_id: source.record.record_operation_id,
      scope_sha256: shadowHash(actual), scope_without_git_sha256: shadowHash(stableScope(actual)),
      backend_binding_sha256: shadowHash(artifacts.describe()), session_id: descriptor.session_id,
      selected_cycle_id: descriptor.selected_cycle_id, selected_cycle_path: descriptor.selected_cycle_path, selected_state: descriptor.selected_state,
      source_branch: descriptor.source_branch, source_head: descriptor.source_head, selected_branch: descriptor.selected_branch,
      selected_branch_head: descriptor.selected_branch_head, documents: descriptor.documents,
      unchanged_cycle_inventory_sha256: source.record.plan.unchanged_cycle_inventory_sha256,
      git: { operation_kind: "local-cycle-product-activation.v1", observed } });
    material(instance, plan, source, owner);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = assertCycleChoiceActivationPlan(prepared?.plan);
      if (write !== true || !prepared?.can_apply || typeof assertAuthorized !== "function"
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        throw Object.assign(Error("STANDARD_CHOICE_ACTIVATION_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_CHOICE_ACTIVATION_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const git = port(), raw = { operation_id: plan.operation_id, plan_sha256: expectPlan, observed: plan.git.observed };
        const permission = async () => {
          await assertAuthorized(); const { source } = await accepted(instance, plan.input);
          // H/checkpoint authentication may await an independent source. The
          // exact mutation grant must still be current after that await.
          await assertAuthorized(); material(instance, plan, source, expectPlan);
        };
        try {
          await permission(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, expectPlan);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_CHOICE_ACTIVATION_PREVIEW_CHANGED");
          await permission();
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let result = null;
        try {
          result = await git.activate(raw, { write: true, assertAuthorized: permission });
          await permission(); const physical = git.inspectActivation(raw);
          if (physical.status !== result.status || physical.head !== plan.selected_branch_head)
            fail("STANDARD_CHOICE_ACTIVATION_POSTCONDITION_UNCONFIRMED");
          return emit("completed", result.effect_status, { checkpoint_operation_id: plan.input.checkpoint_operation_id,
            record_operation_id: plan.record_operation_id, source_sha256: plan.source_sha256, session_id: plan.session_id,
            selected_cycle_id: plan.selected_cycle_id, selected_cycle_path: plan.selected_cycle_path, selected_state: plan.selected_state,
            selected_branch: plan.selected_branch, selected_branch_head: plan.selected_branch_head,
            branch_activated: true, canonical_preserved: true, canonical_adoption: false, implementation_authorized: false, git: result },
          { cycle_entry_choice_activation_ready: true, cycle_entry_resume_allowed: false },
          [{ ref: "git:cycle-choice-activation/" + plan.operation_id, sha256: shadowHash(result) }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== "confirmed" && cause.effect_status === "no_effect";
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown",
            { reason_code: cause.code ?? "STANDARD_CHOICE_ACTIVATION_UNCONFIRMED" });
        }
      });
    },
  });
}
