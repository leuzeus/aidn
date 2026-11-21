import { assertProcessCallValues } from "./process-call-model.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import transitionSchema from "../contracts/workflow-definition/process-call-transition.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
// One shared pure algorithm. Replay dependencies are lexical to its invocation;
// public wrappers below this boundary always supply the original fixed helpers.
export function createProcessCallSelector({ frameNode: processFrameNode,
  resolveFrameInput: resolveProcessFrameInput, resolveCallTarget: resolveProcessCallTarget }) {
  function resolveProcessCallData({ instance, cursor, occurrenceId, returning = false, readOperation }) {
    const frame = cursor.occurrences.find(row => row.occurrence_id === occurrenceId);
    const node = processFrameNode(instance.model, frame);
    if (node.kind !== "call" || !node.target) fail("PROCESS_CALL_NOT_FOUND");
    const witnesses = new Map();
    const resolution = resolveProcessFrameInput({ instance, cursor, occurrenceId, returning, readOperation: id => {
      const record = readOperation?.(id);
      if (!record) throw Object.assign(new Error("PROCESS_CALL_WITNESS_REQUIRED"), { code: "PROCESS_CALL_WITNESS_REQUIRED", operation_id: id });
      if (checkShadowJson(record) || !record.preview || !record.intent || !record.results?.length) fail("PROCESS_CALL_WITNESS_INVALID");
      const witness = { operation_id: id, phase: record.phase, preview: { input: record.preview.input }, intent: record.intent,
        results: [record.results.at(-1)] };
      witnesses.set(id, witness);
      return witness;
    } });
    const target = resolveProcessCallTarget(instance.model, node.target);
    assertProcessCallValues(resolution.input, returning ? Object.fromEntries(Object.entries(target.call_interface.returns).map(([key, row]) => [key, row.type])) : target.call_interface.parameters);
    return { resolution, witnesses: [...witnesses.values()].sort((a, b) => a.operation_id.localeCompare(b.operation_id)) };
  }

  function assertProcessCallTransition(event, options) {
    if (checkShadowJson(event) || validateJsonSchema(event, transitionSchema, "$", { contractKind: "workflow-definition" }).length)
      fail("PROCESS_CALL_EVENT_INVALID");
    const witnesses = new Map(event.witnesses.map(row => [row.operation_id, row]));
    if (witnesses.size !== event.witnesses.length) fail("PROCESS_CALL_WITNESS_INVALID");
    const expected = resolveProcessCallData({ ...options, returning: event.kind === "call_return", readOperation: id => witnesses.get(id) });
    if (shadowHash(expected) !== shadowHash({ resolution: event.resolution, witnesses: event.witnesses })) fail("PROCESS_CALL_RESOLUTION_CHANGED");
    return event;
  }
  return Object.freeze({ resolveCallData: resolveProcessCallData, assertCallTransition: assertProcessCallTransition });
}
