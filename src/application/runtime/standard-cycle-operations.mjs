import fs from "node:fs";
import path from "node:path";
import { runCycleCreateAdmitUseCase } from "./cycle-create-admit-use-case.mjs";
import { runBranchCycleAuditAdmitUseCase } from "./branch-cycle-audit-admit-use-case.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { projectRuntimeState } from "../../../tools/runtime/project-runtime-state.mjs";
import { buildRuntimeStateMarkdown } from "./runtime-state-projector-use-case.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput, normalizeStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { assertSpikeSelection } from "../../core/workflow/standard-spike-decision.mjs";
import spikePlanSchema from "../../core/contracts/workflow-definition/standard-cycle-initialize-plan.v3.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-cycle-initialize-plan.v2.schema.json" with { type: "json" };
import contextSchema from "../../core/contracts/workflow-definition/standard-cycle-context-plan.v2.schema.json" with { type: "json" };
import { createStandardCycleCheckpoint } from "./standard-cycle-checkpoint.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const files = ["brief", "plan", "hypotheses", "audit-spec", "traceability", "decisions", "change-requests", "STATUS"];
const emit = (operation_ref, outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-cycle-output.v1", operation_ref, outcome, effect_status, observations, facts, evidence_refs });
export function createStandardCycleOperations({ artifacts, scope, git, replaceField, now }) {
  const root = artifacts.root;
  function session(expected = null) {
    const current = artifacts.read("CURRENT-STATE.md", { required: true }), state = analyzeStructuredArtifact(current.content).key_values;
    if (!/^S[0-9]{3,6}$/.test(state.active_session ?? "") || expected && state.active_session !== expected) fail("STANDARD_CYCLE_SESSION_CHANGED");
    const row = artifacts.sessions().find(row => row.session_id === state.active_session);
    if (!row) fail("STANDARD_CYCLE_SESSION_MISSING");
    const metadata = parseSessionMetadata(row.content);
    if (metadata.session_branch !== state.session_branch || !["COMMITTING", "EXPLORING"].includes(metadata.mode) || metadata.mode !== state.mode) fail("STANDARD_CYCLE_MODE_NOT_ADMITTED");
    return { current, state, row, metadata };
  }
  async function admission() {
    scope(); const observed = session();
    const prewrite = await preWriteAdmit({ targetRoot: root, skill: "cycle-create" });
    const lifecycle = await runCycleCreateAdmitUseCase({ targetRoot: root, mode: observed.metadata.mode });
    return { prewrite, lifecycle, allowed: prewrite.ok === true && ["admitted", "admitted_with_warnings"].includes(prewrite.admission_status)
      && lifecycle.ok === true && ["create_cycle_allowed", "proceed_r1_strict_chain", "proceed_r2_session_base_with_import"].includes(lifecycle.action) };
  }
  function section(text, title, body) {
    const pattern = new RegExp("(^## " + title + "[^\\r\\n]*\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))", "gm");
    if ([...text.matchAll(pattern)].length !== 1) fail("STANDARD_CYCLE_SNAPSHOT_SECTION_INVALID");
    return text.replace(pattern, (_all, heading) => heading + "\n" + body + "\n\n");
  }
  function assertPlan(plan) {
    if (validateJsonSchema(plan, plan.contract_version === "standard-cycle-initialize-plan.v3" ? spikePlanSchema : planSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_CYCLE_PLAN_INVALID");
    assertStandardOperationInput("cycle_initialize", plan.input);
    if (plan.contract_version === "standard-cycle-initialize-plan.v3") {
      assertSpikeSelection(plan.spike_selection);
      if (plan.input.cycle_type !== "spike" || plan.input.cycle_id !== plan.spike_selection.cycle_id || plan.input.title !== plan.spike_selection.title
        || plan.input.objective !== plan.spike_selection.learning_goal || plan.mode !== "EXPLORING") fail("STANDARD_SPIKE_CYCLE_PLAN_INVALID");
    }
    if (plan.branch_name !== `${plan.input.cycle_type}/${plan.input.cycle_id}-${plan.input.title}`
      || plan.cycle_path !== `cycles/${plan.input.cycle_id}-${plan.input.cycle_type}-${plan.input.title}`
      || !new RegExp(`^sessions/${plan.input.session_id}(?:[-_.][A-Za-z0-9._-]+)?\\.md$`).test(plan.session_path)
      || shadowHash(plan.changes.map(row => row.path)) !== shadowHash([...files.map(name => `${plan.cycle_path}/${name === "STATUS" ? "status" : name}.md`), plan.session_path, "snapshots/context-snapshot.md", "CURRENT-STATE.md"])
      || plan.changes.some(row => artifactContentHash(row.after) !== row.after_sha256)) fail("STANDARD_CYCLE_PLAN_INVALID");
  }
  function projectionFiles(changes) {
    const selected = artifacts.describe();
    if (selected.database && selected.state_mode === "db-only") return [];
    return changes.map(row => {
      const file = agentRunPhysicalPath(path.join(root, "docs/audit", row.path), { missing: true });
      if (fs.existsSync(file)) readAgentRunFile(file, { json: false, maxBytes: 1048576 });
      return file;
    });
  }
  async function prepare(input, preparedAt, acquired = false, spike = null) {
    assertStandardOperationInput("cycle_initialize", input);
    input = normalizeStandardOperationInput("cycle_initialize", input);
    if (spike !== null) assertSpikeSelection(spike);
    const context = scope(), observed = session(input.session_id), admitted = await admission();
    if ((!acquired && artifacts.ownerPending()) || !admitted.allowed) return { can_apply: false, admission: admitted };
    if (input.base_branch !== context.branch || admitted.lifecycle.continuity_base_branch !== input.base_branch
      || admitted.lifecycle.continuity_rule !== input.continuity_rule || admitted.lifecycle.active_session !== input.session_id) return { can_apply: false, reason_code: "STANDARD_CYCLE_CONTINUITY_CHANGED", admission: admitted };
    const inventory = artifacts.cycles();
    if (inventory.some(row => BigInt(row.cycle_id.slice(1)) >= BigInt(input.cycle_id.slice(1)))) fail("STANDARD_CYCLE_SEQUENCE_INVALID");
    const cyclePath = `cycles/${input.cycle_id}-${input.cycle_type}-${input.title}`, branch = `${input.cycle_type}/${input.cycle_id}-${input.title}`;
    if (fs.existsSync(agentRunPhysicalPath(path.join(root, "docs/audit", cyclePath), { missing: true }))) fail("STANDARD_CYCLE_DESTINATION_EXISTS");
    try { git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]); fail("STANDARD_CYCLE_BRANCH_EXISTS"); }
    catch (cause) { if (cause.code === "STANDARD_CYCLE_BRANCH_EXISTS" || cause.status !== 1) throw cause; }
    const at = new Date(preparedAt).toISOString(), templates = files.map(name => artifacts.read(`cycles/TEMPLATE_${name}.md`, { required: true }));
    const changes = templates.map((template, index) => {
      const name = files[index], relative = cyclePath + "/" + (name === "STATUS" ? "status" : name) + ".md";
      if (artifacts.read(relative).sha256 !== null) fail("STANDARD_CYCLE_DESTINATION_EXISTS");
      let after = template.content.replaceAll("CXXX", input.cycle_id).replaceAll("[type]", input.cycle_type);
      if (name === "brief") {
        after = section(after, "Objective", "- " + input.objective);
        if (spike) after += `\n## Spike learning\n\n- Learning goal: ${spike.learning_goal}\n- Timebox: ${spike.timebox}\n- Decision target: ${spike.decision_target}\n- Code may be throwaway.\n`;
      }
      if (name === "decisions" && spike) after += `\n## Conversion decision target\n\n- ${spike.decision_target}\n- Outcome: pending experiments; no retention or promotion accepted.\n`;
      if (name === "STATUS") {
        for (const [key, value] of Object.entries({ state: "OPEN", owner: "aidn-cycle-create", "current goal": input.objective, branch_name: branch,
          session_owner: input.session_id, outcome: "ACTIVE", reported_to_session: "none", continuity_rule: input.continuity_rule,
          continuity_base_branch: context.branch, continuity_latest_cycle_branch: admitted.lifecycle.latest_active_cycle_branch,
          continuity_decision_by: spike ? "user" : "agent", continuity_override_reason: "none", dor_state: "NOT_READY", dor_last_check: at, dor_checked_by: "none", dor_override_reason: "none",
          usage_matrix_scope: "local", usage_matrix_state: "NOT_DEFINED", usage_matrix_summary: "none", usage_matrix_rationale: "none", scope_frozen: "false",
          scope_freeze_reason: "none", blockers: "\n  - none", "next step": "\n  - Write the plan and audit specification before implementation.", "last updated": at })) after = replaceField(after, key, value);
        after += `\ncycle_id: ${input.cycle_id}\nupdated_at: ${at}\nsource_of_truth: cycle_state\nlifecycle_status: active\ncontinuity_import_target: ${input.continuity_rule === "R2_SESSION_BASE_WITH_IMPORT" ? admitted.lifecycle.latest_active_cycle_branch : "none"}\n`;
        if (buildCanonicalFromMarkdown(after, { relativePath: relative, classification: { kind: "cycle_status", family: "normative", subtype: "status" } }).contract_status !== "conformant") fail("STANDARD_CYCLE_STATUS_NOT_CONFORMANT");
      }
      return { path: relative, before_sha256: null, after };
    });
    const details = analyzeStructuredArtifact(observed.row.content).derived_session_context;
    const targets = [...new Set([...(details?.integration_target_cycles ?? []), input.cycle_id])];
    const attached = [...new Set([...(details?.attached_cycles ?? []), input.cycle_id])];
    const branchKind = spike?.branch_action === "recommend" ? classifyAidnBranch(context.branch) : "cycle";
    let sessionText = observed.row.content;
    for (const [key, value] of Object.entries({ updated_at: at, branch_kind: branchKind, integration_target_cycles: "\n" + targets.map(id => "  - " + id).join("\n"),
      integration_target_cycle: targets.length === 1 ? input.cycle_id : "none", primary_focus_cycle: input.cycle_id,
      attached_cycles: "\n" + attached.map(id => "  - " + id).join("\n"), cycle_branch: branch })) sessionText = replaceField(sessionText, key, value);
    if (spike) {
      sessionText = replaceField(sessionText, "mode", spike.chosen_mode).replace(/\[[ xX]\] (THINKING|EXPLORING|COMMITTING)/g, (_all, value) => `[${value === spike.chosen_mode ? "x" : " "}] ${value}`);
    }
    changes.push({ path: observed.row.path, before_sha256: observed.row.sha256, after: sessionText });
    const snapshot = artifacts.read("snapshots/context-snapshot.md", { required: true });
    const existing = snapshot.content.match(/^## Active cycles[^\r\n]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1];
    if (existing === undefined) fail("STANDARD_CYCLE_SNAPSHOT_SECTION_INVALID");
    const active = existing.split(/\r?\n/).filter(line => line.trim() && !/^-\s*\(?none\)?\s*$/i.test(line.trim()));
    let snapshotText = section(snapshot.content, "Active cycles", [...active, `- ${input.cycle_id}: OPEN — ${input.objective}`].join("\n"));
    snapshotText = section(snapshotText, "Next entry point", `- Session active: ${input.session_id}\n- Active cycle: ${input.cycle_id}\n- Next action: complete DoR planning at ${cyclePath}/status.md.`);
    changes.push({ path: snapshot.path, before_sha256: snapshot.sha256, after: snapshotText });
    let current = observed.current.content;
    for (const [key, value] of Object.entries({ updated_at: at, active_cycle: input.cycle_id, cycle_branch: branch, branch_kind: branchKind, dor_state: "NOT_READY", first_plan_step: "unknown" })) current = replaceField(current, key, value);
    if (spike) current = replaceField(current, "mode", spike.chosen_mode);
    changes.push({ path: observed.current.path, before_sha256: observed.current.sha256, after: current });
    projectionFiles(changes);
    const plan = { contract_version: spike ? "standard-cycle-initialize-plan.v3" : "standard-cycle-initialize-plan.v2", ...(spike ? { spike_selection: spike } : {}), operation_ref: "cycle_initialize", input, prepared_at_ms: preparedAt, scope: context,
      mode: observed.metadata.mode, branch_name: branch, cycle_path: cyclePath, session_path: observed.row.path, latest_cycle_branch: admitted.lifecycle.latest_active_cycle_branch,
      templates: templates.map(row => ({ path: row.path, sha256: row.sha256 })), changes: changes.map(row => ({ ...row, before_metadata_sha256: artifacts.metadataHash(row.path), after_sha256: artifactContentHash(row.after) })) };
    assertPlan(plan); return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  async function audit(input) {
    assertStandardOperationInput("branch_cycle_audit", input); const context = scope(), observed = session(input.session_id);
    const prewrite = await preWriteAdmit({ targetRoot: root, skill: "branch-cycle-audit" });
    const result = await runBranchCycleAuditAdmitUseCase({ targetRoot: root, mode: observed.metadata.mode });
    const status = artifacts.cycles().find(row => row.cycle_id === input.cycle_id);
    const fields = status ? analyzeStructuredArtifact(status.content).key_values : {};
    const allowed = prewrite.ok === true && result.ok === true && result.action === "audit_cycle_branch" && result.mapped_cycle?.cycle_id === input.cycle_id
      && result.mapped_session?.session_id === input.session_id && observed.state.active_cycle === input.cycle_id && fields.branch_name === context.branch && fields.session_owner === input.session_id;
    return { allowed, prewrite, result, cycle: status, dor_ready: fields.dor_state === "READY" };
  }
  function explicit(prepared, write, expected) {
    if (write !== true || !prepared?.can_apply || prepared.plan_sha256 !== expected || shadowHash(prepared.plan) !== expected) fail("STANDARD_EXPLICIT_EFFECT_REQUIRED");
  }
  async function prepareContext(input, at, acquired = false) {
    assertStandardOperationInput("cycle_context_refresh", input);
    const context = scope(), observed = session(input.session_id), runtime = artifacts.read("RUNTIME-STATE.md", { required: true });
    const prewrite = await preWriteAdmit({ targetRoot: root, skill: "context-reload" });
    if ((!acquired && artifacts.ownerPending()) || prewrite.ok !== true) return { can_apply: false, prewrite };
    projectionFiles([{ path: runtime.path }]);
    const plan = { contract_version: "standard-cycle-context-plan.v2", operation_ref: "cycle_context_refresh", input, prepared_at_ms: at, scope: context,
      mode: observed.metadata.mode, session_path: observed.row.path, session_sha256: observed.row.sha256, current_sha256: observed.current.sha256, runtime_sha256: runtime.sha256,
      runtime_metadata_sha256: artifacts.metadataHash(runtime.path) };
    if (validateJsonSchema(plan, contextSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_CYCLE_CONTEXT_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    ...createStandardCycleCheckpoint({ artifacts, scope, session, audit, now }),
    prepareCycleContext: input => prepareContext(input, now()),
    async refreshCycleContext(prepared, { write = false, expectPlan, effectGuard = null } = {}) {
      explicit(prepared, write, expectPlan);
      if (validateJsonSchema(prepared.plan, contextSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_CYCLE_CONTEXT_PLAN_INVALID");
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          const fresh = await prepareContext(prepared.plan.input, prepared.plan.prepared_at_ms, true); if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          if (effectGuard !== null && (typeof effectGuard.before !== "function" || typeof effectGuard.after !== "function")) fail("STANDARD_CYCLE_EFFECT_GUARD_INVALID");
          await effectGuard?.before();
        }
        catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let attempted = false;
        try {
          // The existing projector derives real canonical repair/freshness
          // observations. It prepares Markdown without a visible-file write;
          // this operation persists it through the canonical artifact CAS.
          const computed = await projectRuntimeState({ targetRoot: root, write: false, dryRun: true });
          const observed = session(prepared.plan.input.session_id), context = scope();
          if (observed.row.sha256 !== prepared.plan.session_sha256 || observed.current.sha256 !== prepared.plan.current_sha256
            || context.branch !== prepared.plan.scope.branch || context.head !== prepared.plan.scope.head) fail("STANDARD_PREVIEW_CHANGED");
          const after = buildRuntimeStateMarkdown(computed.digest), change = { path: "RUNTIME-STATE.md", before_sha256: prepared.plan.runtime_sha256,
            before_metadata_sha256: prepared.plan.runtime_metadata_sha256, after, after_sha256: artifactContentHash(after) };
          projectionFiles([change]);
          attempted = true; const committed = artifacts.compareAndSwapPreservingMetadata(change); const projection = artifacts.project([change.path]);
          if (artifacts.read(change.path).sha256 !== change.after_sha256) fail("STANDARD_CYCLE_CONTEXT_POSTCONDITION_FAILED");
          for (const file of projectionFiles([change])) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== change.after_sha256) fail("STANDARD_CYCLE_PROJECTION_UNCONFIRMED");
          if (artifacts.metadataHash(change.path) !== committed.metadata_sha256) fail("STANDARD_CYCLE_METADATA_UNCONFIRMED");
          const guarded = await effectGuard?.after();
          if (artifacts.metadataHash(change.path) !== committed.metadata_sha256) fail("STANDARD_CYCLE_METADATA_UNCONFIRMED");
          const fields = analyzeStructuredArtifact(after).key_values;
          return emit("cycle_context_refresh", "completed", "confirmed", { digest_sha256: shadowHash(computed.digest), consistency: computed.consistency,
            projection, repair_layer_status: fields.repair_layer_status, current_state_freshness: fields.current_state_freshness,
            ...(guarded ? { guarded_transition: guarded } : {}) }, { cycle_context_refreshed: true },
            [{ ref: "docs/audit/RUNTIME-STATE.md", sha256: change.after_sha256 }]);
        } catch (cause) {
          if (!attempted) { cause.effect_status = "no_effect"; throw cause; }
          return emit("cycle_context_refresh", "reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_CYCLE_CONTEXT_UNCONFIRMED" });
        }
      });
    },
    async admitCycle(input = {}) { assertStandardOperationInput("cycle_admit", input); const observed = await admission(), allowed = observed.allowed && !artifacts.ownerPending();
      return emit("cycle_admit", allowed ? "completed" : "blocked", "no_effect", observed, allowed ? { cycle_creation_allowed: true } : {}); },
    prepareCycle: input => prepare(input, now()),
    prepareSpikeCycle: (input, selection, at = now()) => prepare(input, at, false, assertSpikeSelection(selection)),
    async initializeCycle(prepared, { write = false, expectPlan, effectGuard = null } = {}) {
      explicit(prepared, write, expectPlan); assertPlan(prepared.plan);
      if (effectGuard !== null && (typeof effectGuard.before !== "function" || typeof effectGuard.after !== "function")) fail("STANDARD_CYCLE_EFFECT_GUARD_INVALID");
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          const fresh = await prepare(prepared.plan.input, prepared.plan.prepared_at_ms, true, prepared.plan.spike_selection ?? null); if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_PREVIEW_CHANGED");
          await effectGuard?.before({ assertOwner: () => artifacts.assertLocalEffectOwner(expectPlan) }); projectionFiles(prepared.plan.changes);
        }
        catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], afterMetadata = [];
        try {
          if (prepared.plan.spike_selection?.branch_action !== "recommend") git(["switch", "-c", prepared.plan.branch_name]);
          for (const change of prepared.plan.changes) { afterMetadata.push(artifacts.compareAndSwapPreservingMetadata(change).metadata_sha256); committed.push(change.path); }
          const spike = prepared.plan.spike_selection;
          const checked = spike?.chosen_mode === "EXPLORING" ? { allowed: session(prepared.plan.input.session_id).metadata.mode === spike.chosen_mode
            && scope().branch === (spike.branch_action === "recommend" ? prepared.plan.scope.branch : prepared.plan.branch_name), dor_ready: false,
            observation_kind: "exploring-canonical-postimages-and-physical-branch", committing_branch_audit: "NOT_APPLICABLE",
            branch_kind: classifyAidnBranch(scope().branch), branch_recommendation: prepared.plan.branch_name, branch_created: spike.branch_action === "create" }
            : await audit({ session_id: prepared.plan.input.session_id, cycle_id: prepared.plan.input.cycle_id });
          if (!checked.allowed || checked.dor_ready || scope().head !== prepared.plan.scope.head || prepared.plan.changes.some(row => artifacts.read(row.path).sha256 !== row.after_sha256)) fail("STANDARD_CYCLE_POSTCONDITION_FAILED");
          const projection = artifacts.project(committed);
          for (const [index, file] of projectionFiles(prepared.plan.changes).entries()) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== prepared.plan.changes[index].after_sha256) fail("STANDARD_CYCLE_PROJECTION_UNCONFIRMED");
          if (shadowHash(committed.map(name => artifacts.metadataHash(name))) !== shadowHash(afterMetadata)) fail("STANDARD_CYCLE_METADATA_UNCONFIRMED");
          const guarded = await effectGuard?.after({ assertOwner: () => artifacts.assertLocalEffectOwner(expectPlan) });
          // The guard can await provider/authorization observations. Compare
          // with the CAS results, never a new baseline read after that wait.
          if (shadowHash(committed.map(name => artifacts.metadataHash(name))) !== shadowHash(afterMetadata)) fail("STANDARD_CYCLE_METADATA_UNCONFIRMED");
          return emit("cycle_initialize", "completed", "confirmed", { committed, audit: checked, projection, ...(guarded ? { guarded_transition: guarded } : {}) }, { cycle_initialized: true, cycle_dor_ready: false },
            prepared.plan.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })));
        } catch (cause) { return emit("cycle_initialize", "reconciliation_required", "unknown", { committed, reason_code: cause.code ?? "STANDARD_CYCLE_EFFECT_UNCONFIRMED" }); }
      });
    },
    async auditCycle(input) { const observed = await audit(input); return emit("branch_cycle_audit", observed.allowed ? "completed" : "blocked", "no_effect", observed,
      observed.allowed ? { branch_cycle_mapped: true, cycle_dor_ready: observed.dor_ready } : {}); },
  });
}
