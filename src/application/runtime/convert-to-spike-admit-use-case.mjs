import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { runBranchCycleAuditAdmitUseCase } from "./branch-cycle-audit-admit-use-case.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { runCycleCreateAdmitUseCase } from "./cycle-create-admit-use-case.mjs";

export async function runConvertToSpikeAdmitUseCase({
  targetRoot,
  mode = "EXPLORING",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const admission = await runCycleCreateAdmitUseCase({
    targetRoot,
    mode,
    sharedCoordination,
    sharedCoordinationOptions,
  });

  return {
    ...admission,
    cycle_type: "spike",
    recommended_branch_prefix: "spike/",
    recommended_next_action: admission.ok === true
      ? "Create a SPIKE cycle and branch only after applying the admitted continuity rule."
      : admission.recommended_next_action,
  };
}

// Completion checks the existing SPIKE; it never selects continuity for a new
// cycle or authenticates the human decision held by the calling operation host.
export async function runConvertToSpikeCompletionAdmitUseCase({ targetRoot, cycleId } = {}) {
  if (!/^C[0-9]{3,6}$/.test(cycleId ?? "")) throw Error("SPIKE_COMPLETION_CYCLE_INVALID");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const current = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
  const cycle = artifacts.cycles().find(row => row.cycle_id === cycleId);
  const fields = cycle ? analyzeStructuredArtifact(cycle.content).key_values : {};
  const session = artifacts.sessions().find(row => row.session_id === current.active_session);
  const metadata = session ? parseSessionMetadata(session.content) : {};
  const audit = await runBranchCycleAuditAdmitUseCase({ targetRoot, mode: current.mode });
  const allowed = current.active_cycle === cycleId && cycle?.path.startsWith(`cycles/${cycleId}-spike-`)
    && fields.state === "OPEN" && fields.session_owner === current.active_session
    && fields.continuity_rule === "R2_SESSION_BASE_WITH_IMPORT" && fields.continuity_base_branch === current.session_branch
    && ["EXPLORING", "COMMITTING"].includes(current.mode) && metadata.mode === current.mode
    && metadata.primary_focus_cycle === cycleId && metadata.session_branch === current.session_branch
    && audit.ok === true && audit.mapped_session?.session_id === current.active_session
    && (audit.branch_kind === "session" ? audit.branch === current.session_branch
      : audit.mapped_cycle?.cycle_id === cycleId && audit.branch === fields.branch_name);
  return { ...audit, ok: allowed, result: allowed ? "ok" : "stop", action: allowed ? "spike_conversion_completed" : "stop_spike_completion",
    reason_code: allowed ? null : "SPIKE_COMPLETION_CONTEXT_INVALID", cycle_type: "spike", continuity_rule: fields.continuity_rule ?? null,
    continuity_base_branch: fields.continuity_base_branch ?? null };
}
