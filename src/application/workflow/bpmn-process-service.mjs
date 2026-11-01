import { createHash } from "node:crypto";
import { readBpmnXml } from "../../adapters/workflow/bpmn-xml.mjs";
import { compileBpmnProcessTree } from "../../core/workflow/bpmn-process-compiler.mjs";
import { bpmnFail } from "../../core/workflow/bpmn-profile.mjs";
import { checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { exactKeys } from "../../core/workflow/agentic-process-model.mjs";

// Explicit in-memory compilation. No file lookup, plugin/agent selection or write.
export function compileBpmnProcess(input) {
  // XML has its own byte limit; the remaining binding input uses the JSON guard.
  if (!input || Object.getPrototypeOf(input) !== Object.prototype
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !("value" in d))) bpmnFail("BPMN_BINDINGS_INVALID");
  const { xml, ...bindings } = input;
  if (!exactKeys(bindings, ["modelId", "revision", "participantId", "roles", "policies"]) || checkShadowJson(bindings)) bpmnFail("BPMN_BINDINGS_INVALID");
  const root = readBpmnXml(xml);
  return compileBpmnProcessTree({ root, sourceSha256: createHash("sha256").update(xml, "utf8").digest("hex"), ...bindings });
}
