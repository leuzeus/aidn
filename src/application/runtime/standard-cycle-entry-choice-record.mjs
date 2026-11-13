import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { readStandardCycleEntryChoiceBranchHeads } from "./standard-cycle-entry-choice-context.mjs";
import { renderStandardCycleEntryChoiceRecord, assertStandardCycleEntryChoiceRecordPlan,
  assertStandardCycleEntryChoiceRecordOutput, cycleEntryChoiceRecordOperation } from "../../core/workflow/standard-cycle-entry-choice-record.mjs";
import { assertCycleEntryChoiceQuestion, assertHumanCycleEntryChoice } from "../../core/workflow/standard-cycle-entry-choice.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-cycle-entry-choice-record-input.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
const pins = rows => rows.map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
const contents = row => row.text_chunks.join("");
const changedCyclePaths = changes => new Set(changes.map(row => row.path).filter(name => /^cycles\/C\d+[^/]*\/status\.md$/.test(name)));
const cycleInventory = (observed, excluded) => observed.cycles.filter(({ row }) => !excluded.has(row.path))
  .map(({ row, cycle_id }) => ({ cycle_id, ...pins([row])[0] }));

// The host supplies an accepted same-instance H record and verifies its source.
// freshSubject=false is used only under our exact live owner or after our own
// confirmed postimages; it never comes from operation JSON. It authenticates
// the retained opinion without pretending its old preimages are still current.
export function createStandardCycleEntryChoiceRecord({ targetRoot, scope, readDecision, readCurrent, now = Date.now }) {
  if (![scope, readDecision, readCurrent].every(value => typeof value === "function")) fail("STANDARD_CYCLE_CHOICE_RECORD_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const current = instance => {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CYCLE_CHOICE_RECORD_PROCESS_CHANGED");
  };
  function assertInput(input) {
    if (checkShadowJson(input) || validateJsonSchema(input, inputSchema, "$", { contractKind: "workflow-definition" }).length)
      fail("STANDARD_CYCLE_CHOICE_RECORD_INPUT_INVALID");
  }
  function assertDecision(input, source) {
    assertCycleEntryChoiceQuestion(source.question); assertHumanCycleEntryChoice(source.decision, source.question);
    if (source.question.operation_id !== input.decision_operation_id || source.decision.choice !== "select_cycle")
      fail("STANDARD_CYCLE_CHOICE_RECORD_DECISION_REQUIRED");
  }
  function assertBranches(subject) {
    const heads = readStandardCycleEntryChoiceBranchHeads(artifacts.root,
      subject.candidate_cycles.map(row => ({ fields: { branch_name: row.branch_name } })));
    if (subject.candidate_cycles.some(row => (heads.get(row.branch_name) ?? null) !== row.branch_head))
      fail("STANDARD_CYCLE_CHOICE_RECORD_BRANCH_CHANGED");
  }
  function projectionFiles(changes) {
    if (artifacts.describe().database && artifacts.describe().state_mode === "db-only") return [];
    return changes.map(row => agentRunPhysicalPath(path.join(artifacts.root, "docs/audit", row.path)));
  }
  function capture(subject) {
    const observed = observeStandardCycleEntryContext({ artifacts, scope, sessionId: subject.session_id });
    if (shadowHash(observed.scope) !== subject.scope_sha256 || observed.inventory_sha256 !== subject.inventory_sha256
      || shadowHash(observed.canonical) !== shadowHash(subject.canonical)) fail("STANDARD_CYCLE_CHOICE_RECORD_SUBJECT_CHANGED");
    assertBranches(subject);
    return { observed };
  }
  async function prepare(instance, input, operationId, at, owned = false) {
    assertInput(input); current(instance);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_CYCLE_CHOICE_RECORD_OPERATION_ID_INVALID");
    if (!owned && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const admission = await preWriteAdmit({ targetRoot: artifacts.root, skill: "start-session" });
    if (!admission.ok) return { can_apply: false, reason_code: "STANDARD_CYCLE_CHOICE_RECORD_ADMISSION_BLOCKED" };
    const source = await readDecision(instance, input, { freshSubject: !owned });
    current(instance); assertDecision(input, source);
    const subject = source.question.subject, { observed } = capture(subject);
    const selected = subject.candidate_cycles.find(row => row.cycle_id === source.decision.selection.cycle_id);
    const selectedPath = selected.path.slice(0, -"/status.md".length);
    const names = new Set(["CURRENT-STATE.md", subject.session_path, "snapshots/context-snapshot.md",
      ...["status", "brief", "plan", "audit-spec", "traceability"].map(name => `${selectedPath}/${name}.md`)]);
    for (const id of subject.reported_cycles) names.add(subject.candidate_cycles.find(row => row.cycle_id === id).path);
    const sessions = artifacts.sessions();
    const actedUpon = new Set(source.decision.selection.carryover_decisions.filter(row => row.action !== "defer").map(row => row.cycle_id));
    const foreign = subject.reported_cycles.map(id => subject.candidate_cycles.find(row => row.cycle_id === id))
      .filter(row => actedUpon.has(row.cycle_id) && row.session_owner !== subject.session_id);
    for (const candidate of foreign) {
      const owner = sessions.filter(row => row.session_id === candidate.session_owner);
      if (owner.length !== 1) fail("STANDARD_CYCLE_CHOICE_RECORD_OWNER_REQUIRED");
      names.add(owner[0].path);
    }
    const orderedNames = [...names].sort(), documents = artifacts.readMany(orderedNames, { required: orderedNames, includeMetadata: true });
    for (const candidate of foreign) {
      const owner = sessions.find(row => row.session_id === candidate.session_owner);
      const row = documents.find(row => row.path === owner.path), metadata = parseSessionMetadata(row.content);
      if (analyzeStructuredArtifact(row.content).key_values.state !== "CLOSED" || metadata.close_gate_satisfied !== true)
        return { can_apply: false, reason_code: "STANDARD_CYCLE_CHOICE_RECORD_FOREIGN_OWNER_OPEN" };
    }
    const rendered = renderStandardCycleEntryChoiceRecord({ question: source.question, decision: source.decision,
      operationId, documents, preparedAt: at });
    const plan = assertStandardCycleEntryChoiceRecordPlan({ contract_version: "standard-cycle-entry-choice-record-plan.v1",
      operation_ref: cycleEntryChoiceRecordOperation, operation_id: operationId, input, prepared_at_ms: at,
      scope_sha256: subject.scope_sha256, backend_binding_sha256: shadowHash(artifacts.describe()),
      unchanged_cycle_inventory_sha256: shadowHash(cycleInventory(observed, changedCyclePaths(rendered.changes))),
      question: source.question, decision: source.decision, decision_source_sha256: shadowHash(source.decision), ...rendered });
    // No await separates the final scope/canonical/branch observations from the
    // returned preparation. Later ownership/authorization boundaries reobserve.
    assertMaterial(instance, plan, new Map(), owned ? shadowHash(plan) : null);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function assertMaterial(instance, plan, written, owner = null) {
    current(instance);
    if (owner) artifacts.assertLocalEffectOwner(owner);
    if (shadowHash(artifacts.describe()) !== plan.backend_binding_sha256 || shadowHash(scope()) !== plan.scope_sha256)
      fail("STANDARD_CYCLE_CHOICE_RECORD_SCOPE_CHANGED");
    assertBranches(plan.question.subject);
    const names = plan.documents.map(row => row.path), rows = artifacts.readMany(names, { required: names, includeMetadata: true });
    for (const expected of plan.documents) {
      const row = rows.find(row => row.path === expected.path), committed = written.get(expected.path);
      const after = plan.changes.find(row => row.path === expected.path);
      if (row.sha256 !== (committed ? after.after_sha256 : expected.sha256)
        || row.metadata_sha256 !== (committed ? committed.metadata_sha256 : expected.metadata_sha256))
        fail("STANDARD_CYCLE_CHOICE_RECORD_DOCUMENT_CHANGED");
    }
    const observed = observeStandardCycleEntryContext({ artifacts, scope, sessionId: plan.question.subject.session_id });
    if (shadowHash(cycleInventory(observed, changedCyclePaths(plan.changes))) !== plan.unchanged_cycle_inventory_sha256)
      fail("STANDARD_CYCLE_CHOICE_RECORD_INVENTORY_CHANGED");
    current(instance);
  }
  const consentHash = source => shadowHash({ question: source.question, decision: source.decision });
  function output(outcome, effect_status, observations, facts = {}) {
    return assertStandardCycleEntryChoiceRecordOutput({ contract_version: "standard-cycle-entry-choice-record-output.v1",
      operation_ref: cycleEntryChoiceRecordOperation, outcome, effect_status, observations, facts, evidence_refs: [] });
  }
  return Object.freeze({
    prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = assertStandardCycleEntryChoiceRecordPlan(prepared?.plan);
      if (write !== true || !prepared?.can_apply || typeof assertAuthorized !== "function" || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan)
        throw Object.assign(Error("STANDARD_CYCLE_CHOICE_RECORD_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_CYCLE_CHOICE_RECORD_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const written = new Map(); let attempted = false;
        const permission = async () => {
          await assertAuthorized();
          const source = await readDecision(instance, plan.input, { freshSubject: false });
          assertDecision(plan.input, source);
          if (consentHash(source) !== consentHash(plan)) fail("STANDARD_CYCLE_CHOICE_RECORD_DECISION_CHANGED");
          // Source verification can await an independent port. Recheck the
          // exact mutation grant after that await, before any canonical CAS.
          await assertAuthorized();
          assertMaterial(instance, plan, written, expectPlan);
        };
        try {
          await permission();
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_CYCLE_CHOICE_RECORD_PREVIEW_CHANGED");
          projectionFiles(plan.changes);
          for (const change of plan.changes) {
            await permission();
            attempted = true;
            const committed = artifacts.compareAndSwapPreservingMetadata({ ...change, after: contents(change) });
            written.set(change.path, { metadata_sha256: committed.metadata_sha256 });
            assertMaterial(instance, plan, written, expectPlan);
          }
          artifacts.project(plan.changes.map(row => row.path));
          for (const file of projectionFiles(plan.changes)) {
            const change = plan.changes.find(row => path.resolve(artifacts.root, "docs/audit", row.path) === file);
            if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== change.after_sha256)
              fail("STANDARD_CYCLE_CHOICE_RECORD_PROJECTION_UNCONFIRMED");
          }
          await permission();
          return output("completed", "confirmed", { decision_operation_id: plan.input.decision_operation_id,
            decision_source_sha256: plan.decision_source_sha256, selected_cycle_id: plan.selected_cycle_id,
            selected_cycle_path: plan.selected_cycle_path, selected_state: plan.selected_state, selected_branch: plan.selected_branch,
            selected_branch_head: plan.selected_branch_head, selected_status_sha256: plan.selected_status_sha256,
            deferred_cycles: plan.deferred_cycles, carry_over_pending: plan.carry_over_pending,
            branch_activated: false, implementation_authorized: false,
            committed: plan.changes.map(row => ({ path: row.path, sha256: row.after_sha256, metadata_sha256: written.get(row.path).metadata_sha256 })) },
          { cycle_entry_choice_recorded: true, cycle_entry_resume_allowed: false });
        } catch (cause) {
          if (!attempted) { cause.effect_status = "no_effect"; throw cause; }
          return output("reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_CYCLE_CHOICE_RECORD_UNCONFIRMED" });
        }
      });
    },
  });
}
