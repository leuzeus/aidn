export const BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL";
export const AIDN_BPMN_NS = "urn:aidn:bpmn:execution:v1";
export const BPMN_EXECUTION_PROFILE = "aidn-bpmn-structured.v1";
export const BPMN_EXTENDED_EXECUTION_PROFILE = "aidn-bpmn-structured.v2";
export const BPMN_EXECUTION_PROFILES = Object.freeze([BPMN_EXECUTION_PROFILE, BPMN_EXTENDED_EXECUTION_PROFILE]);
export const bpmnAttribute = (node, name) => node.attributes.find(a => a.name === name && !a.uri)?.value;
export const bpmnId = node => bpmnAttribute(node, "id") ?? null;
export function assertBpmnShape(node, attributes, children, text = false) {
  if (node.attributes.some(a => a.uri || !attributes.includes(a.name)) || (!text && node.text.trim())) bpmnFail("BPMN_PROFILE_ATTRIBUTE_UNSUPPORTED", bpmnId(node));
  for (const child of node.children) if (child.uri !== BPMN_NS || !children.includes(child.name)) bpmnFail("BPMN_PROFILE_ELEMENT_UNSUPPORTED", bpmnId(child) ?? bpmnId(node));
}
export function bpmnFail(code, elementId = null) {
  throw Object.assign(new Error(code), { code, element_id: elementId });
}
