import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { readStandardCycleEntryChoiceBranchHeads } from "./standard-cycle-entry-choice-context.mjs";
import { cycleChoiceCheckpointDocuments, assertCycleChoiceCheckpointPlan, assertCycleChoiceCheckpointOutput,
  cycleEntryChoiceCheckpointOperation } from "../../core/workflow/standard-cycle-entry-choice-checkpoint.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { readAgentRunFile, agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-cycle-entry-choice-checkpoint-input.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
const stableScope = ({ head, ...scope }) => scope;
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertCycleChoiceCheckpointOutput({
  contract_version: "standard-cycle-entry-choice-checkpoint-output.v1", operation_ref: cycleEntryChoiceCheckpointOperation,
  outcome, effect_status, observations, facts, evidence_refs });

// An accepted record supplies exact canonical postimages. This operation only
// checkpoints its changed Markdown on the current branch; activation and phase
// admission remain separate. DB-only never exports canonical rows for Git.
export function createStandardCycleEntryChoiceCheckpoint({ targetRoot, scope, readRecorded, readCurrent, now = Date.now }) {
  if (![scope, readRecorded, readCurrent].every(fn => typeof fn === "function")) fail("STANDARD_CHOICE_CHECKPOINT_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const current = instance => {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CHOICE_CHECKPOINT_PROCESS_CHANGED");
  };
  const port = files => createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root },
    { profile: "cycle-choice", approvedPaths: files.map(row => row.path) });
  async function recorded(instance, input) {
    const source = await readRecorded(instance, input);
    if (source.record_operation_id !== input.record_operation_id || !/^[a-f0-9]{64}$/.test(source.record_sha256 ?? ""))
      fail("STANDARD_CHOICE_CHECKPOINT_RECORDED_SOURCE_REQUIRED");
    const documents = cycleChoiceCheckpointDocuments(source.plan, source.output);
    current(instance); return { source, documents };
  }
  function assertMaterial(instance, plan, source, expectedHead, owner = null) {
    current(instance); if (owner) artifacts.assertLocalEffectOwner(owner);
    const actualScope = scope(), subject = source.plan.question.subject;
    if (actualScope.branch !== plan.git.observed.branch || actualScope.head !== expectedHead
      || shadowHash(stableScope(actualScope)) !== plan.scope_without_head_sha256
      || shadowHash(artifacts.describe()) !== plan.backend_binding_sha256) fail("STANDARD_CHOICE_CHECKPOINT_SCOPE_CHANGED");
    const rows = artifacts.readMany(plan.documents.map(row => row.path), { required: plan.documents.map(row => row.path), includeMetadata: true });
    if (rows.some(row => !plan.documents.some(doc => row.path === doc.path && row.sha256 === doc.sha256 && row.metadata_sha256 === doc.metadata_sha256)))
      fail("STANDARD_CHOICE_CHECKPOINT_CANONICAL_CHANGED");
    const observed = observeStandardCycleEntryContext({ artifacts, scope, sessionId: plan.session_id }),
      changed = new Set(source.plan.changes.map(row => row.path).filter(name => /^cycles\/C\d+[^/]*\/status[.]md$/.test(name))),
      inventory = observed.cycles.filter(({ row }) => !changed.has(row.path)).map(({ row, cycle_id }) =>
        ({ cycle_id, path: row.path, sha256: row.sha256, metadata_sha256: row.metadata_sha256 }));
    if (shadowHash(inventory) !== source.plan.unchanged_cycle_inventory_sha256) fail("STANDARD_CHOICE_CHECKPOINT_INVENTORY_CHANGED");
    const heads = readStandardCycleEntryChoiceBranchHeads(artifacts.root, subject.candidate_cycles.map(row => ({ fields: { branch_name: row.branch_name } })));
    if (subject.candidate_cycles.some(row => (heads.get(row.branch_name) ?? null)
      !== (row.branch_name === plan.git.observed.branch ? expectedHead : row.branch_head))) fail("STANDARD_CHOICE_CHECKPOINT_BRANCH_CHANGED");
    current(instance);
  }
  async function prepare(instance, input, operationId, at, owned = false) {
    if (checkShadowJson(input) || validateJsonSchema(input, inputSchema, "$", { contractKind: "workflow-definition" }).length
      || !/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_CHOICE_CHECKPOINT_INPUT_INVALID");
    current(instance);
    if (!owned && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const before = await recorded(instance, input), admission = await preWriteAdmit({ targetRoot: artifacts.root, skill: "start-session" });
    if (!admission.ok) return { can_apply: false, reason_code: "STANDARD_CHOICE_CHECKPOINT_ADMISSION_BLOCKED" };
    const { source, documents } = await recorded(instance, input);
    if (shadowHash(source) !== shadowHash(before.source)) fail("STANDARD_CHOICE_CHECKPOINT_RECORDED_SOURCE_CHANGED");
    const actualScope = scope(), selected = source.plan, subject = selected.question.subject,
      approved = source.output.observations.committed.map(row => ({ path: "docs/audit/" + row.path, sha256: row.sha256 })),
      git = port(approved), view = git.inspect();
    if (shadowHash(actualScope) !== selected.scope_sha256 || view.branch !== subject.current_branch || view.head !== subject.head
      || !view.index_clean || view.lock_present) return { can_apply: false, reason_code: "STANDARD_CHOICE_CHECKPOINT_GIT_CHANGED" };
    const state = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values,
      session = artifacts.read(subject.session_path, { required: true });
    if (state.active_session !== subject.session_id || state.active_cycle !== "none" || state.mode !== "COMMITTING"
      || analyzeStructuredArtifact(session.content).key_values.state !== "OPEN" || parseSessionMetadata(session.content).mode !== "COMMITTING")
      return { can_apply: false, reason_code: "STANDARD_CHOICE_CHECKPOINT_CONTEXT_CHANGED" };
    if (view.changes.some(row => !approved.some(file => file.path === row.path)))
      return { can_apply: false, reason_code: "STANDARD_CHOICE_CHECKPOINT_FOREIGN_CHANGES" };
    const files = view.changes.map(row => {
      const expected = approved.find(file => file.path === row.path), physical = agentRunPhysicalPath(path.join(artifacts.root, row.path));
      if (readAgentRunFile(physical, { json: false, maxBytes: 1048576 }).sha256 !== expected.sha256) fail("STANDARD_CHOICE_CHECKPOINT_PROJECTION_CHANGED");
      return { ...expected };
    });
    const plan = assertCycleChoiceCheckpointPlan({ contract_version: "standard-cycle-entry-choice-checkpoint-plan.v1",
      operation_ref: cycleEntryChoiceCheckpointOperation, operation_id: operationId, input, prepared_at_ms: at,
      source_sha256: shadowHash(source), scope_sha256: shadowHash(actualScope), scope_without_head_sha256: shadowHash(stableScope(actualScope)),
      backend_binding_sha256: shadowHash(artifacts.describe()), session_id: subject.session_id,
      selected_cycle_id: selected.selected_cycle_id, selected_state: selected.selected_state, selected_branch: selected.selected_branch,
      selected_branch_head: selected.selected_branch_head, documents,
      git: { operation_kind: "metadata-objects-ref-index.v1", observed: view, files } });
    assertMaterial(instance, plan, source, view.head, owned ? shadowHash(plan) : null);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = assertCycleChoiceCheckpointPlan(prepared?.plan);
      if (write !== true || !prepared?.can_apply || typeof assertAuthorized !== "function"
        || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        throw Object.assign(Error("STANDARD_CHOICE_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_CHOICE_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const git = port(plan.git.files), gitPlan = { ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan };
        const permission = async () => {
          await assertAuthorized(); const { source, documents } = await recorded(instance, plan.input);
          await assertAuthorized();
          if (shadowHash(source) !== plan.source_sha256 || shadowHash(documents) !== shadowHash(plan.documents))
            fail("STANDARD_CHOICE_CHECKPOINT_RECORDED_SOURCE_CHANGED");
          let expectedHead = plan.git.observed.head;
          if (scope().head !== expectedHead) {
            const proof = git.inspectCommit(gitPlan);
            if (proof.status !== "confirmed") fail("STANDARD_CHOICE_CHECKPOINT_OWN_COMMIT_REQUIRED");
            expectedHead = proof.commit_sha;
          }
          assertMaterial(instance, plan, source, expectedHead, expectPlan);
        };
        try {
          await permission(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_CHOICE_CHECKPOINT_PREVIEW_CHANGED");
          await permission();
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let result = null;
        try {
          result = await git.commit(gitPlan, { assertAuthorized: permission });
          await permission();
          const head = result.commit_sha ?? result.head;
          return emit("completed", result.effect_status, { record_operation_id: plan.input.record_operation_id,
            source_sha256: plan.source_sha256, session_id: plan.session_id, selected_cycle_id: plan.selected_cycle_id,
            selected_state: plan.selected_state, selected_branch: plan.selected_branch,
            selected_branch_head: plan.selected_branch === plan.git.observed.branch ? head : plan.selected_branch_head,
            committed_paths: plan.git.files.map(row => row.path), git: result, branch_activated: false, implementation_authorized: false },
          { cycle_entry_choice_checkpoint_ready: true, cycle_entry_choice_checkpoint_created: result.status === "confirmed", cycle_entry_resume_allowed: false },
          [{ ref: "git:cycle-choice-checkpoint/" + plan.operation_id, sha256: shadowHash(result) }]);
        } catch (cause) {
          const noEffect = result?.effect_status !== "confirmed" && cause.effect_status === "no_effect";
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown",
            { reason_code: cause.code ?? "STANDARD_CHOICE_CHECKPOINT_UNCONFIRMED" });
        }
      });
    },
  });
}
