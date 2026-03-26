import path from "node:path";
import { createLocalGitAdapter } from "../../adapters/runtime/local-git-adapter.mjs";
import { classifyAidnBranch } from "../../lib/workflow/branch-kind-lib.mjs";
import { toCycleSummary } from "../../lib/workflow/branch-mapping-lib.mjs";
import { resolveDbBackedMode } from "../../../tools/runtime/db-first-runtime-view-lib.mjs";
import {
  findCycleDirectory,
  listCycleStatuses,
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

function makeResult(base, overrides = {}) {
  const action = overrides.action ?? base.action ?? "blocked_missing_target_cycle";
  const result = overrides.result ?? (action === "promote_baseline_allowed" ? "ok" : "stop");
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
    candidate_cycles: overrides.candidate_cycles ?? base.candidate_cycles ?? [],
    validation_summary: overrides.validation_summary ?? {},
    required_user_choice: overrides.required_user_choice ?? [],
    blocking_reasons: overrides.blocking_reasons ?? [],
    warnings: overrides.warnings ?? [],
    recommended_next_action: overrides.recommended_next_action ?? null,
  };
}

function parseGapReportOpenCount(text) {
  let count = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*-\s*Status:\s*open\s*$/i.test(line)) {
      count += 1;
    }
  }
  return count;
}

function traceabilityLooksComplete(text) {
  const normalized = String(text);
  return /\|\s*REQ\s*\|/i.test(normalized) && /\|\s*TEST\s*\|/i.test(normalized) && /REQ-\d+/i.test(normalized);
}

function resolveTargetCycle(currentState, cycles) {
  const activeCycleId = String(currentState.active_cycle ?? "none").toUpperCase();
  if (activeCycleId && activeCycleId !== "NONE") {
    return cycles.find((cycle) => cycle.cycle_id === activeCycleId) ?? null;
  }
  const doneCycles = cycles.filter((cycle) => String(cycle.state ?? "").toUpperCase() === "DONE");
  if (doneCycles.length === 1) {
    return doneCycles[0];
  }
  return null;
}

export function runPromoteBaselineAdmitUseCase({ targetRoot, mode = "COMMITTING" }) {
  const gitAdapter = createLocalGitAdapter();
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const currentState = readCurrentState(absoluteTargetRoot);
  const auditRoot = currentState.audit_root;
  const sourceBranch = readSourceBranch(absoluteTargetRoot);
  const branch = gitAdapter.getCurrentBranch(absoluteTargetRoot);
  const branchKind = classifyAidnBranch(branch, {
    sourceBranch,
    includeSource: true,
  });
  const cycles = listCycleStatuses(auditRoot);
  const doneCycles = cycles.filter((cycle) => String(cycle.state ?? "").toUpperCase() === "DONE");
  const targetCycle = resolveTargetCycle(currentState, cycles);

  const base = {
    branch,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    branch_kind: branchKind,
    source_branch: sourceBranch,
    mode,
    active_session: String(currentState.active_session ?? "none"),
    active_cycle: String(currentState.active_cycle ?? "none"),
    target_cycle: targetCycle ? toCycleSummary(targetCycle) : null,
    candidate_cycles: doneCycles.map((cycle) => toCycleSummary(cycle)),
  };

  if (!targetCycle) {
    if (doneCycles.length > 1) {
      return makeResult(base, {
        action: "choose_cycle",
        reason_code: "PROMOTE_BASELINE_MULTIPLE_DONE_CYCLES",
        required_user_choice: ["choose_done_cycle"],
        blocking_reasons: [
          "Several DONE cycles are eligible for promotion and no explicit target cycle is active.",
        ],
        recommended_next_action: "Choose the DONE cycle to promote before mutating baseline artifacts.",
      });
    }
    return makeResult(base, {
      action: "blocked_missing_target_cycle",
      reason_code: "PROMOTE_BASELINE_TARGET_CYCLE_MISSING",
      blocking_reasons: [
        "No target cycle could be inferred for baseline promotion.",
      ],
      required_user_choice: ["select_target_cycle"],
      recommended_next_action: "Set the target cycle explicitly or activate the DONE cycle to promote.",
    });
  }

  if (String(targetCycle.state ?? "").toUpperCase() !== "DONE") {
    return makeResult(base, {
      action: "blocked_cycle_not_done",
      reason_code: "PROMOTE_BASELINE_CYCLE_NOT_DONE",
      blocking_reasons: [
        `Cycle ${targetCycle.cycle_id} is ${targetCycle.state} and cannot be promoted yet.`,
      ],
      recommended_next_action: `Finish cycle ${targetCycle.cycle_id} and mark it DONE before promoting baseline.`,
    });
  }

  const cycleDir = findCycleDirectory(auditRoot, targetCycle.cycle_id);
  const traceabilityPath = cycleDir ? path.join(cycleDir, "traceability.md") : "";
  const gapReportPath = cycleDir ? path.join(cycleDir, "gap-report.md") : "";
  const traceabilityText = readTextIfExists(traceabilityPath);
  const gapReportText = readTextIfExists(gapReportPath);
  const openGapCount = parseGapReportOpenCount(gapReportText);
  const validationSummary = {
    traceability_present: Boolean(traceabilityText),
    traceability_complete: traceabilityLooksComplete(traceabilityText),
    gap_report_present: Boolean(gapReportText),
    gap_report_open_count: openGapCount,
    usage_matrix_scope: normalizeUsageMatrixScope(targetCycle.usage_matrix_scope),
    usage_matrix_state: normalizeUsageMatrixState(targetCycle.usage_matrix_state),
    usage_matrix_summary: String(targetCycle.usage_matrix_summary ?? "none"),
    usage_matrix_rationale: String(targetCycle.usage_matrix_rationale ?? "none"),
  };

  if (!validationSummary.traceability_present || !validationSummary.traceability_complete) {
    return makeResult(base, {
      action: "blocked_validation_incomplete",
      reason_code: "PROMOTE_BASELINE_TRACEABILITY_INCOMPLETE",
      validation_summary: validationSummary,
      blocking_reasons: [
        `Cycle ${targetCycle.cycle_id} is missing complete traceability evidence for promotion.`,
      ],
      recommended_next_action: "Complete traceability or record explicit justification before promoting baseline.",
    });
  }

  if (openGapCount > 0) {
    return makeResult(base, {
      action: "blocked_validation_incomplete",
      reason_code: "PROMOTE_BASELINE_OPEN_GAPS",
      validation_summary: validationSummary,
      blocking_reasons: [
        `Cycle ${targetCycle.cycle_id} still has ${openGapCount} open GAP item(s).`,
      ],
      recommended_next_action: "Resolve or explicitly justify remaining GAP items before promoting baseline.",
    });
  }

  if (!usageMatrixSatisfied({
    scope: validationSummary.usage_matrix_scope,
    state: validationSummary.usage_matrix_state,
    rationale: validationSummary.usage_matrix_rationale,
  })) {
    return makeResult(base, {
      action: "blocked_validation_incomplete",
      reason_code: "PROMOTE_BASELINE_USAGE_MATRIX_INCOMPLETE",
      validation_summary: validationSummary,
      blocking_reasons: [
        `Cycle ${targetCycle.cycle_id} requires verified cross-usage evidence before promotion (scope=${validationSummary.usage_matrix_scope}, state=${validationSummary.usage_matrix_state}).`,
      ],
      recommended_next_action: validationSummary.usage_matrix_scope === "high-risk"
        ? "Verify the declared usage matrix for the high-risk surface or record an explicit waiver rationale before promoting baseline."
        : "Verify the declared usage matrix for the shared surface or record an explicit waiver rationale before promoting baseline.",
    });
  }

  return makeResult(base, {
    action: "promote_baseline_allowed",
    reason_code: null,
    target_cycle: toCycleSummary(targetCycle),
    validation_summary: validationSummary,
    recommended_next_action: `Promote cycle ${targetCycle.cycle_id} into baseline artifacts.`,
  });
}
