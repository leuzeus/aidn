import sax from "sax";
import { bpmnFail } from "../../core/workflow/bpmn-profile.mjs";

// XML syntax and namespace handling only. Profile/graph semantics live in core.
// No DTD, custom entities, external resolution, script evaluation or XSD claim.
export function readBpmnXml(xml) {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > 262144) bpmnFail("BPMN_XML_LIMIT");
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  const stack = []; let root = null, count = 0;
  let attributeNames = new Set();
  parser.onopentagstart = () => { attributeNames = new Set(); };
  parser.onattribute = attribute => {
    if (attributeNames.has(attribute.name)) bpmnFail("BPMN_XML_INVALID");
    attributeNames.add(attribute.name);
  };
  parser.onerror = () => bpmnFail("BPMN_XML_INVALID");
  parser.ondoctype = parser.onsgmldeclaration = () => bpmnFail("BPMN_XML_DECLARATION_UNSUPPORTED");
  parser.onprocessinginstruction = ({ name }) => { if (name !== "xml") bpmnFail("BPMN_XML_DECLARATION_UNSUPPORTED"); };
  parser.onopentag = tag => {
    if (++count > 4096 || stack.length >= 24) bpmnFail("BPMN_XML_LIMIT");
    const attributes = Object.values(tag.attributes).filter(a => a.uri !== "http://www.w3.org/2000/xmlns/")
      .map(a => ({ name: a.local, uri: a.uri, value: a.value }));
    const node = { name: tag.local, uri: tag.uri, attributes, children: [], text: "" };
    if (stack.length) stack.at(-1).children.push(node);
    else if (root) bpmnFail("BPMN_XML_INVALID");
    else root = node;
    stack.push(node);
  };
  parser.onclosetag = () => stack.pop();
  parser.ontext = parser.oncdata = text => {
    if (stack.length) stack.at(-1).text += text;
    else if (text.trim()) bpmnFail("BPMN_XML_INVALID");
  };
  try { parser.write(xml).close(); }
  catch (error) { if (error.code?.startsWith("BPMN_")) throw error; bpmnFail("BPMN_XML_INVALID"); }
  if (!root || stack.length) bpmnFail("BPMN_XML_INVALID");
  return root;
}
