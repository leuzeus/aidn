import { assertResolvedProcessInput, processResolutionVersion } from "./process-data-contracts.mjs";
import { checkShadowJson, shadowHash, freezeShadow } from "./shadow-json.mjs";

import { processModels, resolveProcessCallTarget } from "./process-call-model.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// This is pure data selection. Only the trusted outer host supplies a journal
// reader; authored bindings cannot select adapters, files, code or authorities.
export function resolveProcessFrameInput({ instance, cursor, occurrenceId, readOperation, returning = false }) {
  const frames = new Map(cursor.occurrences.map(row => [row.occurrence_id, row]));
  const target = frames.get(occurrenceId);
  if (!target) fail("PROCESS_INPUT_BINDING_REQUIRED");
  // Resolve authored model identities once inside this synchronous selection.
  // No cursor, journal value or authority is retained beyond this invocation.
  const models = new Map(processModels(instance.model).map(model => [shadowHash(model), model]));
  const rootSha256 = models.keys().next().value;
  const modelFor = frame => frame.model_sha256 === undefined ? instance.model
    : models.get(frame.model_sha256) ?? fail("PROCESS_CALL_TARGET_CHANGED");
  const model = modelFor(target);
  const nodes = new Map(model.nodes.map(row => [row.id, row]));
  const targetNode = nodes.get(target.node_id);
  const called = returning ? resolveProcessCallTarget(instance.model, targetNode.target) : null;
  const spec = returning ? { fields: Object.fromEntries(Object.entries(called.call_interface.returns).map(([field, row]) =>
    [field, { source: "operation_output", node_id: row.node_id, path: row.path }])) }
    : model.data_bindings?.inputs.find(row => row.node_id === target.node_id);
  if (!spec || !returning && !["operation", ...(["process-data-bindings.v2", "process-data-bindings.v3", "process-data-bindings.v4"].includes(model.data_bindings?.contract_version) ? ["activity", ...(targetNode.target ? ["call"] : [])] : [])].includes(targetNode.kind)) fail("PROCESS_INPUT_BINDING_REQUIRED");
  if (!(returning ? target.status === "WAITING" && target.wait_reason === "call_return" : target.status === "READY" || target.status === "WAITING" && (["blocked", "deferred"].includes(target.operation?.receipt?.outcome) || target.wait_reason === "call_entry"))) fail("PROCESS_INPUT_TARGET_NOT_READY");
  function scopes(frame) {
    const result = [];
    while (frame.parent_id) {
      const parent = frames.get(frame.parent_id);
      if (["loop", "multi_instance", "call"].includes(modelFor(parent).nodes.find(node => node.id === parent.node_id).kind)) result.unshift(frame.occurrence_id);
      frame = parent;
    }
    return result;
  }
  const targetScope = returning ? [...scopes(target), `${target.occurrence_id}/call`] : scopes(target);
  function sourceFrame(id) {
    const matches = [...frames.values()].filter(row => row.node_id === id && row.status === "COMPLETED"
      && (returning ? row.call_scope_id === target.occurrence_id && row.model_sha256 === targetNode.target.model_sha256
        : row.model_sha256 === target.model_sha256 && row.call_scope_id === target.call_scope_id))
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
    else if (expr.source === "parameter") {
      observed = target.call_scope_id ? frames.get(target.call_scope_id)?.call_entry?.input : instance.initial_parameters;
      if (!observed || !Object.hasOwn(observed, expr.key)) fail("PROCESS_INPUT_VALUE_MISSING");
      value = select(observed[expr.key], expr.path);
    }
    else if (expr.source === "item") {
      frame = target;
      while (frame && frame.node_id !== expr.node_id) frame = frames.get(frame.parent_id);
      if (!frame || nodes.get(frame.node_id).kind !== "multi_instance") fail("PROCESS_INPUT_ITEM_SCOPE_INVALID");
      const child = targetScope.find(id => frames.get(id)?.parent_id === frame.occurrence_id), index = /^item-(\d+)$/.exec(child?.slice(frame.occurrence_id.length + 1) ?? "")?.[1];
      if (index === undefined) fail("PROCESS_INPUT_ITEM_SCOPE_INVALID");
      observed = nodes.get(frame.node_id).items; value = observed[Number(index)];
    } else {
      frame = sourceFrame(expr.node_id); observed = frame.result ?? frame.operation?.receipt;
      if (expr.source === "call_output") {
        if (!frame.call_return) fail("PROCESS_CALL_RETURN_REQUIRED");
        observed = frame.call_return.input; value = select(observed, expr.path);
      } else
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
  const resolution = { contract_version: returning ? "process-resolved-input.v3" : processResolutionVersion(model.data_bindings), instance_sha256: instance.instance_sha256,
    occurrence_id: occurrenceId, bindings_sha256: shadowHash(returning ? called.call_interface.returns : model.data_bindings), input, sources };
  // A synchronous trusted reader can still be a callback. Refuse a model edit
  // during that callback rather than returning a selection from mixed bytes.
  if (shadowHash(instance.model) !== rootSha256) fail("PROCESS_CALL_TARGET_CHANGED");
  return freezeShadow(assertResolvedProcessInput(resolution, returning ? {} : { instance, occurrenceId, model }));
}
