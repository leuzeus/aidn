import { inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { resolveProcessOperationInput } from "../../core/workflow/process-input-resolution.mjs";
import { assertResolvedProcessInput } from "../../core/workflow/process-data-contracts.mjs";
import { normalizeStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { checkShadowJson, shadowHash } from "../../core/workflow/shadow-json.mjs";

import { processModels, processFrameNode, processFrameModel } from "../../core/workflow/process-call-model.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function resolveStandardProcessInput({ instance, occurrenceId, input = {}, readOperation }) {
  const frame = inspectAgenticProcess(instance).occurrences.find(row => row.occurrence_id === occurrenceId);
  const model = processFrameModel(instance.model, frame);
  if (!model.data_bindings) return { input };
  if (checkShadowJson(input) || !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) fail("PROCESS_INPUT_OVERRIDE_FORBIDDEN");
  const resolution = resolveProcessOperationInput({ instance, occurrenceId, readOperation });
  const binding = processFrameNode(instance.model, frame).binding_ref;
  return { input: normalizeStandardOperationInput(binding, resolution.input), input_resolution: resolution };
}
export function assertStandardResolvedPreview(preview, model) {
  if (model.call_targets && preview.input_resolution) {
    model = processModels(model).find(row => row.data_bindings && shadowHash(row.data_bindings) === preview.input_resolution.bindings_sha256)
      ?? fail("PROCESS_RESOLVED_INPUT_CHANGED");
  }
  if (!model.data_bindings) { if (Object.hasOwn(preview, "input_resolution")) fail("PROCESS_RESOLVED_INPUT_UNDECLARED"); return; }
  const value = assertResolvedProcessInput(preview.input_resolution);
  if (value.instance_sha256 !== preview.instance_sha256 || value.occurrence_id !== preview.occurrence_id
    || value.bindings_sha256 !== shadowHash(model.data_bindings)
    || shadowHash(normalizeStandardOperationInput(preview.binding.id, value.input)) !== shadowHash(preview.input)) fail("PROCESS_RESOLVED_INPUT_CHANGED");
}
