import {
  resolveEffectiveRuntimeMode as resolveEffectiveRuntimeModeFromPolicy,
  resolveEffectiveStateMode as resolveEffectiveStateModeFromPolicy,
} from "../../core/state-mode/state-mode-policy.mjs";

export function resolveEffectiveRuntimeMode({
  targetRoot,
  stateMode,
  indexStore,
  indexStoreExplicit = false,
}) {
  return resolveEffectiveRuntimeModeFromPolicy({
    targetRoot,
    stateMode,
    indexStore,
    indexStoreExplicit,
  });
}

export function resolveEffectiveStateMode({
  targetRoot,
  stateMode,
}) {
  return resolveEffectiveStateModeFromPolicy({ targetRoot, stateMode });
}
