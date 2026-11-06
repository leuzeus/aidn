import { resolveProcessFrameInput } from "./process-frame-input.mjs";
import { processFrameNode, resolveProcessCallTarget } from "./process-call-model.mjs";
import { createProcessCallSelector } from "./process-call-selection.mjs";

// These public helpers accept no dependency override. Preserve destructuring and
// leave the historical transition option spread inside the shared algorithm.
function selection() {
  return createProcessCallSelector({ frameNode: processFrameNode,
    resolveFrameInput: resolveProcessFrameInput, resolveCallTarget: resolveProcessCallTarget });
}
export function resolveProcessCallData({ instance, cursor, occurrenceId, returning = false, readOperation }) {
  return selection().resolveCallData({ instance, cursor, occurrenceId, returning, readOperation });
}
export function assertProcessCallTransition(event, options) {
  return selection().assertCallTransition(event, options);
}
