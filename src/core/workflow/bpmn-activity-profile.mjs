import { AIDN_BPMN_NS, bpmnAttribute as attr, bpmnId as id, assertBpmnShape as shape, bpmnFail as fail } from "./bpmn-profile.mjs";
import { processId } from "./agentic-process-model.mjs";

function extension(node, name, attributes) {
  if (!node || node.uri !== AIDN_BPMN_NS || node.name !== name || node.children.length || node.text.trim()
    || node.attributes.some(a => a.uri || !attributes.includes(a.name))) fail("BPMN_EXECUTION_BINDING_INVALID");
}
const integer = (text, minimum) => typeof text === "string" && /^(0|[1-9][0-9]*)$/.test(text) && Number(text) >= minimum && Number(text) <= 32;

// Closed mappings to the existing activity/call and repetition nodes. Loop
// polarity and failure limits are explicit; no generated facts or expressions.
export function readBpmnActivity(node) {
  const call = node.name === "callActivity";
  shape(node, ["id", "name", ...(call ? ["calledElement"] : [])], ["incoming", "outgoing", "extensionElements", "standardLoopCharacteristics", "multiInstanceLoopCharacteristics"]);
  const containers = node.children.filter(c => c.name === "extensionElements");
  if (containers.length > 1 || (!call && containers.length !== 1)) fail("BPMN_EXECUTION_BINDING_REQUIRED", id(node));
  const extensions = containers[0]?.children ?? [];
  if (containers.some(c => c.attributes.length || c.text.trim()) || new Set(extensions.map(e => e.name)).size !== extensions.length
    || extensions.some(e => e.uri !== AIDN_BPMN_NS || !["execution", "iterationLimit", "collection"].includes(e.name))) fail("BPMN_EXECUTION_BINDING_INVALID", id(node));
  const execution = extensions.find(e => e.name === "execution");
  if (call ? !!execution : !execution) fail("BPMN_EXECUTION_BINDING_INVALID", id(node));
  let binding = null;
  if (execution) {
    extension(execution, "execution", ["roleRef", "policyRef"]);
    if (!processId(attr(execution, "roleRef")) || !processId(attr(execution, "policyRef"))) fail("BPMN_EXECUTION_BINDING_INVALID", id(node));
    binding = { role_ref: attr(execution, "roleRef"), policy_ref: attr(execution, "policyRef") };
  }
  const repeats = node.children.filter(c => ["standardLoopCharacteristics", "multiInstanceLoopCharacteristics"].includes(c.name));
  const limit = extensions.find(e => e.name === "iterationLimit"), collection = extensions.find(e => e.name === "collection");
  if (repeats.length > 1 || (!repeats.length && (limit || collection))) fail("BPMN_REPETITION_INVALID", id(node));
  let repetition = null;
  if (repeats[0]?.name === "standardLoopCharacteristics") {
    const loop = repeats[0];
    // BPMN loopMaximum exits normally; the current IR fails at its guard.
    if (attr(loop, "loopMaximum") !== undefined) fail("BPMN_LOOP_MAXIMUM_UNSUPPORTED", id(node));
    shape(loop, ["id", "testBefore"], ["loopCondition"]);
    if (![undefined, "false"].includes(attr(loop, "testBefore")) || loop.children.length !== 1 || !limit || collection) fail("BPMN_LOOP_INVALID", id(node));
    const condition = loop.children[0]; shape(condition, ["language"], [], true);
    const until = /^not\(([a-z][a-z0-9_-]{0,63})\)$/.exec(condition.text.trim())?.[1];
    if (attr(condition, "language") !== AIDN_BPMN_NS || !until) fail("BPMN_LOOP_CONDITION_INVALID", id(node));
    extension(limit, "iterationLimit", ["maxIterations", "onLimit"]);
    if (!integer(attr(limit, "maxIterations"), 1) || attr(limit, "onLimit") !== "fail") fail("BPMN_LOOP_LIMIT_INVALID", id(node));
    repetition = { kind: "loop", until, max_iterations: Number(attr(limit, "maxIterations")) };
  } else if (repeats.length) {
    const multi = repeats[0];
    shape(multi, ["id", "isSequential"], ["loopCardinality"]);
    if (![undefined, "true", "false"].includes(attr(multi, "isSequential")) || multi.children.length !== 1 || !collection || limit) fail("BPMN_MULTI_INSTANCE_INVALID", id(node));
    const cardinality = multi.children[0]; shape(cardinality, [], [], true);
    extension(collection, "collection", ["items"]);
    const text = attr(collection, "items");
    const items = typeof text === "string" ? text.trim().split(/\s+/).filter(Boolean) : null;
    if (!items || items.length > 32 || !items.every(processId) || new Set(items).size !== items.length
      || !integer(cardinality.text.trim(), 0) || Number(cardinality.text.trim()) !== items.length) fail("BPMN_COLLECTION_INVALID", id(node));
    repetition = { kind: "multi_instance", items, ordering: attr(multi, "isSequential") === "true" ? "sequential" : "parallel" };
  }
  return { binding, calledElement: call ? attr(node, "calledElement") : null, repetition };
}
