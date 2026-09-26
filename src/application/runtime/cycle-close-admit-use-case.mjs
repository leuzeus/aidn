import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { AIDN_BRANCH_KIND, classifyAidnBranch, extractCycleIdFromBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { createRuntimeCanonicalSnapshotReader, resolveEffectiveRuntimePersistence } from "./runtime-persistence-service.mjs";
import { findUniqueAuditArtifact, resolveRuntimeHeadArtifact } from "./runtime-head-resolution-service.mjs";
import { resolveDbBackedMode } from "../../../tools/runtime/db-first-runtime-view-lib.mjs";
import {
  findCycleDirectory,
  findCycleStatus,
  listCycleStatuses,
  parseSimpleMap,
  readCurrentState,
  readSourceBranch,
  readTextIfExists,
} from "../../lib/workflow/session-context-lib.mjs";

function normalizeUsageMatrixScope(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "shared" || normalized === "high-risk") {
    return normalized;
  }
  return "local";
}

function normalizeUsageMatrixState(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["NOT_DEFINED", "DECLARED", "PARTIAL", "VERIFIED", "WAIVED"].includes(normalized)) {
    return normalized;
  }
  return "NOT_DEFINED";
}

function usageMatrixSatisfied({ scope, state, rationale }) {
  if (scope === "local") {
    return true;
  }
  if (state === "VERIFIED") {
    return true;
  }
  if (state === "WAIVED" && String(rationale ?? "").trim().length > 0 && String(rationale ?? "").trim().toLowerCase() !== "none") {
    return true;
  }
  return false;
}

function resolveTargetCycle(currentState, cycles) {
  const activeCycleId = String(currentState.active_cycle ?? "none").toUpperCase();
  if (activeCycleId && activeCycleId !== "NONE") {
    return cycles.find((cycle) => cycle.cycle_id === activeCycleId) ?? null;
  }
  const openCycles = cycles.filter((cycle) => ["OPEN", "IMPLEMENTING", "VERIFYING"].includes(String(cycle.state ?? "").toUpperCase()));
  if (openCycles.length === 1) {
    return openCycles[0];
  }
  return null;
}

function readCycleStatusPayload(auditRoot, cycle) {
  if (!cycle) {
    return null;
  }
  const statusPath = findCycleStatus(auditRoot, cycle.cycle_id);
  const text = cycle.canonical_text ?? readTextIfExists(statusPath);
  if (!text) {
    return null;
  }
  const map = parseSimpleMap(text);
  return {
    cycle_id: cycle.cycle_id,
    cycle_dir: cycle.cycle_dir,
    state: String(map.get("state") ?? cycle.state ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
    usage_matrix_scope: normalizeUsageMatrixScope(map.get("usage_matrix_scope") ?? cycle.usage_matrix_scope),
    usage_matrix_state: normalizeUsageMatrixState(map.get("usage_matrix_state") ?? cycle.usage_matrix_state),
    usage_matrix_summary: String(map.get("usage_matrix_summary") ?? cycle.usage_matrix_summary ?? "none"),
    usage_matrix_rationale: String(map.get("usage_matrix_rationale") ?? cycle.usage_matrix_rationale ?? "none"),
  };
}

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? "cycle_close_allowed";
  const result = overrides.result ?? (action === "cycle_close_allowed" ? "ok" : "stop");
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
    target_cycle: overrides.target_cycle ?? base.target_cycle ?? null,
    validation_summary: overrides.validation_summary ?? {},
    required_user_choice: overrides.required_user_choice ?? [],
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
  };
}

export async function runCycleCloseAdmitUseCase({ targetRoot, mode = "COMMITTING" }) {
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
  let cycles = listCycleStatuses(auditRoot);
  let canonicalError = null;
  if (dbBackedMode || resolveEffectiveRuntimePersistence({ targetRoot: absoluteTargetRoot }).backend === "postgres") {
    try {
      const snapshot = await createRuntimeCanonicalSnapshotReader({ targetRoot: absoluteTargetRoot })
        .readCanonicalSnapshot({ includePayload: true, includeRuntimeHeads: true });
      if (!snapshot?.exists || !snapshot.payload || snapshot.warning) throw new Error("Canonical snapshot unavailable");
      const decode = artifact => artifact?.content_format === "base64"
        ? Buffer.from(artifact.content, "base64").toString("utf8") : artifact?.content ?? "";
      const current = resolveRuntimeHeadArtifact(snapshot.runtimeHeads, "current_state", snapshot.payload)
        ?? findUniqueAuditArtifact(snapshot.payload, "CURRENT-STATE.md");
      const metadata = parseSimpleMap(decode(current));
      currentState = { ...currentState, active_session: metadata.get("active_session") ?? "none",
        active_cycle: metadata.get("active_cycle") ?? "none" };
      cycles = (snapshot.payload.cycles ?? []).map(cycle => {
        // Imports classify this as subtype=status; selective artifact writes can
        // leave subtype unset. Identity comes from the canonical path and cycle
        // row, never from a classification label or a local Markdown fallback.
        const statuses = (snapshot.payload.artifacts ?? []).filter(artifact => artifact.cycle_id === cycle.cycle_id
          && String(artifact.path).replace(/\\/g, "/").replace(/^docs\/audit\//i, "")
            .match(/^cycles\/(C\d+)[^/]*\/status\.md$/i)?.[1]?.toUpperCase() === cycle.cycle_id);
        if (statuses.length !== 1) return { ...cycle, canonical_text: "", canonical_invalid: true };
        const text = decode(statuses[0]);
        const status = parseSimpleMap(text);
        const invalid = String(status.get("state") ?? "").toUpperCase() !== String(cycle.state).toUpperCase()
          || status.get("branch_name") !== cycle.branch_name;
        return { ...cycle, cycle_dir: cycle.cycle_dir ?? path.posix.basename(path.posix.dirname(statuses[0].path)),
          canonical_text: text, canonical_invalid: invalid };
      });
    } catch {
      canonicalError = "Canonical cycle closure context is unavailable, ambiguous or inconsistent; diagnose the backend without falling back to Markdown.";
      cycles = [];
    }
  }
  const onCycleBranch = [AIDN_BRANCH_KIND.CYCLE, AIDN_BRANCH_KIND.INTERMEDIATE].includes(branchKind);
  const matches = onCycleBranch ? cycles.filter(cycle => branchKind === AIDN_BRANCH_KIND.CYCLE
    ? cycle.branch_name === branch : cycle.cycle_id === extractCycleIdFromBranch(branch)) : [];
  const targetCycle = onCycleBranch ? (matches.length === 1 ? matches[0] : null) : resolveTargetCycle(currentState, cycles);
  if (targetCycle?.canonical_invalid) canonicalError = "The selected canonical cycle status is unavailable, ambiguous or inconsistent.";
  const resolvedCycle = readCycleStatusPayload(auditRoot, targetCycle);

  const base = {
    branch,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: String(currentState.active_session ?? "none"),
    active_cycle: String(currentState.active_cycle ?? "none"),
    target_cycle: resolvedCycle ?? null,
  };

  if (canonicalError) return makeResult(base, { action: "blocked_canonical_runtime",
    reason_code: "CYCLE_CLOSE_CANONICAL_RUNTIME_INVALID", blocking_reasons: [canonicalError],
    recommended_next_action: "Diagnose the canonical backend before closing the cycle." });
  if (onCycleBranch && matches.length !== 1) return makeResult(base, { action: "blocked_cycle_mapping",
    reason_code: matches.length > 1 ? "CYCLE_CLOSE_MAPPING_AMBIGUOUS" : "CYCLE_CLOSE_MAPPING_MISSING",
    blocking_reasons: ["Cycle closure requires exactly one cycle owning the current branch."],
    recommended_next_action: "Diagnose branch ownership before closing the cycle." });

  if (!resolvedCycle) {
    return makeResult(base, {
      action: "cycle_close_allowed",
      recommended_next_action: "No active cycle status could be resolved; proceed with standard checkpoint validation.",
    });
  }

  const validationSummary = {
    state: resolvedCycle.state,
    usage_matrix_scope: resolvedCycle.usage_matrix_scope,
    usage_matrix_state: resolvedCycle.usage_matrix_state,
    usage_matrix_summary: resolvedCycle.usage_matrix_summary,
    usage_matrix_rationale: resolvedCycle.usage_matrix_rationale,
    cycle_dir: findCycleDirectory(auditRoot, resolvedCycle.cycle_id),
  };

  if (resolvedCycle.state !== "DONE") {
    return makeResult(base, {
      action: "cycle_close_allowed",
      validation_summary: validationSummary,
      recommended_next_action: `Cycle ${resolvedCycle.cycle_id} is ${resolvedCycle.state}; continue with standard checkpoint validation.`,
    });
  }

  if (!usageMatrixSatisfied({
    scope: validationSummary.usage_matrix_scope,
    state: validationSummary.usage_matrix_state,
    rationale: validationSummary.usage_matrix_rationale,
  })) {
    return makeResult(base, {
      action: "blocked_validation_incomplete",
      reason_code: "CYCLE_CLOSE_USAGE_MATRIX_INCOMPLETE",
      validation_summary: validationSummary,
      blocking_reasons: [
        `Cycle ${resolvedCycle.cycle_id} is marked DONE without verified cross-usage evidence (scope=${validationSummary.usage_matrix_scope}, state=${validationSummary.usage_matrix_state}).`,
      ],
      recommended_next_action: validationSummary.usage_matrix_scope === "high-risk"
        ? "Verify the declared usage matrix for the high-risk surface or record an explicit waiver rationale before closing the cycle as DONE."
        : "Verify the declared usage matrix for the shared surface or record an explicit waiver rationale before closing the cycle as DONE.",
    });
  }

  return makeResult(base, {
    action: "cycle_close_allowed",
    validation_summary: validationSummary,
    recommended_next_action: `Cycle ${resolvedCycle.cycle_id} satisfies the usage-matrix gate and can be closed as DONE.`,
  });
}
