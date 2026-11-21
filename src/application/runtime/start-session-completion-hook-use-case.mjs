import { runStartSessionAdmitUseCase } from "./start-session-admit-use-case.mjs";
import { runCheckpointUseCase } from "./checkpoint-use-case.mjs";
import { runWorkflowHookUseCase } from "./workflow-hook-use-case.mjs";
import { defaultCycleCloseHookArguments } from "./cycle-close-hook-use-case.mjs";

// Host capability only. The ordinary CLI has no completion-reader argument.
// The actual checkpoint and start hook share their physical run identity.
export async function runStartSessionCompletionHook({ targetRoot, runtimeDir, mode, runId, readObjectiveCompletion, assertEffectAuthorized }) {
  if (mode !== "COMMITTING" || !/^process_start_[a-f0-9]{40}$/.test(runId)
    || typeof readObjectiveCompletion !== "function" || typeof assertEffectAuthorized !== "function")
    throw Error("STANDARD_START_COMPLETION_CAPABILITY_REQUIRED");
  const admission = await runStartSessionAdmitUseCase({ targetRoot, mode });
  if (!admission.ok || !["resume_current_session", "resume_current_cycle"].includes(admission.action))
    throw Error("STANDARD_START_COMPLETION_ADMISSION_CHANGED");
  const args = { ...defaultCycleCloseHookArguments(runtimeDir), mode, runId, autoSkipGateOnNoSignal: false,
    phase: "session-start", runIdFile: ".aidn/runtime/perf/current-run-id.txt", startLightGate: false,
    constraintLoopMode: "auto", constraintLoopStrict: false, strict: true, json: true };
  const checkpoint = await runCheckpointUseCase({ args, runtimeDir, targetRoot, readObjectiveCompletion, assertEffectAuthorized });
  // Preserve the real checkpoint diagnostic if it refuses; do not emit a start
  // event or manufacture an ok checkpoint from the outer admission result.
  let workflowHook = null, checkpointError = null;
  if (checkpoint.ok === true && checkpoint.gate?.result === "ok" && checkpoint.summary?.result === "ok") {
    await assertEffectAuthorized();
    workflowHook = runWorkflowHookUseCase({ args, runtimeDir, targetRoot, completedCheckpoint: checkpoint, completedStartRunId: runId });
  } else checkpointError = "STANDARD_START_COMPLETION_CHECKPOINT_REFUSED";
  return { ts: new Date().toISOString(), ok: workflowHook?.ok === true, phase: "session-start", skill: "start-session", target_root: targetRoot,
    mode, state_mode: checkpoint.state_mode, strict: true, action: admission.action, result: workflowHook?.result ?? "stop",
    reason_code: checkpointError, branch: admission.branch, branch_kind: admission.branch_kind, admission, checkpoint,
    checkpoint_error: checkpointError, workflow_hook: workflowHook };
}
