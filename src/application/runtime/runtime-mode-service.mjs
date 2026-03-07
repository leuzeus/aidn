import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  readAidnProjectConfig,
  resolveConfigIndexStore,
  resolveConfigStateMode,
} from "../../lib/config/aidn-config-lib.mjs";

export function resolveEffectiveRuntimeMode({
  targetRoot,
  stateMode,
  indexStore,
  indexStoreExplicit = false,
}) {
  const envStateModeSet = String(process.env.AIDN_STATE_MODE ?? "").trim().length > 0;
  const envIndexStoreSet = String(process.env.AIDN_INDEX_STORE_MODE ?? "").trim().length > 0;
  const config = readAidnProjectConfig(targetRoot);

  let effectiveStateMode = typeof stateMode === "string"
    ? stateMode.trim().toLowerCase()
    : "";
  if (!effectiveStateMode) {
    effectiveStateMode = "files";
  }
  if (!envStateModeSet) {
    const configStateMode = resolveConfigStateMode(config.data);
    if (configStateMode) {
      effectiveStateMode = configStateMode;
    }
  } else {
    effectiveStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase() || effectiveStateMode;
  }
  if (!["files", "dual", "db-only"].includes(effectiveStateMode)) {
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

export function resolveEffectiveStateMode({
  targetRoot,
  stateMode,
}) {
  return resolveEffectiveRuntimeMode({
    targetRoot,
    stateMode,
    indexStore: "file",
    indexStoreExplicit: true,
  }).stateMode;
}
