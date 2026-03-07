import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigIndexStore,
  resolveConfigStateMode,
} from "../../lib/config/aidn-config-lib.mjs";

export function isDbBackedStateMode(stateMode) {
  const normalized = normalizeStateMode(stateMode);
  return normalized === "dual" || normalized === "db-only";
}

export function requiresStrictRuntime(stateMode) {
  return isDbBackedStateMode(stateMode);
}

export function shouldRunConstraintLoopForState({
  phase,
  constraintLoopMode,
  stateMode,
}) {
  if (phase !== "session-close") {
    return false;
  }
  if (constraintLoopMode === "on") {
    return true;
  }
  if (constraintLoopMode === "off") {
    if (isDbBackedStateMode(stateMode)) {
      throw new Error("--no-constraint-loop is not allowed in dual/db-only mode");
    }
    return false;
  }
  return isDbBackedStateMode(stateMode);
}

export function resolveEffectiveRuntimeMode({
  targetRoot,
  stateMode,
  indexStore,
  indexStoreExplicit = false,
  env = process.env,
}) {
  const envStateModeSet = String(env.AIDN_STATE_MODE ?? "").trim().length > 0;
  const envIndexStoreSet = String(env.AIDN_INDEX_STORE_MODE ?? "").trim().length > 0;
  const config = readAidnProjectConfig(targetRoot);

  let effectiveStateMode = normalizeStateMode(stateMode) ?? "files";
  if (!envStateModeSet) {
    const configStateMode = resolveConfigStateMode(config.data);
    if (configStateMode) {
      effectiveStateMode = configStateMode;
    }
  } else {
    effectiveStateMode = normalizeStateMode(env.AIDN_STATE_MODE) ?? effectiveStateMode;
  }
  if (!effectiveStateMode) {
    throw new Error("Invalid effective AIDN_STATE_MODE. Expected files|dual|db-only");
  }

  let effectiveIndexStore = indexStore;
  if (!indexStoreExplicit && !envIndexStoreSet) {
    if (envStateModeSet) {
      effectiveIndexStore = defaultIndexStoreFromStateMode(effectiveStateMode);
    } else {
      const configStore = resolveConfigIndexStore(config.data);
      if (configStore) {
        effectiveIndexStore = configStore;
      } else if (!normalizeIndexStoreMode(effectiveIndexStore)) {
        effectiveIndexStore = defaultIndexStoreFromStateMode(effectiveStateMode);
      }
    }
  }

  const normalizedIndexStore = normalizeIndexStoreMode(effectiveIndexStore);
  if (!normalizedIndexStore) {
    throw new Error("Invalid effective index store. Expected file|sql|dual|sqlite|dual-sqlite|all");
  }

  return {
    config,
    envStateModeSet,
    envIndexStoreSet,
    stateMode: effectiveStateMode,
    indexStore: normalizedIndexStore,
  };
}

export function resolveEffectiveStateMode({ targetRoot, stateMode, env = process.env }) {
  return resolveEffectiveRuntimeMode({
    targetRoot,
    stateMode,
    indexStore: "file",
    indexStoreExplicit: true,
    env,
  }).stateMode;
}
