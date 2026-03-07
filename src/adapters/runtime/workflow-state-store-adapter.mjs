import { createIndexStore } from "../../../tools/perf/index-store.mjs";
import { assertWorkflowStateStore } from "../../core/ports/workflow-state-store-port.mjs";

export function createWorkflowStateStoreAdapter(options = {}) {
  const indexStore = createIndexStore(options);
  return assertWorkflowStateStore({
    mode: indexStore.mode,
    writeIndex({ payload }) {
      return indexStore.write(payload);
    },
  }, "WorkflowStateStoreAdapter");
}
