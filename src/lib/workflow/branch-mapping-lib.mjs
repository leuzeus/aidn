import path from "node:path";
import { AIDN_BRANCH_KIND, extractCycleIdFromBranch } from "./branch-kind-lib.mjs";

function toSessionSummary(session) {
  if (!session) {
    return null;
  }
  return {
    session_id: session.session_id,
    session_branch: session.metadata.session_branch ?? null,
    branch_kind: session.metadata.branch_kind ?? null,
    attached_cycles: session.metadata.attached_cycles,
    integration_target_cycles: session.metadata.integration_target_cycles,
    primary_focus_cycle: session.metadata.primary_focus_cycle ?? null,
    carry_over_pending: session.metadata.carry_over_pending ?? null,
    close_gate_satisfied: session.metadata.close_gate_satisfied,
  };
}

function toCycleSummary(cycle) {
  if (!cycle) {
    return null;
  }
  return {
    cycle_id: cycle.cycle_id,
    branch_name: cycle.branch_name,
    session_owner: cycle.session_owner,
    state: cycle.state,
    dor_state: cycle.dor_state,
    continuity_rule: cycle.continuity_rule,
  };
}

export function listSessionCandidateCycles(session, openCycles) {
  if (!session) {
    return [];
  }
  const explicitCycleIds = new Set([
    ...(Array.isArray(session.metadata.attached_cycles) ? session.metadata.attached_cycles : []),
    ...(Array.isArray(session.metadata.integration_target_cycles) ? session.metadata.integration_target_cycles : []),
    ...(session.metadata.primary_focus_cycle ? [session.metadata.primary_focus_cycle] : []),
  ]);
  const ownerCycles = openCycles.filter((cycle) => String(cycle.session_owner ?? "").toUpperCase() === session.session_id);
  const explicitCycles = ownerCycles.filter((cycle) => explicitCycleIds.has(cycle.cycle_id));
  if (explicitCycles.length > 0) {
    return explicitCycles;
  }
  return ownerCycles;
}

export function parseLatestSessionArtifact({ findLatestSessionFile, parseSessionMetadata, readTextIfExists, auditRoot }) {
  const latestSessionFile = findLatestSessionFile(auditRoot);
  if (!latestSessionFile) {
    return null;
  }
  const text = readTextIfExists(latestSessionFile);
  const metadata = parseSessionMetadata(text);
  const sessionIdMatch = path.basename(latestSessionFile).match(/^(S\d+)/i);
  return {
    session_id: sessionIdMatch ? String(sessionIdMatch[1]).toUpperCase() : null,
    file_path: latestSessionFile,
    metadata,
  };
}

export function resolveBranchMapping({ branch, branchKind, sessions, cycles }) {
  if (branchKind === AIDN_BRANCH_KIND.SESSION) {
    const matches = sessions.filter((session) => session.metadata.session_branch === branch);
    return {
      mapped_session: matches.length === 1 ? matches[0] : null,
      mapped_cycle: null,
      candidate_sessions: matches.map((session) => toSessionSummary(session)),
      candidate_cycles: [],
      ambiguous: matches.length > 1,
      missing: matches.length === 0,
    };
  }
  if (branchKind === AIDN_BRANCH_KIND.CYCLE) {
    const matches = cycles.filter((cycle) => cycle.branch_name === branch);
    return {
      mapped_session: null,
      mapped_cycle: matches.length === 1 ? matches[0] : null,
      candidate_sessions: [],
      candidate_cycles: matches.map((cycle) => toCycleSummary(cycle)),
      ambiguous: matches.length > 1,
      missing: matches.length === 0,
    };
  }
  if (branchKind === AIDN_BRANCH_KIND.INTERMEDIATE) {
    const cycleId = extractCycleIdFromBranch(branch);
    const matches = cycleId ? cycles.filter((cycle) => cycle.cycle_id === cycleId) : [];
    return {
      mapped_session: null,
      mapped_cycle: matches.length === 1 ? matches[0] : null,
      candidate_sessions: [],
      candidate_cycles: matches.map((cycle) => toCycleSummary(cycle)),
      ambiguous: !cycleId || matches.length > 1,
      missing: Boolean(cycleId) && matches.length === 0,
    };
  }
  return {
    mapped_session: null,
    mapped_cycle: null,
    candidate_sessions: [],
    candidate_cycles: [],
    ambiguous: false,
    missing: false,
  };
}

export { toCycleSummary, toSessionSummary };
