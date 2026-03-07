import { assertWorkflowStateStore } from "../../core/ports/workflow-state-store-port.mjs";

export function persistWorkflowIndexProjection({ stateStore, payload, dryRun = false }) {
  assertWorkflowStateStore(stateStore);
  if (dryRun) {
    return {
      outputs: [],
      writes: {
        files_written_count: 0,
        bytes_written: 0,
      },
    };
  }

  const outputs = stateStore.writeIndex({ payload });
  const writes = outputs.reduce((acc, out) => ({
    files_written_count: acc.files_written_count + (out.written ? 1 : 0),
    bytes_written: acc.bytes_written + (out.written ? Number(out.bytes_written ?? 0) : 0),
  }), {
    files_written_count: 0,
    bytes_written: 0,
  });

  return {
    outputs,
    writes,
  };
}
