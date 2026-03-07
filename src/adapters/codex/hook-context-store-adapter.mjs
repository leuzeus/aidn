import {
  persistHookContext,
  readHookContext,
} from "../../../tools/codex/context-store.mjs";
import { assertHookContextStore } from "../../core/ports/hook-context-store-port.mjs";

export function createHookContextStoreAdapter() {
  return assertHookContextStore({
    persistContext(options) {
      return persistHookContext(options);
    },
    readContext(options) {
      return readHookContext(options);
    },
  }, "CodexHookContextStoreAdapter");
}
