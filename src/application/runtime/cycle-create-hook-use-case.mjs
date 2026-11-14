import { runCheckpointUseCase } from "./checkpoint-use-case.mjs";
import { runCycleCreateAdmitUseCase } from "./cycle-create-admit-use-case.mjs";
import { resolveDefaultIndexStore } from "../../core/state-mode/runtime-index-policy.mjs";

export async function runCycleCreateHookUseCase({ args, runtimeDir, targetRoot, readObjectiveCompletion = null, assertEffectAuthorized = null }) {
  const admission = await runCycleCreateAdmitUseCase({ targetRoot, mode: args.mode });
  args.stateMode = admission.state_mode ?? args.stateMode;
  if (!args.indexStoreExplicit) args.indexStore = resolveDefaultIndexStore(args.stateMode);
  const checkpoint = ["proceed_r1_strict_chain", "proceed_r2_session_base_with_import", "create_cycle_allowed"].includes(admission.action)
    ? await runCheckpointUseCase({ args, runtimeDir, targetRoot, readObjectiveCompletion, assertEffectAuthorized })
    : null;
  const checkpointSummary = checkpoint?.summary ?? {};
  return {
    ts: new Date().toISOString(),
    ok: admission.ok === true && (checkpoint ? checkpoint.ok === true : true),
    skill: "cycle-create",
    target_root: targetRoot,
    mode: args.mode,
    state_mode: checkpoint?.state_mode ?? admission.state_mode ?? args.stateMode,
    action: admission.action,
    result: admission.result,
    reason_code: admission.reason_code,
    branch: admission.branch,
    branch_kind: admission.branch_kind,
    workspace: admission.workspace ?? null,
    admission,
    checkpoint,
    summary: {
      result: admission.result,
      reason_code: admission.reason_code ?? null,
      action: admission.action,
      admitted: admission.ok === true,
      checkpoint_ran: checkpoint !== null,
      checkpoint_result: checkpointSummary.result ?? null,
      repair_layer_open_count: Number(checkpointSummary.repair_layer_open_count ?? 0),
      repair_layer_blocking: checkpointSummary.repair_layer_blocking === true,
      repair_layer_status: checkpointSummary.repair_layer_status ?? "clean",
      repair_layer_advice: checkpointSummary.repair_layer_advice ?? "Repair layer is clean.",
      repair_primary_reason: checkpointSummary.repair_primary_reason ?? checkpointSummary.repair_layer_advice ?? "Repair layer is clean.",
      repair_layer_top_findings: Array.isArray(checkpointSummary.repair_layer_top_findings) ? checkpointSummary.repair_layer_top_findings : [],
    },
  };
}
