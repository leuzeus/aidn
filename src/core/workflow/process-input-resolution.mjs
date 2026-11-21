import { inspectAgenticProcess } from "./agentic-process.mjs";
import { resolveProcessFrameInput } from "./process-frame-input.mjs";

// Resolve against the same occurrence graph used by execution and replay.
export function resolveProcessOperationInput(options) {
  return resolveProcessFrameInput({ ...options, cursor: inspectAgenticProcess(options.instance) });
}
