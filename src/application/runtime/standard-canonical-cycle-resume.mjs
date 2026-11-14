import fs from "node:fs";
import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { observeStandardCycleEntryContext } from "./standard-cycle-entry-context.mjs";
import { runStartSessionAdmitUseCase } from "./start-session-admit-use-case.mjs";
import { runBranchCycleAuditAdmitUseCase } from "./branch-cycle-audit-admit-use-case.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { projectStandardCanonicalCycleProgress } from "../../core/workflow/standard-canonical-plan-projection.mjs";
import { assertCanonicalResumeInput, assertCanonicalResumeOutput, canonicalResumeSource, evaluateCanonicalResumeReadiness,
  canonicalCycleResumeAdmitOperation, ownedCanonicalCycleResumeAdmitOperation } from "../../core/workflow/standard-canonical-cycle-resume.mjs";
import { assertOwnedCanonicalResumeInput, ownedCanonicalResumeEntry, ownedCanonicalResumeSource } from "../../core/workflow/standard-owned-cycle-resume.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });
const fields = row => analyzeStructuredArtifact(row.content).key_values;
const withoutHead = ({ head, ...scope }) => scope;
const pathsFor = session => ["docs/audit/CURRENT-STATE.md", "docs/audit/sessions/" + session + ".md", "docs/audit/snapshots/context-snapshot.md"].sort();

// No authored observer, source packet, principal, path or permission enters this
// API. The host authenticates accepted history; fresh readers supply current
// canonical metadata, actual phase/DoR/branch and a clean Git observation.
export function createStandardCanonicalCycleResume(options) {
  return createResumeAdmission({ ...options, readSource: options.readCheckpoint }, false);
}
export function createStandardOwnedCanonicalCycleResume(options) {
  return createResumeAdmission({ ...options, readSource: options.readEntry }, true);
}
function createResumeAdmission({ targetRoot, scope, readSource, readContext, readCurrent }, owned) {
  if (![scope, readSource, readContext, readCurrent].every(fn => typeof fn === "function")) fail("STANDARD_CANONICAL_RESUME_AUTHORITY_REQUIRED");
  const assertInput = owned ? assertOwnedCanonicalResumeInput : assertCanonicalResumeInput;
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }),
    port = session => createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root }, { profile: "cycle-context", approvedPaths: pathsFor(session) });
  const current = instance => {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CANONICAL_RESUME_PROCESS_CHANGED");
    if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
  };
  function physical(session) {
    return pathsFor(session).map(name => {
      const absolute = agentRunPhysicalPath(path.join(artifacts.root, name), { missing: true });
      if (!fs.existsSync(absolute)) return { path: name, sha256: null };
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.nlink !== 1) fail("STANDARD_CANONICAL_RESUME_REGULAR_FILE_REQUIRED");
      return { path: name, sha256: readAgentRunFile(absolute, { json: false, maxBytes: 1048576 }).sha256 };
    });
  }
  function rows(names) {
    const selected = artifacts.describe(), result = artifacts.readMany(names, { required: names, includeMetadata: true });
    if (shadowHash(selected) !== shadowHash(artifacts.describe()) || selected.backend === "postgres" && result.some(row => row.source !== "postgres"))
      fail("STANDARD_CANONICAL_BACKEND_CONFLICT");
    return result;
  }
  function describe(source, input, observed) {
    if (!owned) return canonicalResumeSource(source, input);
    const { entry, selected } = ownedCanonicalResumeEntry(source, input);
    return ownedCanonicalResumeSource(source, input, { scope: scope(), backend: artifacts.describe(), git: observed.context.git,
      status_content: artifacts.read(selected.cycle_path + "/status.md", { required: true }).content,
      physical_focus: physical(entry.session_id) });
  }
  function capture(instance, source, descriptor) {
    current(instance);
    const actual = scope(), selected = artifacts.describe(), canonical = rows(descriptor.canonical.map(row => row.path)).map(pin),
      observed = observeStandardCycleEntryContext({ artifacts, scope, sessionId: descriptor.session_id }),
      cycle = observed.cycles.find(row => row.cycle_id === descriptor.cycle_id), view = owned ? null : port(descriptor.session_id).inspect();
    if (shadowHash(source) !== descriptor.source_sha256 || shadowHash(withoutHead(actual)) !== descriptor.scope_without_head_sha256
      || actual.branch !== descriptor.branch || actual.head !== descriptor.head
      || !owned && (view.branch !== descriptor.branch || view.head !== descriptor.head
        || view.filter_context_sha256 !== descriptor.filter_context_sha256 || !view.index_clean || view.lock_present || view.changes.length)
      || shadowHash(selected) !== descriptor.backend_binding_sha256 || shadowHash(canonical) !== shadowHash(descriptor.canonical)
      || shadowHash(physical(descriptor.session_id)) !== shadowHash(descriptor.physical_focus)) fail("STANDARD_CANONICAL_RESUME_SOURCE_CHANGED");
    if (observed.inventory_sha256 !== descriptor.inventory_sha256 || observed.state.active_session !== descriptor.session_id
      || observed.state.active_cycle !== descriptor.cycle_id || observed.state.mode !== "COMMITTING" || observed.state.cycle_branch !== descriptor.branch
      || fields(observed.session).state !== "OPEN" || observed.metadata.primary_focus_cycle !== descriptor.cycle_id || observed.metadata.cycle_branch !== descriptor.branch
      || !observed.metadata.attached_cycles.includes(descriptor.cycle_id) || !observed.metadata.integration_target_cycles.includes(descriptor.cycle_id)
      || !cycle || cycle.row.path !== descriptor.cycle_path + "/status.md" || cycle.fields.state !== descriptor.phase
      || cycle.fields.session_owner !== descriptor.session_id || cycle.fields.branch_name !== descriptor.branch) fail("STANDARD_CANONICAL_RESUME_FOCUS_CHANGED");
    if (descriptor.checkpoint_created) {
      const plan = source.plan, physicalCommit = port(descriptor.session_id).inspectCommit({ ...plan.git, operation_id: plan.operation_id,
        prepared_at_ms: plan.prepared_at_ms, plan_sha256: shadowHash(plan) });
      if (physicalCommit.status !== "confirmed" || physicalCommit.commit_sha !== descriptor.head) fail("STANDARD_CANONICAL_RESUME_CHECKPOINT_CHANGED");
    }
    current(instance);
    return { scope_sha256: shadowHash(actual), backend_sha256: shadowHash(selected), git_sha256: owned ? descriptor.git_sha256 : shadowHash(view), canonical };
  }
  function contextRows(observed, descriptor) {
    const context = observed.context;
    if (shadowHash(context) !== observed.context_sha256 || context.context_use !== "active_cycle" || context.mode !== "COMMITTING"
      || context.session_id !== descriptor.session_id || context.cycle_id !== descriptor.cycle_id || context.cycle_path !== descriptor.cycle_path
      || context.cycle_state !== descriptor.phase || context.branch !== descriptor.branch || context.head !== descriptor.head
      || context.documents.some(row => !row.ref.startsWith("audit:"))) fail("STANDARD_CANONICAL_RESUME_CONTEXT_CHANGED");
    const names = context.documents.map(row => row.ref.slice(6)), material = rows(names), metadata = new Map((context.metadata_pins ?? []).map(row => [row.ref, row.sha256]));
    if (material.some((row, index) => row.path !== names[index] || row.sha256 !== context.documents[index].sha256
      || metadata.get("audit:" + row.path) !== row.metadata_sha256)) fail("STANDARD_CANONICAL_RESUME_CONTEXT_CHANGED");
    return material.map(pin);
  }
  function mergePins(canonical, additional) {
    const all = new Map(canonical.map(row => [row.path, row]));
    for (const row of additional) {
      if (all.has(row.path) && shadowHash(all.get(row.path)) !== shadowHash(row)) fail("STANDARD_CANONICAL_RESUME_CONTEXT_CHANGED");
      all.set(row.path, row);
    }
    return [...all.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
  return async (instance, input, operationId) => {
    assertInput(input); current(instance);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_CANONICAL_RESUME_OPERATION_REQUIRED");
    const source = await readSource(instance, input);
    current(instance);
    const ownedContext = owned ? await readContext() : null;
    current(instance);
    const descriptor = describe(source, input, ownedContext);
    current(instance);
    const before = capture(instance, source, descriptor), observed = ownedContext ?? await readContext();
    current(instance);
    const canonical = mergePins(before.canonical, contextRows(observed, descriptor)), projection = projectStandardCanonicalCycleProgress(observed);
    const admit = await preWriteAdmit({ targetRoot: artifacts.root, skill: "start-session" });
    const start = await runStartSessionAdmitUseCase({ targetRoot: artifacts.root, mode: "COMMITTING" });
    const audit = await runBranchCycleAuditAdmitUseCase({ targetRoot: artifacts.root, mode: "COMMITTING" });
    current(instance);
    const branchAdmitted = admit.ok === true && start.ok === true && start.action === "resume_current_cycle" && start.active_session === descriptor.session_id
      && start.mapped_cycle?.cycle_id === descriptor.cycle_id && start.branch === descriptor.branch && audit.ok === true && audit.action === "audit_cycle_branch"
      && audit.mapped_cycle?.cycle_id === descriptor.cycle_id && audit.mapped_session?.session_id === descriptor.session_id && audit.branch === descriptor.branch;
    const readiness = evaluateCanonicalResumeReadiness({ projection, context: observed.context, branchAdmitted });
    const freshSource = await readSource(instance, input);
    current(instance);
    const ownedFresh = owned ? await readContext() : null;
    current(instance);
    const freshDescriptor = describe(freshSource, input, ownedFresh), fresh = ownedFresh ?? await readContext();
    current(instance);
    const after = capture(instance, freshSource, freshDescriptor), freshCanonical = mergePins(after.canonical, contextRows(fresh, freshDescriptor));
    if (shadowHash(source) !== shadowHash(freshSource) || shadowHash(descriptor) !== shadowHash(freshDescriptor)
      || shadowHash(before) !== shadowHash(after) || observed.context_sha256 !== fresh.context_sha256
      || shadowHash(canonical) !== shadowHash(freshCanonical) || shadowHash(projection) !== shadowHash(projectStandardCanonicalCycleProgress(fresh)))
      fail("STANDARD_CANONICAL_RESUME_SOURCE_CHANGED");
    current(instance);
    const origin = owned ? { entry_operation_id: input.entry_operation_id, entry_sha256: descriptor.entry_sha256 }
      : { focus_checkpoint_operation_id: input.focus_checkpoint_operation_id, checkpoint_sha256: descriptor.checkpoint_sha256 };
    return assertCanonicalResumeOutput({ contract_version: owned ? "standard-owned-cycle-resume-output.v1" : "standard-canonical-cycle-resume-output.v1",
      operation_ref: owned ? ownedCanonicalCycleResumeAdmitOperation : canonicalCycleResumeAdmitOperation,
      outcome: readiness.satisfied ? "completed" : "blocked", effect_status: "no_effect",
      facts: readiness.satisfied ? { canonical_cycle_resume_available: true, cycle_resume_phase_admitted: descriptor.phase !== "OPEN" } : {},
      observations: { source_kind: "canonical_progress", admission_operation_id: operationId, ...origin,
        source_sha256: descriptor.source_sha256, context_sha256: observed.context_sha256,
        operation_scope_sha256: before.scope_sha256, scope_sha256: shadowHash(projection.proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths }))),
        canonical_binding_sha256: before.backend_sha256, git_sha256: before.git_sha256, session_id: descriptor.session_id, cycle_id: descriptor.cycle_id,
        cycle_path: descriptor.cycle_path, canonical_phase: descriptor.phase, continuity_action: descriptor.continuity_action,
        work_intent: descriptor.work_intent, canonical, proposal: projection.proposal,
        original_plan_sha256: artifactContentHash(projection.original_plan), imported_completed_task_ids: projection.completed_task_ids,
        retained_verification_history: projection.retained_verification_history, readiness_checks: readiness.checks, readiness_satisfied: readiness.satisfied,
        phase_transition_required: descriptor.phase === "OPEN", reason_code: readiness.satisfied ? null : "STANDARD_CANONICAL_RESUME_DOR_REQUIRED",
        implementation_authorized: false, current_validation_evidence: false, current_native_work_evidence: false },
      evidence_refs: canonical.map(row => ({ ref: "audit:" + row.path, sha256: row.sha256 })) });
  };
}
