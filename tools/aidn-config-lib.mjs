// Compatibility re-export. New code should import from src/lib/config/aidn-config-lib.mjs.
export {
  VALID_STATE_MODES,
  VALID_INDEX_STORE_MODES,
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  normalizeStateMode,
  readAidnProjectConfig,
  resolveAidnConfigPath,
  resolveConfigIndexStore,
  resolveConfigStateMode,
  stateModeFromIndexStore,
  writeAidnProjectConfig,
} from "../src/lib/config/aidn-config-lib.mjs";
