export const BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL";
export const AIDN_BPMN_NS = "urn:aidn:bpmn:execution:v1";
export const BPMN_EXECUTION_PROFILE = "aidn-bpmn-structured.v1";
export function bpmnFail(code, elementId = null) {
  throw Object.assign(new Error(code), { code, element_id: elementId });
}
