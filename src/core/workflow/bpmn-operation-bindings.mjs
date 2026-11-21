import { assertProcessOperationBinding } from "./process-operation-contracts.mjs";
import { shadowHash } from "./shadow-json.mjs";
import { bpmnFail as fail } from "./bpmn-profile.mjs";

export function indexBpmnOperationBindings(definitions = []) {
  if (!Array.isArray(definitions) || definitions.length > 256) fail("BPMN_OPERATION_BINDINGS_INVALID");
  const pins = new Map();
  for (const binding of definitions) {
    assertProcessOperationBinding(binding);
    if (pins.has(binding.id)) fail("BPMN_OPERATION_BINDINGS_INVALID", binding.id);
    pins.set(binding.id, shadowHash(binding));
  }
  return pins;
}

export function resolveBpmnOperation(pins, ref, digest, elementId) {
  if (!pins.has(ref)) fail("BPMN_OPERATION_BINDING_MISSING", elementId);
  if (digest !== pins.get(ref)) fail("BPMN_OPERATION_BINDING_CHANGED", elementId);
  return { kind: "operation", binding_ref: ref };
}

export function compileBpmnDataBindings(definition, sourceMap, nodes) {
  const bindings = structuredClone(definition);
  if (bindings?.contract_version !== "process-data-bindings.v4" || !Array.isArray(bindings.inputs))
    fail("BPMN_DATA_BINDINGS_INVALID");
  function resolve(id) {
    const matches = sourceMap.filter(row => row.bpmn_id === id)
      .filter(row => nodes.some(node => node.id === row.ir_node_id && ["operation", "activity", "multi_instance"].includes(node.kind)));
    if (matches.length !== 1) fail("BPMN_DATA_REFERENCE_INVALID", id);
    return matches[0].ir_node_id;
  }
  for (const row of bindings.inputs) {
    if (!row?.fields || typeof row.fields !== "object") fail("BPMN_DATA_BINDINGS_INVALID");
    row.node_id = resolve(row.node_id);
    for (const expression of Object.values(row.fields))
      if (expression && Object.hasOwn(expression, "node_id")) expression.node_id = resolve(expression.node_id);
  }
  return bindings;
}
