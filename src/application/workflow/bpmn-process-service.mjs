import { createHash } from "node:crypto";
import { readBpmnXml } from "../../adapters/workflow/bpmn-xml.mjs";
import { compileBpmnProcessTree } from "../../core/workflow/bpmn-process-compiler.mjs";
import { compileExtendedBpmnProcessTree } from "../../core/workflow/bpmn-process-compiler-v2.mjs";
import { bpmnFail, BPMN_EXECUTION_PROFILE, BPMN_EXTENDED_EXECUTION_PROFILE, DEFAULT_BPMN_EXECUTION_PROFILE, BPMN_EXECUTION_PROFILES } from "../../core/workflow/bpmn-profile.mjs";
import { checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { exactKeys } from "../../core/workflow/agentic-process-model.mjs";

// Explicit in-memory compilation. No file lookup, plugin/agent selection or write.
export function compileBpmnProcess(input) {
  // XML has its own byte limit; the remaining binding input uses the JSON guard.
  if (!input || Object.getPrototypeOf(input) !== Object.prototype
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !("value" in d))) bpmnFail("BPMN_BINDINGS_INVALID");
  const { xml, ...bindings } = input;
  if (!exactKeys(bindings, ["modelId", "revision", "participantId", "roles", "policies"], ["profile", "processRef"]) || checkShadowJson(bindings)) bpmnFail("BPMN_BINDINGS_INVALID");
  const profile = Object.hasOwn(bindings, "profile") ? bindings.profile : DEFAULT_BPMN_EXECUTION_PROFILE;
  if (!BPMN_EXECUTION_PROFILES.includes(profile) || (profile === BPMN_EXECUTION_PROFILE && Object.hasOwn(bindings, "processRef"))) bpmnFail("BPMN_PROFILE_UNSUPPORTED");
  if (Object.hasOwn(bindings, "processRef") && (typeof bindings.processRef !== "string" || !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(bindings.processRef))) bpmnFail("BPMN_BINDINGS_INVALID");
  const { profile: selectedProfile, ...options } = bindings;
  const root = readBpmnXml(xml);
  const compile = profile === BPMN_EXTENDED_EXECUTION_PROFILE ? compileExtendedBpmnProcessTree : compileBpmnProcessTree;
  return compile({ root, sourceSha256: createHash("sha256").update(xml, "utf8").digest("hex"), ...options });
}
