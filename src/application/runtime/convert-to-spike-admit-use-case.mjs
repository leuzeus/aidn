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
