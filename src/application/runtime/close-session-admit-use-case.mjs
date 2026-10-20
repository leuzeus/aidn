import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { AIDN_BRANCH_KIND, classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { resolveDbBackedMode } from "../../../tools/runtime/db-first-runtime-view-lib.mjs";
import { resolveEffectiveRuntimePersistence } from "./runtime-persistence-service.mjs";
import { readCanonicalCloseSessionContext } from "./close-session-context-service.mjs";
import {
  resolveBranchMapping,
  toCycleSummary,
  toSessionSummary,
} from "../../lib/workflow/branch-mapping-lib.mjs";
import {
  collectOpenCycles,
  listCycleStatuses,
  listSessionArtifacts,
  parseSessionCloseCycleDecisions,
  parseSimpleMap,
  readCurrentState,
  readSourceBranch,
  readTextIfExists,
} from "../../lib/workflow/session-context-lib.mjs";
import { classifyOpenCycleTopology, isStaleMergedOpenCycle } from "./stale-open-cycle-guard-lib.mjs";
import { WORKFLOW_ACTION, WORKFLOW_RESULT } from "./workflow-transition-constants.mjs";
import {
  buildCloseSessionDecisionContext,
  evaluateCloseSessionTransition,
  resolveTargetSessionArtifact,
} from "./workflow-transition-lib.mjs";

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? WORKFLOW_ACTION.BLOCKED_MISSING_ACTIVE_SESSION;
  const result = overrides.result ?? (action === WORKFLOW_ACTION.CLOSE_SESSION_ALLOWED ? WORKFLOW_RESULT.OK : WORKFLOW_RESULT.STOP);
  return {
    ts: new Date().toISOString(),
    ok: result === "ok",
    result,
    action,
    reason_code: overrides.reason_code ?? null,
    state_mode: base.state_mode,
    db_backed_mode: base.db_backed_mode,
    branch: base.branch,
    branch_kind: base.branch_kind,
    source_branch: base.source_branch,
    mode: base.mode,
    active_session: base.active_session,
    active_cycle: base.active_cycle,
    mapped_session: overrides.mapped_session ?? base.mapped_session ?? null,
    mapped_cycle: overrides.mapped_cycle ?? base.mapped_cycle ?? null,
    open_cycles: overrides.open_cycles ?? base.open_cycles ?? [],
    unresolved_cycles: overrides.unresolved_cycles ?? [],
    cycle_decisions: overrides.cycle_decisions ?? [],
    required_user_choice: overrides.required_user_choice ?? [],
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
  };
}

export async function runCloseSessionAdmitUseCase({ targetRoot, mode = "UNKNOWN", persistenceOptions = {} }) {
  const gitAdapter = createLocalGitAdapter();
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  let currentState = readCurrentState(absoluteTargetRoot);
  const auditRoot = currentState.audit_root;
  const sourceBranch = readSourceBranch(absoluteTargetRoot);
  const branch = gitAdapter.getCurrentBranch(absoluteTargetRoot);
  const branchKind = classifyAidnBranch(branch, {
    sourceBranch,
    includeSource: true,
  });
  const canonical = dbBackedMode || resolveEffectiveRuntimePersistence({ targetRoot: absoluteTargetRoot }).backend === "postgres";
  let sessions = canonical ? [] : listSessionArtifacts(auditRoot);
  let cycles = canonical ? [] : listCycleStatuses(auditRoot);
  let canonicalError = null;
  if (canonical) {
    try {
      const context = await readCanonicalCloseSessionContext({ targetRoot: absoluteTargetRoot, auditRoot, persistenceOptions });
      currentState = { ...currentState, ...context.currentState };
      sessions = context.sessions;
      cycles = context.cycles;
      for (const [value, rows, key] of [[currentState.active_session, sessions, "session_id"],
        [currentState.active_cycle, cycles, "cycle_id"]]) {
        if (!/^none$/i.test(value) && rows.filter(row => row[key] === String(value).toUpperCase()).length !== 1) {
          throw new Error("Canonical active identity missing or ambiguous");
        }
      }
    } catch {
      canonicalError = "Canonical session closure context is unavailable, ambiguous or inconsistent; diagnose the backend without falling back to Markdown.";
      sessions = [];
      cycles = [];
    }
  }
  const openCycles = collectOpenCycles(cycles);
  const mapping = resolveBranchMapping({
    branch,
    branchKind,
    sessions,
    cycles,
  });
  const activeSessionId = String(currentState.active_session ?? "none");
  const activeCycleId = String(currentState.active_cycle ?? "none");
  const activeSessionArtifact = sessions.find(session => session.session_id === activeSessionId.toUpperCase()) ?? null;
  let targetSession = resolveTargetSessionArtifact({
    activeSessionArtifact,
    mapping,
    branchKind,
    sessions,
    currentState,
  });
  // The final hook may run after the focus was cleared. Resolve only the
  // terminal cycle owning this branch and its explicitly closed owner session;
  // never guess the latest session or reactivate an implementation context.
  if (!targetSession && /^none$/i.test(activeSessionId) && /^none$/i.test(activeCycleId)
      && !mapping.ambiguous && mapping.mapped_cycle
      && ["DONE", "NO_GO", "DROPPED"].includes(mapping.mapped_cycle.state)) {
    const owners = sessions.filter(session => session.session_id === mapping.mapped_cycle.session_owner);
    const owner = owners.length === 1 ? owners[0] : null;
    const ownerText = owner ? owner.canonical_text ?? readTextIfExists(owner.file_path) : "";
    if (owner && String(parseSimpleMap(ownerText).get("state")).toUpperCase() === "CLOSED"
        && owner.metadata.close_gate_satisfied === true && owner.metadata.snapshot_updated === true) targetSession = owner;
  }
  const targetSessionText = targetSession ? targetSession.canonical_text ?? readTextIfExists(targetSession.file_path) : "";
  const {
    cycleDecisions,
    cycleTopology,
    sessionOpenCycles,
    staleReportedCycles,
    staleUnresolvedCycles,
    unresolvedCycles,
  } = buildCloseSessionDecisionContext({
    classifyCycleTopology: {
      classifyOpenCycleTopology,
      isStaleMergedOpenCycle,
      parseSessionCloseCycleDecisions,
      targetRoot: absoluteTargetRoot,
    },
    openCycles,
    sourceBranch,
    targetSession,
    targetSessionText,
    sessions,
  });

  const base = {
    branch,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: activeSessionId,
    active_cycle: activeCycleId,
    mapped_session: targetSession ? toSessionSummary(targetSession) : null,
    mapped_cycle: mapping.mapped_cycle ? toCycleSummary(mapping.mapped_cycle) : null,
    open_cycles: sessionOpenCycles.map((cycle) => toCycleSummary(cycle)),
  };

  if (canonicalError) return makeResult(base, { action: "blocked_canonical_runtime",
    reason_code: "CLOSE_SESSION_CANONICAL_RUNTIME_INVALID", blocking_reasons: [canonicalError],
    recommended_next_action: "Diagnose the canonical backend before closing the session." });
  if (mapping.ambiguous || (targetSession && mapping.mapped_cycle
      && mapping.mapped_cycle.session_owner !== targetSession.session_id)) {
    return makeResult(base, { action: "blocked_ambiguous_topology", reason_code: "CLOSE_SESSION_OWNERSHIP_INVALID",
      blocking_reasons: ["Session closure requires unambiguous branch and session ownership."] });
  }

  return makeResult(base, evaluateCloseSessionTransition({
    branchKind,
    cycleDecisions,
    cycleTopology,
    staleReportedCycles,
    staleUnresolvedCycles,
    targetSession,
    unresolvedCycles,
  }));
}
