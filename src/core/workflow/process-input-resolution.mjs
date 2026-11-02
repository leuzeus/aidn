import { inspectAgenticProcess } from "./agentic-process.mjs";
import { assertResolvedProcessInput } from "./process-data-contracts.mjs";
import { checkShadowJson, shadowHash, freezeShadow } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// This is pure data selection. Only the trusted outer host supplies a journal
// reader; authored bindings cannot select adapters, files, code or authorities.
export function resolveProcessOperationInput({ instance, occurrenceId, readOperation }) {
  const cursor = inspectAgenticProcess(instance), frames = new Map(cursor.occurrences.map(row => [row.occurrence_id, row]));
  const nodes = new Map(instance.model.nodes.map(row => [row.id, row])), target = frames.get(occurrenceId);
  const spec = instance.model.data_bindings?.inputs.find(row => row.node_id === target?.node_id);
  if (!spec || !["operation", ...(instance.model.data_bindings?.contract_version === "process-data-bindings.v2" ? ["activity"] : [])].includes(nodes.get(target.node_id).kind)) fail("PROCESS_INPUT_BINDING_REQUIRED");
  if (!(target.status === "READY" || target.status === "WAITING" && ["blocked", "deferred"].includes(target.operation?.receipt?.outcome))) fail("PROCESS_INPUT_TARGET_NOT_READY");
  function scopes(frame) {
    const result = [];
    while (frame.parent_id) {
      const parent = frames.get(frame.parent_id);
      if (["loop", "multi_instance", "call"].includes(nodes.get(parent.node_id).kind)) result.unshift(frame.occurrence_id);
      frame = parent;
    }
    return result;
  }
  const targetScope = scopes(target);
  function sourceFrame(id) {
    const matches = [...frames.values()].filter(row => row.node_id === id && row.status === "COMPLETED")
      .map(frame => ({ frame, scope: scopes(frame) })).filter(row => row.scope.every((value, index) => targetScope[index] === value))
      .sort((a, b) => b.scope.length - a.scope.length);
    if (!matches.length || matches[1]?.scope.length === matches[0].scope.length) fail("PROCESS_INPUT_SOURCE_NOT_UNIQUE");
    return matches[0].frame;
  }
  function select(value, path) {
    for (const part of path) {
      if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) fail("PROCESS_INPUT_VALUE_MISSING");
      value = value[part];
    }
    if (value === undefined || checkShadowJson(value)) fail("PROCESS_INPUT_VALUE_INVALID");
    return structuredClone(value);
  }
  const input = {}, sources = [];
  for (const field of Object.keys(spec.fields).sort()) {
    const expr = spec.fields[field];
    let value, observed, frame = null, operationId = null;
    if (expr.source === "literal") value = observed = expr.value;
    else if (expr.source === "parameter") { observed = instance.initial_parameters; value = select(observed[expr.key], expr.path); }
    else if (expr.source === "item") {
      frame = target;
      while (frame && frame.node_id !== expr.node_id) frame = frames.get(frame.parent_id);
      if (!frame || nodes.get(frame.node_id).kind !== "multi_instance") fail("PROCESS_INPUT_ITEM_SCOPE_INVALID");
      const child = targetScope.find(id => frames.get(id)?.parent_id === frame.occurrence_id), index = /^item-(\d+)$/.exec(child?.slice(frame.occurrence_id.length + 1) ?? "")?.[1];
      if (index === undefined) fail("PROCESS_INPUT_ITEM_SCOPE_INVALID");
      observed = nodes.get(frame.node_id).items; value = observed[Number(index)];
    } else {
      frame = sourceFrame(expr.node_id); observed = frame.result ?? frame.operation?.receipt;
      if (expr.source === "occurrence_id") value = frame.occurrence_id;
      else {
        operationId = frame.operation?.intent.operation_id;
        if (!operationId || frame.operation.receipt?.outcome !== "completed") fail("PROCESS_INPUT_RESULT_REQUIRED");
        if (expr.source === "operation_id") value = operationId;
        else {
          if (typeof readOperation !== "function") fail("PROCESS_INPUT_AUTHORITY_REQUIRED");
          const retained = readOperation(operationId);
          if (!retained || checkShadowJson(retained) || !retained.preview || !retained.intent || !Object.hasOwn(retained.preview, "input") || !Array.isArray(retained.results)) fail("PROCESS_INPUT_RESULT_CHANGED");
          const result = retained.results.at(-1);
          if (!result || !Object.hasOwn(result, "output") || !result.receipt || retained.phase !== "receipted"
            || shadowHash(retained.intent) !== shadowHash(frame.operation.intent) || shadowHash(result?.receipt ?? null) !== shadowHash(frame.operation.receipt)
            || shadowHash(retained.preview.input) !== retained.intent.input_sha256
            || shadowHash(result.output) !== result.receipt.output_sha256) fail("PROCESS_INPUT_RESULT_CHANGED");
          observed = expr.source === "operation_input" ? retained.preview.input : result.output;
          value = select(observed, expr.path);
        }
      }
    }
    if (value === undefined || checkShadowJson(value)) fail("PROCESS_INPUT_VALUE_INVALID");
    input[field] = structuredClone(value);
    sources.push({ field, source: expr.source, occurrence_id: frame?.occurrence_id ?? null, operation_id: operationId, sha256: shadowHash(observed) });
  }
  return freezeShadow(assertResolvedProcessInput({ contract_version: instance.model.data_bindings.contract_version === "process-data-bindings.v2" ? "process-resolved-input.v2" : "process-resolved-input.v1", instance_sha256: instance.instance_sha256,
    occurrence_id: occurrenceId, bindings_sha256: shadowHash(instance.model.data_bindings), input, sources }, { instance, occurrenceId }));
}
