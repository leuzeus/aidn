import {
  persistHookContext,
  readHookContext,
} from "./context-store.mjs";
import { assertHookContextStore } from "../../core/ports/hook-context-store-port.mjs";
import { captureContextIdentity } from "./context-provenance.mjs";

export function createHookContextStoreAdapter({ packageRoot } = {}) {
  return assertHookContextStore({
    persistContext(options) {
      return persistHookContext(options);
    },
    readContext(options) {
      return readHookContext({ ...options, packageRoot });
    },
    captureContextIdentity(options) {
      return captureContextIdentity({ ...options, packageRoot });
    },
  }, "CodexHookContextStoreAdapter");
}
