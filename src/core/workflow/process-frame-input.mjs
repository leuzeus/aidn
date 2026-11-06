import { createProcessFrameInputSelector } from "./process-frame-input-selection.mjs";
import { processModels, resolveProcessCallTarget } from "./process-call-model.mjs";
import { shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// Pure public selection keeps its fresh model table and trusted reader callback.
// Dependencies are fixed here, never selected from the caller's options.
export function resolveProcessFrameInput({ instance, cursor, occurrenceId, readOperation, returning = false }) {
  return createProcessFrameInputSelector({
    openModelSelection(root) {
      const models = new Map(processModels(root).map(model => [shadowHash(model), model]));
      return { rootSha256: models.keys().next().value,
        // Preserve the historical live root lookup if a reader replaces model.
        modelFor: frame => frame.model_sha256 === undefined ? instance.model
          : models.get(frame.model_sha256) ?? fail("PROCESS_CALL_TARGET_CHANGED") };
    },
    resolveCallTarget: resolveProcessCallTarget,
  })({ instance, cursor, occurrenceId, readOperation, returning });
}
